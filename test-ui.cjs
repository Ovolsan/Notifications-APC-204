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
        setRules(value) { muteRules = value; activeTab = 'rules'; renderModal(); },
        pause(value) { clearTimeout(idleTimeout); isPaused = value; updateDebug(); }
    };
})();`);
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // Site-wide table/button styles must not break the widget's cell layout.
        res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>APC UI fixture</title>
            <style>html,body{overflow:hidden}body{background:#181a1b}table{font-size:18px;table-layout:fixed}
            td{word-break:break-all;overflow-wrap:anywhere}button{white-space:normal;font-size:16px;line-height:1.5;padding:10px 20px}</style>
            <body><h1 style="color:#ddd">APC test page</h1><button id="operator">Operator</button></body>`);
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
        assert.match(await page.locator('#apc-timer-btn').getAttribute('title'), /Таймер: [45]:\d{2}/);
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('data-paused'), 'false');
        assert.match(await page.locator('#apc-history-btn').textContent(), /Історія/);
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-settings-btn').isVisible(), false);
        const closed = await page.locator('#apc-monitor-widget').boundingBox();
        assert.equal(closed.x, 0);
        assert.equal(closed.y + closed.height, 900);
        assert.equal(closed.width, 48);
        assert.equal(await page.locator('.apc-eye-open').first().evaluate(element => getComputedStyle(element).animationDuration), '8s');
        // Check actual SVG geometry at animation phases, rather than only the CSS name.
        const poses = await page.evaluate(async () => {
            const svg = document.querySelector('.apc-timer-eyes');
            const animations = svg.getAnimations({ subtree: true });
            for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
            const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const measure = () => ({
                eyes: Array.from(svg.querySelectorAll('.apc-eye-open')).map(eye => {
                    const white = eye.querySelector('ellipse').getBoundingClientRect();
                    const pupil = eye.querySelector('.apc-eye-pupil').getBoundingClientRect();
                    return { height: white.height, offset: pupil.x + pupil.width / 2 - white.x - white.width / 2 };
                }),
                lidOpacity: Number(getComputedStyle(svg.querySelector('.apc-eye-closed')).opacity)
            });
            const pose = async (look, blink) => {
                for (const animation of animations) {
                    animation.currentTime = animation.animationName === 'apc-eye-look' ? look : blink;
                }
                await frame();
                return measure();
            };
            const center = await pose(0, 0);
            const left = await pose(4000, 0);
            const right = await pose(8400, 0);
            const blink = await pose(0, 1200);
            const reopened = await pose(0, 1600);
            await pose(0, 0);
            return { center, left, right, blink, reopened };
        });
        for (const eye of poses.center.eyes) assert(Math.abs(eye.offset) < .1);
        for (const eye of poses.left.eyes) assert(eye.offset < -1.9);
        for (const eye of poses.right.eyes) assert(eye.offset > 1.9);
        assert(Math.abs(poses.left.eyes[0].offset - poses.left.eyes[1].offset) < .1);
        assert(Math.abs(poses.right.eyes[0].offset - poses.right.eyes[1].offset) < .1);
        for (let i = 0; i < 2; i++) {
            assert(poses.blink.eyes[i].height < poses.center.eyes[i].height * .05);
            assert(Math.abs(poses.reopened.eyes[i].height - poses.center.eyes[i].height) < .1);
        }
        assert.equal(poses.blink.lidOpacity, 1);
        assert.equal(poses.reopened.lidOpacity, 0);
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-timer.png') });
        await page.evaluate(() => {
            for (const animation of document.querySelector('.apc-timer-eyes').getAnimations({ subtree: true })) animation.play();
        });
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => document.querySelector('.apc-timer-eyes').getAnimations({ subtree: true })
            .every(animation => animation.playState === 'running' && animation.currentTime > 100)), true);
        ok('Pupils stay centered or move together left and right; eyelids close completely, reopen and animate in real time');
        await page.evaluate(() => apcUiTest.pause(true));
        assert.equal(await page.locator('.apc-eye-closed').evaluate(element => getComputedStyle(element).opacity), '1');
        assert.equal(await page.locator('.apc-eye-open').first().evaluate(element => getComputedStyle(element).animationName), 'none');
        assert.equal(await page.locator('.apc-eye-pupil').first().evaluate(element => getComputedStyle(element).animationName), 'none');
        await page.evaluate(() => apcUiTest.pause(false));
        await page.emulateMedia({ reducedMotion: 'reduce' });
        assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion:reduce)').matches), true);
        assert.equal(await page.locator('.apc-eye-open').first().evaluate(element => getComputedStyle(element).animationName), 'apc-eye-blink');
        assert.equal(await page.locator('.apc-eye-pupil').first().evaluate(element => getComputedStyle(element).animationName), 'apc-eye-look');
        assert.equal(await page.evaluate(() => document.querySelector('.apc-timer-eyes').getAnimations({ subtree: true }).length), 5);
        // Observe real animation frames, without setting currentTime or advancing a test clock.
        await page.waitForFunction(() => {
            const eye = document.querySelector('.apc-eye-open > ellipse');
            return eye.getBoundingClientRect().height < 1;
        }, null, { timeout: 3000 });
        await page.waitForFunction(() => {
            const eye = document.querySelector('.apc-eye-open');
            const white = eye.querySelector('ellipse').getBoundingClientRect();
            const pupil = eye.querySelector('.apc-eye-pupil').getBoundingClientRect();
            return white.height > 13 && pupil.x + pupil.width / 2 - white.x - white.width / 2 < -1.2;
        }, null, { timeout: 5000 });
        assert.equal(await page.locator('#apc-control-dock').evaluate(element => getComputedStyle(element.querySelector('.apc-navigation')).transitionDuration), '0.28s, 0.2s, 0.28s, 0s');
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        ok('Real blinking and gaze movement remain visible with reduced motion enabled; navigation retains its slide animation');

        await page.hover('#apc-timer-btn');
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.apc-mode-overlay')).opacity === '1');
        assert.equal(await page.locator('#apc-navigation').getAttribute('aria-hidden'), 'false');
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-pressed'), 'false');
        assert.equal(await page.locator('.apc-sun-icon').isVisible(), true);
        assert.equal(await page.locator('.apc-moon-icon').isVisible(), false);
        assert.equal(await page.locator('.apc-sound-warning').isVisible(), false);
        await page.click('#apc-timer-btn');
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.evaluate(() => localStorage.spa_night_mode), 'true');
        assert.equal(await page.locator('.apc-sun-icon').isVisible(), false);
        assert.equal(await page.locator('.apc-moon-icon').isVisible(), true);
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        await page.click('#apc-timer-btn');
        assert.equal(await page.evaluate(() => localStorage.spa_night_mode), 'false');
        await page.waitForFunction(() => document.querySelector('#apc-navigation').getBoundingClientRect().width === 108);
        await page.locator('#apc-monitor-widget').screenshot({ path: path.join(__dirname, 'preview-timer-hover.png') });
        ok('Hover reveals the current sound mode and sliding navigation; eye clicks switch mode without opening a panel');

        await page.click('#apc-history-btn');
        assert.equal(await page.locator('#apc-history-btn').getAttribute('data-current'), 'true');
        assert.match(await page.locator('#apc-history-btn').getAttribute('title'), /Закрити панель і кнопки/);
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
        await page.click('#apc-rules-btn');
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
        await page.click('#apc-history-btn');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-navigation').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-pressed'), 'false');
        await page.mouse.move(250, 100);
        await page.click('#operator');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'apc-timer-btn');
        assert.equal(await page.locator('#apc-navigation').getAttribute('aria-hidden'), 'false');
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), true);
        await page.click('#apc-settings-btn');
        await page.locator('#langUk').press('Escape');
        assert.equal(await page.locator('#apc-settings-panel').isVisible(), false);
        assert.equal(await page.locator('#apc-navigation').getAttribute('aria-hidden'), 'true');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'apc-timer-btn');
        ok('The active section closes the whole panel and dock; keyboard entry and Escape work');
        const touch = await browser.newPage({ viewport: { width: 390, height: 600 }, isMobile: true, hasTouch: true });
        touch.on('pageerror', error => errors.push(error.message));
        await touch.goto(`http://127.0.0.1:${server.address().port}/#deviceGroups`);
        await touch.evaluate(() => {
            window.RTCPeerConnection = undefined;
            window.Notification = undefined;
            window.GM_xmlhttpRequest = options => queueMicrotask(options.onerror);
        });
        await touch.addScriptTag({ content: source });
        assert.equal(await touch.locator('#apc-navigation').getAttribute('aria-hidden'), 'false');
        await touch.locator('#apc-history-btn').tap();
        assert.equal(await touch.locator('#apc-settings-panel').isVisible(), true);
        await touch.locator('#apc-history-btn').tap();
        assert.equal(await touch.locator('#apc-settings-panel').isVisible(), false);
        await touch.close();
        ok('Touch screens expose section buttons without requiring hover');
        assert.deepEqual(errors, []);
        ok('Small windows contain the entire widget, scroll tables horizontally and keep close controls usable');
        console.log(JSON.stringify({ passed, errors }, null, 2));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
