# 🎯 DVSA Driving Test Slot Sniper — Firefox Extension

[![Firefox Extension](https://img.shields.io/badge/Firefox-MV3-orange.svg)](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions)
[![Version](https://img.shields.io/badge/version-1.0.1-blue.svg)](manifest.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](package.json)

An automated driving test slot sniper built specifically for **Firefox Desktop** and **Firefox Mobile (Android)**. It continuously monitors the DVSA practical test booking portal (`driverpracticaltest.dvsa.gov.uk`), reserves matching slots according to your preferences, and sends immediate mobile push alerts so you can complete payment.

---

## 📑 Table of Contents

- [Features](#-features)
- [Directory & File Overview](#-directory--file-overview)
- [Installation Instructions](#-installation-instructions)
  - [Firefox Desktop (Quick / Temporary)](#1-firefox-desktop-temporary-load)
  - [Firefox Desktop (CLI / Developer)](#2-firefox-desktop-via-web-ext)
  - [Firefox Android](#3-firefox-android)
- [Packaging & Building for Release](#-packaging--building-for-release)
  - [1. Building Package (ZIP / XPI)](#1-building-the-extension-package)
  - [2. Firefox Add-ons (AMO) Signing & Distribution](#2-signing--publishing-on-amo)
- [Configuration & Usage Guide](#-configuration--usage-guide)
  - [Configuring the Sniper](#1-configuring-sniper-settings)
  - [Setting Up Mobile Push Notifications](#2-setting-up-mobile-push-alerts)
- [Stealth & Anti-Pausing Architecture](#-stealth--anti-pausing-architecture)
- [Development & Linting](#-development--linting)
- [CI/CD Pipelines & GitHub Workflows](#-cicd-pipelines--github-workflows)

---

## ⚡ Features

- **Automated Slot Searching & Reservation**: Auto-fills login data, navigates search forms, cycles test centres, checks calendar slots against your earliest preferred date, and selects/reserves matching test slots.
- **Background & Unfocused Tab Anti-Pausing**: Uses visibility spoofing (`document.hidden = false`), focus overrides, and a **silent Web Audio keep-alive loop** to prevent Firefox from throttling timers when minimized or running in an unfocused background tab.
- **Web Worker Ticker**: Uses background worker timers for reliable delay handling without browser tab throttling.
- **Mobile Push Alerts (ntfy.sh & Telegram)**: Get instant push notifications on your phone via **ntfy.sh** (free, no account required) or a custom **Telegram Bot**.
- **Anti-Bot & Captcha Safety**: Automatically detects hCaptcha, search rate limits, and Imperva block pages, pausing execution safely and warning you via notification.
- **Humanized Actions**: Configurable randomized typing speeds, click delays, batch sizes, and inter-batch pause intervals to prevent bot detection.

---

## 📁 Directory & File Overview

```
dvsa-firefox-extension/
├── manifest.json                 # WebExtension Manifest V3 configuration
├── background.js                 # Service worker / background script (badges, notifications, logs)
├── content.js                    # Content script running engine on DVSA portal pages
├── stealth.js                    # Page-world script (visibility spoofing, silent WebAudio keep-alive)
├── popup.html                    # Extension popup UI structure
├── popup.css                     # Extension popup modern dark theme styling
├── popup.js                      # Popup UI interactive logic and settings manager
├── icons/                        # Extension icons (16px, 48px, 128px)
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── package.json                  # npm commands (lint, build, package)
├── .gitignore                    # Version control ignore list
├── INSTALLATION_GUIDE_FIREFOX.md # Quick installation reference
└── README.md                     # Comprehensive documentation (this file)
```

---

## 🚀 Installation Instructions

### 1. Firefox Desktop (Temporary Load)

This is the fastest method to run the extension in standard Firefox.

1. Open **Firefox** on your computer.
2. In the address bar, navigate to: `about:debugging`
3. Click **This Firefox** on the left menu bar.
4. Click **Load Temporary Add-on...**.
5. Browse to the `dvsa-firefox-extension` folder and select `manifest.json`.
6. The extension is now loaded! You will see the 🎯 **Test Booking** icon in your toolbar.

> *Note: Temporary add-ons remain loaded until Firefox is restarted.*

---

### 2. Firefox Desktop via `web-ext`

For active development or testing:

1. Ensure Node.js is installed.
2. Run the following command in the project folder:
   ```bash
   npm run start
   ```
   *Or:*
   ```bash
   npx web-ext run
   ```
3. A temporary Firefox instance will launch automatically with the extension pre-loaded and auto-reloading enabled.

---

### 3. Firefox Android

To run in **Firefox Nightly for Android**:

1. Enable **Developer Options** in Firefox Nightly (Settings -> About Firefox Nightly -> Tap logo 5 times).
2. Set up a **Custom Add-on Collection** in Settings using your Mozilla account.
3. Alternatively, connect your Android device via USB with ADB debugging enabled and run:
   ```bash
   npx web-ext run --target=firefox-android
   ```

---

## 📦 Packaging & Building for Release

### 1. Building the Extension Package

To create a clean release package (`.zip` / `.xpi`) ready for installation or submission:

#### Option A: Using npm / web-ext (Recommended)
Run:
```bash
npm run build
```
This runs `npx web-ext build --overwrite-dest` and packages the extension into:
```
web-ext-artifacts/testbooking-1.0.1.zip
```

#### Option B: Manual Packaging
If creating a package manually via command line:
```bash
zip -r dvsa-firefox-extension-v1.0.1.zip . -x "*.git*" "web-ext-artifacts/*" "node_modules/*" "*.DS_Store*"
```

---

### 2. Signing & Publishing on AMO (Add-ons for Firefox)

Firefox requires extension packages to be signed by Mozilla before permanent installation in regular Firefox builds.

#### Self-Hosted Unlisted Extension (XPI):
1. Obtain an API Key & Secret from the [Mozilla Add-on Developer Hub](https://addons.mozilla.org/en-US/developers/addon/api/key/).
2. Run the sign command:
   ```bash
   npx web-ext sign --api-key="YOUR_AMO_ISSUER" --api-secret="YOUR_AMO_SECRET"
   ```
3. `web-ext` will submit the extension, download the signed `.xpi` file to `web-ext-artifacts/`, which can then be directly installed into any standard Firefox browser.

#### Public AMO Listing:
Upload the generated `testbooking-1.0.1.zip` directly to [AMO Submission Dashboard](https://addons.mozilla.org/en-US/developers/addon/submit/distribution).

---

## 🛠️ Configuration & Usage Guide

### 1. Configuring Sniper Settings

1. Click the **🎯 Test Booking** extension icon in Firefox.
2. Under the **⚙️ Settings** tab, complete the required fields:
   - **Driving Licence Number**: Your UK Driving Licence ID (e.g. `SMITH901024A999`).
   - **Home Postcode**: Your local postcode (e.g. `SW1A 1AA`).
   - **Preferred Test Centre (Optional)**: Filter by specific centres (e.g. `Croydon, Mitcham`). Leave blank for any nearest centre.
   - **Earliest Preferred Date**: Format `DD/MM/YYYY` (e.g. `01/09/2026`). Slots prior to this date will be skipped.
3. Under **Advanced Timing**:
   - **Batch Size**: Number of searches before taking a break (Default: `10`).
   - **Delay Between Searches**: Delay between consecutive page checks (Default: `1500` ms).
   - **Delay Between Batches**: Cooldown pause duration after a batch (Default: `90000` ms / 1.5 mins).
4. Click **💾 Save Settings**.
5. Click **▶ START SNIPER**.
6. Click **🌐 Open DVSA Portal in Firefox** (or navigate to `https://driverpracticaltest.dvsa.gov.uk/application?execution=e1s2`).

---

### 2. Setting Up Mobile Push Alerts

Receiving instant phone alerts ensures you can quickly complete payment when a slot is reserved.

#### Method A: ntfy.sh (Recommended — Free & No Account Needed)
1. Install the free **ntfy app** on your phone ([Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [Apple App Store](https://apps.apple.com/us/app/ntfy/id1625396386)).
2. In the extension popup, switch to **📱 Push Alerts**.
3. Type a unique topic name in **ntfy.sh Topic Name** (e.g. `my_dvsa_alerts_891`).
4. In your phone's **ntfy** app, tap **+ Subscribe to topic** and enter the exact same topic name.
5. Click **💾 Save Push Alert Settings**.

#### Method B: Telegram Bot
1. Search for `@BotFather` in Telegram and create a new bot to receive your **Bot Token**.
2. Start a chat with your bot and fetch your **Chat ID** (e.g. via `@userinfobot`).
3. Enter your Token & Chat ID into the **Telegram Bot Notifications** section in the extension popup and click **Save**.

---

## 🛡️ Stealth & Anti-Pausing Architecture

When Firefox tabs lose focus or window minimization occurs, browsers usually throttle JavaScript timers and suspend tasks. This extension embeds multi-layered mitigation:

1. **Page Visibility Spoofing**: Overrides `document.hidden` (returns `false`) and `document.visibilityState` (returns `'visible'`) in the DOM main world.
2. **Focus State Spoofing**: Intercepts `blur` / `focusout` events and overrides `document.hasFocus()` to return `true`.
3. **Silent Web Audio Keep-Alive**: Plays an inaudible web audio loop (`gain = 0.00001`). Firefox exempts tabs producing audio from background suspension.
4. **Web Worker Ticker**: Uses a dedicated background `Worker` for timers (`setInterval`/`clearInterval`) unaffected by main thread clamping.

---

## 🧪 Development & Linting

### Code Verification & Validation

Run the official Mozilla WebExtension linter to verify schema adherence:
```bash
npm run lint
```

Outputs:
```text
Validation Summary:
errors          0
notices         0
warnings        0
```

### Local Storage Keys

| Key | Description |
|---|---|
| `licenseId` | User driving licence number |
| `postcode` | Search postcode |
| `testCentre` | Preferred test centre filter string |
| `afterDate` | Earliest acceptable date string (`DD/MM/YYYY`) |
| `isRunning` | Boolean flag indicating whether sniper engine is active |
| `batchSize` | Max searches per batch |
| `timeBetweenSearches` | Inter-search delay in ms |
| `timeBetweenBatches` | Inter-batch pause in ms |
| `ntfyTopic` | Configured ntfy.sh topic name |
| `telegramToken` | Telegram Bot token |
| `telegramChatId` | Telegram chat recipient ID |
| `logs` | Rolling logs array (max 200 items) |

---

## 🔄 CI/CD Pipelines & GitHub Workflows

This repository includes pre-configured **GitHub Actions** workflows located in `.github/workflows/`:

1. **Continuous Integration & Linting (`.github/workflows/ci.yml`)**:
   - Triggers automatically on every `push` and `pull_request` to `main`/`master`.
   - Validates JSON manifest syntax and runs `npx web-ext lint` to guarantee code quality.
   - Builds the `.zip` extension package and stores it as a build artifact.

2. **Automated GitHub Releases (`.github/workflows/release.yml`)**:
   - Triggers when a new version tag (e.g. `v1.0.1`) is pushed or manually invoked.
   - Automatically compiles the extension and publishes a GitHub Release with the bundled `.zip` attached.

3. **Mozilla AMO Signing & Publishing (`.github/workflows/amo-submit.yml`)**:
   - Manual workflow (`workflow_dispatch`) to automatically sign and submit `.xpi` extensions to Mozilla Add-ons (requires `AMO_JWT_ISSUER` & `AMO_JWT_SECRET` in GitHub Secrets).

---

## 📄 License

Distributed under the MIT License.
