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
    JQ.lowFx = true; // 技能素材特效也一起关掉
    Object.defineProperty(g, 'shadowBlur', { configurable: true, get: () => 0, set: () => {} });
  }
  if (/[?&]lowfx=1/.test(location.search)) setNoGlow(); // 调试：直接开低画质
  window.__jqPerf = () => ({ qScale, scale, dpr, noGlow, w: canvas.width, h: canvas.height });

  // ---------- 音效（WebAudio 合成，无外部文件） ----------
  // 全部声音走一条总线：master → 压缩器 → 扬声器，避免大混战时爆音
  let lastKillSfx = 0, lastHeart = 0;
  let actx = null, muted = localStorage.getItem('jq_mute') === '1', lastHit = 0, bus = null;
  let musicOn = localStorage.getItem('jq_music') !== '0';
  function audio() {
    if (actx) return actx;
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    bus = actx.createGain();
    bus.gain.value = 0.9;
    bus.connect(comp).connect(actx.destination);
    return actx;
  }
  function tone(f, d, type, vol, slide, delay) {
    const now = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), v = actx.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(f, now);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, now + d);
    v.gain.setValueAtTime(vol || 0.15, now);
    v.gain.exponentialRampToValueAtTime(0.001, now + d);
    o.connect(v).connect(bus);
    o.start(now);
    o.stop(now + d);
  }
  let noiseBuf = null;
  function noise(d, vol, delay, hp) {
    if (!noiseBuf) {
      const n = actx.sampleRate * 1;
      noiseBuf = actx.createBuffer(1, n, actx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
    }
    const now = actx.currentTime + (delay || 0);
    const src = actx.createBufferSource(), v = actx.createGain(), fl = actx.createBiquadFilter();
    src.buffer = noiseBuf;
    fl.type = hp ? 'highpass' : 'lowpass';
    fl.frequency.value = hp || 1800;
    v.gain.setValueAtTime(vol, now);
    v.gain.exponentialRampToValueAtTime(0.001, now + d);
    src.connect(fl).connect(v).connect(bus);
    src.start(now, Math.random() * 0.5);
    src.stop(now + d);
  }
  // 拨弦（古筝/琵琶味）：三角波 + 二倍泛音，快起慢落，起音带一点拨片噪声
  function pluck(f, d, vol, delay, out) {
    const now = actx.currentTime + (delay || 0);
    const v = actx.createGain();
    v.gain.setValueAtTime(0.0001, now);
    v.gain.exponentialRampToValueAtTime(vol, now + 0.006);
    v.gain.exponentialRampToValueAtTime(0.001, now + d);
    v.connect(out || bus);
    for (const [mul, a, type] of [[1, 1, 'triangle'], [2, 0.35, 'sine'], [3, 0.12, 'sine']]) {
      const o = actx.createOscillator(), og = actx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f * mul * 1.006, now);
      o.frequency.exponentialRampToValueAtTime(f * mul, now + 0.05);
      og.gain.value = a;
      o.connect(og).connect(v);
      o.start(now);
      o.stop(now + d);
    }
  }
  // 鼓：正弦下滑 + 一点噪声
  function drum(f, d, vol, delay, out) {
    const now = actx.currentTime + (delay || 0);
    const o = actx.createOscillator(), v = actx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 2.2, now);
    o.frequency.exponentialRampToValueAtTime(f, now + 0.08);
    v.gain.setValueAtTime(vol, now);
    v.gain.exponentialRampToValueAtTime(0.001, now + d);
    o.connect(v).connect(out || bus);
    o.start(now);
    o.stop(now + d);
  }
  // 锣：几组不成整数倍的泛音，长尾
  function gong(f, d, vol, delay) {
    for (const [m, a] of [[1, 1], [1.48, 0.5], [2.11, 0.35], [2.73, 0.2]]) tone(f * m, d * (1.1 - m * 0.15), 'sine', vol * a, f * m * 0.985, delay);
    noise(0.12, vol * 0.6, delay, 2500);
  }
  function sfx(kind) {
    if (muted) return;
    try {
      audio();
    } catch (e) {
      return;
    }
    if (kind === 'recruit') [0, 0.045, 0.09, 0.135].forEach((d, i) => pluck(587 * [1, 1.125, 1.25, 1.5][i], 0.25, 0.09, d));
    else if (kind === 'place') (drum(150, 0.16, 0.22), noise(0.05, 0.08, 0, 1200));
    else if (kind === 'merge') (pluck(880, 0.35, 0.12), pluck(1320, 0.45, 0.1, 0.07), tone(1760, 0.3, 'sine', 0.04, null, 0.12));
    else if (kind === 'hero') (gong(196, 1.4, 0.16), pluck(392, 0.6, 0.12, 0.05), pluck(587, 0.7, 0.1, 0.16), drum(70, 0.4, 0.3));
    else if (kind === 'ult') (drum(55, 0.6, 0.38), noise(0.45, 0.22), gong(130, 1.2, 0.12, 0.05), tone(660, 0.5, 'triangle', 0.06, 1320, 0.1));
    else if (kind === 'hit') (drum(90, 0.22, 0.25), noise(0.08, 0.1));
    else if (kind === 'skill') (pluck(740, 0.25, 0.06), noise(0.12, 0.05, 0, 3000));
    else if (kind === 'crit') (noise(0.06, 0.12, 0, 2500), tone(1400, 0.08, 'square', 0.03, 700));
    else if (kind === 'coin') pluck(1568 + Math.random() * 200, 0.15, 0.05);
    else if (kind === 'kill') (drum(120, 0.1, 0.08), noise(0.05, 0.05, 0, 1500));
    else if (kind === 'bond') [523, 659, 784, 1046, 1318].forEach((f, i) => pluck(f, 0.6, 0.08, i * 0.07));
    else if (kind === 'breakthrough') (gong(196, 2.4, 0.2), drum(48, 0.9, 0.42), [392, 523, 659, 784, 1046].forEach((f, i) => pluck(f, 0.9, 0.11, 0.15 + i * 0.11)), tone(1318, 0.8, 'triangle', 0.05, null, 1.1));
    else if (kind === 'event') (gong(147, 1.6, 0.14), drum(60, 0.5, 0.3, 0.02));
    else if (kind === 'heart') (drum(55, 0.18, 0.3), drum(50, 0.18, 0.22, 0.2));
    else if (kind === 'win') [523, 659, 784, 1046].forEach((f, i) => (pluck(f, 0.7, 0.13, i * 0.13), i === 3 && gong(262, 1.8, 0.12, 0.4)));
    else if (kind === 'lose') [392, 330, 294, 220].forEach((f, i) => pluck(f, 0.8, 0.11, i * 0.22));
    else if (kind === 'bad') tone(160, 0.12, 'square', 0.05);
    else if (kind === 'sell') (pluck(1175, 0.15, 0.07), pluck(1568, 0.2, 0.06, 0.06));
    else if (kind === 'tap') pluck(1046, 0.08, 0.04);
    else if (kind === 'press') (pluck(784, 0.05, 0.05), drum(220, 0.04, 0.05));
  }
  // 手机震动（安卓有效，iOS 忽略）
  const buzz = (ms) => {
    try {
      if (!muted && navigator.vibrate) navigator.vibrate(ms);
    } catch (e) {}
  };

  // ---------- 背景音乐：五声音阶程序生成（不需要音频文件） ----------
  // 宫调式 D 宫：D E #F A B；菜单舒缓只拨弦，战斗加鼓点，决战时刻提速
  const BGM = { on: false, next: 0, step: 0, timer: null, gain: null, mood: 'menu', last: 4 };
  const PENTA = [0, 2, 4, 7, 9];
  const noteHz = (deg, oct) => 146.83 * Math.pow(2, (PENTA[((deg % 5) + 5) % 5] + 12 * (oct + Math.floor(deg / 5))) / 12);
  function bgmTick() {
    if (!actx || !BGM.on) return;
    const battle = BGM.mood !== 'menu', urgent = BGM.mood === 'urgent';
    const spb = 60 / (urgent ? 112 : battle ? 92 : 72) / 2; // 八分音符
    while (BGM.next < actx.currentTime + 0.25) {
      const d = BGM.next - actx.currentTime, st = BGM.step % 16;
      if (st === 0 || st === 8) pluck(noteHz(st === 0 ? 0 : 3, -1), 1.6, 0.11, d, BGM.gain);
      if (battle && (st % 4 === 0)) drum(st % 8 === 0 ? 62 : 80, 0.25, st % 8 === 0 ? 0.22 : 0.12, d, BGM.gain);
      if (urgent && st % 2 === 1) drum(110, 0.08, 0.06, d, BGM.gain);
      if (Math.random() < (battle ? 0.55 : 0.4)) {
        BGM.last = Math.max(0, Math.min(9, BGM.last + [-2, -1, -1, 0, 1, 1, 2][Math.floor(Math.random() * 7)]));
        pluck(noteHz(BGM.last, 0), battle ? 0.5 : 0.9, battle ? 0.07 : 0.06, d, BGM.gain);
      }
      BGM.next += spb;
      BGM.step++;
    }
  }
  function setMusic(mood) {
    BGM.mood = mood || BGM.mood;
    const want = musicOn && !muted && !document.hidden;
    if (!actx || want === BGM.on) return;
    BGM.on = want;
    if (want) {
      if (!BGM.gain) (BGM.gain = actx.createGain()), BGM.gain.connect(bus);
      BGM.gain.gain.setTargetAtTime(0.55, actx.currentTime, 0.5);
      BGM.next = actx.currentTime + 0.1;
      BGM.timer = setInterval(bgmTick, 100);
    } else {
      clearInterval(BGM.timer);
      if (BGM.gain) BGM.gain.gain.setTargetAtTime(0, actx.currentTime, 0.2);
    }
  }
  document.addEventListener('visibilitychange', () => setMusic());
  // 浏览器要求用户点一下才能出声：第一次触摸时建好音频并开音乐
  window.addEventListener('pointerdown', () => {
    try {
      audio();
      if (actx.state === 'suspended') actx.resume();
      setMusic();
    } catch (e) {}
  }, { passive: true });

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
  // 画面样式：默认原版（汉字单位 + 宣纸地面），可在设置里换成象棋子 / 水墨战场
  const savedBg = localStorage.getItem('jq_bgstyle');
  const style = { unit: localStorage.getItem('jq_unitstyle') === 'piece' ? 'piece' : 'glyph', bg: JQ.BG_LIST.some((b) => b.id === savedBg) ? savedBg : 'paper' };
  JQ.setStyle(style);
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

  // ---------- 养成：主公等级 + 本命将 + 关卡星级 ----------
  // 只有一位“本命将”能用铜钱升级（每级攻击/血量 +3%），其他英雄保持原样；等级上限以后靠“突破”提高。
  // 加成只给玩家方，敌人强度仍只由关卡决定。
  const PROG_KEY = 'jq_prog';
  const ACT_DEF = () => ({ stone: 0, seal: {}, cleared: {}, plays: 0, wins: 0, kills: 0, ults: {}, heroKills: {}, tasks: {} });
  const PROG_DEF = () => ({ v: 3, xp: 0, lv: 1, coins: 0, main: null, heroLv: {}, brk: {}, stars: { classic: {}, fate: {} }, chests: 0, act: ACT_DEF() });
  let prog = PROG_DEF();
  try {
    const old = JSON.parse(localStorage.getItem(PROG_KEY) || 'null') || {};
    prog = Object.assign(PROG_DEF(), old);
    // 旧版“将魂”存档：将魂和万能将魂折成铜钱，将魂最多的英雄当本命将
    if (!old.v || old.v < 2) {
      const souls = old.souls || {};
      let best = null;
      for (const [k, v] of Object.entries(souls)) if (HEROES[k] && (!best || v > souls[best])) best = k;
      prog.coins += Object.values(souls).reduce((a, b) => a + b, 0) * 2 + (old.wild || 0) * 3;
      prog.main = best;
      delete prog.souls;
      delete prog.wild;
      prog.v = 2;
    }
  } catch (e) {}
  if (prog.main && !HEROES[prog.main]) prog.main = null;
  // v3：突破活动存档。旧存档只补字段，不重置任何进度。
  prog.v = 3;
  prog.brk = prog.brk && typeof prog.brk === 'object' ? prog.brk : {};
  for (const h of JQ.BREAKTHROUGH.heroes) prog.brk[h] = Math.max(0, Math.min(3, Math.floor(prog.brk[h] || 0)));
  const oldAct = prog.act && typeof prog.act === 'object' ? prog.act : {};
  prog.act = Object.assign(ACT_DEF(), oldAct);
  for (const k of ['seal', 'cleared', 'ults', 'heroKills', 'tasks']) prog.act[k] = Object.assign({}, oldAct[k] || {});
  // 求贤（抽皮肤）：新档送 3 枚求贤令；owned 已有皮肤，equip { 英雄: 皮肤 id }
  const oldQx = prog.qx && typeof prog.qx === 'object' ? prog.qx : { tokens: 3 };
  prog.qx = Object.assign({ tokens: 0, yayun: 0, pity: 0, draws: 0, freeDay: '', owned: {}, equip: {} }, oldQx);
  prog.qx.owned = Object.assign({}, oldQx.owned || {});
  prog.qx.equip = Object.assign({}, oldQx.equip || {});
  for (const [h, id] of Object.entries(prog.qx.equip)) if (!prog.qx.owned[id] || !JQ.SKIN_BY_ID[id] || JQ.SKIN_BY_ID[id].hero !== h) delete prog.qx.equip[h];
  // 立绘：穿戴的皮肤图 + 突破过的英雄解锁原版立绘
  const syncSkinArt = () => {
    JQ.setSkinArt(Object.fromEntries(Object.entries(prog.qx.equip).map(([h, id]) => [h, JQ.SKIN_BY_ID[id].art])));
    JQ.setPortraitUnlock(Object.keys(prog.brk || {}).filter((h) => prog.brk[h] > 0));
  };
  syncSkinArt();
  const saveProg = () => localStorage.setItem(PROG_KEY, JSON.stringify(prog));
  saveProg();
  const lvNeed = (lv) => 100 + 40 * (lv - 1);
  const heroLvOf = (name) => prog.heroLv[name] || 1;
  const brkOf = (name) => Math.max(0, Math.min(3, Math.floor(prog.brk[name] || 0)));
  const passiveTitle = (d) => (d && d.passiveExtra ? `${d.passive.name} + ${d.passiveExtra.name}` : d.passive.name);
  const heroCap = (name) => 20 + 10 * brkOf(name); // 突破一次上限 +10
  const upCost = (lv) => 30 + 15 * (lv - 1);
  const mainBonus = (lv) => 0.03 * (lv - 1);
  const mainInfo = () => (prog.main ? { name: prog.main, lv: heroLvOf(prog.main) } : null);
  function setMain(name) {
    prog.main = name;
    saveProg();
  }
  function upgradeMain() {
    const name = prog.main;
    if (!name) return false;
    const lv = heroLvOf(name);
    if (lv >= heroCap(name) || prog.coins < upCost(lv)) return false;
    prog.coins -= upCost(lv);
    prog.heroLv[name] = lv + 1;
    saveProg();
    return true;
  }
  function totalStars() {
    let n = 0;
    for (const md of Object.values(prog.stars)) for (const v of Object.values(md)) n += v;
    return n;
  }
  // 一局结束：主公经验、铜钱、关卡星级、星级宝箱
  function grantProgress(g, win) {
    const s = g.sides[0];
    const stage = g.stage || 1;
    const out = { xp: 0, lvUps: 0, coins: 0, stars: 0, newStars: 0, chest: 0, tokens: 0, mainUsed: !!(prog.main && s.stats.heroLv[prog.main]) };
    out.xp = win ? 60 + 2 * Math.min(100, stage) : 25 + Math.min(60, stage);
    out.coins = win ? 40 + Math.min(110, stage) : 15 + Math.min(30, Math.floor(stage / 2));
    if (g.R.waves) (out.xp = 20 + 8 * Math.max(0, g.wave - 1)), (out.coins = 10 + 5 * Math.max(0, g.wave - 1));
    if (out.mainUsed) out.coins += 10; // 本命将上场多给一点
    prog.xp += out.xp;
    while (prog.xp >= lvNeed(prog.lv)) {
      prog.xp -= lvNeed(prog.lv);
      prog.lv++;
      out.lvUps++;
      out.coins += 100;
      out.tokens += 2; // 主公升级送 2 枚求贤令
    }
    if (win) out.tokens += 1; // 每赢一局 1 枚求贤令
    if (win && (g.modeKey === 'classic' || g.modeKey === 'fate')) {
      const f = s.hp / s.maxHp;
      out.stars = f >= 0.7 ? 3 : f >= 0.4 ? 2 : 1;
      const md = (prog.stars[g.modeKey] = prog.stars[g.modeKey] || {});
      out.newStars = Math.max(0, out.stars - (md[stage] || 0));
      md[stage] = Math.max(md[stage] || 0, out.stars);
    }
    // 每攒 10 颗关卡星开一个宝箱：150 铜钱
    while (Math.floor(totalStars() / 10) > prog.chests) (prog.chests++, (out.coins += 150), out.chest++, out.tokens++);
    prog.coins += out.coins;
    prog.qx.tokens += out.tokens;
    saveProg();
    return out;
  }

  // ---------- 突破活动：活动关卡 / 活动任务 / 材料 / 三突 ----------
  const ACT = JQ.BREAKTHROUGH;
  let activityStage = null; // 非空 = 下一局从这关活动关卡进入（再战也沿用）
  let actTab = 'brk', actHero = ACT.heroes[0], brkAnim = null, brkSel = 0, actHelp = false;
  const BRK_ART = {
    吕布: ['skill_lvbu_1', 'skill_lvbu_2', 'skill_lvbu_3'],
    悟空: ['skill_wukong_1', 'skill_wukong_2', 'skill_wukong_3'],
    岳飞: ['skill_yuefei_1', 'skill_yuefei_2', 'skill_yuefei_3'],
  };
  const actStageOf = (id) => ACT.stageById[id] || null;
  function openActivity(tab) {
    JQ.preloadOrnaments();
    JQ.preloadUiArt();
    if (tab) actTab = tab;
    if (!ACT.byHero[actHero]) actHero = ACT.heroes[0];
    brkSel = Math.min(2, brkOf(actHero));
    screen = 'activity';
  }
  function addActReward(stone, seal, hero) {
    prog.act.stone += stone || 0;
    if (hero && seal) prog.act.seal[hero] = (prog.act.seal[hero] || 0) + seal;
  }
  // 一局活动结束：累计任务进度；赢了发首通/重复奖励
  function grantActivity(g, win) {
    const st = actStageOf(g.activity);
    const a = prog.act, s = g.sides[0];
    a.plays = (a.plays || 0) + 1;
    if (win) a.wins = (a.wins || 0) + 1;
    a.kills = (a.kills || 0) + (s.stats.kills || 0);
    for (const h of ACT.heroes) {
      a.ults[h] = (a.ults[h] || 0) + (s.stats.heroUlts[h] || 0);
      a.heroKills[h] = (a.heroKills[h] || 0) + (s.stats.heroKills[h] || 0);
    }
    let stone = 0, seal = 0, first = false;
    if (win && st) {
      first = !a.cleared[st.id];
      const r = first ? st.first : st.repeat;
      stone = r.stone;
      seal = r.seal;
      a.cleared[st.id] = true;
      addActReward(stone, seal, st.hero);
    }
    saveProg();
    return st ? { id: st.id, name: st.name, hero: st.hero, win, stone, seal, first } : null;
  }
  function actTaskProgress(t) {
    const a = prog.act;
    const v = t.kind === 'ult' ? a.ults[t.hero] || 0 : a.heroKills[t.hero] || 0;
    return Math.min(t.need, v);
  }
  function claimActTask(id) {
    const t = ACT.tasks.find((x) => x.id === id);
    if (!t || prog.act.tasks[id] || actTaskProgress(t) < t.need) return false;
    prog.act.tasks[id] = true;
    addActReward(t.reward.stone, t.reward.seal, t.hero);
    saveProg();
    return true;
  }
  // 返回 { ok, reason }；材料不足时 reason=stone/seal，满突=max
  function brkUp(name) {
    if (!ACT.byHero[name]) return { ok: false, reason: 'hero' };
    const from = brkOf(name);
    if (from >= 3) return { ok: false, reason: 'max' };
    const cost = JQ.brkCost(name, from);
    if ((prog.act.stone || 0) < cost.stone) return { ok: false, reason: 'stone', cost };
    if ((prog.act.seal[name] || 0) < cost.seal) return { ok: false, reason: 'seal', cost };
    prog.act.stone -= cost.stone;
    prog.act.seal[name] = (prog.act.seal[name] || 0) - cost.seal;
    prog.brk[name] = from + 1;
    saveProg();
    syncSkinArt();
    return { ok: true, from, to: from + 1, cost, title: ACT.byHero[name].levels[from].title };
  }
  function doBreakthrough(name) {
    if (brkAnim) return false;
    const r = brkUp(name);
    if (!r.ok) return sfx('bad'), false;
    brkAnim = { name, from: r.from, to: r.to, t0: performance.now(), title: r.title };
    sfx('breakthrough');
    buzz(60);
    return true;
  }
  function startActivityStage(id) {
    const st = actStageOf(id);
    if (!st) return;
    activityStage = id;
    newGame();
  }
  const brkTotal = () => ACT.heroes.reduce((n, h) => n + brkOf(h), 0);

  // ---------- 求贤：抽皮肤 ----------
  // 皮肤只换外观和一个技能/大招，不加强度；求贤令只靠玩游戏拿（每赢一局 1 枚、主公升级 2 枚、星级宝箱 1 枚、每天免费 1 次）
  const QX = JQ.QIUXIAN;
  const qx = () => prog.qx;
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  };
  const qxFree = () => qx().freeDay !== today();
  const skinOwned = (id) => !!qx().owned[id];
  const skinCount = () => JQ.SKINS.filter((s) => skinOwned(s.id)).length;
  let qxTab = 'draw', qxAnim = null, qxSel = 0, qxRates = false, qxSkinPick = null, qxSwapAt = 0;
  // 一抽：先按保底，再按概率表；出皮肤时优先给还没有的，全有了折成雅韵
  function qxRollOne() {
    const q = qx();
    q.pity++;
    q.draws++;
    let kind = null;
    if (q.pity >= QX.pity) kind = 'skin';
    else {
      let r = Math.random() * 100;
      for (const row of QX.table) if ((r -= row.p) < 0) { kind = row.kind; break; }
      kind = kind || 'coins';
    }
    if (kind === 'skin') {
      q.pity = 0;
      const pool = JQ.SKINS.filter((s) => !skinOwned(s.id));
      if (!pool.length) {
        q.yayun += QX.dupYayun;
        return { kind: 'skin', dup: true, n: QX.dupYayun, id: JQ.SKINS[Math.floor(Math.random() * JQ.SKINS.length)].id };
      }
      const s = pool[Math.floor(Math.random() * pool.length)];
      q.owned[s.id] = true;
      if (!q.equip[s.hero]) q.equip[s.hero] = s.id; // 第一款皮肤自动穿上
      return { kind: 'skin', id: s.id };
    }
    const row = QX.table.find((x) => x.kind === kind);
    const n = row.n[0] + Math.floor(Math.random() * (row.n[1] - row.n[0] + 1));
    if (kind === 'yayun') q.yayun += n;
    else if (kind === 'coins') prog.coins += n;
    else if (kind === 'stone') prog.act.stone += n;
    else if (kind === 'seal') {
      const h = ACT.heroes[Math.floor(Math.random() * ACT.heroes.length)];
      prog.act.seal[h] = (prog.act.seal[h] || 0) + n;
      return { kind, n, hero: h };
    }
    return { kind, n };
  }
  // n=1 单抽（今天还没免费就先用免费），n=10 十连
  function qxDraw(n) {
    if (qxAnim) return false;
    const q = qx(), free = n === 1 && qxFree();
    if (!free && q.tokens < n) return sfx('bad'), qxSay(`求贤令不够：还差 ${n - q.tokens} 枚，每赢一局送 1 枚`), false;
    if (free) q.freeDay = today();
    else q.tokens -= n;
    const res = [];
    for (let i = 0; i < n; i++) res.push(qxRollOne());
    saveProg();
    syncSkinArt();
    const best = res.some((r) => r.kind === 'skin' && !r.dup);
    for (const r of res) if (r.kind === 'skin') JQ.preloadArt(JQ.SKIN_BY_ID[r.id].art);
    qxAnim = { res, t0: performance.now(), best, shown: -1, skinShow: res.findIndex((r) => r.kind === 'skin' && !r.dup) };
    playQxVideo();
    sfx('recruit');
    buzz(30);
    return true;
  }
  function qxExchange(id) {
    const q = qx();
    if (skinOwned(id) || q.yayun < QX.exchange) return sfx('bad'), false;
    q.yayun -= QX.exchange;
    q.owned[id] = true;
    const s = JQ.SKIN_BY_ID[id];
    if (!q.equip[s.hero]) q.equip[s.hero] = id;
    saveProg();
    syncSkinArt();
    sfx('breakthrough');
    qxAnim = { res: [{ kind: 'skin', id }], t0: performance.now() - 1500, best: true, shown: -1, skinShow: 0 };
    return true;
  }
  function equipSkin(hero, id) {
    const q = qx();
    if (id && !skinOwned(id)) return sfx('bad');
    if (!id || q.equip[hero] === id) delete q.equip[hero];
    else q.equip[hero] = id;
    saveProg();
    syncSkinArt();
    sfx('tap');
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

  function newGame(opts) {
    opts = opts || {};
    const act = opts.activity ? actStageOf(opts.activity) : activityStage ? actStageOf(activityStage) : null;
    if (!act && pack === 'custom' && !JQ.customReady()) return openCustom();
    const seedV = (Math.random() * 1e9) | 0;
    // 新一局恢复默认分辨率，给上一局掉过画质的设备一次重新评估的机会
    if (qScale !== 1) (qScale = 1), resize();
    fpsAcc = 0;
    fpsN = 0;
    const gameMode = act ? 'breakthrough' : mode;
    const usePack = act ? act.pack : pack;
    const talents = !act && mode === 'fate' ? [fateSave.equipped.slice(), enemyTalents(JQ.rng(seedV ^ 77))] : [[], []];
    const staged = !act && (mode === 'classic' || mode === 'fate');
    const stage = staged ? stageOf() : 1;
    const enemyBoost = act ? act.boost : staged ? JQ.stageBoost(stage) : 1;
    game = new JQ.Game({
      seed: seedV, difficulty, mode: gameMode, pack: usePack, enemyPack: act ? act.enemyPack : undefined,
      talents, enemyBoost, stage, skillToast, aiProfile: JQ.aiProfile(difficulty, player),
      mainHero: prog.main ? { name: prog.main, lv: heroLvOf(prog.main) } : null,
      breakthrough: prog.brk, skins: Object.assign({}, prog.qx.equip), activity: act ? act.id : null,
      startHeroName: act ? act.hero : null, startHeroLv: act ? 3 : 1,
    });
    window.__jqGame = game; // 调试/性能测试用
    // 经典第 1 关第一次玩：新手引导（?tut=1 强制重看）
    tut = null;
    if (!act && mode === 'classic' && stage === 1 && !AUTO && (localStorage.getItem(TUT_KEY) !== '1' || /[?&]tut=1/.test(location.search))) startTutorial();
    actions = 0;
    lastReward = null;
    lastProg = null;
    lastMvp = null;
    game.on((ev, d) => {
      // 记玩家操作数，用来估手速
      if (d && d.side === 0 && (ev === 'place' || ev === 'recruit' || ev === 'sell' || ev === 'item')) actions++;
      if (ev === 'outpostLost' && d.side === 0) say('前哨失守！卡已退回备战席', 2);
      if (ev === 'recruit' && d.side === 0) (sfx('recruit'), (view.shopAnim = performance.now()));
      tutEvent(ev, d);
      if (ev === 'place' && d.side === 0) {
        sfx(d.how === 'merge' ? 'merge' : 'place');
        buzz(d.how === 'merge' ? 18 : 8);
        if (d.r != null && d.c != null) {
          const rc = JQ.cellRect(0, d.r, d.c);
          view.anims.push({ kind: 'drop', x: rc.cx, y: rc.cy, t0: performance.now(), life: 420, merge: d.how === 'merge', label: d.how === 'merge' && d.card ? `Lv${d.card.level}` : '' });
        }
      }
      if (ev === 'kill' && d.side === 0) {
        if (performance.now() - lastKillSfx > 90) (lastKillSfx = performance.now()), sfx('kill');
        if (view.anims.length < 40) view.anims.push({ kind: 'bunfly', x: d.x, y: d.y, t0: performance.now() + Math.random() * 80, life: 650, coin: true });
      }
      if (ev === 'crit' && d.side === 0) sfx('crit');
      if (ev === 'bond' && d.side === 0) (sfx('bond'), buzz(25));
      if (ev === 'heroDie' && d.side === 1) buzz(20);
      if (ev === 'sell' && d.side === 0) (sfx('sell'), (view.bunPop = 0.3));
      if (ev === 'hero') (sfx('hero'), d.side === 0 && ((view.punchAt = performance.now()), buzz(30)));
      if (ev === 'ult') sfx('ult');
      if (ev === 'skill' && d.side === 0) sfx('skill');
      if (ev === 'baseHit' && d.side === 0 && performance.now() - lastHit > 250) (lastHit = performance.now()), sfx('hit'), buzz(12);
      if (ev === 'event') (say(`天命【${d.name}】${d.desc}`, 4), sfx('event'));
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
          if (game.modeKey === 'breakthrough') {
            lastReward = { win, mode: 'activity', act: grantActivity(game, win) };
          } else {
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
        if (window.Arcade) setTimeout(() => window.Arcade.sync('jinqu'), 800); // 关卡进度已存盘，同步到排行榜
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
          const h = JQ.heroAtBrk(l.hero, game && game.breakthrough ? game.breakthrough[l.hero] || 0 : 0);
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
  // 按钮手感：按住时压到 0.9（60ms 内压下），松手后回弹到 1.06 再收回
  function pressK(x, y) {
    if (!pressed || pressed.x !== x || pressed.y !== y) return 1;
    const t = performance.now() - pressed.t;
    if (pressed.held) return 1 - 0.1 * Math.min(1, t / 60);
    const k = t / 260;
    if (k >= 1) return 1;
    return 0.9 + 0.1 * k + 0.12 * Math.sin(Math.PI * Math.min(1, k * 1.3)) * (1 - k);
  }
  const isHeld = (x, y) => !!(pressed && pressed.held && pressed.x === x && pressed.y === y);
  let ripples = []; // 松手处的金色涟漪
  function drawRipples() {
    const now = performance.now();
    ripples = ripples.filter((r) => now - r.t < 320);
    for (const r of ripples) {
      const k = (now - r.t) / 320;
      g.save();
      g.globalAlpha = 0.7 * (1 - k);
      g.strokeStyle = '#ffe08a';
      g.lineWidth = 4 * (1 - k) + 1;
      g.beginPath();
      g.arc(r.x, r.y, 14 + 46 * k, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
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
        if (inRect(p, b)) return (pressed = { x: b.x, y: b.y, w: b.w, h: b.h, t: performance.now(), held: true, fn: b.fn }), sfx('press'), buzz(10);
      }
      if (screen === 'help') {
        // 第一页规则 → 第二页英雄图鉴 → 返回
        if (helpPage === 0) helpPage = 1;
        else (helpPage = 0), (screen = helpBack);
      }
      return;
    }
    if (tutTap(p)) return;
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
    // 菜单按钮：松手时还在按钮范围内才执行（手指滑出去就取消）
    if (pressed && pressed.held) {
      const p = toLogic(e);
      const hit = e.type === 'pointerup' && p.x >= pressed.x - 12 && p.x <= pressed.x + pressed.w + 12 && p.y >= pressed.y - 12 && p.y <= pressed.y + pressed.h + 12;
      pressed.held = false;
      pressed.t = performance.now();
      if (hit) (ripples.push({ x: p.x, y: p.y, t: performance.now() }), pressed.fn());
    }
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
  const BTN_INK = { btn_gold: '#3a2008', btn_paper: '#3a2a10', btn_wood: '#f0e0c0', btn_red: '#fff0d8', btn_stone: '#cfc6b4' };
  function button(x, y, w, h, label, fn, opts) {
    opts = opts || {};
    buttons.push({ x, y, w, h, fn: opts.disabled ? () => {} : fn });
    // 太窄的按钮（选关格子等）放不下素材两端的花纹，改画简洁的木底金边
    if (JQ.uiOk() && w < h * 1.3 + 24) {
      g.save();
      const pk = pressK(x, y);
      if (pk !== 1) (g.translate(x + w / 2, y + h / 2), g.scale(pk, pk), g.translate(-(x + w / 2), -(y + h / 2)));
      card(x, y, w, h, { on: opts.on, dim: opts.disabled, red: !opts.on && !opts.disabled && !opts.flat, r: 10 });
      text(g, label, x + w / 2, y + h / 2 + 1, Math.min(opts.size || 18, h * 0.5), opts.on ? '#3a2008' : opts.disabled ? '#7a6e5c' : '#fff1d8', opts.on || opts.disabled ? undefined : { stroke: 'rgba(20,8,2,0.6)', strokeW: 3 });
      g.restore();
      return;
    }
    // 新按钮素材：主要操作朱红金云纹，次要操作檀木回纹；按住时压暗
    {
      const kit = opts.on || opts.red ? 'kit_red' : 'kit_wood';
      g.save();
      const pk = pressK(x, y);
      if (pk !== 1) (g.translate(x + w / 2, y + h / 2), g.scale(pk, pk), g.translate(-(x + w / 2), -(y + h / 2)));
      if (opts.disabled) g.globalAlpha = 0.55;
      if (isHeld(x, y)) g.filter = 'brightness(0.78)';
      const ok = JQ.kit3(g, kit, x, y, w, h);
      g.filter = 'none';
      if (ok) {
        const size = opts.size || 30;
        text(g, label, x + w / 2, y + h / 2 + 1, Math.min(size, h * 0.5), opts.disabled ? '#c8b8a0' : kit === 'kit_red' ? '#fff0c8' : '#f5e6c8', { stroke: kit === 'kit_red' ? '#5a0e04' : '#1a0c04', strokeW: 4 });
        g.restore();
        return;
      }
      g.restore();
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
  // back：传入时左上角画返回键（页面底部不再单独放「返回」按钮，空间留给内容）
  function pageFrame(titleStr, a, back) {
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
    if (back) backBtn(back);
  }
  const pageTop = () => -Math.min(JQ.VIEW.top, 60);
  const pageBottom = () => C.H + JQ.VIEW.bot - 34; // 内容可用到的最低处（面板内沿）
  // 左上角返回键：朱漆圆钮 + 金色箭头（右上角留给微信胶囊）
  function backBtn(fn) {
    const s = 56, x = 26, y = pageTop() + 14, k = pressK(x, y);
    buttons.push({ x: x - 8, y: y - 8, w: s + 16, h: s + 16, fn });
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.scale(k, k);
    if (!JQ.kitImg(g, 'kit_round_red', -s * 0.62, -s * 0.62, s * 1.24, s * 1.24)) {
      g.beginPath();
      g.arc(0, 0, s / 2, 0, Math.PI * 2);
      const grd = g.createLinearGradient(0, -s / 2, 0, s / 2);
      grd.addColorStop(0, '#a8402a');
      grd.addColorStop(1, '#5a160a');
      g.fillStyle = grd;
      g.fill();
      g.lineWidth = 2.5;
      g.strokeStyle = '#f0c878';
      g.stroke();
    }
    g.strokeStyle = '#ffe9a0';
    g.lineWidth = 5;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(5, -12);
    g.lineTo(-7, 0);
    g.lineTo(5, 12);
    g.stroke();
    g.restore();
  }
  // 卡片容器：漆木渐变 + 顶部高光 + 底部投影；on=选中（金边+亮底），dim=不可用
  function card(x, y, w, h, opts) {
    opts = opts || {};
    const r = opts.r == null ? 12 : opts.r;
    g.save();
    JQ.rr(g, x, y + 3, w, h, r);
    g.fillStyle = 'rgba(0,0,0,0.38)';
    g.fill();
    JQ.rr(g, x, y, w, h, r);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    if (opts.on) (grd.addColorStop(0, '#ffe7a6'), grd.addColorStop(1, '#d99a3a'));
    else if (opts.red) (grd.addColorStop(0, '#9a3420'), grd.addColorStop(1, '#5a1608'));
    else if (opts.dim) (grd.addColorStop(0, 'rgba(44,34,26,0.92)'), grd.addColorStop(1, 'rgba(28,22,17,0.92)'));
    else (grd.addColorStop(0, opts.light ? '#7a5634' : '#5e3f26'), grd.addColorStop(1, opts.light ? '#4a3018' : '#38240f'));
    g.fillStyle = grd;
    g.fill();
    g.lineWidth = opts.on ? 2.5 : 1.2;
    g.strokeStyle = opts.on ? '#fff0b8' : opts.dim ? 'rgba(120,100,80,0.45)' : 'rgba(230,190,120,0.55)';
    g.stroke();
    // 顶部内高光
    if (!opts.dim) {
      JQ.rr(g, x + 3, y + 2, w - 6, Math.min(h * 0.45, 26), Math.max(2, r - 3));
      g.fillStyle = opts.on ? 'rgba(255,255,240,0.35)' : 'rgba(255,230,180,0.08)';
      g.fill();
    }
    g.restore();
  }

  function title(s, y, size, color) {
    color = color || '#1a1a1a';
    const dark = color === '#1a1a1a' || color === '#333' || color === '#7a1010';
    text(g, s, C.W / 2, y, size, color, { stroke: dark ? '#f5ead0' : '#1a1008', strokeW: size / 8 });
  }

  let menuPop = (location.search.match(/[?&]pop=(\w+)/) || [])[1] || null; // menuPop：'settings' 设置弹窗 / 'packs' 卡包抽屉
  const MENU_PACKS = ['sanguo', 'xiyou', 'tang', 'song', 'custom', 'xuanhuan', 'mofa']; // 已开放的排前面，未解锁的收在最后
  const PACK_ART = {}; // 卡包封面图（AI 生图），没有的卡包画大字
  const PACK_FOCUS = { sanguo: 0.55, xiyou: 0.62, song: 0.55 }; // 竖图裁成横幅时取景的高度位置（0 顶 ~ 1 底），默认 0.4
  for (const k of ['sanguo', 'xiyou', 'tang', 'song', 'custom']) {
    const im = new Image();
    im.src = `img/pack_${k}.jpg?v=20261110f`;
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
    if (!ic && JQ.kitImg(g, 'kit_round_wood', -size * 0.6, -size * 0.6, size * 1.2, size * 1.2)) {
      text(g, label, 0, 1, size * 0.55, '#ffe9a0', { stroke: '#2a1a08', strokeW: 3 });
      return g.restore();
    }
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
  // 底栏图标：优先用生成图标；「本」也是图标，不再拿汉字当按钮
  function navItem(x, y, w, h, glyph, label, fn) {
    buttons.push({ x, y, w, h, fn });
    const k = pressK(x, y);
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(k, k);
    if (glyph === '本' && JQ.iconDraw(g, 'mainhero', -33, -h / 2 + 4, 66, 66)) {
      text(g, label, 0, h / 2 - 18, 16, '#e8dcc0', { font: 'sans-serif', bold: false });
      return g.restore();
    }
    if (NAV_ICON[glyph] && JQ.uiDraw(g, NAV_ICON[glyph], -31, -h / 2 + 6, 62, 62)) {
      text(g, label, 0, h / 2 - 18, 16, '#e8dcc0', { font: 'sans-serif', bold: false });
      return g.restore();
    }
    JQ.rr(g, -26, -h / 2 + 10, 52, 52, 12);
    g.fillStyle = '#8c2f1c';
    g.fill();
    g.strokeStyle = '#e6c27a';
    g.lineWidth = 2;
    g.stroke();
    if (glyph === '本') {
      // 生成图标未加载时的兜底：将盔 + 红缨，不写字
      g.fillStyle = '#ffd86a';
      g.beginPath();
      g.arc(0, -h / 2 + 36, 13, Math.PI, 0);
      g.fill();
      g.fillRect(-13, -h / 2 + 35, 26, 5);
      g.strokeStyle = '#ff6a4a';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(0, -h / 2 + 24);
      g.quadraticCurveTo(10, -h / 2 + 12, 4, -h / 2 + 10);
      g.stroke();
    } else text(g, glyph, 0, -h / 2 + 37, 32, '#fff3d6');
    text(g, label, 0, h / 2 - 18, 16, '#e8dcc0', { font: 'sans-serif', bold: false });
    g.restore();
  }
  // 分段选择器（模式/难度）
  function segmented(x, y, w, h, items, cur, pick, size) {
    const n = items.length, sw = w / n;
    g.save();
    if (!JQ.kit3(g, 'kit_track', x, y - h * 0.08, w, h * 1.16)) {
      JQ.rr(g, x, y, w, h, h / 2);
      g.fillStyle = 'rgba(25,18,10,0.66)';
      g.fill();
      g.strokeStyle = 'rgba(255,210,130,0.45)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    items.forEach(([k, label], i) => {
      const bx = x + i * sw;
      buttons.push({ x: bx, y, w: sw, h, fn: () => pick(k) });
      if (k === cur) {
        if (!JQ.kit3(g, 'kit_gold', bx + 3, y + 2, sw - 6, h - 4)) {
          JQ.rr(g, bx + 4, y + 4, sw - 8, h - 8, (h - 8) / 2);
          const grd = g.createLinearGradient(0, y, 0, y + h);
          grd.addColorStop(0, '#ffe39a');
          grd.addColorStop(1, '#e09a33');
          g.fillStyle = grd;
          g.fill();
        }
      }
      text(g, label, bx + sw / 2, y + h / 2 + 1, size || 24, k === cur ? '#3a2a10' : '#e8dcc0');
    });
    g.restore();
  }
  let menuShade = null;
  // 主菜单两侧的悬浮入口（手游常见的活动/福利入口）：圆底 + 图标 + 名字，有可领/可抽时带红点
  function drawSideEntry(x, y, label, icon, fn, dot) {
    const s = 84;
    buttons.push({ x, y, w: s, h: s + 26, fn });
    const k = pressK(x, y);
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.scale(k, k);
    g.translate(-(x + s / 2), -(y + s / 2));
    const glow = 0.45 + 0.25 * Math.sin(performance.now() / 380);
    if (isHeld(x, y)) g.filter = 'brightness(0.78)';
    if (!JQ.kitImg(g, 'kit_round_wood', x - 8, y - 8, s + 16, s + 16)) {
      g.beginPath();
      g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
      const grd = g.createRadialGradient(x + s / 2, y + s * 0.4, 4, x + s / 2, y + s / 2, s / 2);
      grd.addColorStop(0, 'rgba(120,46,20,0.95)');
      grd.addColorStop(1, 'rgba(40,16,8,0.92)');
      g.fillStyle = grd;
      g.fill();
      g.strokeStyle = `rgba(255,210,120,${0.55 + glow * 0.5})`;
      g.lineWidth = 2.5;
      g.stroke();
    }
    icon(x + 15, y + 11, s - 30);
    g.filter = 'none';
    JQ.rr(g, x - 4, y + s - 14, s + 8, 28, 14);
    g.fillStyle = 'rgba(140,30,16,0.95)';
    g.fill();
    g.strokeStyle = 'rgba(255,215,140,0.8)';
    g.lineWidth = 1.2;
    g.stroke();
    text(g, label, x + s / 2, y + s, 17, '#fff1d0', { stroke: '#3a0a04', strokeW: 3 });
    if (dot) {
      g.beginPath();
      g.arc(x + s - 8, y + 10, 10, 0, Math.PI * 2);
      g.fillStyle = '#e8321e';
      g.fill();
      g.strokeStyle = '#fff1d0';
      g.lineWidth = 2;
      g.stroke();
    }
    g.restore();
  }
  // ---------- 大厅背景对战（用户 2026-11-11 要求保留「现场对战」）----------
  // 一局 AI 对打在后台跑；渲染到透明离屏画布（约 0.7 倍分辨率），每两帧重画一次，大厅再整张贴上来
  let menuGame = null, menuCv = null, menuTick = 0;
  const menuView = { g: null, speed: 1, selected: -1, anims: [], noHud: true, noBg: true };
  function stepMenuGame(dt) {
    if (!menuGame || menuGame.over) {
      menuGame = new JQ.Game({ seed: (Math.random() * 1e9) | 0 });
      menuGame.aiT = [0, 0];
      menuGame.warm = 60 * 50;
    }
    const warm = menuGame.warm > 0 ? Math.min(menuGame.warm, 300) : 0;
    for (let k = 0; k < warm; k++) {
      for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= STEP) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
      menuGame.step(STEP);
    }
    menuGame.warm -= warm;
    for (const sid of [0, 1]) if ((menuGame.aiT[sid] -= dt) <= 0) (JQ.aiThink(menuGame, sid), (menuGame.aiT[sid] = 0.9));
    menuGame.step(dt);
  }
  function drawMenuBattle(top, bot) {
    const W = C.W + 2 * padX, H = bot - top, k = Math.max(0.5, Math.min(1, scale * dpr * 0.7));
    if (!menuCv || menuCv.k !== k || menuCv.W !== W || menuCv.H !== H) {
      menuCv = document.createElement('canvas');
      menuCv.width = Math.ceil(W * k);
      menuCv.height = Math.ceil(H * k);
      Object.assign(menuCv, { k, W, H, fresh: true });
      menuView.g = menuCv.getContext('2d');
    }
    if (menuCv.fresh || (menuTick = (menuTick + 1) % 2) === 0) {
      const c = menuView.g;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, menuCv.width, menuCv.height);
      c.setTransform(k, 0, 0, k, padX * k, -top * k);
      JQ.render(menuGame, menuView);
      // 上下渐隐：只留中间交战区，标题和按钮区不压棋盘
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.globalCompositeOperation = 'destination-in';
      const Y = (v) => (v - top) * k, mask = c.createLinearGradient(0, 0, 0, menuCv.height);
      const f = (v) => Math.max(0, Math.min(1, Y(v) / menuCv.height));
      mask.addColorStop(0, 'rgba(0,0,0,0)');
      mask.addColorStop(f(300), 'rgba(0,0,0,0)');
      mask.addColorStop(f(390), 'rgba(0,0,0,1)');
      mask.addColorStop(f(760), 'rgba(0,0,0,1)');
      mask.addColorStop(f(850), 'rgba(0,0,0,0)');
      mask.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = mask;
      c.fillRect(0, 0, menuCv.width, menuCv.height);
      c.globalCompositeOperation = 'source-over';
      menuCv.fresh = false;
    }
    g.drawImage(menuCv, -padX, top, W, H);
  }

  // ---------- 大厅（2026-11-11 改版）----------
  // 参考热门手游/小游戏大厅：顶部资源条（右上留给微信胶囊）、中间本命将立绘、两侧悬浮入口带红点、
  // 下方关卡牌 + 卡包 + 开战，底栏五个入口、中间「求贤」凸起。不再在背景跑一局 AI 对打（省电）。
  const lobbyCache = {}; // 本命将立绘的柔边缓存：key = 立绘文件
  function lobbyPortrait(name) {
    const file = JQ.portraitFile(name);
    if (!file) return null;
    if (lobbyCache[file]) return lobbyCache[file];
    if (!JQ.artReady(file)) return null; // 图还没下完：别每帧新建画布
    const W = 480, H = 640, c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const cg = c.getContext('2d');
    if (!JQ.portraitDraw(cg, name, 0, 0, W, H, { file })) return null;
    // 四周羽化：上下左右渐隐，像从画卷里浮出来
    cg.globalCompositeOperation = 'destination-in';
    const v = cg.createLinearGradient(0, 0, 0, H);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.1, 'rgba(0,0,0,1)');
    v.addColorStop(0.72, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = v;
    cg.fillRect(0, 0, W, H);
    const h = cg.createLinearGradient(0, 0, W, 0);
    h.addColorStop(0, 'rgba(0,0,0,0)');
    h.addColorStop(0.14, 'rgba(0,0,0,1)');
    h.addColorStop(0.86, 'rgba(0,0,0,1)');
    h.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = h;
    cg.fillRect(0, 0, W, H);
    return (lobbyCache[file] = c);
  }
  // 后层：立绘/大字半透明衬在实时对战下面；前层（名牌、等级条）由 drawLobbyHeroFront 画在对战上面
  function drawLobbyHero(now) {
    const name = prog.main;
    const x = 140, y = 262, w = 440, h = 586;
    JQ.fxSprite(g, 'rays', C.W / 2, y + h * 0.42, 620, 620, 0.22, now / 12000);
    g.save();
    g.globalAlpha = 0.62;
    if (!name) {
      ACT.heroes.forEach((n, i) => {
        const c = lobbyPortrait(n);
        if (c) g.drawImage(c, 150 + i * 140 - 70, 330, 280, 373);
      });
    } else {
      const c = lobbyPortrait(name), bob = Math.sin(now / 1400) * 4;
      if (c) g.drawImage(c, x, y + bob, w, h);
      else {
        JQ.drawOrnament(g, name, C.W / 2, y + h * 0.45, 150, { tier: brkOf(name), behind: true });
        text(g, HEROES[name].chars[0], C.W / 2, y + h * 0.32, 150, '#2a1a08', { stroke: '#f5ead0', strokeW: 8 });
        text(g, HEROES[name].chars[1], C.W / 2, y + h * 0.58, 150, '#2a1a08', { stroke: '#f5ead0', strokeW: 8 });
        JQ.drawOrnament(g, name, C.W / 2, y + h * 0.45, 150, { tier: brkOf(name), behind: false });
      }
    }
    g.restore();
  }
  function drawLobbyHeroFront(now) {
    const name = prog.main;
    const x = 140, y = 262, w = 440, h = 586;
    buttons.push({ x: x + 40, y: y + 40, w: w - 80, h: h - 80, fn: () => openMainHero() });
    if (!name) {
      // 还没有本命将：三位活动英雄并排当推荐
      text(g, '点这里挑一位本命将', C.W / 2, 760, 24, '#ffe9a0', { stroke: '#2a1a08', strokeW: 5 });
      text(g, '只养一位：用铜钱升级，出战更强', C.W / 2, 794, 14, '#e8dcc0', { font: 'sans-serif', bold: false });
      return;
    }
    // 竖排名牌（右上）
    const px = x + w - 66, py = y + 30;
    JQ.rr(g, px, py, 46, 34 + 40 * name.length, 6);
    g.fillStyle = 'rgba(243,234,211,0.94)';
    g.fill();
    g.strokeStyle = '#8a2a14';
    g.lineWidth = 2;
    g.stroke();
    [...name].forEach((ch, i) => text(g, ch, px + 23, py + 34 + i * 40, 32, '#2a1008'));
    const sk = qx().equip[name] && JQ.SKIN_BY_ID[qx().equip[name]];
    if (sk) text(g, sk.name, px + 23, py + 50 + 40 * name.length, 11, '#ffd9a0', { font: 'sans-serif', stroke: '#2a1008', strokeW: 3 });
    // 底部：本命 Lv / 突破 / 去培养
    const lv = heroLvOf(name), cap = heroCap(name), can = lv < cap && prog.coins >= upCost(lv);
    const tx = C.W / 2, ty = y + h - 30;
    JQ.rr(g, tx - 170, ty - 22, 340, 44, 22);
    g.fillStyle = 'rgba(24,14,8,0.82)';
    g.fill();
    g.strokeStyle = 'rgba(230,194,122,0.7)';
    g.lineWidth = 1.5;
    g.stroke();
    text(g, `本命将 Lv${lv}` + (ACT.byHero[name] ? ` · 突破 ${brkOf(name)}/3` : ''), tx - 18, ty + 1, 18, '#ffe9a0', { font: 'sans-serif' });
    text(g, '培养 ›', tx + 156, ty + 1, 14, can ? '#ffd23f' : '#c8b090', { align: 'right', font: 'sans-serif' });
    if (can) redDot(tx + 164, ty - 18);
  }
  function redDot(x, y, r) {
    g.beginPath();
    g.arc(x, y, r || 9, 0, Math.PI * 2);
    g.fillStyle = '#e8321e';
    g.fill();
    g.strokeStyle = '#fff1d0';
    g.lineWidth = 2;
    g.stroke();
  }
  // 顶部资源胶囊：图标 + 数值，可点
  function resPill(x, y, w, icon, val, fn) {
    if (fn) buttons.push({ x, y, w, h: 40, fn });
    JQ.rr(g, x, y, w, 40, 20);
    g.fillStyle = 'rgba(18,11,6,0.72)';
    g.fill();
    g.strokeStyle = 'rgba(230,194,122,0.55)';
    g.lineWidth = 1.2;
    g.stroke();
    icon(x + 3, y + 2, 36);
    text(g, String(val), x + 44, y + 21, 18, '#ffe9a0', { align: 'left', font: 'sans-serif', stroke: '#1a1008', strokeW: 3 });
    if (fn) text(g, '+', x + w - 16, y + 21, 20, '#ffd23f', { font: 'sans-serif' });
  }
  const actDot = () =>
    ACT.heroes.some((h) => {
      const lv = brkOf(h), c = lv < 3 && JQ.brkCost(h, lv);
      return c && (prog.act.stone || 0) >= c.stone && (prog.act.seal[h] || 0) >= c.seal;
    }) || ACT.tasks.some((t) => !prog.act.tasks[t.id] && actTaskProgress(t) >= t.need);
  const mainDot = () => !!prog.main && heroLvOf(prog.main) < heroCap(prog.main) && prog.coins >= upCost(heroLvOf(prog.main));
  function drawMenu(dt) {
    activityStage = null; // 从活动页/结算回到主菜单后，下一局不再沿用活动关卡
    const now = performance.now();
    const top = -JQ.VIEW.top, bot = C.H + JQ.VIEW.bot;
    JQ.drawBackdrop(g);
    stepMenuGame(dt);
    drawLobbyHero(now);
    drawMenuBattle(top, bot);
    // 上下压暗托住界面
    if (!menuShade || menuShade.top !== top || menuShade.bot !== bot) {
      // 上下压暗加深：背景对战的两块棋盘在标题区和按钮区淡出，不和文字打架
      const a = g.createLinearGradient(0, top, 0, 330);
      a.addColorStop(0, 'rgba(20,14,6,0.92)');
      a.addColorStop(0.7, 'rgba(20,14,6,0.72)');
      a.addColorStop(1, 'rgba(20,14,6,0)');
      const b = g.createLinearGradient(0, 780, 0, bot);
      b.addColorStop(0, 'rgba(20,14,6,0)');
      b.addColorStop(0.25, 'rgba(20,14,6,0.75)');
      b.addColorStop(1, 'rgba(20,14,6,0.92)');
      menuShade = { top, bot, a, b };
    }
    g.fillStyle = menuShade.a;
    g.fillRect(-padX, top, C.W + 2 * padX, 330 - top);
    g.fillStyle = menuShade.b;
    g.fillRect(-padX, 780, C.W + 2 * padX, bot - 780);
    // 漂浮的金色光点（便宜的氛围）
    g.save();
    for (let i = 0; i < 14; i++) {
      const k = ((now / 9000 + i * 0.137) % 1), px = 120 + ((i * 97) % 480) + Math.sin(now / 1300 + i) * 14, py = 840 - k * 560;
      g.globalAlpha = Math.sin(k * Math.PI) * 0.55;
      g.fillStyle = i % 3 ? '#ffd27a' : '#fff1c0';
      g.beginPath();
      g.arc(px, py, 1.6 + (i % 3), 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    drawLobbyHeroFront(now);

    // 顶部：主公头像 + 等级条 + 资源；右侧约 170 宽留给微信小游戏胶囊按钮
    {
      const ty = top + 16;
      buttons.push({ x: 12, y: ty - 4, w: 180, h: 64, fn: () => openMainHero() });
      g.save();
      g.beginPath();
      g.arc(46, ty + 28, 30, 0, Math.PI * 2);
      g.fillStyle = 'rgba(30,18,10,0.9)';
      g.fill();
      g.clip();
      if (!(prog.main && JQ.portraitDraw(g, prog.main, 16, ty - 2, 60, 80))) JQ.ui2Draw(g, 'badge', 30, ty + 8, 32, 37);
      g.restore();
      g.beginPath();
      g.arc(46, ty + 28, 30, 0, Math.PI * 2);
      g.strokeStyle = '#e6c27a';
      g.lineWidth = 2.5;
      g.stroke();
      text(g, `主公 Lv${prog.lv}`, 84, ty + 18, 17, '#ffe9a0', { align: 'left', stroke: '#2a1a08', strokeW: 3 });
      JQ.rr(g, 84, ty + 34, 100, 8, 4);
      g.fillStyle = 'rgba(255,255,255,0.15)';
      g.fill();
      JQ.rr(g, 84, ty + 34, Math.max(4, (100 * prog.xp) / lvNeed(prog.lv)), 8, 4);
      g.fillStyle = '#e6b04a';
      g.fill();
      resPill(200, ty + 8, 150, (x, y, s) => JQ.uiDraw(g, 'coin', x + 5, y + 5, s - 10, s - 10), prog.coins, null);
      resPill(360, ty + 8, 160, (x, y, s) => qxIcon(x, y, s), qx().tokens, () => openQiuxian('draw'));
      const sOk = JQ.ui2Draw(g, 'star_on', 204, ty + 54, 20, 19);
      text(g, (sOk ? '' : '★ ') + `${totalStars()} · 再 ${10 - (totalStars() % 10)} 星开宝箱`, 228, ty + 64, 12, '#e8dcc0', { align: 'left', font: 'sans-serif', bold: false });
    }
    // 标题 + 模式
    title('禁区突围', 150, 64, '#1a1a1a');
    segmented(150, 194, 420, 50, Object.entries(JQ.MODES).filter(([k]) => k !== 'breakthrough').map(([k, m]) => [k, m.name]), mode, (k) => {
      mode = k;
      localStorage.setItem('jq_mode', k);
    }, 22);

    // 两侧入口
    const ui = (id) => (x, y, s) => JQ.uiDraw(g, id, x, y, s, s);
    drawSideEntry(18, 300, '突破', (x, y, s) => JQ.iconDraw(g, 'breakthrough', x, y, s, s), () => openActivity('brk'), actDot());
    drawSideEntry(18, 430, '选关', (x, y, s) => JQ.iconDraw(g, 'stage', x, y, s, s), () => (mode === 'endless' ? sfx('bad') : openStages()), false);
    drawSideEntry(18, 560, '玩法', ui('ic_help'), () => ((helpBack = 'menu'), (helpPage = 0), (screen = 'help')), false);
    // 游戏厅排行榜（/arcade/arcade.js，三款游戏共用账号）
    drawSideEntry(18, 690, '排行', (x, y, s2) => JQ.ui2Draw(g, 'laurel', x - 4, y - 2, s2 + 8, s2 + 6), () => window.Arcade && window.Arcade.open('jinqu'), false);
    drawSideEntry(618, 300, '设置', ui('ic_gear'), () => (menuPop = 'settings'), false);
    drawSideEntry(618, 430, '自定义', ui('ic_custom'), () => openCustom(), false);
    drawSideEntry(618, 560, '测试场', ui('ic_test'), () => openTestLab(), false);

    // 关卡牌
    const r = rec(mode);
    if (mode === 'classic' || mode === 'fate') {
      const st = stageOf(), x = 150, y = 860, w = 420, h = 56;
      buttons.push({ x, y, w, h, fn: () => openStages() });
      panel(x, y, w, h, 'rgba(25,16,8,0.78)', 'rgba(255,210,120,0.6)', 1.6);
      text(g, `第 ${st} 关`, x + 24, y + 27, 28, '#ffe9a0', { align: 'left', stroke: '#2a1a08', strokeW: 4 });
      text(g, `/ ${C.MAX_STAGE}`, x + 152, y + 30, 14, '#bfa878', { align: 'left', font: 'sans-serif', bold: false });
      text(g, `敌强 ×${JQ.stageBoost(st).toFixed(2)}`, x + 300, y + 21, 12, '#d8c8a0', { font: 'sans-serif', bold: false });
      text(g, `${r.win}胜 ${r.lose}负`, x + 300, y + 39, 12, '#d8c8a0', { font: 'sans-serif', bold: false });
      text(g, '选关 ›', x + w - 14, y + 29, 14, '#e6c27a', { align: 'right', font: 'sans-serif', bold: false });
      JQ.rr(g, x + 14, y + h - 7, w - 28, 4, 2);
      g.fillStyle = 'rgba(255,220,160,0.16)';
      g.fill();
      JQ.rr(g, x + 14, y + h - 7, Math.max(4, ((w - 28) * bestOf()) / C.MAX_STAGE), 4, 2);
      g.fillStyle = '#e6b04a';
      g.fill();
    } else {
      panel(190, 860, 340, 56, 'rgba(25,16,8,0.78)', 'rgba(255,210,120,0.6)', 1.6);
      text(g, `最佳：第 ${r.best || 0} 波`, C.W / 2, 884, 24, '#ffe9a0', { stroke: '#2a1a08', strokeW: 4 });
      text(g, `敌军数量 ×${JQ.aiProfile(difficulty, player).wave}`, C.W / 2, 906, 11, '#d8c8a0', { font: 'sans-serif', bold: false });
    }
    if (mode === 'fate') {
      const eq = fateSave.equipped.map((id) => JQ.TALENT_BY_ID[id].name).join('、') || '未装备';
      buttons.push({ x: 150, y: 918, w: 420, h: 26, fn: () => (screen = 'talents') });
      text(g, `天赋：${eq} ›`, C.W / 2, 932, 13, '#ffd23f', { font: 'sans-serif' });
    }

    // 卡包 → 开战 → 难度
    const open = MENU_PACKS.filter((k) => JQ.PACKS[k] && JQ.PACKS[k].open && (k !== 'custom' || JQ.customReady()));
    const cyc = (d) => choosePack(open[(open.indexOf(pack) + d + open.length) % open.length]);
    const pk = JQ.PACKS[pack];
    iconBtn(146, 946, 48, '‹', () => cyc(-1));
    iconBtn(526, 946, 48, '›', () => cyc(1));
    buttons.push({ x: 202, y: 944, w: 316, h: 52, fn: () => (menuPop = 'packs') });
    {
      const k = pressK(202, 944);
      g.save();
      g.translate(C.W / 2, 970);
      g.scale(k, k);
      g.translate(-C.W / 2, -970);
      panel(202, 944, 316, 52, 'rgba(25,16,8,0.78)', 'rgba(255,210,120,0.6)', 1.6);
      text(g, '卡包', 236, 970, 14, '#bfa878', { font: 'sans-serif', bold: false });
      text(g, `${pk.name}（${pk.heroes.length}将）`, C.W / 2 + 14, 969, 22, '#ffe9a0');
      text(g, '▾', 500, 970, 14, '#e6c27a', { font: 'sans-serif' });
      g.restore();
    }
    // 开战：最大最亮，带呼吸光
    {
      const x = 170, y = 1004, w = 380, h = 84, k = pressK(x, y);
      buttons.push({ x, y, w, h, fn: newGame });
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.scale(k, k);
      g.shadowColor = '#ffcf5a';
      g.shadowBlur = 16 + Math.sin(now / 320) * 10;
      if (isHeld(x, y)) g.filter = 'brightness(0.8)';
      const kitOk = JQ.kit3(g, 'kit_red', -w / 2 - 20, -h / 2 - 6, w + 40, h + 12);
      g.filter = 'none';
      g.shadowBlur = 0;
      if (kitOk) text(g, '开  战', 0, 2, 44, '#fff0c8', { stroke: '#5a0e04', strokeW: 6 });
      else {
        JQ.rr(g, -w / 2, -h / 2, w, h, 22);
        const grd = g.createLinearGradient(0, -h / 2, 0, h / 2);
        grd.addColorStop(0, '#ffe39a');
        grd.addColorStop(0.55, '#f0b443');
        grd.addColorStop(1, '#c8791c');
        g.fillStyle = grd;
        g.fill();
        g.lineWidth = 3.5;
        g.strokeStyle = '#5a3a12';
        g.stroke();
        text(g, '开  战', 0, 2, 42, '#3a2008', { stroke: '#ffeec0', strokeW: 3 });
      }
      g.restore();
    }
    // 难度：开战按钮下面一行小分段
    segmented(250, 1094, 220, 36, JQ.DIFF_ORDER.map((k) => [k, JQ.DIFF[k].name]), difficulty, (k) => {
      difficulty = k;
      localStorage.setItem('jq_diff', k);
    }, 17);

    // 底栏：五个入口，中间「求贤」凸起
    const nh = 104, ny = Math.max(1140, bot - nh);
    g.save();
    g.fillStyle = 'rgba(18,13,8,0.9)';
    g.fillRect(-padX, ny, C.W + 2 * padX, bot - ny);
    g.fillStyle = 'rgba(230,194,122,0.55)';
    g.fillRect(-padX, ny, C.W + 2 * padX, 1.5);
    g.restore();
    const nav = [
      ['本', '本命将', () => openMainHero(), mainDot()],
      ['将', '英雄图鉴', () => ((helpBack = 'menu'), (helpPage = 1), (screen = 'help')), false],
      null,
      ['兵', '小兵图鉴', () => (screen = 'units'), false],
      ['运', '天赋', () => ((mode = 'fate'), localStorage.setItem('jq_mode', 'fate'), (screen = 'talents')), false],
    ];
    nav.forEach((it, i) => {
      if (!it) return;
      navItem(i * 144, ny, 144, nh, it[0], it[1], it[2]);
      if (it[3]) redDot(i * 144 + 104, ny + 16);
    });
    {
      // 中间凸起的求贤
      const cx = C.W / 2, cy = ny + 8, R = 52, k = pressK(cx - R, cy - R);
      buttons.push({ x: cx - R, y: cy - R, w: 2 * R, h: 2 * R + 40, fn: () => openQiuxian('draw') });
      g.save();
      g.translate(cx, cy);
      g.scale(k, k);
      g.shadowColor = 'rgba(255,190,80,0.8)';
      g.shadowBlur = 12 + 6 * Math.sin(now / 400);
      if (!JQ.kitImg(g, 'kit_round_red', -R * 1.22, -R * 1.22, R * 2.44, R * 2.44)) {
        g.beginPath();
        g.arc(0, 0, R, 0, Math.PI * 2);
        const grd = g.createRadialGradient(0, -12, 6, 0, 0, R);
        grd.addColorStop(0, '#b8401c');
        grd.addColorStop(1, '#5a160a');
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = '#ffd98a';
        g.lineWidth = 3;
        g.stroke();
      }
      g.shadowBlur = 0;
      qxIcon(-30, -36, 60);
      g.restore();
      text(g, '求贤', cx, ny + 84, 18, '#ffe9a0', { stroke: '#2a1a08', strokeW: 3 });
      if (qxFree() || qx().tokens >= QX.ten) redDot(cx + 40, cy - 40, 10);
    }

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
    veil(0.72);
    buttons.push({ x, y, w, h, fn: () => {} });
    popFrame(x, y, w, h, titleStr);
    iconBtn(x + w - 50, y - 14, 50, '×', () => (menuPop = null));
  }
  function drawSettingsPop() {
    const x = 110, y = 300, w = 500, h = 700;
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
      setMusic();
    });
    row(3, '背景音乐', musicOn, () => {
      musicOn = !musicOn;
      localStorage.setItem('jq_music', musicOn ? '1' : '0');
      setMusic();
    });
    // 两项画面样式：开 = 新样式，关 = 原版（默认）
    // 战场背景：点一下换下一张
    {
      const ry = y + 90 + 4 * 84, L = JQ.BG_LIST, i = Math.max(0, L.findIndex((b) => b.id === style.bg));
      text(g, '战场背景', x + 36, ry + 29, 24, '#f5ead0', { align: 'left' });
      button(x + 270, ry + 6, 200, 46, `${L[i].name}  ›`, () => {
        style.bg = L[(i + 1) % L.length].id;
        localStorage.setItem('jq_bgstyle', style.bg);
        JQ.setStyle({ bg: style.bg });
      }, { flat: true, size: 19 });
    }
    row(5, '单位用象棋子', style.unit === 'piece', () => {
      style.unit = style.unit === 'piece' ? 'glyph' : 'piece';
      localStorage.setItem('jq_unitstyle', style.unit);
      JQ.setStyle({ unit: style.unit });
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
    button(x + 150, y + h - 66, 200, 48, '🏠 返回游戏厅', () => { location.href = '../'; }, { size: 21 });
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
    stagePage = Math.floor((stageOf() - 1) / STAGE_PER);
    screen = 'stages';
  }
  // 选关：5 章 × 40 关；每格显示关号、星级、锁，每 20 关的「多一将」关用朱红格
  const STAGE_PER = 40, CHAPTERS = ['一', '二', '三', '四', '五'];
  function drawStages() {
    JQ.drawBackdrop(g);
    pageFrame(`选关 · 第 ${stageOf()} 关`, 0.78, () => (screen = 'menu'));
    const stars = prog.stars[mode === 'fate' ? 'fate' : 'classic'] || {};
    const pages = Math.ceil(C.MAX_STAGE / STAGE_PER);
    const T = pageTop() + 96;
    segmented(40, T, 640, 50, CHAPTERS.slice(0, pages).map((c, i) => [i, `第${c}章`]), stagePage, (k) => (stagePage = k), 19);
    const got = Object.values(stars).reduce((a, b) => a + b, 0);
    text(g, `${JQ.MODES[mode].name} · 已解锁 ${bestOf()} / ${C.MAX_STAGE} 关 · 共 ${got} 星`, C.W / 2, T + 74, 16, '#e8d8b0', { font: 'sans-serif', bold: false });
    const top = T + 96, bot = pageBottom() - 8, rows = 8, cols = 5, gap = 10;
    const tw = (640 - gap * (cols - 1)) / cols, th = Math.min(132, (bot - top - gap * (rows - 1)) / rows);
    const start = stagePage * STAGE_PER + 1;
    for (let i = 0; i < STAGE_PER; i++) {
      const n = start + i;
      if (n > C.MAX_STAGE) break;
      const x = 40 + (i % cols) * (tw + gap), y = top + Math.floor(i / cols) * (th + gap);
      const locked = n > bestOf(), cur = n === stageOf(), boss = n % 20 === 0, st = stars[n] || 0;
      buttons.push({ x, y, w: tw, h: th, fn: locked ? () => sfx('bad') : () => (setStage(n), (screen = 'menu')) });
      const k = pressK(x, y);
      g.save();
      g.translate(x + tw / 2, y + th / 2);
      g.scale(k, k);
      g.translate(-(x + tw / 2), -(y + th / 2));
      card(x, y, tw, th, { on: cur, dim: locked, red: boss && !locked && !cur });
      if (locked) {
        if (!JQ.uiDraw(g, 'lock', x + tw / 2 - 16, y + th / 2 - 30, 32, 32)) text(g, '锁', x + tw / 2, y + th / 2 - 12, 20, '#7a6e5c');
        text(g, String(n), x + tw / 2, y + th - 20, 18, '#7a6e5c', { font: 'sans-serif' });
      } else {
        text(g, String(n), x + tw / 2, y + th * 0.4, 32, cur ? '#3a2008' : '#fff1d8', cur ? undefined : { stroke: '#1a0c04', strokeW: 4 });
        for (let s2 = 0; s2 < 3; s2++) {
          const sx = x + tw / 2 + (s2 - 1) * 24, sy = y + th * 0.74;
          if (!JQ.ui2Draw(g, s2 < st ? 'star_on' : 'star_off', sx - 10, sy - 10, 20, 19)) text(g, '★', sx, sy, 17, s2 < st ? '#ffd23f' : 'rgba(255,255,255,0.18)');
        }
        if (boss) text(g, '多一将', x + tw - 8, y + 14, 11, cur ? '#7a2008' : '#ffd9a0', { align: 'right', font: 'sans-serif' });
        if (cur) text(g, '当前', x + 10, y + 14, 11, '#7a2008', { align: 'left', font: 'sans-serif' });
      }
      g.restore();
    }
  }

  // ---------- 自定义卡包 ----------
  let customHeroes = [], customUnits = [], customMsg = '', customTab = 'sanguo';
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
    JQ.drawBackdrop(g);
    pageFrame('自定义卡包', 0.78, () => (screen = 'menu'));
    JQ.preloadUiArt();
    const T = pageTop() + 96, B = pageBottom();
    // 顶部横幅：封面 + 两个大计数
    {
      const x = 24, y = T, w = 672, h = 120, im = PACK_ART.custom;
      g.save();
      JQ.rr(g, x, y, w, h, 14);
      g.clip();
      g.fillStyle = '#24160c';
      g.fillRect(x, y, w, h);
      if (im && im.complete && im.naturalWidth) {
        const sh = im.naturalWidth / (w / h);
        g.drawImage(im, 0, (im.naturalHeight - sh) * 0.35, im.naturalWidth, sh, x, y, w, h);
      }
      const grd = g.createLinearGradient(x, 0, x + w, 0);
      grd.addColorStop(0, 'rgba(16,10,6,0.85)');
      grd.addColorStop(1, 'rgba(16,10,6,0.2)');
      g.fillStyle = grd;
      g.fillRect(x, y, w, h);
      g.restore();
      const okH = customHeroes.length === 16, okU = customUnits.length >= 6 && customUnits.length <= 12;
      JQ.statIcon(g, 'summon', x + 20, y + 22, 76);
      text(g, `${customHeroes.length}/16`, x + 108, y + 52, 38, okH ? '#ffe08a' : '#ff9a7a', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
      text(g, '英雄', x + 110, y + 92, 18, '#e8d8b0', { align: 'left' });
      JQ.statIcon(g, 'atk', x + 290, y + 22, 76);
      text(g, `${customUnits.length}`, x + 378, y + 52, 38, okU ? '#ffe08a' : '#ff9a7a', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
      text(g, '小兵 6~12', x + 380, y + 92, 18, '#e8d8b0', { align: 'left' });
    }
    segmented(24, T + 136, 672, 50, ['sanguo', 'xiyou', 'tang', 'song', 'custom'].map((k) => [k, JQ.PACKS[k].name]), customTab, (k) => (customTab = k), 19);
    // 英雄字牌 4x4 + 小兵字牌 8x2，高度按屏幕分配；底部操作条
    const barH = 96, hy = T + 200, unitH = 2 * 78 + 44, heroH = B - barH - unitH - hy - 10;
    const packHeroes = ((JQ.PACKS[customTab] && JQ.PACKS[customTab].heroes) || []).slice(0, 16);
    const gap = 10, tw = (672 - gap * 3) / 4, th = Math.min(190, (heroH - gap * 3) / 4);
    packHeroes.forEach((name, i) => {
      const x = 24 + (i % 4) * (tw + gap), y = hy + Math.floor(i / 4) * (th + gap), on = customHeroes.includes(name), k = pressK(x, y);
      buttons.push({ x, y, w: tw, h: th, fn: () => toggleCustomHero(name) });
      g.save();
      g.translate(x + tw / 2, y + th / 2);
      g.scale(k, k);
      g.translate(-(x + tw / 2), -(y + th / 2));
      if (on) paperTile(name, x, y, tw, th, { on: true });
      else (card(x, y, tw, th, { dim: true }), text(g, name, x + tw / 2, y + th / 2 + 1, Math.min(th * 0.4, (tw * 0.8) / name.length), '#c8b090'));
      JQ.roleIconDraw(g, HEROES[name].role, x + 6, y + 6, 28);
      if (on) (g.beginPath(), g.arc(x + tw - 16, y + 16, 12, 0, Math.PI * 2), (g.fillStyle = '#a82818'), g.fill(), text(g, '✓', x + tw - 16, y + 17, 15, '#fff1d8', { font: 'sans-serif' }));
      g.restore();
    });
    const uy = hy + heroH + 10;
    text(g, '小兵', 24, uy + 16, 20, '#ffd23f', { align: 'left' });
    const uw = (672 - 7 * 8) / 8;
    JQ.ALL_UNITS.forEach((key, i) => {
      const x = 24 + (i % 8) * (uw + 8), y = uy + 34 + Math.floor(i / 8) * 86, on = customUnits.includes(key);
      buttons.push({ x, y, w: uw, h: 78, fn: () => toggleCustomUnit(key) });
      if (on) paperTile(key, x, y, uw, 78, { on: true });
      else (card(x, y, uw, 78, { dim: true }), text(g, key, x + uw / 2, y + 40, 36, '#c8b090'));
    });
    const by = B - barH + 14;
    if (customMsg) text(g, customMsg, C.W / 2, by - 14, 17, '#ff9a7a', { font: 'sans-serif' });
    button(24, by, 240, 76, '保 存', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和 6~12 种小兵');
      applyCustom();
      customMsg = '已保存';
    }, { size: 26 });
    button(280, by, 416, 76, '保存并开战', () => {
      if (!customValid()) return (customMsg = '先选满 16 位英雄和 6~12 种小兵');
      applyCustom();
      pack = 'custom';
      helpPack = 'custom';
      localStorage.setItem('jq_pack', 'custom');
      screen = 'menu';
      newGame();
    }, { size: 28, on: true });
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
    buttons.push({ x, y, w, h, fn: () => (testLab.active = idx) });
    card(x, y, w, h, { r: 14, light: active });
    if (active) (JQ.rr(g, x, y, w, h, 14), (g.strokeStyle = color), (g.lineWidth = 3), g.stroke());
    JQ.rr(g, x + 10, y + 10, 120, 32, 16);
    g.fillStyle = color;
    g.fill();
    text(g, `${idx ? '红方' : '蓝方'} ${team.length}/8`, x + 70, y + 27, 17, '#fff');
    if (active) text(g, '当前编辑', x + w - 12, y + 27, 15, '#ffe08a', { align: 'right', font: 'sans-serif' });
    if (!team.length) text(g, '点下方加入', x + w / 2, y + h / 2 + 24, 18, '#9a8f7a', { bold: false });
    const tw = (w - 20 - 3 * 6) / 4, th = (h - 60 - 6) / 2;
    team.forEach((e, i) => {
      const bx = x + 10 + (i % 4) * (tw + 6), by = y + 52 + Math.floor(i / 4) * (th + 6);
      buttons.push({ x: bx, y: by, w: tw, h: th, fn: () => removeTest(team, i) });
      paperTile(e.key, bx, by, tw, th, { on: e.kind === 'hero' });
    });
  }
  function drawTestLab() {
    JQ.drawBackdrop(g);
    pageFrame('测试场', 0.78, () => (screen = 'menu'));
    JQ.preloadUiArt();
    const T = pageTop() + 96, B = pageBottom();
    drawTestTeam(0, 24, T, 328, 190);
    drawTestTeam(1, 368, T, 328, 190);
    const ty = T + 204;
    segmented(24, ty, 320, 50, [['hero', '英雄'], ['unit', '小兵']], testLab.tab, (k) => ((testLab.tab = k), (testLab.page = 0)), 19);
    button(360, ty, 160, 50, '随 机', () => randomTestTeam(), { flat: true, size: 19 });
    button(536, ty, 160, 50, '清 空', () => clearTestTeam(), { flat: true, size: 19 });
    // 选择网格：字牌，已在任一队里的点亮
    const list = testLab.tab === 'hero' ? Object.keys(HEROES) : JQ.ALL_UNITS;
    const gy = ty + 64, barH = 200, cols = 5, gap = 8, tw = (672 - gap * (cols - 1)) / cols, th = 72;
    const rows = Math.max(1, Math.floor((B - barH - gy) / (th + gap))), per = rows * cols, pages = Math.max(1, Math.ceil(list.length / per));
    testLab.page = Math.min(testLab.page, pages - 1);
    for (let i = 0; i < per; i++) {
      const key = list[testLab.page * per + i];
      if (!key) break;
      const x = 24 + (i % cols) * (tw + gap), y = gy + Math.floor(i / cols) * (th + gap), on = testHas(key);
      buttons.push({ x, y, w: tw, h: th, fn: () => addTest(testLab.tab === 'hero' ? 'hero' : 'unit', key) });
      if (on) paperTile(key, x, y, tw, th, { on: true });
      else (card(x, y, tw, th, { r: 10 }), text(g, key, x + tw / 2, y + th / 2 + 1, Math.min(th * 0.42, (tw * 0.8) / key.length), '#f0e0c0'));
    }
    const py = B - barH + 8;
    iconBtn(24, py, 52, '‹', () => (testLab.page = Math.max(0, testLab.page - 1)));
    text(g, `${testLab.page + 1} / ${pages}`, 116, py + 27, 19, '#e8d8b0', { font: 'sans-serif' });
    iconBtn(156, py, 52, '›', () => (testLab.page = Math.min(pages - 1, testLab.page + 1)));
    button(236, py, 224, 52, `英雄 Lv${testLab.heroLv}`, () => cycleTestLevel('hero'), { flat: true, size: 19 });
    button(472, py, 224, 52, `小兵 Lv${testLab.unitLv}`, () => cycleTestLevel('unit'), { flat: true, size: 19 });
    if (testLab.msg) text(g, testLab.msg, C.W / 2, py + 76, 17, '#ff9a7a', { font: 'sans-serif' });
    button(120, B - 96, 480, 86, '开始测试', startTest, { on: true, size: 32 });
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
  // 玩法说明：5 张图解步骤卡（用游戏里的卡面/箭头画示意），每张只配一句话
  function miniCard(ch, x, y, s2, lv, opts) {
    opts = opts || {};
    JQ.rr(g, x, y, s2, s2, s2 * 0.14);
    const pg = g.createLinearGradient(0, y, 0, y + s2);
    pg.addColorStop(0, opts.hero ? '#ffe9b0' : '#f6eed8');
    pg.addColorStop(1, opts.hero ? '#e8b850' : '#dccba2');
    g.fillStyle = pg;
    g.fill();
    g.lineWidth = 3 + (lv || 1);
    g.strokeStyle = JQ.LEVEL_COLORS[Math.min(lv || 1, 5)] || '#9a9a9a';
    g.stroke();
    text(g, ch, x + s2 / 2, y + s2 / 2 + 2, s2 * (ch.length > 1 ? 0.36 : 0.6), opts.hero ? '#8a1a08' : '#2a1608');
    if (lv) (JQ.rr(g, x + s2 - 24, y - 8, 30, 22, 11), (g.fillStyle = '#2a1608'), g.fill(), text(g, 'Lv' + lv, x + s2 - 9, y + 3, 12, '#ffe9a0', { font: 'sans-serif' }));
  }
  function arrowR(x, y, w) {
    g.save();
    g.strokeStyle = '#ffd23f';
    g.fillStyle = '#ffd23f';
    g.lineWidth = 6;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w - 12, y);
    g.stroke();
    g.beginPath();
    g.moveTo(x + w, y);
    g.lineTo(x + w - 18, y - 12);
    g.lineTo(x + w - 18, y + 12);
    g.closePath();
    g.fill();
    g.restore();
  }
  function drawHelp() {
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => {} });
    pageFrame('玩法说明', 0.85, () => (screen = helpBack));
    const T = pageTop() + 96, B = pageBottom() - 90, n = 5, gap = 12, h = (B - T - gap * (n - 1)) / n;
    const steps = [
      ['招兵', '点「招兵」刷 5 张卡，拖进格子', (x, y, s2) => (miniCard('刀', x, y, s2, 1), miniCard('弓', x + s2 + 10, y, s2, 1), arrowR(x + 2 * s2 + 24, y + s2 / 2, 50), JQ.ui9(g, 'slot', x + 2 * s2 + 84, y - 6, s2 + 12, s2 + 12, 30, 18), miniCard('盾', x + 2 * s2 + 90, y, s2, 1))],
      ['合成升级', '同名同级叠在一起 +1 级', (x, y, s2) => (miniCard('刀', x, y, s2, 1), text(g, '+', x + s2 + 22, y + s2 / 2, 40, '#ffd23f'), miniCard('刀', x + s2 + 44, y, s2, 1), arrowR(x + 2 * s2 + 56, y + s2 / 2, 46), miniCard('刀', x + 2 * s2 + 112, y, s2, 2))],
      ['合字成将', '两字左右相邻 = 英雄', (x, y, s2) => (miniCard('关', x, y, s2, 1), miniCard('羽', x + s2 + 4, y, s2, 1), arrowR(x + 2 * s2 + 18, y + s2 / 2, 46), miniCard('关羽', x + 2 * s2 + 74, y, s2 + 14, 0, { hero: true }))],
      ['巡营召兵', '主角走过兵卡，召出小兵', (x, y, s2) => {
        for (let k = 0; k < 4; k++) miniCard(['刀', '弓', '枪', '骑'][k], x + k * (s2 * 0.8 + 6), y + 10, s2 * 0.8, 0);
        g.save();
        g.strokeStyle = 'rgba(255,210,90,0.95)';
        g.setLineDash([8, 7]);
        g.lineWidth = 4;
        g.beginPath();
        g.moveTo(x, y + s2 * 0.8 + 26);
        g.lineTo(x + 4 * (s2 * 0.8 + 6), y + s2 * 0.8 + 26);
        g.stroke();
        g.restore();
        text(g, '帅', x + ((performance.now() / 12) % (4 * (s2 * 0.8 + 6))), y + s2 * 0.8 + 26, 28, '#a82818', { stroke: '#fff1d8', strokeW: 4 });
      }],
      ['推倒敌营', '打空对面基地血量就赢', (x, y, s2) => {
        const w = 3 * s2;
        JQ.rr(g, x, y + s2 / 2 - 14, w, 28, 14);
        g.fillStyle = '#2a1a1a';
        g.fill();
        const f = 0.15 + 0.5 * (0.5 + 0.5 * Math.sin(performance.now() / 600));
        JQ.rr(g, x, y + s2 / 2 - 14, w * f, 28, 14);
        g.fillStyle = '#d0402a';
        g.fill();
        text(g, '敌营', x + w / 2, y + s2 / 2 + 1, 18, '#fff', { stroke: 'rgba(0,0,0,0.6)', strokeW: 3 });
      }],
    ];
    steps.forEach(([ttl, line, pic], i) => {
      const y = T + i * (h + gap);
      card(24, y, 672, h, { r: 16 });
      JQ.rr(g, 40, y + 16, 44, 44, 22);
      g.fillStyle = '#a82818';
      g.fill();
      text(g, String(i + 1), 62, y + 39, 24, '#fff1d8');
      text(g, ttl, 98, y + 40, 28, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
      text(g, line, 98, y + 76, 18, '#e8d8b0', { align: 'left', font: 'sans-serif', bold: false });
      // 示意图放在标题下方居中（宽度按每步的元素数估算）
      const s2 = Math.max(40, Math.min(84, h - 120)), pw = [3 * s2 + 96, 3 * s2 + 112, 3 * s2 + 88, 4 * (s2 * 0.8 + 6), 3 * s2][i];
      pic(C.W / 2 - pw / 2, y + 96 + (h - 96 - s2) / 2 - 6, s2);
    });
    button(40, B + 16, 300, 66, '英雄图鉴', () => ((helpPage = 1), (helpPack = pack)), { on: true, size: 24 });
    button(380, B + 16, 300, 66, '小兵图鉴', () => (screen = 'units'), { size: 24 });
  }

  // 小兵图鉴：16 种兵，标注出场卡包和基础数值
  // 小兵图鉴：2 列大卡片，字牌 + 职业 + 三条图标属性 + 特性图标；点卡片底部显示一句说明和具体数值
  let unitSel = null;
  const UNIT_MAX = (() => {
    const us = Object.values(UNITS);
    return { atk: Math.max(...us.map((u) => u.atk)), hp: Math.max(...us.map((u) => u.hp)), rate: Math.max(...us.map((u) => 1 / u.rate)) };
  })();
  function unitTraits(d) {
    const t = [];
    if (d.ranged) t.push('range');
    if (d.rangedReduce) t.push('armor');
    if (d.assassin || d.stealth) t.push('stealth');
    if (d.splash) t.push('aoe');
    if (d.healAura) t.push('heal');
    if (d.magic) t.push('bolt');
    if (d.bonus && d.bonus.hero) t.push('atk');
    if (d.bonus && (d.bonus['弓'] || d.bonus['盾'])) t.push('crit');
    if (d.rate <= 0.7) t.push('rate');
    if (d.speed >= 75) t.push('speed');
    return t.slice(0, 3);
  }
  function drawUnits() {
    JQ.drawBackdrop(g);
    pageFrame('小兵图鉴', 0.78, () => (screen = 'menu'));
    JQ.preloadUiArt();
    const T = pageTop() + 96, B = pageBottom(), sheet = unitSel ? 132 : 0;
    const role = (d) => (d.assassin ? ['刺客', '刺客'] : d.ranged ? ['远程', '射手'] : d.rangedReduce ? ['坦克', '坦克'] : ['近战', '战士']);
    const rows = 8, gap = 10, ch = (B - T - sheet - gap * (rows - 1)) / rows, cw = (672 - gap) / 2;
    JQ.ALL_UNITS.forEach((k, i) => {
      const d = UNITS[k], [rn, ri] = role(d), on = unitSel === k;
      const x = 24 + (i % 2) * (cw + gap), y = T + Math.floor(i / 2) * (ch + gap);
      buttons.push({ x, y, w: cw, h: ch, fn: () => ((unitSel = on ? null : k), sfx('tap')) });
      card(x, y, cw, ch, { light: on });
      if (on) (JQ.rr(g, x, y, cw, ch, 12), (g.strokeStyle = '#ffe08a'), (g.lineWidth = 3), g.stroke());
      // 字牌
      const ts = ch - 20;
      JQ.rr(g, x + 10, y + 10, ts, ts, 10);
      const pg = g.createLinearGradient(0, y + 10, 0, y + 10 + ts);
      pg.addColorStop(0, '#f6eed8');
      pg.addColorStop(1, '#dccba2');
      g.fillStyle = pg;
      g.fill();
      text(g, k, x + 10 + ts / 2, y + 10 + ts / 2 + 2, ts * 0.66, '#2a1608');
      // 职业 + 特性图标
      const ix = x + ts + 22;
      JQ.roleIconDraw(g, ri, ix, y + 8, 32);
      text(g, rn, ix + 38, y + 25, 20, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 3 });
      unitTraits(d).slice(0, 2).forEach((tid, n) => JQ.statIcon(g, tid, x + cw - 38 - n * 33, y + 9, 30));
      // 三条属性
      const bw = x + cw - 14 - (ix + 30), rowH = (ch - 52) / 3;
      [['atk', d.atk / UNIT_MAX.atk], ['hp', d.hp / UNIT_MAX.hp], ['rate', 1 / d.rate / UNIT_MAX.rate]].forEach(([id, v], n) => {
        const by = y + 50 + rowH * n + rowH / 2;
        JQ.statIcon(g, id, ix - 2, by - 13, 26);
        JQ.rr(g, ix + 30, by - 6, bw, 12, 6);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fill();
        JQ.rr(g, ix + 30, by - 6, Math.max(12, bw * Math.min(1, v)), 12, 6);
        g.fillStyle = id === 'hp' ? '#c84a34' : id === 'atk' ? '#e8a23a' : '#d8c070';
        g.fill();
      });
    });
    if (unitSel) {
      const d = UNITS[unitSel], y = B - sheet + 8;
      card(24, y, 672, sheet - 8, { r: 14, light: true });
      text(g, unitSel, 70, y + 62, 64, '#ffe9a0', { stroke: '#1a0c04', strokeW: 6 });
      text(g, d.desc, 120, y + 40, 21, '#fff1d8', { align: 'left' });
      const packs = Object.keys(JQ.PACK_UNITS).filter((p) => p !== 'custom' && JQ.PACK_UNITS[p].includes(unitSel)).map((p) => JQ.PACKS[p].name);
      [['atk', d.atk], ['hp', d.hp], ['range', d.range], ['rate', d.rate + 's'], ['cd', d.cd + 's']].forEach(([id, v], n) => {
        JQ.statIcon(g, id, 120 + n * 100, y + 66, 32);
        text(g, String(v), 156 + n * 100, y + 83, 18, '#ffe9a0', { align: 'left', font: 'sans-serif' });
      });
      text(g, packs.join(' · ') || '仅自定义', 680, y + 40, 15, '#d8c8a0', { align: 'right', font: 'sans-serif', bold: false });
    }
  }

  // 英雄图鉴：按卡包分页
  let rosterSel = null;
  function drawHeroTile(name, x, y, w, h) {
    const hd = HEROES[name], isMain = name === prog.main, k = pressK(x, y);
    buttons.push({ x, y, w, h, fn: () => (rosterSel = name) });
    g.save();
    g.translate(x + w / 2, y + h / 2);
    g.scale(k, k);
    g.translate(-(x + w / 2), -(y + h / 2));
    card(x, y, w, h, { light: isMain });
    // 突破过/穿皮肤的显示立绘，其余是宣纸字牌（两个字竖排）
    const art = JQ.portraitOf(name) && JQ.portraitDraw(g, name, x + 6, y + 6, w - 12, h - 44, { round: 8 });
    if (!art) {
      const px = x + 8, py = y + 8, pw = w - 16, ph = h - 50;
      JQ.rr(g, px, py, pw, ph, 8);
      const pg = g.createLinearGradient(0, py, 0, py + ph);
      pg.addColorStop(0, '#f6eed8');
      pg.addColorStop(1, '#dccba2');
      g.fillStyle = pg;
      g.fill();
      const cs = Math.min(pw * 0.62, ph * 0.4);
      text(g, hd.chars[0], x + w / 2, py + ph * 0.3, cs, '#2a1608');
      text(g, hd.chars[1], x + w / 2, py + ph * 0.72, cs, '#2a1608');
      // 朱印角标
      JQ.rr(g, px + pw - 30, py + ph - 30, 24, 24, 4);
      g.fillStyle = '#a82818';
      g.fill();
      text(g, hd.chars[0], px + pw - 18, py + ph - 17, 15, '#fff1d8');
    }
    text(g, name, x + w / 2, y + h - 24, 22, isMain ? '#ffe08a' : '#fff1d8', { stroke: '#1a0c04', strokeW: 4 });
    // 职业徽章左上；本命/突破右上
    g.save();
    g.beginPath();
    g.arc(x + 22, y + 22, 16, 0, Math.PI * 2);
    g.fillStyle = 'rgba(30,16,8,0.85)';
    g.fill();
    g.strokeStyle = 'rgba(240,200,120,0.8)';
    g.lineWidth = 1.2;
    g.stroke();
    g.restore();
    JQ.roleIconDraw(g, hd.role, x + 8, y + 8, 28);
    if (isMain) {
      JQ.rr(g, x + w - 52, y + 8, 44, 22, 11);
      g.fillStyle = '#a82818';
      g.fill();
      text(g, '本命', x + w - 30, y + 19, 13, '#fff1d8', { font: 'sans-serif' });
    } else if (ACT.byHero[name]) drawMiniPips(x + w - 42, y + 20, brkOf(name));
    g.restore();
  }
  // 英雄详情：立绘/字牌 + 五项属性条 + 三枚技能徽章（点哪个看哪个，只显示一句话）+ 羁绊成员小字牌
  let detailSk = 2;
  const STAT_MAX = (() => {
    const hs = Object.values(HEROES);
    return { atk: Math.max(...hs.map((h) => h.atk * ((h.passive && h.passive.atkMult) || 1))), hp: Math.max(...hs.map((h) => h.hp)), range: Math.max(...hs.map((h) => h.range)), rate: Math.max(...hs.map((h) => 1 / h.rate)), speed: Math.max(...hs.map((h) => h.speed)) };
  })();
  function statBar(id, label, v, max, x, y, w) {
    JQ.statIcon(g, id, x, y - 20, 40);
    text(g, label, x + 50, y, 18, '#f0e0c0', { align: 'left' });
    const bx = x + 96, bw = w - 96;
    JQ.rr(g, bx, y - 8, bw, 16, 8);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fill();
    JQ.rr(g, bx, y - 8, Math.max(16, bw * Math.min(1, v / max)), 16, 8);
    const grd = g.createLinearGradient(bx, 0, bx + bw, 0);
    grd.addColorStop(0, '#c8501c');
    grd.addColorStop(1, '#ffcf5a');
    g.fillStyle = grd;
    g.fill();
  }
  function tagChip(id, x, y) {
    const name = JQ.TAG_NAME[id] || id, w = 54 + name.length * 18;
    JQ.rr(g, x, y, w, 40, 20);
    g.fillStyle = 'rgba(20,10,4,0.75)';
    g.fill();
    g.strokeStyle = 'rgba(230,190,120,0.6)';
    g.lineWidth = 1.2;
    g.stroke();
    JQ.statIcon(g, id, x + 3, y + 3, 34);
    text(g, name, x + 44, y + 21, 17, '#ffe9a0', { align: 'left' });
    return w;
  }
  function drawHeroDetail(name) {
    const hd = HEROES[name], blv = brkOf(name), bdef = JQ.heroAtBrk(name, blv);
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => (rosterSel = null) });
    veil(0.8);
    const X = 30, Y = pageTop() + 110, W = 660, H = pageBottom() - Y - 6;
    popFrame(X, Y, W, H, name);
    buttons.push({ x: X, y: Y, w: W, h: H, fn: () => {} });
    // 左：立绘（突破/皮肤后）或宣纸字牌
    const bl = JQ.BOND_BY_HERO[name] || [], nb = Math.min(2, bl.length);
    // 立绘高度吃掉多余空间：长屏手机上大图，短屏上缩小
    const ph = Math.max(280, Math.min(460, H - (54 + 34 + 180 + 172 + 70 * nb + 110))), pw = Math.min(270, Math.round(ph * 0.75));
    const px = X + 30, py = Y + 54;
    card(px - 4, py - 4, pw + 8, ph + 8, { r: 14 });
    if (!JQ.portraitDraw(g, name, px, py, pw, ph, { round: 12 })) {
      JQ.rr(g, px, py, pw, ph, 12);
      const pg = g.createLinearGradient(0, py, 0, py + ph);
      pg.addColorStop(0, '#f6eed8');
      pg.addColorStop(1, '#dccba2');
      g.fillStyle = pg;
      g.fill();
      if (ACT.byHero[name]) JQ.drawOrnament(g, name, px + pw / 2, py + ph / 2, 90, { tier: blv, behind: true, preview: blv <= 0 });
      text(g, hd.chars[0], px + pw / 2, py + ph * 0.3, 96, '#2a1608');
      text(g, hd.chars[1], px + pw / 2, py + ph * 0.7, 96, '#2a1608');
      if (ACT.byHero[name]) JQ.drawOrnament(g, name, px + pw / 2, py + ph / 2, 90, { tier: blv, behind: false, preview: blv <= 0 });
    }
    // 右：职业 + 属性条
    const rx = px + pw + 30, rw = X + W - 30 - rx;
    JQ.roleIconDraw(g, hd.role, rx, py, 44);
    text(g, hd.role, rx + 54, py + 23, 24, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
    text(g, JQ.PACKS[hd.pack] ? JQ.PACKS[hd.pack].name : '', rx + rw, py + 23, 18, '#c8b090', { align: 'right' });
    const P = bdef.passive || {};
    const sg = (ph - 80) / 5;
    [['atk', '攻击', bdef.atk * (P.atkMult || 1), STAT_MAX.atk], ['hp', '生命', bdef.hp, STAT_MAX.hp], ['range', '射程', bdef.range, STAT_MAX.range], ['rate', '攻速', 1 / bdef.rate, STAT_MAX.rate], ['speed', '移速', bdef.speed, STAT_MAX.speed]].forEach(([id, l, v, m], i) => statBar(id, l, v, m, rx, py + 70 + sg * (i + 0.5), rw));
    // 中：三枚技能徽章
    const skills = [['被动', passiveTitle(bdef), bdef.passive.desc, JQ.passiveTags(P)], ['技能', bdef.skill.name, bdef.skill.desc, JQ.effectTags(bdef.skill)], ['大招', bdef.ult.name, bdef.ult.desc, JQ.effectTags(bdef.ult)]];
    const my = py + ph + 34, mw = (W - 60) / 3;
    skills.forEach(([tag, nm, , tags], i) => {
      const cx = X + 30 + mw * i + mw / 2, on = detailSk === i, r = 54;
      buttons.push({ x: cx - mw / 2, y: my, w: mw, h: 170, fn: () => ((detailSk = i), sfx('tap')) });
      g.save();
      if (on) (g.shadowColor = '#ffcf5a'), (g.shadowBlur = 18);
      g.beginPath();
      g.arc(cx, my + r + 6, r, 0, Math.PI * 2);
      const grd = g.createRadialGradient(cx, my + r - 10, 6, cx, my + r + 6, r);
      grd.addColorStop(0, on ? '#c0502a' : '#6a3a20');
      grd.addColorStop(1, on ? '#5a160a' : '#2a160a');
      g.fillStyle = grd;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = on ? 4 : 2;
      g.strokeStyle = on ? '#ffe08a' : 'rgba(230,190,120,0.6)';
      g.stroke();
      g.restore();
      JQ.statIcon(g, tags[0] || (i === 0 ? 'aura' : 'aoe'), cx - 34, my + r + 6 - 34, 68);
      JQ.rr(g, cx - 34, my - 4, 68, 26, 13);
      g.fillStyle = i === 2 ? '#a82818' : i === 1 ? '#2f5a6a' : '#6a5a3a';
      g.fill();
      text(g, tag, cx, my + 9, 15, '#fff1d8', { font: 'sans-serif' });
      text(g, nm, cx, my + 2 * r + 36, nm.length > 5 ? 18 : 22, on ? '#ffe08a' : '#e8d8b0', { stroke: '#1a0c04', strokeW: 4 });
    });
    // 选中技能：效果标签 + 一句话
    const [, , desc, tags] = skills[detailSk];
    const dy = my + 180;
    card(X + 30, dy, W - 60, 150, { r: 14 });
    let tx = X + 48;
    tags.forEach((t) => (tx += tagChip(t, tx, dy + 16) + 10));
    wrapLines(desc.replace(/。$/, ''), 26).slice(0, 2).forEach((line, j) => text(g, line, X + 50, dy + 90 + j * 30, 20, '#f0e4c8', { align: 'left', font: 'sans-serif', bold: false }));
    // 羁绊：成员小字牌
    let by = dy + 172;
    const by2 = Y + H - 100;
    bl.slice(0, 2).forEach((b) => {
      if (by + 64 > by2) return;
      text(g, b.name, X + 40, by + 32, 20, '#ffcf5a', { align: 'left' });
      b.heroes.forEach((h, k) => {
        const bx = X + 170 + k * 92;
        if (bx + 84 > X + W - 20) return;
        JQ.rr(g, bx, by + 4, 84, 56, 8);
        g.fillStyle = h === name ? '#ffe7a6' : '#efe3c4';
        g.fill();
        text(g, h, bx + 42, by + 33, h.length > 2 ? 18 : 24, '#2a1608');
      });
      by += 70;
    });
    if (name !== prog.main) button(X + 40, by2 + 18, 280, 66, '设为本命将', () => (setMain(name), sfx('tap')), { on: true, size: 24 });
    button(name !== prog.main ? X + W - 320 : X + W / 2 - 140, by2 + 18, 280, 66, '关 闭', () => (rosterSel = null), { size: 24 });
  }
  function drawRoster() {
    pageFrame('英雄图鉴', 0.85, () => ((helpPage = 0), (screen = helpBack)));
    JQ.preloadUiArt();
    const T = pageTop() + 96, B = pageBottom();
    const tabs = JQ.OPEN_PACKS.concat('bonds');
    segmented(24, T, 672, 52, tabs.map((k) => [k, k === 'bonds' ? '羁绊' : JQ.PACKS[k].name]), helpPack, (k) => (helpPack = k), 19);
    if (helpPack === 'bonds') return drawBondList();
    const roster = (JQ.PACKS[helpPack] && JQ.PACKS[helpPack].heroes) || [];
    if (!roster.length) text(g, '这个卡包还没有配置英雄（自定义卡包点「自定义卡包」选 16 位）', C.W / 2, 300, 20, '#bfb39a', { bold: false });
    text(g, `${JQ.PACKS[helpPack].name} · ${roster.length} 位英雄 · 突破后解锁立绘 · 点卡片看详情`, C.W / 2, T + 76, 15, '#e0d0a8', { font: 'sans-serif', bold: false });
    const top = T + 96, gap = 10, rows = Math.max(1, Math.ceil(roster.length / 4));
    const tw = (672 - gap * 3) / 4, th = Math.min(270, (B - top - gap * (rows - 1)) / rows);
    roster.forEach((name, i) => {
      if (!HEROES[name]) return;
      drawHeroTile(name, 24 + (i % 4) * (tw + gap), top + Math.floor(i / 4) * (th + gap), tw, th);
    });
    if (rosterSel) drawHeroDetail(rosterSel);
  }

  // 羁绊一览：按卡包分组，两列
  function drawBondList() {
    const PN = { sanguo: '三国', xiyou: '西游', tang: '唐朝', song: '宋朝' };
    const packOf = (b) => {
      for (const k of Object.keys(PN)) if (b.heroes.every((h) => JQ.heroInPack(h, k))) return PN[k];
      return '跨包';
    };
    const T = pageTop() + 96, top = T + 96, rows = Math.ceil(JQ.BONDS.length / 2);
    const rh = Math.min(84, (pageBottom() - top) / rows), h = rh - 8;
    text(g, '指定英雄同时在棋盘上合成即生效；跨包羁绊只能在自定义卡包里凑', C.W / 2, T + 76, 15, '#e0d0a8', { font: 'sans-serif', bold: false });
    JQ.BONDS.forEach((b, i) => {
      const x = i % 2 ? 364 : 24, y = top + Math.floor(i / 2) * rh, w = 332;
      card(x, y, w, h, { r: 10 });
      text(g, b.name, x + 10, y + 20, 18, '#ffcf5a', { align: 'left' });
      text(g, packOf(b), x + w - 8, y + 20, 11, '#9a8f7a', { align: 'right', font: 'sans-serif', bold: false });
      text(g, b.heroes.join('、'), x + 112, y + 21, 13, '#f0e4c8', { align: 'left', font: 'sans-serif', bold: false });
      const tl = b.tiers.map((t) => `${t.n}人：${JQ.bondTierText(t)}`).join('  ');
      // 已生效颜色只用米金，避免和等级绿撞色
      let z = 11.5;
      g.font = `${z}px sans-serif`;
      while (z > 8.5 && g.measureText(tl).width > w - 20) (z -= 0.5), (g.font = `${z}px sans-serif`);
      text(g, tl, x + 10, y + h - 16, z, '#d9c79a', { align: 'left', font: 'sans-serif', bold: false });
    });
  }

  function drawPause() {
    veil(0.5);
    popFrame(160, 330, 400, 740, '暂 停');
    button(210, 400, 300, 72, '继续', () => (screen = 'play'), { on: true });
    button(210, 484, 300, 72, '英雄图鉴', () => ((helpBack = 'paused'), (helpPage = 1), (helpPack = game.sides[0].pack), (screen = 'help')));
    button(210, 568, 300, 72, dblSell ? '双击卖卡：开' : '双击卖卡：关', () => {
      dblSell = !dblSell;
      localStorage.setItem('jq_dblsell', dblSell ? '1' : '0');
    }, { size: 30 });
    button(210, 652, 300, 72, muted ? '音效：关' : '音效：开', () => {
      muted = !muted;
      localStorage.setItem('jq_mute', muted ? '1' : '0');
      setMusic();
    }, { size: 30 });
    button(210, 736, 300, 72, skillToast ? '技能弹字：开' : '技能弹字：关', () => {
      skillToast = !skillToast;
      localStorage.setItem('jq_skilltoast', skillToast ? '1' : '0');
      if (game) game.skillToast = skillToast;
    }, { size: 30 });
    button(210, 820, 300, 72, '重新开始', newGame);
    button(210, 904, 300, 72, '返回主页', () => (screen = 'menu'), { red: true });
    button(210, 988, 300, 54, '🏠 返回游戏厅', () => { location.href = '../'; }, { size: 21 });
  }

  // 天赋商店：每赢一局随机刷出 3 条可买；已拥有的在下方装上/卸下（最多 3 条）
  function rollOffers() {
    const left = JQ.TALENTS.filter((t) => !fateSave.owned.includes(t.id)).map((t) => t.id);
    const out = [];
    while (out.length < 3 && left.length) out.push(left.splice(Math.floor(Math.random() * left.length), 1)[0]);
    fateSave.offers = out;
    saveFate();
  }

  const CAT_ICON = { 经济: 'support', 卡池: 'special', 兵种: 'warrior', 英雄: 'commander', 防守: 'tank', 特殊: 'special' };
  function talentSeal(t, x, y, s) {
    JQ.rr(g, x, y, s, s, Math.max(3, s * 0.16));
    g.fillStyle = 'rgba(168,40,26,0.92)';
    g.fill();
    g.strokeStyle = 'rgba(240,200,120,0.8)';
    g.lineWidth = 1;
    g.stroke();
    text(g, t.name[0], x + s / 2, y + s / 2 + 1, s * 0.56, '#fff1d0', { stroke: '#5a0a04', strokeW: 2 });
  }
  function catChip(t, x, y) {
    // 分类签统一墨色，不借用等级色；左边加一个生成的小徽章
    g.save();
    JQ.rr(g, x, y, 52, 22, 9);
    g.fillStyle = '#2a1f16';
    g.fill();
    g.strokeStyle = 'rgba(230,194,122,0.55)';
    g.lineWidth = 1;
    g.stroke();
    if (!JQ.roleIconDraw(g, CAT_ICON[t.cat], x + 1, y + 1, 20)) text(g, t.cat, x + 26, y + 12, 11.5, '#e8d3a8', { align: 'left', font: 'sans-serif' });
    else text(g, t.cat, x + 23, y + 12, 11, '#e8d3a8', { align: 'left', font: 'sans-serif' });
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

  let talentFilter = '全部', talentHelp = false;
  const TALENT_ART = {
    经济: 'talent_economy', 卡池: 'talent_cardpool', 兵种: 'talent_unit',
    英雄: 'talent_hero', 防守: 'talent_defense', 特殊: 'talent_special',
  };
  function talentArt(t, x, y, w, h) {
    if (JQ.assetCover(g, TALENT_ART[t.cat], x, y, w, h)) {
      g.save();
      JQ.rr(g, x, y, w, h, 8);
      g.clip();
      const grd = g.createLinearGradient(0, y + h * 0.45, 0, y + h);
      grd.addColorStop(0, 'rgba(16,10,6,0)');
      grd.addColorStop(1, 'rgba(16,10,6,0.9)');
      g.fillStyle = grd;
      g.fillRect(x, y + h * 0.45, w, h * 0.55);
      g.restore();
    } else {
      const grd = g.createLinearGradient(0, y, 0, y + h);
      grd.addColorStop(0, 'rgba(70,42,16,0.85)');
      grd.addColorStop(1, 'rgba(20,12,8,0.95)');
      JQ.rr(g, x, y, w, h, 8);
      g.fillStyle = grd;
      g.fill();
      JQ.roleIconDraw(g, CAT_ICON[t.cat], x + w / 2 - 28, y + h / 2 - 28, 56);
    }
  }
  function drawTalentHelp() {
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => (talentHelp = false) });
    veil(0.66);
    popFrame(100, 220, 520, 560, '天赋规则');
    buttons.push({ x: 100, y: 220, w: 520, h: 560, fn: () => {} });
    iconBtn(558, 200, 48, '×', () => (talentHelp = false));
    const lines = [
      '每赢一局：金币 + 解锁下一关 + 刷新商店；输一局：12 金币，留在本关。',
      '商店每次刷 3 条随机天赋，已拥有的不再出现。',
      '最多同时装备 3 条；点击已拥有的天赋即可装备 / 卸下。',
      '天赋只在「天命」模式生效。',
    ];
    let y = 330;
    lines.forEach((s) => {
      wrapLines(s, 22).forEach((l) => {
        text(g, l, 140, y, 15, '#e8dcc0', { align: 'left', font: 'sans-serif', bold: false });
        y += 26;
      });
      y += 12;
    });
  }
  function drawTalents() {
    if (!fateSave.offers) rollOffers();
    pageFrame('天 赋', 0.78, () => (screen = 'menu'));
    JQ.preloadUiArt();
    const T = pageTop() + 96, B = pageBottom();
    // 顶部：天命金币 + 当前关 + 规则
    resPill(24, T, 230, (x, y, s2) => JQ.uiDraw(g, 'coin', x + 4, y + 4, s2 - 8, s2 - 8), fateSave.coins, null);
    text(g, '天命金币', 250, T + 21, 13, '#d8c8a0', { align: 'right', font: 'sans-serif', bold: false });
    resPill(270, T, 190, (x, y, s2) => JQ.iconDraw(g, 'stage', x, y, s2, s2), `第 ${fateSave.tier} 关`, null);
    button(560, T - 4, 136, 48, '规则', () => (talentHelp = !talentHelp), { flat: true, size: 19 });
    // 商店：3 张卡，插画为主，名字大，说明最多两行
    const shopY = T + 58, shopH = Math.max(320, Math.min(480, (B - shopY) * 0.42));
    text(g, '商店 · 每赢一局刷新', 24, shopY + 14, 19, '#ffd23f', { align: 'left' });
    const offers = (fateSave.offers || []).map((id) => JQ.TALENT_BY_ID[id]).filter(Boolean);
    if (!offers.length) text(g, '这一批已经买完了，赢下一局再来看看', C.W / 2, shopY + shopH / 2, 20, '#bfb39a', { bold: false });
    offers.forEach((t, i) => {
      const x = 24 + i * 228, y = shopY + 32, w = 216, h = shopH - 32;
      const can = fateSave.coins >= t.cost;
      card(x, y, w, h, { r: 14 });
      const ah = h * 0.42;
      talentArt(t, x + 4, y + 4, w - 8, ah);
      catChip(t, x + 10, y + 10);
      text(g, t.name, x + w / 2, y + ah + 34, 28, '#ffe9a0', { stroke: '#1a0c04', strokeW: 4 });
      wrapLines(t.desc, 11).slice(0, 2).forEach((l, k) => text(g, l, x + w / 2, y + ah + 70 + k * 24, 16, '#e8d8b0', { bold: false, font: 'sans-serif' }));
      button(x + 14, y + h - 62, w - 28, 50, can ? `${t.cost} 金币` : `差 ${t.cost - fateSave.coins}`, () => buyTalent(t), { on: can, disabled: !can, size: 22 });
    });
    // 已装备：三个大槽位
    const eqY = shopY + shopH + 18;
    text(g, `已装备 ${fateSave.equipped.length}/${JQ.MAX_TALENTS}`, 24, eqY + 14, 19, '#ffd23f', { align: 'left' });
    for (let i = 0; i < JQ.MAX_TALENTS; i++) {
      const x = 24 + i * 228, y = eqY + 32, w = 216, h = 92;
      const t = JQ.TALENT_BY_ID[fateSave.equipped[i]];
      if (!t) {
        card(x, y, w, h, { dim: true, r: 14 });
        text(g, '＋', x + w / 2, y + h / 2 - 6, 34, 'rgba(240,200,120,0.4)', { font: 'sans-serif' });
        text(g, '点下方天赋装备', x + w / 2, y + h - 16, 13, '#8a806c', { font: 'sans-serif', bold: false });
        continue;
      }
      buttons.push({ x, y, w, h, fn: () => toggleEquip(t) });
      card(x, y, w, h, { r: 14, light: true });
      talentArt(t, x + 4, y + 4, 84, h - 8);
      text(g, t.name, x + 100, y + 40, 21, '#ffe08a', { align: 'left' });
      text(g, '点击卸下', x + 100, y + 66, 13, '#c8b090', { align: 'left', font: 'sans-serif', bold: false });
    }
    // 已拥有：分类标签 + 插画小卡
    const ownY = eqY + 140, owned = fateSave.owned.map((id) => JQ.TALENT_BY_ID[id]).filter(Boolean);
    const cats = ['全部', '经济', '卡池', '兵种', '英雄', '防守', '特殊'];
    segmented(24, ownY, 672, 46, cats.map((c) => [c, c]), talentFilter, (c) => (talentFilter = c), 16);
    const shown = owned.filter((t) => talentFilter === '全部' || t.cat === talentFilter);
    const gy = ownY + 58, avail = B - gy;
    if (!shown.length) {
      // 空状态：六类插画大卡，告诉玩家能收集什么
      const cs = ['经济', '卡池', '兵种', '英雄', '防守', '特殊'], th = Math.min(240, (avail - 44) / 2);
      cs.forEach((c, i) => {
        const x = 24 + (i % 3) * 228, y = gy + Math.floor(i / 3) * (th + 10);
        card(x, y, 216, th, { dim: true, r: 14 });
        talentArt({ cat: c }, x + 4, y + 4, 208, th - 8);
        text(g, c, x + 108, y + th - 26, 22, '#ffe9a0', { stroke: '#1a0c04', strokeW: 4 });
      });
      text(g, owned.length ? '这个分类还没有天赋' : `还没有天赋 · 共 ${JQ.TALENTS.length} 条可收集`, C.W / 2, Math.min(B - 10, gy + 2 * th + 34), 16, '#c8b090', { font: 'sans-serif', bold: false });
    }
    const rh = 76;
    shown.forEach((t, i) => {
      const x = 24 + (i % 3) * 228, y = gy + Math.floor(i / 3) * (rh + 8);
      if (y + rh > B) return;
      const on = fateSave.equipped.includes(t.id);
      buttons.push({ x, y, w: 216, h: rh, fn: () => toggleEquip(t) });
      card(x, y, 216, rh, { r: 12, light: on });
      talentArt(t, x + 4, y + 4, 68, rh - 8);
      text(g, t.name, x + 82, y + rh / 2 + 1, t.name.length > 4 ? 17 : 20, on ? '#ffe08a' : '#f5ead0', { align: 'left' });
      if (on) (JQ.rr(g, x, y, 216, rh, 12), (g.strokeStyle = '#ffe08a'), (g.lineWidth = 2.5), g.stroke());
    });
    if (talentHelp) drawTalentHelp();
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
  let overH = 0;
  function drawOver() {
    const k = (performance.now() - overAt) / 1000;
    const w = game.winner;
    const staged = game.modeKey === 'classic' || game.modeKey === 'fate';
    const act = game.modeKey === 'breakthrough' ? actStageOf(game.activity) : null;
    const win = game.R.waves ? true : w === 0;
    const rw = lastReward, pg = lastProg, mv = lastMvp;
    veil(Math.min(0.5, k * 1.5));
    const px = 50, py = 150, pw = 620, ph = overH || 930; // 面板高度用上一帧量出的内容高度，底下不留空
    // 赢：背后金色光芒慢转 + 花瓣飘落
    JQ.fxBudgetReset();
    if (win && !JQ.fxSprite(g, 'rays', C.W / 2, py + 30, 820, 1093, Math.min(0.85, k * 1.2), k * 0.2)) {
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
    const word = game.R.waves ? '守关' : w === 0 ? (act ? '破阵' : staged ? '通关' : '突围') : w === 1 ? '败北' : '平局';
    const sk = Math.min(1, k / 0.35), sc = 1 + 1.4 * (1 - JQ.ease(sk));
    g.save();
    g.translate(C.W / 2 + (sk < 1 ? 0 : Math.sin(k * 60) * Math.max(0, 0.5 - k) * 6), py + 12);
    g.rotate(-0.05);
    g.scale(sc, sc);
    g.globalAlpha = Math.min(1, k * 4);
    const sealSp = JQ.ui2Draw(g, win || w !== 1 ? 'seal_red' : 'seal_gray', -78, -74, 156, 154);
    if (!sealSp) {
      JQ.rr(g, -112, -48, 224, 96, 14);
      g.fillStyle = win ? '#a8281a' : w === 1 ? '#4a4a4a' : '#6a5a3a';
      g.fill();
      g.strokeStyle = '#f2d9a0';
      g.lineWidth = 3;
      g.stroke();
    }
    text(g, word, 0, 4, sealSp ? 50 : 56, '#fff1d0', { stroke: win ? '#5a0a04' : '#1a1a1a', strokeW: 4 });
    if (w === 1 && !sealSp) {
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
    let y = py + 100;
    if (staged && win && pg) {
      for (let i = 0; i < 3; i++) {
        const t0 = 0.45 + i * 0.22, kk = Math.max(0, Math.min(1, (k - t0) / 0.25));
        const lit = i < pg.stars && kk > 0;
        g.save();
        g.translate(C.W / 2 + (i - 1) * 64, y + 22 - (i === 1 ? 8 : 0));
        const s2 = lit ? 1 + 0.6 * (1 - JQ.ease(kk)) : 1;
        g.scale(s2, s2);
        if (!JQ.ui2Draw(g, lit ? 'star_on' : 'star_off', -30, -29, 60, 57)) starShape(0, 0, 24, lit ? '#ffd23f' : 'rgba(80,70,60,0.8)', lit ? '#8a5a10' : 'rgba(160,140,110,0.5)');
        g.restore();
      }
      if (pg.newStars && k > 1.2) text(g, `新星 +${pg.newStars}`, C.W / 2 + 140, y + 24, 14, '#ffd23f', { font: 'sans-serif' });
      y += 54;
    } else y += 10;
    const sub = game.R.waves ? `守住 ${Math.max(0, game.wave - 1)} 波 · 最佳 ${rec(game.modeKey).best} 波` : act ? `突破活动 · ${act.name} · ${act.hero}` : staged ? `第 ${game.stage} 关` : game.mode.name;
    text(g, sub, C.W / 2, y + 12, 28, '#ffe9a0', { stroke: '#2a1a08', strokeW: 4 });
    const t = Math.floor(game.time);
    text(g, `${game.mode.name} · ${game.diff.name} · 用时 ${Math.floor(t / 60)}分${t % 60}秒`, C.W / 2, y + 42, 14, '#bfa878', { font: 'sans-serif', bold: false });
    y += 62;
    const roll = (v) => Math.round(v * Math.max(0, Math.min(1, (k - 0.3) / 0.8)));
    // MVP：字牌 + 输出大数字 + 占比条
    if (mv && (mv.hero || mv.unit)) {
      const mvp = (x, item, tag) => {
        if (!item) return;
        card(x, y, 260, 96, { r: 14 });
        paperTile(item.key, x + 10, y + 10, 76, 76, { on: tag === 'MVP' });
        JQ.rr(g, x + 96, y + 10, 64, 24, 12);
        g.fillStyle = tag === 'MVP' ? '#a82818' : '#5a3a14';
        g.fill();
        text(g, tag, x + 128, y + 22, 13, '#fff1d8', { font: 'sans-serif' });
        text(g, roll(item.dmg).toLocaleString(), x + 96, y + 56, 26, '#ffe9a0', { align: 'left', font: 'sans-serif', stroke: '#1a0c04', strokeW: 3 });
        const f = item.dmg / mv.total;
        JQ.rr(g, x + 96, y + 74, 150, 10, 5);
        g.fillStyle = 'rgba(0,0,0,0.45)';
        g.fill();
        JQ.rr(g, x + 96, y + 74, Math.max(10, 150 * f), 10, 5);
        g.fillStyle = '#e6b04a';
        g.fill();
      };
      mvp(px + 40, mv.hero, 'MVP');
      mvp(px + 320, mv.unit, '最强兵');
      y += 112;
    }
    // 我/敌 对比条：左侧图标代替文字标签
    const A = game.sides[0].stats, B = game.sides[1].stats;
    [
      ['summon', A.summoned, B.summoned],
      ['atk', A.kills, B.kills],
      ['buff', A.heroes, B.heroes],
      ['fire', Math.round(A.baseDmg), Math.round(B.baseDmg)],
    ].forEach(([id, x0, y0], i) => {
      const ry = y + i * 44, tot = Math.max(1, x0 + y0), half = 180, cx = C.W / 2 + 20;
      const kk = Math.max(0, Math.min(1, (k - 0.3 - i * 0.08) / 0.6));
      JQ.statIcon(g, id, px + 40, ry - 2, 36);
      g.save();
      JQ.rr(g, cx - half, ry + 8, half * 2, 16, 8);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fill();
      g.fillStyle = '#3d8bff';
      const wa = ((half * x0) / tot) * kk, wb = ((half * y0) / tot) * kk;
      if (wa > 1) (JQ.rr(g, cx - wa, ry + 8, wa, 16, 8), g.fill());
      g.fillStyle = '#e0503a';
      if (wb > 1) (JQ.rr(g, cx, ry + 8, wb, 16, 8), g.fill());
      g.restore();
      text(g, String(roll(x0)), cx - half - 8, ry + 17, 19, '#cfe6ff', { align: 'right', font: 'sans-serif' });
      text(g, String(roll(y0)), cx + half + 8, ry + 17, 19, '#ffd2c8', { align: 'left', font: 'sans-serif' });
    });
    y += 4 * 44 + 10;
    // 奖励：一排奖励格（图标 + 大数字），不再写成长句
    if (pg) {
      const items = [['xp', `+${pg.xp}`], ['coin', `+${roll(pg.coins)}`]];
      if (pg.tokens) items.push(['token', `+${pg.tokens}`]);
      if (rw && rw.act && rw.act.win) items.push(['stone', `+${roll(rw.act.stone)}`], ['seal', `+${roll(rw.act.seal)}`]);
      if (pg.chest) items.push(['chest', `×${pg.chest}`]);
      if (rw && rw.coins) items.push(['gold', `+${rw.coins}`]);
      const n = Math.min(5, items.length), iw = Math.min(104, (pw - 80 - (n - 1) * 10) / n), ix0 = C.W / 2 - (n * iw + (n - 1) * 10) / 2;
      items.slice(0, 5).forEach(([id, v], i) => {
        const x = ix0 + i * (iw + 10), pop = Math.max(0, Math.min(1, (k - 0.8 - i * 0.12) / 0.25));
        if (pop <= 0) return;
        card(x, y, iw, 104, { r: 12, light: true });
        const is = 50, ix = x + iw / 2 - is / 2, iy = y + 8;
        if (id === 'xp') JQ.ui2Draw(g, 'badge', ix + 6, iy, 38, 44);
        else if (id === 'coin' || id === 'gold') JQ.uiDraw(g, 'coin', ix + 4, iy + 4, is - 8, is - 8);
        else if (id === 'token') qxIcon(ix, iy, is);
        else if (id === 'stone') JQ.iconDraw(g, 'stone', ix, iy, is, is) || actStoneIcon(ix, iy, is);
        else if (id === 'seal') actPortraitCircle(rw.act.hero, ix, iy, is);
        else if (id === 'chest') JQ.ui2Draw(g, 'chest_open', ix, iy, is, is);
        text(g, v, x + iw / 2, y + 82, 22, '#ffe08a', { font: 'sans-serif', stroke: '#1a0c04', strokeW: 3 });
      });
      y += 116;
      // 主公经验条 + 本命将状态（一行）
      const xpK = Math.max(0, Math.min(1, (k - 0.8) / 0.8));
      text(g, `主公 Lv${prog.lv}${pg.lvUps ? ' ↑' : ''}`, px + 40, y + 12, 18, pg.lvUps ? '#ffd23f' : '#ffe9a0', { align: 'left' });
      JQ.rr(g, px + 170, y + 5, 230, 14, 7);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fill();
      JQ.rr(g, px + 170, y + 5, Math.max(14, 230 * (prog.xp / lvNeed(prog.lv)) * xpK), 14, 7);
      g.fillStyle = '#e6b04a';
      g.fill();
      if (prog.main) {
        const lv = heroLvOf(prog.main), can = lv < heroCap(prog.main) && prog.coins >= upCost(lv);
        text(g, `${prog.main} Lv${lv}${can ? ' 可升级' : ''}`, px + pw - 40, y + 12, 17, can ? '#ffd23f' : '#d8c8a0', { align: 'right' });
        if (can) redDot(px + pw - 30, y - 2, 7);
      }
      y += 34;
    }
    if (!win && w === 1 && k > 1) text(g, tipOnLose(), C.W / 2, y + 4, 16, '#f0c0a0', { font: 'sans-serif', bold: false });
    y += 20;
    const canNext = rw && rw.win && !rw.max && staged;
    button(110, y, 500, 84, act ? '再 战' : canNext ? `下一关 · 第 ${rw.next} 关` : staged ? `重试第 ${game.stage} 关` : '再来一局', () => {
      if (canNext) setStage(rw.next);
      newGame();
    }, { on: true, size: canNext ? 32 : 34 });
    const sec = [];
    if (act) sec.push(['返回活动', () => openActivity('stage')]);
    else if (staged) sec.push(['选 关', () => openStages()]);
    if (game.modeKey === 'fate') sec.push(['天赋商店', () => (screen = 'talents')]);
    sec.push(['返回主页', () => (screen = 'menu')]);
    const sw = (500 - (sec.length - 1) * 14) / sec.length;
    sec.forEach(([label, fn], i) => button(110 + i * (sw + 14), y + 98, sw, 60, label, fn, { size: 22 }));
    overH = y + 98 + 60 + 44 - py;
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

  // ---------- 本命将页 ----------
  let mainTab = null, mainFxAt = 0;
  function openMainHero() {
    const p = prog.main ? HEROES[prog.main].pack : pack;
    mainTab = JQ.PACKS[p] && JQ.PACKS[p].open ? p : 'sanguo';
    JQ.preloadUiArt();
    screen = 'mainhero';
  }
  // 宣纸字牌（没有立绘时的英雄卡面）
  function paperTile(name, x, y, w, h, opts) {
    opts = opts || {};
    JQ.rr(g, x, y, w, h, opts.r || 10);
    const pg = g.createLinearGradient(0, y, 0, y + h);
    pg.addColorStop(0, opts.on ? '#fff3c4' : '#f6eed8');
    pg.addColorStop(1, opts.on ? '#e8b850' : '#dccba2');
    g.fillStyle = pg;
    g.fill();
    if (opts.on) (g.strokeStyle = '#a82818'), (g.lineWidth = 3), g.stroke();
    const hd = HEROES[name];
    if (opts.vertical) {
      const cs = Math.min(w * 0.62, h * 0.38);
      text(g, hd.chars[0], x + w / 2, y + h * 0.3, cs, '#2a1608');
      text(g, hd.chars[1], x + w / 2, y + h * 0.7, cs, '#2a1608');
    } else text(g, name, x + w / 2, y + h / 2 + 1, Math.min(h * 0.46, (w * 0.84) / name.length), '#2a1608');
  }
  // 本命将：上半是大卡 + 等级 + 加成大数字 + 升级；下半按卡包选将（字牌网格铺满）
  function drawMainHero() {
    JQ.drawBackdrop(g);
    pageFrame('本命将', 0.78, () => (screen = 'menu'));
    const now = performance.now(), T = pageTop() + 96, B = pageBottom();
    resPill(470, T, 226, (x, y, s2) => JQ.uiDraw(g, 'coin', x + 4, y + 4, s2 - 8, s2 - 8), prog.coins, null);
    const name = prog.main;
    const cy = T + 56, chH = Math.round(Math.min(470, Math.max(380, (B - cy - 72) * 0.5)));
    if (!name) {
      card(24, cy, 672, chH, { r: 16 });
      text(g, '挑一位本命将', C.W / 2, cy + 60, 34, '#ffe9a0', { stroke: '#1a0c04', strokeW: 5 });
      [['atk', '每级 +3%'], ['hp', '出战生效'], ['summon', '易刷到字']].forEach(([id, l], i) => {
        const x = 70 + i * 205;
        JQ.statIcon(g, id, x + 50, cy + 120, 86);
        text(g, l, x + 93, cy + 246, 21, '#f0e0c0');
      });
      text(g, '在下面点一位英雄', C.W / 2, cy + 320, 18, '#c8b090', { font: 'sans-serif', bold: false });
    } else {
      const h = HEROES[name], lv = heroLvOf(name), cap = heroCap(name);
      card(24, cy, 672, chH, { r: 16 });
      const fxk = Math.min(1, (now - mainFxAt) / 700), sc = fxk < 1 ? 1 + 0.06 * Math.sin(fxk * Math.PI) : 1;
      const pw = 250, ph = chH - 30, px = 40, py = cy + 15;
      g.save();
      g.translate(px + pw / 2, py + ph / 2);
      g.scale(sc, sc);
      g.translate(-(px + pw / 2), -(py + ph / 2));
      if (!JQ.portraitDraw(g, name, px, py, pw, ph, { round: 12 })) {
        paperTile(name, px, py, pw, ph, { vertical: true, r: 12 });
        if (ACT.byHero[name]) (JQ.drawOrnament(g, name, px + pw / 2, py + ph / 2, 90, { tier: brkOf(name), behind: false, preview: brkOf(name) <= 0 }));
      }
      g.restore();
      if (fxk < 1) JQ.fxSprite(g, 'sparkle', px + pw / 2, py + ph / 2, 300, 380, (1 - fxk) * 1.3, fxk * 2);
      const rx = px + pw + 30;
      text(g, name, rx, cy + 52, 44, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
      JQ.roleIconDraw(g, h.role, rx, cy + 80, 36);
      text(g, h.role, rx + 44, cy + 99, 20, '#e6c88a', { align: 'left' });
      // 等级：大号数字 + 进度条
      text(g, `Lv ${lv}`, rx, cy + 162, 46, '#fff3d6', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
      text(g, `/ ${cap}`, rx + 130, cy + 168, 22, '#c8b090', { align: 'left' });
      JQ.rr(g, rx, cy + 188, 360, 14, 7);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();
      JQ.rr(g, rx, cy + 188, Math.max(14, (360 * lv) / cap), 14, 7);
      g.fillStyle = '#e6b04a';
      g.fill();
      // 加成：攻击/生命两个图标 + 大数字
      const cur = Math.round(mainBonus(lv) * 100);
      [['atk', cur], ['hp', cur]].forEach(([id, v], i) => {
        JQ.statIcon(g, id, rx + i * 180, cy + 220, 48);
        text(g, `+${v}%`, rx + 56 + i * 180, cy + 246, 30, '#ffd23f', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
      });
      const full = lv >= cap, cost = upCost(lv), can = !full && prog.coins >= cost, canBrk = full && !!ACT.byHero[name] && brkOf(name) < 3;
      button(rx, cy + 290, 370, 72, full ? (canBrk ? '去突破 · 上限 +10' : '已达上限') : `升级  ${cost} 铜钱`, () => {
        if (full) return canBrk ? ((actHero = name), openActivity('brk')) : sfx('bad');
        if (upgradeMain()) (mainFxAt = performance.now()), sfx('merge'), buzz(18);
        else sfx('bad');
      }, { on: can || canBrk, disabled: full && !canBrk, size: 26 });
      if (!full && !can) redDotless(rx + 185, cy + 376, `还差 ${cost - prog.coins} 铜钱`);
    }
    // 选将：卡包标签 + 字牌网格
    const ty = cy + chH + 22;
    const tabs = ['sanguo', 'xiyou', 'tang', 'song', 'custom'];
    segmented(24, ty, 672, 50, tabs.map((k) => [k, k === 'custom' ? '自定义' : JQ.PACKS[k].name]), mainTab, (k) => (mainTab = k), 19);
    const list = (JQ.PACKS[mainTab] && JQ.PACKS[mainTab].heroes) || [];
    const gy = ty + 64, rows = Math.max(1, Math.ceil(list.length / 4)), gap = 10;
    const tw = (672 - gap * 3) / 4, th = Math.min(170, (B - gy - gap * (rows - 1)) / rows);
    list.forEach((n, i) => {
      const x = 24 + (i % 4) * (tw + gap), y = gy + Math.floor(i / 4) * (th + gap), on = n === prog.main, k = pressK(x, y);
      buttons.push({ x, y, w: tw, h: th, fn: () => (setMain(n), (mainFxAt = performance.now()), sfx('tap')) });
      g.save();
      g.translate(x + tw / 2, y + th / 2);
      g.scale(k, k);
      g.translate(-(x + tw / 2), -(y + th / 2));
      paperTile(n, x, y, tw, th, { on });
      const lv = heroLvOf(n);
      if (lv > 1) (JQ.rr(g, x + tw - 52, y + 6, 46, 24, 12), (g.fillStyle = '#a82818'), g.fill(), text(g, 'Lv' + lv, x + tw - 29, y + 18, 13, '#fff1d8', { font: 'sans-serif' }));
      if (ACT.byHero[n]) drawMiniPips(x + 14, y + th - 14, brkOf(n));
      g.restore();
    });
  }
  function redDotless(x, y, s2) {
    text(g, s2, x, y, 15, '#e8a060', { font: 'sans-serif', bold: false });
  }

  // ---------- 突破活动页 ----------
  function actStoneIcon(x, y, s) {
    g.save();
    g.translate(x + s / 2, y + s / 2);
    g.beginPath();
    g.moveTo(0, -s * 0.42);
    g.lineTo(s * 0.42, -s * 0.08);
    g.lineTo(s * 0.3, s * 0.42);
    g.lineTo(-s * 0.3, s * 0.42);
    g.lineTo(-s * 0.42, -s * 0.08);
    g.closePath();
    g.fillStyle = '#8a93a0';
    g.fill();
    g.strokeStyle = '#f0cf84';
    g.lineWidth = 1.6;
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.28)';
    g.beginPath();
    g.moveTo(-s * 0.15, -s * 0.28);
    g.lineTo(s * 0.16, -s * 0.12);
    g.lineTo(0, s * 0.02);
    g.closePath();
    g.fill();
    g.restore();
  }
  function actSealIcon(hero, x, y, s) {
    JQ.rr(g, x, y, s, s, Math.max(4, s * 0.16));
    g.fillStyle = '#a8281a';
    g.fill();
    g.strokeStyle = '#f0c878';
    g.lineWidth = Math.max(1, s * 0.04);
    g.stroke();
    text(g, hero[0], x + s / 2, y + s / 2 + 1, s * 0.55, '#fff1d0', { stroke: '#5a0a04', strokeW: 2 });
  }
  function drawActResources() {
    const y = pageTop() + 96;
    resPill(24, y, 160, (x, yy, s2) => JQ.iconDraw(g, 'stone', x, yy, s2, s2) || actStoneIcon(x + 4, yy + 4, s2 - 8), prog.act.stone, null);
    ACT.heroes.forEach((h, i) => {
      const x = 196 + i * 168;
      resPill(x, y, 156, (xx, yy, s2) => actPortraitCircle(h, xx, yy, s2), prog.act.seal[h] || 0, null);
      text(g, ACT.byHero[h].seal, x + 150, y + 21, 13, '#d8c8a0', { align: 'right', font: 'sans-serif', bold: false });
    });
  }
  // 奖励：图标 + ×N（不写“破阵石×4 将印×3”这种长句）
  function rewardIcons(x, y, stone, seal, hero, s2) {
    s2 = s2 || 34;
    let cx = x;
    if (stone) (JQ.iconDraw(g, 'stone', cx, y, s2, s2) || actStoneIcon(cx, y, s2), text(g, '×' + stone, cx + s2 + 2, y + s2 / 2 + 1, s2 * 0.58, '#ffe9a0', { align: 'left', font: 'sans-serif', stroke: '#1a0c04', strokeW: 3 }), (cx += s2 + 50));
    if (seal) (actPortraitCircle(hero, cx, y, s2), text(g, '×' + seal, cx + s2 + 2, y + s2 / 2 + 1, s2 * 0.58, '#ffe9a0', { align: 'left', font: 'sans-serif', stroke: '#1a0c04', strokeW: 3 }), (cx += s2 + 50));
    return cx - x;
  }
  function actHeroCard(name, x, y, w, h, tier) {
    if (!JQ.ui9(g, 'card', x, y, w, h, 34, 20)) panel(x, y, w, h, '#f3ead3', '#6a4a20', 3);
    const cx = x + w / 2, cy = y + h / 2, ch = Math.min(w, h) * 0.3;
    JQ.drawOrnament(g, name, cx, cy, Math.min(w, h) * 0.46, { tier, behind: true, preview: tier <= 0 });
    text(g, HEROES[name].chars[0], cx, cy - ch * 0.52, ch, '#2a1a08');
    text(g, HEROES[name].chars[1], cx, cy + ch * 0.52, ch, '#2a1a08');
    JQ.drawOrnament(g, name, cx, cy, Math.min(w, h) * 0.46, { tier, behind: false, preview: tier <= 0 });
  }
  // 活动英雄立绘卡：立绘铺满 + 底部渐变 + 名字/突破星；没有立绘时退回字卡
  function actPortraitCard(hero, x, y, w, h, tier, opts) {
    opts = opts || {};
    const r = opts.round == null ? 12 : opts.round;
    if (!JQ.portraitDraw(g, hero, x, y, w, h, { round: r, preview: true })) {
      actHeroCard(hero, x, y, w, h, tier);
      return false;
    }
    g.save();
    JQ.rr(g, x, y, w, h, r);
    g.strokeStyle = tier > 0 ? 'rgba(255,207,90,0.9)' : 'rgba(230,194,122,0.55)';
    g.lineWidth = tier > 0 ? 2.5 : 1.5;
    g.stroke();
    // 底部压暗，名字可读
    JQ.rr(g, x, y, w, h, r);
    g.clip();
    const grd = g.createLinearGradient(0, y + h * 0.52, 0, y + h);
    grd.addColorStop(0, 'rgba(18,12,8,0)');
    grd.addColorStop(0.62, 'rgba(18,12,8,0.72)');
    grd.addColorStop(1, 'rgba(18,12,8,0.96)');
    g.fillStyle = grd;
    g.fillRect(x, y + h * 0.5, w, h * 0.5);
    g.restore();
    text(g, hero, x + 12, y + h - (opts.label ? 42 : 20), Math.min(30, w * 0.13), '#ffe9a0', { align: 'left', stroke: '#1a1008', strokeW: 4 });
    if (opts.label) text(g, opts.label, x + 12, y + h - 20, 11, '#e8c27a', { align: 'left', font: 'sans-serif', bold: false });
    if (tier > 0 && w >= 150) drawActPips(x + w - 78, y + h - 22, tier);
    // 左上角小字牌：保留“字 + 字饰”的识别
    if (w >= 180) {
      const bw = Math.min(74, w * 0.34);
      g.save();
      g.globalAlpha = 0.94;
      JQ.rr(g, x + 10, y + 10, bw, bw, 8);
      g.fillStyle = 'rgba(243,234,211,0.92)';
      g.fill();
      g.strokeStyle = 'rgba(120,80,30,0.7)';
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
      const cx = x + 10 + bw / 2, cy = y + 10 + bw / 2;
      JQ.drawOrnament(g, hero, cx, cy, bw * 0.4, { tier, behind: true, preview: tier <= 0 });
      text(g, HEROES[hero].chars[0], cx, cy - bw * 0.16, bw * 0.34, '#2a1a08');
      text(g, HEROES[hero].chars[1], cx, cy + bw * 0.2, bw * 0.34, '#2a1a08');
      JQ.drawOrnament(g, hero, cx, cy, bw * 0.4, { tier, behind: false, preview: tier <= 0 });
    }
    return true;
  }
  function actPortraitCircle(hero, x, y, s) {
    if (!JQ.portraitDraw(g, hero, x, y, s, s, { round: s / 2, preview: true })) {
      actSealIcon(hero, x, y, s);
      return;
    }
    g.save();
    g.beginPath();
    g.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(240,200,120,0.9)';
    g.lineWidth = 1.5;
    g.stroke();
    g.restore();
  }
  function drawMiniPips(x, y, lv) {
    for (let i = 0; i < 3; i++) {
      const done = i < lv;
      g.save();
      g.translate(x + i * 12, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = done ? '#ffcf5a' : 'rgba(20,12,8,0.7)';
      g.fillRect(-4, -4, 8, 8);
      g.strokeStyle = done ? '#fff0b0' : 'rgba(240,200,120,0.55)';
      g.lineWidth = 1;
      g.strokeRect(-4, -4, 8, 8);
      g.restore();
    }
  }
  function drawActPips(x, y, lv) {
    for (let i = 0; i < 3; i++) {
      const cx = x + i * 34, done = i < lv, next = i === lv;
      g.save();
      g.translate(cx, y);
      g.rotate(Math.PI / 4);
      g.fillStyle = done ? '#ffcf5a' : next ? 'rgba(255,207,90,0.28)' : 'rgba(40,30,20,0.45)';
      g.fillRect(-9, -9, 18, 18);
      g.strokeStyle = done || next ? '#ffe9a0' : 'rgba(200,170,120,0.4)';
      g.lineWidth = 1.5;
      g.strokeRect(-9, -9, 18, 18);
      g.restore();
    }
  }
  function drawActBreak() {
    const b = ACT.byHero[actHero], lv = brkOf(actHero), Y0 = pageTop() + 220, B = pageBottom();
    // 三位英雄切换
    ACT.heroes.forEach((n, i) => {
      const x = 24 + i * 228, y = Y0, w = 216, h = 64, on = actHero === n;
      buttons.push({ x, y, w, h, fn: () => ((actHero = n), (brkSel = Math.min(2, brkOf(n)))) });
      card(x, y, w, h, { on, r: 14 });
      actPortraitCircle(n, x + 8, y + 7, 50);
      text(g, n, x + 68, y + 26, 22, on ? '#3a2008' : '#ffe9a0', { align: 'left' });
      drawMiniPips(x + 72, y + 48, brkOf(n));
    });
    // 立绘大卡 + 右侧：等级上限 / 属性 两个大数字 + 材料 + 突破按钮
    const cy = Y0 + 80, ch = Math.min(380, Math.max(300, (B - cy) * 0.42)), pw = Math.round(ch * 0.75);
    actPortraitCard(actHero, 24, cy, pw, ch, lv, { label: `字饰 · ${b.ornName}` });
    if (lv === 0) {
      JQ.rr(g, 24, cy + ch - 92, pw, 34, 0);
      g.fillStyle = 'rgba(168,40,24,0.9)';
      g.fill();
      text(g, '一突解锁立绘', 24 + pw / 2, cy + ch - 74, 16, '#fff1d8');
    }
    const rx = 24 + pw + 20, rw = 696 - rx, def = JQ.heroAtBrk(actHero, lv), base = HEROES[actHero];
    card(rx, cy, rw, ch, { r: 16 });
    text(g, `突破 ${lv}/3`, rx + 20, cy + 40, 30, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
    drawActPips(rx + rw - 100, cy + 38, lv);
    [['cd', `Lv${20 + 10 * lv}`, '上限'], ['atk', `+${Math.round((def.atk / base.atk - 1) * 100)}%`, '攻/血']].forEach(([id, v, l], i) => {
      const x = rx + 20 + i * (rw / 2 - 10);
      JQ.statIcon(g, id, x, cy + 70, 46);
      text(g, v, x + 54, cy + 90, 26, '#ffd23f', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
      text(g, l, x + 54, cy + 114, 14, '#c8b090', { align: 'left', font: 'sans-serif', bold: false });
    });
    if (lv < 3) {
      const L = b.levels[lv], cost = JQ.brkCost(actHero, lv);
      text(g, L.title, rx + 20, cy + 162, 24, '#fff3d6', { align: 'left' });
      const okS = (prog.act.stone || 0) >= cost.stone, okL = (prog.act.seal[actHero] || 0) >= cost.seal;
      JQ.iconDraw(g, 'stone', rx + 20, cy + 186, 40, 40) || actStoneIcon(rx + 20, cy + 186, 40);
      text(g, `${prog.act.stone || 0}/${cost.stone}`, rx + 66, cy + 207, 19, okS ? '#ffe9a0' : '#ff8a6a', { align: 'left', font: 'sans-serif' });
      actPortraitCircle(actHero, rx + rw / 2, cy + 186, 40);
      text(g, `${prog.act.seal[actHero] || 0}/${cost.seal}`, rx + rw / 2 + 46, cy + 207, 19, okL ? '#ffe9a0' : '#ff8a6a', { align: 'left', font: 'sans-serif' });
      const can = okS && okL;
      button(rx + 16, cy + ch - 84, rw - 32, 70, can ? '突 破' : '去活动关拿材料 ›', () => (can ? doBreakthrough(actHero) : (actTab = 'stage')), { on: can, size: can ? 30 : 20 });
    } else {
      text(g, '三突圆满', rx + 20, cy + 170, 28, '#ffd23f', { align: 'left' });
      button(rx + 16, cy + ch - 84, rw - 32, 70, '已 满 突', () => sfx('bad'), { disabled: true, size: 26 });
    }
    // 突破路线：三颗大节点 + 选中节点的效果卡（图标标签 + 一句话）
    const ry = cy + ch + 30, avail = B - ry, R = Math.min(70, avail * 0.16), ys = ry + R + 6, xs = [140, 360, 580];
    for (let i = 0; i < 2; i++) {
      g.save();
      g.strokeStyle = i < lv ? 'rgba(255,207,90,0.95)' : 'rgba(180,150,100,0.35)';
      g.lineWidth = i < lv ? 6 : 3;
      g.beginPath();
      g.moveTo(xs[i] + R, ys);
      g.lineTo(xs[i + 1] - R, ys);
      g.stroke();
      g.restore();
    }
    for (let i = 0; i < 3; i++) {
      const L = b.levels[i], x = xs[i], done = i < lv, next = i === lv, sel = i === brkSel;
      buttons.push({ x: x - R, y: ys - R, w: 2 * R, h: 2 * R + 40, fn: () => (brkSel = i) });
      g.save();
      if (sel) (g.shadowColor = '#ffcf5a'), (g.shadowBlur = 18);
      g.beginPath();
      g.arc(x, ys, R, 0, Math.PI * 2);
      g.fillStyle = done ? '#7a4a14' : next ? '#4a2c14' : 'rgba(20,14,9,0.92)';
      g.fill();
      g.shadowBlur = 0;
      g.strokeStyle = sel ? '#fff0b0' : done || next ? '#ffcf5a' : 'rgba(180,150,100,0.4)';
      g.lineWidth = sel ? 4 : 2;
      g.stroke();
      g.restore();
      JQ.assetDraw(g, BRK_ART[actHero][i], x - R * 0.82, ys - R * 0.82, R * 1.64, R * 1.64, done || next ? 1 : 0.35);
      text(g, ['一突', '二突', '三突'][i], x, ys + R + 22, 20, done || next ? '#ffe9a0' : '#8a8070');
    }
    const sl = b.levels[brkSel], dy = ys + R + 46;
    if (dy + 90 < B) {
      const dh = B - dy;
      card(24, dy, 672, dh, { r: 16, light: brkSel === lv });
      // 左：这一突的技能图大图；右：名字 + 效果图标 + 一句话
      const as = Math.min(dh - 28, 200);
      JQ.rr(g, 38, dy + 14, as, as, 14);
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.fill();
      JQ.assetDraw(g, BRK_ART[actHero][brkSel], 38, dy + 14, as, as);
      const tags = sl.ult ? JQ.effectTags(sl.ult) : sl.skillAdd ? JQ.effectTags({ do: sl.skillAdd }) : sl.exclusive ? JQ.passiveTags(sl.exclusive.add) : [];
      const tx0 = 38 + as + 20;
      text(g, `${['一突', '二突', '三突'][brkSel]} · ${sl.title}`, tx0, dy + 40, 24, '#ffd23f', { align: 'left', stroke: '#1a0c04', strokeW: 4 });
      let tx = tx0;
      tags.slice(0, 3).forEach((t) => (tx += tagChip(t, tx, dy + 62) + 8));
      wrapLines(sl.summary.replace(/。$/, ''), 15).slice(0, Math.max(1, Math.floor((dh - 130) / 28))).forEach((line, k) => text(g, line, tx0, dy + 136 + k * 28, 19, '#f0e4c8', { align: 'left', font: 'sans-serif', bold: false }));
    }
  }
  function drawActStages() {
    const T = pageTop() + 220, B = pageBottom(), n = ACT.stages.length, gap = 14, h = (B - T - gap * (n - 1)) / n;
    ACT.stages.forEach((st, i) => {
      const y = T + i * (h + gap), cleared = !!prog.act.cleared[st.id], lv = brkOf(st.hero);
      card(24, y, 672, h, { r: 16 });
      // 背景：敌方卡包封面（压暗），一眼看出打谁
      const im = PACK_ART[st.enemyPack];
      if (im && im.complete && im.naturalWidth) {
        g.save();
        JQ.rr(g, 26, y + 2, 668, h - 4, 15);
        g.clip();
        const ir = im.naturalWidth / im.naturalHeight, bw = 668, bh = h - 4, sh = im.naturalWidth / (bw / bh);
        g.globalAlpha = 0.45;
        g.drawImage(im, 0, Math.max(0, (im.naturalHeight - sh) * 0.45), im.naturalWidth, Math.min(sh, im.naturalHeight), 26, y + 2, bw, bh);
        g.globalAlpha = 1;
        const gr = g.createLinearGradient(26, 0, 694, 0);
        gr.addColorStop(0, 'rgba(30,18,8,0.85)');
        gr.addColorStop(0.6, 'rgba(30,18,8,0.55)');
        gr.addColorStop(1, 'rgba(30,18,8,0.2)');
        g.fillStyle = gr;
        g.fillRect(26, y + 2, 668, h - 4);
        g.restore();
      }
      const pw = Math.min(200, (h - 24) * 0.75);
      actPortraitCard(st.hero, 36, y + 12, pw, h - 24, lv, { round: 10 });
      const x = 36 + pw + 22;
      text(g, st.name, x, y + 44, 34, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
      JQ.rr(g, x, y + 66, cleared ? 132 : 112, 30, 15);
      g.fillStyle = cleared ? '#5a3a14' : '#a82818';
      g.fill();
      text(g, cleared ? '已首通 · 可重复' : '首通奖励', x + (cleared ? 66 : 56), y + 82, 14, '#fff1d8', { font: 'sans-serif' });
      text(g, `敌强 ×${st.boost.toFixed(2)}`, 684, y + 34, 16, '#e8a060', { align: 'right', font: 'sans-serif' });
      const r = cleared ? st.repeat : st.first;
      rewardIcons(x, y + 112, r.stone, r.seal, st.hero, 40);
      button(684 - 180, y + h - 84, 180, 70, cleared ? '再 战' : '挑 战', () => startActivityStage(st.id), { on: true, size: 28 });
    });
  }
  function drawActTasks() {
    const T = pageTop() + 220, B = pageBottom(), n = ACT.tasks.length, gap = 10, h = (B - T - gap * (n - 1)) / n;
    ACT.tasks.forEach((t, i) => {
      const y = T + i * (h + gap), p = actTaskProgress(t), done = !!prog.act.tasks[t.id], can = !done && p >= t.need;
      card(24, y, 672, h, { r: 14, light: can, dim: done });
      const s2 = Math.min(80, h - 24);
      actPortraitCircle(t.hero, 40, y + (h - s2) / 2, s2);
      JQ.statIcon(g, t.kind === 'ult' ? 'buff' : 'atk', 40 + s2 - 30, y + (h - s2) / 2 + s2 - 30, 34);
      const x = 40 + s2 + 20;
      text(g, t.name, x, y + h * 0.3, 24, done ? '#9a8f7a' : '#ffe9a0', { align: 'left' });
      // 进度条 + 数字
      const bw = 250, by = y + h * 0.62;
      JQ.rr(g, x, by - 8, bw, 16, 8);
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.fill();
      JQ.rr(g, x, by - 8, Math.max(16, (bw * p) / t.need), 16, 8);
      g.fillStyle = done ? '#8a7a5a' : '#e6b04a';
      g.fill();
      text(g, `${p}/${t.need}`, x + bw + 12, by + 1, 18, '#ffe9a0', { align: 'left', font: 'sans-serif' });
      const rx = 470;
      rewardIcons(rx, y + 14, t.reward.stone, t.reward.seal, t.hero, 30);
      button(560, y + h - 58, 124, 48, done ? '已领' : can ? '领 取' : '未完成', () => {
        if (claimActTask(t.id)) (sfx('coin'), buzz(15));
        else sfx('bad');
      }, { on: can, disabled: !can, size: 19 });
      if (can) redDot(684, y + h - 56);
    });
  }
  function drawBrkAnim(now) {
    if (!brkAnim) return;
    const a = brkAnim, dur = 2800, k = Math.max(0, Math.min(1, (now - a.t0) / dur));
    const b = ACT.byHero[a.name], L = b.levels[a.to - 1];
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => {} });
    veil(Math.min(0.9, k * 3.2));
    const shake = Math.sin(k * 55) * Math.max(0, 1 - k * 3) * 7;
    JQ.fxBudgetReset();
    g.save();
    g.translate(shake, 0);
    if (JQ.fxSprite(g, 'rays', C.W / 2, 570, 980, 980, Math.min(0.85, k * 1.8), k * 0.35)) {
      // 有图集就不画代码光线
    } else {
      g.save();
      g.translate(C.W / 2, 570);
      g.rotate(k * 0.6);
      g.globalAlpha = Math.min(0.18, k * 0.5);
      g.fillStyle = '#ffd35a';
      for (let i = 0; i < 12; i++) (g.rotate(Math.PI / 6), g.beginPath(), g.moveTo(0, 0), g.lineTo(-34, -420), g.lineTo(34, -420), g.closePath(), g.fill());
      g.restore();
    }
    // 光柱
    const lw = 250 * Math.min(1, k * 2);
    const grd = g.createLinearGradient(0, 240, 0, 980);
    grd.addColorStop(0, 'rgba(255,240,190,0)');
    grd.addColorStop(0.35, 'rgba(255,220,120,' + (0.3 * Math.min(1, k * 2)) + ')');
    grd.addColorStop(0.7, 'rgba(255,190,70,' + (0.18 * Math.min(1, k * 2)) + ')');
    grd.addColorStop(1, 'rgba(255,240,190,0)');
    g.fillStyle = grd;
    g.fillRect(C.W / 2 - lw / 2, 240, lw, 740);
    const pop = k < 0.25 ? 0.4 + 3.2 * k : 1 + 0.08 * Math.sin((k - 0.25) * Math.PI * 2.2);
    g.translate(C.W / 2, 575);
    g.scale(pop, pop);
    g.translate(-C.W / 2, -575);
    // 立绘卡（没有立绘时退回字卡）
    if (!actPortraitCard(a.name, C.W / 2 - 150, 385, 300, 390, a.to, { round: 16, label: `字饰 · ${b.ornName}` })) {
      if (!JQ.ui9(g, 'card', C.W / 2 - 150, 405, 300, 340, 34, 24)) panel(C.W / 2 - 150, 405, 300, 340, '#f3ead3', '#6a4a20', 3);
      JQ.drawOrnament(g, a.name, C.W / 2, 555, 118, { tier: a.to, behind: true, scale: 1.15 });
      text(g, HEROES[a.name].chars[0], C.W / 2, 515, 104, '#2a1a08');
      text(g, HEROES[a.name].chars[1], C.W / 2, 625, 104, '#2a1a08');
      JQ.drawOrnament(g, a.name, C.W / 2, 555, 118, { tier: a.to, behind: false, scale: 1.15 });
    }
    // 星光
    for (let i = 0; i < 22; i++) {
      const ang = i * 2.4 + k * 3, rad = 130 + 170 * Math.min(1, k * 1.5) + (i % 4) * 18;
      const sx = C.W / 2 + Math.cos(ang) * rad, sy = 575 + Math.sin(ang) * rad * 0.9;
      g.globalAlpha = Math.max(0, Math.min(1, (k - 0.1) * 2)) * (0.4 + 0.6 * Math.abs(Math.sin(k * 9 + i)));
      text(g, '✦', sx, sy, 10 + (i % 3) * 3, i % 2 ? '#ffe9a0' : '#fff6d0');
    }
    g.globalAlpha = 1;
    g.restore();
    text(g, `第 ${a.to} 次突破`, C.W / 2, 300, 30, '#ffe9a0', { stroke: '#3a2008', strokeW: 6 });
    text(g, L.title, C.W / 2, 356, 24, '#fff3d6', { stroke: '#3a2008', strokeW: 5 });
    const out = Math.min(1, Math.max(0, (k - 0.5) / 0.2));
    if (out > 0) {
      g.save();
      g.globalAlpha = out;
      text(g, '突 破 成 功', C.W / 2, 835, 46, '#ffcf5a', { stroke: '#5a1a04', strokeW: 8 });
      JQ.rr(g, C.W / 2 - 240, 862, 480, 82, 12);
      g.fillStyle = 'rgba(18,11,6,0.78)';
      g.fill();
      g.strokeStyle = 'rgba(240,200,120,0.45)';
      g.lineWidth = 1.2;
      g.stroke();
      wrapLines(L.summary.replace(/。$/, ''), 24).slice(0, 2).forEach((line, i) => text(g, line, C.W / 2, 890 + i * 24, 15, '#fff3d6'));
      g.restore();
    }
    if (k >= 1) brkAnim = null;
  }
  function drawActHelp() {
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => (actHelp = false) });
    veil(0.66);
    popFrame(80, 190, 560, 650, '活动规则');
    buttons.push({ x: 80, y: 190, w: 560, h: 650, fn: () => {} });
    iconBtn(598, 170, 48, '×', () => (actHelp = false));
    JQ.iconDraw(g, 'stone', 116, 286, 34, 34);
    text(g, '破阵石', 158, 310, 17, '#ffe9a0', { align: 'left' });
    JQ.iconDraw(g, 'seal', 270, 286, 34, 34);
    text(g, '将印（按英雄）', 312, 310, 17, '#ffe9a0', { align: 'left' });
    const lines = [
      '活动关首通：3 将印 + 4 破阵石；重复通关：1 将印 + 2 破阵石。',
      '六条活动任务共 9 将印 + 24 破阵石，首通 + 任务刚好够三位全三突。',
      '每次突破：等级上限 +10，攻击/血量 +5%（第三突 +6%）。',
      '一突技能加效果，二突大招进化，三突解锁专属被动。',
      '三关从第一天就全开，可反复挑战；突破只影响你自己的英雄。',
    ];
    let y = 360;
    lines.forEach((s) => {
      wrapLines(s, 24).forEach((l) => {
        text(g, l, 116, y, 14, '#e8dcc0', { align: 'left', font: 'sans-serif', bold: false });
        y += 24;
      });
      y += 10;
    });
    text(g, '本期：虎牢关 · 花果山 · 朱仙镇', C.W / 2, 760, 14, '#ffcf5a', { font: 'sans-serif' });
  }
  function drawActivity() {
    JQ.drawBackdrop(g);
    pageFrame('突破活动 · 第一期', 0.78, () => ((activityStage = null), (screen = 'menu')));
    drawActResources();
    segmented(24, pageTop() + 152, 600, 52, [['brk', '突 破'], ['stage', '活动关卡'], ['task', '活动任务']], actTab, (k) => (actTab = k), 20);
    iconBtn(640, pageTop() + 150, 56, '?', () => (actHelp = !actHelp));
    if (actTab === 'brk') drawActBreak();
    else if (actTab === 'stage') drawActStages();
    else drawActTasks();
    if (actHelp) drawActHelp();
    if (brkAnim) drawBrkAnim(performance.now());
  }

  // ---------- 求贤页 ----------
  // 抽卡演出视频（muse 生成：卷轴展开 → 金光 → 落印）；没加载好时退回代码画的卷轴
  let qxVideo = null, qxVideoOk = false, qxToast = null;
  function qxVideoEl() {
    if (qxVideo || typeof document === 'undefined') return qxVideo;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.preload = 'auto';
    v.addEventListener('canplay', () => (qxVideoOk = true));
    v.addEventListener('error', () => (qxVideoOk = false));
    v.src = 'img/qx_reveal.mp4?v=20261111e';
    qxVideo = v;
    return v;
  }
  function playQxVideo() {
    const v = qxVideoEl();
    if (!v) return;
    try {
      v.currentTime = 0;
      v.playbackRate = 1.3;
      const p = v.play();
      if (p && p.catch) p.catch(() => (qxVideoOk = false));
    } catch (e) {
      qxVideoOk = false;
    }
  }
  function openQiuxian(tab) {
    if (tab) qxTab = tab;
    qxVideoEl();
    JQ.preloadArt('qiuxian_bg');
    JQ.preloadArt('ic_token');
    for (const s of JQ.SKINS) JQ.preloadArt(s.art);
    screen = 'qiuxian';
  }
  function qxSay(s) {
    qxToast = { s, t0: performance.now() };
  }
  const qxIcon = (x, y, s) => {
    if (JQ.iconDraw(g, 'token', x, y, s, s)) return;
    JQ.rr(g, x + s * 0.18, y + s * 0.05, s * 0.64, s * 0.9, s * 0.12);
    g.fillStyle = '#7a3a14';
    g.fill();
    g.strokeStyle = '#f0c878';
    g.lineWidth = Math.max(1, s * 0.05);
    g.stroke();
    text(g, '贤', x + s / 2, y + s / 2 + 1, s * 0.46, '#ffe9a0');
  };
  const qxYayunIcon = (x, y, s) => {
    g.save();
    g.beginPath();
    g.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2);
    g.fillStyle = '#2a1a10';
    g.fill();
    g.strokeStyle = '#e6c27a';
    g.lineWidth = Math.max(1, s * 0.06);
    g.stroke();
    g.restore();
    text(g, '韵', x + s / 2, y + s / 2 + 1, s * 0.5, '#ffd9a0');
  };
  // 皮肤立绘卡：立绘 + 底部压暗 + 名字；opts.dim 未拥有时压暗
  function skinCard(sk, x, y, w, h, opts) {
    opts = opts || {};
    const r = opts.round == null ? 12 : opts.round;
    if (!JQ.portraitDraw(g, sk.hero, x, y, w, h, { round: r, file: sk.art })) {
      panel(x, y, w, h, 'rgba(40,24,14,0.9)', 'rgba(230,194,122,0.5)', 1.5);
      text(g, HEROES[sk.hero].chars[0], x + w / 2, y + h * 0.36, w * 0.3, '#f5ead0');
      text(g, HEROES[sk.hero].chars[1], x + w / 2, y + h * 0.62, w * 0.3, '#f5ead0');
    }
    g.save();
    JQ.rr(g, x, y, w, h, r);
    g.clip();
    const grd = g.createLinearGradient(0, y + h * 0.5, 0, y + h);
    grd.addColorStop(0, 'rgba(18,12,8,0)');
    grd.addColorStop(0.6, 'rgba(18,12,8,0.75)');
    grd.addColorStop(1, 'rgba(18,12,8,0.96)');
    g.fillStyle = grd;
    g.fillRect(x, y + h * 0.5, w, h * 0.5);
    if (opts.dim) (g.fillStyle = 'rgba(12,8,5,0.55)'), g.fillRect(x, y, w, h);
    g.restore();
    g.save();
    JQ.rr(g, x, y, w, h, r);
    g.strokeStyle = opts.on ? '#ffe08a' : 'rgba(230,194,122,0.6)';
    g.lineWidth = opts.on ? 3 : 1.5;
    g.stroke();
    g.restore();
  }
  function qxSwapLine(sk) {
    const def = sk.swap === 'ult' ? sk.ult : sk.skill;
    return `${sk.swap === 'ult' ? '大招' : '技能'}换成「${def.name}」`;
  }
  function drawQxTop() {
    // 背景：招贤馆图铺满；没有图就用木面板
    const top = -JQ.VIEW.top, bot = C.H + JQ.VIEW.bot;
    if (JQ.assetCover(g, 'qiuxian_bg', -padX, top, C.W + 2 * padX, bot - top)) {
      veil(0.28);
      const grd = g.createLinearGradient(0, top, 0, 220);
      grd.addColorStop(0, 'rgba(20,12,6,0.85)');
      grd.addColorStop(1, 'rgba(20,12,6,0)');
      g.fillStyle = grd;
      g.fillRect(-padX, top, C.W + 2 * padX, 220 - top);
      JQ.ui3(g, 'scroll', C.W / 2 - 170, pageTop() + 2, 340, 70, 70);
      text(g, '求 贤', C.W / 2, pageTop() + 38, 32, '#3a2008');
      backBtn(() => (screen = 'menu'));
    } else pageFrame('求 贤', 0.78, () => (screen = 'menu'));
    const T = pageTop() + 96;
    resPill(24, T, 216, (x, y, s2) => qxIcon(x, y, s2), qx().tokens, null);
    resPill(252, T, 200, qxYayunIcon, qx().yayun, null);
    resPill(464, T, 232, (x, y, s2) => JQ.uiDraw(g, 'coin', x + 4, y + 4, s2 - 8, s2 - 8), prog.coins, null);
    segmented(24, T + 54, 672, 52, [['draw', '求 贤'], ['skins', `皮肤 ${skinCount()}/${JQ.SKINS.length}`]], qxTab, (k) => (qxTab = k), 21);
  }
  function drawQxDraw() {
    const now = performance.now(), n = JQ.SKINS.length, T = pageTop() + 96, B = pageBottom();
    // 主展示：自动轮播当期皮肤，左右箭头手动切换
    if (now - qxSwapAt > 4200) (qxSel = qxSwapAt ? (qxSel + 1) % n : qxSel), (qxSwapAt = now);
    if (qxSkinPick != null) (qxSel = qxSkinPick), (qxSkinPick = null), (qxSwapAt = now);
    const sk = JQ.SKINS[qxSel], fade = Math.min(1, (now - qxSwapAt) / 260);
    // 自下而上排：规则行、按钮、保底条；剩下的高度全给立绘
    const linkY = B - 50, btnY = B - 190, pityY = B - 268, cy = T + 124, ch = Math.min(900, pityY - 34 - cy), cw = Math.min(548, Math.round(ch * 0.75)), cx = C.W / 2, cxL = cx - cw / 2;
    g.save();
    g.globalAlpha = 0.35 + 0.65 * fade;
    JQ.fxSprite(g, 'rays', cx, cy + ch * 0.42, cw * 1.8, cw * 1.8, 0.35, now / 9000);
    skinCard(sk, cxL, cy, cw, ch, { round: 18, on: true });
    g.restore();
    if (skinOwned(sk.id)) {
      JQ.rr(g, cxL + cw - 112, cy + 14, 98, 34, 17);
      g.fillStyle = 'rgba(140,30,16,0.92)';
      g.fill();
      text(g, '已拥有', cxL + cw - 63, cy + 32, 17, '#fff1d0');
    }
    // 皮肤名 + 换掉的技能（图标 + 名字），不写长句
    text(g, sk.name, cxL + 24, cy + ch - 92, 40, '#ffe9a0', { align: 'left', stroke: '#1a1008', strokeW: 6 });
    text(g, sk.hero, cxL + 26, cy + ch - 50, 20, '#f0d8a8', { align: 'left' });
    const sw = sk.swap === 'ult' ? sk.ult : sk.skill;
    const tg = JQ.effectTags(sw)[0] || 'aoe';
    JQ.statIcon(g, tg, cxL + 92, cy + ch - 74, 40);
    text(g, `${sk.swap === 'ult' ? '大招' : '技能'}「${sw.name}」`, cxL + 138, cy + ch - 50, 19, '#ffb070', { align: 'left' });
    iconBtn(cxL - 62, cy + ch / 2 - 28, 56, '‹', () => (qxSkinPick = (qxSel + n - 1) % n));
    iconBtn(cxL + cw + 6, cy + ch / 2 - 28, 56, '›', () => (qxSkinPick = (qxSel + 1) % n));
    for (let i = 0; i < n; i++) {
      g.beginPath();
      g.arc(cx - (n - 1) * 10 + i * 20, cy + ch + 16, i === qxSel ? 6 : 4, 0, Math.PI * 2);
      g.fillStyle = i === qxSel ? '#ffd23f' : 'rgba(255,230,180,0.45)';
      g.fill();
    }
    // 保底：大数字 + 进度条
    card(60, pityY, 600, 64, { r: 32 });
    text(g, String(QX.pity - qx().pity), 104, pityY + 33, 34, '#ffd23f', { stroke: '#1a0c04', strokeW: 4 });
    text(g, '次内必得皮肤', 136, pityY + 33, 19, '#fff1d8', { align: 'left' });
    JQ.rr(g, 290, pityY + 26, 350, 14, 7);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fill();
    JQ.rr(g, 290, pityY + 26, Math.max(14, (350 * qx().pity) / QX.pity), 14, 7);
    const pg = g.createLinearGradient(290, 0, 640, 0);
    pg.addColorStop(0, '#c8501c');
    pg.addColorStop(1, '#ffcf5a');
    g.fillStyle = pg;
    g.fill();
    // 单抽 / 十连：按钮里只写动作，花费用图标 × 数字放按钮下
    const free = qxFree();
    button(40, btnY, 300, 88, free ? '免费求贤' : '求贤一次', () => qxDraw(1), { on: free, size: 28 });
    button(380, btnY, 300, 88, '求贤十次', () => qxDraw(QX.ten), { on: true, size: 28 });
    if (free) redDot(330, btnY + 8, 11);
    const costRow = (x, ok, n2, freeTxt) => {
      if (freeTxt) return text(g, freeTxt, x, btnY + 108, 17, '#ffd23f');
      qxIcon(x - 40, btnY + 92, 32);
      text(g, `× ${n2}`, x - 4, btnY + 108, 20, ok ? '#ffe9a0' : '#ff8a6a', { align: 'left', font: 'sans-serif', stroke: '#1a0c04', strokeW: 3 });
    };
    costRow(190, qx().tokens >= 1, 1, free ? '今天免费一次' : null);
    costRow(530, qx().tokens >= QX.ten, QX.ten);
    button(40, linkY, 300, 48, '概率公示', () => (qxRates = true), { flat: true, size: 19 });
    button(380, linkY, 300, 48, '雅韵兑换', () => (qxTab = 'skins'), { flat: true, size: 19 });
  }
  function drawQxSkins() {
    const T = pageTop() + 96 + 124, B = pageBottom(), gap = 12, th = (B - T - gap * 2) / 3, tw = (672 - gap) / 2;
    JQ.SKINS.forEach((sk, i) => {
      const x = 24 + (i % 2) * (tw + gap), y = T + Math.floor(i / 2) * (th + gap), w = tw, h = th;
      const own = skinOwned(sk.id), on = qx().equip[sk.hero] === sk.id;
      skinCard(sk, x, y, w, h, { dim: !own, on });
      text(g, sk.name, x + 16, y + h - 92, 26, own ? '#ffe9a0' : '#c8b090', { align: 'left', stroke: '#1a1008', strokeW: 4 });
      const sw = sk.swap === 'ult' ? sk.ult : sk.skill;
      JQ.statIcon(g, JQ.effectTags(sw)[0] || 'aoe', x + 14, y + h - 80, 30);
      text(g, sw.name, x + 50, y + h - 64, 17, own ? '#ffb070' : '#9a8f7a', { align: 'left' });
      text(g, sk.hero, x + w - 16, y + 30, 18, '#ffe9a0', { align: 'right', stroke: '#1a0c04', strokeW: 3 });
      if (own) button(x + 14, y + h - 50, w - 28, 42, on ? '已穿戴' : '穿 戴', () => equipSkin(sk.hero, sk.id), { on: !on, flat: on, size: 19 });
      else {
        const can = qx().yayun >= QX.exchange;
        button(x + 14, y + h - 50, w - 28, 42, `${QX.exchange} 雅韵兑换`, () => qxExchange(sk.id), { on: can, disabled: !can, size: 17 });
        JQ.uiDraw(g, 'lock', x + 14, y + 12, 36, 36);
      }
    });
  }
  function drawQxRates() {
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => (qxRates = false) });
    veil(0.66);
    popFrame(90, 260, 540, 640, '概率公示');
    buttons.push({ x: 90, y: 260, w: 540, h: 640, fn: () => {} });
    iconBtn(588, 240, 48, '×', () => (qxRates = false));
    const names = { skin: '皮肤（任选一款还没有的）', yayun: '雅韵', coins: '铜钱', stone: '破阵石', seal: '将印（活动英雄随机）' };
    QX.table.forEach((r, i) => {
      const y = 350 + i * 56;
      text(g, names[r.kind] + (r.n ? `  ${r.n[0] === r.n[1] ? r.n[0] : r.n[0] + '~' + r.n[1]}` : ''), 130, y, 17, '#f5ead0', { align: 'left', font: 'sans-serif' });
      text(g, `${r.p}%`, 590, y, 19, '#ffd23f', { align: 'right', font: 'sans-serif' });
    });
    const lines = [`连续 ${QX.pity} 次没出皮肤，第 ${QX.pity} 次必出。`, `六款都有了以后，皮肤折成 ${QX.dupYayun} 雅韵。`, `${QX.exchange} 雅韵可兑换任意一款皮肤。`, '皮肤只换外观和一个技能/大招，和原版强度平级。'];
    lines.forEach((s, i) => text(g, s, 130, 660 + i * 34, 14, '#d8c8a0', { align: 'left', font: 'sans-serif', bold: false }));
  }
  // 抽卡演出：视频（或代码卷轴）→ 新皮肤立绘亮相 → 结果卡依次翻开
  function drawQxAnim(now) {
    const a = qxAnim, t = (now - a.t0) / 1000;
    buttons.push({ x: -padX, y: -padY, w: C.W + 2 * padX, h: C.H + 2 * padY, fn: () => qxAnimTap() });
    const top = -JQ.VIEW.top, bot = C.H + JQ.VIEW.bot;
    if (a.phase == null) a.phase = 'video';
    if (a.phase === 'video') {
      g.fillStyle = '#000';
      g.fillRect(-padX, top, C.W + 2 * padX, bot - top);
      const v = qxVideo, vt = v && qxVideoOk && v.readyState >= 2 && !v.paused;
      if (vt) {
        const vw = v.videoWidth || 540, vh = v.videoHeight || 960, W = C.W + 2 * padX, H = bot - top;
        const s = Math.max(W / vw, H / vh);
        g.drawImage(v, -padX + (W - vw * s) / 2, top + (H - vh * s) / 2, vw * s, vh * s);
      } else {
        // 代码卷轴：两根轴从中间上下拉开
        const k = Math.min(1, t / 1.2), hh = 40 + 460 * k * k;
        JQ.fxSprite(g, 'rays', C.W / 2, 600, 900, 900, Math.min(0.8, t), t * 0.4);
        g.fillStyle = '#b2261a';
        g.fillRect(C.W / 2 - 170, 600 - hh, 340, hh * 2);
        g.strokeStyle = '#f0c878';
        g.lineWidth = 4;
        g.strokeRect(C.W / 2 - 158, 612 - hh, 316, hh * 2 - 24);
        for (const sy of [600 - hh - 12, 600 + hh - 12]) (JQ.rr(g, C.W / 2 - 200, sy, 400, 24, 12), (g.fillStyle = '#6a3a14'), g.fill());
        if (t > 1.3) {
          const sk = Math.min(1, (t - 1.3) / 0.25), sc = 2.2 - 1.2 * sk;
          g.save();
          g.translate(C.W / 2, 600);
          g.scale(sc, sc);
          g.globalAlpha = sk;
          JQ.rr(g, -60, -60, 120, 120, 14);
          g.fillStyle = '#d0301c';
          g.fill();
          text(g, '贤', 0, 4, 76, '#fff1d0');
          g.restore();
        }
      }
      const done = vt ? v.ended || v.currentTime > 3.9 : t > 1.9;
      if (done || t > 6) (a.phase = a.skinShow >= 0 ? 'skin' : 'cards'), (a.t1 = now);
      text(g, '点击跳过', C.W / 2, bot - 60, 14, 'rgba(255,240,210,0.6)', { font: 'sans-serif', bold: false });
      return;
    }
    const t1 = (now - a.t1) / 1000;
    if (a.phase === 'skin') {
      // 新皮肤：全屏立绘亮相
      const sk = JQ.SKIN_BY_ID[a.res[a.skinShow].id];
      veil(0.92);
      JQ.fxSprite(g, 'rays', C.W / 2, 560, 1100, 1100, Math.min(0.9, t1 * 2), t1 * 0.3);
      const k = Math.min(1, t1 / 0.45), e = 1 - Math.pow(1 - k, 3);
      g.save();
      g.globalAlpha = k;
      g.translate(C.W / 2, 560);
      g.scale(0.82 + 0.18 * e, 0.82 + 0.18 * e);
      skinCard(sk, -240, -330, 480, 640, { round: 20, on: true });
      g.restore();
      if (t1 > 0.4) {
        const k2 = Math.min(1, (t1 - 0.4) / 0.3);
        g.save();
        g.globalAlpha = k2;
        text(g, '获 得 皮 肤', C.W / 2, 186, 30, '#ffcf5a', { stroke: '#5a1a04', strokeW: 6 });
        text(g, sk.name, C.W / 2, 948, 46, '#ffe9a0', { stroke: '#3a1a04', strokeW: 7 });
        text(g, `${sk.hero} · ${qxSwapLine(sk)}`, C.W / 2, 1000, 18, '#f0d8a8', { font: 'sans-serif' });
        text(g, qx().equip[sk.hero] === sk.id ? '已自动穿戴，出战时生效' : '可在「皮肤图鉴」里穿戴', C.W / 2, 1034, 14, '#c8b090', { font: 'sans-serif', bold: false });
        g.restore();
      }
      for (let i = 0; i < 18; i++) {
        const ang = i * 2.1 + t1 * 2, rad = 280 + (i % 4) * 30 + 30 * Math.sin(t1 * 3 + i);
        g.globalAlpha = 0.4 + 0.6 * Math.abs(Math.sin(t1 * 5 + i));
        text(g, '✦', C.W / 2 + Math.cos(ang) * rad, 560 + Math.sin(ang) * rad * 1.1, 12 + (i % 3) * 4, i % 2 ? '#ffe9a0' : '#fff6d0');
      }
      g.globalAlpha = 1;
      text(g, '点击继续', C.W / 2, bot - 60, 14, 'rgba(255,240,210,0.6)', { font: 'sans-serif', bold: false });
      return;
    }
    // 结果卡：单抽一张大卡，十连 2×5
    veil(0.95);
    JQ.fxSprite(g, 'rays', C.W / 2, 520, 900, 900, 0.3, t1 * 0.2);
    text(g, a.res.length > 1 ? '求 贤 十 次' : '求 贤 结 果', C.W / 2, 250, 32, '#ffe9a0', { stroke: '#2a1a08', strokeW: 5 });
    const one = a.res.length === 1;
    a.res.forEach((r, i) => {
      const appear = Math.max(0, Math.min(1, (t1 - i * 0.11) / 0.22));
      if (appear <= 0) return;
      if (appear > 0 && a.shown < i) (a.shown = i), sfx(r.kind === 'skin' ? 'merge' : 'tap');
      const w = one ? 260 : 120, h = one ? 340 : 164;
      const x = one ? C.W / 2 - w / 2 : 46 + (i % 5) * 128, y = one ? 330 : 330 + Math.floor(i / 5) * 186;
      g.save();
      g.translate(x + w / 2, y + h / 2);
      g.scale(Math.max(0.05, Math.sin((appear * Math.PI) / 2)), 1); // 翻牌
      g.translate(-(x + w / 2), -(y + h / 2));
      qxResultCard(r, x, y, w, h);
      g.restore();
    });
    if (t1 > a.res.length * 0.11 + 0.3) {
      const y = one ? 760 : 760;
      button(110, y, 240, 72, '确 定', () => (qxAnim = null), { size: 26 });
      const n = a.res.length, free = n === 1 && qxFree();
      button(370, y, 240, 72, n > 1 ? '再求十次' : free ? '今日免费' : '再求一次', () => ((qxAnim = null), qxDraw(n)), { on: true, size: 24 });
    }
  }
  function qxResultCard(r, x, y, w, h) {
    const skin = r.kind === 'skin';
    if (skin && !r.dup) {
      const sk = JQ.SKIN_BY_ID[r.id];
      skinCard(sk, x, y, w, h, { round: 10, on: true });
      text(g, sk.name, x + w / 2, y + h - (w > 200 ? 34 : 20), w > 200 ? 26 : 15, '#ffe9a0', { stroke: '#1a1008', strokeW: 4 });
      return;
    }
    JQ.rr(g, x, y, w, h, 10);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, 'rgba(70,44,22,0.96)');
    grd.addColorStop(1, 'rgba(34,20,10,0.96)');
    g.fillStyle = grd;
    g.fill();
    g.strokeStyle = 'rgba(230,194,122,0.7)';
    g.lineWidth = 1.6;
    g.stroke();
    const s = Math.min(w, h) * 0.5, ix = x + w / 2 - s / 2, iy = y + h * 0.18;
    let label = '';
    if (r.kind === 'yayun' || (skin && r.dup)) (qxYayunIcon(ix, iy, s), (label = `雅韵 ×${r.n}`));
    else if (r.kind === 'coins') (JQ.uiDraw(g, 'coin', ix + s * 0.1, iy + s * 0.1, s * 0.8, s * 0.8), (label = `铜钱 ×${r.n}`));
    else if (r.kind === 'stone') (JQ.iconDraw(g, 'stone', ix, iy, s, s) || actStoneIcon(ix, iy, s), (label = `破阵石 ×${r.n}`));
    else if (r.kind === 'seal') (JQ.iconDraw(g, 'seal', ix, iy, s, s) || actSealIcon(r.hero, ix, iy, s), (label = `${r.hero}将印 ×${r.n}`));
    text(g, label, x + w / 2, y + h - (w > 200 ? 40 : 26), w > 200 ? 22 : 13, '#ffe9a0', { font: 'sans-serif', stroke: '#1a1008', strokeW: 3 });
    if (skin && r.dup) text(g, '重复皮肤', x + w / 2, y + h - (w > 200 ? 70 : 46), w > 200 ? 15 : 11, '#ffb070', { font: 'sans-serif' });
  }
  function qxAnimTap() {
    const a = qxAnim;
    if (!a) return;
    const now = performance.now();
    if (a.phase === 'video') {
      if (qxVideo) try { qxVideo.pause(); } catch (e) {}
      a.phase = a.skinShow >= 0 ? 'skin' : 'cards';
      a.t1 = now;
    } else if (a.phase === 'skin' && now - a.t1 > 500) (a.phase = 'cards'), (a.t1 = now);
    else if (a.phase === 'cards' && now - a.t1 < a.res.length * 110 + 300) a.t1 = now - a.res.length * 110 - 300; // 一下翻完
  }
  function drawQiuxian() {
    drawQxTop();
    if (qxTab === 'draw') drawQxDraw();
    else drawQxSkins();
    if (qxRates) drawQxRates();
    if (qxToast) {
      const k = (performance.now() - qxToast.t0) / 2400;
      if (k >= 1) qxToast = null;
      else {
        g.save();
        g.globalAlpha = Math.min(1, (1 - k) * 4);
        JQ.rr(g, 110, 600, 500, 56, 14);
        g.fillStyle = 'rgba(18,11,6,0.92)';
        g.fill();
        text(g, qxToast.s, C.W / 2, 629, 16, '#ffe9a0', { font: 'sans-serif' });
        g.restore();
      }
    }
    if (qxAnim) drawQxAnim(performance.now());
  }

  // ---------- 第一关新手引导 ----------
  // 经典第 1 关第一次进入时触发：聚光框 + 手势 + 一句话；等玩家做完这一步才继续，等待时战斗暂停。
  const TUT_KEY = 'jq_tut';
  let tut = null;
  function startTutorial() {
    tut = { step: 0, t0: performance.now(), hero: null };
  }
  const tutFreeze = () => tut && tut.step !== 1;
  function tutNext() {
    tut.step++;
    tut.t0 = performance.now();
    const s = game.sides[0];
    if (tut.step === 2 && s.buns < s.recruitCost()) s.buns = s.recruitCost(); // 保证能点招兵
    if (tut.step === 3) {
      // 塞两张能合成英雄的字卡到招兵栏前两格
      const h = (JQ.PACKS[s.pack].heroes || []).map((n) => HEROES[n]).find((d) => d && d.chars && d.chars.length === 2);
      if (h) (tut.hero = h.name), (s.shop[0] = JQ.makeCard('char', h.chars[0], 1)), (s.shop[1] = JQ.makeCard('char', h.chars[1], 1));
      else tut.step++;
    }
    if (tut.step >= 5) (tut = null), localStorage.setItem(TUT_KEY, '1');
  }
  function tutEvent(ev, d) {
    if (!tut || !d || d.side !== 0) return;
    if (tut.step === 0 && ev === 'place') tutNext();
    else if (tut.step === 2 && ev === 'recruit') tutNext();
    else if (tut.step === 3 && ev === 'place') setTimeout(() => tut && tut.step === 3 && game.sides[0].board.links.some((l) => l.hero === tut.hero) && tutNext(), 0); // 等棋盘重算连字后再判断
  }
  // 引导期间的点击：跳过 / 信息步点一下继续；返回 true 表示被引导吃掉
  function tutTap(p) {
    if (!tut) return false;
    const sk = tutSkipRect();
    if (inRect(p, sk)) return (tut = null), localStorage.setItem(TUT_KEY, '1'), true;
    if (tut.step === 1 && performance.now() - tut.t0 > 800) return tutNext(), true;
    if (tut.step === 4) return tutNext(), true;
    return false;
  }
  const tutSkipRect = () => ({ x: 556, y: 560, w: 132, h: 52 });
  function tutEmptyCells(n) {
    const out = [];
    for (const x of game.sides[0].board.all()) if (x.unlocked && !x.crystal && !x.card && x.r >= 0) out.push(x);
    if (n === 2) {
      for (const a of out) {
        const b = out.find((x) => x.r === a.r && x.c === a.c + 1);
        if (b) return [a, b];
      }
      return out.slice(0, 2);
    }
    return out.slice(0, n);
  }
  function drawTutorial() {
    if (!tut) return;
    const now = performance.now(), k = (now - tut.t0) / 1000, s = game.sides[0];
    if (tut.step === 3 && s.board.links.some((l) => l.hero === tut.hero)) tutNext();
    if (tut.step === 1 && k > 5) tutNext();
    if (!tut) return;
    // 聚光：要点的地方挖空，其余压暗
    const holes = [], hand = [];
    let say = '', sub = '';
    if (tut.step === 0) {
      const si = s.shop.findIndex((c) => c && c.kind === 'unit');
      const cell = tutEmptyCells(1)[0];
      if (si >= 0) holes.push(JQ.shopRect(si));
      if (cell) holes.push(JQ.cellRect(0, cell.r, cell.c));
      if (holes.length === 2) hand.push(holes[0], holes[1]);
      say = '把兵卡拖进格子';
      sub = '按住卡片拖到亮着的格子里';
    } else if (tut.step === 1) {
      say = '主角走过兵卡就召兵';
      sub = '点任意处继续';
    } else if (tut.step === 2) {
      holes.push(JQ.UI.recruit);
      hand.push(JQ.UI.recruit);
      say = '点「招兵」换一排新卡';
      sub = '备战席剩下的卡会自动卖掉';
    } else if (tut.step === 3) {
      const cells = tutEmptyCells(2);
      holes.push(JQ.shopRect(0), JQ.shopRect(1));
      cells.forEach((c) => holes.push(JQ.cellRect(0, c.r, c.c)));
      if (cells.length === 2) hand.push(JQ.shopRect(0), JQ.cellRect(0, cells[0].r, cells[0].c));
      say = `两字左右相邻 = ${tut.hero}`;
      sub = '把这两个字并排放进格子';
    } else if (tut.step === 4) {
      say = '英雄 3 级放大招';
      sub = '打爆对面基地就赢！点任意处开始';
    }
    if (tut.step !== 1) {
      g.save();
      g.beginPath();
      g.rect(-padX, -padY, C.W + 2 * padX, C.H + 2 * padY);
      for (const h of holes) g.rect(h.x - 6, h.y - 6, h.w + 12, h.h + 12);
      g.fillStyle = 'rgba(10,6,2,0.72)';
      g.fill('evenodd');
      const pulse = 0.6 + 0.4 * Math.sin(k * 6);
      g.strokeStyle = `rgba(255,214,90,${pulse})`;
      g.lineWidth = 4;
      for (const h of holes) (JQ.rr(g, h.x - 6, h.y - 6, h.w + 12, h.h + 12, 10), g.stroke());
      g.restore();
    }
    // 手势：两点之间来回拖，或在一点上点按
    if (hand.length) {
      const a = hand[0], b = hand[1] || hand[0], f = b === a ? 0 : (k % 1.6) / 1.2;
      const t = Math.min(1, Math.max(0, f)), x = a.x + a.w / 2 + (b.x - a.x + (b.w - a.w) / 2) * t, y = a.y + a.h / 2 + (b.y - a.y + (b.h - a.h) / 2) * t;
      const tap = b === a ? 1 + 0.12 * Math.sin(k * 8) : 1;
      g.save();
      g.translate(x + 10, y + 18);
      g.scale(tap, tap);
      text(g, '👆', 0, 0, 64, '#fff');
      g.restore();
    }
    // 提示气泡：屏幕中部（两军之间）
    const by = 470;
    card(32, by, 656, 150, { r: 18, light: true });
    text(g, say, 60, by + 52, 32, '#ffe9a0', { align: 'left', stroke: '#1a0c04', strokeW: 5 });
    text(g, sub, 62, by + 104, 20, '#f0e0c0', { align: 'left', font: 'sans-serif', bold: false });
    text(g, `${tut.step + 1}/5`, 664, by + 40, 18, '#c8b090', { align: 'right', font: 'sans-serif' });
    const sk = tutSkipRect();
    card(sk.x, sk.y, sk.w, sk.h, { dim: true, r: 26 });
    text(g, '跳过', sk.x + sk.w / 2, sk.y + sk.h / 2 + 1, 20, '#e8d8b0');
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
    const mood = screen === 'play' || screen === 'paused' ? (game && game.overtime ? 'urgent' : 'battle') : 'menu';
    if (mood !== BGM.mood) setMusic(mood);
    if (screen === 'menu') drawMenu(dt);
    else if (screen === 'stages') drawStages();
    else if (screen === 'custom') drawCustom();
    else if (screen === 'units') drawUnits();
    else if (screen === 'mainhero') drawMainHero();
    else if (screen === 'activity') drawActivity();
    else if (screen === 'qiuxian') drawQiuxian();
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
      JQ.drawBackdrop(g);
      drawTalents();
    }
    else if (screen === 'help' && helpBack === 'menu') {
      JQ.drawBackdrop(g);
      helpPage ? drawRoster() : drawHelp();
    }
    else {
      if (screen === 'play' && !game.over) {
        // 打击停顿：大招/击杀英雄/英雄暴击时模拟放慢一小会儿，手感更“沉”
        let slow = 1;
        if (game.hitstop > 0) (slow = 0.12), (game.hitstop -= dt);
        acc += dt * view.speed * slow;
        if (tutFreeze()) acc = 0; // 引导等玩家操作时战斗暂停
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
      for (const a of view.anims) if (a.coin && !a.done && nowMs - a.t0 >= 550) (a.done = true), (view.bunPop = 0.25), sfx('coin');
      view.anims = view.anims.filter((a) => nowMs - a.t0 < (a.life || 400));
      // 基地残血：心跳声
      if (screen === 'play' && !game.over && !game.R.waves && game.sides[0].hp < game.sides[0].maxHp * 0.3 && nowMs - lastHeart > 1200) (lastHeart = nowMs), sfx('heart');
      JQ.render(game, view);
      if (screen === 'play' && !game.over) drawTutorial();
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
    drawRipples();
    requestAnimationFrame(frame);
  }
  // 首屏就会用到的小图先下载（图标集、大厅侧边入口、求贤令），免得先闪一下文字占位
  for (const f of ['icons', 'ic_breakthrough', 'ic_stage', 'ic_token', 'lobby_bg']) JQ.preloadArt(f);
  JQ.preloadKit();
  requestAnimationFrame(frame);

  // 调试：?screen=custom/stages/testlab/paused 直接打开对应界面（截图用）
  const urlScreen = (location.search.match(/[?&]screen=(\w+)/) || [])[1];
  // 调试：?brk=3 直接把三位英雄的突破和材料拉满（截图/验收用）
  const urlBrk = +(location.search.match(/[?&]brk=(\d+)/) || [])[1];
  if (urlBrk) {
    for (const h of ACT.heroes) {
      prog.brk[h] = Math.max(prog.brk[h] || 0, Math.min(3, urlBrk));
      prog.act.seal[h] = Math.max(prog.act.seal[h] || 0, 20);
    }
    prog.act.stone = Math.max(prog.act.stone || 0, 60);
    saveProg();
    syncSkinArt();
  }
  // 调试：?main=吕布 直接设本命将
  const urlMain = decodeURIComponent((location.search.match(/[?&]main=([^&]+)/) || [])[1] || '');
  if (HEROES[urlMain]) setMain(urlMain);
  // 调试：?skin=lvbu_chitu,wukong_fo 直接获得并穿上这些皮肤
  const urlSkin = (location.search.match(/[?&]skin=([\w,]+)/) || [])[1];
  if (urlSkin) {
    for (const id of urlSkin.split(',')) if (JQ.SKIN_BY_ID[id]) (prog.qx.owned[id] = true), (prog.qx.equip[JQ.SKIN_BY_ID[id].hero] = id);
    saveProg();
    syncSkinArt();
  }
  if (urlScreen === 'custom') openCustom();
  else if (urlScreen === 'stages') openStages();
  else if (urlScreen === 'testlab') openTestLab();
  else if (urlScreen === 'mainhero') openMainHero();
  else if (urlScreen === 'activity') {
    const tab = (location.search.match(/[?&]tab=(\w+)/) || [])[1];
    if (['brk', 'stage', 'task'].includes(tab)) actTab = tab;
    const hero = (location.search.match(/[?&]hero=([^&]+)/) || [])[1];
    if (hero && ACT.byHero[decodeURIComponent(hero)]) actHero = decodeURIComponent(hero);
    openActivity();
  } else if (urlScreen === 'qiuxian') {
    // 调试：?screen=qiuxian&tab=skins&qx=10 直接打开求贤页，并补足求贤令/雅韵
    const tab = (location.search.match(/[?&]tab=(\w+)/) || [])[1];
    const add = +(location.search.match(/[?&]qx=(\d+)/) || [])[1] || 0;
    if (add) (prog.qx.tokens = Math.max(prog.qx.tokens, add)), (prog.qx.yayun = Math.max(prog.qx.yayun, add * 12)), saveProg();
    openQiuxian(tab === 'skins' ? 'skins' : 'draw');
  } else if (urlScreen === 'paused') newGame(), (screen = 'paused');
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
  window.__jq = {
    get game() { return game; }, get screen() { return screen; }, newGame, view,
    setScreen: (s) => (screen = s), setDblSell: (v) => (dblSell = v), openCustom, openStages, openTestLab, startTest,
    get test() { return { blue: testLab.blue.slice(), red: testLab.red.slice(), game: testLab.game, result: testLab.result }; },
    get stage() { return stageOf(); }, get best() { return bestOf(); },
    get custom() { return { heroes: customHeroes.slice(), units: customUnits.slice() }; },
    openActivity, startActivityStage, claimActTask, doBreakthrough, showHero: (n) => (HEROES[n] ? (rosterSel = n) : null),
    brkUp, brkOf, get activity() { return activityStage; },
    openQiuxian, qxDraw, qxExchange, equipSkin, qxAnimTap, get qxAnim() { return qxAnim; },
    get tut() { return tut; }, tutNext: () => tutNext(), startTutorial: () => startTutorial(),
    qxReset: () => (qxAnim = null), setQx: (o) => (Object.assign(prog.qx, o), saveProg(), syncSkinArt()),
    get prog() { return JSON.parse(JSON.stringify(prog)); },
    giveMats: (stone, seal) => {
      prog.act.stone += stone || 0;
      for (const h of ACT.heroes) prog.act.seal[h] = (prog.act.seal[h] || 0) + (seal || 0);
      saveProg();
      return { stone: prog.act.stone, seal: Object.assign({}, prog.act.seal) };
    },
  };
})();
