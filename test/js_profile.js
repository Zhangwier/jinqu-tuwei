// JS 热点剖析：对 JQ.render 跑 N 帧，用 CDP Profiler 统计自耗时。
// 用法：node test/js_profile.js [帧数] [快进秒数]
const { spawn } = require('child_process');
const http = require('http');

const FRAMES = +(process.argv[2] || 200);
const FF = +(process.argv[3] || 100);
const PORT = 9226;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = `${process.env.TEMP}\\jq-prof-${process.pid}`;

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
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails));
      return r.result && r.result.result && r.result.result.value;
    };
    await send('Page.enable');
    await send('Page.navigate', { url: 'http://127.0.0.1:8731/' });
    await sleep(1800);
    await evaluate(`(() => {
      const JQ = window.JQ, C = JQ.C;
      const game = new JQ.Game({ seed: 424242, pack: 'sanguo', enemyPack: 'xiyou' });
      let aiT = [0, 0];
      for (let k = 0; k < ${FF} * 60 && !game.over; k++) {
        for (const sid of [0, 1]) if ((aiT[sid] -= 1/60) <= 0) (JQ.aiThink(game, sid), (aiT[sid] = 0.9));
        game.step(1/60);
      }
      const c = document.createElement('canvas'); c.width = 683; c.height = 1213;
      const g = c.getContext('2d', { alpha: false });
      g.setTransform(683/720, 0, 0, 1213/1280, 0, 0);
      window.__benchScene = { game, view: { g, speed: 1, selected: -1, selectedCell: null, info: '', infoT: 0, heldCard: null, dragFrom: null, dragPos: null, hoverCell: null, target: null, anims: [], shopAnim: null, bunPop: 0 } };
      return { units: game.units.length, fx: game.fx.length, cards: game.sides.reduce((n, s) => n + s.board.all().filter((x) => x.card).length, 0) };
    })()`);
    await send('Profiler.enable');
    await send('Profiler.setSamplingInterval', { interval: 100 });
    await send('Profiler.start');
    await evaluate(`(() => {
      const { game, view } = window.__benchScene;
      for (let i = 0; i < ${FRAMES}; i++) { game.time += 1/60; JQ.render(game, view); }
      return true;
    })()`);
    const prof = (await send('Profiler.stop')).result.profile;
    const byId = new Map(prof.nodes.map((n) => [n.id, n]));
    const counts = new Map();
    for (const s of prof.samples) counts.set(s, (counts.get(s) || 0) + 1);
    const total = prof.samples.length;
    const rows = [...counts.entries()].map(([nid, n]) => {
      const node = byId.get(nid);
      const cf = node.callFrame;
      return { n, name: cf.functionName || '(anon)', url: (cf.url || '').split('/').slice(-1)[0], line: cf.lineNumber + 1 };
    }).sort((a, b) => b.n - a.n).slice(0, 30);
    const durMs = (prof.endTime - prof.startTime) / 1000;
    console.log(`samples=${total} profile=${durMs.toFixed(0)}ms frames=${FRAMES} perFrame=${(durMs / FRAMES).toFixed(2)}ms`);
    for (const r of rows) console.log(`${(r.n / total * 100).toFixed(1)}%\t${r.name}\t${r.url}:${r.line}`);
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
  }
})().catch((e) => { console.error(e); process.exit(1); });
