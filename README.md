# DVSA Test Booking: Firefox for Android Extension

A Firefox for Android extension that watches the DVSA practical test booking site (`driverpracticaltest.dvsa.gov.uk`). It finds the first slot that matches your settings and either reserves it or just alerts you, using normal Android notifications. You don't need any third-party apps or accounts.

Desktop Firefox is no longer supported. Development uses it only as a test harness.

## Install on your phone

Firefox for Android only installs add-ons that Mozilla has signed. The release pipeline signs every build, so:

1. On your phone, open this link in Firefox to download the add-on:
   **https://github.com/JacobInwald/dvsa-firefox-extension/releases/latest/download/testbooking.xpi**
2. In Firefox, open **Settings → About Firefox** and tap the Firefox logo **5 times** to enable the debug menu.
3. Go back to **Settings** and tap **Install add-on from file**, then pick `testbooking.xpi` from your Downloads.
4. In Android settings, make sure **notifications are allowed for Firefox**, and set **Apps → Firefox → Battery** to **Unrestricted**.
5. Open the extension (**⋮ menu → Extensions → TestBooking**), then tap **🔔 Send Test Notification** to confirm alerts work.

You can also install a signed `.xpi` straight from a web server on your Wi-Fi. Serve it as `application/x-xpinstall` and Firefox offers to install it when you open the link.

## Usage

1. **Settings** tab: enter your licence number and postcode. The test centres (comma-separated) and earliest date (`DD/MM/YYYY`) are optional. If you leave the date blank, it searches from today.
   - **Alert only:** notifies you when a slot is found but doesn't reserve it, so you can book it yourself.
   - **Background mode** (on by default): see below.
2. Tap **Save Settings**, then **START SNIPER**. This reloads your DVSA tab, or opens the portal if none is open.
3. If a green **"Tap once…"** banner appears, tap it. To stop it appearing, set **Firefox Settings → Site permissions → Autoplay → Allow audio and video**.

You get a notification for each of these, written to match what's on screen:

| Alert | What happens |
|---|---|
| 🧩 Captcha | DVSA shows an hCaptcha. Solve it and the sniper carries on by itself. It reminds you after 5, 15 and 30 minutes. |
| ⛔ Blocked by DVSA bot protection | Imperva refused the request (shows the incident ID). The sniper stops. |
| ⛔ Search limit reached | DVSA's search limit page appeared. The sniper stops. |
| ⏳ In the DVSA queue | It waits in the queue and carries on when it's your turn. |
| 🌙 Booking is closed | Outside DVSA's opening hours. The sniper stops. |
| 🎯 Slot available | Alert-only mode found a slot (date, time and centre). |
| 🎉 Slot reserved | A slot is being held. Finish your details and payment quickly. |
| ❓ Stuck | It doesn't recognise the page after two reloads. Shows the page heading and stops. |

The same alert isn't repeated within 10 minutes. Tapping an alert opens the DVSA tab. The **Logs** tab shows step by step what the engine is doing.

## Running in the background

Android freezes Firefox when it's in the background or the screen is off, unless a tab is playing media. While a tab plays, Firefox runs a media foreground service.

TestBooking plays an inaudible 20 Hz tone (`keepalive.wav`) to stay awake. In **background mode**, the DVSA tab becomes a host page that never navigates. It plays the tone and shows the DVSA pages in a full-screen same-origin frame. Moving between DVSA pages then never interrupts the sound. If each page played the sound itself, every page load would stop it. Android 12+ doesn't let Firefox restart its foreground service from the background, so Firefox would be frozen after the first search.

While it's running you'll see a media notification. Pausing it stops the sniper. When the sniper stops, the tab turns back into a normal DVSA page.

**Testing it:** start the sniper, lock the phone for 10+ minutes, then open **Control → 📱 Background health**. It lists every time Firefox was frozen (gaps in the engine's 10-second heartbeat). The same gaps are written to the Logs tab.

## Releasing a new version

You need two repo secrets set once: `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Get them from <https://addons.mozilla.org/developers/addon/api/key/>.

```bash
npm run version 1.0.8          # bumps manifest.json + package.json
git commit -am "v1.0.8"
git tag v1.0.8 && git push --follow-tags
```

The **Release** workflow lints the extension, gets it signed by Mozilla (unlisted, so it isn't public on AMO) and publishes a GitHub Release with `testbooking.xpi`. The download link above always points at the latest release.

To sign locally instead, put `WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` in `.env` and run `npm run sign`. The signed `.xpi` lands in `web-ext-artifacts/`.

Each signed version must be higher than the last one.

## Development

```bash
npm install
npm run lint             # web-ext lint
npm run build            # unsigned zip in web-ext-artifacts/
npm start                # run on a phone over USB (adb + Firefox "Remote debugging via USB")
```

### Live test harness

`scripts/bidi.mjs` drives a throwaway desktop Firefox profile over WebDriver BiDi, with the extension installed, so you can test against the real DVSA site from a computer:

```bash
node scripts/bidi.mjs launch          # start Firefox + control daemon, install extension
node scripts/bidi.mjs goto <url>      # navigate the DVSA tab
node scripts/bidi.mjs shot [file]     # screenshot the DVSA tab
node scripts/bidi.mjs eval "<js>"     # run JS (function body) in the DVSA tab
node scripts/bidi.mjs ext "<js>"      # run JS in an extension page (has `browser`)
node scripts/bidi.mjs logs [n]        # engine state + last n log lines (licence redacted)
node scripts/bidi.mjs reload          # reinstall the extension from disk
node scripts/bidi.mjs quit
```

Remote-control mode is detectable: Imperva challenges and often blocks these sessions. To test the full booking flow, run the extension in a normal profile with `web-ext run --firefox-profile <dir> --keep-profile-changes` instead.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest (Firefox for Android) |
| `background.js` | Notifications, logs, watchdog |
| `content.js` | Host page (background mode) and the booking engine on DVSA pages |
| `stealth.js` | Page-world script injected on DVSA pages: visibility/focus spoofing, silent audio, worker timers |
| `keepalive.wav` | Inaudible looping tone that keeps Firefox awake in the background |
| `popup.html/css/js` | Settings, controls, background health and logs |
| `scripts/set-version.mjs` | Version bump helper used by the release pipeline |
| `scripts/bidi.mjs` | Live test harness (not shipped) |

## License

MIT
