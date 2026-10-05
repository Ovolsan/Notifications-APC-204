// ==UserScript==
// @name         Notifications APC 204
// @namespace    http://tampermonkey.net/
// @version      20261005.3
// @description  Історія тривог, фільтри, налаштування, мови UK/RU та власні мелодії сповіщень.
// @match        http://172.23.255.204/desktop/*
// @updateURL    https://raw.githubusercontent.com/Ovolsan/Notifications-APC-204/main/Notifications%20APC%20204.user.js
// @downloadURL  https://raw.githubusercontent.com/Ovolsan/Notifications-APC-204/main/Notifications%20APC%20204.user.js
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function() {
    'use strict';

    // ===== ЗАЩИТА ОТ ПОВТОРНОГО ЗАПУСКА =====
    if (window.__SPA_ALARM_RELOADER_RUNNING__) {
        console.log('[APC 204 Reloader] Скрипт уже запущен, повторный запуск отменён.');
        return;
    }
    window.__SPA_ALARM_RELOADER_RUNNING__ = true;
    // ========================================

    const TARGET_URL = 'http://172.23.255.204/desktop/#deviceGroups';
    const TARGET_HASH = '#deviceGroups';

    const TIMER_MAX_SEC = 5 * 60;
    const ADD_TIME_ON_BLUR_SEC = 2 * 60;

    let timeLeft = TIMER_MAX_SEC;
    let isPaused = false;
    let isModalOpen = false;
    let idleTimeout;
    let hasLeftPage = false;
    let backgroundState = 'connecting';
    let lastTick = Date.now();
    let hadClicks = false;   // были ли клики во время последней активности
    let lastActivity = Date.now();   // время последнего взаимодействия с страницей

    let alarmsCache = {};
    let muteRules = [];

    let standardAudioData = localStorage.getItem('spa_snd_std') || null;
    let afkAudioData = localStorage.getItem('spa_snd_afk') || null;
    let isNightMode = localStorage.getItem('spa_night_mode') === 'true';
    let currentLang = localStorage.getItem('spa_lang') || 'uk';
    let currentAudio = null;
    let soundAttempt = 0;
    let speechFallbackTimer = null;
    let pendingAlarmSound = localStorage.getItem('spa_alarm_sound_pending') === 'true';
    let soundState = pendingAlarmSound ? 'pending' : 'idle';

    let originalTitle = document.title || "SPA";
    let isTitleBlinking = false;

    let originalFavicon = "/favicon.ico";
    const alertFavicon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23ff8c00"/></svg>';

    const existingIcon = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
    if (existingIcon) originalFavicon = existingIcon.href;

    // Основные переводы: languages/ru.json и languages/uk.json.
    // Встроенный резерв позволяет мониторингу работать без сети.
    const fallbackI18n = {
        "uk": {
            "tabHistory": "Історія тривог",
            "tabRules": "Фільтри (Ігнор)",
            "tabSettings": "Налаштування",
            "historyButton": "🕘 Історія",
            "rulesButton": "🔕 Фільтри",
            "settingsButton": "⚙️ Налаштування",
            "closePanel": "❌ Закрити",
            "permissionsTitle": "Дозволи браузера",
            "permissionsEdge": "Дозволи для Edge",
            "permissionsFirefox": "Дозволи для Firefox",
            "permissionsChrome": "Дозволи для Chrome",
            "copyAddress": "Копіювати",
            "copiedAddress": "Скопійовано ✓",
            "copyFailed": "Виділіть адресу та скопіюйте вручну",
            "siteAddress": "Адреса APC для списку дозволених сайтів",
            "permissionsAfter": "Після зміни дозволів оновіть сторінку APC та натисніть «Тест» біля вибраної мелодії. Внутрішні адреси налаштувань потрібно вставляти в адресний рядок браузера; скрипт не може змінити дозволи сам.",
            "firefoxSoundTitle": "Автовідтворення звуку",
            "firefoxSoundNote": "У Firefox відкрийте «Приватність і безпека» → «Дозволи» → «Автовідтворення» → «Налаштування». Для сайту APC виберіть «Дозволити аудіо та відео». Дозвіл також можна змінити через піктограму автовідтворення біля адреси сторінки.",
            "memoryTitle": "Сон і вивантаження вкладок",
            "firefoxMemoryNote": "Firefox може вивантажувати вкладки за нестачі пам’яті. На сторінці about:unloads можна перевірити стан вкладок. Не вивантажуйте APC вручну; якщо використовуєте розширення для присипляння вкладок, додайте APC до його винятків.",
            "chromeSoundNote": "У Chrome дозвольте сайту APC відтворювати звук. Окремого перемикача автовідтворення, як в Edge, тут немає: запуск також залежить від взаємодії із сайтом. Якщо звук заблоковано, відкрийте налаштування скрипта та натисніть «Тест».",
            "chromeMemoryNote": "У Chrome відкрийте «Продуктивність» → «Завжди зберігати ці сайти активними» та додайте http://172.23.255.204. Цей виняток запобігає деактивації вкладки режимом заощадження пам’яті.",
            "dayMode": "☀️ День (Стандарт)",
            "nightMode": "🌙 Ніч (AFK-мелодія)",
            "close": "Закрити [X]",
            "debugTooltip": "Клікни, щоб відкрити Історію, Фільтри та Налаштування",
            "timerStopped": "Таймер зупинено (Відкрито меню)",
            "timerText": "Таймер",
            "paused": "ПАУЗА",
            "running": "ЙДЕ",
            "newAlarms": "Нові",
            "titleNewAlarms": "🟠 НОВІ ТРИВОГИ",
            "colTime": "Час",
            "colLabel": "Label",
            "colAlarm": "Тривога",
            "colAction": "Дія",
            "emptyHistory": "Історія порожня",
            "inMute": "В ігнорі",
            "hideBtn": "Приховати",
            "noLabelAlert": "Неможливо додати в ігнор без Label.",
            "ignorePrompt": "Ігнор для Label: {0}\nКлючова фраза (без цифр, які змінюються):",
            "colPhrase": "Фраза в описі",
            "emptyRules": "Немає активних фільтрів",
            "delBtn": "Видалити",
            "unknown": "Невідомо",
            "langTitle": "Мова інтерфейсу / Язык интерфейса",
            "stdSoundTitle": "Стандартна мелодія (Денний режим)",
            "stdSoundDesc": "TTS \"Батареї\" + ця мелодія.",
            "afkSoundTitle": "AFK Мелодія (Нічний режим)",
            "afkSoundDesc": "TTS \"Батареї\" + ця мелодія (якщо увімкнено 🌙).",
            "testBtn": "Тест",
            "soundNote": "Файли до 2 МБ. Звук зупиняється кліком по сторінці.",
            "fileSizeError": "Файл >2 МБ!",
            "notifTitle": "Тривога",
            "timeLabel": "Час",
            "chooseFile": "Файл",
            "noFile": "Файл не вибрано",
            "soundLabel": "Звук",
            "sound_pending": "очікує перевірки",
            "sound_playing": "відтворюється",
            "sound_blocked": "не запустився — перевірте автовідтворення Edge",
            "sound_noFile": "мелодію не налаштовано",
            "soundBlockedShort": "🔇 Звук не запустився",
            "soundMissingShort": "🔇 Немає мелодії",
            "autoplayTitle": "Звукові сповіщення — автовідтворення Edge",
            "autoplayNote": "Для надійного звуку після автоматичного перезавантаження дозвольте автовідтворення мультимедіа в Microsoft Edge. Скопіюйте адресу нижче та вставте її в адресний рядок браузера:",
            "autoplaySteps": "Якщо доступний список дозволених сайтів, додайте http://172.23.255.204. Інакше виберіть «Дозволити» в налаштуванні автовідтворення (це налаштування діє для всіх сайтів). Після зміни оновіть сторінку APC та натисніть «Тест» біля вибраної мелодії. Дозвіл на автовідтворення задається в Edge; скрипт не може ввімкнути його сам.",
            "backgroundLabel": "Фон",
            "background_connecting": "підключення",
            "background_active": "підтримку ввімкнено",
            "background_retrying": "повтор підключення",
            "background_unavailable": "захист недоступний",
            "background_stopped": "зупинено",
            "backgroundTitle": "Робота у фоновій вкладці (Microsoft Edge)",
            "backgroundNote": "В Edge відкрийте Налаштування → Система та продуктивність → Продуктивність → «Завжди зберігати ці сайти активними» (у старих версіях — «Ніколи не переводити ці сайти в режим сну») та додайте http://172.23.255.204. Скрипт підтримує фонові таймери, але виняток із режиму сну задається у браузері."
        },
        "ru": {
            "tabHistory": "История тревог",
            "tabRules": "Фильтры (Игнор)",
            "tabSettings": "Настройки",
            "historyButton": "🕘 История",
            "rulesButton": "🔕 Фильтры",
            "settingsButton": "⚙️ Настройки",
            "closePanel": "❌ Закрыть",
            "permissionsTitle": "Разрешения браузера",
            "permissionsEdge": "Разрешения для Edge",
            "permissionsFirefox": "Разрешения для Firefox",
            "permissionsChrome": "Разрешения для Chrome",
            "copyAddress": "Копировать",
            "copiedAddress": "Скопировано ✓",
            "copyFailed": "Выделите адрес и скопируйте вручную",
            "siteAddress": "Адрес APC для списка разрешённых сайтов",
            "permissionsAfter": "После изменения разрешений обновите страницу APC и нажмите «Тест» у выбранной мелодии. Внутренние адреса настроек нужно вставлять в адресную строку браузера; скрипт не может изменить разрешения сам.",
            "firefoxSoundTitle": "Автовоспроизведение звука",
            "firefoxSoundNote": "В Firefox откройте «Приватность и защита» → «Разрешения» → «Автовоспроизведение» → «Параметры». Для сайта APC выберите «Разрешить аудио и видео». Разрешение также можно изменить через значок автовоспроизведения рядом с адресом страницы.",
            "memoryTitle": "Сон и выгрузка вкладок",
            "firefoxMemoryNote": "Firefox может выгружать вкладки при нехватке памяти. На странице about:unloads можно проверить состояние вкладок. Не выгружайте APC вручную; если используете расширение для усыпления вкладок, добавьте APC в его исключения.",
            "chromeSoundNote": "В Chrome разрешите сайту APC воспроизводить звук. Отдельного переключателя автовоспроизведения, как в Edge, здесь нет: запуск также зависит от взаимодействия с сайтом. Если звук заблокирован, откройте настройки скрипта и нажмите «Тест».",
            "chromeMemoryNote": "В Chrome откройте «Производительность» → «Всегда сохранять эти сайты активными» («Завжди зберігати ці сайти активними») и добавьте http://172.23.255.204. Это исключение предотвращает деактивацию вкладки режимом экономии памяти.",
            "dayMode": "☀️ День (Стандарт)",
            "nightMode": "🌙 Ночь (AFK-мелодия)",
            "close": "Закрыть [X]",
            "debugTooltip": "Кликни, чтобы открыть Историю, Фильтры и Настройки",
            "timerStopped": "Таймер остановлен (Открыто меню)",
            "timerText": "Таймер",
            "paused": "ПАУЗА",
            "running": "ИДЕТ",
            "newAlarms": "Нов",
            "titleNewAlarms": "🟠 НОВЫЕ ТРЕВОГИ",
            "colTime": "Время",
            "colLabel": "Label",
            "colAlarm": "Тревога",
            "colAction": "Действие",
            "emptyHistory": "История пуста",
            "inMute": "В игноре",
            "hideBtn": "Скрыть",
            "noLabelAlert": "Нельзя добавить в игнор без Label.",
            "ignorePrompt": "Игнор для Label: {0}\nКлючевая фраза (без цифр, которые меняются):",
            "colPhrase": "Фраза в описании",
            "emptyRules": "Нет активных фильтров",
            "delBtn": "Удалить",
            "unknown": "Неизвестно",
            "langTitle": "Мова інтерфейсу / Язык интерфейса",
            "stdSoundTitle": "Стандартная мелодия (Дневной режим)",
            "stdSoundDesc": "TTS \"Батареи\" + эта мелодия.",
            "afkSoundTitle": "AFK Мелодия (Ночной режим)",
            "afkSoundDesc": "TTS \"Батареи\" + эта мелодия (если включён 🌙).",
            "testBtn": "Тест",
            "soundNote": "Файлы до 2 МБ. Звук останавливается кликом по странице.",
            "fileSizeError": "Файл >2 МБ!",
            "notifTitle": "Тревога",
            "timeLabel": "Время",
            "chooseFile": "Файл",
            "noFile": "Файл не выбран",
            "soundLabel": "Звук",
            "sound_pending": "ожидает проверки",
            "sound_playing": "воспроизводится",
            "sound_blocked": "не запустился — проверьте автовоспроизведение Edge",
            "sound_noFile": "не настроена мелодия",
            "soundBlockedShort": "🔇 Звук не запустился",
            "soundMissingShort": "🔇 Нет мелодии",
            "autoplayTitle": "Звуковые уведомления — автовоспроизведение Edge",
            "autoplayNote": "Для надёжного звука после автоматической перезагрузки разрешите автовоспроизведение мультимедиа в Microsoft Edge. Скопируйте адрес ниже и вставьте его в адресную строку браузера:",
            "autoplaySteps": "Если доступен список разрешённых сайтов, добавьте http://172.23.255.204. Иначе выберите «Разрешить» в настройке автовоспроизведения (эта настройка действует на все сайты). После изменения обновите страницу APC и нажмите «Тест» у выбранной мелодии. Разрешение автовоспроизведения задаётся в Edge; скрипт не может включить его сам.",
            "backgroundLabel": "Фон",
            "background_connecting": "подключение",
            "background_active": "поддержка включена",
            "background_retrying": "повтор подключения",
            "background_unavailable": "защита недоступна",
            "background_stopped": "остановлен",
            "backgroundTitle": "Работа в фоновой вкладке (Microsoft Edge)",
            "backgroundNote": "В Edge откройте Настройки → Система и производительность → Производительность → «Всегда сохранять эти сайты активными» (в старых версиях — «Никогда не переводить эти сайты в спящий режим») и добавьте http://172.23.255.204. Скрипт поддерживает фоновые таймеры, но исключение из сна задаётся в браузере."
        }
    };

    const LANGUAGE_BASE_URL = 'https://raw.githubusercontent.com/Ovolsan/Notifications-APC-204/main/languages/';
    const LANGUAGE_TIMEOUT_MS = 5000;
    const LANGUAGE_MAX_BYTES = 128 * 1024;
    const languageRequests = new Map();
    const loadedLanguages = new Set();
    const i18n = { uk: { ...fallbackI18n.uk }, ru: { ...fallbackI18n.ru } };
    if (!Object.hasOwn(i18n, currentLang)) currentLang = 'uk';

    function validateLanguage(pack, lang) {
        if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new Error('Invalid language JSON');
        const translations = {};
        for (const key of Object.keys(fallbackI18n[lang])) {
            if (!Object.hasOwn(pack, key)) continue;
            const value = pack[key];
            if (typeof value !== 'string' || !value.trim() || value.length > 10000) {
                throw new Error('Invalid translation: ' + key);
            }
            // Старый кеш и ещё не обновлённый JSON не возвращают русский заголовок первым.
            translations[key] = key === 'langTitle' && value === 'Язык интерфейса / Мова інтерфейсу'
                ? fallbackI18n[lang].langTitle : value;
        }
        if (!Object.keys(translations).length) throw new Error('Empty language JSON');
        return translations;
    }

    // Сохранённый перевод доступен сразу, даже без подключения к GitHub.
    for (const lang of Object.keys(i18n)) {
        try {
            const cached = localStorage.getItem('spa_i18n_v1_' + lang);
            if (cached && cached.length <= LANGUAGE_MAX_BYTES) {
                i18n[lang] = { ...fallbackI18n[lang], ...validateLanguage(JSON.parse(cached), lang) };
            }
        } catch (error) {
            console.warn('[APC 204 Reloader] Повреждён кеш перевода:', lang, error);
        }
    }

    function requestLanguage(url) {
        if (typeof GM_xmlhttpRequest === 'function') {
            return new Promise((resolve, reject) => {
                let handle;
                let settled = false;
                const complete = (error, text) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    if (error) reject(error);
                    else resolve(text);
                };
                // Собственный таймер нужен и для режима fetch внутри менеджера.
                const timeout = setTimeout(() => {
                    complete(new Error('Language request timeout'));
                    try { handle?.abort(); } catch (error) { /* Ответ уже отменён. */ }
                }, LANGUAGE_TIMEOUT_MS);
                try {
                    handle = GM_xmlhttpRequest({
                        method: 'GET', url, anonymous: true, timeout: LANGUAGE_TIMEOUT_MS,
                        headers: { Accept: 'application/json' },
                        onload(response) {
                            const text = response.responseText;
                            if (response.status !== 200 || typeof text !== 'string' || text.length > LANGUAGE_MAX_BYTES) {
                                complete(new Error('Language HTTP response: ' + response.status));
                            } else complete(null, text);
                        },
                        onerror: () => complete(new Error('Language network error')),
                        ontimeout: () => complete(new Error('Language request timeout')),
                        onabort: () => complete(new Error('Language request aborted'))
                    });
                } catch (error) {
                    complete(error);
                }
            });
        }
        // Резерв для менеджеров userscript без GM_xmlhttpRequest.
        return (async () => {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), LANGUAGE_TIMEOUT_MS);
            try {
                const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
                if (!response.ok) throw new Error('Language HTTP response: ' + response.status);
                const text = await response.text();
                if (text.length > LANGUAGE_MAX_BYTES) throw new Error('Language file too large');
                return text;
            } finally {
                clearTimeout(timeout);
            }
        })();
    }

    function loadLanguage(lang) {
        if (!Object.hasOwn(fallbackI18n, lang) || loadedLanguages.has(lang)) return Promise.resolve();
        if (languageRequests.has(lang)) return languageRequests.get(lang);
        const request = (async () => {
            try {
                const text = await requestLanguage(LANGUAGE_BASE_URL + lang + '.json?_=' + Date.now());
                const translations = validateLanguage(JSON.parse(text), lang);
                i18n[lang] = { ...fallbackI18n[lang], ...translations };
                loadedLanguages.add(lang);
                try {
                    localStorage.setItem('spa_i18n_v1_' + lang, JSON.stringify(translations));
                } catch (error) {
                    console.warn('[APC 204 Reloader] Перевод загружен, но не сохранён:', error);
                }
                // Запоздавший ответ другого языка не меняет выбранный язык.
                if (currentLang === lang) {
                    if (isModalOpen) renderModal();
                    else updateHeaderLabels();
                    updateDebug();
                }
            } catch (error) {
                console.warn('[APC 204 Reloader] Используется резервный перевод:', lang, error);
            } finally {
                languageRequests.delete(lang);
            }
        })();
        languageRequests.set(lang, request);
        return request;
    }

    function t(key, ...args) {
        const value = i18n[currentLang]?.[key] || fallbackI18n.uk[key] || key;
        return value.replace(/\{(\d+)\}/g, (placeholder, index) =>
            args[index] === undefined ? placeholder : String(args[index]));
    }

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, character => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        })[character]);
    }

    // JSON содержит только текст; разметка в переводах не исполняется.
    function htmlT(key, ...args) {
        return escapeHtml(t(key, ...args));
    }

    function setFavicon(isAlert) {
        let link = document.querySelector('link[rel="icon"]') || document.querySelector('link[rel="shortcut icon"]');
        if (!link) {
            link = document.createElement('link');
            link.rel = 'icon';
            document.head.appendChild(link);
        }
        link.href = isAlert ? alertFavicon : originalFavicon;
    }

    function loadCache() {
        try {
            const loadedCache = JSON.parse(localStorage.getItem('spa_alarms_cache'));
            if (loadedCache && typeof loadedCache === 'object' && !Array.isArray(loadedCache)) {
                alarmsCache = loadedCache;
                Object.values(alarmsCache).forEach(a => {
                    if (a && a.isRead === undefined) a.isRead = true;
                });
            }
            const loadedRules = JSON.parse(localStorage.getItem('spa_mute_rules'));
            if (loadedRules && Array.isArray(loadedRules)) {
                muteRules = loadedRules.filter(r => r.label);
            }
        } catch (e) {
            console.error('[SPA Reloader] Ошибка чтения localStorage', e);
        }
    }
    loadCache();

    function saveCache() {
        localStorage.setItem('spa_alarms_cache', JSON.stringify(alarmsCache));
    }

    function saveMuteRules() {
        localStorage.setItem('spa_mute_rules', JSON.stringify(muteRules));
    }

    // Открытый RTCDataChannel исключает интенсивное ограничение таймеров Chromium.
    // Обе стороны находятся в этой странице, STUN/TURN и медиапотоки не используются.
    // Это НЕ отменяет ручную выгрузку вкладки, политики Edge или сон компьютера.
    function createBackgroundGuard(onStateChange) {
        let connection = null;
        let retryTimer = null;
        let stopped = false;

        function disposeConnection() {
            const old = connection;
            connection = null;
            if (!old) return;
            clearTimeout(old.timeout);
            for (const channel of old.channels) {
                channel.onopen = channel.onclose = channel.onerror = null;
                try { channel.close(); } catch (_) {}
            }
            for (const peer of old.peers) {
                peer.onicecandidate = peer.onconnectionstatechange = null;
                try { peer.close(); } catch (_) {}
            }
        }

        async function start() {
            if (stopped || connection || retryTimer !== null) return;
            if (typeof window.RTCPeerConnection !== 'function') {
                onStateChange('unavailable');
                return;
            }

            const current = { peers: [], channels: [], timeout: null };
            connection = current;
            const isCurrent = () => !stopped && connection === current;
            function fail(error) {
                if (!isCurrent()) return;
                console.warn('[APC 204 Reloader] Фоновая поддержка: повтор через 15 секунд.', error);
                disposeConnection();
                onStateChange('retrying');
                retryTimer = setTimeout(() => {
                    retryTimer = null;
                    start();
                }, 15000);
            }

            onStateChange('connecting');
            try {
                const left = new RTCPeerConnection({ iceServers: [] });
                current.peers.push(left);
                const right = new RTCPeerConnection({ iceServers: [] });
                current.peers.push(right);
                const pendingLeft = [], pendingRight = [];

                function forwardIce(source, destination, pending) {
                    source.onicecandidate = ({ candidate }) => {
                        if (!candidate || !isCurrent()) return;
                        if (destination.remoteDescription) {
                            destination.addIceCandidate(candidate).catch(fail);
                        } else {
                            pending.push(candidate);
                        }
                    };
                }
                forwardIce(left, right, pendingRight);
                forwardIce(right, left, pendingLeft);

                for (const peer of current.peers) {
                    peer.onconnectionstatechange = () => {
                        if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) {
                            fail(new Error(peer.connectionState));
                        }
                    };
                    // negotiated:true создаёт один и тот же канал на обеих сторонах.
                    const channel = peer.createDataChannel('apc-background', { negotiated: true, id: 0 });
                    current.channels.push(channel);
                    channel.onopen = () => {
                        if (isCurrent() && current.channels.every(c => c.readyState === 'open')) {
                            clearTimeout(current.timeout);
                            onStateChange('active');
                        }
                    };
                    channel.onclose = () => fail(new Error('Data channel closed'));
                    channel.onerror = fail;
                }
                current.timeout = setTimeout(() => fail(new Error('Connection timeout')), 25000);

                const offer = await left.createOffer();
                if (!isCurrent()) return;
                await left.setLocalDescription(offer);
                if (!isCurrent()) return;
                await right.setRemoteDescription(left.localDescription);
                for (const candidate of pendingRight.splice(0)) {
                    if (!isCurrent()) return;
                    await right.addIceCandidate(candidate);
                }
                if (!isCurrent()) return;
                const answer = await right.createAnswer();
                if (!isCurrent()) return;
                await right.setLocalDescription(answer);
                if (!isCurrent()) return;
                await left.setRemoteDescription(right.localDescription);
                for (const candidate of pendingLeft.splice(0)) {
                    if (!isCurrent()) return;
                    await left.addIceCandidate(candidate);
                }
            } catch (error) {
                fail(error);
            }
        }

        return {
            start() {
                stopped = false;
                start();
            },
            stop() {
                stopped = true;
                clearTimeout(retryTimer);
                retryTimer = null;
                disposeConnection();
                onStateChange('stopped');
            }
        };
    }

    // --- ЗВУК ---
    function stopCurrentAudio() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio = null;
        }
    }

    function markSoundDelivered() {
        pendingAlarmSound = false;
        localStorage.removeItem('spa_alarm_sound_pending');
    }

    function reportSoundFailure(error) {
        soundState = 'blocked';
        console.warn('[APC 204 Reloader] Звук не запустился:', error);
        updateDebug();
    }

    // Зависший TTS больше не может навсегда задержать мелодию.
    function playAlertSound(audioData = (isNightMode ? afkAudioData : standardAudioData)) {
        const attempt = ++soundAttempt;
        const wasPendingAlarm = pendingAlarmSound;
        stopCurrentAudio();
        clearTimeout(speechFallbackTimer);
        soundState = 'pending';
        updateDebug();

        let finished = false;
        function finishSpeech(spoke) {
            if (finished || attempt !== soundAttempt) return;
            finished = true;
            clearTimeout(speechFallbackTimer);
            speechFallbackTimer = null;

            if (!audioData) {
                if (spoke) {
                    markSoundDelivered();
                    soundState = 'idle';
                } else {
                    soundState = 'noFile';
                    console.warn('[APC 204 Reloader] TTS не запустился и мелодия не настроена.');
                }
                updateDebug();
                return;
            }

            try {
                const audio = new Audio(audioData);
                currentAudio = audio;
                audio.onended = () => {
                    if (attempt !== soundAttempt || currentAudio !== audio) return;
                    currentAudio = null;
                    soundState = 'idle';
                    updateDebug();
                };
                audio.onerror = () => {
                    if (attempt !== soundAttempt) return;
                    if (currentAudio === audio) currentAudio = null;
                    // Иногда декодер сообщает ошибку уже после успешного play().
                    if (wasPendingAlarm) {
                        pendingAlarmSound = true;
                        localStorage.setItem('spa_alarm_sound_pending', 'true');
                    }
                    reportSoundFailure(audio.error || new Error('Ошибка декодирования аудио'));
                };
                Promise.resolve(audio.play()).then(() => {
                    if (attempt !== soundAttempt) return;
                    markSoundDelivered();
                    soundState = 'playing';
                    updateDebug();
                }).catch(error => {
                    if (attempt !== soundAttempt) return;
                    if (currentAudio === audio) currentAudio = null;
                    reportSoundFailure(error);
                });
            } catch (error) {
                reportSoundFailure(error);
            }
        }

        try {
            if (!window.speechSynthesis || typeof window.SpeechSynthesisUtterance !== 'function') {
                finishSpeech(false);
                return;
            }
            speechSynthesis.cancel();
            const utterance = new SpeechSynthesisUtterance('Батареї');
            utterance.lang = currentLang === 'uk' ? 'uk-UA' : 'ru-RU';
            utterance.rate = 0.8;
            utterance.volume = 1;
            utterance.onend = () => finishSpeech(true);
            utterance.onerror = error => {
                console.warn('[APC 204 Reloader] TTS не запустился:', error.error || error);
                finishSpeech(false);
            };
            speechFallbackTimer = setTimeout(() => {
                if (finished || attempt !== soundAttempt) return;
                speechSynthesis.cancel();
                finishSpeech(false);
            }, 4000);
            speechSynthesis.speak(utterance);
        } catch (error) {
            console.warn('[APC 204 Reloader] TTS недоступен:', error);
            finishSpeech(false);
        }
    }

    // Остановка звука по ЛЮБОМУ реальному клику на странице
    document.addEventListener('click', (e) => {
        if (e.isTrusted && currentAudio) {
            stopCurrentAudio();
        }
    }, true);

    // После блокировки автозвука повторяем при следующем настоящем клике.
    document.addEventListener('click', (e) => {
        if (e.isTrusted && pendingAlarmSound && ['blocked', 'noFile'].includes(soundState)) playAlertSound();
    });

    function isMuted(deviceLabel, description) {
        const safeDesc = String(description || '');
        const targetLabel = String(deviceLabel || '');
        for (const rule of muteRules) {
            if (String(rule.label || '') === targetLabel && safeDesc.includes(String(rule.text || ''))) {
                return true;
            }
        }
        return false;
    }

    function getUnreadCount() {
        return Object.values(alarmsCache).filter(a => a && a.isRead === false && !isMuted(a.deviceLabel, a.description)).length;
    }

    function markAllAsRead() {
        let changed = false;
        Object.values(alarmsCache).forEach(a => {
            if (a && a.isRead === false) {
                a.isRead = true;
                changed = true;
            }
        });
        if (changed) {
            saveCache();
            updateStylesAndListeners();
        }
    }

    // На HTTP системные уведомления могут быть недоступны; мониторинг работает дальше.
    if (typeof window.Notification === 'function' && window.isSecureContext &&
        Notification.permission === 'default') {
        const requestNotifications = (event) => {
            if (!event.isTrusted) return;
            document.removeEventListener('click', requestNotifications);
            try {
                Promise.resolve(Notification.requestPermission()).catch(error => {
                    console.warn('[APC 204 Reloader] Уведомления недоступны:', error);
                });
            } catch (error) {
                console.warn('[APC 204 Reloader] Уведомления недоступны:', error);
            }
        };
        document.addEventListener('click', requestNotifications);
    }

    // --- UI ТАЙМЕРА ---
    const debugDiv = document.createElement('div');
    debugDiv.id = 'apc-monitor-widget';
    debugDiv.style.cssText = 'position:fixed; bottom:1.2px; left:1.2px; display:flex; flex-direction:column; align-items:flex-start; gap:0; z-index:9998; font-family:sans-serif; font-size:13px; max-width:calc(100vw - 4px); max-height:calc(100vh - 4px); max-height:calc(100dvh - 4px); min-height:0;';

    const modal = document.createElement('div');
    modal.id = 'apc-settings-panel';
    modal.style.cssText = 'display:none; background:#1a1a1a; color:#ccc; border:0; width:760px; max-width:calc(100vw - 4px); min-height:0; flex:0 1 auto; overflow:auto; overscroll-behavior:contain; box-sizing:border-box; box-shadow:none;';
    const modalContent = document.createElement('div');
    modalContent.style.cssText = 'padding:0; margin:0; font-size:13px;';
    modal.appendChild(modalContent);

    const controlStyle = 'display:none; background:#222; color:#ccc; border:0; border-radius:0; margin:0; padding:5px 8px; cursor:pointer; font:inherit; line-height:1.2; white-space:nowrap; word-break:normal; overflow-wrap:normal; flex-shrink:0; min-height:28px; box-sizing:border-box; align-items:center; justify-content:center;';
    const btnNight = document.createElement('button');
    btnNight.id = 'apc-mode-btn';
    btnNight.type = 'button';
    btnNight.style.cssText = controlStyle;
    btnNight.onclick = () => {
        isNightMode = !isNightMode;
        localStorage.setItem('spa_night_mode', isNightMode);
        stopCurrentAudio();
        updateDebug();
    };

    const bottomRow = document.createElement('div');
    bottomRow.style.cssText = 'display:flex; flex-wrap:wrap; gap:0; align-items:stretch; max-width:100%; flex-shrink:0;';
    const timerBtn = document.createElement('button');
    timerBtn.id = 'apc-timer-btn';
    timerBtn.type = 'button';
    timerBtn.style.cssText = controlStyle + 'display:flex; color:#0f0; font-family:monospace;';
    const btnHist = document.createElement('button');
    btnHist.id = 'apc-history-btn';
    const btnRules = document.createElement('button');
    btnRules.id = 'apc-rules-btn';
    const btnSettings = document.createElement('button');
    btnSettings.id = 'apc-settings-btn';
    for (const button of [btnHist, btnRules, btnSettings]) {
        button.type = 'button';
        button.style.cssText = controlStyle;
    }
    bottomRow.append(timerBtn, btnHist, btnRules, btnSettings);
    debugDiv.append(modal, btnNight, bottomRow);
    document.body.appendChild(debugDiv);

    function updateDebug() {
        const backgroundText = `${t('backgroundLabel')}: ${t('background_' + backgroundState)}`;
        timerBtn.title = `${t('debugTooltip')}\n${backgroundText}`;

        const m = Math.floor(Math.max(0, timeLeft) / 60);
        const s = Math.floor(Math.max(0, timeLeft) % 60);
        const unreadCount = getUnreadCount();

        const timerPaused = isPaused || (isModalOpen && !document.hidden);
        let statusText = `🔄 ${m}:${s.toString().padStart(2, '0')} | ${timerPaused ? t('paused') : t('running')}`;

        if (unreadCount > 0) {
            statusText += ` | 🟠 ${t('newAlarms')}: ${unreadCount}`;
        }

        if (soundState === 'blocked') statusText += ` | ${t('soundBlockedShort')}`;
        else if (soundState === 'noFile') statusText += ` | ${t('soundMissingShort')}`;
        if (soundState !== 'idle') timerBtn.title += `\n${t('soundLabel')}: ${t('sound_' + soundState)}`;
        timerBtn.textContent = isModalOpen ? t('closePanel') : statusText;
        timerBtn.setAttribute('aria-expanded', String(isModalOpen));
        timerBtn.setAttribute('aria-controls', modal.id);
        timerBtn.style.background = isModalOpen ? '#522' : '#222';
        timerBtn.style.color = isModalOpen ? '#fff' : unreadCount > 0 ? '#ffaa00' : '#0f0';
        timerBtn.style.borderColor = isModalOpen ? '#a44' : unreadCount > 0 ? '#ffaa00' : '#444';
        modal.style.display = isModalOpen ? 'block' : 'none';
        btnNight.style.display = isModalOpen ? 'block' : 'none';
        btnNight.textContent = isNightMode ? t('nightMode') : t('dayMode');
        btnNight.style.background = isNightMode ? '#1e3a5f' : '#222';
        for (const button of [btnHist, btnRules, btnSettings]) button.style.display = isModalOpen ? 'flex' : 'none';
        const statusLine = document.querySelector('#apc-settings-status');
        if (statusLine) statusLine.textContent = backgroundText + (soundState !== 'idle' ? ` | ${t('soundLabel')}: ${t('sound_' + soundState)}` : '');
        modal.style.width = activeTab === 'history' ? '760px' : activeTab === 'rules' ? '640px' : '468px';
    }

    setInterval(() => {
        const alertTitleText = t('titleNewAlarms');
        if (document.title !== alertTitleText && document.title !== originalTitle) {
            originalTitle = document.title;
        }
        if (getUnreadCount() > 0) {
            isTitleBlinking = !isTitleBlinking;
            document.title = isTitleBlinking ? alertTitleText : originalTitle;
            setFavicon(isTitleBlinking);
        } else {
            if (document.title !== originalTitle) document.title = originalTitle;
            setFavicon(false);
            isTitleBlinking = false;
        }
    }, 1000);

    const tableStyle = `width:100%; margin:0; border:0; border-collapse:collapse; table-layout:auto; text-align:left; font:inherit;`;
    const thStyle = `border:0; padding:3px 6px; background:#2a2a2a; color:#fff; font:inherit; font-weight:bold; white-space:nowrap; word-break:normal; overflow-wrap:normal; position:sticky; top:0; z-index:1;`;
    const tdStyle = `border:0; padding:3px 6px; font:inherit; line-height:1.35; vertical-align:top;`;
    const identityCellStyle = tdStyle + `width:1%; white-space:nowrap; word-break:normal; overflow-wrap:normal;`;
    const descriptionCellStyle = tdStyle + `white-space:normal; word-break:normal; overflow-wrap:anywhere;`;
    const actionCellStyle = identityCellStyle + `text-align:center;`;
    const btnActionStyle = `background:#444; color:#fff; border:none; padding:3px 6px; cursor:pointer; font-family:inherit; font-size:12px; line-height:1.2; white-space:nowrap; word-break:normal; overflow-wrap:normal; width:auto; min-width:max-content; flex-shrink:0; border-radius:0; margin:0;`;
    let activeTab = 'history';
    let activePermissionBrowser = null;

    function updateHeaderLabels() {
        btnHist.textContent = t('historyButton');
        btnHist.title = t('tabHistory');
        btnRules.textContent = t('rulesButton');
        btnRules.title = t('tabRules');
        btnSettings.textContent = t('settingsButton');
        btnSettings.title = t('tabSettings');
    }

    function copyAddressRow(address) {
        return `<div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center; margin:4px 0;">
            <code style="flex:1; min-width:180px; padding:0; background:#111; color:#ffcc80; overflow-wrap:anywhere; user-select:all;">${address}</code>
            <button type="button" data-copy-address="${address}" style="${btnActionStyle}">${htmlT('copyAddress')}</button>
        </div>`;
    }

    async function copySettingAddress(button) {
        const address = button.dataset.copyAddress;
        try {
            if (window.isSecureContext && navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(address);
            } else {
                // APC работает по HTTP: Clipboard API может быть недоступен.
                const field = document.createElement('textarea');
                const previouslyFocused = document.activeElement;
                field.value = address;
                field.style.cssText = 'position:fixed; left:-9999px; top:0;';
                document.body.appendChild(field);
                try {
                    field.focus();
                    field.select();
                    if (!document.execCommand('copy')) throw new Error('Clipboard unavailable');
                } finally {
                    field.remove();
                    previouslyFocused?.focus({ preventScroll: true });
                }
            }
            button.textContent = t('copiedAddress');
        } catch (error) {
            button.textContent = t('copyFailed');
        }
        setTimeout(() => {
            if (button.isConnected) button.textContent = t('copyAddress');
        }, 2500);
    }

    function renderPermissionGuide() {
        const guide = modalContent.querySelector('#apc-permission-guide');
        if (!guide) return;
        modalContent.querySelectorAll('[data-permission-browser]').forEach(button => {
            const selected = button.dataset.permissionBrowser === activePermissionBrowser;
            button.style.background = selected ? '#1e3a5f' : '#333';
            button.setAttribute('aria-expanded', String(selected));
        });
        guide.style.display = activePermissionBrowser ? 'block' : 'none';
        if (!activePermissionBrowser) { guide.innerHTML = ''; return; }

        const section = (title, text, address) => `<h4 style="margin:4px 0; color:#ffcc80;">${title}</h4>
            <p style="line-height:1.5; margin:0;">${text}</p>${copyAddressRow(address)}`;
        if (activePermissionBrowser === 'edge') {
            guide.innerHTML = section(t('autoplayTitle'), t('autoplayNote'), 'edge://settings/content/mediaAutoplay') +
                `<p style="line-height:1.5; margin:0;">${htmlT('autoplaySteps')}</p>` +
                section(t('backgroundTitle'), t('backgroundNote'), 'edge://settings/system/managePerformance');
        } else if (activePermissionBrowser === 'firefox') {
            guide.innerHTML = section(t('firefoxSoundTitle'), t('firefoxSoundNote'), 'about:preferences#privacy') +
                section(t('memoryTitle'), t('firefoxMemoryNote'), 'about:unloads');
        } else if (activePermissionBrowser === 'chrome') {
            guide.innerHTML = section(t('firefoxSoundTitle'), t('chromeSoundNote'), 'chrome://settings/content/sound') +
                section(t('memoryTitle'), t('chromeMemoryNote'), 'chrome://settings/performance');
        }
        guide.innerHTML += `<h4 style="margin:4px 0;">${htmlT('siteAddress')}</h4>` +
            copyAddressRow('http://172.23.255.204') + `<p style="color:#aaa; line-height:1.5; margin:0;">${htmlT('permissionsAfter')}</p>`;
        guide.querySelectorAll('[data-copy-address]').forEach(button => {
            button.onclick = () => copySettingAddress(button);
        });
    }

    function renderModal() {
        updateHeaderLabels();
        modalContent.innerHTML = '';

        if (activeTab === 'history') {
            btnHist.style.background = '#333'; btnHist.style.color = '#fff';
            btnRules.style.background = '#222'; btnRules.style.color = '#aaa';
            btnSettings.style.background = '#222'; btnSettings.style.color = '#aaa';

            const table = document.createElement('table');
            table.style.cssText = tableStyle + 'min-width:700px;';
            table.innerHTML = `<thead><tr><th style="${thStyle}">${htmlT('colTime')}</th><th style="${thStyle}">${htmlT('colLabel')}</th><th style="${thStyle}">${htmlT('colAlarm')}</th><th style="${thStyle}">${htmlT('colAction')}</th></tr></thead>`;
            const rows = table.createTBody();

            const sortedAlarms = Object.values(alarmsCache).filter(a => a && typeof a === 'object').sort((a, b) => (a.parsedAt || 0) - (b.parsedAt || 0));
            if (sortedAlarms.length === 0) rows.innerHTML = `<tr><td colspan="4" style="${tdStyle} text-align:center; color:#888;">${htmlT('emptyHistory')}</td></tr>`;

            sortedAlarms.forEach(alarm => {
                const tr = document.createElement('tr');
                const safeDesc = String(alarm.description || 'Без описания');
                const safeLabel = String(alarm.deviceLabel || 'Нет данных');
                const safeTime = String(alarm.startTime || 'Нет данных');
                const muted = isMuted(safeLabel, safeDesc);
                if (muted) tr.style.opacity = '0.5';

                tr.innerHTML = `
                    <td style="${identityCellStyle}">${escapeHtml(safeTime)}</td>
                    <td style="${identityCellStyle}">${escapeHtml(safeLabel)}</td>
                    <td style="${descriptionCellStyle}">${escapeHtml(safeDesc)}</td>
                    <td style="${actionCellStyle}">
                        ${muted ? `<span style="color:#888;">${htmlT('inMute')}</span>` : `<button class="ignore-btn" data-label="${escapeHtml(safeLabel)}" data-desc="${escapeHtml(safeDesc)}" style="${btnActionStyle}">${htmlT('hideBtn')}</button>`}
                    </td>
                `;
                rows.appendChild(tr);
            });

            table.querySelectorAll('.ignore-btn').forEach(btn => {
                btn.onclick = () => {
                    const label = btn.getAttribute('data-label');
                    const fullDesc = btn.getAttribute('data-desc');
                    if (label === 'Нет данных' || label === '<No Data>' || label === 'Немає даних') {
                        alert(t('noLabelAlert'));
                        return;
                    }
                    const substr = prompt(t('ignorePrompt', label), fullDesc);
                    if (substr) {
                        muteRules.push({ label: label, text: substr.trim() });
                        saveMuteRules();
                        renderModal();
                        updateStylesAndListeners();
                    }
                };
            });
            modalContent.appendChild(table);

        } else if (activeTab === 'rules') {
            btnHist.style.background = '#222'; btnHist.style.color = '#aaa';
            btnRules.style.background = '#333'; btnRules.style.color = '#fff';
            btnSettings.style.background = '#222'; btnSettings.style.color = '#aaa';

            const table = document.createElement('table');
            table.style.cssText = tableStyle + 'min-width:540px;';
            table.innerHTML = `<thead><tr><th style="${thStyle}">${htmlT('colLabel')}</th><th style="${thStyle}">${htmlT('colPhrase')}</th><th style="${thStyle}">${htmlT('colAction')}</th></tr></thead>`;
            const rows = table.createTBody();

            if (muteRules.length === 0) rows.innerHTML = `<tr><td colspan="3" style="${tdStyle} text-align:center; color:#888;">${htmlT('emptyRules')}</td></tr>`;

            // Фильтры хранятся в порядке добавления: новые строки внизу.
            muteRules.forEach((rule, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="${identityCellStyle}">${escapeHtml(rule.label || t('unknown'))}</td>
                    <td style="${descriptionCellStyle}">${escapeHtml(rule.text)}</td>
                    <td style="${actionCellStyle}"><button class="del-rule-btn" data-idx="${index}" style="${btnActionStyle}; background:#522;">${htmlT('delBtn')}</button></td>
                `;
                rows.appendChild(tr);
            });

            table.querySelectorAll('.del-rule-btn').forEach(btn => {
                btn.onclick = () => {
                    muteRules.splice(parseInt(btn.getAttribute('data-idx')), 1);
                    saveMuteRules();
                    renderModal();
                };
            });
            modalContent.appendChild(table);

        } else if (activeTab === 'settings') {
            btnHist.style.background = '#222'; btnHist.style.color = '#aaa';
            btnRules.style.background = '#222'; btnRules.style.color = '#aaa';
            btnSettings.style.background = '#333'; btnSettings.style.color = '#fff';

            const settingsDiv = document.createElement('div');
            settingsDiv.style.cssText = 'width:100%; box-sizing:border-box; padding:6px; display:flex; flex-direction:column; gap:8px;';
            settingsDiv.innerHTML = `
                <p id="apc-settings-status" style="margin:0; color:#aaa; font-size:12px; overflow-wrap:anywhere;"></p>
                <div style="margin:0; padding:0; border:0; background:#222;">
                    <h3 style="margin:0 0 4px;">${htmlT('permissionsTitle')}</h3>
                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                        <button type="button" data-permission-browser="edge" style="${btnActionStyle}">${htmlT('permissionsEdge')}</button>
                        <button type="button" data-permission-browser="firefox" style="${btnActionStyle}">${htmlT('permissionsFirefox')}</button>
                        <button type="button" data-permission-browser="chrome" style="${btnActionStyle}">${htmlT('permissionsChrome')}</button>
                    </div>
                    <div id="apc-permission-guide" style="display:none; margin:0; padding:0; border:0;"></div>
                </div>
                <!-- Язык -->
                <div style="margin:0; padding:0; border:0; background:#222;">
                    <h3 style="margin:0 0 4px; padding:0; border:0; font-size:14px;">${htmlT('langTitle')}</h3>
                    <div style="display:flex; gap:4px; margin:0;">
                        <button id="langUk" style="${btnActionStyle}; background:${currentLang === 'uk' ? '#1e3a5f' : '#333'};">Українська 🇺🇦</button>
                        <button id="langRu" style="${btnActionStyle}; background:${currentLang === 'ru' ? '#1e3a5f' : '#333'};">Русский 🇷🇺</button>
                    </div>
                </div>

                <!-- Звук: Стандарт -->
                <div style="margin:0; padding:0; border:0; background:#222;">
                    <h3 style="margin:0 0 4px; padding:0; border:0; font-size:14px;">${htmlT('stdSoundTitle')}</h3>
                    <p style="color:#888; margin:0 0 4px;">${htmlT('stdSoundDesc')}</p>
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0;">
                        <input type="file" id="stdFile" accept="audio/*" style="display:none;">
                        <button id="btnStdFile" style="${btnActionStyle}; background:#333;">${htmlT('chooseFile')}</button>
                        <span id="stdFileName" style="color:#888; font-size:12px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">${htmlT('noFile')}</span>

                        <button id="testStd" style="${btnActionStyle}; margin-left:auto;">${htmlT('testBtn')}</button>
                        ${standardAudioData ? '<span class="apc-sound-file-status" style="color:#0f0; font-size:16px; line-height:1; padding-right:3px; flex-shrink:0;">✓</span>' : '<span class="apc-sound-file-status" style="color:#f00; font-size:16px; line-height:1; padding-right:3px; flex-shrink:0;">❌</span>'}
                    </div>
                </div>

                <!-- Звук: AFK -->
                <div style="margin:0; padding:0; border:0; background:#222;">
                    <h3 style="margin:0 0 4px; padding:0; border:0; font-size:14px;">${htmlT('afkSoundTitle')}</h3>
                    <p style="color:#888; margin:0 0 4px;">${htmlT('afkSoundDesc')}</p>
                    <div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin:0;">
                        <input type="file" id="afkFile" accept="audio/*" style="display:none;">
                        <button id="btnAfkFile" style="${btnActionStyle}; background:#333;">${htmlT('chooseFile')}</button>
                        <span id="afkFileName" style="color:#888; font-size:12px; max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">${htmlT('noFile')}</span>

                        <button id="testAfk" style="${btnActionStyle}; margin-left:auto;">${htmlT('testBtn')}</button>
                        ${afkAudioData ? '<span class="apc-sound-file-status" style="color:#0f0; font-size:16px; line-height:1; padding-right:3px; flex-shrink:0;">✓</span>' : '<span class="apc-sound-file-status" style="color:#f00; font-size:16px; line-height:1; padding-right:3px; flex-shrink:0;">❌</span>'}
                    </div>
                </div>

                <p style="color:#ffaa00; font-size:12px; margin:0;">${htmlT('soundNote')}</p>
            `;
            modalContent.appendChild(settingsDiv);
            settingsDiv.querySelectorAll('[data-permission-browser]').forEach(button => {
                button.onclick = () => {
                    activePermissionBrowser = activePermissionBrowser === button.dataset.permissionBrowser ? null : button.dataset.permissionBrowser;
                    renderPermissionGuide();
                };
            });
            renderPermissionGuide();

            // Обработка языка
            settingsDiv.querySelector('#langRu').onclick = () => {
                currentLang = 'ru';
                localStorage.setItem('spa_lang', currentLang);
                renderModal();
                updateDebug();
                void loadLanguage(currentLang);
            };
            settingsDiv.querySelector('#langUk').onclick = () => {
                currentLang = 'uk';
                localStorage.setItem('spa_lang', currentLang);
                renderModal();
                updateDebug();
                void loadLanguage(currentLang);
            };

            // Триггеры для скрытых инпутов
            settingsDiv.querySelector('#btnStdFile').onclick = () => settingsDiv.querySelector('#stdFile').click();
            settingsDiv.querySelector('#btnAfkFile').onclick = () => settingsDiv.querySelector('#afkFile').click();

            // Общая логика загрузки файлов
            const handleFile = (inputObj, storageKey, varName, labelId) => {
                const labelElement = settingsDiv.querySelector(`#${labelId}`);
                if (inputObj.files.length === 0) {
                    labelElement.textContent = t('noFile');
                    labelElement.style.color = '#888';
                    return;
                }

                const file = inputObj.files[0];
                if (file.size > 2.5 * 1024 * 1024) {
                    labelElement.textContent = t('noFile');
                    alert(t('fileSizeError'));
                    inputObj.value = ''; // Сброс инпута
                    return;
                }

                // Отображаем укороченное имя файла
                labelElement.textContent = file.name;
                labelElement.style.color = '#ccc';

                const reader = new FileReader();
                reader.onload = (e) => {
                    localStorage.setItem(storageKey, e.target.result);
                    if (varName === 'std') standardAudioData = e.target.result;
                    if (varName === 'afk') afkAudioData = e.target.result;

                    // Перерисовка для обновления галочек (✓)
                    // Используем setTimeout, чтобы позволить имени файла отобразиться до перерисовки модалки
                    setTimeout(renderModal, 300);
                };
                reader.readAsDataURL(file);
            };

            // Слушатели изменения файлов
            settingsDiv.querySelector('#stdFile').onchange = (e) => handleFile(e.target, 'spa_snd_std', 'std', 'stdFileName');
            settingsDiv.querySelector('#afkFile').onchange = (e) => handleFile(e.target, 'spa_snd_afk', 'afk', 'afkFileName');

            // Кнопки тестирования звука
            settingsDiv.querySelector('#testStd').onclick = () => playAlertSound(standardAudioData);
            settingsDiv.querySelector('#testAfk').onclick = () => playAlertSound(afkAudioData);
        }
        updateDebug();
    }

    btnHist.onclick = () => { activeTab = 'history'; markAllAsRead(); renderModal(); modal.scrollTop = modal.scrollHeight; };
    btnRules.onclick = () => { activeTab = 'rules'; renderModal(); modal.scrollTop = modal.scrollHeight; };
    btnSettings.onclick = () => { activeTab = 'settings'; renderModal(); };

    timerBtn.onclick = () => {
        isModalOpen = !isModalOpen;
        if (isModalOpen) {
            activeTab = 'history';
            markAllAsRead();
            renderModal();
            modal.scrollTop = modal.scrollHeight;
        } else {
            lastTick = Date.now();
        }
        updateDebug();
    };

    function updateStylesAndListeners() {
        document.querySelectorAll('table.listRow').forEach(row => {
            const rowPanel = row.querySelector('.rowTitle-panel');
            if (!rowPanel) return;
            const alarmId = rowPanel.id;
            if (alarmsCache[alarmId]) {
                if (isMuted(alarmsCache[alarmId].deviceLabel, alarmsCache[alarmId].description)) {
                    row.style.display = 'none'; return;
                }
                row.style.backgroundColor = alarmsCache[alarmId].isRead === false ? '#7a3b00' : '';
                if (!row.dataset.hasReadListener) {
                    row.dataset.hasReadListener = "true";
                    row.addEventListener('click', (e) => {
                        if (e.isTrusted && alarmsCache[alarmId]?.isRead === false) {
                            alarmsCache[alarmId].isRead = true;
                            saveCache();
                            row.style.backgroundColor = '';
                            updateDebug();
                        }
                    });
                }
            }
        });
    }

    // === ИСПРАВЛЕНИЕ ПАРСИНГА: флаг и защита от параллельных запусков ===
    let isParsingAlarms = false;

    async function checkAndParseAlarms() {
        if (location.hash !== TARGET_HASH || isPaused || (isModalOpen && !document.hidden) || isParsingAlarms) return;

        isParsingAlarms = true;
        let needsCacheSave = false, hasNewUnmutedAlarm = false;
        try {
            const alarmRows = document.querySelectorAll('table.listRow');

            for (const row of alarmRows) {
                try {
                    const rowPanel = row.querySelector('.rowTitle-panel');
                    if (!rowPanel) continue;
                    const alarmId = rowPanel.id;
                    if (alarmsCache[alarmId]) {
                        if (alarmsCache[alarmId].deviceLabel === undefined) {
                            delete alarmsCache[alarmId];
                            needsCacheSave = true;
                        }
                        continue;
                    }

                                        // Если пользователь начал взаимодействовать – прерываем парсинг
                    if (Date.now() - lastActivity < 5000) {
                        console.log('[SPA Reloader] Парсинг прерван из-за активности пользователя.');
                        return;
                    }

                    const wasOpen = row.classList.contains('listRow-open');

                    // Открываем строку, если нужно (ищем ссылку заново)
                    if (!wasOpen) {
                        const headerLink = row.querySelector('a.header');
                        if (headerLink) {
                            headerLink.click();
                            await new Promise(r => setTimeout(r, 500));
                        } else {
                            continue;
                        }
                    }

                    const descEl = row.querySelector('div.rowTitle[id$="_AlarmDescription"]');
                    const description = descEl ? descEl.innerText.trim() : 'Без описания';

                    const getDetail = (label) => {
                        const labels = Array.from(row.querySelectorAll('.alarmDetails-label'));
                        const target = labels.find(l => l.innerText.trim() === label);
                        return target?.nextElementSibling?.innerText.trim() || 'Нет данных';
                    };
                    const hostname = getDetail('Hostname');
                    const severity = getDetail('Severity');
                    const rawStartTime = getDetail('Start Time');
                    const deviceLabel = getDetail('Label');

                    let startTime = rawStartTime;
                    if (rawStartTime !== 'Нет данных' && rawStartTime !== '<No Data>') {
                        const d = new Date(rawStartTime);
                        if (!isNaN(d)) {
                            startTime = `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
                        }
                    }

                                        // Если пользователь активен – не закрываем строку, прерываем
                    if (Date.now() - lastActivity < 5000) {
                        console.log('[SPA Reloader] Парсинг прерван перед закрытием строки.');
                        return;
                    }

                    // Закрываем строку
                    if (!wasOpen) {
                        const headerLink = row.querySelector('a.header');
                        if (headerLink) {
                            headerLink.click();
                            await new Promise(r => setTimeout(r, 200));
                        }
                    }

                    const alarmData = { description, hostname, deviceLabel, severity, startTime, parsedAt: Date.now(), isRead: false };
                    alarmsCache[alarmId] = alarmData;
                    needsCacheSave = true;

                    if (!isMuted(deviceLabel, description)) {
                        hasNewUnmutedAlarm = true;
                        if (typeof window.Notification === 'function' && Notification.permission === "granted") {
                            new Notification(`${t('notifTitle')}: ${severity}`, { body: `${description}\nLabel: ${deviceLabel}\n${t('timeLabel')}: ${startTime}`, requireInteraction: true });
                        }
                    }
                } catch (err) {
                    console.error('[SPA Reloader] Ошибка парсинга строки:', err);
                }
            }

        } finally {
            // Сохраняем уже найденные тревоги даже при прерывании реальным пользователем.
            try {
                if (needsCacheSave) {
                    const keys = Object.keys(alarmsCache);
                    if (keys.length > 300) {
                        keys.sort((a,b) => (alarmsCache[a].parsedAt||0) - (alarmsCache[b].parsedAt||0));
                        while (keys.length > 300) delete alarmsCache[keys.shift()];
                    }
                    saveCache();
                }
                if (hasNewUnmutedAlarm) {
                    pendingAlarmSound = true;
                    localStorage.setItem('spa_alarm_sound_pending', 'true');
                    playAlertSound();
                }
                updateStylesAndListeners();
                updateDebug();
            } finally {
                isParsingAlarms = false;
            }
        }
    }

    // === ПОСЛЕДОВАТЕЛЬНЫЙ ЦИКЛ ПРОВЕРКИ ТРЕВОГ ===
    async function alarmCheckLoop() {
        while (true) {
            // Ждём 5 секунд
            await new Promise(resolve => setTimeout(resolve, 5000));

            // Не запускаем парсинг, если пользователь был активен последние 10 секунд
            if (Date.now() - lastActivity < 10000) {
                continue;
            }

            try {
                await checkAndParseAlarms();
            } catch (e) {
                console.error('[SPA Reloader] Ошибка в alarmCheckLoop:', e);
            }
        }
    }
    alarmCheckLoop();

    // Таймер перезагрузки
    setInterval(() => {
        const now = Date.now();
        const delta = (now - lastTick) / 1000;
        lastTick = now;
        if (!isPaused && !(isModalOpen && !document.hidden)) {
            timeLeft -= delta;
            if (timeLeft <= 0 && !isParsingAlarms) {  // не перезагружаем во время парсинга
                isPaused = true;
                location.hash === TARGET_HASH ? location.reload() : (location.href = TARGET_URL, setTimeout(() => location.reload(), 500));
            }
        }
        updateDebug();
    }, 1000);

    // Активность для паузы таймера
    function setWorking() {
        isPaused = true;
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            isPaused = false;
            lastTick = Date.now();
            // Добавляем время только если были клики
            if (hadClicks) {
                timeLeft = Math.min(timeLeft + ADD_TIME_ON_BLUR_SEC, TIMER_MAX_SEC);
                hadClicks = false;   // сбрасываем флаг
            }
            updateDebug();
        }, 10000);
        updateDebug();
    }

    ['mousemove', 'keydown', 'click', 'wheel'].forEach(evt => {
        window.addEventListener(evt, (e) => {
            // headerLink.click() при парсинге не является активностью оператора.
            if (!e.isTrusted || document.hidden) return;
            hasLeftPage = false;
            lastActivity = Date.now();   // обновляем время
            setWorking();
            if (evt === 'click') {
                hadClicks = true;
            }
        });
    });
    function handleLeave() {
        clearTimeout(idleTimeout);
        if (isPaused) lastTick = Date.now();
        isPaused = false;
        // blur и visibilitychange могут прийти подряд: прибавляем время один раз.
        if (!hasLeftPage) timeLeft = Math.min(timeLeft + ADD_TIME_ON_BLUR_SEC, TIMER_MAX_SEC);
        hasLeftPage = true;
        lastActivity = 0;
        hadClicks = false;   // сбрасываем флаг кликов
        updateDebug();
    }
    window.addEventListener('blur', handleLeave);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) handleLeave();
        else hasLeftPage = false;
        backgroundGuard.start();
    });
    window.addEventListener('focus', () => { hasLeftPage = false; });

    const backgroundGuard = createBackgroundGuard(state => {
        backgroundState = state;
        updateDebug();
    });
    backgroundGuard.start();
    // Закрываем ресурсы при уходе со страницы и восстанавливаем после back/forward cache.
    window.addEventListener('pagehide', () => backgroundGuard.stop());
    window.addEventListener('pageshow', () => backgroundGuard.start());
    document.addEventListener('resume', () => backgroundGuard.start());

    setTimeout(updateStylesAndListeners, 2000);
    // Перезагрузка страницы не должна стирать незвучавшую тревогу.
    if (pendingAlarmSound) setTimeout(() => {
        if (pendingAlarmSound && soundState === 'pending') playAlertSound();
    }, 2000);
    updateHeaderLabels();
    updateDebug();
    void loadLanguage(currentLang);
})();
