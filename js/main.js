// 入口：画布缩放、主循环、输入、菜单/暂停/结算界面、音效。
(function () {
  const JQ = window.JQ;
  const { C, UNITS, HEROES, BUILDINGS, ITEMS, UI, FONT, text } = JQ;

  const canvas = document.getElementById('game');
  const g = canvas.getContext('2d', { alpha: false });
  let scale = 1, dpr = 1, qScale = 1;

  function resize() {
    const native = window.devicePixelRatio || 1;
    scale = Math.min(window.innerWidth / C.W, window.innerHeight / C.H);
    // 手机上 DPR 3 全量绘制太吃填充率：内部渲染封顶 1.75 倍，且总像素控制在约 100 万以内。
    // 画面仍按 CSS 铺满，肉眼几乎看不出差别，帧率能明显稳下来。
    const area = C.W * scale * C.H * scale;
    let q = Math.min(native, 1.75) * qScale;
    const budget = 1000000;
    if (area * q * q > budget) q = Math.sqrt(budget / area);
    dpr = Math.max(1, q);
    const w = Math.round(C.W * scale), h = Math.round(C.H * scale);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    if (JQ.setRenderScale) JQ.setRenderScale(scale * dpr);
  }
  window.addEventListener('resize', resize);
  resize();
  window.__jqPerf = () => ({ qScale, scale, dpr, w: canvas.width, h: canvas.height });

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
    game = new JQ.Game({ seed: seedV, difficulty, mode, pack, talents, enemyBoost, stage, skillToast, aiProfile: JQ.aiProfile(difficulty, player) });
    window.__jqGame = game; // 调试/性能测试用
    actions = 0;
    lastReward = null;
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
        setTimeout(() => (screen = 'over'), 900);
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
    return { x: ((e.clientX - r.left) / r.width) * C.W, y: ((e.clientY - r.top) / r.height) * C.H };
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
      for (const b of buttons) if (inRect(p, b)) return b.fn();
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
  function button(x, y, w, h, label, fn, opts) {
    opts = opts || {};
    buttons.push({ x, y, w, h, fn: opts.disabled ? () => {} : fn });
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
    g.fillRect(0, 0, C.W, C.H);
  }

  function title(s, y, size, color) {
    color = color || '#1a1a1a';
    const dark = color === '#1a1a1a' || color === '#333' || color === '#7a1010';
    text(g, s, C.W / 2, y, size, color, { stroke: dark ? '#f5ead0' : '#1a1008', strokeW: size / 8 });
  }

  let menuGame = null;
  const menuView = { g, speed: 1, selected: -1, anims: [] };
  function drawMenu(dt) {
    // 背景放一局 AI 对打当演示
    if (!menuGame || menuGame.over) {
      menuGame = new JQ.Game({ seed: (Math.random() * 1e9) | 0 });
      menuGame.aiT = [0, 0];
      for (let k = 0; k < 60 * 60; k++) {
        for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= STEP) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
        menuGame.step(STEP);
      }
    }
    for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= dt) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
    menuGame.step(dt);
    JQ.render(menuGame, menuView);
    veil(0.74);
    title('禁区突围', 120, 100, '#1a1a1a');
    text(g, '招兵 · 拼格 · 合字成将', C.W / 2, 200, 22, '#f5ead0');
    text(g, '卡 包', C.W / 2, 240, 22, '#ffd23f');
    const MENU_PACKS = ['sanguo', 'xiyou', 'tang', 'custom', 'xuanhuan', 'mofa', 'song'];
    MENU_PACKS.forEach((k, i) => {
      const pk = JQ.PACKS[k];
      if (!pk) return;
      const x = 28 + (i % 4) * 168, y = 260 + Math.floor(i / 4) * 62;
      if (k === 'custom') {
        const ready = JQ.customReady();
        button(x, y, 160, 52, ready ? `自定义（${pk.heroes.length}将）` : '自定义 · 去配置', () => {
          if (!ready) return openCustom();
          pack = k;
          helpPack = k;
          localStorage.setItem('jq_pack', k);
        }, { on: pack === k, size: ready ? 20 : 16 });
        return;
      }
      if (!pk.open) {
        g.save();
        g.globalAlpha = 0.45;
        JQ.rr(g, x, y, 160, 52, 14);
        g.fillStyle = '#3a3226';
        g.fill();
        g.restore();
        text(g, pk.name + ' · 未解锁', x + 80, y + 27, 18, '#9a8f7a');
        return;
      }
      button(x, y, 160, 52, `${pk.name}（${pk.heroes.length}将）`, () => {
        pack = k;
        helpPack = k;
        localStorage.setItem('jq_pack', k);
      }, { on: pack === k, size: 20 });
    });
    text(g, '模 式', C.W / 2, 404, 22, '#ffd23f');
    Object.entries(JQ.MODES).forEach(([k, m], i) => {
      button(40 + i * 220, 422, 200, 54, m.name, () => {
        mode = k;
        localStorage.setItem('jq_mode', k);
      }, { on: mode === k, size: 28 });
    });
    const M = JQ.MODES[mode];
    wrap(M.desc, 32).forEach((l, i) => text(g, l, C.W / 2, 498 + i * 22, 16, '#f5ead0', { bold: false }));
    const r = rec(mode);
    if (mode === 'classic' || mode === 'fate') {
      const st = stageOf();
      // 关卡号做成主视觉，不再是一行小字
      panel(170, 524, 380, 68, 'rgba(255,220,150,0.08)', 'rgba(255,210,120,0.45)', 1.5);
      text(g, `第 ${st} 关`, C.W / 2 - 28, 552, 30, '#ffe9a0', { stroke: '#2a1a08', strokeW: 5 });
      text(g, `/ ${C.MAX_STAGE}`, C.W / 2 + 108, 556, 15, '#bfa878', { font: 'sans-serif', bold: false });
      g.save();
      JQ.rr(g, 210, 576, 300, 9, 5);
      g.fillStyle = 'rgba(255,220,160,0.18)';
      g.fill();
      JQ.rr(g, 210, 576, Math.max(4, (300 * st) / C.MAX_STAGE), 9, 5);
      g.fillStyle = '#ffcf5a';
      g.fill();
      g.restore();
    }
    if (mode === 'fate') {
      const eq = fateSave.equipped.map((id) => JQ.TALENT_BY_ID[id].name).join('、') || '未装备';
      text(g, `最佳 ${fateSave.best} 关 · 战绩 ${r.win} 胜 ${r.lose} 负 · 金币 ${fateSave.coins}`, C.W / 2, 600, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
      button(160, 612, 400, 36, `天赋：${eq}`, () => (screen = 'talents'), { size: 17 });
    } else if (mode === 'classic') {
      text(g, `战绩 ${r.win} 胜 ${r.lose} 负 · 已解锁 ${classicBest} 关`, C.W / 2, 600, 13, '#d8c8a0', { font: 'sans-serif', bold: false });
    } else text(g, `最佳：守到第 ${r.best || 0} 波`, C.W / 2, 558, 15, '#d8c8a0', { font: 'sans-serif', bold: false });
    text(g, '难 度', C.W / 2, 664, 22, '#ffd23f');
    JQ.DIFF_ORDER.forEach((k, i) =>
      button(110 + i * 240, 682, 220, 48, JQ.DIFF[k].name, () => {
        difficulty = k;
        localStorage.setItem('jq_diff', k);
      }, { on: difficulty === k, size: 26 })
    );
    const D = JQ.aiProfile(difficulty, player);
    if (mode === 'classic' || mode === 'fate') {
      const st = stageOf();
      text(g, `第 ${st} 关 · 敌方强度 ×${JQ.stageBoost(st).toFixed(2)}`, 30, 740, 14, '#d8c8a0', { align: 'left', font: 'sans-serif', bold: false });
      button(520, 732, 160, 36, '选 关', () => openStages(), { size: 17 });
    } else text(g, `敌军数量 ×${D.wave} · 不限时`, C.W / 2, 740, 15, '#d8c8a0', { font: 'sans-serif', bold: false });
    button(210, 786, 300, 82, '开 战', newGame, { on: true, size: 44 });
    button(30, 874, 210, 60, '玩法说明', () => ((helpBack = 'menu'), (helpPage = 0), (screen = 'help')), { size: 24 });
    button(255, 874, 210, 60, '英雄图鉴', () => ((helpBack = 'menu'), (helpPage = 1), (screen = 'help')), { size: 24 });
    button(480, 874, 210, 60, '小兵图鉴', () => (screen = 'units'), { size: 24 });
    button(60, 940, 290, 60, muted ? '音效：关' : '音效：开', () => {
      muted = !muted;
      localStorage.setItem('jq_mute', muted ? '1' : '0');
    }, { size: 26 });
    button(370, 940, 290, 60, dblSell ? '双击卖卡：开' : '双击卖卡：关', () => {
      dblSell = !dblSell;
      localStorage.setItem('jq_dblsell', dblSell ? '1' : '0');
    }, { size: 26 });
    button(60, 1006, 290, 60, skillToast ? '技能弹字：开' : '技能弹字：关', () => {
      skillToast = !skillToast;
      localStorage.setItem('jq_skilltoast', skillToast ? '1' : '0');
      if (game) game.skillToast = skillToast;
    }, { size: 26 });
    button(370, 1006, 290, 60, '自定义卡包', () => openCustom(), { size: 26 });
  }

  // ---------- 选关 ----------
  let stagePage = 0;
  function openStages() {
    stagePage = Math.floor((stageOf() - 1) / 100);
    screen = 'stages';
  }
  function drawStages() {
    if (menuGame) JQ.render(menuGame, menuView);
    veil(0.93);
    title(`第 ${stageOf()} 关 · 选关`, 80, 46, '#f5ead0');
    text(g, `${JQ.MODES[mode].name} · 已解锁 ${bestOf()} / ${C.MAX_STAGE} 关`, C.W / 2, 135, 17, '#d8c8a0', { font: 'sans-serif', bold: false });
    const start = stagePage * 100 + 1;
    for (let i = 0; i < 100; i++) {
      const n = start + i;
      if (n > C.MAX_STAGE) break;
      const col = i % 10, row = Math.floor(i / 10);
      button(40 + col * 64, 170 + row * 50, 58, 44, String(n), () => {
        setStage(n);
        screen = 'menu';
      }, { flat: true, on: n === stageOf(), disabled: n > bestOf(), size: n > 99 ? 15 : 17 });
    }
    button(150, 700, 180, 48, '上一页', () => (stagePage = Math.max(0, stagePage - 1)), { flat: true, disabled: stagePage === 0, size: 18 });
    button(390, 700, 180, 48, '下一页', () => (stagePage = Math.min(1, stagePage + 1)), { flat: true, disabled: stagePage === 1, size: 18 });
    text(g, `第 ${stagePage + 1} / 2 页`, C.W / 2, 770, 15, '#bfb39a', { font: 'sans-serif', bold: false });
    button(260, 820, 200, 54, '返 回', () => (screen = 'menu'), { size: 22 });
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
    veil(0.93);
    title('自定义卡包', 55, 42, '#f5ead0');
    text(g, `英雄 ${customHeroes.length}/16 · 小兵 ${customUnits.length}/6-12`, C.W / 2, 96, 16, customValid() ? '#9fe0a0' : '#ffb090', { font: 'sans-serif', bold: false });
    text(g, '英雄（点选 / 再点取消）', 18, 122, 14, '#ffd23f', { align: 'left', font: 'sans-serif', bold: false });
    const heroNames = Object.keys(HEROES);
    heroNames.forEach((name, i) => {
      const col = i % 7, row = Math.floor(i / 7);
      button(14 + col * 98, 136 + row * 56, 92, 50, name, () => toggleCustomHero(name), { flat: true, on: customHeroes.includes(name), size: 19 });
    });
    text(g, '小兵（点选 / 再点取消）', 18, 552, 14, '#ffd23f', { align: 'left', font: 'sans-serif', bold: false });
    JQ.ALL_UNITS.forEach((key, i) => {
      const col = i % 8, row = Math.floor(i / 8);
      button(18 + col * 86, 566 + row * 44, 78, 38, key, () => toggleCustomUnit(key), { flat: true, on: customUnits.includes(key), size: 19 });
    });
    text(g, customMsg || (customValid() ? '可以保存并开战' : '需要 16 位英雄、6~12 种小兵'), C.W / 2, 670, 15, customMsg ? '#ff8060' : '#d8c8a0', { font: 'sans-serif', bold: false });
    button(90, 700, 180, 52, '保 存', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和至少 6 种小兵');
      applyCustom();
      customMsg = '已保存';
    }, { size: 20 });
    button(300, 700, 240, 52, '保存并开战', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和至少 6 种小兵');
      applyCustom();
      pack = 'custom';
      helpPack = 'custom';
      localStorage.setItem('jq_pack', 'custom');
      screen = 'menu';
      newGame();
    }, { size: 20, on: true });
    button(260, 770, 200, 50, '返 回', () => (screen = 'menu'), { size: 20 });
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
    veil(0.9);
    panel(14, 104, 692, 440, 'rgba(18,12,6,0.58)', 'rgba(255,220,150,0.2)', 1.5);
    title('玩法说明', 70, 52, '#f5ead0');
    const lines = [
      '· 点「招兵」：备战席剩下的卡自动卖掉（几级卖几包），再整排刷新 5 张。',
      '· 主角「帅」沿格子来回走，踩到兵卡就召唤小兵（卡有冷却）。',
      '· 卡可在场上、备战席之间随意拖：移动/互换/替换/收回，拖到包子卖掉。',
      '· 同名同级卡叠在一起升级；小兵无等级上限，英雄最高 5 级。',
      '· 文字卡：两个字左右挨着就合成英雄（谁左谁右都行，字可共用）。',
      `· 英雄只算一个等级，把它的任一字拖上去就 +1 级；${C.ULT_LEVEL} 级（天命 2 级）解锁大招。`,
      '· 某个字能合成的英雄全部满级后，招兵不再刷出这个字。',
      '· 格子块拖到棋盘边上扩建；也能往战场里拼「前哨」：兵从前线出发，但哨所会被打。',
      '· 建筑：马 加移速｜鼓 减冷却｜旗 加攻击｜粮 产包子',
      '· 道具：药 基地回血｜金 +25 包子｜令 冷却清空（点一下就用）',
      '· 兵种：刀盾弓枪剑刺 + 各包骑/弩/陌/妖/魔/猴/僧/龙/鬼/甲',
      '· 模式：经典/天命都是 200 关闯关，越往后敌人越强；无限守波次。',
      '· 自定义卡包：自己选 16 位英雄（含夏夏）和 6~12 种小兵。',
    ];
    lines.forEach((l, i) => text(g, l, 26, 120 + i * 32, 17, '#f5ead0', { align: 'left', bold: false }));
    text(g, '每个卡包 16 位英雄，各有被动特长、技能和大招', C.W / 2, 580, 19, '#ffd23f');
    text(g, '（点任意处看英雄图鉴）', C.W / 2, 1250, 18, '#bfb39a');
  }

  // 小兵图鉴：16 种兵，标注出场卡包和基础数值
  function drawUnits() {
    if (menuGame) JQ.render(menuGame, menuView);
    veil(0.93);
    title('小兵图鉴', 50, 46, '#f5ead0');
    text(g, '同字跨卡包属性完全一致 · 共 16 种', C.W / 2, 96, 16, '#d8c8a0', { font: 'sans-serif', bold: false });
    const role = (d) => (d.assassin ? '刺客' : d.ranged ? '远程' : d.rangedReduce ? '坦克' : '近战');
    JQ.ALL_UNITS.forEach((k, i) => {
      const d = UNITS[k];
      const x = 18 + (i % 2) * 350, y = 126 + Math.floor(i / 2) * 128, w = 334, h = 120;
      panel(x, y, w, h, 'rgba(255,240,210,0.06)', 'rgba(255,220,150,0.3)', 1.5);
      const col = d.assassin ? '#b48cff' : d.ranged ? '#3f8cff' : d.rangedReduce ? '#8a9ab0' : '#d08030';
      g.save();
      g.fillStyle = col;
      JQ.rr(g, x + 1, y + 8, 4, h - 16, 2);
      g.fill();
      g.restore();
      text(g, k, x + 38, y + 50, 38, '#f5ead0', { stroke: '#1a1008', strokeW: 4 });
      text(g, `${k} · ${role(d)}`, x + 72, y + 26, 20, '#ffd23f', { align: 'left' });
      text(g, d.desc, x + 72, y + 50, 12, '#bfb39a', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `血 ${d.hp} · 攻 ${d.atk} · 射程 ${d.range}`, x + 72, y + 76, 12, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `攻速 ${d.rate} · 移速 ${d.speed} · 冷却 ${d.cd}s`, x + 72, y + 96, 12, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      const packs = Object.keys(JQ.PACK_UNITS).filter((p) => p !== 'custom' && JQ.PACK_UNITS[p].includes(k)).map((p) => JQ.PACKS[p].name);
      text(g, `出场：${packs.join('/') || '仅自定义'} · 自定义可选`, x + 72, y + 112, 10, '#9fe0a0', { align: 'left', bold: false, font: 'sans-serif' });
    });
    button(210, 1170, 300, 58, '返 回', () => (screen = 'menu'), { size: 24 });
  }

  // 英雄图鉴：按卡包分页
  function drawRoster() {
    veil(0.92);
    title('英雄图鉴', 50, 44, '#f5ead0');
    const tabs = JQ.OPEN_PACKS;
    const tabW = 150, gap = 12, x0 = (C.W - (tabs.length * tabW + (tabs.length - 1) * gap)) / 2;
    tabs.forEach((k, i) => button(x0 + i * (tabW + gap), 82, tabW, 44, JQ.PACKS[k].name, () => (helpPack = k), { on: helpPack === k, size: 22 }));
    const roster = (JQ.PACKS[helpPack] && JQ.PACKS[helpPack].heroes) || [];
    if (!roster.length) text(g, '这个卡包还没有配置英雄（自定义卡包点「自定义卡包」选 16 位）', C.W / 2, 300, 20, '#bfb39a', { bold: false });
    roster.forEach((name, i) => {
      const h = HEROES[name];
      if (!h) return;
      const x = i % 2 ? 368 : 18, y = 150 + Math.floor(i / 2) * 136;
      g.save();
      g.fillStyle = JQ.alphaHex(h.aura, 0.14);
      JQ.rr(g, x - 6, y - 6, 340, 128, 10);
      g.fill();
      g.fillStyle = 'rgba(255,240,210,0.05)';
      JQ.rr(g, x - 6, y - 6, 340, 128, 10);
      g.fill();
      g.fillStyle = h.aura;
      JQ.rr(g, x - 6, y + 2, 4, 108, 2);
      g.fill();
      g.restore();
      text(g, h.name, x, y + 14, 27, h.aura, { align: 'left', stroke: '#000', strokeW: 4 });
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.35)';
      JQ.rr(g, x + 58, y + 3, 64, 19, 8);
      g.fill();
      g.restore();
      text(g, h.role, x + 90, y + 13, 12, '#e8dcc0', { font: 'sans-serif', bold: false });
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
      fit(`被动【${h.passive.name}】${h.passive.desc}`, y + 42, 13, '#9fe0a0', { align: 'left', bold: false, font: 'sans-serif' });
      fit(`技能【${h.skill.name}】${h.skill.desc}`, y + 64, 13, '#e8dcc0', { align: 'left', bold: false, font: 'sans-serif' });
      text(g, `大招【${h.ult.name}】`, x, y + 88, 14, '#ffd23f', { align: 'left' });
      fit(h.ult.desc, y + 109, 12, '#bfb39a', { align: 'left', bold: false, font: 'sans-serif' });
    });
    text(g, '（点空白处返回）', C.W / 2, 1262, 16, '#bfb39a');
  }

  function drawPause() {
    veil(0.6);
    title('暂停', 300, 80, '#f5ead0');
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
    button(210, 904, 300, 72, '返回主页', () => (screen = 'menu'));
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
    const col = JQ.TALENT_CATS[t.cat] || '#888';
    g.save();
    JQ.rr(g, x, y, 44, 20, 9);
    g.fillStyle = col;
    g.fill();
    text(g, t.cat, x + 22, y + 11, 12, '#fff', { font: 'sans-serif' });
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
    veil(0.93);
    title('天 赋', 46, 46, '#f5ead0');
    // 金币与关卡
    const fe = JQ.fateEnemy(fateSave.tier);
    panel(30, 80, 660, 56, 'rgba(255,230,170,0.08)', 'rgba(255,220,150,0.35)');
    // 铜钱图标（和局内的包子区分开）
    g.save();
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
    text(g, '商 店', C.W / 2, 166, 24, '#ffd23f');
    text(g, '每赢一局刷新一次', C.W / 2, 190, 13, '#bfb39a', { font: 'sans-serif', bold: false });
    const offers = (fateSave.offers || []).map((id) => JQ.TALENT_BY_ID[id]).filter(Boolean);
    if (!offers.length) text(g, '这一批已经买完了，赢下一局再来看看', C.W / 2, 300, 18, '#bfb39a', { bold: false });
    offers.forEach((t, i) => {
      const x = 24 + i * 228, y = 206, w = 216, h = 250;
      const can = fateSave.coins >= t.cost;
      panel(x, y, w, h, 'rgba(255,240,210,0.07)', JQ.TALENT_CATS[t.cat], 2.5);
      catChip(t, x + 12, y + 12);
      text(g, t.name, x + w / 2, y + 66, 30, '#f5ead0');
      wrapLines(t.desc, 12).slice(0, 4).forEach((l, k) => text(g, l, x + w / 2, y + 108 + k * 22, 15, '#d8c8a0', { bold: false, font: 'sans-serif' }));
      button(x + 18, y + h - 62, w - 36, 48, `${t.cost} 金币 买`, () => buyTalent(t), { on: can, size: 22 });
      if (!can) {
        g.save();
        g.globalAlpha = 0.5;
        JQ.rr(g, x + 18, y + h - 62, w - 36, 48, 14);
        g.fillStyle = '#000';
        g.fill();
        g.restore();
      }
    });

    // 已装备
    text(g, `已装备 ${fateSave.equipped.length}/${JQ.MAX_TALENTS}`, C.W / 2, 494, 22, '#ffd23f');
    for (let i = 0; i < JQ.MAX_TALENTS; i++) {
      const x = 24 + i * 228, y = 512;
      const t = JQ.TALENT_BY_ID[fateSave.equipped[i]];
      if (!t) {
        g.save();
        g.setLineDash([6, 5]);
        panel(x, y, 216, 70, 'rgba(255,255,255,0.03)', 'rgba(255,240,200,0.3)');
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

  function drawOver() {
    veil(0.62);
    const w = game.winner;
    const staged = game.modeKey === 'classic' || game.modeKey === 'fate';
    const rw = lastReward;
    if (game.R.waves) title(`守住 ${Math.max(0, game.wave - 1)} 波`, 330, 90, '#b8860b');
    else if (staged) title(`第 ${game.stage} 关 · ${w === 0 ? '通关' : w === 1 ? '失败' : '平局'}`, 330, 60, w === 0 ? '#b8860b' : w === 1 ? '#7a1010' : '#333');
    else title(w === 0 ? '突围成功' : w === 1 ? '兵败禁区' : '平分秋色', 330, 96, w === 0 ? '#b8860b' : w === 1 ? '#7a1010' : '#333');
    const a = game.sides[0].stats, b = game.sides[1].stats;
    const t = Math.floor(game.time);
    [
      `${game.mode.name} · ${game.diff.name}   用时 ${Math.floor(t / 60)}分${t % 60}秒` + (game.R.waves ? `   最佳 ${rec(game.modeKey).best} 波` : ''),
      `召唤  我 ${a.summoned}  ·  敌 ${b.summoned}`,
      `击杀  我 ${a.kills}  ·  敌 ${b.kills}`,
      `英雄出场  我 ${a.heroes}  ·  敌 ${b.heroes}`,
      `大招  我 ${a.ults}  ·  敌 ${b.ults}`,
      `基地伤害  我 ${Math.round(a.baseDmg)}  ·  敌 ${Math.round(b.baseDmg)}`,
    ].forEach((l, i) => text(g, l, C.W / 2, 408 + i * 40, 24, '#f5ead0'));
    if (rw && staged) {
      let line;
      if (rw.win) line = rw.max ? `第 ${rw.stage} 关通关！已抵达第 ${C.MAX_STAGE} 关` : `第 ${rw.stage} 关通过 · 解锁第 ${rw.next} 关`;
      else line = `第 ${rw.stage} 关失败 · 再试一次`;
      text(g, line, C.W / 2, 666, 20, rw.win ? '#ffd23f' : '#f0c0a0', { stroke: '#3a2a10', strokeW: 4 });
      if (rw.coins) text(g, `金币 +${rw.coins}${rw.shop ? ' · 商店已刷新' : ''}`, C.W / 2, 694, 15, '#ffd23f', { font: 'sans-serif', bold: false });
    } else if (rw && rw.coins) text(g, `获得 ${rw.coins} 金币${rw.shop ? ' · 商店已刷新' : ''}`, C.W / 2, 672, 22, '#ffd23f', { stroke: '#3a2a10', strokeW: 4 });
    const canNext = rw && rw.win && !rw.max && staged;
    button(210, 712, 300, 78, canNext ? `下一关（第 ${rw.next} 关）` : staged ? `重试第 ${game.stage} 关` : '再来一局', () => {
      if (canNext) setStage(rw.next);
      newGame();
    }, { on: true, size: canNext ? 30 : 34 });
    button(210, 802, 300, 66, staged ? '选 关' : game.modeKey === 'fate' ? '天赋商店' : '返回主页', () => {
      if (staged) openStages();
      else screen = game.modeKey === 'fate' ? 'talents' : 'menu';
    });
    if (game.modeKey === 'fate') button(210, 880, 300, 60, '天赋商店', () => (screen = 'talents'), { size: 26 });
    if (staged || game.modeKey === 'fate') button(210, 952, 300, 56, '返回主页', () => (screen = 'menu'), { size: 24 });
  }

  // ---------- 主循环 ----------
  let last = performance.now(), acc = 0;
  // 自适应画质：连续 1.5 秒低于约 50 帧就降一档内部分辨率，最低到 1.05 倍；新一局恢复。
  let fpsAcc = 0, fpsN = 0, lastQ = 0;
  function frame(now) {
    // rAF 的时间戳偶尔会早于脚本启动时记的 last，夹到 0 以上，避免 game.time 倒退
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    g.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
    buttons = [];
    if (screen === 'menu') drawMenu(dt);
    else if (screen === 'stages') drawStages();
    else if (screen === 'custom') drawCustom();
    else if (screen === 'units') drawUnits();
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
            qScale = Math.max(0.62, qScale * 0.85);
            lastQ = now;
            resize();
          }
          fpsAcc = 0;
          fpsN = 0;
        }
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

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
  window.__jq = { get game() { return game; }, get screen() { return screen; }, newGame, view, setScreen: (s) => (screen = s), setDblSell: (v) => (dblSell = v), openCustom, openStages, get stage() { return stageOf(); }, get best() { return bestOf(); }, get custom() { return { heroes: customHeroes.slice(), units: customUnits.slice() }; } };
})();
