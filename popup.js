// DVSA Sniper - Popup UI Script
// Uses the promise-based `browser` API. The old callback style
// (`browser.storage.local.set(data, cb)`) throws in Firefox, which is why
// saving settings silently failed.
const api = globalThis.browser ?? globalThis.chrome;

const PORTAL_URL = 'https://driverpracticaltest.dvsa.gov.uk/application';
const DVSA_TAB_PATTERNS = ['https://*.dvsa.gov.uk/*'];

const TEXT_FIELDS = ['licenseId', 'postcode', 'testCentre', 'afterDate'];
const NUMBER_FIELDS = {
  batchSize: 10,
  timeBetweenSearches: 1500,
  timeBetweenBatches: 90000,
  minTypeDelay: 50,
  maxTypeDelay: 150,
  minClickDelay: 300,
  maxClickDelay: 800
};

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  const masterToggleBtn = $('masterToggleBtn');
  const toast = $('toast');
  const logsConsole = $('logsConsole');
  let lastHeartbeat = 0;

  $('versionTag').textContent = 'v' + api.runtime.getManifest().version;

  // Tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`)?.classList.add('active');
    });
  });

  // Load saved settings
  try {
    const items = await api.storage.local.get(null);
    for (const key of TEXT_FIELDS) {
      if (items[key]) $(key).value = items[key];
    }
    for (const key of Object.keys(NUMBER_FIELDS)) {
      if (items[key] !== undefined && items[key] !== '') $(key).value = items[key];
    }
    $('alertOnly').checked = !!items.alertOnly;
    $('backgroundMode').checked = items.backgroundMode !== false;
    renderHealth(items);
    $('metricBatchSize').textContent = items.batchSize ?? NUMBER_FIELDS.batchSize;
    $('metricSearchNum').textContent = items._searchNumber ?? 0;
    lastHeartbeat = items._heartbeat || 0;
    renderHeartbeat();
    updateUIStatus(!!items.isRunning);
    renderLogs(items.logs || []);
  } catch (e) {
    showToast('⚠️ Could not load settings: ' + e.message, true);
  }

  // Save settings
  $('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const result = readForm();
    if (result.error) {
      showToast('⚠️ ' + result.error, true);
      return;
    }
    try {
      await api.storage.local.set(result.data);
      $('metricBatchSize').textContent = result.data.batchSize;
      showToast('✅ Settings saved');
    } catch (err) {
      showToast('⚠️ Save failed: ' + err.message, true);
    }
  });

  // Start / stop
  masterToggleBtn.addEventListener('click', async () => {
    const items = await api.storage.local.get(['isRunning', 'licenseId', 'postcode']);
    const newState = !items.isRunning;

    if (newState && (!items.licenseId || !items.postcode)) {
      showToast('⚠️ Save your licence & postcode first', true);
      return;
    }

    await api.storage.local.set({ isRunning: newState, _searchNumber: 0, _heartbeat: Date.now() });
    updateUIStatus(newState);
    showToast(newState ? '🚀 Sniper started' : '⏸️ Sniper stopped');

    if (newState) {
      // On Android the popup is its own tab, so look for any DVSA tab rather
      // than the "active" one. Reload it, or open the portal if none exists.
      const tabs = await api.tabs.query({ url: DVSA_TAB_PATTERNS }).catch(() => []);
      if (tabs.length) {
        await Promise.all(tabs.map(t => api.tabs.reload(t.id)));
      } else {
        await api.tabs.create({ url: PORTAL_URL });
      }
    }
  });

  $('launchPortalBtn').addEventListener('click', () => {
    api.tabs.create({ url: PORTAL_URL });
  });

  $('testNotifyBtn').addEventListener('click', async () => {
    await api.runtime.sendMessage({
      action: 'notify',
      key: 'test',
      force: true,
      title: '🔔 TestBooking',
      message: 'Notifications are working. You will get alerts like this for captchas, blocks and slots.'
    });
    showToast('🔔 Test notification sent');
  });

  $('resetBatchBtn').addEventListener('click', async () => {
    await api.storage.local.set({ _searchNumber: 0, _lastBatchTime: 0 });
    $('metricSearchNum').textContent = '0';
    showToast('🔄 Batch counters reset');
  });

  $('clearLogsBtn').addEventListener('click', async () => {
    await api.storage.local.set({ logs: [] });
  });

  api.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.isRunning) updateUIStatus(!!changes.isRunning.newValue);
    if (changes._searchNumber) $('metricSearchNum').textContent = changes._searchNumber.newValue || '0';
    if (changes.logs) renderLogs(changes.logs.newValue || []);
    if (changes._heartbeat) { lastHeartbeat = changes._heartbeat.newValue || 0; renderHeartbeat(); }
    if (changes._gaps || changes._runStarted || changes.isRunning) {
      api.storage.local.get(['_gaps', '_runStarted', 'isRunning']).then(renderHealth);
    }
  });

  setInterval(renderHeartbeat, 5000);

  function renderHeartbeat() {
    const el = $('metricHeartbeat');
    if (!lastHeartbeat) { el.textContent = '–'; return; }
    const secs = Math.round((Date.now() - lastHeartbeat) / 1000);
    el.textContent = secs < 60 ? `${secs}s ago` : `${Math.round(secs / 60)}m ago`;
  }

  function renderHealth({ _gaps = [], _runStarted = 0, isRunning = false } = {}) {
    const summary = $('healthSummary');
    const list = $('gapList');
    list.textContent = '';
    if (!_runStarted) return;
    const fmt = (ms) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dur = (ms) => ms >= 120000 ? `${Math.round(ms / 60000)} min` : `${Math.round(ms / 1000)}s`;
    const since = _gaps.filter(g => g.from >= _runStarted);
    const longest = since.reduce((m, g) => Math.max(m, g.to - g.from), 0);
    const ranFor = dur(Date.now() - _runStarted);
    summary.textContent = !since.length
      ? `✅ No freezes since ${fmt(_runStarted)} (${ranFor}${isRunning ? '' : ', now stopped'}). Background running looks healthy.`
      : `⚠️ Firefox was frozen ${since.length} time(s) since ${fmt(_runStarted)}; longest ${dur(longest)}.`;
    for (const g of since.slice(-8).reverse()) {
      const li = document.createElement('li');
      li.textContent = `${fmt(g.from)}–${fmt(g.to)}: frozen for ${dur(g.to - g.from)}`;
      list.appendChild(li);
    }
  }

  function readForm() {
    const data = {};
    for (const key of TEXT_FIELDS) data[key] = $(key).value.trim();
    data.licenseId = data.licenseId.toUpperCase().replace(/\s+/g, '');
    data.postcode = data.postcode.toUpperCase();

    if (!data.licenseId) return { error: 'Driving licence number is required' };
    if (!data.postcode) return { error: 'Postcode is required' };
    if (data.afterDate && !/^\d{1,2}\/\d{1,2}\/(\d{2}|\d{4})$/.test(data.afterDate)) {
      return { error: 'Date must be DD/MM/YYYY' };
    }

    for (const [key, fallback] of Object.entries(NUMBER_FIELDS)) {
      const n = parseInt($(key).value, 10);
      data[key] = Number.isFinite(n) && n > 0 ? n : fallback;
    }
    data.alertOnly = $('alertOnly').checked;
    data.backgroundMode = $('backgroundMode').checked;
    if (data.minTypeDelay > data.maxTypeDelay) return { error: 'Min keypress delay is above max' };
    if (data.minClickDelay > data.maxClickDelay) return { error: 'Min click delay is above max' };

    return { data };
  }

  function updateUIStatus(isRunning) {
    $('statusPill').className = isRunning ? 'status-pill active' : 'status-pill';
    $('statusText').textContent = isRunning ? 'RUNNING' : 'STOPPED';
    masterToggleBtn.className = isRunning ? 'toggle-btn btn-stop' : 'toggle-btn btn-start';
    $('toggleIcon').textContent = isRunning ? '⏸' : '▶';
    $('toggleBtnText').textContent = isRunning ? 'STOP SNIPER' : 'START SNIPER';
    $('controlDesc').textContent = isRunning
      ? 'Engine active. Monitoring DVSA portal for test slots...'
      : 'Toggle to start auto-booking driving test slots.';
  }

  function renderLogs(logs) {
    logsConsole.textContent = '';
    if (!logs.length) {
      const empty = document.createElement('div');
      empty.className = 'log-entry info';
      empty.textContent = 'No log entries yet.';
      logsConsole.appendChild(empty);
      return;
    }
    logs.slice().reverse().forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.level || 'info'}`;
      const time = document.createElement('span');
      time.style.opacity = '0.6';
      time.textContent = `[${log.timestamp}] `;
      entry.appendChild(time);
      entry.appendChild(document.createTextNode(log.message || ''));
      logsConsole.appendChild(entry);
    });
  }

  let toastTimer;
  function showToast(message, isError = false) {
    toast.textContent = message;
    toast.style.backgroundColor = isError ? 'var(--accent-danger)' : 'var(--accent-primary)';
    toast.style.color = isError ? '#FFF' : '#000';
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
  }
});
