// 无头 Edge 截图（CDP 精确模拟手机视口/DPR）。
// 用法：node test/shot.js <url> <输出png> [宽] [高] [dpr] [等待ms]
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

const URL = process.argv[2] || 'http://127.0.0.1:8731/?auto=1&t=90';
const OUT = process.argv[3] || 'shot.png';
const W = +(process.argv[4] || 390);
const H = +(process.argv[5] || 844);
const DPR = +(process.argv[6] || 3);
const WAIT = +(process.argv[7] || 2500);
const EVAL = process.argv[8] || '';
const THROTTLE = +(process.argv[9] || 1);
const PORT = 9225;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = `${process.env.TEMP}\\jq-shot-${process.pid}`;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check', '--enable-gpu', '--use-angle=d3d11', 'about:blank',
  ], { stdio: 'ignore' });
  try {
    let tabs = null;
    for (let i = 0; i < 50; i++) {
      try { tabs = await getJson('/json/list'); break; } catch (e) { await sleep(200); }
    }
    const tab = tabs.find((t) => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((resolve) => {
      const mid = ++id; pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') console.error('PAGE ERROR', m.params.exceptionDetails.text, m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') console.error('CONSOLE', m.params.args.map((a) => a.value).join(' '));
    });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
    if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await send('Page.enable');
    await send('Page.navigate', { url: URL });
    await sleep(WAIT);
    if (EVAL) {
      const r = await send('Runtime.evaluate', { expression: EVAL, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) console.error('EVAL ERROR', JSON.stringify(r.result.exceptionDetails));
      else console.log('EVAL', JSON.stringify(r.result.result && r.result.result.value));
      await sleep(1200);
    }
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    if (!r.result || !r.result.data) throw new Error(JSON.stringify(r));
    fs.writeFileSync(OUT, Buffer.from(r.result.data, 'base64'));
    console.log(OUT + ' ' + fs.statSync(OUT).size);
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
  }
})().catch((e) => { console.error(e); process.exit(1); });
