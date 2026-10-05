const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const source = fs.readFileSync(path.join(__dirname, 'APC-204-Alarm-Reloader.user.js'), 'utf8');
// Test hooks are added only to the in-memory test copy, never to the delivered script.
const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.apcTest = {
        parse: checkAndParseAlarms,
        guard: backgroundGuard,
        state: () => ({ isPaused, isParsingAlarms, timeLeft, lastActivity, backgroundState, soundState,
            alarms: Object.keys(alarmsCache) }),
        idle: () => { isPaused = false; isModalOpen = false; lastActivity = Date.now() - 20000; },
        menu: value => { isModalOpen = value; },
        time: value => { timeLeft = value; lastTick = Date.now(); }
    };
})();`);

const html = `<!doctype html><meta charset="utf-8"><title>APC isolated test</title>
<button id="operator">Operator action</button><div id="rows"></div>
<script>
window.testPeers = [];
const NativeRTC = window.RTCPeerConnection;
window.RTCPeerConnection = class extends NativeRTC {
  constructor(config) { super(config); window.testPeers.push(this); }
};
// Emulate the unavailable Notifications API on the actual APC HTTP origin.
Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
Object.defineProperty(window, 'speechSynthesis', { value: {
  cancel() {}, speak(utterance) { window.speeches++; window.lastUtterance = utterance; }
} });
window.speeches = 0;
window.testHidden = false;
Object.defineProperty(document, 'hidden', { get() { return window.testHidden; }, configurable: true });
window.addAlarm = id => {
  const row = document.createElement('table');
  row.className = 'listRow';
  row.innerHTML = '<tbody><tr><td><div class="rowTitle-panel" id="' + id + '">' +
    '<a class="header" href="#">Alarm</a></div>' +
    '<div class="rowTitle" id="' + id + '_AlarmDescription">Battery test ' + id + '</div>' +
    '<div class="details" hidden><span class="alarmDetails-label">Hostname</span><span>apc</span>' +
    '<span class="alarmDetails-label">Severity</span><span>Critical</span>' +
    '<span class="alarmDetails-label">Start Time</span><span>2026-09-28T10:00:00Z</span>' +
    '<span class="alarmDetails-label">Label</span><span>UPS ' + id + '</span></div></td></tr></tbody>';
  row.querySelector('a').onclick = e => {
    e.preventDefault();
    row.classList.toggle('listRow-open');
    row.querySelector('.details').hidden = !row.classList.contains('listRow-open');
  };
  document.querySelector('#rows').append(row);
};
addAlarm('alarm1'); addAlarm('alarm2');
</script>`;

async function main() {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${server.address().port}/#deviceGroups`;
    let browser;
    const passed = [];
    const ok = message => { passed.push(message); console.log('PASS ' + message); };
    try {
        browser = await chromium.launch({
            executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
            headless: true
        });
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.goto(url);
        await page.addScriptTag({ content: instrumented });
        await page.waitForFunction(() => apcTest.state().backgroundState === 'active', null, { timeout: 20000 });
        assert.equal(await page.evaluate(() => testPeers.length), 2);
        ok('Real Edge RTC channels open; startup works without Notifications API');

        await page.evaluate(async () => { apcTest.idle(); await apcTest.parse(); });
        let state = await page.evaluate(() => apcTest.state());
        assert.deepEqual(state.alarms, ['alarm1', 'alarm2']);
        assert.equal(state.isPaused, false);
        assert.equal(state.isParsingAlarms, false);
        assert.equal(await page.locator('.listRow-open').count(), 0);
        assert.equal(await page.evaluate(() => speeches), 1);
        assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.spa_alarms_cache)).length), 2);
        ok('Synthetic row clicks do not pause parsing; all alarms saved and announced');

        await page.click('#operator');
        assert.equal((await page.evaluate(() => apcTest.state())).isPaused, true);
        const leave = await page.evaluate(() => {
            apcTest.time(10);
            window.dispatchEvent(new Event('blur'));
            const afterBlur = apcTest.state().timeLeft;
            testHidden = true;
            document.dispatchEvent(new Event('visibilitychange'));
            return { afterBlur, afterBoth: apcTest.state().timeLeft, state: apcTest.state() };
        });
        assert.equal(leave.afterBlur, 130);
        assert.equal(leave.afterBoth, 130);
        assert.equal(leave.state.isPaused, false);
        assert.equal(leave.state.lastActivity, 0);
        ok('Trusted operator input pauses; leaving resumes and adds time only once');

        await page.evaluate(async () => {
            apcTest.menu(true);
            addAlarm('alarm3');
            await apcTest.parse();
        });
        assert.equal((await page.evaluate(() => apcTest.state())).alarms.length, 3);
        ok('Hidden-tab monitoring continues even if the script menu was left open');

        await page.evaluate(async () => {
            testHidden = false;
            document.dispatchEvent(new Event('visibilitychange'));
            apcTest.time(100);
            addAlarm('alarm4');
            await apcTest.parse();
        });
        assert.equal((await page.evaluate(() => apcTest.state())).alarms.length, 3);
        // Wait for actual timer ticks, then verify a visible menu is respected.
        await page.waitForTimeout(1200);
        assert.equal((await page.evaluate(() => apcTest.state())).timeLeft, 100);
        assert.equal(await page.locator('#apc-timer-btn').getAttribute('aria-expanded'), 'true');
        ok('Visible menu pauses both parsing and reload countdown');

        await page.evaluate(() => {
            apcTest.idle();
            addAlarm('alarm5');
            window.partialParse = apcTest.parse();
        });
        await page.waitForFunction(() => document.querySelector('#alarm5').closest('table').classList.contains('listRow-open'));
        await page.click('#operator');
        await page.evaluate(() => partialParse);
        const partial = await page.evaluate(() => ({
            stored: Object.keys(JSON.parse(localStorage.spa_alarms_cache)),
            parsing: apcTest.state().isParsingAlarms
        }));
        assert(partial.stored.includes('alarm4'));
        assert(!partial.stored.includes('alarm5'));
        assert.equal(partial.parsing, false);
        ok('Real user interruption preserves alarms already processed');

        await page.evaluate(() => testPeers[0].close());
        await page.waitForFunction(() => apcTest.state().backgroundState === 'retrying');
        await page.waitForFunction(() => apcTest.state().backgroundState === 'active', null, { timeout: 22000 });
        assert.equal(await page.evaluate(() => testPeers.length), 4);
        assert.equal(await page.evaluate(() => testPeers.slice(0, 2).every(p => p.connectionState === 'closed')), true);
        await page.evaluate(() => { for (let i = 0; i < 5; i++) apcTest.guard.start(); });
        assert.equal(await page.evaluate(() => testPeers.length), 4);
        ok('Broken RTC connection closes old peers, reconnects and avoids duplicate connections');

        await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
        assert.equal(await page.evaluate(() => testPeers.every(p => p.connectionState === 'closed')), true);
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
        await page.waitForFunction(() => apcTest.state().backgroundState === 'active');
        assert.equal(await page.evaluate(() => testPeers.length), 6);
        ok('Page lifecycle releases RTC resources and restores background support');

        const fallback = await browser.newPage();
        fallback.on('pageerror', e => errors.push(e.message));
        await fallback.goto(url);
        await fallback.evaluate(() => { window.RTCPeerConnection = undefined; });
        await fallback.addScriptTag({ content: instrumented });
        assert.equal(await fallback.evaluate(() => apcTest.state().backgroundState), 'unavailable');
        await fallback.evaluate(async () => { apcTest.idle(); await apcTest.parse(); });
        assert.equal((await fallback.evaluate(() => apcTest.state())).alarms.length, 2);
        ok('Unavailable WebRTC does not break monitoring and is reported in the indicator');

        await fallback.evaluate(() => { apcTest.idle(); apcTest.time(0); });
        await fallback.waitForEvent('load', { timeout: 4000 });
        assert.equal(await fallback.evaluate(() => typeof window.apcTest), 'undefined');
        ok('Expired reload countdown reloads the target page');

        const soundPage = await browser.newPage();
        soundPage.on('pageerror', e => errors.push(e.message));
        await soundPage.goto(url);
        await soundPage.evaluate(() => {
            localStorage.setItem('spa_snd_std', 'data:audio/wav;base64,UklGRg==');
            window.audioAttempts = 0;
            window.blockAudio = false;
            window.Audio = class {
                constructor() { this.readyState = 4; }
                play() {
                    audioAttempts++;
                    return blockAudio ? Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) : Promise.resolve();
                }
                pause() {}
                close() {}
            };
        });
        await soundPage.addScriptTag({ content: instrumented });
        await soundPage.evaluate(async () => { apcTest.idle(); await apcTest.parse(); });
        assert.equal(await soundPage.evaluate(() => audioAttempts), 0);
        await soundPage.waitForFunction(() => audioAttempts === 1, null, { timeout: 6500 });
        assert.equal(await soundPage.evaluate(() => localStorage.spa_alarm_sound_pending), undefined);
        await soundPage.evaluate(() => lastUtterance.onend());
        assert.equal(await soundPage.evaluate(() => audioAttempts), 1);
        ok('Hung TTS starts the melody after four seconds, once only');

        await soundPage.evaluate(async () => {
            speechSynthesis.speak = () => { throw new Error('TTS unavailable'); };
            addAlarm('alarm3');
            apcTest.idle();
            await apcTest.parse();
        });
        assert.equal(await soundPage.evaluate(() => audioAttempts), 2);
        ok('Thrown TTS error starts the melody immediately');

        await soundPage.evaluate(async () => {
            blockAudio = true;
            addAlarm('alarm4');
            apcTest.idle();
            await apcTest.parse();
        });
        await soundPage.waitForFunction(() => apcTest.state().soundState === 'blocked');
        assert.equal(await soundPage.evaluate(() => localStorage.spa_alarm_sound_pending), 'true');
        assert.equal(await soundPage.evaluate(() => document.body.textContent.includes('не запустился')), true);
        ok('Autoplay rejection is shown and keeps the alarm pending');

        await soundPage.reload();
        await soundPage.evaluate(() => {
            window.audioAttempts = 0;
            window.blockAudio = true;
            window.Audio = class {
                play() {
                    audioAttempts++;
                    return blockAudio ? Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError')) : Promise.resolve();
                }
                pause() {}
            };
            speechSynthesis.speak = () => { throw new Error('TTS unavailable'); };
        });
        await soundPage.addScriptTag({ content: instrumented });
        await soundPage.waitForFunction(() => apcTest.state().soundState === 'blocked', null, { timeout: 5000 });
        assert.equal(await soundPage.evaluate(() => localStorage.spa_alarm_sound_pending), 'true');
        await soundPage.evaluate(() => { blockAudio = false; });
        await soundPage.click('#operator');
        await soundPage.waitForFunction(() => localStorage.spa_alarm_sound_pending === undefined);
        assert.equal(await soundPage.evaluate(() => audioAttempts), 2);
        ok('Pending alarm survives reload and sounds after real user input');

        await soundPage.evaluate(async () => {
            speechSynthesis.speak = utterance => { window.lastUtterance = utterance; };
            addAlarm('alarm5');
            apcTest.idle();
            await apcTest.parse();
        });
        assert.equal(await soundPage.evaluate(() => audioAttempts), 2);
        await soundPage.evaluate(() => lastUtterance.onend());
        await soundPage.waitForFunction(() => audioAttempts === 3);
        assert.equal(await soundPage.evaluate(() => localStorage.spa_alarm_sound_pending), undefined);
        ok('Normal TTS completion starts the melody in sequence');

        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ browser: browser.version(), passed: passed.length, errors }, null, 2));
    } finally {
        if (browser) await browser.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
