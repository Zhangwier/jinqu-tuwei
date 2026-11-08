// 渲染基准：无头 Edge + CDP，在 720x1280 逻辑画布上按手机像素密度重绘 N 帧，
// 分别统计 JS 绘制耗时与强制光栅化（getImageData 同步）耗时。
// 用法：node test/render_bench.js [宽] [高] [帧数] [快进秒数]
const { spawn } = require('child_process');
const http = require('http');

const W = +(process.argv[2] || 1170);
const H = +(process.argv[3] || 2080);
const FRAMES = +(process.argv[4] || 40);
const FF = +(process.argv[5] || 120);
const MUT = process.argv[6] || '';
const PORT = 9224;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = `${process.env.TEMP}\\jq-bench-${process.pid}`;

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
    '--window-size=400,900', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--enable-gpu', '--use-angle=d3d11', 'about:blank',
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
    await sleep(2000);
    const out = await evaluate(`(() => {
      const JQ = window.JQ;
      const C = JQ.C;
      const game = new JQ.Game({ seed: 424242, pack: 'sanguo', enemyPack: 'xiyou' });
      let aiT = [0, 0];
      for (let k = 0; k < ${FF} * 60 && !game.over; k++) {
        for (const sid of [0, 1]) if ((aiT[sid] -= 1/60) <= 0) (JQ.aiThink(game, sid), (aiT[sid] = 0.9));
        game.step(1/60);
      }
      const c = document.createElement('canvas');
      c.width = ${W}; c.height = ${H};
      const g = c.getContext('2d', { alpha: false });
      const sx = ${W} / C.W, sy = ${H} / C.H;
      g.setTransform(sx, 0, 0, sy, 0, 0);
      const view = { g, speed: 1, selected: -1, selectedCell: null, info: '', infoT: 0, heldCard: null, dragFrom: null, dragPos: null, hoverCell: null, target: null, anims: [], shopAnim: null, bunPop: 0 };
      const mut = '${MUT}';
      if (mut === 'nounits') game.units = [];
      if (mut === 'nofx') game.fx = [];
      if (mut === 'nocard') for (const s of game.sides) for (const x of s.board.all()) x.card = null;
      if (mut === 'nocells') for (const s of game.sides) for (const x of s.board.all()) x.unlocked = false;
      if (mut === 'nobg') {
        const od = g.drawImage.bind(g);
        g.drawImage = function (img) {
          if (img && img.width === C.W && img.height === C.H) return;
          return od.apply(null, arguments);
        };
      }
      if (mut === 'nohud') {
        // 画完战场后裁掉 HUD：直接改窄画布不现实，这里用空 game 的 HUD 近似（仍会画血条）
      }
      const js = [], flush = [];
      for (let i = 0; i < 8; i++) JQ.render(game, view);
      for (let i = 0; i < ${FRAMES}; i++) {
        game.time += 1/60;
        const t0 = performance.now();
        JQ.render(game, view);
        const t1 = performance.now();
        g.getImageData(0, 0, 1, 1);
        const t2 = performance.now();
        js.push(t1 - t0); flush.push(t2 - t1);
      }
      const stat = (a) => {
        const s = a.slice().sort((x, y) => x - y);
        return { avg: +(a.reduce((p, q) => p + q, 0) / a.length).toFixed(2), p50: +s[Math.floor(s.length / 2)].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2) };
      };
      return {
        canvas: [${W}, ${H}], frames: ${FRAMES}, time: +game.time.toFixed(1), over: game.over,
        units: game.units.length, fx: game.fx.length, projectiles: game.projectiles.length,
        cards: game.sides.reduce((n, s) => n + s.board.all().filter((x) => x.card).length, 0),
        js: stat(js), flush: stat(flush),
      };
    })()`);
    console.log(JSON.stringify(out, null, 2));
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
  }
})().catch((e) => { console.error(e); process.exit(1); });
