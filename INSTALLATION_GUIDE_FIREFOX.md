# DVSA Test Booking Sniper - Firefox Extension

A fully automated DVSA driving test slot sniper extension built for **Firefox (Desktop & Android)** with real-time push notifications via **ntfy.sh** and **Telegram**.

---

## 🚀 How to Install in Firefox Desktop

1. Open **Firefox** on your computer.
2. Type `about:debugging` into the Firefox address bar and press **Enter**.
3. Click **"This Firefox"** on the left sidebar.
4. Click **"Load Temporary Add-on..."**.
5. Navigate to the `dvsa-firefox-extension` folder and select `manifest.json`.
6. The 🎯 **DVSA Sniper** icon will appear in your Firefox toolbar.

---

## 📱 How to Receive Push Notifications on your Phone

### Method A: ntfy.sh (Recommended - Free & Zero Setup)
1. Install the free **ntfy** app on your phone ([Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [Apple App Store](https://apps.apple.com/us/app/ntfy/id1625396386)).
2. Open the extension popup in Firefox, go to the **📱 Push Alerts** tab, and enter a unique topic name (e.g., `my_dvsa_alerts_789`).
3. Open the **ntfy** app on your phone, tap **+ Subscribe to topic**, and type the exact same topic name.
4. Whenever a slot is found or a captcha appears, your phone will receive an instant push notification alert!

### Method B: Telegram Bot
1. Open Telegram and search for `@BotFather` to create a bot and get your **Bot Token**.
2. Start a chat with your new bot and get your **Chat ID** (e.g. via `@userinfobot`).
3. Enter your Token & Chat ID in the **📱 Push Alerts** tab.

---

## 🎯 How to Use the Extension

1. Click the **DVSA Sniper** extension icon in Firefox.
2. Under **⚙️ Settings**:
   - Enter your **Driving Licence Number**.
   - Enter your **Test Reference Number**.
   - Enter your **Home Postcode**.
   - (Optional) Enter your **Preferred Test Centre**.
   - Enter your **Earliest Preferred Date** (`DD/MM/YYYY`).
   - Click **Save Settings**.
3. Click **"START SNIPER"**.
4. Click **"Open DVSA Portal in Firefox"** (or navigate to `https://driverpracticaltest.dvsa.gov.uk/application?execution=e1s2`).
5. The extension will automatically fill forms, cycle searches, find slots after your preferred date, reserve the slot, and send an **URGENT PUSH NOTIFICATION** to your phone so you can complete payment!

---

## ⚡ Background & Unfocused Tab Anti-Pausing Protections

Firefox normally throttles timers or pauses tab processing when a browser tab loses focus or is minimized. This extension includes built-in stealth protections:
- **Visibility Spoofing**: `document.hidden` is forced to `false` and `document.visibilityState` is forced to `'visible'`.
- **Focus Override**: `document.hasFocus()` returns `true`, and focus loss (`blur`) events are intercepted.
- **Silent Web Audio Keep-Alive**: Runs an inaudible background audio loop that prevents Firefox from throttling timers or freezing JavaScript execution when unfocused or minimized.
- **Web Worker Ticker**: Uses background worker timers to ensure accurate search delays without tab clamping.
