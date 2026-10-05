const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const source = fs.readFileSync(path.join(__dirname, 'Notifications APC 204.user.js'), 'utf8');
const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.apcLanguageTest = { translate: t, load: loadLanguage,
        state: () => ({ currentLang, backgroundState, timeLeft }) };
})();`);
const packs = Object.fromEntries(['ru', 'uk'].map(lang => [lang,
    JSON.parse(fs.readFileSync(path.join(__dirname, 'languages', lang + '.json'), 'utf8'))]));
assert.deepEqual(Object.keys(packs.ru).sort(), Object.keys(packs.uk).sort());
for (const pack of Object.values(packs)) {
    assert(Object.values(pack).every(value => typeof value === 'string' && value.trim()));
    assert(pack.ignorePrompt.includes('{0}'));
}

async function main() {
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><meta charset="utf-8"><title>Languages fixture</title><body><p>APC</p></body>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    let passed = 0;
    const ok = message => { passed++; console.log('PASS ' + message); };
    const errors = [];
    const pages = [];
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        async function fixture(initialStorage = {}) {
            const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
            pages.push(page);
            page.on('pageerror', error => errors.push(error.message));
            await page.addInitScript(() => {
                window.RTCPeerConnection = undefined;
                window.Notification = undefined;
                window.languageRequests = [];
                window.GM_xmlhttpRequest = options => {
                    window.languageRequests.push(options);
                    return { abort() { window.languageAborts = (window.languageAborts || 0) + 1; } };
                };
            });
            await page.goto(`http://127.0.0.1:${server.address().port}/#deviceGroups`);
            await page.evaluate(storage => {
                for (const [key, value] of Object.entries(storage)) {
                    if (value === null) localStorage.removeItem(key);
                    else localStorage.setItem(key, value);
                }
            }, { spa_lang: 'ru', ...initialStorage });
            await page.addScriptTag({ content: instrumented });
            return page;
        }
        async function respond(page, index, status, payload) {
            await page.evaluate(({ index, status, payload }) => {
                languageRequests[index].onload({ status, responseText: typeof payload === 'string' ? payload : JSON.stringify(payload) });
            }, { index, status, payload });
        }

        const fresh = await fixture({ spa_lang: null, spa_i18n_v1_uk: JSON.stringify({ langTitle: 'Язык интерфейса / Мова інтерфейсу' }) });
        assert.equal(await fresh.evaluate(() => apcLanguageTest.state().currentLang), 'uk');
        assert.match(await fresh.evaluate(() => languageRequests[0].url), /\/uk\.json\?_/);
        assert.equal(await fresh.evaluate(() => apcLanguageTest.translate('langTitle')), packs.uk.langTitle);
        await respond(fresh, 0, 200, { ...packs.uk, langTitle: 'Язык интерфейса / Мова інтерфейсу' });
        assert.equal(await fresh.evaluate(() => apcLanguageTest.translate('langTitle')), packs.uk.langTitle);
        await fresh.close();
        ok('Fresh installs default to Ukrainian and old cache/remote headings keep Ukrainian first');

        const page = await fixture();
        assert.equal(await page.evaluate(() => apcLanguageTest.state().currentLang), 'ru');
        assert.equal(await page.locator('#apc-timer-btn').isVisible(), true);
        assert.equal(await page.evaluate(() => apcLanguageTest.state().backgroundState), 'unavailable');
        const request = await page.evaluate(() => ({ url: languageRequests[0].url, timeout: languageRequests[0].timeout, anonymous: languageRequests[0].anonymous }));
        assert.match(request.url, /^https:\/\/raw\.githubusercontent\.com\/Ovolsan\/Notifications-APC-204\/main\/languages\/ru\.json\?_=/);
        assert.equal(request.timeout, 5000);
        assert.equal(request.anonymous, true);
        await page.evaluate(() => { void apcLanguageTest.load('ru'); });
        assert.equal(await page.evaluate(() => languageRequests.length), 1);
        ok('Monitoring starts while the language request is pending; requests are bounded and deduplicated');

        await respond(page, 0, 200, { historyButton: 'Remote history', ignorePrompt: 'Label={0}', permissionsTitle: '<img src=x onerror="window.injected=true">', extraUnknownKey: 'ignored' });
        await page.waitForFunction(() => document.querySelector('#apc-history-btn').textContent === 'Remote history');
        assert.equal(await page.evaluate(() => apcLanguageTest.translate('ignorePrompt', 'UPS-37')), 'Label=UPS-37');
        await page.click('#apc-timer-btn');
        await page.click('#apc-settings-btn');
        assert.equal(await page.locator('#apc-settings-panel img').count(), 0);
        assert.equal(await page.evaluate(() => window.injected), undefined);
        assert.match(await page.locator('#apc-settings-panel').textContent(), /<img src=x/);
        const cached = await page.evaluate(() => JSON.parse(localStorage.spa_i18n_v1_ru));
        assert.equal(cached.historyButton, 'Remote history');
        assert.equal(Object.hasOwn(cached, 'extraUnknownKey'), false);
        ok('External strings refresh the UI, preserve placeholders, use key fallbacks and cannot inject HTML');

        await page.reload();
        await page.addScriptTag({ content: instrumented });
        await respond(page, 0, 404, 'Not found');
        assert.equal(await page.locator('#apc-history-btn').textContent(), 'Remote history');
        assert.equal(await page.locator('#apc-timer-btn').isVisible(), true);
        ok('Saved translations survive reload and a GitHub 404');

        const invalid = await fixture({ spa_i18n_v1_uk: '{bad cache', spa_lang: 'unsupported' });
        await respond(invalid, 0, 200, '<html>Bad gateway</html>');
        assert.equal(await invalid.evaluate(() => apcLanguageTest.translate('tabSettings')), packs.uk.tabSettings);
        assert.equal(await invalid.evaluate(() => apcLanguageTest.state().currentLang), 'uk');
        await invalid.evaluate(() => { void apcLanguageTest.load('uk'); });
        await respond(invalid, 1, 200, { tabSettings: 15 });
        assert.equal(await invalid.evaluate(() => apcLanguageTest.translate('tabSettings')), packs.uk.tabSettings);
        await invalid.evaluate(() => { void apcLanguageTest.load('uk'); });
        await invalid.evaluate(() => languageRequests[2].ontimeout());
        assert.equal(await invalid.locator('#apc-timer-btn').isVisible(), true);
        ok('Corrupt cache, malformed JSON, invalid types, unsupported locale and timeout keep built-in translations');

        const race = await fixture();
        await race.click('#apc-timer-btn');
        await race.click('#apc-settings-btn');
        await race.click('#langUk');
        await race.click('#langRu');
        await race.click('#langUk');
        assert.equal(await race.evaluate(() => languageRequests.length), 2);
        await respond(race, 1, 200, { ...packs.uk, settingsButton: 'UK remote settings' });
        await respond(race, 0, 200, { ...packs.ru, settingsButton: 'RU remote settings' });
        assert.equal(await race.locator('#apc-settings-btn').textContent(), 'UK remote settings');
        assert.equal(await race.evaluate(() => apcLanguageTest.state().currentLang), 'uk');
        assert.equal(await race.evaluate(() => localStorage.spa_lang), 'uk');
        ok('Fast language switching and late responses preserve the latest selection');

        const quota = await fixture();
        await quota.evaluate(() => {
            const originalSet = Storage.prototype.setItem;
            Storage.prototype.setItem = function(key, value) {
                if (key.startsWith('spa_i18n_v1_')) throw new DOMException('Full', 'QuotaExceededError');
                return originalSet.call(this, key, value);
            };
        });
        await respond(quota, 0, 200, { historyButton: 'Loaded without cache' });
        assert.equal(await quota.locator('#apc-history-btn').textContent(), 'Loaded without cache');
        assert.equal(await quota.locator('#apc-timer-btn').isVisible(), true);
        ok('Storage quota failure does not discard a downloaded translation or stop monitoring');

        const fetchPage = await browser.newPage();
        pages.push(fetchPage);
        fetchPage.on('pageerror', error => errors.push(error.message));
        await fetchPage.goto(`http://127.0.0.1:${server.address().port}/#deviceGroups`);
        await fetchPage.evaluate(pack => {
            window.RTCPeerConnection = undefined;
            window.fetch = async (url, options) => {
                window.fetchOptions = { url, cache: options.cache, credentials: options.credentials };
                return { ok: true, text: async () => JSON.stringify(pack) };
            };
        }, { historyButton: 'Fetch fallback' });
        await fetchPage.addScriptTag({ content: instrumented });
        await fetchPage.waitForFunction(() => document.querySelector('#apc-history-btn').textContent === 'Fetch fallback');
        assert.deepEqual(await fetchPage.evaluate(() => ({ cache: fetchOptions.cache, credentials: fetchOptions.credentials })), { cache: 'no-store', credentials: 'omit' });
        ok('Fetch fallback loads JSON without GM_xmlhttpRequest');

        const timeoutPage = await fixture();
        await timeoutPage.evaluate(() => { apcLanguageTest.load('ru').then(() => { window.languageSettled = true; }); });
        await timeoutPage.waitForFunction(() => window.languageSettled, { timeout: 8000 });
        assert.equal(await timeoutPage.evaluate(() => languageAborts), 1);
        assert.equal(await timeoutPage.locator('#apc-timer-btn').isVisible(), true);
        await respond(timeoutPage, 0, 200, { historyButton: 'Too late' });
        assert.equal(await timeoutPage.evaluate(() => apcLanguageTest.translate('historyButton')), packs.ru.historyButton);
        ok('Independent five-second timeout aborts a hung manager request and ignores its late response');

        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ passed, errors }, null, 2));
    } finally {
        for (const page of pages) await page.close();
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
