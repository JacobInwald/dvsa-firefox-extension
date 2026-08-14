// DVSA Sniper Firefox Extension - Background Script
const extensionAPI = typeof browser !== 'undefined' ? browser : chrome;

extensionAPI.runtime.onInstalled.addListener(() => {
  console.log('[DVSA Sniper Background] Firefox extension background script installed.');
  
  extensionAPI.storage.local.get([
    'licenseId', 'postcode', 'testCentre', 'afterDate',
    'batchSize', 'timeBetweenSearches', 'timeBetweenBatches',
    'minTypeDelay', 'maxTypeDelay', 'minClickDelay', 'maxClickDelay',
    'isRunning', 'ntfyTopic', 'telegramToken', 'telegramChatId', 'logs'
  ], (items) => {
    const defaults = {
      licenseId: items.licenseId || '',
      postcode: items.postcode || '',
      testCentre: items.testCentre || '',
      afterDate: items.afterDate || '',
      batchSize: items.batchSize || 10,
      timeBetweenSearches: items.timeBetweenSearches || 1500,
      timeBetweenBatches: items.timeBetweenBatches || 90000,
      minTypeDelay: items.minTypeDelay || 50,
      maxTypeDelay: items.maxTypeDelay || 150,
      minClickDelay: items.minClickDelay || 300,
      maxClickDelay: items.maxClickDelay || 800,
      ntfyTopic: items.ntfyTopic || '',
      telegramToken: items.telegramToken || '',
      telegramChatId: items.telegramChatId || '',
      isRunning: items.isRunning !== undefined ? items.isRunning : false,
      _searchNumber: 0,
      _lastBatchTime: 0,
      logs: items.logs || []
    };
    extensionAPI.storage.local.set(defaults);
    updateBadge(defaults.isRunning);
  });
});

// Update Action Badge based on running status
function updateBadge(isRunning, isBlocked = false) {
  const actionAPI = extensionAPI.action || extensionAPI.browserAction;
  if (!actionAPI) return;

  if (isBlocked) {
    actionAPI.setBadgeText({ text: 'ERR' });
    actionAPI.setBadgeBackgroundColor({ color: '#EF4444' });
  } else if (isRunning) {
    actionAPI.setBadgeText({ text: 'ON' });
    actionAPI.setBadgeBackgroundColor({ color: '#10B981' });
  } else {
    actionAPI.setBadgeText({ text: 'OFF' });
    actionAPI.setBadgeBackgroundColor({ color: '#6B7280' });
  }
}

// Append log to local storage
function appendLog(message, level = 'info') {
  const timestamp = new Date().toLocaleTimeString('en-GB', { hour12: false });
  const entry = { timestamp, level, message };

  extensionAPI.storage.local.get(['logs'], (res) => {
    const logs = res.logs || [];
    logs.push(entry);
    if (logs.length > 200) logs.shift();
    extensionAPI.storage.local.set({ logs });
  });
}

// Send external push notification (ntfy.sh & Telegram)
async function sendExternalPush(title, message) {
  extensionAPI.storage.local.get(['ntfyTopic', 'telegramToken', 'telegramChatId'], async (res) => {
    // 1. ntfy.sh Push Notification
    if (res.ntfyTopic) {
      try {
        await fetch(`https://ntfy.sh/${res.ntfyTopic.trim()}`, {
          method: 'POST',
          headers: {
            'Title': title,
            'Priority': 'high',
            'Tags': 'tada,warning'
          },
          body: `${message}\n\nTime: ${new Date().toLocaleTimeString()}`
        });
        appendLog(`[PUSH] Sent ntfy.sh alert to topic: ${res.ntfyTopic}`, 'success');
      } catch (e) {
        console.error('[DVSA Sniper] Failed ntfy push:', e);
      }
    }

    // 2. Telegram Bot Push Notification
    if (res.telegramToken && res.telegramChatId) {
      try {
        const text = encodeURIComponent(`*${title}*\n${message}`);
        await fetch(`https://api.telegram.org/bot${res.telegramToken.trim()}/sendMessage?chat_id=${res.telegramChatId.trim()}&text=${text}&parse_mode=Markdown`);
        appendLog(`[PUSH] Sent Telegram alert to chat: ${res.telegramChatId}`, 'success');
      } catch (e) {
        console.error('[DVSA Sniper] Failed Telegram push:', e);
      }
    }
  });
}

// Handle incoming messages
extensionAPI.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'notify') {
    try {
      const iconPath = extensionAPI.runtime.getURL ? extensionAPI.runtime.getURL('icons/icon128.png') : 'icons/icon128.png';
      extensionAPI.notifications.create({
        type: 'basic',
        iconUrl: iconPath,
        title: request.title || 'Test Booking Alert',
        message: request.message || 'Test Booking update',
        priority: 2
      });
    } catch (e) {
      console.error('[Test Booking] Failed Firefox notification:', e);
    }

    sendExternalPush(request.title || 'Test Booking Alert', request.message || 'Test Booking update');
    appendLog(`[NOTIFICATION] ${request.title}: ${request.message}`, 'success');
    sendResponse({ success: true });
  } else if (request.action === 'log') {
    appendLog(request.message, request.level || 'info');
    sendResponse({ success: true });
  } else if (request.action === 'updateStatus') {
    updateBadge(request.isRunning, request.isBlocked);
    sendResponse({ success: true });
  }
  return true;
});

// Storage sync listener
extensionAPI.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.isRunning) {
    updateBadge(changes.isRunning.newValue);
  }
});
