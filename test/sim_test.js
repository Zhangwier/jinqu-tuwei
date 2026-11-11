// 无界面 AI 对 AI：查崩溃/NaN、对局时长、胜率与英雄/大招出场。用法：node test/sim_test.js [局数]
const path = require('path');
for (const f of ['data', 'board', 'sim', 'ai']) require(path.join(__dirname, '..', 'js', f + '.js'));
const JQ = globalThis.JQ;
const assert = require('assert');
const card = (k, key, lv) => JQ.makeCard(k, key, lv);

// 规则单测
{
  const b = new JQ.Board();
  assert.strictEqual(b.emptyCells().length, 5, '初始 5 个可放格');
  assert.strictEqual(b.path.length, 6);
  assert.strictEqual(b.place(card('char', '飞'), 1, 2), 'place');
  assert.strictEqual(b.place(card('char', '张'), 1, 3), 'place');
  assert.strictEqual(b.links.length, 1, '飞张左右相邻（顺序不限）成张飞');
  assert.strictEqual(b.links[0].hero, '张飞');
  const sh = new JQ.Board('sanguo');
  sh.place(card('char', '策'), 1, 2);
  sh.place(card('char', '孙'), 1, 3);
  sh.place(card('char', '权'), 1, 4);
  assert.deepStrictEqual(sh.links.map((l) => l.hero).sort(), ['孙权', '孙策'].sort(), '孙字两边共用');
  assert.strictEqual(sh.cell(1, 3).links.length, 2);
  const xy = new JQ.Board('xiyou');
  xy.place(card('char', '空'), 1, 2);
  xy.place(card('char', '悟'), 1, 3);
  assert.strictEqual(xy.links[0] && xy.links[0].hero, '悟空', '西游卡包合成');
  // 唐朝：16 将、共用字（李/仁/天）都能左右成对
  assert.strictEqual(JQ.PACKS.tang.open, true, '唐朝卡包已开放');
  assert.strictEqual(JQ.PACKS.tang.heroes.length, 16, '唐朝 16 位英雄');
  const tg = new JQ.Board('tang');
  tg.place(card('char', '靖'), 1, 2);
  tg.place(card('char', '李'), 1, 3);
  tg.place(card('char', '白'), 1, 4);
  assert.deepStrictEqual(tg.links.map((l) => l.hero).sort(), ['李白', '李靖'].sort(), '李字两边共用');
  const tg2 = new JQ.Board('tang');
  tg2.place(card('char', '杰'), 1, 2);
  tg2.place(card('char', '仁'), 1, 3);
  tg2.place(card('char', '贵'), 1, 4);
  assert.deepStrictEqual(tg2.links.map((l) => l.hero).sort(), ['仁杰', '仁贵'].sort(), '仁字两边共用');
  const tg3 = new JQ.Board('tang');
  tg3.place(card('char', '则'), 1, 2);
  tg3.place(card('char', '天'), 1, 3);
  tg3.place(card('char', '罡'), 1, 4);
  assert.deepStrictEqual(tg3.links.map((l) => l.hero).sort(), ['天罡', '则天'].sort(), '天字两边共用');
  const tgWrong = new JQ.Board('sanguo');
  tgWrong.place(card('char', '李'), 1, 2);
  tgWrong.place(card('char', '靖'), 1, 3);
  assert.strictEqual(tgWrong.links.length, 0, '三国棋盘合不出唐朝英雄');
  const wrong = new JQ.Board('sanguo');
  wrong.place(card('char', '悟'), 1, 2);
  wrong.place(card('char', '空'), 1, 3);
  assert.strictEqual(wrong.links.length, 0, '三国棋盘合不出西游英雄');

  const v = new JQ.Board();
  v.place(card('char', '张'), 0, 2);
  v.place(card('char', '飞'), 1, 2);
  assert.strictEqual(v.links.length, 0, '上下相邻不成英雄');

  assert.strictEqual(b.place(card('unit', '刀'), 0, 3), null, '水晶格不能放');
  b.place(card('unit', '刀'), 0, 2);
  assert.strictEqual(b.place(card('unit', '刀'), 0, 2), 'merge');
  assert.strictEqual(b.cell(0, 2).card.level, 2);
  assert.strictEqual(b.place(card('unit', '刀'), 0, 2), null, '等级不同不能合');

  // 移动：空格移动 / 互换 / 合并
  const m = new JQ.Board();
  m.place(card('unit', '弓'), 0, 2);
  assert.strictEqual(m.move(0, 2, 1, 2), 'move');
  assert.ok(!m.cell(0, 2).card && m.cell(1, 2).card.key === '弓');
  m.place(card('unit', '盾'), 0, 2);
  assert.strictEqual(m.move(0, 2, 1, 2), 'swap');
  assert.strictEqual(m.cell(0, 2).card.key, '弓');
  m.place(card('unit', '弓'), 0, 4);
  assert.strictEqual(m.move(0, 4, 0, 2), 'merge');
  assert.strictEqual(m.cell(0, 2).card.level, 2);
  assert.strictEqual(m.move(0, 2, 0, 3), null, '不能挪到水晶');

  // 格子块：4 排
  const t = new JQ.Board();
  assert.ok(t.placeTile('田', 2, 2), '后面两排能拼田字');
  assert.ok(t.cell(3, 3).unlocked);
  assert.ok(!t.tileAnchor('竖', 3, 0) || t.tileAnchor('竖', 3, 0).r <= 2, '不出界');
  assert.ok(!t.tileAnchor('单', 0, 6), '不贴边不能拼');
  // 大格子块放不全也能放：被挡/出界的格子跳过
  const pt = new JQ.Board();
  const at = pt.tileAnchor('田', 0, 5);
  assert.ok(at && at.cells.length >= 1, '田字贴右边能放');
  const blocked = new JQ.Board();
  blocked.placeTile('单', 0, 5);
  const at2 = blocked.tileAnchor('田', 1, 5);
  assert.ok(at2 && !at2.cells.includes(blocked.cell(0, 5)), '已解锁的格子被跳过');
  blocked.placeTile('田', 1, 5);
  assert.ok(blocked.cell(1, 5).unlocked);
  const edge = new JQ.Board();
  for (let c = 0; c < 7; c++) edge.cell(0, c).unlocked = edge.cell(1, c).unlocked = edge.cell(2, c).unlocked = true;
  edge.rebuild();
  assert.ok(edge.placeTile('田', 3, 6), '最后一排、最右列：田字只填进界内的格子');
  assert.ok(edge.cell(3, 6).unlocked);
  assert.strictEqual(t.path.length, 10);

  // 招兵栏整排刷新
  const g = new JQ.Game({ seed: 3 });
  const before = g.sides[0].shop.map((c) => c.id);
  g.sides[0].buns = 100;
  assert.ok(g.recruit(0));
  assert.ok(g.sides[0].shop.every((c, i) => c && c.id !== before[i]), '五张全部换新');
  // 备战席：合成、替换、收回；招兵自动卖掉备战席；卖价=等级
  {
    const g2 = new JQ.Game({ seed: 5 });
    const s2 = g2.sides[0];
    s2.shop = [card('unit', '弓'), card('unit', '弓'), card('unit', '盾'), card('char', '张'), card('tile', '单')];
    assert.strictEqual(g2.benchMove(0, 0, 1), 'merge', '备战席同名同级合成');
    assert.ok(!s2.shop[0] && s2.shop[1].level === 2);
    assert.strictEqual(g2.benchMove(0, 2, 3), 'swap');
    assert.strictEqual(g2.take(0, 3, 0, 2), 'place', '盾 上场');
    assert.strictEqual(g2.take(0, 1, 0, 2), null, '不允许替换时放不上');
    assert.strictEqual(g2.take(0, 1, 0, 2, true), 'replace', '弓顶替盾');
    assert.strictEqual(s2.board.cell(0, 2).card.key, '弓');
    assert.strictEqual(s2.shop[1].key, '盾', '盾 回到备战席');
    assert.strictEqual(g2.toBench(0, 0, 2, 3), 'return', '场上卡拖回空位');
    assert.strictEqual(g2.sellValue(card('unit', '刀', 1)), 1);
    assert.strictEqual(g2.sellValue(card('unit', '刀', 3)), 3, '卖价=等级');
    s2.shop = [card('unit', '弓', 2), card('unit', '刀'), null, card('tile', '单'), card('char', '张')];
    s2.buns = 20;
    const cost = s2.recruitCost(), refund = g2.benchValue(0);
    assert.strictEqual(refund, 2 + 1 + 1 + 1);
    assert.ok(g2.recruit(0));
    assert.strictEqual(Math.round(s2.buns), 20 + refund - cost, '招兵先卖备战席再扣钱');
    s2.buns = s2.recruitCost() - 3;
    s2.shop = [card('unit', '弓', 3), null, null, null, null];
    assert.ok(g2.canRecruit(0), '包子+备战席卖价够就能招兵');
    assert.ok(5 * g2.sellValue(card('unit', '刀')) < JQ.C.RECRUIT_COST, '卖一整排新卡回不了本');
  }
  // 英雄整体升级：等级取两字较高者；该英雄的任一字（不论几级）拖上去 +1 级
  {
    const hb = new JQ.Board();
    hb.place(card('char', '张', 1), 1, 2);
    hb.place(card('char', '飞', 2), 1, 3);
    assert.strictEqual(hb.links[0].level, 2, '英雄等级取较高的字');
    assert.strictEqual(hb.canPlace(card('char', '张', 1), 1, 3), 'merge', '张 拖到 飞 格也能给张飞升级');
    hb.place(card('char', '张', 1), 1, 3);
    assert.strictEqual(hb.links[0].level, 3);
    assert.ok(hb.cell(1, 2).card.level === 3 && hb.cell(1, 3).card.level === 3, '两字同步');
    assert.strictEqual(hb.canPlace(card('char', '刘', 1), 1, 2), null, '别的英雄的字不能喂');
    hb.cell(0, 4).card = card('char', '飞', 1);
    hb.rebuild();
    assert.strictEqual(hb.canMove(0, 4, 1, 2), 'merge', '场上的字拖到英雄身上也能升级');
    hb.move(0, 4, 1, 2);
    assert.strictEqual(hb.links[0].level, 4);
  }
  // 前哨：往战场方向拼格子，会生成哨所；哨所被打掉后格子收回、卡退回备战席
  {
    const g3 = new JQ.Game({ seed: 11 });
    const s3 = g3.sides[0];
    s3.shop[0] = card('tile', '单');
    assert.strictEqual(g3.take(0, 0, -1, 2), 'tile', '前排外侧可以拼前哨');
    assert.ok(s3.board.cell(-1, 2).unlocked && s3.board.cell(-1, 2).outpost, '生成哨所');
    assert.ok(s3.board.path.includes(s3.board.cell(-1, 2)), '主角路线经过前哨');
    s3.shop[1] = card('unit', '刀');
    g3.take(0, 1, -1, 2);
    s3.shop.fill(null);
    const o = s3.board.cell(-1, 2).outpost;
    g3.damage(null, o, 99999, { skill: true });
    assert.ok(!s3.board.cell(-1, 2).unlocked, '前哨失守，格子收回');
    assert.ok(s3.shop.some((c) => c && c.key === '刀'), '卡退回备战席');
    assert.ok(!g3.units.some((u) => u.isOutpost && u.hp > 0), '哨所移除');
  }
  // 回归：前排铺满前哨时，自己的英雄和兵要能穿过去（曾被哨所堵在基地里）
  {
    const g4 = new JQ.Game({ seed: 1 });
    const s4 = g4.sides[0];
    for (let c = 0; c < 7; c++) for (const r of [-1, -2]) s4.board.cell(r, c).unlocked = true;
    s4.board.rebuild();
    g4.afterBoardChange(s4);
    const h = g4.spawnHero(s4, '张飞', 1, 360), u = g4.spawnUnit(s4, '刀', 1, 300);
    for (let k = 0; k < 240; k++) g4.step(1 / 60);
    const edge = JQ.L.P_TOP - 2 * JQ.C.CELL;
    assert.ok(h.y < edge && u.y < edge, `英雄/小兵应穿过前哨（英雄 y=${Math.round(h.y)}，小兵 y=${Math.round(u.y)}，前哨外沿 ${edge}）`);
  }
  // 道具：可以存到格子上、同级合成升级、等级越高效果越强
  {
    const gi = new JQ.Game({ seed: 13 });
    const si = gi.sides[0];
    si.shop = [card('item', '金'), card('item', '金'), card('item', '药'), null, null];
    assert.strictEqual(gi.benchMove(0, 0, 1), 'merge', '道具在备战席合成');
    assert.strictEqual(si.shop[1].level, 2);
    assert.strictEqual(gi.take(0, 1, 1, 2), 'place', '道具存到格子上');
    const b0 = si.buns;
    assert.ok(gi.useCellItem(0, 1, 2) && Math.round(si.buns - b0) === 50, '2 级金 = 50 包子');
    assert.ok(!si.board.cell(1, 2).card, '用完从格子上移除');
    si.hp = 1000;
    assert.strictEqual(gi.take(0, 2, null, null), 'item', '点一下直接用');
    assert.strictEqual(si.hp, 1400);
  }
  // 天赋
  {
    const tg = new JQ.Game({ seed: 12, mode: 'fate', talents: [['qigong', 'shuangying', 'pofu'], []] });
    assert.ok(!tg.pools[0].some((p) => p.kind === 'unit' && p.key === '弓'), '弃弓：卡池没有弓');
    assert.ok(tg.pools[1].some((p) => p.kind === 'unit' && p.key === '弓'), '对手不受影响');
    assert.strictEqual(tg.sides[0].board.links.length, 2, '双英：开局两位英雄');
    assert.strictEqual(tg.sides[0].maxHp, Math.round(3000 * 0.7), '破釜沉舟：基地 -30%');
    const unitW = (pool) => pool.filter((p) => p.kind === 'unit').reduce((a, p) => a + p.w, 0);
    assert.ok(Math.abs(unitW(tg.pools[0]) - unitW(tg.pools[1])) < 1e-6, '禁兵种后兵卡总量不变');
    // 兵种类天赋
    const kg = new JQ.Game({ seed: 14, talents: [['zhanshi', 'yuancheng', 'cike'], []] });
    const mk = (sid, k) => kg.spawnUnit(kg.sides[sid], k, 1, 360);
    assert.ok(Math.abs(mk(0, '刀').atk / mk(1, '刀').atk - 1.2) < 1e-6, '战士强化：刀 +20%');
    const b0 = mk(0, '弓'), b1 = mk(1, '弓');
    assert.ok(b0.range === b1.range + 30 && Math.abs(b0.atk / b1.atk - 1.25) < 1e-6, '远程强化：弓射程 +30、攻击 +25%');
    assert.ok(mk(0, '刺').stealthUntil > kg.time && !(mk(1, '刺').stealthUntil > kg.time), '刺客突袭：刺出场隐身');
    const cap = new JQ.Game({ seed: 15, talents: [['liangcao', 'dianshi'], []] });
    cap.sides[0].board.place(card('unit', '刀'), 1, 2);
    cap.sides[1].board.place(card('unit', '刀'), 1, 2);
    assert.strictEqual(cap.sides[0].unitCap('刀'), cap.sides[1].unitCap('刀') * 1.5, '粮草充足：上限 +50%');
    assert.strictEqual(cap.sellValue(card('unit', '刀', 2), 0), 4, '点石成金：卖价翻倍');
    const T = JQ.mergeTalents(['tuntian', 'shanggu', 'xianshou']);
    assert.ok(T.income === 1.15 && T.recruitDiscount === 3 && T.startBuns === 40);
  }
  // 动态难度：标准略强于玩家，输了变弱、低到一定程度不再合卡凑英雄
  {
    const p1 = JQ.aiProfile('normal', { apm: 60, adapt: 1 });
    const p2 = JQ.aiProfile('normal', { apm: 60, adapt: 0.7 });
    assert.ok(Math.abs(p1.apm - 66) < 1e-6 && p1.smart, '标准 = 玩家手速 ×1.1');
    assert.ok(p2.apm < p1.apm && !p2.smart, '输多了变慢变笨');
    assert.deepStrictEqual(JQ.DIFF_ORDER, ['normal', 'hard'], '简单难度已删除');
    assert.ok(JQ.aiProfile('hard').think === 0.5, '困难固定最高');
  }
  // 小兵无等级上限；英雄/其他卡仍是 5 级
  {
    assert.strictEqual(JQ.cardMaxLevel(card('unit', '刀')), Infinity, '小兵没有等级上限');
    assert.strictEqual(JQ.cardMaxLevel(card('char', '张')), 5, '英雄卡仍 5 级');
    const b = new JQ.Board();
    b.place(card('unit', '刀', 5), 1, 2);
    assert.strictEqual(b.place(card('unit', '刀', 5), 1, 2), 'merge', '5 级小兵还能合');
    assert.strictEqual(b.cell(1, 2).card.level, 6, '合成到 6 级');
    assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 9].map(JQ.unitCount), [1, 2, 3, 4, 6, 6, 6], '每次召唤 1/2/3/4/6，5 级起 6 个');
    for (let lv = 1; lv < 8; lv++) assert.ok(JQ.unitCount(lv + 1) * JQ.levelMult(lv + 1) > JQ.unitCount(lv) * JQ.levelMult(lv), `${lv + 1} 级整卡战力高于 ${lv} 级`);
  }
  // 英雄像兵卡一样：冷却好了再踩就再召一个，同名在场上限 = 英雄等级
  {
    assert.deepStrictEqual([1, 2, 3, 5, 9].map(JQ.heroCap), [1, 2, 3, 5, 5], '同名英雄在场上限 = 等级（最多 5）');
    const g = new JQ.Game({ seed: 7, pack: 'sanguo' });
    const s = g.sides[0];
    s.board.cell(0, 0).card = card('char', '张', 3);
    s.board.cell(0, 1).card = card('char', '飞', 1);
    s.board.rebuild();
    const link = s.board.links.find((l) => l.hero === '张飞');
    g.tryHero(s, link);
    assert.strictEqual(g.heroCount(s, '张飞'), 1, '第一次召出张飞');
    g.tryHero(s, link);
    assert.strictEqual(g.heroCount(s, '张飞'), 1, '冷却没好不会再召');
    s.heroCd['张飞'] = 0;
    g.tryHero(s, link);
    assert.strictEqual(g.heroCount(s, '张飞'), 2, '冷却好了再召一个，前一个还在场');
    s.heroCd['张飞'] = 0;
    g.tryHero(s, link);
    s.heroCd['张飞'] = 0;
    g.tryHero(s, link);
    assert.strictEqual(g.heroCount(s, '张飞'), 3, '3 级张飞最多同时 3 个');
  }
  // 格子上限 20、招兵栏最多 3 张字卡
  {
    const g = new JQ.Game({ seed: 11, pack: 'sanguo' });
    const s = g.sides[0], b = s.board;
    for (let k = 0; k < 40 && b.tileFits(); k++) {
      const f = b.frontier()[0];
      b.placeTile('田', f.r, f.c) || b.placeTile('单', f.r, f.c);
    }
    assert.ok(b.usableCells() <= JQ.C.MAX_CELLS, `可用格子不超过 ${JQ.C.MAX_CELLS}（实际 ${b.usableCells()}）`);
    let maxChars = 0;
    for (let k = 0; k < 300; k++) (g.fillShop(0), (maxChars = Math.max(maxChars, s.shop.filter((c) => c && c.kind === 'char').length)));
    assert.ok(maxChars <= 3, '招兵栏一次最多 3 张字卡');
    assert.ok(!s.shop.some((c) => c && c.kind === 'tile') || b.tileFits(), '格子满了不再出格子块');
  }
  // 兵种池：三国/西游/唐朝各有不同兵种，同字同属性
  {
    assert.ok(JQ.packUnits('sanguo').includes('骑') && JQ.packUnits('sanguo').includes('弩'));
    assert.ok(JQ.packUnits('xiyou').includes('妖') && JQ.packUnits('xiyou').includes('魔'));
    assert.ok(JQ.packUnits('tang').includes('陌') && JQ.packUnits('tang').includes('甲'));
    assert.strictEqual(JQ.UNITS['妖'].atk, JQ.UNITS['妖'].atk, '同字跨包同属性');
  }
  // 夏夏只存在于自定义卡包；两个「夏」左右相邻可合成
  {
    assert.strictEqual(JQ.heroOf('夏', '夏', 'custom'), '夏夏');
    assert.strictEqual(JQ.heroOf('夏', '夏', 'tang'), null, '夏夏不在其他卡包');
    const b = new JQ.Board('custom');
    b.place(card('char', '夏'), 1, 2);
    b.place(card('char', '夏'), 1, 3);
    assert.strictEqual(b.links[0] && b.links[0].hero, '夏夏', '两个夏字成夏夏');
  }
  // 某字能合成的英雄全满级后，charBlocked 为真
  {
    const g = new JQ.Game({ seed: 11, pack: 'sanguo' });
    const s = g.sides[0];
    s.board.place(card('char', '张', 5), 1, 2);
    s.board.place(card('char', '飞', 5), 1, 3);
    assert.ok(g.charBlocked(s, '张'), '张飞满级后不再刷张');
    assert.ok(!g.charBlocked(s, '赵'), '赵云没满级，赵照常');
  }
  // 夏夏被动：自动把小兵拖动合成
  {
    const g = new JQ.Game({ seed: 12, pack: 'custom', mode: 'classic' });
    const s = g.sides[0];
    s.board.place(card('unit', '刀'), 1, 2);
    s.board.place(card('unit', '刀'), 1, 3);
    g.spawnHero(s, '夏夏', 1, JQ.cellRect(0, 1, 2).cx);
    for (let i = 0; i < 45; i++) g.step(1 / 60);
    assert.strictEqual(s.board.all().filter((x) => x.card && x.card.kind === 'unit').length, 2, '0.75 秒还没合');
    for (let i = 0; i < 45; i++) g.step(1 / 60);
    const us = s.board.all().filter((x) => x.card && x.card.kind === 'unit');
    assert.strictEqual(us.length, 1, '两张刀被自动合成一张');
    assert.strictEqual(us[0].card.level, 2, '自动合成升到 2 级');
    assert.strictEqual(s.craftStacks, 1, '棋盘合成叠 1 层巧手');
    assert.strictEqual(g.units.filter((u) => u.bonusSpawn).length, 0, '不再额外召唤单位');
  }
  // 夏夏也能自动合备战席
  {
    const g = new JQ.Game({ seed: 13, pack: 'custom', mode: 'classic' });
    const s = g.sides[0];
    s.shop = [card('unit', '盾'), card('unit', '盾'), null, null, null];
    g.spawnHero(s, '夏夏', 1, JQ.cellRect(0, 1, 2).cx);
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    const shields = s.shop.filter((c) => c && c.key === '盾');
    assert.strictEqual(shields.length, 1, '备战席两张盾自动合一张');
    assert.strictEqual(shields[0].level, 2, '备战席自动合成升 2 级');
    assert.strictEqual(s.craftStacks, 0, '备战席合成不叠巧手');
  }
  // 巧手最多 12 层
  {
    const g = new JQ.Game({ seed: 14, pack: 'custom', mode: 'classic' });
    const s = g.sides[0];
    s.craftStacks = 12;
    s.board.place(card('unit', '刀'), 1, 2);
    s.board.place(card('unit', '刀'), 1, 3);
    g.spawnHero(s, '夏夏', 1, JQ.cellRect(0, 1, 2).cx);
    for (let i = 0; i < 90; i++) g.step(1 / 60);
    assert.strictEqual(s.craftStacks, 12, '巧手封顶 12 层');
  }
  // 文字概率：所有字都能抽到；场上有「张」时不能把「飞」刷到 70% 那种程度
  {
    const g = new JQ.Game({ seed: 5, pack: 'sanguo' });
    g.sides[0].board.place(card('char', '张'), 1, 2);
    const seen = new Set();
    let fei = 0, total = 0;
    for (let i = 0; i < 20000; i++) {
      const c = g.rollCard(0);
      if (c.kind !== 'char') continue;
      seen.add(c.key);
      total++;
      if (c.key === '飞') fei++;
    }
    assert.ok(total > 3000, '字卡总量正常');
    assert.ok(seen.size >= 25, '绝大多数字都能抽到');
    assert.ok(fei / total < 0.4, '保底字不能刷屏');
  }
  // 自定义包带夏夏：前两张文字卡必为夏；天命开局英雄必为夏夏
  {
    const g = new JQ.Game({ seed: 21, pack: 'custom' });
    const got = [];
    for (const c of g.sides[0].shop) if (c && c.kind === 'char') got.push(c.key);
    while (got.length < 2) {
      const c = g.rollCard(0);
      if (c.kind === 'char') got.push(c.key);
    }
    assert.deepStrictEqual(got.slice(0, 2), ['夏', '夏'], '前两张文字卡保底夏');
    const gf = new JQ.Game({ seed: 22, pack: 'custom', mode: 'fate' });
    assert.ok(gf.sides[0].board.links.some((l) => l.hero === '夏夏'), '天命开局英雄为夏夏');
    // 开局已送夏夏：不再强制给「夏」
    assert.strictEqual(gf.sides[0].xiaGiven, 2, '天命送了夏夏后不再保底夏');
    let forced = 0;
    for (let i = 0; i < 400; i++) {
      const c = gf.rollCard(0);
      if (c.kind === 'char' && c.key === '夏') forced++;
    }
    assert.ok(forced < 20, `天命开局有夏夏时，夏字不再刷屏（${forced}/400）`);
  }
  // 连续 7 次没格子时保底一块
  {
    const g = new JQ.Game({ seed: 23, pack: 'sanguo' });
    const s = g.sides[0];
    s.tileDry = 6;
    g.fillShop(0);
    assert.ok(s.shop.some((c) => c && c.kind === 'tile'), '第 7 次刷新保底格子');
  }
  // 关卡强度递增；自定义包可配置 16 英雄 + 6~12 小兵
  {
    assert.ok(JQ.stageBoost(200) > JQ.stageBoost(100) && JQ.stageBoost(100) > 1, '200 关难度递增');
    assert.ok(JQ.customReady(), '默认自定义包可用');
    const ok = JQ.setCustomPack({ heroes: JQ.DEFAULT_CUSTOM_HEROES, units: ['刀', '盾', '弓', '枪', '剑', '妖', '魔', '猴'] });
    assert.ok(ok && JQ.packUnits('custom').includes('妖'), '自定义小兵生效');
    const g = new JQ.Game({ seed: 13, pack: 'custom', stage: 50, enemyBoost: JQ.stageBoost(50) });
    assert.strictEqual(g.packs[0], 'custom');
    assert.strictEqual(g.stage, 50);
    assert.ok(g.sides[1].T.stageBoost > 1, '关卡加成生效');
  }
  console.log('规则单测通过');
}

