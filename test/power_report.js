// 实力数据：小兵/英雄的对抗、团战和 DPS 基准。用法：
//   node test/power_report.js units  [seeds] [level]
//   node test/power_report.js heroes [seeds]
//   node test/power_report.js all
// 结果写入 test/power_report.md 和 test/power_report.json。
const fs = require('fs');
const path = require('path');
for (const f of ['data', 'board', 'sim', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const JQ = globalThis.JQ;

const MODE = process.argv[2] || 'all';
const SEEDS = Math.max(1, +(process.argv[3] || 1));
const LEVEL = Math.max(1, +(process.argv[4] || 1));
const DT = 1 / 30;
const MAX_T = 30;

function game(seed) {
  const g = new JQ.Game({ seed, pack: 'sanguo' });
  g.R.time = 1e9;
  g.R.overtime = 0;
  return g;
}
function spawnU(g, s, key, level, x, y) {
  const u = g.spawnUnit(s, key, level, x, { x, y });
  u.atkT = 0.2;
  u.target = null;
  return u;
}
function spawnH(g, s, name, level, x, y) {
  const h = g.spawnHero(s, name, level, x, { y });
  h.ultT = 0;
  h.skillT = 0;
  h.atkT = 0.2;
  return h;
}
function alive(g, side) {
  return g.units.filter((u) => u.side === side && u.hp > 0 && !u.isOutpost);
}
function hpFrac(g, side) {
  const us = alive(g, side);
  if (!us.length) return 0;
  let hp = 0, max = 0;
  for (const u of us) (hp += Math.max(0, u.hp)), (max += u.maxHp || 1);
  return max ? hp / max : 0;
}
function winnerOf(g) {
  const a = alive(g, 0).length, b = alive(g, 1).length;
  if (a && !b) return 0;
  if (b && !a) return 1;
  if (!a && !b) return -1;
  return -1; // 仍在对打，交给调用方按血量判定
}
function fight(g, maxT) {
  let t = 0;
  while (t < maxT && !g.over) {
    g.step(DT);
    t += DT;
    const w = winnerOf(g);
    if (w >= 0 && (!alive(g, 0).length || !alive(g, 1).length)) return { win: w, t, hp0: hpFrac(g, 0), hp1: hpFrac(g, 1) };
  }
  const f0 = hpFrac(g, 0), f1 = hpFrac(g, 1);
  return { win: Math.abs(f0 - f1) < 1e-6 ? -1 : f0 > f1 ? 0 : 1, t, hp0: f0, hp1: f1 };
}

// ---------- 小兵 ----------
function unitFight(a, b, level, n, seed) {
  const g = game(seed);
  const A = g.sides[0], B = g.sides[1];
  for (let i = 0; i < n; i++) {
    const col = i % 3, row = Math.floor(i / 3);
    const x = 330 + col * 30 + row * 15;
    spawnU(g, A, a, level, x, 620 + row * 18);
    spawnU(g, B, b, level, x, 540 - row * 18);
  }
  return fight(g, MAX_T);
}
function unitTable(level, n, seeds) {
  const keys = JQ.ALL_UNITS;
  const stats = {};
  for (const k of keys) stats[k] = { w: 0, l: 0, t: 0, hp: 0, time: 0, games: 0 };
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      for (let s = 0; s < seeds; s++)
        for (let o = 0; o < 2; o++) {
          const a = o ? keys[j] : keys[i], b = o ? keys[i] : keys[j];
          const r = unitFight(a, b, level, n, 1000 + s * 999 + i * 37 + j * 11 + o);
          const A = stats[a], B = stats[b];
          A.games++; B.games++;
          A.time += r.t; B.time += r.t;
          if (r.win === 0) (A.w++, B.l++, (A.hp += r.hp0));
          else if (r.win === 1) (B.w++, A.l++, (B.hp += r.hp1));
          else (A.t++, B.t++);
        }
  return keys
    .map((k) => {
      const s = stats[k];
      return { key: k, ...s, win: s.w / Math.max(1, s.games), hpWin: s.hp / Math.max(1, s.w), avgT: s.time / Math.max(1, s.games) };
    })
    .sort((a, b) => b.win - a.win || b.hpWin - a.hpWin);
}

// 混编：测试兵 + 2 盾 + 2 弓，对手用另一兵组成同样模板；比较谁更适合当队伍里的那个“C 位”
function unitMixedFight(a, b, level, seed) {
  const g = game(seed);
  const put = (s, side, key, x, y, isTest) => {
    const d = JQ.UNITS[key];
    const fy = side === 0 ? (d.ranged ? 660 : 620) : (d.ranged ? 500 : 540);
    const u = spawnU(g, s, key, level, x, isTest ? fy : y);
    return u;
  };
  const build = (s, side, key) => {
    const base = side === 0 ? 620 : 540, back = side === 0 ? 660 : 500;
    put(s, side, key, 360, 0, true);
    put(s, side, '盾', 320, base, false);
    put(s, side, '盾', 400, base, false);
    put(s, side, '弓', 320, back, false);
    put(s, side, '弓', 400, back, false);
  };
  build(g.sides[0], 0, a);
  build(g.sides[1], 1, b);
  return fight(g, MAX_T);
}
function unitMixedTable(level, seeds) {
  const keys = JQ.ALL_UNITS;
  const stats = {};
  for (const k of keys) stats[k] = { w: 0, l: 0, t: 0, hp: 0, time: 0, games: 0 };
  for (let i = 0; i < keys.length; i++)
    for (let j = i + 1; j < keys.length; j++)
      for (let s = 0; s < seeds; s++)
        for (let o = 0; o < 2; o++) {
          const a = o ? keys[j] : keys[i], b = o ? keys[i] : keys[j];
          const r = unitMixedFight(a, b, level, 2000 + s * 991 + i * 41 + j * 13 + o);
          const A = stats[a], B = stats[b];
          A.games++; B.games++; A.time += r.t; B.time += r.t;
          if (r.win === 0) (A.w++, B.l++, (A.hp += r.hp0));
          else if (r.win === 1) (B.w++, A.l++, (B.hp += r.hp1));
          else (A.t++, B.t++);
        }
  return keys.map((k) => {
    const s = stats[k];
    return { key: k, ...s, win: s.w / Math.max(1, s.games), hpWin: s.hp / Math.max(1, s.w), avgT: s.time / Math.max(1, s.games) };
  }).sort((a, b) => b.win - a.win || b.hpWin - a.hpWin);
}
function unitDps(key, level) {
  const g = game(12345);
  const A = g.sides[0], B = g.sides[1];
  spawnU(g, A, key, level, 300, 600);
  const d = spawnU(g, B, '盾', 1, 470, 600);
  d.key = '桩';
  d.maxHp = d.hp = 1e6;
  d.atk = 0;
  d.speed = 0;
  d.range = 0;
  d.rate = 999;
  d.rangedReduce = 0;
  d.bonus = null;
  for (let t = 0; t < 10; t += DT) g.step(DT);
  return (1e6 - d.hp) / 10;
}

// ---------- 英雄 ----------
function heroFight(a, b, seed, team) {
  const g = game(seed);
  const A = g.sides[0], B = g.sides[1];
  const backRole = (n) => {
    const h = JQ.HEROES[n];
    return !!(h.ranged || h.role === '辅助' || h.role === '法师' || h.role === '射手' || h.role === '特殊');
  };
  const teamHeroY = (side, n) => (side === 0 ? (backRole(n) ? 680 : 600) : backRole(n) ? 480 : 560);
  spawnH(g, A, a, 3, 360, team ? teamHeroY(0, a) : 600);
  spawnH(g, B, b, 3, 360, team ? teamHeroY(1, b) : 560);
  if (team === 'blade') {
    for (let i = 0; i < 4; i++) {
      const x = 300 + (i % 2) * 60 + Math.floor(i / 2) * 30;
      spawnU(g, A, '刀', 1, x, 650);
      spawnU(g, B, '刀', 1, x, 510);
    }
  } else if (team === 'mix') {
    for (const side of [0, 1]) {
      const s = g.sides[side];
      const fr = side === 0 ? 630 : 530, bk = side === 0 ? 670 : 490;
      spawnU(g, s, '盾', 1, 310, fr);
      spawnU(g, s, '盾', 1, 410, fr);
      spawnU(g, s, '弓', 1, 310, bk);
      spawnU(g, s, '弓', 1, 410, bk);
    }
  }
  return fight(g, MAX_T);
}
function heroTable(seeds, team) {
  const names = Object.keys(JQ.HEROES);
  const stats = {};
  for (const n of names) stats[n] = { w: 0, l: 0, t: 0, hp: 0, time: 0, games: 0 };
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++)
      for (let s = 0; s < seeds; s++)
        for (let o = 0; o < 2; o++) {
          const a = o ? names[j] : names[i], b = o ? names[i] : names[j];
          const r = heroFight(a, b, 3000 + s * 997 + i * 53 + j * 17 + o, team);
          const A = stats[a], B = stats[b];
          A.games++; B.games++;
          A.time += r.t; B.time += r.t;
          if (r.win === 0) (A.w++, B.l++, (A.hp += r.hp0));
          else if (r.win === 1) (B.w++, A.l++, (B.hp += r.hp1));
          else (A.t++, B.t++);
        }
  return names
    .map((n) => {
      const h = JQ.HEROES[n];
      const s = stats[n];
      return { name: n, pack: h.pack, role: h.role, ...s, win: s.w / Math.max(1, s.games), hpWin: s.hp / Math.max(1, s.w), avgT: s.time / Math.max(1, s.games) };
    })
    .sort((a, b) => b.win - a.win || b.hpWin - a.hpWin);
}

// 英雄清兵：3 级英雄单挑 12 个标准小兵（2 盾 2 刀 2 枪 4 弓 2 刺）
function heroClear(name, seed, unitLevel) {
  const g = game(seed);
  const A = g.sides[0], B = g.sides[1];
  const h = JQ.HEROES[name];
  const back = h.ranged || h.role === '辅助' || h.role === '法师' || h.role === '射手' || h.role === '特殊';
  const hero = spawnH(g, A, name, 3, 360, back ? 680 : 600);
  const add = (key, x, y) => spawnU(g, B, key, unitLevel, x, y);
  add('盾', 300, 540); add('盾', 420, 540);
  add('刀', 280, 560); add('刀', 440, 560);
  add('枪', 300, 580); add('枪', 420, 580);
  add('弓', 280, 500); add('弓', 340, 500); add('弓', 380, 500); add('弓', 440, 500);
  add('刺', 300, 520); add('刺', 420, 520);
  const total = 12;
  let t = 0;
  while (t < MAX_T) {
    g.step(DT);
    t += DT;
    if (hero.hp <= 0) break;
    if (alive(g, 1).length === 0) break;
  }
  const kills = total - alive(g, 1).length;
  return { kills, total, clear: kills === total, hp: Math.max(0, hero.hp / hero.maxHp), t };
}
function heroClearTable(seeds, unitLevel) {
  const names = Object.keys(JQ.HEROES);
  const stats = {};
  for (const n of names) stats[n] = { kills: 0, clears: 0, hp: 0, time: 0, games: 0, total: 12 };
  for (const n of names)
    for (let s = 0; s < seeds; s++) {
      const r = heroClear(n, 5000 + s * 997 + names.indexOf(n) * 41, unitLevel);
      const x = stats[n];
      x.games++; x.kills += r.kills; x.clears += r.clear ? 1 : 0; x.hp += r.hp; x.time += r.t; x.total = r.total;
    }
  return names.map((n) => {
    const x = stats[n], h = JQ.HEROES[n];
    return { name: n, pack: h.pack, role: h.role, games: x.games, total: x.total, kills: x.kills / x.games, clear: x.clears / x.games, hp: x.hp / x.games, time: x.time / x.games };
  }).sort((a, b) => b.clear - a.clear || b.kills - a.kills || b.hp - a.hp || a.time - b.time);
}

function mdUnit(title, rows) {
  const lines = [`## ${title}`, '', '| # | 兵种 | 胜率 | 胜-负-平 | 胜场剩余血量 | 平均时长 |', '| --- | --- | --- | --- | --- | --- |'];
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.key} | ${(r.win * 100).toFixed(1)}% | ${r.w}-${r.l}-${r.t} | ${(r.hpWin * 100).toFixed(0)}% | ${r.avgT.toFixed(1)}s |`));
  return lines.join('\n');
}
function mdHero(title, rows) {
  const lines = [`## ${title}`, '', '| # | 英雄 | 卡包 | 定位 | 胜率 | 胜-负-平 | 胜场剩余血量 | 平均时长 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.name} | ${r.pack} | ${r.role} | ${(r.win * 100).toFixed(1)}% | ${r.w}-${r.l}-${r.t} | ${(r.hpWin * 100).toFixed(0)}% | ${r.avgT.toFixed(1)}s |`));
  return lines.join('\n');
}
function mdClear(title, rows) {
  const lines = [`## ${title}`, '', '| # | 英雄 | 卡包 | 定位 | 清完率 | 平均击杀 | 剩余血量 | 平均用时 |', '| --- | --- | --- | --- | --- | --- | --- | --- |'];
  rows.forEach((r, i) => lines.push(`| ${i + 1} | ${r.name} | ${r.pack} | ${r.role} | ${(r.clear * 100).toFixed(1)}% | ${r.kills.toFixed(1)}/${r.total} | ${(r.hp * 100).toFixed(0)}% | ${r.time.toFixed(1)}s |`));
  return lines.join('\n');
}
function levelRows() {
  const rows = [];
  for (let lv = 1; lv <= 6; lv++) {
    const cards = Math.pow(2, lv - 1);
    const count = JQ.unitCount(lv);
    const mult = JQ.levelMult(lv);
    const power = count * mult;
    rows.push({ lv, cards, count, mult, power, eff: power / cards });
  }
  return rows;
}
function mdLevel(rows) {
  const lines = ['## 小兵升级：每张卡的战力与“每张 1 级卡”效率', '', '| 等级 | 合成需要 1 级卡 | 每次召唤 | 属性倍率 | 单卡理论战力 | 每张 1 级卡效率 |', '| --- | --- | --- | --- | --- | --- |'];
  rows.forEach((r) => lines.push(`| Lv${r.lv} | ${r.cards} | ${r.count} | ×${r.mult.toFixed(2)} | ${r.power.toFixed(2)} | ${r.eff.toFixed(3)} |`));
  return lines.join('\n');
}

