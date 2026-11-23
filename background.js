// TestBooking: background script (Firefox for Android).
// Uses the promise-based `browser` API; callback-style calls throw in Firefox.
const api = globalThis.browser ?? globalThis.chrome;

const PORTAL_URL = 'https://driverpracticaltest.dvsa.gov.uk/application';
const DVSA_TABS = ['https://*.dvsa.gov.uk/*'];

const DEFAULTS = {
  licenseId: '',
  postcode: '',
  testCentre: '',
  afterDate: '',
  batchSize: 10,
  timeBetweenSearches: 1500,
  timeBetweenBatches: 90000,
  minTypeDelay: 50,
  maxTypeDelay: 150,
  minClickDelay: 300,
  maxClickDelay: 800,
  alertOnly: false,
  backgroundMode: true,
  isRunning: false,
  _searchNumber: 0,
  _lastBatchTime: 0,
  logs: []
};

// Only fill in keys that are missing, so updates never wipe saved settings.
api.runtime.onInstalled.addListener(async () => {
  const items = await api.storage.local.get(null);
  const missing = {};
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (items[key] === undefined) missing[key] = value;
  }
  // Keys from removed features (ntfy/Telegram, live status notification).
  await api.storage.local.remove(['ntfyTopic', 'telegramToken', 'telegramChatId', 'statusNotification']);
  await api.notifications.clear('dvsa-status').catch(() => {});
  if (Object.keys(missing).length) await api.storage.local.set(missing);
});

// Serialise log writes so concurrent messages don't clobber each other.
let logQueue = Promise.resolve();
function appendLog(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  logQueue = logQueue.then(async () => {
    const { logs = [] } = await api.storage.local.get('logs');
    logs.push({ timestamp, level, message });
    while (logs.length > 300) logs.shift();
    await api.storage.local.set({ logs });
  }).catch(e => console.error('[TestBooking] Failed to write log:', e));
  return logQueue;
}

// One notification per event. Each gets its own id so Android shows (and
// sounds) every one, rather than silently updating a single entry. The same
// `key` within DEDUPE_MS is dropped, e.g. a captcha seen again after a reload.
const DEDUPE_MS = 10 * 60 * 1000;
const lastShown = {};

async function notify({ key, title, message, force = false }) {
  const now = Date.now();
  if (key && !force && lastShown[key] && now - lastShown[key] < DEDUPE_MS) return;
  if (key) lastShown[key] = now;
  appendLog(`[NOTIFICATION] ${title}: ${message}`, 'success');
  try {
    await api.notifications.create(`tb-${key || 'msg'}-${now}`, {
      type: 'basic',
      iconUrl: api.runtime.getURL('icons/icon128.png'),
      title,
      message
    });
  } catch (e) {
    console.error('[TestBooking] Failed to show notification:', e);
    appendLog('Could not show a notification: ' + e.message, 'error');
  }
}

api.runtime.onMessage.addListener((request) => {
  if (request.action === 'notify') {
    notify({
      key: request.key,
      title: request.title || 'TestBooking',
      message: request.message || '',
      force: !!request.force
    });
  } else if (request.action === 'log') {
    appendLog(request.message, request.level || 'info');
  }
  return Promise.resolve({ success: true });
});

api.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.isRunning) return;
  if (changes.isRunning.newValue && !changes.isRunning.oldValue) {
    // Fresh start: reset per-run state, forget recent alerts.
    for (const k of Object.keys(lastShown)) delete lastShown[k];
    api.storage.local.set({
      _status: { state: 'running', detail: '', at: Date.now() },
      _runStarted: Date.now(),
      _heartbeat: Date.now(),
      _gaps: [],
      _stuck: 0,
      _reserving: 0,
      _hostBroken: false
    });
  }
});

// ---------------------------------------------------------------------------
// Watchdog. The engine writes a heartbeat every 10s while running. If it goes
// quiet, nudge the DVSA tab: ask the host page to reload its frame (keeps the
// keep-alive sound going), or reload the whole tab if that doesn't answer.
// Note: if Android has frozen Firefox, this can only fire once it's resumed.
// ---------------------------------------------------------------------------
const WATCHDOG = 'dvsa-watchdog';
const STALE_MS = 2.5 * 60 * 1000;

api.alarms.get(WATCHDOG).then(alarm => {
  if (!alarm) api.alarms.create(WATCHDOG, { periodInMinutes: 1 });
});

api.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== WATCHDOG) return;
  const s = await api.storage.local.get(['isRunning', '_heartbeat', '_status']);
  if (!s.isRunning) return;
  // While waiting on the user (captcha) or in a batch pause the engine is
  // still beating, so a stale heartbeat really means it has stalled.
  if (Date.now() - (s._heartbeat || 0) < STALE_MS) return;

  await api.storage.local.set({ _heartbeat: Date.now() }); // one nudge per stall
  const tabs = await api.tabs.query({ url: DVSA_TABS }).catch(() => []);
  if (!tabs.length) {
    appendLog('[WATCHDOG] TestBooking is on but no DVSA tab is open.', 'warn');
    notify({ key: 'no-tab', title: '❓ DVSA tab closed',
      message: 'TestBooking is switched on but the DVSA tab was closed. Tap here to reopen it.' });
    return;
  }
  appendLog(`[WATCHDOG] No activity for ${Math.round((Date.now() - (s._heartbeat || 0)) / 1000)}s.`, 'warn');
  const reply = await api.tabs.sendMessage(tabs[0].id, { action: 'kick' }).catch(() => null);
  if (!reply) await api.tabs.reload(tabs[0].id).catch(() => {});
});

// Tapping a notification jumps to the DVSA tab (or opens the portal).
api.notifications.onClicked.addListener(async (id) => {
  api.notifications.clear(id).catch(() => {});
  const tabs = await api.tabs.query({ url: DVSA_TABS }).catch(() => []);
  if (tabs.length) {
    await api.tabs.update(tabs[0].id, { active: true });
  } else {
    await api.tabs.create({ url: PORTAL_URL });
  }
});
