// Dev harness: drive a real Firefox over WebDriver BiDi to test the extension
// against the live DVSA site. Not shipped in the extension (see webExt.ignoreFiles).
//
//   node scripts/bidi.mjs launch            start Firefox + daemon, install extension
//   node scripts/bidi.mjs shot [file]       screenshot the DVSA tab
//   node scripts/bidi.mjs eval "<js>"       evaluate JS (function body) in the DVSA tab
//   node scripts/bidi.mjs goto <url>        navigate the DVSA tab
//   node scripts/bidi.mjs ext "<js>"        evaluate JS in an extension page (has `browser`)
//   node scripts/bidi.mjs logs [n]          print engine state + last n log lines
//   node scripts/bidi.mjs reload            reinstall the extension from disk
//   node scripts/bidi.mjs quit
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, openSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.BIDI_PORT || 9333);
const CTRL = PORT + 1;
const DIR = process.env.BIDI_STATE_DIR || tmpdir();

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'launch') {
  const out = openSync(path.join(DIR, 'dvsa-firefox.log'), 'a');
  spawn(process.execPath, [fileURLToPath(import.meta.url), 'daemon'],
    { detached: true, stdio: ['ignore', out, out], env: process.env }).unref();
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 500));
    const r = await fetch(`http://127.0.0.1:${CTRL}/ready`).catch(() => null);
    if (r?.ok) { console.log(await r.text()); process.exit(0); }
  }
  console.error('daemon did not start; see', path.join(DIR, 'dvsa-firefox.log'));
  process.exit(1);
} else if (cmd === 'daemon') {
  await daemon();
} else {
  const r = await fetch(`http://127.0.0.1:${CTRL}/cmd`, {
    method: 'POST', body: JSON.stringify({ cmd, args })
  }).catch(() => null);
  if (!r) { console.error('daemon not running: node scripts/bidi.mjs launch'); process.exit(1); }
  const text = await r.text();
  console.log(text);
  process.exit(r.ok ? 0 : 1);
}

async function daemon() {
  const profile = mkdtempSync(path.join(tmpdir(), 'dvsa-ff-'));
  writeFileSync(path.join(profile, 'user.js'), [
    'user_pref("browser.shell.checkDefaultBrowser", false);',
    'user_pref("browser.aboutwelcome.enabled", false);',
    'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
    'user_pref("devtools.console.stdout.content", true);',
    'user_pref("browser.startup.homepage_override.mstone", "ignore");',
  ].join('\n'));
  const ff = spawn('firefox', ['--no-remote', '--profile', profile, `--remote-debugging-port=${PORT}`,
    '--width', '430', '--height', '900', 'about:blank'], { stdio: 'inherit' });
  ff.on('exit', () => process.exit(0));

  let ws;
  for (let i = 0; i < 40 && !ws; i++) {
    await new Promise(r => setTimeout(r, 500));
    ws = await new Promise(ok => {
      const s = new WebSocket(`ws://127.0.0.1:${PORT}/session`);
      s.onopen = () => ok(s);
      s.onerror = () => ok(null);
    });
  }
  let id = 0;
  const pending = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { ok, bad } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.type === 'error' ? bad(new Error(`${msg.error}: ${msg.message}`)) : ok(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((ok, bad) => {
    const n = ++id;
    pending.set(n, { ok, bad });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  await send('session.new', { capabilities: {} });

  let extension = (await send('webExtension.install', { extensionData: { type: 'path', path: ROOT } })).extension;
  const info = JSON.stringify({ pid: ff.pid, profile, extension });

  const extUuid = () => {
    const prefs = readFileSync(path.join(profile, 'prefs.js'), 'utf8');
    const m = prefs.match(/extensions\.webextensions\.uuids", "(.*)"\);/);
    return JSON.parse(m[1].replace(/\\(.)/g, '$1'))[extension];
  };
  const tree = async () => (await send('browsingContext.getTree', {})).contexts;
  const dvsa = async () => {
    const all = await tree();
    return (all.find(c => c.url.includes('dvsa.gov.uk')) || all.find(c => !c.url.startsWith('moz-extension')) || all[0]).context;
  };
  const evaluate = async (context, body) => {
    const r = await send('script.evaluate', {
      expression: `(async () => { ${body} })()`,
      target: { context }, awaitPromise: true, resultOwnership: 'none'
    });
    if (r.type === 'exception') throw new Error(r.exceptionDetails.text);
    return unwrap(r.result);
  };
  const inExtension = async (body) => {
    const { context } = await send('browsingContext.create', { type: 'tab', background: true });
    try {
      await send('browsingContext.navigate', { context, url: `moz-extension://${extUuid()}/popup.html`, wait: 'complete' });
      return await evaluate(context, body);
    } finally {
      await send('browsingContext.close', { context }).catch(() => {});
    }
  };

  const handlers = {
    async shot([file]) {
      const context = await dvsa();
      const { data } = await send('browsingContext.captureScreenshot', { context, origin: 'viewport' });
      file ||= path.join(DIR, 'dvsa-shot.png');
      writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    },
    async goto([url]) {
      const context = await dvsa();
      await send('browsingContext.navigate', { context, url, wait: 'complete' }).catch(e => e.message);
      return evaluate(context, 'return location.href + " | " + document.title');
    },
    async eval([body]) { return evaluate(await dvsa(), body); },
    async tree() { return (await tree()).map(c => ({ url: c.url, kids: (c.children || []).map(k => k.url) })); },
    async ext([body]) { return inExtension(body); },
    async logs([n = 40]) {
      return inExtension(`const { logs = [], ...s } = await browser.storage.local.get(null);
        delete s.licenseId;
        return { state: s, logs: logs.slice(-${Number(n)}).map(l => l.timestamp + ' ' + l.level + ' ' + l.message) };`);
    },
    async reload() {
      await send('webExtension.uninstall', { extension }).catch(() => {});
      extension = (await send('webExtension.install', { extensionData: { type: 'path', path: ROOT } })).extension;
      return 'reinstalled ' + extension;
    },
    async quit() { setTimeout(() => ff.kill(), 100); return 'bye'; }
  };

  createServer(async (req, res) => {
    if (req.url === '/ready') { res.end(info); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
      const { cmd, args } = JSON.parse(body);
      if (!handlers[cmd]) throw new Error('unknown command ' + cmd);
      const out = await handlers[cmd](args);
      res.end(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
    } catch (e) {
      res.statusCode = 500;
      res.end(String(e.message || e));
    }
  }).listen(CTRL, '127.0.0.1');
}

function unwrap(v) {
  if (!v) return v;
  switch (v.type) {
    case 'undefined': return undefined;
    case 'null': return null;
    case 'string': case 'number': case 'boolean': return v.value;
    case 'array': return v.value.map(unwrap);
    case 'object': return Object.fromEntries(v.value.map(([k, val]) => [typeof k === 'string' ? k : unwrap(k), unwrap(val)]));
    default: return `[${v.type}]`;
  }
}
