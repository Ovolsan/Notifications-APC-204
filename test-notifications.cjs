const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('C:/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const source = fs.readFileSync(path.join(process.cwd(), 'Notifications APC 204.user.js'), 'utf8');
assert.match(source, /^\/\/ @grant\s+GM_notification$/m);
assert.match(source, /^\/\/ @grant\s+window\.focus$/m);
const instrumented = source.replace(/\}\)\(\);\s*$/, `
    window.apcNotificationTest = {
        parse: checkAndParseAlarms,
        idle() { clearTimeout(idleTimeout); isPaused = false; lastActivity = Date.now() - 20000; },
        state: () => ({ notification: getSystemNotificationState(), alarms: Object.keys(alarmsCache),
            isParsingAlarms, pendingAlarmSound, isModalOpen, soundState })
    };
})();`);

function alarm(id, label) {
    return `<table class="listRow listRow-open"><tbody><tr><td>
        <div class="rowTitle-panel" id="${id}"><a class="header">Alarm</a></div>
        <div class="rowTitle" id="${id}_AlarmDescription">Battery must be replaced</div>
        <span class="alarmDetails-label">Hostname</span><span>APC</span>
        <span class="alarmDetails-label">Severity</span><span>Critical</span>
        <span class="alarmDetails-label">Start Time</span><span>2026-10-05T17:00:00Z</span>
        <span class="alarmDetails-label">Label</span><span>${label}</span></td></tr></tbody></table>`;
}
const html = '<!doctype html><meta charset="utf-8"><title>APC notifications fixture</title><body>' +
    alarm('alarm1', 'UPS-204-1') + alarm('alarm2', 'UPS-204-2') + '</body>';