// 每个英雄的技能、大招都能放出来且不出错
{
  const ultDone = new Set(), skillDone = new Set();
  for (const name of Object.keys(JQ.HEROES)) {
    const g = new JQ.Game({ seed: 7, pack: JQ.HEROES[name].pack });
    g.on((ev, d) => (ev === 'ult' ? ultDone : ev === 'skill' ? skillDone : null)?.add(d.name));
    const e = g.sides[1];
    for (let i = 0; i < 12; i++) {
      const f = g.spawnUnit(e, ['刀', '盾', '弓', '枪'][i % 4], 1, 250 + (i % 6) * 40);
      f.y = 520 + Math.floor(i / 6) * 40;
      f.hp = f.maxHp = f.maxHp * 40; // 够厚，大招打不死，后面还能放技能
      f.atk = 0;
    }
    const hurt = g.spawnUnit(g.sides[0], '盾', 1, 360);
    hurt.y = 640;
    hurt.hp = hurt.maxHp * 0.2;
    const h = g.spawnHero(g.sides[0], name, 3, 360);
    h.y = 600;
    h.ultT = 0;
    for (let k = 0; k < 60 * 8; k++) {
      g.step(1 / 60);
      for (const u of g.units) if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.hp)) throw new Error(name + ' 产生 NaN');
    }
  }
  const all = Object.keys(JQ.HEROES);
  assert.deepStrictEqual(all.filter((n) => !ultDone.has(n)), [], '没放出大招');
  assert.deepStrictEqual(all.filter((n) => !skillDone.has(n)), [], '没放出技能');
  console.log(`${all.length} 个英雄的技能和大招全部可释放`);
}