(async () => {
  const out = { meta: { generated: new Date().toISOString(), seeds: SEEDS, level: LEVEL, mode: MODE }, units: {}, heroes: {} };
  let md = '# 禁区突围 · 单位实力数据\n\n';
  md += `- 生成时间：${out.meta.generated}\n- 采样：每个对局交换先后手，${SEEDS} 组种子；战斗步长 1/30 秒，单场上限 ${MAX_T}s。\n- 小兵：同兵种 1v1 / 5v5 / 混编 5v5（测试兵 + 2 盾 + 2 弓）；英雄：3 级 1v1 / 3 级英雄 + 4 刀 / 3 级英雄 + 2 盾 + 2 弓；另测 3 级英雄单挑 12 个 1 级/5 级小兵。\n- 判定：一方全灭即负；到时限按剩余血量比例判。\n\n`;
  if (MODE === 'units' || MODE === 'all') {
    const r1 = unitTable(LEVEL, 1, SEEDS);
    const r5 = unitTable(LEVEL, 5, SEEDS);
    const rm = unitMixedTable(LEVEL, SEEDS);
    const dps = {};
    for (const k of JQ.ALL_UNITS) dps[k] = +unitDps(k, LEVEL).toFixed(1);
    out.units = { level: LEVEL, solo: r1, group: r5, mixed: rm, dps };
    out.level5 = levelRows();
    md += mdUnit(`小兵 1v1（${LEVEL} 级）`, r1) + '\n\n';
    md += mdUnit(`小兵 5v5（${LEVEL} 级）`, r5) + '\n\n';
    md += mdUnit(`小兵混编 5v5（${LEVEL} 级：测试兵 + 2 盾 + 2 弓）`, rm) + '\n\n';
    md += mdLevel(out.level5) + '\n\n';
    md += '## 小兵 10 秒打桩 DPS\n\n| 兵种 | DPS |\n| --- | --- |\n';
    Object.entries(dps).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => (md += `| ${k} | ${v} |\n`));
    md += '\n';
  }
  if (MODE === 'heroes' || MODE === 'all') {
    const solo = heroTable(SEEDS, false);
    const team = heroTable(SEEDS, 'blade');
    const mix = heroTable(SEEDS, 'mix');
    const clear1 = heroClearTable(SEEDS, 1);
    const clear5 = heroClearTable(SEEDS, 5);
    out.heroes = { level: 3, solo, team, mix, clear1, clear5 };
    md += mdHero('英雄 3 级 1v1', solo) + '\n\n';
    md += mdHero('英雄 3 级 + 4 刀团战', team) + '\n\n';
    md += mdHero('英雄 3 级 + 2 盾 + 2 弓团战', mix) + '\n\n';
    md += mdClear('英雄清兵（3 级 vs 12 个 1 级小兵）', clear1) + '\n\n';
    md += mdClear('英雄清兵（3 级 vs 12 个 5 级小兵）', clear5) + '\n\n';
  }
  const mdPath = path.join(__dirname, 'power_report.md');
  const jsonPath = path.join(__dirname, 'power_report.json');
  fs.writeFileSync(mdPath, md);
  fs.writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  console.log(md);
  console.log(`\n已写入 ${mdPath} 和 ${jsonPath}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