async function main() {
    let browser;
    const contexts = [];
    const errors = [];
    let passed = 0;
    const ok = message => { passed++; console.log('PASS ' + message); };
    try {
        browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
        async function fixture({ manager = 'ok', native = 'absent', secure = false, muted = false, lang = 'uk', withAudio = false, deferAudio = false } = {}) {
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            contexts.push(context);
            // Intercept the APC URL completely; the actual APC server is never contacted.
            await context.route('**/*', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: html }));
            const page = await context.newPage();
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`${secure ? 'https' : 'http'}://172.23.255.204/desktop/#deviceGroups`);
            assert.equal(await page.evaluate(() => window.isSecureContext), secure);
            await page.evaluate(({ manager, native, muted, lang, withAudio, deferAudio }) => {
                window.RTCPeerConnection = undefined;
                window.GM_xmlhttpRequest = options => queueMicrotask(options.onerror);
                window.managerCalls = [];
                window.nativeCalls = [];
                window.nativeInstances = [];
                window.permissionRequests = 0;
                window.speeches = 0;
                window.speechCancels = 0;
                window.focusCalls = 0;
                window.preventedClicks = 0;
                window.audioAttempts = 0;
                window.audioPauses = 0;
                window.audioInstances = [];
                window.fireSpeechEndOnCancel = false;
                window.focus = () => { focusCalls++; };
                window.Audio = class {
                    constructor() { audioInstances.push(this); }
                    play() {
                        audioAttempts++;
                        return deferAudio ? new Promise(resolve => { window.resolveAudioPlay = resolve; }) : Promise.resolve();
                    }
                    pause() { audioPauses++; }
                };
                if (withAudio) localStorage.setItem('spa_snd_std', 'data:audio/wav;base64,UklGRg==');
                if (manager !== 'absent') window.GM_notification = details => {
                    managerCalls.push(details);
                    if (manager === 'throw') throw new Error('Extension notifications disabled');
                    if (manager === 'reject') return Promise.reject(new Error('Extension request failed'));
                };
                if (native === 'absent') Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
                else {
                    window.nativePermission = native === 'throw' ? 'granted' : native;
                    window.Notification = class {
                        static get permission() { return nativePermission; }
                        static requestPermission() {
                            permissionRequests++;
                            return Promise.resolve().then(() => { nativePermission = 'granted'; return 'granted'; });
                        }
                        constructor(title, options) {
                            if (native === 'throw') throw new Error('Native notification failed');
                            nativeCalls.push({ title, ...options });
                            nativeInstances.push(this);
                        }
                    };
                }
                Object.defineProperty(window, 'speechSynthesis', { value: {
                    cancel() {
                        speechCancels++;
                        if (fireSpeechEndOnCancel && window.lastUtterance) lastUtterance.onend();
                    },
                    speak(utterance) { speeches++; window.lastUtterance = utterance; }
                }, configurable: true });
                localStorage.setItem('spa_lang', lang);
                if (muted) localStorage.setItem('spa_mute_rules', JSON.stringify([{ label: 'UPS-204-1', text: 'Battery' }]));
            }, { manager, native, muted, lang, withAudio, deferAudio });
            await page.addScriptTag({ content: instrumented });
            return page;
        }
        const parse = page => page.evaluate(async () => { apcNotificationTest.idle(); await apcNotificationTest.parse(); });

        const http = await fixture();
        assert.equal((await http.evaluate(() => apcNotificationTest.state())).notification, 'manager');
        await parse(http);
        const notifications = await http.evaluate(() => managerCalls);
        assert.equal(notifications.length, 2);
        assert.equal(notifications[0].title, 'Тривога: Critical');
        assert.match(notifications[0].text, /Battery must be replaced\nLabel: UPS-204-1\nЧас:/);
        assert.equal(notifications[0].silent, true);
        assert.equal(notifications[0].timeout, 0);
        assert.equal(notifications[0].highlight, false);
        assert.equal(await http.evaluate(() => typeof managerCalls[0].onclick), 'function');
        assert.equal(await http.evaluate(() => typeof managerCalls[0].ondone), 'function');
        assert.match(notifications[0].tag, /^apc-204-alarm1-/);
        assert.notEqual(notifications[0].tag, notifications[1].tag);
        assert.equal(await http.evaluate(() => nativeCalls.length + permissionRequests), 0);
        assert.equal(await http.evaluate(() => speeches), 1);
        ok('APC HTTP origin sends both localized system notifications through Tampermonkey without site permissions');

        await parse(http);
        assert.equal(await http.evaluate(() => managerCalls.length), 2);
        await http.reload();
        // The cached alarms persist, while the notification recorder belongs to this page.
        await http.evaluate(() => {
            window.managerCalls = [];
            window.RTCPeerConnection = undefined;
            window.GM_xmlhttpRequest = options => queueMicrotask(options.onerror);
            window.GM_notification = details => managerCalls.push(details);
            Object.defineProperty(window, 'Notification', { value: undefined, configurable: true });
        });
        await http.addScriptTag({ content: instrumented });
        await parse(http);
        assert.equal(await http.evaluate(() => managerCalls.length), 0);
        ok('Cached alarms do not create duplicate notifications on polling or page reload');

        const muted = await fixture({ muted: true });
        await parse(muted);
        assert.equal(await muted.evaluate(() => managerCalls.length), 1);
        assert.match(await muted.evaluate(() => managerCalls[0].text), /Label: UPS-204-2/);
        assert.equal((await muted.evaluate(() => apcNotificationTest.state())).alarms.length, 2);
        ok('Muted alarms remain in history but do not send system notifications');

        const panel = await fixture();
        await panel.hover('#apc-timer-btn');
        await panel.click('#apc-settings-btn');
        await panel.evaluate(() => {
            Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await panel.evaluate(() => apcNotificationTest.parse());
        assert.equal((await panel.evaluate(() => apcNotificationTest.state())).isModalOpen, true);
        assert.equal(await panel.evaluate(() => managerCalls.length), 2);
        ok('Notifications still send from a hidden tab with the settings panel open');

        const test = await fixture();
        await test.hover('#apc-timer-btn');
        await test.click('#apc-settings-btn');
        assert.match(await test.locator('#apc-notification-status').textContent(), /готові \(Tampermonkey\)/);
        await test.click('#apc-test-notification');
        assert.equal(await test.evaluate(() => managerCalls.length), 1);
        assert.equal(await test.evaluate(() => managerCalls[0].title), 'APC 204 — тест сповіщення');
        assert.equal((await test.evaluate(() => apcNotificationTest.state())).alarms.length, 0);
        assert.equal((await test.evaluate(() => apcNotificationTest.state())).pendingAlarmSound, false);
        assert.equal(await test.evaluate(() => speeches), 0);
        assert.match(await test.locator('#apc-notification-status').textContent(), /надіслано/);
        await test.click('[data-permission-browser="edge"]');
        assert.match(await test.locator('#apc-permission-guide').textContent(), /Системні сповіщення Windows/);
        ok('Independent notification test updates its status and guide without changing history or playing audio');

        const russian = await fixture({ lang: 'ru' });
        await russian.hover('#apc-timer-btn');
        await russian.click('#apc-settings-btn');
        assert.equal(await russian.locator('#apc-test-notification').textContent(), 'Тест уведомления');
        await russian.click('#apc-test-notification');
        assert.equal(await russian.evaluate(() => managerCalls[0].title), 'APC 204 — тест уведомления');
        ok('Russian test notification and status have complete fallback translations');

        const native = await fixture({ manager: 'absent', native: 'granted', secure: true });
        await parse(native);
        assert.equal(await native.evaluate(() => nativeCalls.length), 2);
        assert.equal(await native.evaluate(() => nativeCalls[0].requireInteraction), true);
        assert.equal(await native.evaluate(() => nativeCalls[0].silent), true);
        ok('Secure pages retain the native Notifications API fallback');

        const permission = await fixture({ manager: 'absent', native: 'default', secure: true });
        assert.equal((await permission.evaluate(() => apcNotificationTest.state())).notification, 'permission');
        // Open a panel without a trusted click, keeping the permission prompt for the test button.
        await permission.evaluate(() => document.querySelector('#apc-settings-btn').click());
        await permission.click('#apc-test-notification');
        await permission.waitForFunction(() => nativeCalls.length === 1);
        assert.equal(await permission.evaluate(() => permissionRequests), 1);
        ok('Explicit native notification test requests permission once and then sends the test');

        const fallback = await fixture({ manager: 'throw', native: 'granted', secure: true });
        await parse(fallback);
        assert.equal(await fallback.evaluate(() => nativeCalls.length), 2);
        assert.equal(await fallback.evaluate(() => speeches), 1);
        assert.equal((await fallback.evaluate(() => apcNotificationTest.state())).notification, 'sent');
        ok('Extension errors fall back to native notifications when permitted');

        for (const manager of ['throw', 'reject']) {
            const failed = await fixture({ manager });
            await parse(failed);
            await failed.waitForFunction(() => apcNotificationTest.state().notification === 'failed');
            assert.equal((await failed.evaluate(() => apcNotificationTest.state())).alarms.length, 2);
            assert.equal((await failed.evaluate(() => apcNotificationTest.state())).isParsingAlarms, false);
            assert.equal(await failed.evaluate(() => speeches), 1);
            assert.equal(await failed.evaluate(() => Object.keys(JSON.parse(localStorage.spa_alarms_cache)).length), 2);
            assert.match(await failed.locator('#apc-timer-btn').getAttribute('title'), /не вдалося надіслати/);
        }
        ok('Thrown and rejected extension requests report failure while saving alarms and continuing TTS');

        const unavailable = await fixture({ manager: 'absent' });
        await parse(unavailable);
        assert.equal((await unavailable.evaluate(() => apcNotificationTest.state())).notification, 'unavailable');
        assert.equal((await unavailable.evaluate(() => apcNotificationTest.state())).alarms.length, 2);
        assert.equal(await unavailable.evaluate(() => speeches), 1);
        const denied = await fixture({ manager: 'absent', native: 'denied', secure: true });
        await parse(denied);
        assert.equal((await denied.evaluate(() => apcNotificationTest.state())).notification, 'denied');
        assert.equal(await denied.evaluate(() => nativeCalls.length), 0);
        assert.equal(await denied.evaluate(() => permissionRequests), 0);
        const broken = await fixture({ manager: 'absent', native: 'throw', secure: true });
        await parse(broken);
        assert.equal((await broken.evaluate(() => apcNotificationTest.state())).notification, 'failed');
        assert.equal((await broken.evaluate(() => apcNotificationTest.state())).alarms.length, 2);
        ok('Missing API, denied permission and native constructor errors preserve monitoring and show their status');

        const clicked = await fixture({ withAudio: true });
        await parse(clicked);
        assert.equal(await clicked.evaluate(() => audioAttempts), 0);
        assert.equal((await clicked.evaluate(() => apcNotificationTest.state())).pendingAlarmSound, true);
        await clicked.evaluate(() => {
            fireSpeechEndOnCancel = true;
            const oldUtterance = lastUtterance;
            managerCalls[0].onclick({ preventDefault() { preventedClicks++; } });
            // Tampermonkey reports completion after the click as well.
            managerCalls[0].ondone();
            oldUtterance.onend();
            oldUtterance.onerror({ error: 'canceled' });
        });
        assert.equal(await clicked.evaluate(() => focusCalls), 1);
        assert.equal(await clicked.evaluate(() => preventedClicks), 1);
        assert((await clicked.evaluate(() => speechCancels)) >= 2);
        assert.equal((await clicked.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        assert.equal((await clicked.evaluate(() => apcNotificationTest.state())).pendingAlarmSound, false);
        assert.equal(await clicked.evaluate(() => localStorage.getItem('spa_alarm_sound_pending')), null);
        await clicked.waitForTimeout(4300);
        assert.equal(await clicked.evaluate(() => audioAttempts), 0);
        await clicked.click('body', { position: { x: 600, y: 100 } });
        assert.equal(await clicked.evaluate(() => audioAttempts), 0);
        assert.equal(await clicked.evaluate(() => speeches), 1);
        ok('Notification click focuses APC once and cancels TTS, pending retry and delayed melody, including late speech events');

        await clicked.evaluate(markup => document.body.insertAdjacentHTML('beforeend', markup), alarm('alarm3', 'UPS-204-3'));
        await parse(clicked);
        assert.equal(await clicked.evaluate(() => managerCalls.length), 3);
        assert.equal(await clicked.evaluate(() => speeches), 2);
        await clicked.evaluate(() => lastUtterance.onend());
        await clicked.waitForFunction(() => apcNotificationTest.state().soundState === 'playing');
        assert.equal(await clicked.evaluate(() => audioAttempts), 1);
        ok('A new alarm after silencing a notification still produces its normal notification, TTS and melody');

        const dismissed = await fixture({ withAudio: true });
        await parse(dismissed);
        await dismissed.evaluate(() => lastUtterance.onend());
        await dismissed.waitForFunction(() => apcNotificationTest.state().soundState === 'playing');
        await dismissed.evaluate(() => {
            const oldAudio = audioInstances[0];
            managerCalls[0].ondone();
            oldAudio.onerror();
            oldAudio.onended();
        });
        assert.equal(await dismissed.evaluate(() => focusCalls), 0);
        assert.equal(await dismissed.evaluate(() => audioPauses), 1);
        assert.equal((await dismissed.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        assert.equal((await dismissed.evaluate(() => apcNotificationTest.state())).pendingAlarmSound, false);
        assert.equal(await dismissed.evaluate(() => localStorage.getItem('spa_alarm_sound_pending')), null);
        ok('Closing a notification stops the current melody without focusing APC; late audio events cannot restore the pending alarm');

        const deferred = await fixture({ withAudio: true, deferAudio: true });
        await parse(deferred);
        await deferred.evaluate(() => {
            lastUtterance.onend();
            managerCalls[0].ondone();
            resolveAudioPlay();
        });
        assert.equal(await deferred.evaluate(() => audioPauses), 1);
        assert.equal(await deferred.evaluate(() => focusCalls), 0);
        assert.equal((await deferred.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        ok('A late Audio.play resolution after dismissal does not restart playback or report the alarm as playing');

        const nativeClicked = await fixture({ manager: 'absent', native: 'granted', secure: true, withAudio: true });
        await parse(nativeClicked);
        await nativeClicked.evaluate(() => {
            nativeInstances[0].onclick(new Event('click', { cancelable: true }));
            nativeInstances[0].onclose();
            lastUtterance.onend();
        });
        assert.equal(await nativeClicked.evaluate(() => focusCalls), 1);
        assert.equal(await nativeClicked.evaluate(() => audioAttempts), 0);
        assert.equal((await nativeClicked.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        const nativeClosed = await fixture({ manager: 'absent', native: 'granted', secure: true, withAudio: true });
        await parse(nativeClosed);
        await nativeClosed.evaluate(() => lastUtterance.onend());
        await nativeClosed.waitForFunction(() => apcNotificationTest.state().soundState === 'playing');
        await nativeClosed.evaluate(() => nativeInstances[0].onclose());
        assert.equal(await nativeClosed.evaluate(() => audioPauses), 1);
        assert.equal(await nativeClosed.evaluate(() => focusCalls), 0);
        assert.equal((await nativeClosed.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        ok('Native fallback notifications have matching click and close behavior for speech, melody and focus');

        const focusFailed = await fixture({ withAudio: true });
        await parse(focusFailed);
        await focusFailed.evaluate(() => {
            window.focus = () => { throw new Error('Window focus failed'); };
            managerCalls[0].onclick();
            window.focus = () => Promise.reject(new Error('Window focus rejected'));
            managerCalls[0].onclick();
        });
        assert.equal((await focusFailed.evaluate(() => apcNotificationTest.state())).soundState, 'idle');
        assert.equal((await focusFailed.evaluate(() => apcNotificationTest.state())).pendingAlarmSound, false);
        assert.equal(await focusFailed.evaluate(() => audioAttempts), 0);
        ok('Speech is silenced even if window focus throws or rejects; no unhandled errors escape');

        assert.deepEqual(errors, []);
        console.log(JSON.stringify({ browser: browser.version(), passed, errors }, null, 2));
    } finally {
        for (const context of contexts) await context.close();
        if (browser) await browser.close();
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
