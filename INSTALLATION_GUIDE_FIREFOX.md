# 🚀 DVSA Test Booking Sniper - Quick Installation & Packaging Guide

For full details, architecture, and configuration documentation, please see [README.md](README.md).

---

## 💻 Quick Install: Firefox Desktop

1. Open **Firefox** on your computer.
2. In the address bar, go to `about:debugging`
3. Click **"This Firefox"** on the left menu.
4. Click **"Load Temporary Add-on..."**.
5. Select `manifest.json` from this folder.
6. The 🎯 **Test Booking** icon will appear in your toolbar.

---

## 🛠️ CLI Quick Start & Development

Using Node.js & `npm`:

```bash
# Run extension in Firefox with live auto-reloading
npm run start

# Validate extension code with Mozilla web-ext linter
npm run lint

# Package extension into zip ready for distribution / release
npm run build
```

The output zip file will be generated at `web-ext-artifacts/testbooking-1.0.1.zip`.

---

## 📱 Quick Setup: Mobile Push Alerts (ntfy.sh)

1. Download the free **ntfy app** ([Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [Apple App Store](https://apps.apple.com/us/app/ntfy/id1625396386)).
2. Open extension popup -> **📱 Push Alerts** tab -> enter a unique topic name (e.g. `my_dvsa_alerts_123`).
3. In the phone app, tap **+ Subscribe to topic** and enter the exact same topic name.
4. Alerts will sound instantly when a test slot is found or a captcha requires attention!
