// DVSA Sniper Firefox Extension - Popup UI Script
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;

document.addEventListener('DOMContentLoaded', () => {
  // UI Elements
  const masterToggleBtn = document.getElementById('masterToggleBtn');
  const toggleIcon = document.getElementById('toggleIcon');
  const toggleBtnText = document.getElementById('toggleBtnText');
  const statusPill = document.getElementById('statusPill');
  const statusText = document.getElementById('statusText');
  const controlDesc = document.getElementById('controlDesc');
  const toast = document.getElementById('toast');

  // Form Inputs
  const settingsForm = document.getElementById('settingsForm');
  const pushForm = document.getElementById('pushForm');

  const licenseId = document.getElementById('licenseId');
  const postcode = document.getElementById('postcode');
  const testCentre = document.getElementById('testCentre');
  const afterDate = document.getElementById('afterDate');
  const batchSize = document.getElementById('batchSize');
  const timeBetweenSearches = document.getElementById('timeBetweenSearches');
  const timeBetweenBatches = document.getElementById('timeBetweenBatches');

  const minTypeDelay = document.getElementById('minTypeDelay');
  const maxTypeDelay = document.getElementById('maxTypeDelay');
  const minClickDelay = document.getElementById('minClickDelay');
  const maxClickDelay = document.getElementById('maxClickDelay');

  const ntfyTopic = document.getElementById('ntfyTopic');
  const telegramToken = document.getElementById('telegramToken');
  const telegramChatId = document.getElementById('telegramChatId');

  // Controls & Metrics
  const launchPortalBtn = document.getElementById('launchPortalBtn');
  const resetBatchBtn = document.getElementById('resetBatchBtn');
  const metricSearchNum = document.getElementById('metricSearchNum');
  const metricBatchSize = document.getElementById('metricBatchSize');

  // Logs Console
  const logsConsole = document.getElementById('logsConsole');
  const clearLogsBtn = document.getElementById('clearLogsBtn');

  // Tab Navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPanel = document.getElementById(`tab-${btn.dataset.tab}`);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Load Saved Settings from Extension Storage
  extensionAPI.storage.local.get([
    'licenseId', 'postcode', 'testCentre', 'afterDate',
    'batchSize', 'timeBetweenSearches', 'timeBetweenBatches',
    'minTypeDelay', 'maxTypeDelay', 'minClickDelay', 'maxClickDelay',
    'ntfyTopic', 'telegramToken', 'telegramChatId',
    'isRunning', '_searchNumber', 'logs'
  ], (items) => {
    if (items.licenseId) licenseId.value = items.licenseId;
    if (items.postcode) postcode.value = items.postcode;
    if (items.testCentre) testCentre.value = items.testCentre;
    if (items.afterDate) afterDate.value = items.afterDate;
    if (items.batchSize) {
      batchSize.value = items.batchSize;
      metricBatchSize.innerText = items.batchSize;
    }
    if (items.timeBetweenSearches) timeBetweenSearches.value = items.timeBetweenSearches;
    if (items.timeBetweenBatches) timeBetweenBatches.value = items.timeBetweenBatches;

    if (items.minTypeDelay) minTypeDelay.value = items.minTypeDelay;
    if (items.maxTypeDelay) maxTypeDelay.value = items.maxTypeDelay;
    if (items.minClickDelay) minClickDelay.value = items.minClickDelay;
    if (items.maxClickDelay) maxClickDelay.value = items.maxClickDelay;

    if (items.ntfyTopic) ntfyTopic.value = items.ntfyTopic;
    if (items.telegramToken) telegramToken.value = items.telegramToken;
    if (items.telegramChatId) telegramChatId.value = items.telegramChatId;

    if (items._searchNumber !== undefined) {
      metricSearchNum.innerText = items._searchNumber;
    }

    updateUIStatus(!!items.isRunning);
    renderLogs(items.logs || []);
  });

  // Master Start / Stop Toggle
  masterToggleBtn.addEventListener('click', () => {
    extensionAPI.storage.local.get(['isRunning', 'licenseId', 'postcode'], (items) => {
      const currentState = !!items.isRunning;

      if (!currentState && (!items.licenseId || !items.postcode)) {
        showToast('⚠️ Please enter Licence & Postcode before starting!', true);
        return;
      }

      const newState = !currentState;
      extensionAPI.storage.local.set({ isRunning: newState, _searchNumber: 0 }, () => {
        updateUIStatus(newState);
        showToast(newState ? '🚀 Sniper Activated!' : '⏸️ Sniper Paused');

        if (newState) {
          extensionAPI.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].url && tabs[0].url.includes('dvsa.gov.uk')) {
              extensionAPI.tabs.reload(tabs[0].id);
            }
          });
        }
      });
    });
  });

  // Save Settings Form
  settingsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      licenseId: licenseId.value.trim(),
      postcode: postcode.value.trim(),
      testCentre: testCentre.value.trim(),
      afterDate: afterDate.value.trim(),
      batchSize: parseInt(batchSize.value) || 10,
      timeBetweenSearches: parseInt(timeBetweenSearches.value) || 1500,
      timeBetweenBatches: parseInt(timeBetweenBatches.value) || 90000,
      minTypeDelay: parseInt(minTypeDelay.value) || 50,
      maxTypeDelay: parseInt(maxTypeDelay.value) || 150,
      minClickDelay: parseInt(minClickDelay.value) || 300,
      maxClickDelay: parseInt(maxClickDelay.value) || 800
    };

    extensionAPI.storage.local.set(data, () => {
      metricBatchSize.innerText = data.batchSize;
      showToast('✅ Settings Saved Successfully!');
    });
  });

  // Save Push Notification Form
  pushForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pushData = {
      ntfyTopic: ntfyTopic.value.trim(),
      telegramToken: telegramToken.value.trim(),
      telegramChatId: telegramChatId.value.trim()
    };

    extensionAPI.storage.local.set(pushData, () => {
      showToast('✅ Push Notification Settings Saved!');
    });
  });

  // Launch Portal Button
  launchPortalBtn.addEventListener('click', () => {
    extensionAPI.tabs.create({ url: 'https://driverpracticaltest.dvsa.gov.uk/application?execution=e1s2' });
  });

  // Reset Batch Counters
  resetBatchBtn.addEventListener('click', () => {
    extensionAPI.storage.local.set({ _searchNumber: 0, _lastBatchTime: 0 }, () => {
      metricSearchNum.innerText = '0';
      showToast('🔄 Batch Counters Reset!');
    });
  });

  // Clear Logs
  clearLogsBtn.addEventListener('click', () => {
    extensionAPI.storage.local.set({ logs: [] }, () => {
      logsConsole.innerHTML = '<div class="log-entry info">Logs cleared.</div>';
    });
  });

  // Update Status Pill and Button Text
  function updateUIStatus(isRunning) {
    if (isRunning) {
      statusPill.className = 'status-pill active';
      statusText.innerText = 'RUNNING';
      masterToggleBtn.className = 'toggle-btn btn-stop';
      toggleIcon.innerText = '⏸';
      toggleBtnText.innerText = 'STOP SNIPER';
      controlDesc.innerText = 'Engine active. Monitoring DVSA portal for test slots...';
    } else {
      statusPill.className = 'status-pill';
      statusText.innerText = 'STOPPED';
      masterToggleBtn.className = 'toggle-btn btn-start';
      toggleIcon.innerText = '▶';
      toggleBtnText.innerText = 'START SNIPER';
      controlDesc.innerText = 'Toggle to start auto-booking driving test slots.';
    }
  }

  // Render Logs Console
  function renderLogs(logs) {
    logsConsole.textContent = '';
    if (!logs.length) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'log-entry info';
      emptyDiv.textContent = 'No log entries yet.';
      logsConsole.appendChild(emptyDiv);
      return;
    }

    logs.slice().reverse().forEach(log => {
      const entryDiv = document.createElement('div');
      entryDiv.className = `log-entry ${log.level || 'info'}`;
      
      const timeSpan = document.createElement('span');
      timeSpan.style.opacity = '0.6';
      timeSpan.textContent = `[${log.timestamp}] `;
      
      entryDiv.appendChild(timeSpan);
      entryDiv.appendChild(document.createTextNode(log.message || ''));
      logsConsole.appendChild(entryDiv);
    });
  }

  // Toast Helper
  function showToast(message, isError = false) {
    toast.innerText = message;
    toast.style.backgroundColor = isError ? 'var(--accent-danger)' : 'var(--accent-primary)';
    toast.style.color = isError ? '#FFF' : '#000';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // Storage listener for live metrics and logs update
  extensionAPI.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      if (changes.isRunning) updateUIStatus(changes.isRunning.newValue);
      if (changes._searchNumber) metricSearchNum.innerText = changes._searchNumber.newValue || '0';
      if (changes.logs) renderLogs(changes.logs.newValue || []);
    }
  });
});
