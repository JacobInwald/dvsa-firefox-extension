// TestBooking: content script for DVSA pages (Firefox for Android).
//
// Two roles:
//  * HOST (top-level DVSA tab, while running): a page that never navigates. It
//    plays a near-silent looping sound so Android keeps Firefox alive in the
//    background (Firefox runs a media foreground service while a tab plays
//    audio), and shows the DVSA pages in a full-screen same-origin frame.
//    Navigations inside the frame never interrupt the sound. If the sound were
//    played by the DVSA page itself, every page load would stop it, and Android
//    12+ won't let Firefox restart its foreground service from the background,
//    so Firefox gets frozen after the first search.
//  * ENGINE (inside that frame, or the top page if framing is unavailable):
//    works through the booking pages.
(function () {
  'use strict';

  const ext = globalThis.browser ?? globalThis.chrome;
  const RUNNER = 'testbooking-runner';
  const PORTAL_URL = 'https://driverpracticaltest.dvsa.gov.uk/application';

  const isTop = window === window.top;
  const isRunnerFrame = !isTop && window.name === RUNNER && window.parent === window.top;
  // Ignore every other frame (Imperva / hCaptcha / analytics iframes).
  if (!isTop && !isRunnerFrame) return;

  // Inject stealth.js into the page world straight away (as before), and
  // forward its log messages to the extension log.
  try {
    const script = document.createElement('script');
    script.src = ext.runtime.getURL('stealth.js');
    script.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(script);
  } catch (e) {
    console.error('[TestBooking] Failed to inject stealth script:', e);
  }
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'DVSA_SNIPER_LOG') {
      ext.runtime.sendMessage({ action: 'log', message: event.data.text, level: event.data.level || 'info' }).catch(() => {});
    }
  });

  // ---------------------------------------------------------------- helpers
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const clock = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const domReady = () => document.readyState !== 'loading'
    ? Promise.resolve()
    : new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));

  function log(message, level = 'info') {
    console.log(`[TestBooking] ${message}`);
    ext.runtime.sendMessage({ action: 'log', message, level }).catch(() => {});
  }

  // `key` lets the background script de-duplicate repeats of the same alert.
  function notify(key, title, message) {
    ext.runtime.sendMessage({ action: 'notify', key, title, message }).catch(() => {});
  }

  function setStatus(state, detail = '') {
    ext.storage.local.set({ _status: { state, detail, at: Date.now() } }).catch(() => {});
  }

  // What the user would see on screen: the first visible heading, else the
  // title. (DVSA pages start with a visually-hidden h1, "Your progression
  // through this transaction", so the first h1 isn't good enough.)
  function screenSummary(doc = document) {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 2 && r.height > 2 && !/visually-?hidden|govuk-visually-hidden/i.test(el.className);
    };
    const heading = [...doc.querySelectorAll('h1, h2')].find(h => visible(h) && h.innerText.trim());
    const text = (heading && heading.innerText.trim()) || doc.title.trim() || doc.location.pathname;
    return text.replace(/\s+/g, ' ').slice(0, 90);
  }

  function waitFor(selector, timeoutMs = 15000, root = document) {
    return new Promise(resolve => {
      const el = $(selector, root);
      if (el) { resolve(el); return; }
      const observer = new MutationObserver(() => {
        const found = $(selector, root);
        if (found) { observer.disconnect(); clearTimeout(timer); resolve(found); }
      });
      observer.observe(root, { childList: true, subtree: true });
      const timer = setTimeout(() => { observer.disconnect(); resolve(null); }, timeoutMs);
    });
  }

  function findByText(selector, text, root = document) {
    return $$(selector, root).find(el => el.textContent.includes(text)) ?? null;
  }

  async function typeText(el, text, minDelay = 50, maxDelay = 150) {
    if (!text) return;
    el.focus();
    el.value = '';
    for (const char of text) {
      const keyCode = char.charCodeAt(0);
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: char, keyCode }));
      el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, key: char, keyCode }));
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, key: char, keyCode }));
      await sleep(rand(minDelay, maxDelay));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(rand(200, 400));
  }

  async function click(el, minDelay = 300, maxDelay = 800) {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, view: window }));
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, view: window, clientX: x, clientY: y }));
    await sleep(rand(30, 90));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, view: window, clientX: x, clientY: y }));
    el.click();
    await sleep(rand(minDelay, maxDelay));
  }

  // ------------------------------------------------------ keep-alive audio
  // keepalive.wav is a 20 Hz tone at about -50 dB: inaudible on a phone, but
  // Firefox counts it as playback, so it holds a media foreground service.
  const keepAlive = {
    audio: null,
    banner: null,
    async start() {
      if (!this.audio) {
        this.audio = new Audio(ext.runtime.getURL('keepalive.wav'));
        this.audio.loop = true;
      }
      try {
        await this.audio.play();
        this.hideBanner();
        this.mediaSession();
        return true;
      } catch (e) {
        log('Firefox blocked the keep-alive sound (autoplay). Tap the green banner once to allow background running.', 'warn');
        this.showBanner();
        return false;
      }
    },
    stop() {
      if (this.audio) { this.audio.pause(); this.audio = null; }
      this.hideBanner();
      try { if (navigator.mediaSession) navigator.mediaSession.metadata = null; } catch (e) {}
    },
    // The media notification is unavoidable while audio plays; keep it static
    // (state changes come through as ordinary notifications instead) and let
    // its pause button stop the sniper.
    mediaSession() {
      try {
        if (!navigator.mediaSession) return;
        if (typeof MediaMetadata !== 'undefined') {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: 'TestBooking is running',
            artist: 'Keeps Firefox awake while it searches. Pause to stop.',
            album: 'TestBooking'
          });
        }
        navigator.mediaSession.setActionHandler('pause', () => {
          log('Stopped from the media notification.', 'warn');
          ext.storage.local.set({ isRunning: false, _status: { state: 'stopped', detail: 'Stopped from the media notification.', at: Date.now() } });
        });
        navigator.mediaSession.setActionHandler('play', () => this.start());
      } catch (e) {}
    },
    // A real tap counts as a user gesture, which lets playback start.
    showBanner() {
      if (this.banner || !document.body) return;
      this.banner = document.createElement('div');
      const root = this.banner.attachShadow({ mode: 'closed' });
      const btn = document.createElement('button');
      btn.textContent = '🎯 Tap once so TestBooking can keep running in the background';
      btn.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;padding:14px;' +
        'font:600 15px system-ui,sans-serif;color:#000;background:#10B981;border:0;border-radius:10px;' +
        'box-shadow:0 4px 16px rgba(0,0,0,.4)';
      btn.addEventListener('click', () => this.start());
      root.appendChild(btn);
      document.body.appendChild(this.banner);
    },
    hideBanner() {
      if (this.banner) { this.banner.remove(); this.banner = null; }
    }
  };

  // ------------------------------------------------------------------ host
  const host = {
    frame: null,

    async start(url) {
      await domReady();
      window.stop();
      const html = document.documentElement;
      html.replaceChildren();
      const head = document.createElement('head');
      head.innerHTML = '<meta name="viewport" content="width=device-width, initial-scale=1">';
      const title = document.createElement('title');
      title.textContent = 'TestBooking: DVSA';
      head.appendChild(title);
      const body = document.createElement('body');
      body.style.cssText = 'margin:0;overflow:hidden;background:#fff';
      const frame = this.frame = document.createElement('iframe');
      frame.name = RUNNER;
      frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0';
      frame.src = url;
      body.appendChild(frame);
      html.append(head, body);

      frame.addEventListener('load', () => this.checkFrame());
      keepAlive.start();

      ext.runtime.onMessage.addListener((msg) => {
        if (msg && msg.action === 'kick') {
          log('[WATCHDOG] Reloading the DVSA page inside TestBooking.', 'warn');
          this.reloadFrame();
          return Promise.resolve({ ok: true });
        }
      });
      // Leave the host page (back to a normal DVSA tab) when the sniper stops,
      // so payment etc. happen in a regular page.
      ext.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.isRunning && !changes.isRunning.newValue) this.exit();
      });
      log('Background mode on: DVSA runs inside TestBooking, which keeps Firefox awake.', 'info');
    },

    currentUrl() {
      try { return this.frame.contentWindow.location.href; } catch (e) { return null; }
    },

    // If DVSA refuses to be framed, fall back to running in the top page.
    checkFrame() {
      const href = this.currentUrl();
      if (!href || href === 'about:blank') {
        log('DVSA would not load inside TestBooking. Falling back to normal mode (less reliable in the background).', 'warn');
        ext.storage.local.set({ _hostBroken: true }).then(() => location.reload());
      }
    },

    reloadFrame() {
      const href = this.currentUrl();
      this.frame.src = href && href !== 'about:blank' ? href : PORTAL_URL;
    },

    exit() {
      keepAlive.stop();
      const href = this.currentUrl();
      location.replace(href && href.startsWith('https://') ? href : PORTAL_URL);
    }
  };

  // --------------------------------------------------- what's on screen?
  // Documents to inspect: this page plus same-origin child frames, because the
  // Imperva captcha / block page lives inside an iframe of an empty page.
  function visibleDocs() {
    const docs = [document];
    for (const f of document.querySelectorAll('iframe')) {
      try {
        const d = f.contentDocument;
        if (d && d.body) docs.push(d);
      } catch (e) {}
    }
    return docs;
  }

  function detectBlocker() {
    const docs = visibleDocs();
    const text = docs.map(d => (d.body ? d.body.innerText : '')).join('\n').toLowerCase();
    const has = (...needles) => needles.some(n => text.includes(n));
    const imperva = $('iframe[src*="_Incapsula_Resource"]');

    const captcha = docs.some(d => d.querySelector('.h-captcha, iframe[src*="hcaptcha.com"], script[src*="hcaptcha.com"]'));
    if (captcha || has('additional security check', 'complete the security check')) {
      return { kind: 'captcha' };
    }
    if ($('#incapsula_main_message') || has('request unsuccessful', 'incapsula incident', 'incident id')) {
      const m = text.match(/incident id[:\s]*([\w-]+)/);
      return { kind: 'blocked', detail: m ? `incident ${m[1]}` : '' };
    }
    if (imperva) {
      // Imperva frame still loading (or a script-only challenge).
      return { kind: 'challenge' };
    }
    if (has('search limit reached', 'search limit exceeded', 'maximum number of searches', 'too many searches')) {
      return { kind: 'limit' };
    }
    if (location.hostname.startsWith('queue') || has('you are now in the queue', 'you are in a queue', 'your estimated wait time')) {
      return { kind: 'queue' };
    }
    if (has('your session has timed out', 'your session has expired', 'session timed out')) {
      return { kind: 'expired' };
    }
    if (has('service is closed', 'service is unavailable', 'service unavailable', 'sorry, the service is')) {
      return { kind: 'closed' };
    }
    return null;
  }

  // ----------------------------------------------------------------- engine
  class Engine {
    constructor() {
      this.running = false;
      this.config = {};
      this.generation = 0;
    }

    async init() {
      const store = await ext.storage.local.get(null);
      this.config = store;
      this.running = !!store.isRunning;
      if (!this.running) return;

      const gen = ++this.generation;
      const live = () => this.running && gen === this.generation;

      await domReady();
      if (isTop) keepAlive.start(); // fallback mode: no host page
      startHeartbeat();
      log(`Working on: ${screenSummary()}`, 'info');
      await sleep(rand(300, 700));

      let idleSince = Date.now();
      let attempts = 0;
      while (live()) {
        const blocker = detectBlocker();
        if (blocker) {
          const keepGoing = await this.handleBlocker(blocker, live);
          if (!keepGoing || !live()) break;
          idleSince = Date.now();
          continue;
        }

        const handled = await this.pickFlow();
        if (!live()) break;
        if (handled) {
          await ext.storage.local.set({ _stuck: 0 });
          attempts++;
          await sleep(20000);
          if (!live()) break;
          // Still here 20s later: the step didn't move the page on.
          if (attempts >= 3) { await this.stuck('the page did not move on after 3 tries'); break; }
          log('Page did not advance. Retrying step...', 'warn');
          idleSince = Date.now();
          continue;
        }
        if (Date.now() - idleSince > 45000) { await this.stuck('it does not recognise this page'); break; }
        await sleep(1500);
      }
    }

    // Returns true to keep looping on this page, false to stop.
    async handleBlocker(blocker, live) {
      const screen = screenSummary();
      switch (blocker.kind) {
        case 'captcha': {
          log('🧩 Captcha / security check on screen. Waiting for you to solve it.', 'warn');
          setStatus('attention', 'Captcha on screen');
          notify('captcha', '🧩 Captcha: solve it to continue',
            "DVSA is showing a security check (hCaptcha). Open Firefox and solve it. TestBooking carries on by itself afterwards.");
          // Wait for it to be solved (Imperva normally reloads the page).
          const started = Date.now();
          let reminders = 0;
          while (live() && detectBlocker()?.kind === 'captcha') {
            await sleep(3000);
            const mins = (Date.now() - started) / 60000;
            if (reminders < 3 && mins >= [5, 15, 30][reminders]) {
              reminders++;
              notify(`captcha-reminder-${reminders}`, '🧩 Captcha still waiting',
                `The DVSA security check has been on screen for ${Math.round(mins)} min. Searching is paused until it's solved.`);
            }
          }
          if (live()) { log('Captcha solved. Carrying on.', 'success'); setStatus('running'); }
          return true;
        }
        case 'challenge': {
          // Usually resolves within seconds; if it doesn't, the stuck logic
          // in the caller kicks in via the idle timer.
          await sleep(2000);
          if (detectBlocker()?.kind === 'challenge' && !this.challengeSince) this.challengeSince = Date.now();
          if (this.challengeSince && Date.now() - this.challengeSince > 60000) {
            this.challengeSince = 0;
            await this.stuck('the DVSA security page never finished loading');
            return false;
          }
          return true;
        }
        case 'blocked':
          log(`⛔ Blocked by DVSA's bot protection (Imperva) ${blocker.detail}`, 'error');
          notify('blocked', '⛔ Blocked by DVSA bot protection',
            `DVSA's security system refused the request${blocker.detail ? ` (${blocker.detail})` : ''}. TestBooking has stopped. Wait 15-30 min, then press START again.`);
          this.stop('attention', 'Blocked by DVSA bot protection');
          return false;
        case 'limit':
          log('⛔ DVSA says the search limit has been reached.', 'error');
          notify('limit', '⛔ DVSA search limit reached',
            'DVSA is showing "search limit reached". TestBooking has stopped. Try again later, ideally with a longer delay between batches.');
          this.stop('attention', 'DVSA search limit reached');
          return false;
        case 'queue':
          setStatus('waiting', 'In the DVSA queue');
          notify('queue', '⏳ In the DVSA queue',
            "DVSA has put you in its waiting room. TestBooking will wait and carry on when it's your turn.");
          while (live() && detectBlocker()?.kind === 'queue') await sleep(5000);
          setStatus('running');
          return true;
        case 'expired':
          log('DVSA session timed out. Starting again from the beginning.', 'warn');
          await sleep(rand(1000, 2000));
          location.href = PORTAL_URL;
          return false;
        case 'closed':
          log(`DVSA booking service is closed: "${screen}"`, 'error');
          notify('closed', '🌙 DVSA booking is closed',
            `DVSA says: "${screen}". The service runs roughly 6am to 11:40pm. TestBooking has stopped. Press START again when it reopens.`);
          this.stop('attention', 'DVSA booking service closed');
          return false;
      }
      return true;
    }

    // Unknown page / step that doesn't advance: reload twice, then stop and
    // tell the user what's on screen rather than looping forever.
    async stuck(reason) {
      const screen = screenSummary();
      const { _stuck = 0 } = await ext.storage.local.get('_stuck');
      if (_stuck < 2) {
        log(`Stuck on "${screen}" (${reason}). Reloading (${_stuck + 1}/2)...`, 'warn');
        await ext.storage.local.set({ _stuck: _stuck + 1 });
        location.reload();
        return;
      }
      log(`Stuck on "${screen}" (${reason}). Stopping.`, 'error');
      notify('stuck', '❓ TestBooking is stuck',
        `It's on the page "${screen}" and ${reason}. It has stopped. Open Firefox to see what's on screen.`);
      this.stop('attention', `Stuck on "${screen}"`);
    }

    async throttle() {
      const store = await ext.storage.local.get(null);
      this.config = store;

      const now = Date.now();
      const lastBatch = store._lastBatchTime || 0;
      const searchNumber = store._searchNumber || 0;
      const batchSize = parseInt(store.batchSize || '10');
      const timeBetweenBatches = parseInt(store.timeBetweenBatches || '90000');
      const timeBetweenSearches = parseInt(store.timeBetweenSearches || '1500');

      const batchPauseRemaining = (lastBatch + timeBetweenBatches) - now;
      if (batchPauseRemaining > 0) {
        log(`Batch pause. Next search at ${clock(now + batchPauseRemaining)}.`, 'info');
        setStatus('paused', `Batch pause until ${clock(now + batchPauseRemaining)}`);
        await sleep(batchPauseRemaining);
        setStatus('running');
        await ext.storage.local.set({ _searchNumber: 0 });
        this.config._searchNumber = 0;
        return;
      }

      if (searchNumber >= batchSize) {
        log(`Batch of ${batchSize} searches done. Pausing until ${clock(now + timeBetweenBatches)}.`, 'info');
        await ext.storage.local.set({ _lastBatchTime: now, _searchNumber: 0 });
        this.config._searchNumber = 0;
        setStatus('paused', `Batch pause until ${clock(now + timeBetweenBatches)}`);
        await sleep(timeBetweenBatches);
        setStatus('running');
        return;
      }

      await sleep(timeBetweenSearches + rand(0, 1000));
      const nextNum = searchNumber + 1;
      await ext.storage.local.set({ _searchNumber: nextNum, _lastSearch: Date.now() });
      this.config._searchNumber = nextNum;
      log(`Search #${nextNum} of ${batchSize} in this batch`, 'info');
    }

    async onChooseTestType() {
      log('Selecting Car test...');
      const carButton = await waitFor('#test-type-car', 10000);
      if (carButton) await click(carButton);
    }

    async onCandidateDeclaration() {
      log('Confirming candidate declaration...');
      const checkbox = await waitFor('#candidate-declaration', 10000);
      if (checkbox && !checkbox.checked) await click(checkbox);
      await sleep(rand(300, 600));
      const submit = await waitFor('#candidate-declaration-submit', 10000);
      if (submit) await click(submit);
    }

    async onLicenceDetails() {
      if (!this.config.licenseId) {
        log('Licence number is not set in Settings.', 'error');
        notify('no-licence', '⚙️ Licence number missing', 'Add your driving licence number in TestBooking settings, then press START.');
        this.stop('attention', 'Licence number missing');
        return;
      }
      log('Entering licence details...');
      const licenceField = await waitFor('#driving-licence', 10000);
      if (!licenceField) return;
      await typeText(licenceField, this.config.licenseId);
      const extendedNo = $('#extended-test-no');
      if (extendedNo && !extendedNo.checked) await click(extendedNo);
      const specialNeedsNone = $('#special-needs-none');
      if (specialNeedsNone && !specialNeedsNone.checked) await click(specialNeedsNone);
      const submit = await waitFor('#driving-licence-submit', 10000);
      if (submit) await click(submit);
    }

    async onTestDateIntro() {
      log('Opening test date and centre selection...');
      const submit = await waitFor('#choosing-date-test-centre-submit', 10000);
      if (submit) await click(submit);
    }

    async onPreferredTestDate() {
      log(this.config.afterDate ? `Entering preferred date: ${this.config.afterDate}` : 'Entering preferred test date (default)...');
      const dateField = await waitFor('#test-choice-calendar', 10000);
      if (!dateField) return;
      // DVSA rejects an empty date, so default to today.
      const today = new Date();
      const parts = (this.config.afterDate || '').trim().split('/');
      let [day, month, year] = parts.length === 3 ? parts
        : [String(today.getDate()), String(today.getMonth() + 1), String(today.getFullYear())];
      day = day.padStart(2, '0');
      month = month.padStart(2, '0');
      if (year.length === 4) year = year.slice(-2);
      await typeText(dateField, `${day}/${month}/${year}`);
      const form = dateField.closest('form');
      const submit = form?.querySelector('input[type="submit"][name="drivingLicenceSubmit"]');
      if (submit) await click(submit);
    }

    async onLogin() {
      log('Filling login details...');
      const licenseField = await waitFor('#driving-licence-number');
      const refField = await waitFor('#application-reference-number');
      if (!licenseField || !refField) return;
      await typeText(licenseField, this.config.licenseId);
      await typeText(refField, this.config.testReference);
      const submit = await waitFor('#booking-login');
      if (submit) await click(submit);
    }

    async onCentreChange() {
      log('Clicking "Change test centre"...');
      const btn = await waitFor('#test-centre-change');
      if (btn) await click(btn);
    }

    // The postcode page and the results page are the same page: the search
    // box stays at the top and results appear below it. So read any results
    // first, and only search (again) when none are usable.
    async onCentreLookup() {
      const cards = $$('.test-centre-details-link, .test-centre-item, .test-centre-details, #test-centres-results li');
      if (cards.length) {
        if (await this.pickCentre(cards)) return;
        log('No available slots at your test centres. Searching again...', 'info');
      }

      await this.throttle();
      if (!this.running) return;
      const postcodeField = await waitFor('#test-centres-input', 10000);
      if (!postcodeField) return;
      log(`Searching for test centres near ${this.config.postcode}`);
      await typeText(postcodeField, this.config.postcode, this.config.minTypeDelay || 50, this.config.maxTypeDelay || 150);
      const submit = await waitFor('#test-centres-submit', 10000);
      if (submit) await click(submit, this.config.minClickDelay || 300, this.config.maxClickDelay || 800);
      // Submitting loads the results page; the next page load reads them.
    }

    async pickCentre(cards) {
      const preferredList = (this.config.testCentre || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
      for (const card of cards) {
        const fullText = (card.textContent || '').trim();
        const lower = fullText.toLowerCase();
        if (lower.includes('no tests found') || lower.includes('no test times available') || lower.includes('no appointments available')) continue;
        if (preferredList.length && !preferredList.some(target => lower.includes(target))) continue;

        const clickable = card.matches('a, button, input[type="submit"]') ? card
          : (card.querySelector('a.test-centre-details-link, input[type="submit"], button, a') || card);
        const heading = card.querySelector('h4, h3, h2, strong');
        const centreName = ((heading && heading.textContent) || fullText.split('\n')[0]).trim().replace(/\s+/g, ' ');
        log(`✨ Test centre with availability: "${centreName}"`, 'success');
        await ext.storage.local.set({ _centre: centreName });
        await click(clickable, this.config.minClickDelay || 300, this.config.maxClickDelay || 800);
        return true;
      }
      return false;
    }

    async bookTest() {
      log('Looking for a bookable date...');
      let afterDate = new Date(0);
      if (this.config.afterDate) {
        const parts = this.config.afterDate.split('/').map(Number);
        if (parts.length === 3) {
          const yr = parts[2] < 100 ? 2000 + parts[2] : parts[2];
          afterDate = new Date(yr, parts[1] - 1, parts[0]);
        }
      }

      const calendarReady = await waitFor('.BookingCalendar-date--bookable a.BookingCalendar-dateLink', 10000);
      if (!calendarReady) return;

      const dated = $$('.BookingCalendar-date--bookable a.BookingCalendar-dateLink')
        .map(el => ({ date: new Date(el.dataset.date), el }))
        .filter(({ date }) => !isNaN(date) && date >= afterDate)
        .sort((a, b) => a.date - b.date);

      if (!dated.length) {
        log('No dates after your earliest date. Searching again...', 'info');
        history.back();
        return;
      }

      const day = dated[0].date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
      log(`Selecting test date: ${day}`, 'success');
      await click(dated[0].el);

      const slotReady = await waitFor('.SlotPicker-slot-label', 10000);
      if (!slotReady) return;
      const slots = $$('.SlotPicker-slot-label');
      const time = slots.length ? slots[0].textContent.trim().replace(/\s+/g, ' ') : '';
      const { _centre = 'your test centre' } = await ext.storage.local.get('_centre');
      const slotText = `${day}${time ? ' ' + time : ''} at ${_centre}`;

      if (this.config.alertOnly) {
        log(`🎯 Slot available: ${slotText}. Alert-only mode, so not reserving.`, 'success');
        notify('slot', '🎯 Test slot available',
          `${slotText}. Not reserved (alert-only mode). Open Firefox now to book it yourself.`);
        this.stop('booked', `Slot available: ${slotText}`);
        return;
      }

      if (slots.length) {
        log(`Selecting time slot: ${time}`, 'success');
        await click(slots[0]);
      }
      // From here on the slot is being reserved: whatever page comes next is
      // treated as "reserved" (see pickFlow), never reloaded.
      await ext.storage.local.set({ _slot: slotText, _reserving: Date.now() });
      await sleep(300);
      const continueBtn = await waitFor('#slot-chosen-submit', 10000);
      if (continueBtn) await click(continueBtn);
      const modalContinue = await waitFor('#slot-warning-continue', 5000);
      if (modalContinue) await click(modalContinue);
    }

    // Reached after a slot is reserved: hand over to the user.
    async reserved() {
      const { _slot = 'a test slot' } = await ext.storage.local.get('_slot');
      await ext.storage.local.set({ _reserving: 0 });
      log(`🎉 Slot reserved: ${_slot}. Complete the booking in Firefox now.`, 'success');
      notify('reserved', '🎉 Slot reserved: finish booking now',
        `${_slot} is held for you for a short time. Open Firefox and complete your details and payment.`);
      this.stop('booked', `Reserved: ${_slot}`);
    }

    async pickFlow() {
      if (!this.running) return true;
      const title = document.title.toLowerCase();
      try {
        if ($('#test-type-car')) await this.onChooseTestType();
        else if ($('#candidate-declaration')) await this.onCandidateDeclaration();
        else if ($('#test-choice-calendar')) await this.onPreferredTestDate();
        else if ($('#driving-licence')) await this.onLicenceDetails();
        else if ($('#choosing-date-test-centre-submit')) await this.onTestDateIntro();
        else if (findByText('*', 'Enter details below to access')) await this.onLogin();
        else if (findByText('*', 'View booking')) await this.onCentreChange();
        else if (findByText('*', 'Search by your home postcode')) await this.onCentreLookup();
        else if (title.includes('test times available')) await this.bookTest();
        else if (title.includes('relationship to candidate') || title.includes('save all changes') ||
                 (document.body && document.body.innerText.includes('Save all changes'))) await this.reserved();
        else if (await this.justReserved()) await this.reserved();
        else return false;
      } catch (e) {
        log('Error on this page: ' + e.message, 'error');
        await sleep(2000);
        return false;
      }
      return true;
    }

    async justReserved() {
      const { _reserving = 0 } = await ext.storage.local.get('_reserving');
      return _reserving && Date.now() - _reserving < 15 * 60 * 1000;
    }

    stop(state = 'stopped', detail = '') {
      this.running = false;
      stopHeartbeat();
      if (isTop) keepAlive.stop();
      ext.storage.local.set({ isRunning: false, _status: { state, detail, at: Date.now() } });
    }
  }

  // --------------------------------------------- heartbeat & freeze record
  // Every 10s the engine records that it's alive. A gap much bigger than that
  // means Android froze Firefox (screen off / app in background), which is
  // logged and kept in `_gaps` so the popup can show a background health check.
  let heartbeatTimer = null;
  const GAP_MS = 40000;

  async function beat() {
    const now = Date.now();
    const { _heartbeat = 0, _gaps = [] } = await ext.storage.local.get(['_heartbeat', '_gaps']);
    const update = { _heartbeat: now };
    if (_heartbeat && now - _heartbeat > GAP_MS) {
      const secs = Math.round((now - _heartbeat) / 1000);
      log(`⏸ Firefox was paused for ${secs >= 120 ? Math.round(secs / 60) + ' min' : secs + 's'} (${clock(_heartbeat)}–${clock(now)}). It isn't staying awake in the background.`, 'warn');
      update._gaps = [..._gaps, { from: _heartbeat, to: now }].slice(-50);
    }
    await ext.storage.local.set(update);
  }

  function startHeartbeat() {
    beat();
    if (!heartbeatTimer) heartbeatTimer = setInterval(beat, 10000);
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  // ------------------------------------------------------------------- boot
  const engine = new Engine();

  ext.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.isRunning && !changes.isRunning.newValue) {
      engine.running = false;
      stopHeartbeat();
      if (isTop) keepAlive.stop();
    }
  });

  // history.back() can restore a page from the back/forward cache, which
  // doesn't re-run content scripts, so restart the engine in that case.
  window.addEventListener('pageshow', (e) => { if (e.persisted) engine.init(); });

  (async () => {
    const s = await ext.storage.local.get(['isRunning', 'backgroundMode', '_hostBroken']);
    if (isTop && s.isRunning && s.backgroundMode !== false && !s._hostBroken) {
      await host.start(location.href);
      return;
    }
    engine.init();
  })();
})();
