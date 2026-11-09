// 入口：画布缩放、主循环、输入、菜单/暂停/结算界面、音效。
(function () {
  const JQ = window.JQ;
  const { C, UNITS, HEROES, BUILDINGS, ITEMS, UI, FONT, text } = JQ;

  const canvas = document.getElementById('game');
  const g = canvas.getContext('2d', { alpha: false });
  let scale = 1, dpr = 1, qScale = 1, padX = 0, padY = 0;

  function resize() {
    const native = window.devicePixelRatio || 1;
    const vw = window.innerWidth, vh = window.innerHeight;
    scale = Math.min(vw / C.W, vh / C.H);
    // 画布铺满整个屏幕：720x1280 的逻辑区居中，多出来的上下（长屏手机）/左右（电脑）留白
    // 由背景延展填满，顶部/底部 HUD 贴到屏幕边上（见 JQ.setViewPad），不再留黑边。
    padX = Math.max(0, (vw / scale - C.W) / 2);
    padY = Math.max(0, (vh / scale - C.H) / 2);
    // 手机上 DPR 3 全量绘制太吃填充率：内部渲染封顶 1.75 倍，且总像素控制在约 100 万以内。
    // 画面仍按 CSS 铺满，肉眼几乎看不出差别，帧率能明显稳下来。
    const area = vw * vh;
    let q = Math.min(native, 1.75) * qScale;
    const budget = 1000000;
    if (area * q * q > budget) q = Math.sqrt(budget / area);
    dpr = Math.max(1, q);
    canvas.style.width = vw + 'px';
    canvas.style.height = vh + 'px';
    canvas.width = Math.round(vw * dpr);
    canvas.height = Math.round(vh * dpr);
    if (JQ.setViewPad) JQ.setViewPad(padX, padY);
    if (JQ.setRenderScale) JQ.setRenderScale(scale * dpr);
  }
  window.addEventListener('resize', resize);
  resize();
  // 低画质：直接让这块画布的 shadowBlur 恒为 0（所有外发光一次性关掉）
  let noGlow = false;
  function setNoGlow() {
    noGlow = true;
    Object.defineProperty(g, 'shadowBlur', { configurable: true, get: () => 0, set: () => {} });
  }
  if (/[?&]lowfx=1/.test(location.search)) setNoGlow(); // 调试：直接开低画质
  window.__jqPerf = () => ({ qScale, scale, dpr, noGlow, w: canvas.width, h: canvas.height });

  // ---------- 音效（WebAudio 合成，无外部文件） ----------
  let actx = null, muted = localStorage.getItem('jq_mute') === '1', lastHit = 0;
  function tone(f, d, type, vol, slide, delay) {
    const now = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), v = actx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(f, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, now + d);
    v.gain.setValueAtTime(vol || 0.15, now);
    v.gain.exponentialRampToValueAtTime(0.001, now + d);
    o.connect(v).connect(actx.destination);
    o.start(now);
    o.stop(now + d);
  }
  function noise(d, vol) {
    const n = actx.sampleRate * d, buf = actx.createBuffer(1, n, actx.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource(), v = actx.createGain();
    src.buffer = buf;
    v.gain.value = vol;
    src.connect(v).connect(actx.destination);
    src.start();
  }
  function sfx(kind) {
    if (muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return;
    }
    if (kind === 'recruit') [0, 0.05, 0.1, 0.15, 0.2].forEach((d, i) => tone(500 + i * 90, 0.08, 'square', 0.05, null, d));
    else if (kind === 'place') tone(330, 0.1, 'triangle', 0.15);
    else if (kind === 'merge') (tone(660, 0.15, 'triangle', 0.15, 990), tone(990, 0.25, 'sine', 0.1, null, 0.08));
    else if (kind === 'hero') (tone(220, 0.5, 'sawtooth', 0.07, 440), tone(440, 0.5, 'triangle', 0.1, 880));
    else if (kind === 'ult') (noise(0.5, 0.25), tone(110, 0.8, 'sawtooth', 0.12, 55), tone(660, 0.6, 'triangle', 0.1, 1320, 0.1));
    else if (kind === 'hit') tone(120, 0.15, 'sawtooth', 0.07, 60);
    else if (kind === 'skill') tone(880, 0.22, 'sine', 0.07, 300);
    else if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.12, null, i * 0.14));
    else if (kind === 'lose') [392, 330, 262].forEach((f, i) => tone(f, 0.35, 'triangle', 0.12, null, i * 0.2));
    else if (kind === 'bad') tone(160, 0.12, 'square', 0.06);
    else if (kind === 'sell') (tone(900, 0.08, 'square', 0.05), tone(1200, 0.1, 'square', 0.05, null, 0.06));
  }

  // ---------- 状态 ----------
  let screen = 'menu';
  let game = null;
  // 旧存档的难度折算：简单已删除，统一按标准
  const OLD_DIFF = { novice: 'normal', easy: 'normal', normal: 'normal', hard: 'hard', hell: 'hard' };
  let difficulty = OLD_DIFF[localStorage.getItem('jq_diff')] || 'normal';
  if (!JQ.DIFF[difficulty]) difficulty = 'normal';
  // 玩家画像：apm 每分钟操作数（滑动平均）、adapt 标准难度的输赢自适应系数
  let player = JSON.parse(localStorage.getItem('jq_player') || '{"apm":40,"adapt":1,"games":0}');
  // 天命模式进度：金币、已拥有/已装备的天赋、当前关卡
  let fateSave = JSON.parse(localStorage.getItem('jq_fate') || '{"coins":0,"owned":[],"equipped":[],"tier":1}');
  const clampStage = (n) => Math.max(1, Math.min(C.MAX_STAGE, Math.floor(+n || 1)));
  fateSave.tier = clampStage(fateSave.tier);
  fateSave.best = clampStage(fateSave.best || fateSave.tier);
  const saveFate = () => localStorage.setItem('jq_fate', JSON.stringify(fateSave));
  // 经典关卡：current=当前选择，best=已解锁最高关
  let classicBest = clampStage(localStorage.getItem('jq_stage_best') || 1);
  let classicStage = clampStage(localStorage.getItem('jq_stage_cur') || classicBest);
  if (classicStage > classicBest) classicStage = classicBest;
  const saveStage = () => {
    localStorage.setItem('jq_stage_best', String(classicBest));
    localStorage.setItem('jq_stage_cur', String(classicStage));
  };
  // 自定义卡包配置（16 英雄 + 6~12 小兵）
  try {
    const cfg = JSON.parse(localStorage.getItem('jq_custom') || 'null');
    if (cfg) JQ.setCustomPack(cfg);
  } catch (e) {}
  const saveCustom = () => localStorage.setItem('jq_custom', JSON.stringify({ heroes: JQ.PACKS.custom.heroes, units: JQ.PACKS.custom.units }));
  let actions = 0, lastReward = null;
  let mode = JQ.MODES[localStorage.getItem('jq_mode')] ? localStorage.getItem('jq_mode') : 'classic';
  const savedPack = localStorage.getItem('jq_pack');
  let pack = JQ.PACKS[savedPack] && JQ.PACKS[savedPack].open && (savedPack !== 'custom' || JQ.customReady()) ? savedPack : 'sanguo';
  let helpPage = 0, helpPack = pack;
  const view = { g, speed: 1, selected: -1, selectedCell: null, info: '', infoT: 0, heldCard: null, dragFrom: null, dragPos: null, hoverCell: null, target: null, anims: [], shopAnim: null, bunPop: 0 };
  let aiT = 0, autoT = 0;
  const STEP = 1 / 60;
  const AUTO = /[?&]auto=1/.test(location.search); // 调试：玩家方也交给 AI
  const urlMode = (location.search.match(/[?&]mode=(\w+)/) || [])[1];
  if (JQ.MODES[urlMode]) mode = urlMode; // 调试：?mode=survival 指定模式
  const urlPack = (location.search.match(/[?&]pack=(\w+)/) || [])[1];
  if (JQ.PACKS[urlPack] && JQ.PACKS[urlPack].open && (urlPack !== 'custom' || JQ.customReady())) pack = urlPack; // 调试：?pack=tang 指定卡包
  const urlStage = +(location.search.match(/[?&]stage=(\d+)/) || [])[1]; // 调试：?stage=200 直达某关
  if (urlStage) {
    const n = clampStage(urlStage);
    if (mode === 'fate') (fateSave.tier = n), (fateSave.best = Math.max(fateSave.best, n));
    else (classicStage = n), (classicBest = Math.max(classicBest, n));
    saveFate();
    saveStage();
  }
  if (/[?&]screen=talents/.test(location.search)) (mode = 'fate'), (fateSave.coins = Math.max(fateSave.coins, 300)), (screen = 'talents'); // 调试：直接打开天赋商店
  if (/[?&]screen=roster/.test(location.search)) (helpPage = 1), (helpPack = pack), (screen = 'help'); // 调试：直接打开英雄图鉴
  if (/[?&]screen=units/.test(location.search)) screen = 'units'; // 调试：直接打开小兵图鉴
  if (/[?&]screen=bonds/.test(location.search)) (helpPage = 1), (helpPack = 'bonds'), (screen = 'help'); // 调试：直接打开羁绊一览
  let dblSell = localStorage.getItem('jq_dblsell') === '1'; // 设置：双击卡牌直接卖掉
  let skillToast = localStorage.getItem('jq_skilltoast') !== '0'; // 设置：英雄放技能时的弹字/大招横幅
  let lastTap = null;
  // 战绩按模式记：{ classic: {win, lose}, survival: {best} ... }
  let records = JSON.parse(localStorage.getItem('jq_records') || 'null');
  if (!records) {
    const old = JSON.parse(localStorage.getItem('jq_record') || '{"win":0,"lose":0}');
    records = { classic: old };
  }
  const rec = (m) => (records[m] = records[m] || { win: 0, lose: 0, best: 0 });

  function say(s, t) {
    view.info = s;
    view.infoT = t || 3;
  }

  // 经典/天命共用关卡进度；天命沿用 fateSave.tier 作为当前关
  const stageOf = () => (mode === 'fate' ? fateSave.tier : classicStage);
  const bestOf = () => (mode === 'fate' ? fateSave.best : classicBest);
  function setStage(n) {
    n = clampStage(n);
    if (n > bestOf()) return;
    if (mode === 'fate') fateSave.tier = n;
    else classicStage = n;
    saveFate();
    saveStage();
  }
  function stageCleared() {
    // 当前关是否已经解锁过下一关
    return stageOf() < bestOf() || stageOf() >= C.MAX_STAGE;
  }

  // 天命模式对手的天赋：关卡越高带得越多（带「贪婪」再多一条），最多 3 条
  function enemyTalents(rand) {
    if (mode !== 'fate') return [];
    const stage = stageOf();
    const n = Math.min(3, JQ.fateEnemy(stage).talents + (fateSave.equipped.includes('tanlan') ? 1 : 0));
    // 高阶时对手只从战斗类天赋里挑
    const pool = stage >= 7 ? JQ.COMBAT_TALENTS.slice() : JQ.TALENTS.filter((t) => t.id !== 'tanlan').map((t) => t.id);
    const out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    return out;
  }

  // ---------- 养成：主公等级 + 将魂星级 + 关卡星级 ----------
  // 强度控制：将魂每星只给该英雄 +2% 攻击/血量（最多 5 星 +10%），只作用于玩家方；
  // 其余奖励是解锁感和收集感（等级、星星、宝箱给万能将魂）。敌方强度仍只由关卡决定。
  const PROG_KEY = 'jq_prog';
  const SOUL_STEPS = [20, 60, 140, 260, 450]; // 累计将魂到这些值依次升 1~5 星
  const PROG_DEF = () => ({ xp: 0, lv: 1, souls: {}, wild: 0, stars: { classic: {}, fate: {} }, chests: 0 });
  let prog = PROG_DEF();
  try {
    prog = Object.assign(PROG_DEF(), JSON.parse(localStorage.getItem(PROG_KEY) || 'null') || {});
  } catch (e) {}
  const saveProg = () => localStorage.setItem(PROG_KEY, JSON.stringify(prog));
  const soulStar = (pts) => SOUL_STEPS.filter((v) => (pts || 0) >= v).length;
  const lvNeed = (lv) => 100 + 40 * (lv - 1);
  function masteryMap() {
    const m = {};
    for (const [k, v] of Object.entries(prog.souls)) if (soulStar(v)) m[k] = soulStar(v);
    return m;
  }
  function totalStars() {
    let n = 0;
    for (const md of Object.values(prog.stars)) for (const v of Object.values(md)) n += v;
    return n;
  }
  // 给一个英雄加将魂，返回 { name, add, from, to }
  function addSouls(name, add) {
    const from = soulStar(prog.souls[name]);
    prog.souls[name] = (prog.souls[name] || 0) + add;
    return { name, add, from, to: soulStar(prog.souls[name]) };
  }
  // 一局结束：经验、将魂、关卡星级、星级宝箱
  function grantProgress(g, win) {
    const s = g.sides[0];
    const stage = g.stage || 1;
    const out = { xp: 0, lvUps: 0, souls: [], stars: 0, newStars: 0, chest: 0 };
    out.xp = win ? 60 + 2 * Math.min(100, stage) : 25 + Math.min(60, stage);
    if (g.R.waves) out.xp = 20 + 8 * Math.max(0, g.wave - 1);
    prog.xp += out.xp;
    while (prog.xp >= lvNeed(prog.lv)) {
      prog.xp -= lvNeed(prog.lv);
      prog.lv++;
      out.lvUps++;
      prog.wild += 20;
    }
    for (const [name, lv] of Object.entries(s.stats.heroLv)) out.souls.push(addSouls(name, (win ? 12 : 6) + 4 * lv));
    out.souls.sort((a, b) => b.to - b.from - (a.to - a.from) || b.add - a.add);
    if (win && (g.modeKey === 'classic' || g.modeKey === 'fate')) {
      const f = s.hp / s.maxHp;
      out.stars = f >= 0.7 ? 3 : f >= 0.4 ? 2 : 1;
      const md = (prog.stars[g.modeKey] = prog.stars[g.modeKey] || {});
      out.newStars = Math.max(0, out.stars - (md[stage] || 0));
      md[stage] = Math.max(md[stage] || 0, out.stars);
    }
    // 每攒 10 颗关卡星开一个宝箱：30 万能将魂
    while (Math.floor(totalStars() / 10) > prog.chests) (prog.chests++, (prog.wild += 30), out.chest++);
    saveProg();
    return out;
  }
  // 本局 MVP：输出最高的英雄 + 输出最高的兵种
  function mvpOf(g) {
    const st = g.sides[0].stats;
    let hero = null, unit = null, total = 0;
    for (const [k, v] of Object.entries(st.dmg)) {
      total += v;
      if (HEROES[k]) (!hero || v > hero.dmg) && (hero = { key: k, dmg: v });
      else if (UNITS[k]) (!unit || v > unit.dmg) && (unit = { key: k, dmg: v });
    }
    if (hero) hero.kills = st.heroKills[hero.key] || 0;
    if (unit) unit.kills = st.heroKills[unit.key] || 0;
    return { hero, unit, total: Math.max(1, total) };
  }

  function newGame() {
    if (pack === 'custom' && !JQ.customReady()) return openCustom();
    const seedV = (Math.random() * 1e9) | 0;
    // 新一局恢复默认分辨率，给上一局掉过画质的设备一次重新评估的机会
    if (qScale !== 1) (qScale = 1), resize();
    fpsAcc = 0;
    fpsN = 0;
    const talents = mode === 'fate' ? [fateSave.equipped.slice(), enemyTalents(JQ.rng(seedV ^ 77))] : [[], []];
    const staged = mode === 'classic' || mode === 'fate';
    const stage = staged ? stageOf() : 1;
    const enemyBoost = staged ? JQ.stageBoost(stage) : 1;
    game = new JQ.Game({ seed: seedV, difficulty, mode, pack, talents, enemyBoost, stage, skillToast, aiProfile: JQ.aiProfile(difficulty, player), mastery: masteryMap() });
    window.__jqGame = game; // 调试/性能测试用
    actions = 0;
    lastReward = null;
    lastProg = null;
    lastMvp = null;
    game.on((ev, d) => {
      // 记玩家操作数，用来估手速
      if (d && d.side === 0 && (ev === 'place' || ev === 'recruit' || ev === 'sell' || ev === 'item')) actions++;
      if (ev === 'outpostLost' && d.side === 0) say('前哨失守！卡已退回备战席', 2);
      if (ev === 'recruit' && d.side === 0) (sfx('recruit'), (view.shopAnim = performance.now()));
      if (ev === 'place' && d.side === 0) sfx(d.how === 'merge' ? 'merge' : 'place');
      if (ev === 'sell' && d.side === 0) (sfx('sell'), (view.bunPop = 0.3));
      if (ev === 'hero') sfx('hero');
      if (ev === 'ult') sfx('ult');
      if (ev === 'skill' && d.side === 0) sfx('skill');
      if (ev === 'baseHit' && d.side === 0 && performance.now() - lastHit > 250) (lastHit = performance.now()), sfx('hit');
      if (ev === 'event') say(`天命【${d.name}】${d.desc}`, 4);
      if (ev === 'wave' && d.n % 4 === 0) say(`第 ${d.n} 波：敌将来袭！`, 3);
      if (ev === 'over') {
        const r = rec(game.modeKey);
        if (game.R.waves) {
          sfx(game.wave > (r.best || 0) ? 'win' : 'lose');
          r.best = Math.max(r.best || 0, game.wave);
        } else {
          sfx(d.winner === 0 ? 'win' : 'lose');
          if (d.winner === 0) r.win++;
          else if (d.winner === 1) r.lose++;
          // 标准难度：输了下一局变笨一点，赢了变强一点
          if (difficulty === 'normal' && d.winner !== -1) player.adapt = d.winner === 0 ? Math.min(1.5, player.adapt * 1.06) : Math.max(0.55, player.adapt * 0.9);
          const win = d.winner === 0;
          const stage = game.stage || 1;
          const staged = game.modeKey === 'classic' || game.modeKey === 'fate';
          if (staged) {
            const next = Math.min(C.MAX_STAGE, stage + 1);
            if (win) {
              if (game.modeKey === 'fate') {
                fateSave.best = Math.max(fateSave.best, next);
                fateSave.tier = Math.min(fateSave.best, next);
              } else {
                classicBest = Math.max(classicBest, next);
                classicStage = Math.min(classicBest, next);
                saveStage();
              }
            } else if (game.modeKey === 'fate') {
              fateSave.tier = Math.min(fateSave.best, stage); // 失败留在本关
            }
            lastReward = { win, stage, next: win ? next : stage, max: stage >= C.MAX_STAGE };
            if (game.modeKey === 'fate') {
              const greed = fateSave.equipped.includes('tanlan');
              const coins = win ? Math.round((40 + 8 * Math.min(20, stage - 1)) * (greed ? 1.6 : 1)) : 12;
              fateSave.coins += coins;
              lastReward.coins = coins;
              lastReward.tier = fateSave.tier;
              lastReward.shop = win;
              if (win) rollOffers(); // 赢了刷新商店
              saveFate();
            }
          }
        }
        // 手速：对局超过半分钟才计入，滑动平均
        if (game.time > 30) {
          const apm = actions / (game.time / 60);
          player.apm = player.games ? player.apm * 0.7 + apm * 0.3 : apm;
          player.games++;
        }
        localStorage.setItem('jq_player', JSON.stringify(player));
        localStorage.setItem('jq_records', JSON.stringify(records));
        lastProg = grantProgress(game, d.winner === 0);
        lastMvp = mvpOf(game);
        setTimeout(() => ((screen = 'over'), (overAt = performance.now())), 900);
      }
    });
    clearDrag();
    view.selected = -1;
    view.selectedCell = null;
    view.anims = [];
    view.shopAnim = performance.now();
    aiT = 1.5;
    screen = 'play';
    say('把招兵栏的卡拖进格子；点「招兵」整排刷新', 6);
  }

  function describe(card) {
    if (!card) return '';
    if (card.kind === 'unit') {
      const d = UNITS[card.key];
      return `${card.key} Lv${card.level}：${d.desc}；每次召${JQ.unitCount(card.level)}个，冷却${d.cd}秒`;
    }
    if (card.kind === 'char') return `文字「${card.key}」：左右相邻的两个字能合成英雄；拖到英雄身上可给英雄升级`;
    if (card.kind === 'building') return `${card.key} Lv${card.level}：${BUILDINGS[card.key].desc}`;
    if (card.kind === 'tile') return `格子块·${JQ.TILES[card.key].name}：拖到棋盘边上的空位扩建`;
    return `${card.key} Lv${card.level}：${ITEMS[card.key].desc}（点一下就用，也能拖到格子上存着、同级合成）`;
  }

  function describeCell(cell) {
    if (cell.links.length) {
      return cell.links
        .map((l) => {
          const h = HEROES[l.hero];
          const head = `${h.name} ${l.level}级·${h.role}｜被动【${h.passive.name}】${h.passive.desc}`;
          return l.level >= game.R.ultLevel ? `${head}｜大招【${h.ult.name}】` : `${head}｜技能【${h.skill.name}】`;
        })
        .join('；');
    }
    return describe(cell.card) + '（可拖动换位，拖到包子上卖）';
  }

  // ---------- 输入 ----------
  // 手感要点：触屏时落点在手指上方（手指不挡卡）、就近吸附到合法格子、
  // 拖动中实时预览落点、放下有弹跳反馈、放不下时卡片飞回原处。
  function toLogic(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * (C.W + 2 * padX) - padX, y: ((e.clientY - r.top) / r.height) * (C.H + 2 * padY) - padY };
  }
  const inRect = (p, r, pad) => ((pad = pad || 0), p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad);
  function shopAt(p) {
    for (let i = 0; i < C.SHOP_SIZE; i++) if (inRect(p, JQ.shopRect(i))) return i;
    return -1;
  }
  function cellAt(p) {
    const c = Math.floor((p.x - JQ.L.BX0) / C.CELL), r = Math.floor((p.y - JQ.L.P_TOP) / C.CELL);
    if (c < 0 || c >= C.COLS || r < -C.FWD || r >= C.ROWS) return null;
    return game.sides[0].board.cell(r, c);
  }
  function clearDrag() {
    view.heldCard = view.dragFrom = view.dragPos = view.hoverCell = view.target = null;
  }
  const TOUCH_LIFT = 46; // 触屏时落点比手指高出的距离

  // 找落点：手下的格子合法就用它，否则吸附到附近最近的合法格子
  // 备战席落点：返回 {shop, how}；how = merge 合成 / swap 换位 / move 挪到空位 / return 收回
  function benchTarget(held, from, j) {
    const s = game.sides[0];
    const b = s.shop[j];
    const mergeable = b && JQ.boardable(held) && JQ.sameCard(held, b) && JQ.cardLevelOk(b);
    if (from.shop != null) {
      if (j === from.shop) return null;
      return { shop: j, how: mergeable ? 'merge' : b ? 'swap' : 'move' };
    }
    if (!b) return { shop: j, how: 'return' };
    if (mergeable) return { shop: j, how: 'merge' };
    return JQ.boardable(b) ? { shop: j, how: 'swap' } : null;
  }

  function findTarget(held, from, pt) {
    const b = game.sides[0].board;
    if (inRect(pt, UI.bun, 14) && held.kind !== 'item') return { sell: true };
    const j = shopAt(pt);
    if (j >= 0) return benchTarget(held, from, j);
    let valid;
    if (held.kind === 'tile') valid = (x) => (!x.unlocked && b.tileAnchor(held.key, x.r, x.c) ? 'tile' : null);
    else if (from.cell) valid = (x) => (x !== from.cell ? b.canMove(from.cell.r, from.cell.c, x.r, x.c) : null);
    else valid = (x) => b.canPlace(held, x.r, x.c);
    const under = cellAt(pt);
    if (under) {
      const how = valid(under);
      if (how) return { cell: under, how };
      // 正对着场上一张不同的卡：顶替它（只认正对，吸附时不会误替换）
      if (from.shop != null && b.canReplace(held, under.r, under.c)) return { cell: under, how: 'replace' };
    }
    let best = null, bd = C.CELL * 0.9;
    for (const x of b.all()) {
      const r = JQ.cellRect(0, x.r, x.c);
      const d = Math.hypot(r.cx - pt.x, r.cy - pt.y);
      if (d >= bd) continue;
      const how = valid(x);
      if (how) (bd = d), (best = { cell: x, how });
    }
    return best;
  }

  function anim(a) {
    a.t0 = performance.now();
    view.anims.push(a);
  }
  function popAt(cell, how) {
    anim({ kind: 'pop', r: cell.r, c: cell.c, how });
    if (navigator.vibrate) navigator.vibrate(how === 'merge' ? [12, 30, 12] : 10);
  }
  // 放不下：卡从落点飞回原位
  function flyBack(card, from, pos) {
    const to = from.shop != null ? JQ.shopRect(from.shop) : JQ.cellRect(0, from.cell.r, from.cell.c);
    anim({ kind: 'back', card, x: pos.x, y: pos.y, to, shop: from.shop, cell: from.cell });
  }

  let buttons = [];
  // 按钮按下反馈：点到的按钮缩到 0.93 再弹回（约 160ms）
  let pressed = null;
  function pressK(x, y) {
    if (!pressed || pressed.x !== x || pressed.y !== y) return 1;
    const k = (performance.now() - pressed.t) / 160;
    if (k >= 1) return 1;
    return 1 - 0.07 * Math.sin(Math.PI * k);
  }
  let down = null;

  function takeTo(si, cell, allowReplace) {
    const s = game.sides[0];
    const card = s.shop[si];
    if (!card) return false;
    const how = game.take(0, si, cell.r, cell.c, allowReplace);
    if (!how) {
      sfx('bad');
      if (card.kind === 'tile') say('格子要拼在棋盘边上的空位，不能压住已有格子', 2.5);
      else say(cell.crystal ? '水晶格不能放卡' : !cell.unlocked ? '先用格子块把这里拼出来' : '只有同名同级的卡才能叠上去升级', 2.5);
      return false;
    }
    view.selected = -1;
    if (how === 'tile') {
      for (const x of s.board.all()) if (x.unlocked && !x.card && !x.crystal) popAt(x, 'tile');
    } else popAt(cell, how);
    if (how === 'replace') anim({ kind: 'pop', shop: si });
    return true;
  }

  function moveTo(from, cell) {
    const how = game.move(0, from.r, from.c, cell.r, cell.c);
    if (!how) return false;
    popAt(cell, how);
    if (how === 'swap') popAt(from, 'swap');
    return true;
  }

  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const p = toLogic(e);
    if (screen !== 'play') {
      // 后画的按钮在上层（弹窗），倒着找
      for (let i = buttons.length - 1; i >= 0; i--) {
        const b = buttons[i];
        if (inRect(p, b)) return (pressed = { x: b.x, y: b.y, t: performance.now() }), b.fn();
      }
      if (screen === 'help') {
        // 第一页规则 → 第二页英雄图鉴 → 返回
        if (helpPage === 0) helpPage = 1;
        else (helpPage = 0), (screen = helpBack);
      }
      return;
    }
    if (game.over) return;
    if (inRect(p, UI.pause)) return (screen = 'paused');
    if (inRect(p, UI.speed)) return (view.speed = view.speed === 1 ? 2 : 1);
    const s = game.sides[0];
    if (inRect(p, UI.recruit)) {
      if (!game.recruit(0)) (sfx('bad'), say('包子不够', 1.5));
      view.selected = -1;
      view.selectedCell = null;
      return;
    }
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch (err) {}
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const si = shopAt(p);
    if (si >= 0 && view.selectedCell && view.selectedCell.card) {
      const from = view.selectedCell;
      const t = benchTarget(from.card, { cell: from }, si);
      view.selectedCell = null;
      if (t && game.toBench(0, from.r, from.c, si)) anim({ kind: 'pop', shop: si });
      else sfx('bad');
      return;
    }
    if (si >= 0 && s.shop[si]) {
      down = { p, shop: si, moved: false, touch };
      view.selectedCell = null;
      say(describe(s.shop[si]), 4);
      return;
    }
    const cell = cellAt(p);
    if (!cell) {
      view.selected = -1;
      view.selectedCell = null;
      return;
    }
    // 先点选再点格子（同样就近吸附）
    if (view.selected >= 0 && s.shop[view.selected]) {
      const t = findTarget(s.shop[view.selected], { shop: view.selected }, p);
      return takeTo(view.selected, t && t.cell ? t.cell : cell, !!t && t.how === 'replace');
    }
    if (view.selectedCell && view.selectedCell.card && view.selectedCell !== cell && cell.unlocked && !cell.crystal) {
      const from = view.selectedCell;
      view.selectedCell = null;
      if (!moveTo(from, cell)) sfx('bad');
      return;
    }
    if (cell.crystal) return say(`水晶：主角每经过一次 +${game.R.crystal} 包子`, 3);
    if (cell.unlocked && cell.card) {
      down = { p, cell, moved: false, touch };
      say(describeCell(cell), 5);
    } else if (!cell.unlocked) say('招兵抽到「格子块」后，拖到棋盘边上就能扩建', 3);
    else view.selectedCell = null;
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!down || !game) return;
    const p = toLogic(e);
    if (!down.moved && Math.hypot(p.x - down.p.x, p.y - down.p.y) > 8) {
      // 超过 8 像素才算开始拖，避免点击被误判
      down.moved = true;
      const s = game.sides[0];
      view.heldCard = down.shop != null ? s.shop[down.shop] : down.cell.card;
      view.dragFrom = down.shop != null ? { shop: down.shop } : { cell: down.cell };
      view.selected = -1;
      view.selectedCell = null;
    }
    if (!down.moved || !view.heldCard) return;
    const pt = down.touch ? { x: p.x, y: p.y - TOUCH_LIFT } : p;
    view.dragPos = pt;
    view.hoverCell = cellAt(pt);
    view.target = findTarget(view.heldCard, view.dragFrom, pt);
  });

  function endDrag(e) {
    if (!down || screen !== 'play') {
      down = null;
      return clearDrag();
    }
    const s = game.sides[0];
    if (!down.moved) {
      // 双击卖卡（设置里开启）
      const key = down.shop != null ? 'shop' + down.shop : 'cell' + down.cell.r + ',' + down.cell.c;
      const now = performance.now();
      const dbl = dblSell && lastTap && lastTap.key === key && now - lastTap.t < 350;
      lastTap = dbl ? null : { key, t: now };
      if (dbl) {
        const v = down.shop != null ? (s.shop[down.shop] && s.shop[down.shop].kind !== 'item' ? game.sellShop(0, down.shop) : 0) : game.sellCell(0, down.cell.r, down.cell.c);
        if (v) say(`卖掉了，+${v} 包子`, 1.5);
        view.selected = -1;
        view.selectedCell = null;
        down = null;
        return clearDrag();
      }
      // 点击：道具直接用；其他卡切换选中
      if (down.shop != null) {
        const card = s.shop[down.shop];
        if (card && card.kind === 'item') {
          if (game.take(0, down.shop, null, null)) sfx('merge');
          else (sfx('bad'), say('基地满血，暂时用不上', 2));
          view.selected = -1;
        } else if (view.selected >= 0 && view.selected !== down.shop && s.shop[view.selected] && JQ.sameCard(s.shop[view.selected], card) && JQ.boardable(card)) {
          game.benchMove(0, view.selected, down.shop);
          anim({ kind: 'pop', shop: down.shop });
          view.selected = -1;
        } else view.selected = view.selected === down.shop ? -1 : down.shop;
      } else if (down.cell && down.cell.card && down.cell.card.kind === 'item') {
        if (game.useCellItem(0, down.cell.r, down.cell.c)) sfx('merge');
        else (sfx('bad'), say('基地满血，暂时用不上', 2));
        view.selectedCell = null;
      } else if (down.cell) view.selectedCell = view.selectedCell === down.cell ? null : down.cell;
    } else if (view.heldCard) {
      const t = e.type === 'pointercancel' ? null : view.target;
      let ok = false;
      if (t && t.sell) {
        const v = down.cell ? game.sellCell(0, down.cell.r, down.cell.c) : game.sellShop(0, down.shop);
        if (v) (say(`卖掉了，+${v} 包子`, 2), (ok = true));
      } else if (t && t.shop != null) {
        const how = down.shop != null ? game.benchMove(0, down.shop, t.shop) : game.toBench(0, down.cell.r, down.cell.c, t.shop);
        if (how) {
          ok = true;
          anim({ kind: 'pop', shop: t.shop, how });
        }
      } else if (t && down.shop != null) ok = takeTo(down.shop, t.cell, t.how === 'replace');
      else if (t && down.cell) ok = moveTo(down.cell, t.cell);
      if (!ok) {
        // 落在棋盘上却不合法才提示，拖到别处松手算取消
        if (view.hoverCell) sfx('bad');
        flyBack(view.heldCard, view.dragFrom, view.dragPos);
      }
    }
    down = null;
    clearDrag();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && screen === 'play') screen = 'paused';
    else if (e.key === ' ' && screen === 'paused') screen = 'play';
    if (screen === 'play' && (e.key === 'r' || e.key === 'R')) game.recruit(0);
  });

  // ---------- 界面 ----------
  // 按钮配色：金=主/选中，宣纸=普通，檀木=小按钮/列表项，朱红=警示，石=不可用
  const BTN_INK = { btn_gold: '#3a2008', btn_paper: '#3a2a10', btn_wood: '#f0e0c0', btn_red: '#fff0d8', btn_stone: '#8a8478' };
  function button(x, y, w, h, label, fn, opts) {
    opts = opts || {};
    buttons.push({ x, y, w, h, fn: opts.disabled ? () => {} : fn });
    // 太窄的按钮（选关格子等）放不下素材两端的花纹，改画简洁的木底金边
    if (JQ.uiOk() && w < h * 1.3 + 24) {
      g.save();
      const pk = pressK(x, y);
      if (pk !== 1) (g.translate(x + w / 2, y + h / 2), g.scale(pk, pk), g.translate(-(x + w / 2), -(y + h / 2)));
      JQ.rr(g, x, y, w, h, 8);
      if (opts.on) {
        const grd = g.createLinearGradient(0, y, 0, y + h);
        grd.addColorStop(0, '#ffe08a');
        grd.addColorStop(1, '#d08a26');
        g.fillStyle = grd;
      } else g.fillStyle = opts.disabled ? 'rgba(40,32,24,0.85)' : '#4a3020';
      g.fill();
      g.lineWidth = opts.on ? 2.5 : 1.5;
      g.strokeStyle = opts.disabled ? 'rgba(160,140,110,0.35)' : '#c9a35a';
      g.stroke();
      text(g, label, x + w / 2, y + h / 2 + 1, Math.min(opts.size || 18, h * 0.5), opts.on ? '#3a2008' : opts.disabled ? '#7a6e5c' : '#f0e0c0');
      g.restore();
      return;
    }
    if (JQ.uiOk()) {
      const kind = opts.disabled ? 'btn_stone' : opts.on ? 'btn_gold' : opts.red ? 'btn_red' : opts.flat ? 'btn_wood' : 'btn_paper';
      g.save();
      const pk = pressK(x, y);
      if (pk !== 1) (g.translate(x + w / 2, y + h / 2), g.scale(pk, pk), g.translate(-(x + w / 2), -(y + h / 2)));
      JQ.ui3(g, kind, x, y, w, h, 46);
      const size = opts.size || (opts.flat ? 18 : 34);
      text(g, label, x + w / 2, y + h / 2 + 2, Math.min(size, h * 0.52), BTN_INK[kind], kind === 'btn_wood' ? { stroke: '#1a1008', strokeW: 3 } : undefined);
      g.restore();
      return;
    }
    if (opts.flat) {
      g.save();
      JQ.rr(g, x, y, w, h, 8);
      g.fillStyle = opts.disabled ? '#2f2a22' : opts.on ? '#8a6120' : '#4a4030';
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = opts.disabled ? '#4a4030' : opts.on ? '#ffd23f' : '#8a7a5a';
      g.stroke();
      text(g, label, x + w / 2, y + h / 2 + 1, opts.size || 18, opts.disabled ? '#7a7060' : opts.on ? '#ffe9a0' : '#e8dcc0');
      g.restore();
      return;
    }
    g.save();
    const pk = pressK(x, y);
    if (pk !== 1) (g.translate(x + w / 2, y + h / 2), g.scale(pk, pk), g.translate(-(x + w / 2), -(y + h / 2)));
    g.shadowColor = 'rgba(0,0,0,0.4)';
    g.shadowBlur = 8;
    g.shadowOffsetY = 3;
    JQ.rr(g, x, y, w, h, 14);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, opts.on ? '#ffe39a' : '#f3ead3');
    grd.addColorStop(1, opts.on ? '#e09a33' : '#cfc3a4');
    g.fillStyle = grd;
    g.fill();
    g.shadowColor = 'transparent';
    g.lineWidth = 3;
    g.strokeStyle = '#6a4a20';
    g.stroke();
    text(g, label, x + w / 2, y + h / 2 + 2, opts.size || 34, '#3a2a10');
    g.restore();
  }

  function veil(a) {
    g.fillStyle = `rgba(20,14,6,${a})`;
    g.fillRect(-padX, -padY, C.W + 2 * padX, C.H + 2 * padY);
  }

  // 二级页面统一外框：木质大面板 + 顶部卷轴标题（素材没加载时退回暗纱+大字）
  function pageFrame(titleStr, a) {
    veil(a == null ? 0.78 : a);
    // 面板铺满整屏；卷轴标题最多上移 60，别离内容太远
    const top = -Math.min(JQ.VIEW.top, 60), sy = -JQ.VIEW.top, sb = C.H + JQ.VIEW.bot;
    if (!JQ.ui9(g, 'panel', 6, Math.min(top + 30, sy + 6), C.W - 12, sb - Math.min(top + 30, sy + 6) - 6, 40, 30)) return title(titleStr, 50, 44, '#f5ead0');
    // 面板木纹拉伸后偏糊，压一层暗色让文字更清楚
    g.fillStyle = 'rgba(16,10,5,0.45)';
    JQ.rr(g, 24, Math.min(top + 30, sy + 6) + 18, C.W - 48, sb - Math.min(top + 30, sy + 6) - 42, 10);
    g.fill();
    JQ.ui3(g, 'scroll', C.W / 2 - 200, top + 2, 400, 78, 70);
    text(g, titleStr, C.W / 2, top + 42, 32, '#3a2008');
  }

  function title(s, y, size, color) {
    color = color || '#1a1a1a';
    const dark = color === '#1a1a1a' || color === '#333' || color === '#7a1010';
    text(g, s, C.W / 2, y, size, color, { stroke: dark ? '#f5ead0' : '#1a1008', strokeW: size / 8 });
  }

  let menuGame = null, menuPop = (location.search.match(/[?&]pop=(\w+)/) || [])[1] || null; // menuPop：'settings' 设置弹窗 / 'packs' 卡包抽屉
  const menuView = { g, speed: 1, selected: -1, anims: [], noHud: true }; // 背景演示局不画 HUD
  const MENU_PACKS = ['sanguo', 'xiyou', 'tang', 'custom', 'xuanhuan', 'mofa', 'song'];
  const PACK_ART = {}; // 卡包封面图（AI 生图），没有的卡包画大字
  const PACK_FOCUS = { sanguo: 0.55, xiyou: 0.62 }; // 竖图裁成横幅时取景的高度位置（0 顶 ~ 1 底），默认 0.4
  for (const k of ['sanguo', 'xiyou', 'tang', 'custom']) {
    const im = new Image();
    im.src = `img/pack_${k}.jpg?v=20261110a`;
    PACK_ART[k] = im;
  }
  function choosePack(k) {
    pack = k;
    helpPack = k;
    localStorage.setItem('jq_pack', k);
  }
  // 圆形小图标按钮（齿轮/问号/箭头）
  const ICON_OF = { '⚙': 'ic_gear', '?': 'ic_help', '×': 'ic_close' };
  function iconBtn(x, y, size, label, fn) {
    buttons.push({ x, y, w: size, h: size, fn });
    const k = pressK(x, y);
    g.save();
    g.translate(x + size / 2, y + size / 2);
    g.scale(k, k);
    const ic = ICON_OF[label];
    if (ic ? JQ.uiDraw(g, ic, -size / 2, -size / 2, size, size) : JQ.uiDraw(g, 'disc', -size / 2, -size / 2, size, size)) {
      if (!ic) text(g, label, 0, 1, size * 0.55, '#ffe9a0', { stroke: '#2a1a08', strokeW: 3 });
      return g.restore();
    }
    g.fillStyle = 'rgba(30,22,12,0.62)';
    g.beginPath();
    g.arc(0, 0, size / 2, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,215,140,0.7)';
    g.lineWidth = 2;
    g.stroke();
    text(g, label, 0, 2, size * 0.5, '#ffe9a0');
    g.restore();
  }
  const NAV_ICON = { 将: 'ic_hero', 兵: 'ic_unit', 运: 'ic_talent', 编: 'ic_custom', 试: 'ic_test' };
  // 底栏图标：图标素材（没加载时画朱红汉字印章）+ 下方说明
  function navItem(x, y, w, h, glyph, label, fn) {
    buttons.push({ x, y, w, h, fn });
    const k = pressK(x, y);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(k, k);
    if (JQ.uiDraw(g, NAV_ICON[glyph], -31, -h / 2 + 6, 62, 62)) {
      text(g, label, 0, h / 2 - 18, 16, '#e8dcc0', { font: 'sans-serif', bold: false });
      return g.restore();
    }
    JQ.rr(g, -26, -h / 2 + 10, 52, 52, 12);
    g.fillStyle = '#8c2f1c';
    g.fill();
    g.strokeStyle = '#e6c27a';
    g.lineWidth = 2;
    g.stroke();
    text(g, glyph, 0, -h / 2 + 37, 32, '#fff3d6');
    text(g, label, 0, h / 2 - 18, 16, '#e8dcc0', { font: 'sans-serif', bold: false });
    g.restore();
  }
  // 分段选择器（模式/难度）
  function segmented(x, y, w, h, items, cur, pick, size) {
    const n = items.length, sw = w / n;
    g.save();
    JQ.rr(g, x, y, w, h, h / 2);
    g.fillStyle = 'rgba(25,18,10,0.66)';
    g.fill();
    g.strokeStyle = 'rgba(255,210,130,0.45)';
    g.lineWidth = 1.5;
    g.stroke();
    items.forEach(([k, label], i) => {
      const bx = x + i * sw;
      buttons.push({ x: bx, y, w: sw, h, fn: () => pick(k) });
      if (k === cur) {
        JQ.rr(g, bx + 4, y + 4, sw - 8, h - 8, (h - 8) / 2);
        const grd = g.createLinearGradient(0, y, 0, y + h);
        grd.addColorStop(0, '#ffe39a');
        grd.addColorStop(1, '#e09a33');
        g.fillStyle = grd;
        g.fill();
      }
      text(g, label, bx + sw / 2, y + h / 2 + 1, size || 24, k === cur ? '#3a2a10' : '#e8dcc0');
    });
    g.restore();
  }
  let menuShade = null;
  function drawMenu(dt) {
    // 背景放一局 AI 对打当演示；开局的快进分几帧做完，避免一次卡顿几百毫秒
    if (!menuGame || menuGame.over) {
      menuGame = new JQ.Game({ seed: (Math.random() * 1e9) | 0 });
      menuGame.aiT = [0, 0];
      menuGame.warm = 60 * 50;
    }
    const warmSteps = menuGame.warm > 0 ? Math.min(menuGame.warm, 300) : 0;
    for (let k = 0; k < warmSteps; k++) {
      for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= STEP) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
      menuGame.step(STEP);
    }
    menuGame.warm -= warmSteps;
    for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= dt) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
    menuGame.step(dt);
    JQ.render(menuGame, menuView);
    // 中间留给背景战斗：整体只压一层薄纱，上下两头再加深一点托住文字
    veil(0.42);
    const top = -JQ.VIEW.top, bot = C.H + JQ.VIEW.bot;
    if (!menuShade || menuShade.top !== top || menuShade.bot !== bot) {
      const a = g.createLinearGradient(0, top, 0, 440);
      a.addColorStop(0, 'rgba(20,14,6,0.72)');
      a.addColorStop(0.75, 'rgba(20,14,6,0.45)');
      a.addColorStop(1, 'rgba(20,14,6,0)');
      const b = g.createLinearGradient(0, 800, 0, bot);
      b.addColorStop(0, 'rgba(20,14,6,0)');
      b.addColorStop(0.3, 'rgba(20,14,6,0.6)');
      b.addColorStop(1, 'rgba(20,14,6,0.85)');
      menuShade = { top, bot, a, b };
    }
    g.fillStyle = menuShade.a;
    g.fillRect(-padX, top, C.W + 2 * padX, 440 - top);
    g.fillStyle = menuShade.b;
    g.fillRect(-padX, 800, C.W + 2 * padX, bot - 800);

    iconBtn(16, top + 14, 56, '?', () => ((helpBack = 'menu'), (helpPage = 0), (screen = 'help')));
    iconBtn(648, top + 14, 56, '⚙', () => (menuPop = 'settings'));
    // 主公等级 + 关卡星 + 万能将魂
    {
      const bx = 84, by = top + 22;
      text(g, `主公 Lv${prog.lv}`, bx, by + 6, 17, '#ffe9a0', { align: 'left', stroke: '#2a1a08', strokeW: 3 });
      g.save();
      JQ.rr(g, bx, by + 20, 150, 7, 3.5);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fill();
      JQ.rr(g, bx, by + 20, Math.max(4, (150 * prog.xp) / lvNeed(prog.lv)), 7, 3.5);
      g.fillStyle = '#e6b04a';
      g.fill();
      g.restore();
      text(g, `★ ${totalStars()}   魂 ${prog.wild}`, bx + 250, by + 6, 15, '#ffd23f', { align: 'left', font: 'sans-serif', stroke: '#2a1a08', strokeW: 3 });
      text(g, `下个宝箱 ${10 - (totalStars() % 10)} 星`, bx + 250, by + 25, 11, '#d8c8a0', { align: 'left', font: 'sans-serif', bold: false });
    }
    title('禁区突围', 110, 92, '#1a1a1a');
    text(g, '招兵 · 拼格 · 合字成将', C.W / 2, 182, 20, '#f5ead0');
    segmented(110, 210, 500, 56, Object.entries(JQ.MODES).map(([k, m]) => [k, m.name]), mode, (k) => {
      mode = k;
      localStorage.setItem('jq_mode', k);
    }, 26);
    const M = JQ.MODES[mode];
    text(g, wrap(M.desc, 40)[0], C.W / 2, 290, 15, '#e8dcc0', { bold: false, font: 'sans-serif' });
    const r = rec(mode);
    if (mode === 'classic' || mode === 'fate') {
      const st = stageOf();
      // 关卡牌：点一下进选关
      buttons.push({ x: 170, y: 308, w: 380, h: 84, fn: () => openStages() });
      const k = pressK(170, 308);
      g.save();
      g.translate(C.W / 2, 350);
      g.scale(k, k);
      g.translate(-C.W / 2, -350);
      panel(170, 308, 380, 84, 'rgba(25,16,8,0.62)', 'rgba(255,210,120,0.6)', 2);
      text(g, `第 ${st} 关`, C.W / 2 - 20, 340, 34, '#ffe9a0', { stroke: '#2a1a08', strokeW: 5 });
      text(g, `/ ${C.MAX_STAGE}`, C.W / 2 + 102, 344, 15, '#bfa878', { font: 'sans-serif', bold: false });
      text(g, '选关 ›', 532, 341, 14, '#e6c27a', { align: 'right', font: 'sans-serif', bold: false });
      JQ.rr(g, 200, 368, 320, 8, 4);
      g.fillStyle = 'rgba(255,220,160,0.18)';
      g.fill();
      JQ.rr(g, 200, 368, Math.max(4, (320 * bestOf()) / C.MAX_STAGE), 8, 4);
      g.fillStyle = '#e6b04a';
      g.fill();
      g.restore();
      const info = mode === 'fate'
        ? `最佳 ${fateSave.best} 关 · ${r.win} 胜 ${r.lose} 负 · 金币 ${fateSave.coins} · 敌强 ×${JQ.stageBoost(st).toFixed(2)}`
        : `${r.win} 胜 ${r.lose} 负 · 已解锁 ${classicBest} 关 · 敌强 ×${JQ.stageBoost(st).toFixed(2)}`;
      text(g, info, C.W / 2, 410, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
    } else {
      panel(210, 308, 300, 64, 'rgba(25,16,8,0.62)', 'rgba(255,210,120,0.6)', 2);
      text(g, `最佳：第 ${r.best || 0} 波`, C.W / 2, 340, 28, '#ffe9a0', { stroke: '#2a1a08', strokeW: 5 });
      text(g, `敌军数量 ×${JQ.aiProfile(difficulty, player).wave} · 不限时`, C.W / 2, 392, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
    }

    // 下半屏：卡包 → 开战 → 难度
    const open = MENU_PACKS.filter((k) => JQ.PACKS[k] && JQ.PACKS[k].open && (k !== 'custom' || JQ.customReady()));
    const cyc = (d) => choosePack(open[(open.indexOf(pack) + d + open.length) % open.length]);
    const pk = JQ.PACKS[pack];
    if (mode === 'fate') {
      const eq = fateSave.equipped.map((id) => JQ.TALENT_BY_ID[id].name).join('、') || '未装备';
      button(170, 818, 380, 44, `天赋：${eq}`, () => (screen = 'talents'), { size: 17 });
    }
    iconBtn(116, 878, 56, '‹', () => cyc(-1));
    iconBtn(548, 878, 56, '›', () => cyc(1));
    buttons.push({ x: 184, y: 874, w: 352, h: 64, fn: () => (menuPop = 'packs') });
    {
      const k = pressK(184, 874);
      g.save();
      g.translate(C.W / 2, 906);
      g.scale(k, k);
      g.translate(-C.W / 2, -906);
      panel(184, 874, 352, 64, 'rgba(25,16,8,0.7)', 'rgba(255,210,120,0.6)', 2);
      text(g, '卡包', 222, 906, 16, '#bfa878', { font: 'sans-serif', bold: false });
      text(g, `${pk.name}（${pk.heroes.length}将）`, C.W / 2 + 16, 905, 26, '#ffe9a0');
      text(g, '▾', 514, 906, 16, '#e6c27a', { font: 'sans-serif' });
      g.restore();
    }
    // 开战：最大最亮，带呼吸光
    {
      const x = 160, y = 956, w = 400, h = 100, k = pressK(x, y);
      buttons.push({ x, y, w, h, fn: newGame });
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.scale(k, k);
      g.shadowColor = '#ffcf5a';
      g.shadowBlur = 16 + Math.sin(performance.now() / 320) * 10;
      JQ.rr(g, -w / 2, -h / 2, w, h, 24);
      const grd = g.createLinearGradient(0, -h / 2, 0, h / 2);
      grd.addColorStop(0, '#ffe39a');
      grd.addColorStop(0.55, '#f0b443');
      grd.addColorStop(1, '#c8791c');
      g.fillStyle = grd;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 3.5;
      g.strokeStyle = '#5a3a12';
      g.stroke();
      JQ.rr(g, -w / 2 + 7, -h / 2 + 7, w - 14, h - 14, 18);
      g.strokeStyle = 'rgba(255,248,220,0.55)';
      g.lineWidth = 1.5;
      g.stroke();
      text(g, '开  战', 0, 3, 48, '#3a2008', { stroke: '#ffeec0', strokeW: 3 });
      g.restore();
    }
    text(g, '难度', 226, 1098, 16, '#bfa878', { font: 'sans-serif', bold: false });
    segmented(256, 1074, 260, 48, JQ.DIFF_ORDER.map((k) => [k, JQ.DIFF[k].name]), difficulty, (k) => {
      difficulty = k;
      localStorage.setItem('jq_diff', k);
    }, 22);

    // 底栏：贴屏幕底
    const nh = 104, ny = Math.max(1134, bot - nh);
    g.save();
    g.fillStyle = 'rgba(18,13,8,0.86)';
    g.fillRect(-padX, ny, C.W + 2 * padX, bot - ny);
    g.fillStyle = 'rgba(230,194,122,0.55)';
    g.fillRect(-padX, ny, C.W + 2 * padX, 1.5);
    g.restore();
    const nav = [
      ['将', '英雄图鉴', () => ((helpBack = 'menu'), (helpPage = 1), (screen = 'help'))],
      ['兵', '小兵图鉴', () => (screen = 'units')],
      ['运', '天赋', () => ((mode = 'fate'), localStorage.setItem('jq_mode', 'fate'), (screen = 'talents'))],
      ['编', '自定义', () => openCustom()],
      ['试', '测试场', () => openTestLab()],
    ];
    nav.forEach(([gl, label, fn], i) => navItem(i * 144, ny, 144, nh, gl, label, fn));

    if (menuPop === 'settings') drawSettingsPop();
    else if (menuPop === 'packs') drawPacksPop();
  }

  // 弹窗通用：先铺一层挡板（点空白关闭），再画面板
  // 弹窗外框：木面板 + 卷轴标题；素材没加载时用纯色面板
  function popFrame(x, y, w, h, titleStr) {
    if (JQ.ui9(g, 'panel', x, y, w, h, 40, 30)) {
      g.fillStyle = 'rgba(16,10,5,0.4)';
      JQ.rr(g, x + 18, y + 18, w - 36, h - 36, 8);
      g.fill();
      JQ.ui3(g, 'scroll', x + w / 2 - 170, y - 34, 340, 70, 70);
      text(g, titleStr, x + w / 2, y + 2, 28, '#3a2008');
    } else {
      panel(x, y, w, h, 'rgba(32,22,12,0.96)', '#c9a35a', 2.5);
      text(g, titleStr, x + w / 2, y + 40, 30, '#ffe9a0', { stroke: '#2a1a08', strokeW: 4 });
    }
  }
  function popBase(x, y, w, h, titleStr) {
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => (menuPop = null) });
    veil(0.55);
    buttons.push({ x, y, w, h, fn: () => {} });
    popFrame(x, y, w, h, titleStr);
    iconBtn(x + w - 50, y - 14, 50, '×', () => (menuPop = null));
  }
  function drawSettingsPop() {
    const x = 110, y = 400, w = 500, h = 360;
    popBase(x, y, w, h, '设 置');
    const row = (i, label, on, fn) => {
      const ry = y + 90 + i * 84;
      text(g, label, x + 36, ry + 29, 24, '#f5ead0', { align: 'left' });
      buttons.push({ x: x + 300, y: ry, w: 170, h: 58, fn });
      g.save();
      JQ.rr(g, x + 360, ry + 10, 90, 38, 19);
      g.fillStyle = on ? '#d8962c' : '#4a4030';
      g.fill();
      g.beginPath();
      g.arc(on ? x + 431 : x + 379, ry + 29, 15, 0, Math.PI * 2);
      g.fillStyle = '#fff3d6';
      g.fill();
      g.restore();
      text(g, on ? '开' : '关', x + 334, ry + 30, 18, on ? '#ffd27a' : '#9a8f7a', { font: 'sans-serif' });
    };
    row(0, '音效', !muted, () => {
      muted = !muted;
      localStorage.setItem('jq_mute', muted ? '1' : '0');
    });
    row(1, '双击卖卡', dblSell, () => {
      dblSell = !dblSell;
      localStorage.setItem('jq_dblsell', dblSell ? '1' : '0');
    });
    row(2, '技能弹字/大招横幅', skillToast, () => {
      skillToast = !skillToast;
      localStorage.setItem('jq_skilltoast', skillToast ? '1' : '0');
      if (game) game.skillToast = skillToast;
    });
  }
  function drawPacksPop() {
    const x = 40, y = 250, w = 640, h = 760;
    popBase(x, y, w, h, '选择卡包');
    MENU_PACKS.forEach((k, i) => {
      const pk = JQ.PACKS[k];
      if (!pk) return;
      const cx = x + 24 + (i % 2) * 304, cy = y + 80 + Math.floor(i / 2) * 166, cw = 288, ch = 152;
      const ready = k !== 'custom' || JQ.customReady();
      const locked = !pk.open;
      if (!locked) buttons.push({ x: cx, y: cy, w: cw, h: ch, fn: () => (ready ? (choosePack(k), (menuPop = null)) : ((menuPop = null), openCustom())) });
      const kk = pressK(cx, cy);
      g.save();
      g.translate(cx + cw / 2, cy + ch / 2);
      g.scale(kk, kk);
      g.translate(-(cx + cw / 2), -(cy + ch / 2));
      JQ.rr(g, cx, cy, cw, ch, 14);
      g.save();
      g.clip();
      const art = PACK_ART[k];
      if (art && art.complete && art.naturalWidth) {
        const s = Math.max(cw / art.naturalWidth, ch / art.naturalHeight);
        const iw = art.naturalWidth * s, ih = art.naturalHeight * s;
        g.drawImage(art, cx + (cw - iw) / 2, cy + (ch - ih) * (PACK_FOCUS[k] || 0.4), iw, ih);
      } else {
        g.fillStyle = locked ? '#2a241c' : '#5a3d22';
        g.fillRect(cx, cy, cw, ch);
        g.globalAlpha = 0.22;
        text(g, pk.name.slice(0, 1), cx + cw - 70, cy + ch / 2 + 6, 120, '#f5e2b8');
        g.globalAlpha = 1;
      }
      const sh = g.createLinearGradient(0, cy + ch * 0.4, 0, cy + ch);
      sh.addColorStop(0, 'rgba(15,10,5,0)');
      sh.addColorStop(1, 'rgba(15,10,5,0.85)');
      g.fillStyle = sh;
      g.fillRect(cx, cy, cw, ch);
      if (locked) (g.fillStyle = 'rgba(15,12,8,0.6)'), g.fillRect(cx, cy, cw, ch);
      g.restore();
      if (locked) JQ.uiDraw(g, 'lock', cx + cw - 64, cy + 14, 46, 44);
      g.lineWidth = pack === k ? 4 : 2;
      g.strokeStyle = pack === k ? '#ffcf5a' : 'rgba(230,194,122,0.5)';
      g.stroke();
      text(g, pk.name, cx + 18, cy + ch - 46, 30, locked ? '#8a7f6a' : '#fff3d6', { align: 'left', stroke: '#1a1008', strokeW: 4 });
      const sub = locked ? '未解锁' : k === 'custom' ? (ready ? `${pk.heroes.length} 将 · 自选` : '去配置') : `${pk.heroes.length} 将 · ${(pk.units || []).length} 种兵`;
      text(g, sub, cx + 18, cy + ch - 16, 15, locked ? '#7a705c' : '#e8dcc0', { align: 'left', font: 'sans-serif', bold: false });
      if (pack === k) text(g, '出战中', cx + cw - 46, cy + 22, 15, '#ffcf5a', { font: 'sans-serif', stroke: '#1a1008', strokeW: 3 });
      g.restore();
    });
  }

  // ---------- 选关 ----------
  let stagePage = 0;
  function openStages() {
    stagePage = Math.floor((stageOf() - 1) / 100);
    screen = 'stages';
  }
  function drawStages() {
    if (menuGame) JQ.render(menuGame, menuView);
    pageFrame(`选关 · 第 ${stageOf()} 关`);
    text(g, `${JQ.MODES[mode].name} · 已解锁 ${bestOf()} / ${C.MAX_STAGE} 关`, C.W / 2, 135, 17, '#d8c8a0', { font: 'sans-serif', bold: false });
    const start = stagePage * 100 + 1;
    for (let i = 0; i < 100; i++) {
      const n = start + i;
      if (n > C.MAX_STAGE) break;
      const col = i % 10, row = Math.floor(i / 10);
      button(32 + col * 66, 170 + row * 64, 60, 54, String(n), () => {
        setStage(n);
        screen = 'menu';
      }, { flat: true, on: n === stageOf(), disabled: n > bestOf(), size: n > 99 ? 17 : 19 });
    }
    button(110, 840, 200, 56, '上一页', () => (stagePage = Math.max(0, stagePage - 1)), { flat: true, disabled: stagePage === 0, size: 20 });
    button(410, 840, 200, 56, '下一页', () => (stagePage = Math.min(1, stagePage + 1)), { flat: true, disabled: stagePage === 1, size: 20 });
    text(g, `第 ${stagePage + 1} / 2 页`, C.W / 2, 920, 16, '#bfb39a', { font: 'sans-serif', bold: false });
    button(210, 1150, 300, 64, '返 回', () => (screen = 'menu'), { size: 26 });
  }

  // ---------- 自定义卡包 ----------
  let customHeroes = [], customUnits = [], customMsg = '';
  function openCustom() {
    customHeroes = JQ.PACKS.custom.heroes.slice();
    customUnits = JQ.PACKS.custom.units.slice();
    customMsg = '';
    screen = 'custom';
  }
  function toggleCustomHero(name) {
    const i = customHeroes.indexOf(name);
    if (i >= 0) customHeroes.splice(i, 1);
    else if (customHeroes.length >= 16) customMsg = '最多选 16 位英雄';
    else (customHeroes.push(name), (customMsg = ''));
  }
  function toggleCustomUnit(key) {
    const i = customUnits.indexOf(key);
    if (i >= 0) customUnits.splice(i, 1);
    else if (customUnits.length >= 12) customMsg = '最多选 12 种小兵';
    else (customUnits.push(key), (customMsg = ''));
  }
  function customValid() {
    return customHeroes.length === 16 && customUnits.length >= 6 && customUnits.length <= 12;
  }
  function applyCustom() {
    JQ.setCustomPack({ heroes: customHeroes, units: customUnits });
    saveCustom();
  }
  function drawCustom() {
    if (menuGame) JQ.render(menuGame, menuView);
    pageFrame('自定义卡包');
    text(g, `英雄 ${customHeroes.length}/16 · 小兵 ${customUnits.length}/6-12`, C.W / 2, 96, 16, customValid() ? '#9fe0a0' : '#ffb090', { font: 'sans-serif', bold: false });
    text(g, '英雄（点选 / 再点取消）', 18, 122, 14, '#ffd23f', { align: 'left', font: 'sans-serif', bold: false });
    const heroNames = Object.keys(HEROES);
    // 英雄多了（65 位）：8 列小格
    heroNames.forEach((name, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      button(16 + col * 86, 136 + row * 52, 80, 46, name, () => toggleCustomHero(name), { flat: true, on: customHeroes.includes(name), size: 17 });
    });
    const uy = 136 + Math.ceil(heroNames.length / 8) * 52 + 16;
    text(g, '小兵（点选 / 再点取消）', 18, uy, 14, '#ffd23f', { align: 'left', font: 'sans-serif', bold: false });
    JQ.ALL_UNITS.forEach((key, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      button(16 + col * 86, uy + 14 + row * 46, 80, 40, key, () => toggleCustomUnit(key), { flat: true, on: customUnits.includes(key), size: 19 });
    });
    const by = uy + 14 + 2 * 46 + 24;
    text(g, customMsg || (customValid() ? '可以保存并开战' : '需要 16 位英雄、6~12 种小兵'), C.W / 2, by, 15, customMsg ? '#ff8060' : '#d8c8a0', { font: 'sans-serif', bold: false });
    button(90, by + 26, 180, 56, '保 存', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和至少 6 种小兵');
      applyCustom();
      customMsg = '已保存';
    }, { size: 20 });
    button(300, by + 26, 260, 56, '保存并开战', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和至少 6 种小兵');
      applyCustom();
      pack = 'custom';
      helpPack = 'custom';
      localStorage.setItem('jq_pack', 'custom');
      screen = 'menu';
      newGame();
    }, { size: 20, on: true });
    button(230, by + 100, 260, 56, '返 回', () => (screen = 'menu'), { size: 22 });
  }

  // ---------- 测试场：自定义双方阵容，自动打一场看结果 ----------
  const TEST_KEY = 'jq_testlab';
  const testView = { g, speed: 1, test: true, selected: -1, selectedCell: null, info: '', infoT: 0, heldCard: null, dragFrom: null, dragPos: null, hoverCell: null, target: null, anims: [], shopAnim: null, bunPop: 0 };
  const testLab = { blue: [], red: [], active: 0, tab: 'hero', page: 0, heroLv: 3, unitLv: 5, msg: '', game: null, result: null, acc: 0, loaded: false };
  const testDefault = () => [
    { kind: 'hero', key: '夏夏' },
    { kind: 'unit', key: '刀' },
    { kind: 'unit', key: '刀' },
    { kind: 'unit', key: '刀' },
    { kind: 'unit', key: '刀' },
  ];
  function ensureTestLoaded() {
    if (testLab.loaded) return;
    testLab.loaded = true;
    try {
      const x = JSON.parse(localStorage.getItem(TEST_KEY) || 'null');
      if (x) {
        const ok = (e) => e && (e.kind === 'hero' ? !!HEROES[e.key] : e.kind === 'unit' ? !!UNITS[e.key] : false);
        testLab.blue = (x.blue || []).filter(ok).slice(0, 8);
        testLab.red = (x.red || []).filter(ok).slice(0, 8);
        testLab.heroLv = Math.max(1, Math.min(5, x.heroLv || 3));
        testLab.unitLv = Math.max(1, Math.min(5, x.unitLv || 5));
      }
    } catch (e) {}
    if (!testLab.blue.length && !testLab.red.length) (testLab.blue = testDefault()), (testLab.red = testDefault().map((e) => (e.kind === 'hero' ? { kind: 'hero', key: '张飞' } : { kind: 'unit', key: '刀' })));
  }
  function saveTest() {
    localStorage.setItem(TEST_KEY, JSON.stringify({ blue: testLab.blue, red: testLab.red, heroLv: testLab.heroLv, unitLv: testLab.unitLv }));
  }
  function openTestLab() {
    ensureTestLoaded();
    testLab.msg = '';
    screen = 'testlab';
  }
  function testTeam() {
    return testLab.active ? testLab.red : testLab.blue;
  }
  function testHas(key) {
    return testTeam().some((e) => e.key === key);
  }
  function addTest(kind, key) {
    const team = testTeam();
    if (team.length >= 8) return (testLab.msg = '每队最多 8 个');
    team.push({ kind, key });
    testLab.msg = '';
    saveTest();
  }
  function removeTest(team, i) {
    team.splice(i, 1);
    saveTest();
  }
  function randomTestTeam() {
    const team = testTeam();
    const hs = Object.keys(HEROES), us = JQ.ALL_UNITS;
    team.length = 0;
    for (let i = 0; i < 4; i++) team.push({ kind: 'hero', key: hs[Math.floor(Math.random() * hs.length)] });
    for (let i = 0; i < 4; i++) team.push({ kind: 'unit', key: us[Math.floor(Math.random() * us.length)] });
    testLab.msg = '';
    saveTest();
  }
  function clearTestTeam() {
    testTeam().length = 0;
    testLab.msg = '';
    saveTest();
  }
  function cycleTestLevel(which) {
    if (which === 'hero') testLab.heroLv = (testLab.heroLv % 5) + 1;
    else testLab.unitLv = (testLab.unitLv % 5) + 1;
    saveTest();
  }
  function testAlive(side) {
    return testLab.game ? testLab.game.units.filter((u) => u.side === side && u.hp > 0 && !u.isOutpost) : [];
  }
  function testHp(side) {
    const us = testAlive(side);
    if (!us.length) return 0;
    let hp = 0, max = 0;
    for (const u of us) (hp += Math.max(0, u.hp)), (max += u.maxHp || 1);
    return max ? hp / max : 0;
  }
  function spawnTestTeam(g, side, team) {
    const s = g.sides[side];
    let front = 0, back = 0;
    for (const e of team) {
      const d = e.kind === 'hero' ? HEROES[e.key] : UNITS[e.key];
      const isBack = !!(d.ranged || d.assassin || (e.kind === 'hero' && (d.role === '辅助' || d.role === '法师' || d.role === '射手' || d.role === '特殊')));
      const idx = isBack ? back++ : front++;
      const x = 300 + (idx % 4) * 40;
      const y = (side === 0 ? (isBack ? 660 : 620) : isBack ? 500 : 540) + Math.floor(idx / 4) * 14;
      if (e.kind === 'hero') {
        const h = g.spawnHero(s, e.key, testLab.heroLv, x, { y });
        h.ultT = 0;
        h.skillT = 0;
        h.atkT = 0.2;
      } else {
        const u = g.spawnUnit(s, e.key, testLab.unitLv, x, { y });
        u.atkT = 0.2;
      }
    }
  }
  function startTest() {
    if (!testLab.blue.length || !testLab.red.length) return (testLab.msg = '双方至少各放 1 个单位');
    const g = new JQ.Game({ seed: (Math.random() * 1e9) | 0, pack: 'sanguo' });
    g.R.time = 1e9;
    g.R.overtime = 0;
    spawnTestTeam(g, 0, testLab.blue);
    spawnTestTeam(g, 1, testLab.red);
    testLab.game = g;
    testLab.acc = 0;
    testLab.result = null;
    testLab.msg = '';
    screen = 'testplay';
  }
  function finishTest() {
    const g = testLab.game;
    if (!g) return;
    const a = testAlive(0).length, b = testAlive(1).length;
    let winner;
    if (g.over) winner = g.winner;
    else if (!a && !b) winner = -1;
    else if (!a) winner = 1;
    else if (!b) winner = 0;
    else {
      const ha = testHp(0), hb = testHp(1);
      winner = Math.abs(ha - hb) < 1e-6 ? -1 : ha > hb ? 0 : 1;
    }
    testLab.result = { winner, time: g.time, blue: { alive: a, hp: testHp(0) }, red: { alive: b, hp: testHp(1) } };
    screen = 'testover';
  }
  function drawTestTeam(idx, x, y, w, h) {
    const team = idx ? testLab.red : testLab.blue;
    const color = idx ? '#ff6a4a' : '#5ab0ff';
    const active = testLab.active === idx;
    panel(x, y, w, h, active ? 'rgba(255,240,210,0.10)' : 'rgba(255,240,210,0.04)', active ? color : 'rgba(255,240,210,0.25)', active ? 2 : 1.2);
    text(g, `${idx ? '红方' : '蓝方'} ${team.length}/8`, x + 12, y + 18, 16, color, { align: 'left' });
    if (!team.length) text(g, '点下方卡加入', x + w / 2, y + 76, 13, '#9a8f7a', { bold: false });
    team.forEach((e, i) => {
      const bx = x + 8 + (i % 4) * 82, by = y + 34 + Math.floor(i / 4) * 32;
      button(bx, by, 78, 28, e.key, () => removeTest(team, i), { flat: true, size: 15 });
    });
    buttons.push({ x, y, w, h, fn: () => (testLab.active = idx) });
  }
  function drawTestLab() {
    if (menuGame) JQ.render(menuGame, menuView);
    pageFrame('测试场');
    text(g, '点下方英雄/小兵加入当前队；点队伍里的卡移除；每队最多 8 个', C.W / 2, 84, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
    drawTestTeam(0, 12, 98, 340, 142);
    drawTestTeam(1, 368, 98, 340, 142);
    const tabY = 252;
    button(30, tabY, 100, 36, '英雄', () => ((testLab.tab = 'hero'), (testLab.page = 0)), { flat: true, on: testLab.tab === 'hero', size: 17 });
    button(140, tabY, 100, 36, '小兵', () => ((testLab.tab = 'unit'), (testLab.page = 0)), { flat: true, on: testLab.tab === 'unit', size: 17 });
    button(250, tabY, 100, 36, '随机', () => randomTestTeam(), { flat: true, size: 17 });
    button(360, tabY, 100, 36, '清空', () => clearTestTeam(), { flat: true, size: 17 });
    button(470, tabY, 210, 36, testLab.active ? '当前：红方' : '当前：蓝方', () => (testLab.active = 1 - testLab.active), { flat: true, on: true, size: 17 });
    const list = testLab.tab === 'hero' ? Object.keys(HEROES) : JQ.ALL_UNITS;
    const per = 35, pages = Math.max(1, Math.ceil(list.length / per));
    testLab.page = Math.min(testLab.page, pages - 1);
    for (let i = 0; i < per; i++) {
      const key = list[testLab.page * per + i];
      if (!key) break;
      const col = i % 7, row = Math.floor(i / 7);
      button(8 + col * 100, 298 + row * 56, 94, 50, key, () => addTest(testLab.tab === 'hero' ? 'hero' : 'unit', key), { flat: true, on: testHas(key), size: 18 });
    }
    button(30, 590, 100, 34, '上一页', () => (testLab.page = Math.max(0, testLab.page - 1)), { flat: true, disabled: testLab.page === 0, size: 15 });
    text(g, `第 ${testLab.page + 1}/${pages} 页`, C.W / 2, 607, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    button(590, 590, 100, 34, '下一页', () => (testLab.page = Math.min(pages - 1, testLab.page + 1)), { flat: true, disabled: testLab.page === pages - 1, size: 15 });
    button(30, 634, 170, 36, `英雄 Lv${testLab.heroLv}`, () => cycleTestLevel('hero'), { flat: true, size: 15 });
    button(210, 634, 170, 36, `小兵 Lv${testLab.unitLv}`, () => cycleTestLevel('unit'), { flat: true, size: 15 });
    text(g, '等级统一作用于整队，点击切换', 400, 652, 12, '#bfb39a', { align: 'left', font: 'sans-serif', bold: false });
    button(180, 692, 360, 64, '开始测试', startTest, { on: true, size: 28 });
    button(210, 770, 300, 50, '返回主页', () => (screen = 'menu'), { size: 20 });
    if (testLab.msg) text(g, testLab.msg, C.W / 2, 850, 15, '#ff8060', { font: 'sans-serif', bold: false });
  }
  function drawTestTop() {
    const names = (team) => team.map((e) => e.key).join('、');
    g.save();
    g.fillStyle = 'rgba(18,12,6,0.94)';
    g.fillRect(0, 0, C.W, 52);
    g.fillRect(-padX, 1120, C.W + 2 * padX, 160 + padY);
    g.restore();
    text(g, '测试场', 18, 26, 18, '#ffd23f', { align: 'left' });
    text(g, `蓝方 ${testAlive(0).length} vs 红方 ${testAlive(1).length}`, C.W / 2, 26, 19, '#ffe9a0', { stroke: '#1a1008', strokeW: 4 });
    text(g, `${testLab.game ? testLab.game.time.toFixed(1) : 0}s · 2x`, C.W - 18, 26, 14, '#d8c8a0', { align: 'right', font: 'sans-serif', bold: false });
    text(g, `蓝：${names(testLab.blue)}`, 18, 1150, 12, '#8cc8ff', { align: 'left', font: 'sans-serif', bold: false });
    text(g, `红：${names(testLab.red)}`, 18, 1172, 12, '#ff9a8a', { align: 'left', font: 'sans-serif', bold: false });
    text(g, '自动战斗中', C.W / 2, 1210, 15, '#d8c8a0', { font: 'sans-serif', bold: false });
  }
  function drawTestOver() {
    veil(0.84);
    const r = testLab.result;
    if (!r) return;
    const win = r.winner === 0 ? '蓝方胜' : r.winner === 1 ? '红方胜' : '平局';
    title(win, 300, 76, r.winner === 0 ? '#5ab0ff' : r.winner === 1 ? '#ff6a4a' : '#f5ead0');
    text(g, `用时 ${r.time.toFixed(1)} 秒`, C.W / 2, 370, 20, '#f5ead0', { font: 'sans-serif', bold: false });
    text(g, `蓝方存活 ${r.blue.alive} · 剩余血量 ${(r.blue.hp * 100).toFixed(0)}%`, C.W / 2, 430, 18, '#8cc8ff', { font: 'sans-serif', bold: false });
    text(g, `红方存活 ${r.red.alive} · 剩余血量 ${(r.red.hp * 100).toFixed(0)}%`, C.W / 2, 462, 18, '#ff9a8a', { font: 'sans-serif', bold: false });
    const b = testLab.blue.map((e) => e.key).join('、'), rd = testLab.red.map((e) => e.key).join('、');
    text(g, `蓝：${b}`, C.W / 2, 520, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    text(g, `红：${rd}`, C.W / 2, 544, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    button(210, 610, 300, 70, '再测一次', startTest, { on: true, size: 28 });
    button(210, 700, 300, 60, '修改阵容', () => (screen = 'testlab'), { size: 22 });
    button(210, 780, 300, 54, '返回主页', () => (screen = 'menu'), { size: 20 });
  }

  // 按逗号断行，每行不超过 n 字
  function wrap(str, n) {
    const out = [];
    let line = '';
    for (const part of str.split(/(?<=[，、：])/)) {
      if ((line + part).length > n && line) (out.push(line), (line = ''));
      line += part;
    }
    if (line) out.push(line);
    return out;
  }

  let helpBack = 'menu';
  function drawHelp() {
    pageFrame('玩法说明', 0.85);
    const lines = [
      '· 点「招兵」：备战席剩下的卡自动卖掉（几级卖几包），再整排刷新 5 张。',
      '· 主角「帅」沿格子来回走，踩到兵卡就召唤小兵（卡有冷却）。',
      '· 卡可在场上、备战席之间随意拖：移动/互换/替换/收回，拖到包子卖掉。',
      '· 同名同级卡叠在一起升级；小兵无等级上限；5 级起每次召 4 个，英雄最高 5 级。',
      '· 文字卡：两个字左右挨着就合成英雄（谁左谁右都行，字可共用）。',
      `· 英雄只算一个等级，把它的任一字拖上去就 +1 级；${C.ULT_LEVEL} 级（天命 2 级）解锁大招。`,
      '· 某个字能合成的英雄全部满级后，招兵不再刷出这个字。',
      '· 格子块拖到棋盘边上扩建；也能往战场里拼「前哨」：兵从前线出发，但哨所会被打。',
      '· 建筑：马 加移速｜鼓 减冷却｜旗 加攻击｜粮 产包子',
      '· 道具：药 基地回血｜金 +25 包子｜令 冷却清空（点一下就用）',
      '· 兵种：刀盾弓枪剑刺 + 各包骑/弩/陌/妖/魔/猴/僧/龙/鬼/甲',
      '· 模式：经典/天命都是 200 关闯关，越往后敌人越强；无限守波次。',
      '· 自定义卡包：自己选 16 位英雄（含夏夏）和 6~12 种小兵。',
      '· 测试场：自定义双方英雄/小兵阵容，自动打一场看胜负。',
    ];
    lines.forEach((l, i) => text(g, l, 26, 120 + i * 32, 17, '#f5ead0', { align: 'left', bold: false }));
    text(g, '每个卡包 16 位英雄，各有被动特长、技能和大招', C.W / 2, 580, 19, '#ffd23f');
    text(g, '（点任意处看英雄图鉴）', C.W / 2, 1250, 18, '#bfb39a');
  }

  // 小兵图鉴：16 种兵，标注出场卡包和基础数值
  function drawUnits() {
    if (menuGame) JQ.render(menuGame, menuView);
    pageFrame('小兵图鉴');
    text(g, '同字同属性 · 5 级起每次召 4 个 · 共 16 种', C.W / 2, 96, 15, '#d8c8a0', { font: 'sans-serif', bold: false });
    const role = (d) => (d.assassin ? '刺客' : d.ranged ? '远程' : d.rangedReduce ? '坦克' : '近战');
    JQ.ALL_UNITS.forEach((k, i) => {
      const d = UNITS[k];
      const x = 18 + (i % 2) * 350, y = 126 + Math.floor(i / 2) * 128, w = 334, h = 120;
      panel(x, y, w, h, 'rgba(255,240,210,0.06)', 'rgba(255,220,150,0.3)', 1.5);
      // 颜色只给等级用：这里一律朱红竖条，兵种类型写成文字
      g.save();
      g.fillStyle = '#8c2f1c';
      JQ.rr(g, x + 1, y + 8, 4, h - 16, 2);
      g.fill();
      g.restore();
      if (JQ.ui9(g, 'card', x + 10, y + 22, 56, 56, 34, 12)) text(g, k, x + 38, y + 51, 34, '#2a1a08');
      else text(g, k, x + 38, y + 50, 38, '#f5ead0', { stroke: '#1a1008', strokeW: 4 });
      text(g, `${k} · ${role(d)}`, x + 72, y + 26, 20, '#f0d698', { align: 'left' });
      text(g, d.desc, x + 72, y + 50, 12, '#bfb39a', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `血 ${d.hp} · 攻 ${d.atk} · 射程 ${d.range}`, x + 72, y + 76, 12, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `攻速 ${d.rate} · 移速 ${d.speed} · 冷却 ${d.cd}s`, x + 72, y + 96, 12, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      const packs = Object.keys(JQ.PACK_UNITS).filter((p) => p !== 'custom' && JQ.PACK_UNITS[p].includes(k)).map((p) => JQ.PACKS[p].name);
      text(g, `出场：${packs.join('/') || '仅自定义'} · 自定义可选`, x + 72, y + 112, 10, '#c9b48a', { align: 'left', bold: false, font: 'sans-serif' });
    });
    button(210, 1170, 300, 58, '返 回', () => (screen = 'menu'), { size: 24 });
  }

  // 英雄图鉴：按卡包分页
  function drawRoster() {
    pageFrame('英雄图鉴', 0.85);
    const tabs = JQ.OPEN_PACKS.concat('bonds');
    const gap = 8, tabW = Math.min(150, (C.W - 40 - gap * (tabs.length - 1)) / tabs.length), x0 = (C.W - (tabs.length * tabW + (tabs.length - 1) * gap)) / 2;
    tabs.forEach((k, i) => button(x0 + i * (tabW + gap), 82, tabW, 44, k === 'bonds' ? '羁绊' : JQ.PACKS[k].name, () => (helpPack = k), { on: helpPack === k, size: 20 }));
    if (helpPack === 'bonds') return drawBondList();
    const roster = (JQ.PACKS[helpPack] && JQ.PACKS[helpPack].heroes) || [];
    if (!roster.length) text(g, '这个卡包还没有配置英雄（自定义卡包点「自定义卡包」选 16 位）', C.W / 2, 300, 20, '#bfb39a', { bold: false });
    roster.forEach((name, i) => {
      const h = HEROES[name];
      if (!h) return;
      const x = i % 2 ? 368 : 18, y = 150 + Math.floor(i / 2) * 136;
      g.save();
      // 名字和底色不再用英雄光晕色（容易和等级色 灰绿蓝紫金 混淆），统一米金
      g.fillStyle = 'rgba(255,240,210,0.07)';
      JQ.rr(g, x - 6, y - 6, 340, 128, 10);
      g.fill();
      g.strokeStyle = 'rgba(230,194,122,0.28)';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = '#8c2f1c';
      JQ.rr(g, x - 6, y + 2, 4, 108, 2);
      g.fill();
      g.restore();
      text(g, h.name, x, y + 14, 27, '#f5e2b8', { align: 'left', stroke: '#000', strokeW: 4 });
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      JQ.rr(g, x + 58, y + 3, 64, 19, 8);
      g.fill();
      g.restore();
      text(g, h.role, x + 90, y + 13, 12, '#e8dcc0', { font: 'sans-serif', bold: false });
      const bl = (JQ.BOND_BY_HERO[name] || []).filter((b) => helpPack === 'custom' || JQ.packBonds(helpPack).includes(b));
      if (bl.length) text(g, '羁绊·' + bl.slice(0, 2).map((b) => b.name).join('/'), x + 266, y + 13, 11, '#e6b04a', { align: 'right', font: 'sans-serif', bold: false });
      // 将魂星级
      const st = soulStar(prog.souls[name]);
      text(g, '★'.repeat(st) + '☆'.repeat(5 - st), x + 330, y + 13, 11, st ? '#ffd23f' : '#6a6050', { align: 'right', font: 'sans-serif' });
      if (prog.wild >= 10 && st < 5) button(x + 276, y + 92, 54, 26, '注魂', () => (addSouls(name, 10), (prog.wild -= 10), saveProg()), { flat: true, size: 13 });
      // 说明可能较长：按列宽自动缩字号，别顶出右边界
      const fit = (s, yy, size, color, opts) => {
        let z = size;
        const font = opts.font || FONT;
        g.font = `${opts.bold === false ? '' : 'bold '}${z}px ${font}`;
        while (z > 9.5 && g.measureText(s).width > 330) {
          z -= 0.5;
          g.font = `${opts.bold === false ? '' : 'bold '}${z}px ${font}`;
        }
        text(g, s, x, yy, z, color, opts);
      };
      fit(`被动【${h.passive.name}】${h.passive.desc}`, y + 42, 13, '#d9c79a', { align: 'left', bold: false, font: 'sans-serif' });
      fit(`技能【${h.skill.name}】${h.skill.desc}`, y + 64, 13, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `大招【${h.ult.name}】`, x, y + 88, 14, '#e8a060', { align: 'left' });
      fit(h.ult.desc, y + 109, 12, '#bfb39a', { align: 'left', bold: false, font: 'sans-serif' });
    });
    text(g, '（点空白处返回）', C.W / 2, 1262, 16, '#bfb39a');
    iconBtn(650, 22, 52, '×', () => ((helpPage = 0), (screen = helpBack)));
  }

  // 羁绊一览：按卡包分组，两列
  function drawBondList() {
    const PN = { sanguo: '三国', xiyou: '西游', tang: '唐朝', song: '宋朝' };
    const packOf = (b) => {
      for (const k of Object.keys(PN)) if (b.heroes.every((h) => JQ.heroInPack(h, k))) return PN[k];
      return '跨包';
    };
    text(g, '指定英雄同时在棋盘上合成即生效；跨包羁绊只能在自定义卡包里凑', C.W / 2, 142, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
    JQ.BONDS.forEach((b, i) => {
      const x = i % 2 ? 366 : 22, y = 160 + Math.floor(i / 2) * 70, w = 332, h = 64;
      g.save();
      g.fillStyle = 'rgba(255,240,210,0.07)';
      JQ.rr(g, x, y, w, h, 10);
      g.fill();
      g.strokeStyle = 'rgba(230,194,122,0.35)';
      g.lineWidth = 1;
      g.stroke();
      g.restore();
      text(g, b.name, x + 10, y + 16, 17, '#ffcf5a', { align: 'left' });
      text(g, packOf(b), x + w - 8, y + 16, 11, '#9a8f7a', { align: 'right', font: 'sans-serif', bold: false });
      text(g, b.heroes.join('、'), x + 112, y + 17, 12, '#f0e4c8', { align: 'left', font: 'sans-serif', bold: false });
      const tl = b.tiers.map((t) => `${t.n}人：${JQ.bondTierText(t)}`).join('  ');
      // 已生效颜色只用米金，避免和等级绿撞色
      let z = 11.5;
      g.font = `${z}px sans-serif`;
      while (z > 8.5 && g.measureText(tl).width > w - 20) (z -= 0.5), (g.font = `${z}px sans-serif`);
      text(g, tl, x + 10, y + 44, z, '#d9c79a', { align: 'left', font: 'sans-serif', bold: false });
    });
  }

  function drawPause() {
    veil(0.5);
    popFrame(160, 330, 400, 680, '暂 停');
    button(210, 400, 300, 72, '继续', () => (screen = 'play'), { on: true });
    button(210, 484, 300, 72, '英雄图鉴', () => ((helpBack = 'paused'), (helpPage = 1), (helpPack = game.sides[0].pack), (screen = 'help')));
    button(210, 568, 300, 72, dblSell ? '双击卖卡：开' : '双击卖卡：关', () => {
      dblSell = !dblSell;
      localStorage.setItem('jq_dblsell', dblSell ? '1' : '0');
    }, { size: 30 });
    button(210, 652, 300, 72, muted ? '音效：关' : '音效：开', () => {
      muted = !muted;
      localStorage.setItem('jq_mute', muted ? '1' : '0');
    }, { size: 30 });
    button(210, 736, 300, 72, skillToast ? '技能弹字：开' : '技能弹字：关', () => {
      skillToast = !skillToast;
      localStorage.setItem('jq_skilltoast', skillToast ? '1' : '0');
      if (game) game.skillToast = skillToast;
    }, { size: 30 });
    button(210, 820, 300, 72, '重新开始', newGame);
    button(210, 904, 300, 72, '返回主页', () => (screen = 'menu'), { red: true });
  }

  // 天赋商店：每赢一局随机刷出 3 条可买；已拥有的在下方装上/卸下（最多 3 条）
  function rollOffers() {
    const left = JQ.TALENTS.filter((t) => !fateSave.owned.includes(t.id)).map((t) => t.id);
    const out = [];
    while (out.length < 3 && left.length) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
    fateSave.offers = out;
    saveFate();
  }

  function catChip(t, x, y) {
    // 分类签统一墨色，不借用等级色
    g.save();
    JQ.rr(g, x, y, 44, 20, 9);
    g.fillStyle = '#2a1f16';
    g.fill();
    g.strokeStyle = 'rgba(230,194,122,0.55)';
    g.lineWidth = 1;
    g.stroke();
    text(g, t.cat, x + 22, y + 11, 12, '#e8d3a8', { font: 'sans-serif' });
    g.restore();
  }

  function wrapLines(str, n) {
    const out = [];
    for (let i = 0; i < str.length; i += n) out.push(str.slice(i, i + n));
    return out;
  }

  function panel(x, y, w, h, fill, stroke, lw) {
    g.save();
    JQ.rr(g, x, y, w, h, 12);
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = lw || 1.5;
    g.strokeStyle = stroke;
    g.stroke();
    g.restore();
  }

  function drawTalents() {
    if (!fateSave.offers) rollOffers();
    pageFrame('天 赋');
    // 金币与关卡
    const fe = JQ.fateEnemy(fateSave.tier);
    panel(30, 80, 660, 56, 'rgba(255,230,170,0.08)', 'rgba(255,220,150,0.35)');
    // 铜钱图标（和局内的包子区分开）
    g.save();
    if (JQ.uiDraw(g, 'coin', 44, 90, 36, 36)) g.globalAlpha = 0;
    g.fillStyle = '#e8b830';
    g.strokeStyle = '#8a6010';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(62, 108, 14, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.fillStyle = '#2a1e10';
    g.fillRect(57, 103, 10, 10);
    g.restore();
    text(g, `${fateSave.coins}`, 84, 109, 24, '#ffd23f', { align: 'left', font: 'sans-serif' });
    text(g, `第 ${fateSave.tier} 关`, 300, 100, 22, '#f5ead0');
    text(g, `对手 ${fe.talents} 条天赋 · 敌方强度 ×${JQ.stageBoost(fateSave.tier).toFixed(2)}`, 300, 122, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    text(g, '赢：金币 + 解锁下一关 + 刷新商店', 560, 100, 13, '#9fe0a0', { font: 'sans-serif', bold: false });
    text(g, '输：12 金币，留在本关', 560, 120, 13, '#e0a090', { font: 'sans-serif', bold: false });

    // 商店：3 张随机天赋
    JQ.uiDraw(g, 'chest', C.W / 2 - 92, 146, 44, 36);
    text(g, '商 店', C.W / 2, 166, 24, '#ffd23f');
    text(g, '每赢一局刷新一次', C.W / 2, 190, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    const offers = (fateSave.offers || []).map((id) => JQ.TALENT_BY_ID[id]).filter(Boolean);
    if (!offers.length) text(g, '这一批已经买完了，赢下一局再来看看', C.W / 2, 300, 18, '#bfb39a', { bold: false });
    offers.forEach((t, i) => {
      const x = 24 + i * 228, y = 206, w = 216, h = 250;
      const can = fateSave.coins >= t.cost;
      const paper = JQ.ui9(g, 'card', x, y, w, h, 34, 26);
      if (!paper) panel(x, y, w, h, 'rgba(255,240,210,0.07)', 'rgba(230,194,122,0.6)', 2);
      catChip(t, x + 16, y + 16);
      text(g, t.name, x + w / 2, y + 66, 30, paper ? '#3a2008' : '#f5ead0');
      wrapLines(t.desc, 12).slice(0, 4).forEach((l, k) => text(g, l, x + w / 2, y + 108 + k * 22, 15, paper ? '#5a4630' : '#d8c8a0', { bold: false, font: 'sans-serif' }));
      button(x + 18, y + h - 62, w - 36, 48, can ? `${t.cost} 金币 买` : `差 ${t.cost - fateSave.coins} 金币`, () => buyTalent(t), { on: can, disabled: !can, size: 22 });
    });

    // 已装备
    text(g, `已装备 ${fateSave.equipped.length}/${JQ.MAX_TALENTS}`, C.W / 2, 494, 22, '#ffd23f');
    for (let i = 0; i < JQ.MAX_TALENTS; i++) {
      const x = 24 + i * 228, y = 512;
      const t = JQ.TALENT_BY_ID[fateSave.equipped[i]];
      if (!t) {
        g.save();
        if (!JQ.ui9(g, 'slot', x, y, 216, 70, 30, 18)) (g.setLineDash([6, 5]), panel(x, y, 216, 70, 'rgba(255,255,255,0.03)', 'rgba(255,240,200,0.3)'));
        g.restore();
        text(g, '空位', x + 108, y + 36, 18, '#8a806c', { bold: false });
        continue;
      }
      buttons.push({ x, y, w: 216, h: 70, fn: () => toggleEquip(t) });
      panel(x, y, 216, 70, 'rgba(240,170,40,0.22)', '#ffc020', 2.5);
      catChip(t, x + 10, y + 10);
      text(g, t.name, x + 116, y + 26, 22, '#ffd23f');
      text(g, '点击卸下', x + 116, y + 52, 12, '#d8c8a0', { font: 'sans-serif', bold: false });
    }

    // 已拥有
    const owned = fateSave.owned.map((id) => JQ.TALENT_BY_ID[id]).filter(Boolean);
    text(g, `已拥有 ${owned.length}/${JQ.TALENTS.length} · 点击装备`, C.W / 2, 620, 20, '#f5ead0');
    if (!owned.length) text(g, '还没有天赋，赢一局拿金币来商店买吧', C.W / 2, 670, 16, '#8a806c', { bold: false });
    owned.forEach((t, i) => {
      const x = 24 + (i % 3) * 228, y = 640 + Math.floor(i / 3) * 74;
      if (y > 1110) return;
      const on = fateSave.equipped.includes(t.id);
      buttons.push({ x, y, w: 216, h: 66, fn: () => toggleEquip(t) });
      panel(x, y, 216, 66, on ? 'rgba(240,170,40,0.22)' : 'rgba(255,240,210,0.06)', on ? '#ffc020' : 'rgba(255,240,200,0.3)', on ? 2.5 : 1.5);
      catChip(t, x + 8, y + 8);
      text(g, t.name, x + 60, y + 19, 18, on ? '#ffd23f' : '#f5ead0', { align: 'left' });
      text(g, t.desc.slice(0, 15), x + 10, y + 48, 12, '#bfb39a', { align: 'left', font: 'sans-serif', bold: false });
    });
    button(210, 1196, 300, 60, '返 回', () => (screen = 'menu'), { on: true, size: 28 });
  }

  function buyTalent(t) {
    if (fateSave.coins < t.cost) return sfx('bad');
    fateSave.coins -= t.cost;
    fateSave.owned.push(t.id);
    fateSave.offers = fateSave.offers.filter((id) => id !== t.id);
    if (fateSave.equipped.length < JQ.MAX_TALENTS) fateSave.equipped.push(t.id);
    sfx('merge');
    saveFate();
  }

  function toggleEquip(t) {
    if (fateSave.equipped.includes(t.id)) fateSave.equipped = fateSave.equipped.filter((x) => x !== t.id);
    else if (fateSave.equipped.length < JQ.MAX_TALENTS) fateSave.equipped.push(t.id);
    else return sfx('bad');
    sfx('place');
    saveFate();
  }

  // 结算：印章盖下 → 星星逐个亮 → 数字滚动；赢了有金光和花瓣，输了印章发灰带裂纹
  let overAt = 0, lastProg = null, lastMvp = null;
  function starShape(cx, cy, r, fill, stroke) {
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr2 = i % 2 ? r * 0.45 : r;
      g.lineTo(cx + Math.cos(a) * rr2, cy + Math.sin(a) * rr2);
    }
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = stroke;
    g.stroke();
  }
  function drawOver() {
    const k = (performance.now() - overAt) / 1000;
    const w = game.winner;
    const staged = game.modeKey === 'classic' || game.modeKey === 'fate';
    const win = game.R.waves ? true : w === 0;
    const rw = lastReward, pg = lastProg, mv = lastMvp;
    veil(Math.min(0.5, k * 1.5));
    const px = 50, py = 150, pw = 620, ph = 930;
    // 赢：背后金色光芒慢转 + 花瓣飘落
    if (win) {
      g.save();
      g.translate(C.W / 2, py + 20);
      g.rotate(k * 0.25);
      g.globalAlpha = Math.min(0.35, k * 0.6);
      g.fillStyle = '#ffd35a';
      for (let i = 0; i < 14; i++) {
        g.rotate((Math.PI * 2) / 14);
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(-38, -520);
        g.lineTo(38, -520);
        g.closePath();
        g.fill();
      }
      g.restore();
    }
    if (JQ.ui9(g, 'panel', px, py, pw, ph, 40, 30)) {
      g.fillStyle = 'rgba(16,10,5,0.45)';
      JQ.rr(g, px + 18, py + 18, pw - 36, ph - 36, 8);
      g.fill();
    } else panel(px, py, pw, ph, 'rgba(30,21,12,0.92)', '#c9a35a', 2.5);
    // 印章盖下
    const word = game.R.waves ? '守关' : w === 0 ? (staged ? '通关' : '突围') : w === 1 ? '败北' : '平局';
    const sk = Math.min(1, k / 0.35), sc = 1 + 1.4 * (1 - JQ.ease(sk));
    g.save();
    g.translate(C.W / 2 + (sk < 1 ? 0 : Math.sin(k * 60) * Math.max(0, 0.5 - k) * 6), py + 12);
    g.rotate(-0.05);
    g.scale(sc, sc);
    g.globalAlpha = Math.min(1, k * 4);
    JQ.rr(g, -112, -48, 224, 96, 14);
    g.fillStyle = win ? '#a8281a' : w === 1 ? '#4a4a4a' : '#6a5a3a';
    g.fill();
    g.strokeStyle = '#f2d9a0';
    g.lineWidth = 3;
    g.stroke();
    text(g, word, 0, 2, 56, '#fff1d0');
    if (w === 1) {
      // 裂纹
      g.strokeStyle = 'rgba(20,20,20,0.7)';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(-60, -48);
      g.lineTo(-30, -10);
      g.lineTo(-44, 14);
      g.lineTo(-10, 48);
      g.moveTo(40, -48);
      g.lineTo(26, -6);
      g.lineTo(52, 30);
      g.stroke();
    }
    g.restore();
    // 关卡星级
    let y = py + 92;
    if (staged && win && pg) {
      for (let i = 0; i < 3; i++) {
        const t0 = 0.45 + i * 0.22, kk = Math.max(0, Math.min(1, (k - t0) / 0.25));
        const lit = i < pg.stars && kk > 0;
        g.save();
        g.translate(C.W / 2 + (i - 1) * 64, y + 22 - (i === 1 ? 8 : 0));
        const s2 = lit ? 1 + 0.6 * (1 - JQ.ease(kk)) : 1;
        g.scale(s2, s2);
        starShape(0, 0, 24, lit ? '#ffd23f' : 'rgba(80,70,60,0.8)', lit ? '#8a5a10' : 'rgba(160,140,110,0.5)');
        g.restore();
      }
      if (pg.newStars && k > 1.2) text(g, `新星 +${pg.newStars}`, C.W / 2 + 140, y + 24, 14, '#ffd23f', { font: 'sans-serif' });
      y += 54;
    } else y += 10;
    const sub = game.R.waves ? `守住 ${Math.max(0, game.wave - 1)} 波 · 最佳 ${rec(game.modeKey).best} 波` : staged ? `第 ${game.stage} 关` : game.mode.name;
    text(g, sub, C.W / 2, y + 12, 28, '#ffe9a0', { stroke: '#2a1a08', strokeW: 4 });
    const t = Math.floor(game.time);
    text(g, `${game.mode.name} · ${game.diff.name} · 用时 ${Math.floor(t / 60)}分${t % 60}秒`, C.W / 2, y + 42, 14, '#bfa878', { font: 'sans-serif', bold: false });
    y += 62;
    const roll = (v) => Math.round(v * Math.max(0, Math.min(1, (k - 0.3) / 0.8)));
    // MVP
    if (mv && (mv.hero || mv.unit)) {
      const card = (x, item, tag) => {
        if (!item) return;
        const name = item.key;
        const box = 64;
        if (!JQ.ui9(g, 'card', x, y, box, box, 34, 14)) panel(x, y, box, box, '#f3ead3', '#6a4a20', 2);
        text(g, name.length > 1 ? name : name, x + box / 2, y + box / 2 + 2, name.length > 1 ? 24 : 34, '#2a1a08');
        text(g, tag, x + box + 10, y + 12, 13, '#ffcf5a', { align: 'left' });
        text(g, `输出 ${roll(item.dmg).toLocaleString()}`, x + box + 10, y + 34, 15, '#fff3d6', { align: 'left', font: 'sans-serif' });
        text(g, `${Math.round((item.dmg / mv.total) * 100)}% · 击杀 ${item.kills}`, x + box + 10, y + 54, 12, '#bfa878', { align: 'left', font: 'sans-serif', bold: false });
      };
      card(px + 40, mv.hero, 'MVP 英雄');
      card(px + 330, mv.unit, '最强兵种');
      y += 84;
    }
    // 我/敌 对比条
    const A = game.sides[0].stats, B = game.sides[1].stats;
    [
      ['召唤', A.summoned, B.summoned],
      ['击杀', A.kills, B.kills],
      ['英雄出场', A.heroes, B.heroes],
      ['基地伤害', Math.round(A.baseDmg), Math.round(B.baseDmg)],
    ].forEach(([label, x0, y0], i) => {
      const ry = y + i * 42, tot = Math.max(1, x0 + y0), half = 210;
      const kk = Math.max(0, Math.min(1, (k - 0.3 - i * 0.08) / 0.6));
      text(g, label, C.W / 2, ry, 14, '#e8dcc0', { font: 'sans-serif', bold: false });
      g.save();
      JQ.rr(g, C.W / 2 - half, ry + 10, half * 2, 10, 5);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fill();
      g.fillStyle = '#3d8bff';
      const wa = ((half * x0) / tot) * kk, wb = ((half * y0) / tot) * kk;
      if (wa > 1) (JQ.rr(g, C.W / 2 - wa, ry + 10, wa, 10, 5), g.fill());
      g.fillStyle = '#e0503a';
      if (wb > 1) (JQ.rr(g, C.W / 2, ry + 10, wb, 10, 5), g.fill());
      g.restore();
      text(g, String(roll(x0)), C.W / 2 - half - 8, ry + 15, 17, '#cfe6ff', { align: 'right', font: 'sans-serif' });
      text(g, String(roll(y0)), C.W / 2 + half + 8, ry + 15, 17, '#ffd2c8', { align: 'left', font: 'sans-serif' });
    });
    y += 4 * 42 + 6;
    // 奖励：主公经验、将魂、宝箱、金币
    if (pg) {
      g.save();
      g.fillStyle = 'rgba(255,230,170,0.08)';
      JQ.rr(g, px + 36, y, pw - 72, 132, 10);
      g.fill();
      g.restore();
      const xpK = Math.max(0, Math.min(1, (k - 0.8) / 0.8));
      text(g, `主公 Lv${prog.lv}`, px + 52, y + 20, 17, '#ffe9a0', { align: 'left' });
      g.save();
      JQ.rr(g, px + 160, y + 14, 300, 10, 5);
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.fill();
      JQ.rr(g, px + 160, y + 14, Math.max(6, 300 * (prog.xp / lvNeed(prog.lv)) * xpK), 10, 5);
      g.fillStyle = '#e6b04a';
      g.fill();
      g.restore();
      text(g, `+${pg.xp} 经验` + (pg.lvUps ? `  升级！` : ''), px + 474, y + 20, 14, pg.lvUps ? '#ffd23f' : '#d8c8a0', { align: 'left', font: 'sans-serif' });
      const sl = pg.souls.slice(0, 3).map((x) => `${x.name} +${x.add}` + (x.to > x.from ? `（${x.to}★）` : ''));
      text(g, sl.length ? '将魂  ' + sl.join('   ') : '将魂  本局没有英雄出场', px + 52, y + 54, 14, '#f0e4c8', { align: 'left', font: 'sans-serif', bold: false });
      const up = pg.souls.find((x) => x.to > x.from);
      const extra = [];
      if (up && k > 1.4) extra.push(`★ ${up.name} 升到 ${up.to} 星：攻击/血量 +${up.to * 2}%`);
      if (pg.chest) extra.push(`星级宝箱 ×${pg.chest}：万能将魂 +${30 * pg.chest}`);
      if (pg.lvUps) extra.push(`升级奖励：万能将魂 +${20 * pg.lvUps}`);
      if (rw && rw.coins) extra.push(`金币 +${rw.coins}${rw.shop ? ' · 商店已刷新' : ''}`);
      extra.slice(0, 2).forEach((l, i) => text(g, l, px + 52, y + 84 + i * 26, 14, '#ffd23f', { align: 'left', font: 'sans-serif' }));
      y += 146;
    }
    if (!win && w === 1 && k > 1) text(g, tipOnLose(), C.W / 2, y + 2, 14, '#f0c0a0', { font: 'sans-serif', bold: false });
    y += 20;
    const canNext = rw && rw.win && !rw.max && staged;
    button(110, y, 500, 84, canNext ? `下一关 · 第 ${rw.next} 关` : staged ? `重试第 ${game.stage} 关` : '再来一局', () => {
      if (canNext) setStage(rw.next);
      newGame();
    }, { on: true, size: canNext ? 32 : 34 });
    const sec = [];
    if (staged) sec.push(['选 关', () => openStages()]);
    if (game.modeKey === 'fate') sec.push(['天赋商店', () => (screen = 'talents')]);
    sec.push(['返回主页', () => (screen = 'menu')]);
    const sw = (500 - (sec.length - 1) * 14) / sec.length;
    sec.forEach(([label, fn], i) => button(110 + i * (sw + 14), y + 98, sw, 60, label, fn, { size: 22 }));
    // 花瓣
    if (win && k < 6) {
      g.save();
      for (let i = 0; i < 36; i++) {
        const sx = ((i * 197) % 760) - 20, sp = 60 + (i % 5) * 25;
        const yy = -JQ.VIEW.top + ((k * sp + i * 83) % (C.H + JQ.VIEW.top + JQ.VIEW.bot));
        g.globalAlpha = Math.min(1, (6 - k) / 1.5) * 0.85;
        g.fillStyle = i % 3 ? '#ffb7c8' : '#ffd23f';
        g.beginPath();
        g.ellipse(sx + Math.sin(k * 2 + i) * 20, yy, 6, 3.5, k * 2 + i, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }
  // 输了给一句有用的提示
  function tipOnLose() {
    const s = game.sides[0];
    const formed = new Set(s.board.links.map((l) => l.hero));
    for (const b of JQ.packBonds(s.pack)) {
      const n = b.heroes.filter((h) => formed.has(h)).length;
      if (n && n < b.tiers[0].n) return `差一点就能凑成「${b.name}」：${b.heroes.filter((h) => !formed.has(h)).join('、')}`;
    }
    if (s.stats.heroes < 2) return '试试多凑几位英雄，两个字左右相邻就能合成';
    return '小兵到 5 级每次召 4 个，是个关键门槛';
  }

  // ---------- 主循环 ----------
  let last = performance.now(), acc = 0;
  // 自适应画质：连续 1.5 秒低于约 50 帧就降一档内部分辨率，最低到 1.05 倍；新一局恢复。
  let fpsAcc = 0, fpsN = 0, lastQ = 0;
  function frame(now) {
    // rAF 的时间戳偶尔会早于脚本启动时记的 last，夹到 0 以上，避免 game.time 倒退
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    g.setTransform(scale * dpr, 0, 0, scale * dpr, padX * scale * dpr, padY * scale * dpr);
    if (padX > 0) (g.fillStyle = '#1d1810'), g.fillRect(-padX, -padY, C.W + 2 * padX, C.H + 2 * padY); // 电脑横屏：两侧底色
    buttons = [];
    if (screen === 'menu') drawMenu(dt);
    else if (screen === 'stages') drawStages();
    else if (screen === 'custom') drawCustom();
    else if (screen === 'units') drawUnits();
    else if (screen === 'testlab') drawTestLab();
    else if (screen === 'testplay') {
      if (testLab.game) {
        testLab.acc += dt * 2;
        let guard = 0;
        while (testLab.acc >= STEP && guard++ < 30) {
          testLab.game.step(STEP);
          testLab.acc -= STEP;
        }
        JQ.render(testLab.game, testView);
        drawTestTop();
        if (testLab.game.over || !testAlive(0).length || !testAlive(1).length || testLab.game.time >= 30) finishTest();
      }
    }
    else if (screen === 'testover') {
      if (testLab.game) JQ.render(testLab.game, testView);
      drawTestOver();
    }
    else if (screen === 'talents') {
      if (menuGame) JQ.render(menuGame, menuView);
      drawTalents();
    }
    else if (screen === 'help' && helpBack === 'menu') {
      if (menuGame) JQ.render(menuGame, menuView);
      helpPage ? drawRoster() : drawHelp();
    }
    else {
      if (screen === 'play' && !game.over) {
        acc += dt * view.speed;
        while (acc >= STEP) {
          if (!game.R.waves && (aiT -= STEP) <= 0) (JQ.aiThink(game, 1), (aiT = game.diff.think));
          if (AUTO && (autoT -= STEP) <= 0) (JQ.aiThink(game, 0), (autoT = JQ.DIFF.human.think));
          game.step(STEP);
          acc -= STEP;
        }
        if (view.infoT > 0 && (view.infoT -= dt) <= 0) view.info = '';
        view.bunPop = Math.max(0, view.bunPop - dt);
        // 选中的场上卡被别处改动（卖掉/被合并）就取消选中
        if (view.selectedCell && !view.selectedCell.card) view.selectedCell = null;
      }
      const nowMs = performance.now();
      view.anims = view.anims.filter((a) => nowMs - a.t0 < 400);
      JQ.render(game, view);
      if (screen === 'paused') drawPause();
      else if (screen === 'over') drawOver();
      else if (screen === 'help') helpPage ? drawRoster() : drawHelp();
      if (!AUTO && screen === 'play' && !game.over) {
        fpsAcc += dt;
        fpsN++;
        if (fpsN >= 90) {
          const avg = (fpsAcc / fpsN) * 1000;
          if (avg > 20 && qScale > 0.62 && now - lastQ > 4000) {
            // 第一次掉帧先关掉所有发光（shadowBlur 在手机上最贵），还不够再降分辨率
            if (!noGlow) setNoGlow();
            else qScale = Math.max(0.62, qScale * 0.85), resize();
            lastQ = now;
          }
          fpsAcc = 0;
          fpsN = 0;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 调试：?screen=custom/stages/testlab/paused 直接打开对应界面（截图用）
  const urlScreen = (location.search.match(/[?&]screen=(\w+)/) || [])[1];
  if (urlScreen === 'custom') openCustom();
  else if (urlScreen === 'stages') openStages();
  else if (urlScreen === 'testlab') openTestLab();
  else if (urlScreen === 'paused') newGame(), (screen = 'paused');
  if (AUTO) {
    newGame();
    // 调试：?t=秒 直接快进，方便无头截图
    const ff = +(location.search.match(/[?&]t=(\d+)/) || [])[1] || 0;
    for (let k = 0; k < ff * 60 && !game.over; k++) {
      if (!game.R.waves && (aiT -= STEP) <= 0) (JQ.aiThink(game, 1), (aiT = game.diff.think));
      if ((autoT -= STEP) <= 0) (JQ.aiThink(game, 0), (autoT = JQ.DIFF.human.think));
      game.step(STEP);
    }
  }

  // 调试/测试用
  window.__jq = { get game() { return game; }, get screen() { return screen; }, newGame, view, setScreen: (s) => (screen = s), setDblSell: (v) => (dblSell = v), openCustom, openStages, openTestLab, startTest, get test() { return { blue: testLab.blue.slice(), red: testLab.red.slice(), game: testLab.game, result: testLab.result }; }, get stage() { return stageOf(); }, get best() { return bestOf(); }, get custom() { return { heroes: customHeroes.slice(), units: customUnits.slice() }; } };
})();