// 按难度批量对局：下方是“普通玩家手速”画像（每 2 秒想一次、每次最多 2 步），上方是对应难度 AI
const N = +process.argv[2] || 30;
const t0 = Date.now();
for (const diff of JQ.DIFF_ORDER) {
  const wins = [0, 0, 0];
  let totalT = 0, maxUnits = 0, ults = 0, fills = [0, 0];
  for (let k = 0; k < N; k++) {
    // 简单/标准按“普通玩家”手速（约 50 次/分钟）动态生成
    const g = new JQ.Game({ seed: 1000 + k, difficulty: diff, aiProfile: JQ.aiProfile(diff, { apm: 50, adapt: 1 }) });
    g.on((ev) => ev === 'ult' && ults++);
    const think = [0, 0];
    const prof = [JQ.DIFF.human, g.diff];
    const dt = 1 / 30;
    while (!g.over) {
      for (const sid of [0, 1]) {
        if ((think[sid] -= dt) <= 0) {
          JQ.aiThink(g, sid, prof[sid]);
          think[sid] = prof[sid].think;
        }
      }
      g.step(dt);
      if (g.time > 60 && g.time < 60 + dt) for (const sid of [0, 1]) fills[sid] += g.sides[sid].board.all().filter((x) => x.card).length;
      maxUnits = Math.max(maxUnits, g.units.length);
      for (const u of g.units) if (!isFinite(u.x) || !isFinite(u.y) || !isFinite(u.hp)) throw new Error('NaN unit ' + u.key);
    }
    wins[g.winner === -1 ? 2 : g.winner]++;
    totalT += g.time;
  }
  console.log(`[${JQ.DIFF[diff].name}] ${N} 局：玩家胜 ${wins[0]}，AI 胜 ${wins[1]}，平 ${wins[2]}；平均 ${(totalT / N).toFixed(0)}s；1 分钟时场上卡数 玩家 ${(fills[0] / N).toFixed(1)} / AI ${(fills[1] / N).toFixed(1)}；大招 ${ults}；同屏最多 ${maxUnits}`);
}
console.log(`耗时 ${Date.now() - t0}ms`);

