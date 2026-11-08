// 帧率探针：无头 Edge + CDP，测真实 rAF 帧率与 JQ.render / Game.step 耗时。
// 用法：node test/perf_probe.js [url] [秒数] [宽] [高]
// 默认 http://127.0.0.1:8731/?auto=1&t=150 ，模拟手机竖屏 390x844。
const { spawn } = require('child_process');
const http = require('http');

const URL = process.argv[2] || 'http://127.0.0.1:8731/?auto=1&t=150';
const SECONDS = +(process.argv[3] || 8);
const W = +(process.argv[4] || 390);
const H = +(process.argv[5] || 844);
const DPR = +(process.argv[6] || 3);
const THROTTLE = +(process.argv[7] || 1);
const PORT = 9223;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = `${process.env.TEMP}\\jq-perf-${process.pid}`;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path }, (res) => {
      let s = '';
      res.on('data', (d) => (s += d));
      res.on('end', () => {
        try { resolve(JSON.parse(s)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const proc = spawn(EDGE, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${W},${H}`,
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--enable-gpu',
    '--use-angle=d3d11',
    'about:blank',
  ], { stdio: 'ignore' });
  try {
    let tabs = null;
    for (let i = 0; i < 50; i++) {
      try { tabs = await getJson('/json/list'); break; } catch (e) { await sleep(200); }
    }
    if (!tabs) throw new Error('CDP not ready');
    const tab = tabs.find((t) => t.type === 'page');
    const ws = new WebSocket(tab.webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
    };
    const send = (method, params) => new Promise((resolve) => {
      const mid = ++id;
      pending.set(mid, resolve);
      ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
    });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result && r.result.result.value;
    };

    await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true });
    if (THROTTLE > 1) await send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
    await send('Page.enable');
    await send('Page.navigate', { url: URL });
    await sleep(2500);
    const info = await evaluate(`(() => {
      const c = document.getElementById('game');
      return { title: document.title, w: c && c.width, h: c && c.height, game: !!(window.JQ && JQ.render) };
    })()`);
    if (!info || !info.game) throw new Error('page not ready: ' + JSON.stringify(info));

    await evaluate(`(() => {
      const JQ = window.JQ;
      const S = window.__perf = { frames: 0, render: 0, step: 0, intervals: [], long: 0, start: performance.now() };
      const r = JQ.render;
      JQ.render = function () { const t = performance.now(); const v = r.apply(this, arguments); S.render += performance.now() - t; return v; };
      const st = JQ.Game.prototype.step;
      JQ.Game.prototype.step = function () { const t = performance.now(); const v = st.apply(this, arguments); S.step += performance.now() - t; return v; };
      let last = performance.now();
      function tick(now) {
        S.frames++;
        const d = now - last;
        S.intervals.push(d);
        if (d > 25) S.long++;
        last = now;
        S.raf = requestAnimationFrame(tick);
      }
      S.raf = requestAnimationFrame(tick);
      return true;
    })()`);
    await sleep(SECONDS * 1000);
    const out = await evaluate(`(() => {
      const S = window.__perf;
      const iv = S.intervals.slice(1).sort((a, b) => a - b);
      const pct = (p) => iv.length ? +iv[Math.min(iv.length - 1, Math.floor(iv.length * p))].toFixed(2) : 0;
      const sum = iv.reduce((a, b) => a + b, 0);
      const el = (performance.now() - S.start) / 1000;
      return {
        frames: S.frames, seconds: +el.toFixed(2), fps: +(S.frames / el).toFixed(1),
        avgFrameMs: +(sum / Math.max(1, iv.length)).toFixed(2),
        p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1),
        longFrames: S.long,
        renderMsPerFrame: +(S.render / S.frames).toFixed(2),
        stepMsPerFrame: +(S.step / S.frames).toFixed(2),
        canvas: [document.getElementById('game').width, document.getElementById('game').height],
        units: (window.JQ && window.__jqGame) ? window.__jqGame.units.length : null,
      };
    })()`);
    console.log(JSON.stringify(out, null, 2));
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
  }
})().catch((e) => { console.error(e); process.exit(1); });
