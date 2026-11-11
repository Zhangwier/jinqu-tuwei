// 皮肤平衡：同一位英雄 原版 vs 皮肤，在突破 0/2/3 下比较
//   清兵：3 级英雄对 14 个 3 级混编小兵，看 30 秒内的击杀数/输出/剩余血量
//   单挑：3 级英雄对原版 3 级同名英雄，看胜率
// 用法：node test/skin_balance.js [seeds] [英雄,英雄]
const path = require('path');
for (const f of ['data', 'board', 'sim', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const JQ = globalThis.JQ;
const SEEDS = Math.max(1, +(process.argv[2] || 12));
const DT = 1 / 30;

function mk(seed, hero, brk, skin) {
  const g = new JQ.Game({ seed, pack: 'sanguo', breakthrough: brk ? { [hero]: brk } : null, skins: skin ? { [hero]: skin } : null });
  g.R.time = 1e9;
  g.R.overtime = 0;
  return g;
}
const alive = (g, side) => g.units.filter((u) => u.side === side && u.hp > 0 && !u.isOutpost);
function spawnH(g, side, name, x, y) {
  const h = g.spawnHero(g.sides[side], name, 3, x, { y });
  h.ultT = 0;
  h.skillT = 0;
  return h;
}
function clear(seed, hero, brk, skin) {
  const g = mk(seed, hero, brk, skin);
  const h = spawnH(g, 0, hero, 360, 760);
  const kinds = ['刀', '盾', '弓', '枪', '骑', '弩', '刺'];
  for (let i = 0; i < 14; i++) {
    const u = g.spawnUnit(g.sides[1], kinds[i % kinds.length], 3, 200 + (i % 7) * 50, { x: 200 + (i % 7) * 50, y: 520 + Math.floor(i / 7) * 40 });
    u.atkT = 0.2;
  }
  const start = alive(g, 1).length;
  let t = 0;
  while (t < 30 && alive(g, 1).length && h.hp > 0) (g.step(DT), (t += DT));
  return { kills: start - alive(g, 1).length, hp: Math.max(0, h.hp) / h.maxHp, t };
}
// 持久战：技能/大招按正常冷却（不预充），对 5 级小兵车轮战 40 秒，场上始终补到 8 个，看总击杀
function grind(seed, hero, brk, skin) {
  const g = mk(seed, hero, brk, skin);
  const h = g.spawnHero(g.sides[0], hero, 3, 360, { y: 760 });
  const kinds = ['刀', '盾', '弓', '枪', '骑', '弩'];
  let kills = 0, t = 0, i = 0;
  while (t < 40 && h.hp > 0) {
    let n = alive(g, 1).length;
    while (n < 8) (g.spawnUnit(g.sides[1], kinds[i % 6], 2, 220 + (i % 6) * 56, { x: 220 + (i % 6) * 56, y: 520 }), i++, n++);
    const before = alive(g, 1).length;
    g.step(DT);
    t += DT;
    kills += Math.max(0, before - alive(g, 1).length);
  }
  return kills + (h.hp > 0 ? h.hp / h.maxHp : 0);
}
function run(hero, brk, skin) {
  let k = 0, hp = 0, t = 0, w = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const c = clear(s * 97, hero, brk, skin);
    k += c.kills;
    hp += c.hp;
    t += c.t;
    w += grind(s * 131, hero, brk, skin);
  }
  return { kills: k / SEEDS, hp: hp / SEEDS, t: t / SEEDS, win: w / SEEDS };
}
const f = (x, d = 1) => x.toFixed(d);
console.log(`种子 ${SEEDS}；清兵=对 14 个 3 级混编小兵（击杀/剩血/用时），车轮战=40 秒对 2 级小兵的击杀数（含存活剩血）`);
for (const hero of (process.argv[3] || '吕布,悟空,岳飞').split(',')) {
  for (const brk of [0, 2, 3]) {
    const base = run(hero, brk, null);
    const rows = [`${hero} 突破${brk} 原版`.padEnd(14) + ` 清兵 ${f(base.kills)}/14 剩血 ${f(base.hp * 100, 0)}% ${f(base.t)}s | 车轮战 ${f(base.win)}`];
    for (const sk of JQ.skinsOf(hero)) {
      const r = run(hero, brk, sk.id);
      rows.push(`  ${sk.name}`.padEnd(14) + ` 清兵 ${f(r.kills)}/14 剩血 ${f(r.hp * 100, 0)}% ${f(r.t)}s | 车轮战 ${f(r.win)}`);
    }
    console.log(rows.join('\n'));
  }
}