// 每条天赋都装上打一局（三条一组，双方都带），不能报错
{
  const ids = JQ.TALENTS.map((t) => t.id);
  for (let i = 0; i < ids.length; i += 3) {
    const mine = ids.slice(i, i + 3), theirs = ids.slice((i + 3) % ids.length, ((i + 3) % ids.length) + 3);
    const g = new JQ.Game({ seed: 600 + i, mode: 'fate', talents: [mine, theirs] });
    const th = [0, 0];
    while (!g.over && g.time < 150) {
      for (const sid of [0, 1]) if ((th[sid] -= 1 / 30) <= 0) (JQ.aiThink(g, sid, JQ.DIFF.human), (th[sid] = 1));
      g.step(1 / 30);
      for (const u of g.units) if (!isFinite(u.x) || !isFinite(u.hp)) throw new Error(mine + ' NaN');
    }
  }
  console.log(`${ids.length} 条天赋全部能正常对局`);
}

// 各模式冒烟 + 守关各难度能守几波
function play(mode, diff, seed) {
  const g = new JQ.Game({ seed, difficulty: diff, mode, aiProfile: JQ.aiProfile(diff, { apm: 50, adapt: 1 }) });
  const prof = [JQ.DIFF.human, g.diff];
  const think = [0, 0];
  const dt = 1 / 30;
  let events = 0;
  g.on((ev) => ev === 'event' && events++);
  while (!g.over && g.time < 900) {
    for (const sid of [0, 1]) {
      if (sid === 1 && g.R.waves) continue;
      if ((think[sid] -= dt) <= 0) (JQ.aiThink(g, sid, prof[sid]), (think[sid] = prof[sid].think));
    }
    g.step(dt);
    for (const u of g.units) if (!isFinite(u.x) || !isFinite(u.hp)) throw new Error(mode + ' NaN ' + u.key);
  }
  return { g, events };
}
const M = Math.max(4, Math.floor(N / 3));
for (const mode of ['fate']) {
  const w = [0, 0, 0];
  let t = 0, heroes = 0, ults = 0, ev = 0;
  for (let k = 0; k < M; k++) {
    const { g, events } = play(mode, 'normal', 500 + k);
    w[g.winner === -1 ? 2 : g.winner]++;
    t += g.time;
    heroes += g.sides[0].stats.heroes + g.sides[1].stats.heroes;
    ults += g.sides[0].stats.ults + g.sides[1].stats.ults;
    ev += events;
  }
  console.log(`[${JQ.MODES[mode].name}·普通] ${M} 局：玩家胜 ${w[0]}，AI 胜 ${w[1]}，平 ${w[2]}；平均 ${(t / M).toFixed(0)}s；英雄出场 ${heroes}，大招 ${ults}，天命 ${ev}`);
}
for (const diff of JQ.DIFF_ORDER) {
  const waves = [];
  for (let k = 0; k < M; k++) waves.push(play('survival', diff, 700 + k).g.wave);
  console.log(`[守关·${JQ.DIFF[diff].name}] 守到第 ${waves.join('/')} 波`);
}

