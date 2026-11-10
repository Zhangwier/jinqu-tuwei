// 突破活动单测：数据/技能变化/活动模式/三突被动。用法：node test/breakthrough_test.js
const path = require('path');
for (const f of ['data', 'board', 'sim', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const assert = require('assert');
const JQ = globalThis.JQ;
const C = JQ.C;

// 1. 数据与文案：三次突破不污染原始定义
{
  const base = JQ.HEROES['吕布'];
  const b1 = JQ.heroAtBrk('吕布', 1);
  const b2 = JQ.heroAtBrk('吕布', 2);
  const b3 = JQ.heroAtBrk('吕布', 3);
  assert.strictEqual(base.skill.do.length, 1, '原始吕布技能不应被修改');
  assert.strictEqual(b1.skill.do.length, 2, '一突方天横扫追加效果');
  assert.strictEqual(b1.ult.name, '天下无双', '一突不改大招');
  assert.strictEqual(b2.ult.name, '神鬼乱舞', '二突大招进化');
  assert.strictEqual(b2.ult.do[0].n, 5, '神鬼乱舞五连');
  assert.ok(b3.passive.rampage && b3.passive.rampage.max === 6, '三突专属被动');
  assert.ok(b3.atk > b2.atk && b2.atk > b1.atk && b1.atk > base.atk, '突破属性递增');
  assert.strictEqual(base.passive.rampage, undefined, '原始被动未被污染');

  const w1 = JQ.heroAtBrk('悟空', 1);
  assert.strictEqual(w1.skill.do.find((e) => e.t === 'aoe').stun, 1.2, '悟空一突眩晕延长');
  assert.strictEqual(JQ.heroAtBrk('悟空', 2).ult.name, '身外身');
  assert.strictEqual(JQ.heroAtBrk('悟空', 3).passive.trueSight, true, '悟空三突看破隐身');

  const y2 = JQ.heroAtBrk('岳飞', 2);
  assert.strictEqual(y2.ult.name, '直捣黄龙');
  assert.ok(JQ.heroAtBrk('岳飞', 3).passive.deathWarcry, '岳飞三突阵亡光环');
  assert.strictEqual(JQ.heroAtBrk('吕布', 0), base, '0 突返回原始定义');
}

// 2. 材料总量：三关首通 + 六任务刚好够三位英雄全三突
{
  const BT = JQ.BREAKTHROUGH;
  let seal = 0, stone = 0;
  for (const s of BT.stages) (seal += s.first.seal), (stone += s.first.stone);
  for (const t of BT.tasks) (seal += t.reward.seal), (stone += t.reward.stone);
  const needSeal = BT.heroes.length * BT.costs.reduce((n, c) => n + c.seal, 0);
  const needStone = BT.heroes.length * BT.costs.reduce((n, c) => n + c.stone, 0);
  assert.strictEqual(seal, needSeal, '将印总产出=总消耗');
  assert.strictEqual(stone, needStone, '破阵石总产出=总消耗');
  assert.strictEqual(BT.heroes.length, 3);
}

// 3. 活动模式：固定 3 级英雄 + 突破定义生效
{
  const g = new JQ.Game({
    seed: 1, mode: 'breakthrough', pack: 'sanguo', enemyPack: 'sanguo', stage: 1, enemyBoost: 1.12,
    startHeroName: '吕布', startHeroLv: 3, breakthrough: { 吕布: 3 }, activity: 'hulaoguan',
  });
  const s = g.sides[0];
  const link = s.board.links.find((l) => l.hero === '吕布');
  assert.ok(link, '活动关开局摆出吕布的两个字');
  assert.strictEqual(link.level, 3, '活动关开局英雄 3 级');
  assert.strictEqual(g.modeKey, 'breakthrough');
  assert.strictEqual(g.activity, 'hulaoguan');
  assert.ok(g.brkDefs['吕布'], '玩家方缓存突破定义');
  assert.ok(!g.brkDefs['悟空'], '未突破英雄不缓存');

  const lu = g.spawnHero(s, '吕布', 3, C.W / 2);
  assert.strictEqual(lu.brk, 3, '单位带突破等级');
  assert.strictEqual(lu.def.ult.name, '神鬼乱舞');
  assert.ok(lu.passive.rampage);
  g.castUlt(lu, lu.def);
  assert.strictEqual(s.stats.heroUlts['吕布'], 1, '大招按英雄计数');
  assert.strictEqual(s.stats.ults, 1);

  // 敌方同名英雄仍是原始定义
  const e = g.spawnHero(g.sides[1], '吕布', 3, C.W / 2);
  assert.strictEqual(e.def.ult.name, '天下无双');
  assert.strictEqual(e.brk, 0);
}

// 4. 三突被动：击杀叠层 + 阵亡号令
{
  const g = new JQ.Game({ seed: 2, mode: 'breakthrough', pack: 'sanguo', enemyPack: 'sanguo', breakthrough: { 吕布: 3, 岳飞: 3 }, startHeroName: '吕布', startHeroLv: 3 });
  const s = g.sides[0], e = g.sides[1];
  const lu = g.spawnHero(s, '吕布', 3, C.W / 2);
  const dummy = g.spawnUnit(e, '刀', 1, C.W / 2);
  dummy.hp = 1;
  g.kill(dummy, lu);
  assert.strictEqual(lu.rampageStacks, 1, '击杀后无双层数 +1');

  const yue = g.spawnHero(s, '岳飞', 3, C.W / 2);
  const ally = g.spawnUnit(s, '枪', 1, C.W / 2 + 20);
  g.kill(yue, null);
  assert.ok(ally.atkBuff > 1, '岳飞阵亡给友军加攻');
  assert.ok(ally.shield > 0, '岳飞阵亡给友军护盾');
}

// 5. 活动关能正常打完，吕布会放大招并产生击杀（任务可以推进）
{
  const g = new JQ.Game({
    seed: 7, mode: 'breakthrough', pack: 'sanguo', enemyPack: 'sanguo', stage: 1, enemyBoost: 1.12,
    startHeroName: '吕布', startHeroLv: 3, breakthrough: { 吕布: 3 }, activity: 'hulaoguan',
  });
  let n = 0;
  for (; n < 245 * 60 && !g.over; n++) {
    if (n % 30 === 0) (JQ.aiThink(g, 0), JQ.aiThink(g, 1));
    g.step(1 / 60);
  }
  const st = g.sides[0].stats;
  assert.ok(g.over, '活动关能在 240 秒内结束');
  assert.ok(st.heroUlts['吕布'] >= 1, '吕布在活动关会释放大招');
  assert.ok((st.heroKills['吕布'] || 0) > 0, '吕布在活动关会产生击杀');
  assert.ok(st.kills > 0, '玩家方有击杀');
  console.log(`活动关模拟：winner=${g.winner} time=${g.time.toFixed(0)}s 吕布大招=${st.heroUlts['吕布']} 击杀=${st.heroKills['吕布'] || 0}`);
}

console.log('突破活动单测通过');
