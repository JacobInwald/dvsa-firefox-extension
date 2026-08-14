(function () {
  'use strict';

  const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;

  // Inject stealth script into DOM main world immediately
  try {
    const s = document.createElement('script');
    s.src = extensionAPI.runtime.getURL('stealth.js');
    s.onload = function () { this.remove(); };
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {
    console.error('[DVSA Sniper Content] Failed to inject stealth script:', e);
  }

  // Listen to postMessage logs from stealth script
  window.addEventListener('message', (event) => {
    if (event.source === window && event.data && event.data.type === 'DVSA_SNIPER_LOG') {
      sendLog(event.data.text, event.data.level || 'info');
    }
  });

  // Utilities - Unthrottled sleep helper for background tabs
  const sleep = (ms) => new Promise(resolve => {
    if (window.__DVSA_WORKER_SET_INTERVAL__) {
      const start = Date.now();
      const intervalId = window.__DVSA_WORKER_SET_INTERVAL__(() => {
        if (Date.now() - start >= ms) {
          window.__DVSA_WORKER_CLEAR_INTERVAL__(intervalId);
          resolve();
        }
      }, 50);
    } else {
      setTimeout(resolve, ms);
    }
  });
  const rand = (lo, hi) => lo + Math.random() * (hi - lo);
  const readingPause = () => sleep(rand(300, 700));
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function sendLog(msg, level = 'info') {
    console.log(`[DVSA Sniper Firefox] ${msg}`);
    try {
      extensionAPI.runtime.sendMessage({ action: 'log', message: msg, level });
    } catch (e) {}
  }

  function sendNotification(title, message) {
    try {
      extensionAPI.runtime.sendMessage({ action: 'notify', title, message });
    } catch (e) {}
  }

  function updateStatus(isRunning, isBlocked = false) {
    try {
      extensionAPI.runtime.sendMessage({ action: 'updateStatus', isRunning, isBlocked });
    } catch (e) {}
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
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, char, key: char, keyCode }));
      el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, cancelable: true, char, key: char, keyCode }));
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, char, key: char, keyCode }));
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

  // Main Sniper Engine for Firefox
  class FirefoxSniperEngine {
    constructor() {
      this.running = false;
      this.config = {};
    }

    async init() {
      const store = await new Promise(res => extensionAPI.storage.local.get(null, res));
      this.config = store;
      this.running = !!store.isRunning;

      if (!this.running) {
        sendLog('Sniper is currently OFF. Click "Start" in extension popup to activate.', 'info');
        return;
      }

      sendLog('🚀 Firefox Sniper active on page: ' + window.location.pathname, 'info');
      await readingPause();
      await this.pickFlow();
    }

    async throttle() {
      // Fetch fresh storage state to prevent stale cached search counters
      const store = await new Promise(res => extensionAPI.storage.local.get(null, res));
      this.config = store;

      const now = Date.now();
      const lastBatch = store._lastBatchTime || 0;
      const searchNumber = store._searchNumber || 0;
      const batchSize = parseInt(store.batchSize || '10');
      const timeBetweenBatches = parseInt(store.timeBetweenBatches || '90000');
      const timeBetweenSearches = parseInt(store.timeBetweenSearches || '1500');

      const batchPauseRemaining = (lastBatch + timeBetweenBatches) - now;
      if (batchPauseRemaining > 0) {
        const secondsLeft = Math.ceil(batchPauseRemaining / 1000);
        sendLog(`Batch limit active. Waiting ${secondsLeft}s before next search...`, 'warn');
        await sleep(batchPauseRemaining);
        await new Promise(res => extensionAPI.storage.local.set({ _searchNumber: 0 }, res));
        this.config._searchNumber = 0;
        return;
      }

      if (searchNumber >= batchSize) {
        const pauseSec = Math.ceil(timeBetweenBatches / 1000);
        sendLog(`Batch limit of ${batchSize} reached! Sending notification...`, 'warn');
        sendNotification('📊 Search Batch Reached', `Completed batch of ${batchSize} searches. Pausing for ${pauseSec} seconds before starting next batch.`);
        await new Promise(res => extensionAPI.storage.local.set({ _lastBatchTime: Date.now(), _searchNumber: 0 }, res));
        this.config._searchNumber = 0;
        this.config._lastBatchTime = Date.now();
        await sleep(timeBetweenBatches);
        return;
      }

      await sleep(timeBetweenSearches + rand(0, 1000));
      const nextNum = searchNumber + 1;
      await new Promise(res => extensionAPI.storage.local.set({ _searchNumber: nextNum }, res));
      this.config._searchNumber = nextNum;
      
      sendLog(`Search #${nextNum} of ${batchSize} in current batch`, 'info');

      if (nextNum >= batchSize) {
        const pauseSec = Math.ceil(timeBetweenBatches / 1000);
        sendLog(`Batch limit of ${batchSize} reached! Sending notification...`, 'warn');
        sendNotification('📊 Search Batch Reached', `Completed batch of ${batchSize} searches. Pausing for ${pauseSec} seconds before starting next batch.`);
      }
    }

    async onChooseTestType() {
      sendLog('Selecting Car Practical Test...');
      const carButton = await waitFor('#test-type-car', 10000);
      if (carButton) await click(carButton);
    }

    async onCandidateDeclaration() {
      sendLog('Confirming Candidate Declaration...');
      const checkbox = await waitFor('#candidate-declaration', 10000);
      if (checkbox && !checkbox.checked) await click(checkbox);
      await sleep(rand(300, 600));
      const submit = await waitFor('#candidate-declaration-submit', 10000);
      if (submit) await click(submit);
    }

    async onLicenceDetails() {
      if (!this.config.licenseId) {
        sendLog('Error: Licence number is not configured in extension popup!', 'error');
        this.stop();
        return;
      }
      sendLog('Entering licence details...');
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
      sendLog('Opening test date and centre selection...');
      const submit = await waitFor('#choosing-date-test-centre-submit', 10000);
      if (submit) await click(submit);
    }

    async onPreferredTestDate() {
      if (!this.config.afterDate) {
        sendLog('Entering preferred test date (Default)...');
      } else {
        sendLog(`Entering preferred date: ${this.config.afterDate}`);
      }
      const dateField = await waitFor('#test-choice-calendar', 10000);
      if (!dateField) return;
      if (this.config.afterDate) {
        const parts = this.config.afterDate.trim().split('/');
        if (parts.length === 3) {
          let [day, month, year] = parts;
          day = day.padStart(2, '0');
          month = month.padStart(2, '0');
          if (year.length === 4) year = year.slice(-2);
          await typeText(dateField, `${day}/${month}/${year}`);
        }
      }
      const form = dateField.closest('form');
      const submit = form?.querySelector('input[type="submit"][name="drivingLicenceSubmit"]');
      if (submit) await click(submit);
    }

    async onLogin() {
      sendLog('Filling login details...');
      const licenseField = await waitFor('#driving-licence-number');
      const refField = await waitFor('#application-reference-number');
      if (!licenseField || !refField) return;
      await typeText(licenseField, this.config.licenseId);
      await typeText(refField, this.config.testReference);
      const submit = await waitFor('#booking-login');
      if (submit) await click(submit);
    }

    async onCentreChange() {
      sendLog('Clicking "Change test centre"...');
      const btn = await waitFor('#test-centre-change');
      if (btn) await click(btn);
    }

    async onCentreLookup() {
      await this.throttle();
      if (!this.running) return;

      const postcodeField = await waitFor('#test-centres-input', 10000);
      if (postcodeField) {
        sendLog(`Searching postcode: ${this.config.postcode || 'Default'}`);
        const minTD = this.config.minTypeDelay || 50;
        const maxTD = this.config.maxTypeDelay || 150;
        await typeText(postcodeField, this.config.postcode, minTD, maxTD);
        const submit = await waitFor('#test-centres-submit', 10000);
        if (submit) {
          const minCD = this.config.minClickDelay || 300;
          const maxCD = this.config.maxClickDelay || 800;
          await click(submit, minCD, maxCD);
        }
      }

      const centreReady = await waitFor('.test-centre-details-link, .test-centre-item, .test-centre-details', 10000);
      if (!centreReady) return;

      const centreCards = $$('.test-centre-details-link, .test-centre-item, .test-centre-details, #test-centres-results li');
      const preferredList = (this.config.testCentre || '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean);

      for (const card of centreCards) {
        const fullText = (card.textContent || '').trim();
        const fullTextLower = fullText.toLowerCase();

        if (fullTextLower.includes('no tests found') || 
            fullTextLower.includes('no test times available') || 
            fullTextLower.includes('no appointments available')) {
          continue;
        }

        if (preferredList.length > 0) {
          const isMatch = preferredList.some(target => fullTextLower.includes(target));
          if (!isMatch) continue;
        }

        const clickable = card.matches('a, button, input[type="submit"]') ? card :
                          (card.querySelector('a.test-centre-details-link, input[type="submit"], button, a') || card);
        
        if (clickable) {
          const centreName = fullText.split('\n')[0].trim();
          sendLog(`✨ Auto-selecting available test centre: "${centreName}"`, 'success');
          const minCD = this.config.minClickDelay || 300;
          const maxCD = this.config.maxClickDelay || 800;
          await click(clickable, minCD, maxCD);
          return;
        }
      }

      sendLog('No available slots for configured test centres. Retrying search...', 'warn');
      await sleep(1500);
      history.back();
    }

    async bookTest() {
      sendLog('Looking for bookable calendar slot...');
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

      const bookableLinks = $$('.BookingCalendar-date--bookable a.BookingCalendar-dateLink');
      const dated = bookableLinks
        .map(el => ({ date: new Date(el.dataset.date), el }))
        .filter(({ date }) => !isNaN(date) && date >= afterDate)
        .sort((a, b) => a.date - b.date);

      if (!dated.length) {
        sendLog('No slots available after configured date. Retrying...', 'warn');
        history.back();
        return;
      }

      sendLog(`Selecting test date: ${dated[0].date.toDateString()}`, 'success');
      await click(dated[0].el);

      const slotReady = await waitFor('.SlotPicker-slot-label', 10000);
      if (!slotReady) return;

      const slots = $$('.SlotPicker-slot-label');
      if (slots.length) {
        sendLog(`Selecting time slot: ${slots[0].textContent.trim()}`, 'success');
        await click(slots[0]);
      }
      await sleep(300);
      const continueBtn = await waitFor('#slot-chosen-submit', 10000);
      if (continueBtn) await click(continueBtn);
      const modalContinue = await waitFor('#slot-warning-continue', 5000);
      if (modalContinue) await click(modalContinue);
    }

    async relationship() {
      sendLog('Selecting "I am candidate"...');
      const btn = await waitFor('#i-am-candidate', 10000);
      if (btn) await click(btn);
    }

    async saveAllChanges() {
      sendLog('🎉🎉🎉 SUCCESS: TEST SLOT RESERVED AND READY FOR PAYMENT! 🎉🎉🎉', 'success');
      sendNotification('🎉 DVSA: Test Slot Found!', 'A test slot has been reserved! Complete payment in your Firefox browser window now.');
      this.stop();
    }

    async onSecurityCheck() {
      sendLog('⚠️ Security check / hCaptcha detected! Pausing automation.', 'warn');
      sendNotification('⚠️ DVSA Sniper: hCaptcha Alert!', 'Security check / hCaptcha detected on screen! Please open Firefox on your phone and solve the captcha to continue.');
      this.stop();
    }

    async pickFlow() {
      if (!this.running) return;

      const bodyTextLower = (document.body ? document.body.innerText : '').toLowerCase();

      // 1. DVSA "Search limit reached" Webpage Detection
      const isSearchLimitWebpage = bodyTextLower.includes('search limit reached') ||
                                   bodyTextLower.includes('search limit exceeded') ||
                                   bodyTextLower.includes('maximum number of searches') ||
                                   bodyTextLower.includes('too many searches');

      if (isSearchLimitWebpage) {
        sendLog('⛔ DVSA webpage returned "Search limit reached"!', 'error');
        sendNotification('⛔ DVSA: Search Limit Reached!', 'The DVSA webpage displays "Search limit reached". Automation paused to protect your session.');
        updateStatus(false, true);
        this.stop();
        return;
      }

      // 2. Imperva Block Detection
      const isBlocked = $('#incapsula_main_message') ||
                        document.title.includes('Incapsula incident ID') ||
                        bodyTextLower.includes('powered by incapsula');

      if (isBlocked) {
        sendLog('⛔ Imperva block page active in Firefox!', 'error');
        sendNotification('⛔ Imperva Block Detected', 'Imperva anti-bot block page active on DVSA portal. Please refresh or check Firefox.');
        updateStatus(false, true);
        this.stop();
        return;
      }

      // 3. Captcha Check
      if ($('.h-captcha') || $('iframe[src*="hcaptcha"]')) {
        await this.onSecurityCheck();
        return;
      }

      const title = document.title;
      try {
        if ($('#test-type-car')) await this.onChooseTestType();
        else if ($('#candidate-declaration')) await this.onCandidateDeclaration();
        else if ($('#test-choice-calendar')) await this.onPreferredTestDate();
        else if ($('#driving-licence')) await this.onLicenceDetails();
        else if ($('#choosing-date-test-centre-submit')) await this.onTestDateIntro();
        else if (findByText('*', 'Enter details below to access')) await this.onLogin();
        else if (findByText('*', 'View booking')) await this.onCentreChange();
        else if (findByText('*', 'Search by your home postcode')) await this.onCentreLookup();
        else if (title.toLowerCase().includes('test times available')) await this.bookTest();
        else if (title.toLowerCase().includes('relationship to candidate')) await this.relationship();
        else if (title.toLowerCase().includes('save all changes') || document.body.innerText.includes('Save all changes')) await this.saveAllChanges();
        else if (findByText('*', 'Additional security check')) await this.onSecurityCheck();
        else await sleep(1000);
      } catch (e) {
        sendLog('Error in execution flow: ' + e.message, 'error');
        await sleep(2000);
      }
    }

    stop() {
      this.running = false;
      extensionAPI.storage.local.set({ isRunning: false });
      updateStatus(false);
    }
  }

  const engine = new FirefoxSniperEngine();
  engine.init();
})();