// 卡包平衡：三国/西游/唐朝两两对战，双方同一画像
{
  const P = Math.max(4, Math.floor(N / 2));
  const packs = JQ.OPEN_PACKS;
  for (let a = 0; a < packs.length; a++)
    for (let b = a + 1; b < packs.length; b++) {
      const A = packs[a], B = packs[b];
      const w = [0, 0, 0];
      for (let k = 0; k < P; k++) {
        const swap = k % 2; // 轮换上下方，抵消位置差
        const pair = swap ? [B, A] : [A, B];
        const g = new JQ.Game({ seed: 900 + k, difficulty: 'normal', pack: pair[0], enemyPack: pair[1] });
        const prof = JQ.DIFF.human, think = [0, 0];
        while (!g.over) {
          for (const sid of [0, 1]) if ((think[sid] -= 1 / 30) <= 0) (JQ.aiThink(g, sid, prof), (think[sid] = prof.think));
          g.step(1 / 30);
        }
        if (g.winner === -1) w[2]++;
        else w[pair[g.winner] === A ? 0 : 1]++;
      }
      console.log(`[卡包对决] ${JQ.PACKS[A].name} vs ${JQ.PACKS[B].name}，${P} 局：${w[0]} 胜 ${w[1]} 负 ${w[2]} 平`);
    }
}
