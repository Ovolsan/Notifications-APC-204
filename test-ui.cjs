const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
    const source = fs.readFileSync(path.join(__dirname, 'Notifications APC 204.user.js'), 'utf8')
        .replace(/\}\)\(\);\s*$/, `
    window.apcUiTest = {
        setHistory(value) { alarmsCache = value; activeTab = 'history'; renderModal(); },
        setRules(value) { muteRules = value; activeTab = 'rules'; renderModal(); }
    };
})();`);
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Site-wide table/button styles must not break the widget's cell layout.
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APC UI fixture</title>
            <style>html,body{overflow:hidden}body{background:#181a1b}table{font-size:18px;table-layout:fixed}
            td{word-break:break-all;overflow-wrap:anywhere}button{white-space:normal;font-size:16px;line-height:1.5;padding:10px 20px}</style>
            <body><h1 style="color:#ddd">APC test page</h1></body>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    const errors = [];
    let passed = 0;
    const ok = message => { passed++; console.log('PASS ' + message); };
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/#deviceGroups`);
        await page.evaluate(() => {
            localStorage.setItem('spa_alarms_cache', JSON.stringify({
                newest: { parsedAt: 300, deviceLabel: 'New UPS', description: 'New alarm', startTime: '12:03', isRead: true },
                oldest: { parsedAt: 100, deviceLabel: 'Old UPS', description: 'Old alarm', startTime: '12:01', isRead: true },
                middle: { parsedAt: 200, deviceLabel: 'Middle UPS', description: 'Middle alarm', startTime: '12:02', isRead: true }
            }));
            localStorage.setItem('spa_mute_rules', JSON.stringify([{ label: 'First filter', text: 'first' }, { label: 'Last filter', text: 'last' }]));
            // Only the file-selected indicator is exercised here; audio playback has its own fixture.
            localStorage.setItem('spa_snd_std', 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=');
            window.RTCPeerConnection = undefined;
            window.GM_xmlhttpRequest = options => queueMicrotask(options.onerror);
            window.Notification = undefined;
            window.copiedValues = [];
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => copiedValues.push(value) }, configurable: true });
        });
        await page.addScriptTag({ content: source });
        assert.match(await page.locator('#apc-timer-btn').textContent(), /🔄 [45]:\d{2}/);
        assert.match(await page.locator('#apc-history-btn').textContent(), /Історія/);
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-settings-btn').isVisible(), false);
        const closed = await page.locator('#apc-monitor-widget').boundingBox();
        assert(closed.x < 3 && closed.y > 800);
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-timer.png') });
        ok('Five-minute timer starts in Ukrainian at the bottom left');

        await page.click('#apc-timer-btn');
        assert.deepEqual(await page.locator('#apc-settings-panel tbody tr td:nth-child(2)').allTextContents(), ['Old UPS', 'Middle UPS', 'New UPS']);
        assert.equal((await page.locator('#apc-settings-panel').boundingBox()).width, 760);
        await page.click('#apc-rules-btn');
        assert.equal((await page.locator('#apc-settings-panel').boundingBox()).width, 640);
        assert.deepEqual(await page.locator('#apc-settings-panel tbody tr td:first-child').allTextContents(), ['First filter', 'Last filter']);
        await page.click('#apc-history-btn');
        page.once('dialog', dialog => dialog.accept('New alarm'));
        await page.locator('.ignore-btn').last().click();
        await page.click('#apc-rules-btn');
        assert.deepEqual(await page.locator('#apc-settings-panel tbody tr td:first-child').allTextContents(), ['First filter', 'Last filter', 'New UPS']);
        await page.locator('.del-rule-btn').first().click();
        assert.deepEqual(await page.locator('#apc-settings-panel tbody tr td:first-child').allTextContents(), ['Last filter', 'New UPS']);
        ok('Wider history and filters preserve insertion order and delete the correct rule');

        await page.click('#apc-settings-btn');
        assert.equal((await page.locator('#apc-settings-panel').boundingBox()).width, 468);
        assert.equal(await page.locator('[data-permission-browser]').count(), 3);
        assert.equal(await page.locator('#apc-permission-guide').isVisible(), false);
        assert.deepEqual(await page.locator('[id="langUk"], [id="langRu"]').evaluateAll(elements => elements.map(element => element.id)), ['langUk', 'langRu']);
        assert.match(await page.locator('#apc-settings-panel').textContent(), /Мова інтерфейсу \/ Язык интерфейса/);
        assert.equal(await page.locator('#testStd').count(), 1);
        assert.equal(await page.locator('#testAfk').count(), 1);
        ok('Compact settings place Ukrainian first and retain both sound controls');

        await page.click('[data-permission-browser="edge"]');
        for (const address of ['edge://settings/content/mediaAutoplay', 'edge://settings/system/managePerformance', 'http://172.23.255.204']) {
            await page.locator(`[data-copy-address="${address}"]`).click();
        }
        assert.deepEqual(await page.evaluate(() => copiedValues), ['edge://settings/content/mediaAutoplay', 'edge://settings/system/managePerformance', 'http://172.23.255.204']);
        ok('Edge autoplay and active-site addresses copy correctly');

        await page.click('[data-permission-browser="firefox"]');
        assert.equal(await page.locator('[data-copy-address="about:preferences#privacy"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address="about:unloads"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address^="edge:"]').count(), 0);
        await page.click('[data-permission-browser="chrome"]');
        assert.equal(await page.locator('[data-copy-address="chrome://settings/content/sound"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address="chrome://settings/performance"]').count(), 1);
        await page.click('[data-permission-browser="chrome"]');
        assert.equal(await page.locator('#apc-permission-guide').isVisible(), false);
        ok('Firefox and Chrome guides switch and collapse');

        await page.click('[data-permission-browser="edge"]');
        await page.evaluate(() => {
            Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true });
            document.execCommand = command => {
                if (command !== 'copy') return false;
                copiedValues.push(document.querySelector('body > textarea').value);
                return true;
            };
        });
        await page.locator('[data-copy-address="edge://settings/system/managePerformance"]').click();
        assert.equal(await page.evaluate(() => copiedValues.at(-1)), 'edge://settings/system/managePerformance');
        assert.equal(await page.locator('body > textarea').count(), 0);
        await page.evaluate(() => { document.querySelector('#apc-settings-panel').scrollTop = 0; });
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-settings.png') });
        ok('HTTP clipboard fallback works in the Ukrainian interface');

        const labels = ['Kosm12-UPS2-39 (172.23.62.101)', 'Jonsa7-UPS2-28 (172.23.61.181)', 'Hmlni3-UPS1-07 (172.23.60.100)', 'Omel15-UPS2-37 (172.23.62.69)'];
        await page.evaluate(labels => {
            const history = {};
            for (let index = 0; index < 100; index++) history['alarm' + index] = {
                parsedAt: index, deviceLabel: labels[index % labels.length],
                description: "Связь с '" + labels[index % labels.length] + "' разорвана.",
                startTime: '16.07.2026 21:17:03', isRead: true
            };
            apcUiTest.setHistory(history);
        }, labels);
        const widget = await page.locator('#apc-monitor-widget').boundingBox();
        assert(widget.y >= 0 && widget.y + widget.height <= 900);
        const panelScroll = await page.locator('#apc-settings-panel').evaluate(element => ({ height: element.clientHeight, full: element.scrollHeight }));
        assert(panelScroll.full > panelScroll.height);
        async function singleLine(selector) {
            const lineCounts = await page.locator(selector).evaluateAll(elements => elements.map(element => {
                const range = document.createRange();
                range.selectNodeContents(element);
                return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
            }));
            assert(lineCounts.length > 0 && lineCounts.every(count => count === 1), selector + ': ' + lineCounts);
        }
        await singleLine('.ignore-btn');
        await singleLine('#apc-settings-panel tbody td:first-child');
        await singleLine('#apc-settings-panel tbody td:nth-child(2)');
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-history.png') });
        await page.locator('.ignore-btn').last().scrollIntoViewIfNeeded();
        assert(await page.locator('#apc-settings-panel').evaluate(element => element.scrollTop > 0));
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflowY), 'hidden');
        assert.equal(await page.locator('#apc-timer-btn').isVisible(), true);
        await page.click('#apc-history-btn');
        assert(await page.locator('#apc-settings-panel').evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 2));
        ok('Realistic history keeps date, Label and hide buttons on one line and scrolls inside the viewport');

        await page.evaluate(labels => apcUiTest.setRules(labels.map(label => ({ label, text: 'Связь с устройством разорвана' }))), labels);
        await singleLine('.del-rule-btn');
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-filters.png') });
        ok('Filter delete buttons remain on one line with realistic Label lengths');

        await page.setViewportSize({ width: 360, height: 360 });
        await page.evaluate(labels => {
            const history = {};
            for (let index = 0; index < 100; index++) history[index] = {
                parsedAt: index, deviceLabel: labels[index % labels.length], startTime: '16.07.2026 21:17:03', description: 'Battery alarm', isRead: true
            };
            apcUiTest.setHistory(history);
        }, labels);
        const small = await page.locator('#apc-monitor-widget').boundingBox();
        assert(small.x >= 0 && small.x + small.width <= 360 && small.y >= 0 && small.y + small.height <= 360);
        assert(await page.locator('#apc-settings-panel').evaluate(element => element.scrollWidth > element.clientWidth));
        await page.locator('.ignore-btn').last().scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => window.scrollY), 0);
        await singleLine('.ignore-btn');
        await page.click('#apc-timer-btn');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-mode-btn').isVisible(), false);
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-expanded'), 'false');
        assert.deepEqual(errors, []);
        ok('Small windows contain the entire widget, scroll tables horizontally and keep close controls usable');
        console.log(JSON.stringify({ passed, errors }, null, 2));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
