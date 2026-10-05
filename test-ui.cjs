const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

async function main() {
    const source = fs.readFileSync(path.join(__dirname, 'APC-204-Alarm-Reloader.user.js'), 'utf8');
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APC UI fixture</title><body style="background:#f5f5f5"><h1>APC test page</h1></body>');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/#deviceGroups`);
        await page.evaluate(() => {
            window.RTCPeerConnection = undefined;
            Object.defineProperty(window, 'Notification', { value: undefined });
            // Copy tests record payloads in the fixture; the user's clipboard is untouched.
            window.copiedValues = [];
            Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => copiedValues.push(value) }, configurable: true });
        });
        await page.addScriptTag({ content: source });
        assert.match(await page.locator('#apc-timer-btn').textContent(), /🔄 [45]:\d{2}/);
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-settings-btn').isVisible(), false);
        const closed = await page.locator('#apc-monitor-widget').boundingBox();
        assert(closed.x < 3 && closed.y > 800);
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-timer.png') });
        console.log('PASS Compact five-minute timer appears at the bottom left');

        await page.click('#apc-timer-btn');
        await page.click('#apc-settings-btn');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), true);
        assert.equal(await page.locator('[data-permission-browser]').count(), 3);
        assert.equal(await page.locator('#apc-permission-guide').isVisible(), false);
        const panel = await page.locator('#apc-settings-panel').boundingBox();
        assert(panel.width <= 450 && panel.height <= 541);
        assert.equal(await page.locator('#testStd').count(), 1);
        assert.equal(await page.locator('#testAfk').count(), 1);
        console.log('PASS Inline settings preserve sound controls and hide instructions until requested');

        await page.click('[data-permission-browser="edge"]');
        assert.equal(await page.locator('#apc-permission-guide').isVisible(), true);
        for (const address of ['edge://settings/content/mediaAutoplay', 'edge://settings/system/managePerformance', 'http://172.23.255.204']) {
            await page.locator(`[data-copy-address="${address}"]`).click();
        }
        assert.deepEqual(await page.evaluate(() => copiedValues), ['edge://settings/content/mediaAutoplay', 'edge://settings/system/managePerformance', 'http://172.23.255.204']);
        console.log('PASS Edge autoplay, active-site settings and APC URL copy the correct addresses');

        await page.click('[data-permission-browser="firefox"]');
        assert.equal(await page.locator('[data-copy-address="about:preferences#privacy"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address="about:unloads"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address^="edge:"]').count(), 0);
        await page.click('[data-permission-browser="chrome"]');
        assert.equal(await page.locator('[data-copy-address="chrome://settings/content/sound"]').count(), 1);
        assert.equal(await page.locator('[data-copy-address="chrome://settings/performance"]').count(), 1);
        await page.click('[data-permission-browser="chrome"]');
        assert.equal(await page.locator('#apc-permission-guide').isVisible(), false);
        console.log('PASS Firefox and Chrome guides replace each other and can be collapsed');

        await page.click('#langUk');
        assert.match(await page.locator('[data-permission-browser="edge"]').textContent(), /Дозволи/);
        assert.match(await page.locator('#apc-settings-btn').textContent(), /Налаштування/);
        await page.click('[data-permission-browser="edge"]');
        assert.match(await page.locator('#apc-permission-guide').textContent(), /Завжди зберігати ці сайти активними/);
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
        console.log('PASS Ukrainian labels and HTTP clipboard fallback work');

        await page.evaluate(() => { document.querySelector('#apc-settings-panel').scrollTop = 0; });
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-settings.png') });
        await page.setViewportSize({ width: 360, height: 740 });
        const smallPanel = await page.locator('#apc-settings-panel').boundingBox();
        assert(smallPanel.x >= 0 && smallPanel.x + smallPanel.width <= 360);
        await page.click('#apc-timer-btn');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-mode-btn').isVisible(), false);
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-expanded'), 'false');
        assert.deepEqual(errors, []);
        console.log('PASS Panel fits narrow screens, closes cleanly and emits no JavaScript errors');
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
