// 对局模拟：经济、招兵栏、主角巡营、召唤、战斗、技能与大招、胜负。不碰 DOM，Node 可直接跑。
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const JQ = (G.JQ = G.JQ || {});
  const { C, UNITS, HEROES } = JQ;

  // 世界坐标布局：side 0 = 玩家（下），side 1 = 对手（上）
  const L = {
    BX0: (C.W - C.COLS * C.CELL) / 2,
    P_TOP: 870,                 // 玩家棋盘上沿 = 玩家基地线
    E_BOTTOM: 300,              // 对手棋盘下沿 = 对手基地线
  };
  L.BX1 = L.BX0 + C.COLS * C.CELL;
  JQ.L = L;

  JQ.cellRect = function (side, r, c) {
    const x = L.BX0 + c * C.CELL;
    const y = side === 0 ? L.P_TOP + r * C.CELL : L.E_BOTTOM - (r + 1) * C.CELL;
    return { x, y, w: C.CELL, h: C.CELL, cx: x + C.CELL / 2, cy: y + C.CELL / 2 };
  };
  JQ.baseLine = (side) => (side === 0 ? L.P_TOP : L.E_BOTTOM);

  // 对手难度：income=包子产出倍率，think=几秒想一次，actions=每次最多做几步操作，
  // smart=会不会在场上合卡、挪字凑英雄；human 是测试用的“普通玩家手速”画像
  // 对手 AI 画像：think=几秒想一次，actions=每次最多几步，smart=会不会合卡、挪字凑英雄，wave=无限模式敌军数量倍率。
  // 双方包子产出完全一样；标准按玩家手速动态生成（见 JQ.aiProfile），human 是测试用的“普通玩家”画像
  const DIFF = {
    normal: { think: 1.5, actions: 2, smart: true, wave: 1, name: '标准', dynamic: 1.1 },
    hard: { think: 0.5, actions: 6, smart: true, wave: 1.4, name: '困难' },
    human: { think: 2.0, actions: 2, smart: true, wave: 1, name: '玩家' },
  };
  JQ.DIFF_ORDER = ['normal', 'hard'];
  // 动态难度：player = { apm 玩家每分钟操作数, adapt 输赢自适应系数 }
  JQ.aiProfile = function (key, player) {
    const base = DIFF[key] || DIFF.normal;
    if (!base.dynamic) return base;
    const apm = Math.max(10, (player && player.apm) || 40);
    const adapt = key === 'normal' ? (player && player.adapt) || 1 : 1;
    const target = apm * base.dynamic * adapt;
    const actions = target > 90 ? 2 : 1;
    const think = Math.min(4, Math.max(0.4, (60 * actions) / target));
    return Object.assign({}, base, { think, actions, smart: base.smart && adapt >= 0.8, apm: target });
  };

  // 天赋合并：加法类默认 0、取最大类默认 0，其余乘法类默认 1
  const ADD_KEYS = ['recruitDiscount', 'startBuns', 'sellBonus', 'extraHero', 'baseHp', 'rangedRange', 'assassinStealth', 'swordSplash', 'bowDouble', 'unitLifesteal', 'deathBlast', 'freeRecruit', 'baseDr', 'baseRegen', 'command', 'heroRange', 'unitDr', 'killBuns', 'charPity'];
  const SET_KEYS = ['spearBonus', 'reinforce'];
  JQ.mergeTalents = function (ids) {
    const T = { income: 1, unitSpeed: 1, unitAtk: 1, unitHp: 1, heroHp: 1, heroAtk: 1, ultCd: 1, tower: 1, walk: 1, outpost: 1, allAtk: 1, baseHpMult: 1, autoMerge: 1, tilePity: 1, recruitDiscount: 0, startBuns: 0, sellBonus: 0, extraHero: 0, baseHp: 0, heroRange: 0, unitDr: 0, killBuns: 0, charPity: 0, bans: [], w: {}, ids: ids || [] };
    for (const id of ids || []) {
      const t = JQ.TALENT_BY_ID[id];
      if (!t) continue;
      for (const [k, v] of Object.entries(t.fx)) {
        if (k === 'ban') T.bans.push(v);
        else if (k === 'w') for (const [kk, vv] of Object.entries(v)) T.w[kk] = (T.w[kk] || 1) * vv;
        else if (typeof v === 'boolean') T[k] = v;
        else if (ADD_KEYS.includes(k)) T[k] = (T[k] || 0) + v;
        else if (SET_KEYS.includes(k)) T[k] = Math.max(T[k] || 0, v);
        else T[k] = (T[k] == null ? 1 : T[k]) * v;
      }
    }
    return T;
  };
  JQ.DIFF = DIFF;

  let nextUnitId = 1;

  class Side {
    constructor(id, game) {
      this.id = id;
      this.game = game;
      this.pack = game.packs[id];
      this.board = new JQ.Board(this.pack);
      const R = game.R;
      const T = (this.T = game.talents[id]);
      this.hp = this.maxHp = Math.round((R.baseHp + T.baseHp) * T.baseHpMult);
      this.buns = R.startBuns + T.startBuns;
      this.shop = new Array(C.SHOP_SIZE).fill(null);
      this.refreshes = 0;
      this.tileDry = 0; // 连续多少次刷新没看到格子
      this.xiaGiven = 0; // 自定义包带夏夏时，前两张文字卡保底给夏
      this.xiaCraft = 0; // 夏夏本局已触发的“造物”次数，最多 3 次
      this.incomeMult = T.income;
      this.heroAlive = {};
      this.heroCd = {};
      this.stats = { summoned: 0, kills: 0, baseDmg: 0, heroes: 0, ults: 0 };
      const crystal = this.board.all().find((x) => x.crystal);
      const rc = JQ.cellRect(id, crystal.r, crystal.c);
      this.walker = { from: crystal, to: crystal, p: 1, dur: 1, dir: 1, x: rc.cx, y: rc.cy };
    }

    sum(kind, key) {
      return this.board.levelSum(kind, key);
    }
    speedMult() {
      const swift = this.game.mods.swiftUntil > this.game.time ? 2 : 1;
      return Math.min(3, 1 + 0.2 * this.sum('building', '马')) * swift * this.T.walk;
    }
    cdMult() {
      return Math.max(0.4, (1 - 0.08 * this.sum('building', '鼓')) * (this.T.cdMult || 1));
    }
    atkMult() {
      return 1 + 0.08 * this.sum('building', '旗');
    }
    recruitCost() {
      const R = this.game.R;
      if (this.game.mods.freeUntil > this.game.time) return 0;
      return Math.max(5, Math.min(R.recruitMax, R.recruitCost + R.recruitStep * this.refreshes) - this.T.recruitDiscount);
    }
    unitCap(key) {
      return Math.min(C.CAP_MAX * (this.T.capMult || 1), this.sum('unit', key) * C.CAP_PER_LEVEL * (this.T.capMult || 1));
    }
    aliveCount(key) {
      let n = 0;
      for (const u of this.game.units) if (u.side === this.id && !u.isHero && u.key === key && !u.bonusSpawn) n++;
      return n;
    }
  }

  class Game {
    constructor(opts) {
      opts = opts || {};
      this.rand = JQ.rng(opts.seed || Date.now());
      this.diff = opts.aiProfile || DIFF[opts.difficulty] || DIFF.normal;
      this.modeKey = JQ.MODES[opts.mode] ? opts.mode : 'classic';
      this.mode = JQ.MODES[this.modeKey];
      this.R = Object.assign(JQ.defaultRules(), this.mode.rules);
      this.stage = Math.max(1, Math.min(C.MAX_STAGE, opts.stage || 1));
      this.skillToast = opts.skillToast !== false;
      // 卡包：玩家自选，对手默认随机一个已开放的；自定义包没配好不能进
      const usable = (p) => !!(JQ.PACKS[p] && JQ.PACKS[p].open && (p !== 'custom' || JQ.customReady()));
      const open = JQ.OPEN_PACKS.filter(usable);
      this.packs = [opts.pack, opts.enemyPack].map((p) => (usable(p) ? p : open[Math.floor(this.rand() * open.length)]));
      this.talents = [0, 1].map((i) => JQ.mergeTalents((opts.talents || [])[i]));
      // 关卡/天命加持：对手整体变强（攻击、血量）
      const boost = opts.enemyBoost || 1;
      this.talents[0].stageBoost = 1;
      this.talents[1].stageBoost = boost;
      this.pools = this.packs.map((pk, i) => this.buildPool(pk, this.talents[i]));
      this.mods = {};
      this.wave = 0;
      this.waveT = 10;
      this.eventT = 25;
      this.sides = [new Side(0, this), new Side(1, this)];
      if (this.R.waves) {
        // 守关：上方没有对手经营，基地打不掉，冲到顶的兵算突围
        const e = this.sides[1];
        e.hp = e.maxHp = 1e9;
        e.incomeMult = 0;
      }
      if (this.R.startHero) {
        for (const s of this.sides) {
          const names = JQ.PACKS[s.pack].heroes.slice();
          const pickName = () => {
            // 自定义包带夏夏时，玩家开局送的英雄固定为夏夏
            if (s.id === 0 && JQ.heroInPack('夏夏', s.pack) && names.includes('夏夏')) {
              names.splice(names.indexOf('夏夏'), 1);
              return '夏夏';
            }
            return names.splice(Math.floor(this.rand() * names.length), 1)[0];
          };
          // 第一位放 (1,2)(1,3)；「双英」再解锁 (1,5) 放 (1,4)(1,5)
          const spots = [[1, 2], [1, 4]];
          for (let i = 0; i < 1 + s.T.extraHero && i < spots.length; i++) {
            const h = HEROES[pickName()];
            const [r, c] = spots[i];
            s.board.cell(r, c + 1).unlocked = true;
            s.board.place(JQ.makeCard('char', h.chars[0]), r, c);
            s.board.place(JQ.makeCard('char', h.chars[1]), r, c + 1);
          }
        }
      }
      this.units = [];
      this.projectiles = [];
      this.zones = [];
      this.timers = [];
      this.fx = [];
      this.time = 0;
      this.shake = 0;
      this.over = false;
      this.winner = null;
      this.listeners = [];
      // 每 10 关来一位开局敌将，作为关卡节奏点
      const bossLv = JQ.stageBoss(this.stage);
      if (bossLv && !this.R.waves) {
        const e = this.sides[1];
        const names = JQ.PACKS[e.pack].heroes;
        if (names.length) this.spawnHero(e, names[Math.floor(this.rand() * names.length)], bossLv, C.W / 2);
      }
      for (const s of this.sides) this.fillShop(s.id);
    }

    // 公共池（建筑/道具/格子）+ 本卡包的小兵 + 本卡包的字（字卡总权重固定，共用字加权）
    buildPool(pack, T) {
      const W = this.R.weights;
      const TW = (T && T.w) || {};
      let pool = JQ.POOL.map((p) => Object.assign({}, p, { w: p.w * (W[p.kind] || 1) * (TW[p.kind] || 1) }));
      for (const k of JQ.packUnits(pack)) pool.push({ kind: 'unit', key: k, w: JQ.C.UNIT_WEIGHT * (W.unit || 1) * (TW.unit || 1) });
      // 禁掉的兵种从卡池移除，剩下兵种按比例补足，兵卡总量不变
      const bans = (T && T.bans) || [];
      if (bans.length) {
        const unitW = pool.filter((p) => p.kind === 'unit').reduce((a, p) => a + p.w, 0);
        pool = pool.filter((p) => !(p.kind === 'unit' && bans.includes(p.key)));
        const left = pool.filter((p) => p.kind === 'unit').reduce((a, p) => a + p.w, 0);
        if (left > 0) for (const p of pool) if (p.kind === 'unit') p.w *= unitW / left;
      }
      const chars = JQ.packChars(pack);
      const shared = (ch) => (JQ.CHAR_HEROES[ch] || []).filter((n) => JQ.heroInPack(n, pack)).length > 1;
      const raw = chars.map((ch) => (shared(ch) ? 1.35 : 1));
      const sum = raw.reduce((a, b) => a + b, 0) || 1;
      chars.forEach((ch, i) => pool.push({ kind: 'char', key: ch, w: ((JQ.CHAR_WEIGHT * raw[i]) / sum) * (W.char || 1) * (TW.char || 1) }));
      pool.total = pool.reduce((t, p) => t + p.w, 0);
      return pool;
    }

    // 某个字能合成的英雄是否全部满级；全满后不再刷这个字
    charBlocked(s, ch) {
      const names = (JQ.CHAR_HEROES[ch] || []).filter((n) => JQ.heroInPack(n, s.pack));
      if (!names.length) return true;
      const lv = {};
      for (const l of s.board.links) lv[l.hero] = Math.max(lv[l.hero] || 0, l.level);
      return names.every((n) => (lv[n] || 0) >= C.MAX_LEVEL);
    }

    // 招兵池里剔除已经没用的字
    shopPool(sid) {
      const s = this.sides[sid], base = this.pools[sid];
      if (!base.some((p) => p.kind === 'char' && this.charBlocked(s, p.key))) return base;
      const pool = base.filter((p) => !(p.kind === 'char' && this.charBlocked(s, p.key)));
      pool.total = pool.reduce((t, p) => t + p.w, 0);
      return pool;
    }

    on(fn) {
      this.listeners.push(fn);
    }
    emit(ev, data) {
      for (const fn of this.listeners) fn(ev, data);
    }

    get overtime() {
      return this.time > this.R.time - this.R.overtime;
    }

    after(delay, fn) {
      this.timers.push({ at: this.time + delay, fn });
    }

    // ---------- 招兵栏 ----------
    // 场上的字还缺哪些字就能凑成新英雄
    wantedChars(sid) {
      const b = this.sides[sid].board;
      const linked = new Set(b.links.map((l) => l.hero));
      const want = new Set();
      for (const x of b.all()) {
        if (!x.card || x.card.kind !== 'char') continue;
        for (const name of JQ.CHAR_HEROES[x.card.key] || []) {
          if (linked.has(name) || !JQ.heroInPack(name, b.pack)) continue;
          const partner = JQ.partnerOf(name, x.card.key);
          if (partner && !this.charBlocked(this.sides[sid], partner)) want.add(partner);
        }
      }
      return [...want];
    }

    rollCard(sid, allowPity) {
      this.lastPity = false;
      const pool = this.shopPool(sid);
      let x = this.rand() * pool.total;
      let p = pool[0];
      for (const q of pool) {
        x -= q.w;
        if (x <= 0) {
          p = q;
          break;
        }
      }
      const s = this.sides[sid];
      // 自定义包带夏夏：前两张文字卡必出「夏」，方便尽早成夏夏
      if (p.kind === 'char' && JQ.heroInPack('夏夏', s.pack) && s.xiaGiven < 2) {
        s.xiaGiven++;
        return JQ.makeCard('char', '夏', 1);
      }
      if (p.kind === 'char' && allowPity !== false && this.rand() < Math.min(0.8, C.PARTNER_PITY + (s.T.charPity || 0))) {
        const want = this.wantedChars(sid);
        if (want.length) {
          this.lastPity = true;
          return JQ.makeCard('char', want[Math.floor(this.rand() * want.length)], 1);
        }
      }
      return JQ.makeCard(p.kind, p.key, 1);
    }

    fillShop(sid) {
      const s = this.sides[sid];
      let allowPity = true;
      for (let i = 0; i < C.SHOP_SIZE; i++) {
        s.shop[i] = this.rollCard(sid, allowPity);
        if (this.lastPity) allowPity = false; // 一次刷新最多保底一张，避免某个字刷屏
      }
      const b = s.board;
      const hasTile = () => s.shop.some((h) => h && h.kind === 'tile');
      if (hasTile()) s.tileDry = 0;
      else s.tileDry++;
      const putTile = (avoidChar) => {
        const keys = Object.keys(JQ.TILES).filter((k) => b.tileFits(k));
        if (!keys.length) return false;
        let slot = avoidChar ? s.shop.findIndex((c) => c && c.kind !== 'char') : Math.floor(this.rand() * C.SHOP_SIZE);
        if (slot < 0) return false;
        s.shop[slot] = JQ.makeCard('tile', keys[Math.floor(this.rand() * keys.length)]);
        s.tileDry = 0;
        return true;
      };
      // 长期不出格子：每 7 次刷新保底一块（「福星」可缩短到约 4 次）
      const need = Math.max(3, Math.round(7 * (s.T.tilePity || 1)));
      if (!hasTile() && s.tileDry >= need) putTile(true);
      if (!hasTile() && b.emptyCells().length <= 1 && b.frontier().length && this.rand() < C.TILE_PITY) putTile(false);
    }

    canRecruit(sid) {
      const s = this.sides[sid];
      return !this.over && s.buns + this.benchValue(sid) >= s.recruitCost();
    }

    // 招兵 = 先把备战席剩下的卡卖掉，再花包子把整排换新
    recruit(sid) {
      if (!this.canRecruit(sid)) return false;
      const s = this.sides[sid];
      const v = this.benchValue(sid);
      if (v) this.emit('sell', { side: sid, v, auto: true });
      const free = s.T.freeRecruit && this.rand() < s.T.freeRecruit;
      s.buns += v - (free ? 0 : s.recruitCost());
      if (free) this.addFx({ kind: 'text', x: C.W / 2, y: sid === 0 ? 1130 : 300, text: '富商：这次招兵免费', color: '#ffd23f', life: 1.2, size: 20 });
      s.refreshes++;
      this.fillShop(sid);
      this.emit('recruit', { side: sid });
      return true;
    }

    // 从招兵栏拿卡：放到格子 / 拼格子块 / 直接使用道具
    // allowReplace：落到场上不同的卡上时顶替它，被换下的卡回到这个备战席位
    take(sid, si, r, c, allowReplace) {
      const s = this.sides[sid];
      const card = s.shop[si];
      if (!card || this.over) return null;
      let how = null, old = null;
      if (card.kind === 'tile') {
        if (s.board.placeTile(card.key, r, c)) how = 'tile';
      } else if (card.kind === 'item' && r == null) {
        if (this.useItem(sid, card.key, card.level)) how = 'item';
      } else {
        how = s.board.place(card, r, c);
        if (!how && allowReplace && (old = s.board.swapIn(card, r, c))) how = 'replace';
      }
      if (!how) return null;
      s.shop[si] = old || null;
      this.afterBoardChange(s);
      this.emit('place', { side: sid, how, r, c, card });
      return how;
    }

    move(sid, r1, c1, r2, c2) {
      const s = this.sides[sid];
      if (this.over) return null;
      const how = s.board.move(r1, c1, r2, c2);
      if (how) {
        this.afterBoardChange(s);
        this.emit('place', { side: sid, how, r: r2, c: c2 });
      }
      return how;
    }

    // 卖价：几级就几包；格子块/道具 1 包。刷新一次 15 包起，卖一整排新卡回不了本
    sellValue(card, sid) {
      if (!card) return 0;
      const bonus = this.sides[sid || 0].T.sellBonus;
      const mult = this.sides[sid || 0].T.sellMult || 1;
      if (card.kind === 'tile') return Math.round((1 + bonus) * mult);
      return Math.round((card.level + bonus) * mult);
    }

    benchValue(sid) {
      return this.sides[sid].shop.reduce((t, c) => t + this.sellValue(c, sid), 0);
    }

    // 备战席内拖动：同名同级合成，否则换位
    benchMove(sid, i, j) {
      const s = this.sides[sid];
      const a = s.shop[i], b = s.shop[j];
      if (!a || i === j || this.over) return null;
      if (b && JQ.boardable(a) && JQ.sameCard(a, b) && JQ.cardLevelOk(b)) {
        b.level++;
        s.shop[i] = null;
        this.emit('place', { side: sid, how: 'merge' });
        return 'merge';
      }
      s.shop[i] = b;
      s.shop[j] = a;
      return b ? 'swap' : 'move';
    }

    // 场上的卡拖回备战席：空位=收回，同名同级=合成，其他卡=互换（对方得能上场）
    toBench(sid, r, c, j) {
      const s = this.sides[sid];
      const cell = s.board.cell(r, c);
      if (!cell || !cell.card || this.over) return null;
      const a = cell.card, b = s.shop[j];
      let how;
      if (!b) {
        s.shop[j] = s.board.remove(r, c);
        how = 'return';
      } else if (JQ.sameCard(a, b) && JQ.cardLevelOk(b)) {
        s.board.remove(r, c);
        b.level++;
        how = 'merge';
      } else if (JQ.boardable(b)) {
        cell.card = b;
        cell.cd = 0;
        s.shop[j] = a;
        s.board.rebuild();
        how = 'swap';
      } else return null;
      this.afterBoardChange(s);
      this.emit('place', { side: sid, how });
      return how;
    }

    sellShop(sid, j) {
      const s = this.sides[sid];
      const card = s.shop[j];
      if (!card) return 0;
      const v = this.sellValue(card, sid);
      s.shop[j] = null;
      s.buns += v;
      this.emit('sell', { side: sid, v });
      return v;
    }



    sellCell(sid, r, c) {
      const s = this.sides[sid];
      const card = s.board.remove(r, c);
      if (!card) return 0;
      const v = this.sellValue(card, sid);
      s.buns += v;
      this.afterBoardChange(s);
      this.emit('sell', { side: sid, v });
      return v;
    }

    useItem(sid, key, level) {
      const s = this.sides[sid];
      const lv = level || 1;
      const rc = JQ.cellRect(sid, 0, 3);
      if (key === '药') {
        if (s.hp >= s.maxHp) return false;
        const v = 400 * lv;
        s.hp = Math.min(s.maxHp, s.hp + v);
        this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 50, text: '基地 +' + v, color: '#5f5', life: 1.2, size: 28 });
        this.addFx({ kind: 'burst', x: rc.cx, y: JQ.baseLine(sid), color: '#7f7', n: 24, life: 0.8, speed: 180 });
      } else if (key === '金') {
        s.buns += 25 * lv;
        this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 50, text: `+${25 * lv} 包子`, color: '#ffd23f', life: 1.2, size: 28 });
      } else if (key === '令') {
        for (const x of s.board.all()) x.cd = 0;
        s.heroCd = {};
        const mine = this.units.filter((u) => u.side === sid && u.hp > 0);
        if (lv >= 2) for (const u of mine) if (u.isHero) (u.skillT = 0), (u.ultT = 0);
        if (lv >= 3) for (const u of mine) (u.atkBuff = Math.max(u.atkBuffUntil > this.time ? u.atkBuff : 1, 1.3)), (u.atkBuffUntil = this.time + 6);
        this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 50, text: ['军令如山！冷却清空', '军令如山！技能就绪', '军令如山！全军奋勇'][Math.min(2, lv - 1)], color: '#ffb000', life: 1.4, size: 26 });
      }
      this.emit('item', { side: sid, key });
      return true;
    }

    // 使用存在格子上的道具
    useCellItem(sid, r, c) {
      const s = this.sides[sid];
      const cell = s.board.cell(r, c);
      if (!cell || !cell.card || cell.card.kind !== 'item' || this.over) return false;
      if (!this.useItem(sid, cell.card.key, cell.card.level)) return false;
      s.board.remove(r, c);
      this.afterBoardChange(s);
      return true;
    }

    // 战场里的格子（前哨）都配一个有血量的哨所，敌人路过会打它
    syncOutposts(s) {
      for (const x of s.board.all()) {
        if (!x.forward || !x.unlocked || x.outpost) continue;
        const rc = JQ.cellRect(s.id, x.r, x.c);
        const hp = C.OUTPOST_HP * s.T.outpost;
        x.outpost = { id: nextUnitId++, side: s.id, key: '哨', isOutpost: true, cell: x, x: rc.cx, y: rc.cy, hp, maxHp: hp, atk: 0, range: 0, rate: 99, speed: 0, r: 26, atkT: 99, retarget: 0, target: null, stun: 0, shield: 0, anim: 0, flash: 0, born: this.time, kx: 0, ky: 0 };
        this.units.push(x.outpost);
      }
    }

    // 哨所被打掉：格子收回，卡退回备战席（满了就按卖价卖掉）
    loseOutpost(o) {
      const s = this.sides[o.side];
      const cell = o.cell;
      cell.outpost = null;
      if (cell.card) {
        const slot = s.shop.findIndex((c) => !c);
        if (slot >= 0) s.shop[slot] = cell.card;
        else s.buns += this.sellValue(cell.card, s.id);
        cell.card = null;
      }
      cell.unlocked = false;
      cell.cd = 0;
      s.board.rebuild();
      this.afterBoardChange(s);
      this.addFx({ kind: 'burst', x: o.x, y: o.y, color: '#8a7a6a', n: 30, life: 0.9, speed: 200 });
      this.addFx({ kind: 'text', x: o.x, y: o.y - 30, text: '前哨失守', color: '#ff6040', life: 1.2, size: 20 });
      this.shake = Math.max(this.shake, 6);
      this.emit('outpostLost', { side: s.id });
    }

    afterBoardChange(s) {
      this.syncOutposts(s);
      const path = s.board.path;
      if (!path.includes(s.walker.to)) s.walker.to = path.find((x) => x.crystal) || path[0];
    }

    // ---------- 主循环 ----------
    step(dt) {
      if (this.over) return;
      this.time += dt;
      this.shake = Math.max(0, this.shake - dt * 30);
      for (const s of this.sides) {
        s.buns += this.R.income * s.incomeMult * dt;
        if (s.T.baseRegen && s.hp > 0) s.hp = Math.min(s.maxHp, s.hp + s.T.baseRegen * dt);
        if (s.T.reinforce && (s.reinforceT = (s.reinforceT || 0) + dt) >= s.T.reinforce) {
          s.reinforceT = 0;
          for (let i = 0; i < 3; i++) this.spawnUnit(s, '刀', 1, C.W / 2 + (i - 1) * 30, { bonusSpawn: true });
          this.addFx({ kind: 'portal', x: C.W / 2, y: this.spawnY(s.id), r: 60, color: '#ffd23f', life: 0.9 });
        }
        for (const cell of s.board.all()) if (cell.cd > 0) cell.cd = Math.max(0, cell.cd - dt);
        for (const k of Object.keys(s.heroCd)) s.heroCd[k] = Math.max(0, s.heroCd[k] - dt);
        this.stepWalker(s, dt);
        this.stepTower(s, dt);
      }
      if (this.timers.length) {
        const due = this.timers.filter((t) => t.at <= this.time);
        this.timers = this.timers.filter((t) => t.at > this.time);
        for (const t of due) t.fn();
      }
      if (this.R.waves && (this.waveT -= dt) <= 0) this.spawnWave();
      if (this.R.events && (this.eventT -= dt) <= 0) this.fireEvent();
      this.stepZones(dt);
      this.stepUnits(dt);
      this.stepAutoMerge(dt);
      this.stepProjectiles(dt);
      for (const f of this.fx) f.t += dt;
      this.fx = this.fx.filter((f) => f.t < f.life);
      // 伤害数字是最费描边的特效：只留最新 36 条，避免大混战时满屏飘字拖慢帧率
      if (this.fx.length > 36) {
        let n = 0;
        for (let i = this.fx.length - 1; i >= 0; i--) {
          if (this.fx[i].kind !== 'text') continue;
          if (++n > 36) this.fx.splice(i, 1);
        }
      }

      for (const s of this.sides) {
        if (s.hp <= 0) {
          s.hp = 0;
          this.finish(1 - s.id);
          return;
        }
      }
      if (this.time >= this.R.time) {
        const a = this.sides[0].hp / this.sides[0].maxHp, b = this.sides[1].hp / this.sides[1].maxHp;
        this.finish(a === b ? -1 : a > b ? 0 : 1);
      }
    }

    finish(winner) {
      this.over = true;
      this.winner = winner;
      this.emit('over', { winner });
    }

    // 基地箭楼：射离基地线最近的敌人
    stepTower(s, dt) {
      s.towerT = (s.towerT || 0) - dt;
      if (s.towerT > 0) return;
      const by = JQ.baseLine(s.id);
      let best = null, bd = C.TOWER_RANGE;
      for (const u of this.units) {
        if (u.side === s.id || u.hp <= 0) continue;
        const d = Math.abs(u.y - by);
        if (d < bd) (bd = d), (best = u);
      }
      if (!best) return;
      s.towerT = C.TOWER_RATE;
      const x = Math.min(L.BX1 - 20, Math.max(L.BX0 + 20, best.x));
      this.projectiles.push({ kind: 'arrow', side: s.id, x, y: by, target: best, src: { side: s.id, ranged: true }, dmg: C.TOWER_DMG * s.T.tower, speed: 650, tower: true });
    }

    // 主角沿蛇形路线来回走，到站触发格子
    stepWalker(s, dt) {
      const w = s.walker;
      const path = s.board.path;
      if (w.p >= 1) {
        this.trigger(s, w.to);
        w.from = w.to;
        const i = path.indexOf(w.from);
        if (path.length > 1) {
          let j = i + w.dir;
          if (j < 0 || j >= path.length) {
            w.dir = -w.dir;
            j = i + w.dir;
          }
          w.to = path[j];
        }
        const a = JQ.cellRect(s.id, w.from.r, w.from.c), b = JQ.cellRect(s.id, w.to.r, w.to.c);
        const d = Math.hypot(a.cx - b.cx, a.cy - b.cy) / C.CELL;
        w.dur = this.R.walkTime * Math.max(0.6, d);
        w.p = 0;
      }
      w.p = Math.min(1, w.p + (dt * s.speedMult()) / w.dur);
      const a = JQ.cellRect(s.id, w.from.r, w.from.c), b = JQ.cellRect(s.id, w.to.r, w.to.c);
      const e = w.p < 0.5 ? 2 * w.p * w.p : 1 - Math.pow(-2 * w.p + 2, 2) / 2;
      w.x = a.cx + (b.cx - a.cx) * e;
      w.y = a.cy + (b.cy - a.cy) * e - Math.sin(w.p * Math.PI) * 8;
    }

    trigger(s, cell) {
      const rc = JQ.cellRect(s.id, cell.r, cell.c);
      if (cell.crystal) {
        s.buns += this.R.crystal;
        this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 24, text: '+' + this.R.crystal, color: '#ffcf5a', life: 0.8, size: 20, bun: true });
        return;
      }
      const card = cell.card;
      if (!card) return;
      if (card.kind === 'unit') {
        if (cell.cd > 0) return;
        const free = s.unitCap(card.key) - s.aliveCount(card.key);
        const n = Math.min(JQ.unitCount(card.level), free);
        if (n <= 0) {
          this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 24, text: '满员', color: '#ccc', life: 0.6, size: 16 });
          return;
        }
        const fy = cell.forward ? { y: rc.cy + (s.id === 0 ? -18 : 18) } : null;
        for (let i = 0; i < n; i++) this.spawnUnit(s, card.key, card.level, rc.cx + (i - (n - 1) / 2) * 20, fy);
        cell.cd = UNITS[card.key].cd * s.cdMult();
        this.addFx({ kind: 'pulse', x: rc.cx, y: rc.cy, life: 0.4, side: s.id, size: C.CELL / 2 });
      } else if (card.kind === 'char') {
        for (const link of cell.links) this.tryHero(s, link);
      } else if (card.kind === 'building' && card.key === '粮') {
        const v = 3 * card.level;
        s.buns += v;
        this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 24, text: '+' + v, color: '#ffcf5a', life: 0.8, size: 20, bun: true });
      }
    }

    tryHero(s, link) {
      const alive = s.heroAlive[link.hero];
      const [A, B] = link.cells.map((x) => JQ.cellRect(s.id, x.r, x.c));
      const cx = (A.cx + B.cx) / 2, cy = (A.cy + B.cy) / 2;
      if (alive) {
        if (link.level > alive.level) this.upgradeHero(alive, link.level);
        return;
      }
      if ((s.heroCd[link.hero] || 0) > 0) return;
      this.spawnHero(s, link.hero, link.level, cx, link.cells[0].forward ? { y: cy + (s.id === 0 ? -18 : 18) } : null);
      s.heroCd[link.hero] = HEROES[link.hero].cd * s.cdMult();
      this.addFx({ kind: 'pulse', x: cx, y: cy, life: 0.6, side: s.id, size: C.CELL, color: HEROES[link.hero].aura });
    }

    spawnY(side) {
      return side === 0 ? L.P_TOP - 14 : L.E_BOTTOM + 14;
    }

    spawnUnit(s, key, level, x, extra) {
      const d = UNITS[key];
      const T = s.T;
      const stage = T.stageBoost || 1;
      const m = JQ.levelMult(level);
      const u = {
        id: nextUnitId++, side: s.id, key, isHero: false, level,
        x: x + (this.rand() - 0.5) * 8, y: this.spawnY(s.id) + (this.rand() - 0.5) * 8,
        hp: d.hp * m * T.unitHp * stage, maxHp: d.hp * m * T.unitHp * stage, atk: d.atk * m * s.atkMult() * T.unitAtk * T.allAtk * stage, range: d.range, rate: d.rate, speed: d.speed * T.unitSpeed,
        ranged: !!d.ranged, assassin: !!d.assassin, magic: !!d.magic, bonus: d.bonus || null, rangedReduce: d.rangedReduce || 0, healAura: d.healAura || null,
        r: 14, atkT: 0.3, retarget: 0, target: null, stun: 0, shield: 0, anim: 0, flash: 0, born: this.time, kx: 0, ky: 0,
      };
      if (d.melee) u.atk *= T.meleeAtk || 1;
      if (d.ranged) (u.atk *= T.rangedAtk || 1), (u.range += T.rangedRange || 0);
      if (key === '弓' && T.bowDouble) u.doubleShot = T.bowDouble;
      if (d.assassin) (u.atk *= T.assassinAtk || 1), T.assassinStealth && (u.stealthUntil = this.time + T.assassinStealth);
      if (d.stealth) u.stealthUntil = Math.max(u.stealthUntil || 0, this.time + d.stealth);
      if (key === '盾') u.hp = u.maxHp = u.maxHp * (T.shieldHp || 1);
      if (key === '枪' && T.spearBonus) u.bonus = { hero: T.spearBonus };
      const splash = Math.max(d.splash || 0, key === '剑' ? T.swordSplash || 0 : 0);
      if (splash) u.passive = { splash: { n: 1, pct: splash } };
      u.lifesteal = T.unitLifesteal || 0;
      u.deathBlast = T.deathBlast || 0;
      Object.assign(u, extra || {});
      this.units.push(u);
      s.stats.summoned++;
      return u;
    }

    // extra.clone=true 时是悟空分身：不占英雄位、不放技能、到时消失
    spawnHero(s, name, level, x, extra) {
      const d = HEROES[name];
      const m = JQ.heroLevelMult(level);
      const P = d.passive || {};
      const stage = s.T.stageBoost || 1;
      const u = {
        id: nextUnitId++, side: s.id, key: name, isHero: true, level,
        x, y: this.spawnY(s.id) - (s.id === 0 ? 10 : -10),
        hp: d.hp * m * s.T.heroHp * stage, maxHp: d.hp * m * s.T.heroHp * stage, atk: d.atk * m * (P.atkMult || 1) * (s.T.heroAtk || 1) * s.T.allAtk * stage, range: d.range + (s.T.heroRange || 0), rate: d.rate, speed: d.speed, ultCdMult: s.T.ultCd,
        ranged: !!d.ranged, magic: !!d.magic, assassin: !!d.assassin, proj: d.proj || null, passive: P,
        lifesteal: P.lifesteal || 0, bonus: null, rangedReduce: P.rangedReduce || 0,
        r: 24, atkT: 0.5, retarget: 0, target: null, stun: 0, shield: 0, anim: 0, flash: 0, born: this.time, kx: 0, ky: 0,
        skillT: d.skill.cd * 0.5, ultT: d.ult.cd * 0.4, incomeT: 0, shieldT: 0,
      };
      if (P.stealth) u.stealthUntil = this.time + P.stealth;
      Object.assign(u, extra || {});
      this.units.push(u);
      if (u.clone) return u;
      s.heroAlive[name] = u;
      s.stats.heroes++;
      this.addFx({ kind: 'burst', x, y: u.y, color: d.aura, n: 30, life: 0.9, speed: 220 });
      this.addFx({ kind: 'ring', x, y: u.y, r: 70, life: 0.6, color: d.aura });
      this.emit('hero', { side: s.id, name });
      return u;
    }

    upgradeHero(u, level) {
      const m = JQ.heroLevelMult(level) / JQ.heroLevelMult(u.level);
      u.level = level;
      u.maxHp *= m;
      u.hp = Math.min(u.maxHp, u.hp * m + u.maxHp * 0.2);
      u.atk *= m;
      this.addFx({ kind: 'burst', x: u.x, y: u.y, color: '#ffe680', n: 24, life: 0.8, speed: 160 });
    }

    // 隐身单位只有“天眼”看得见
    canSee(u, f) {
      return !(f.stealthUntil > this.time) || !!(u.passive && u.passive.trueSight);
    }

    pickTarget(u, foes, maxD) {
      let best = null, bd = Infinity;
      const aggro = maxD || Math.max(200, u.range + 60);
      if (u.assassin) {
        for (const f of foes) {
          if (!f.ranged || f.hp <= 0 || !this.canSee(u, f)) continue;
          const d = Math.hypot(f.x - u.x, f.y - u.y);
          if (d < 480 && d < bd) (bd = d), (best = f);
        }
        if (best) return best;
      }
      for (const f of foes) {
        if (f.hp <= 0 || !this.canSee(u, f)) continue;
        const d = Math.hypot(f.x - u.x, f.y - u.y);
        if (d < aggro && d < bd) (bd = d), (best = f);
      }
      return best;
    }

    // 范围内敌人最密集的点（英雄按 3 个算）
    densest(u, foes, radius, maxRange) {
      let best = null, bn = 0;
      for (const f of foes) {
        if (f.hp <= 0 || Math.hypot(f.x - u.x, f.y - u.y) > maxRange) continue;
        let n = 0;
        for (const g of foes) if (g.hp > 0 && Math.hypot(g.x - f.x, g.y - f.y) < radius) n += g.isHero ? 3 : 1;
        if (n > bn) (bn = n), (best = f);
      }
      return best;
    }

    // 光环类被动：每帧重算
    stepAuras(dt) {
      for (const u of this.units) u.auraAtk = u.auraDr = u.auraSlow = u.haste = 0;
      for (const s of this.sides) {
        if (!s.T.command) continue;
        for (const h of this.units) {
          if (h.side !== s.id || !h.isHero || h.clone || h.hp <= 0) continue;
          for (const o of this.units) if (o.side === s.id && !o.isHero && Math.hypot(o.x - h.x, o.y - h.y) < 160) o.haste = s.T.command;
        }
      }
      for (const h of this.units) {
        const P = h.passive;
        if (!P || h.hp <= 0 || h.clone) continue;
        if (P.auraAtk || P.auraDr || P.auraRegen || P.auraSlow) {
          for (const o of this.units) {
            if (o.hp <= 0) continue;
            const d = Math.hypot(o.x - h.x, o.y - h.y);
            if (o.side === h.side) {
              if (P.auraAtk && d < P.auraAtk.r) o.auraAtk = Math.max(o.auraAtk, P.auraAtk.pct);
              if (P.auraDr && d < P.auraDr.r) o.auraDr = Math.max(o.auraDr, P.auraDr.pct);
              if (P.auraRegen && d < P.auraRegen.r && o.hp < o.maxHp) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * P.auraRegen.pct * dt);
            } else if (P.auraSlow && d < P.auraSlow.r) o.auraSlow = Math.max(o.auraSlow, P.auraSlow.pct);
          }
        }
      }
      // 僧兵：给身边友军回血
      for (const u of this.units) {
        const H = u.healAura;
        if (!H || u.hp <= 0) continue;
        for (const o of this.units) {
          if (o.side !== u.side || o.hp <= 0 || o.hp >= o.maxHp) continue;
          if (Math.hypot(o.x - u.x, o.y - u.y) < H.r) o.hp = Math.min(o.maxHp, o.hp + o.maxHp * H.pct * dt);
        }
      }
    }

    // 夏夏：每 1 秒把两张同级小兵按“拖动合成”的规则自动合掉
    stepAutoMerge(dt) {
      for (const s of this.sides) {
        const h = s.heroAlive['夏夏'];
        if (!h || h.hp <= 0) continue;
        const every = ((h.passive && h.passive.autoMerge && h.passive.autoMerge.every) || 1) * (s.T.autoMerge || 1);
        h.autoT = (h.autoT || 0) + dt;
        if (h.autoT < every) continue;
        h.autoT = 0;
        // 优先合场上，场上没有可合的再合备战席
        const cells = s.board.all().filter((x) => x.card && x.card.kind === 'unit' && JQ.cardLevelOk(x.card));
        let pair = null;
        for (let i = 0; i < cells.length && !pair; i++)
          for (let j = i + 1; j < cells.length; j++)
            if (JQ.sameCard(cells[i].card, cells[j].card)) {
              pair = [cells[i], cells[j]];
              break;
            }
        if (pair) {
          const [a, b] = pair;
          const rc = JQ.cellRect(s.id, b.r, b.c);
          if (this.move(s.id, a.r, a.c, b.r, b.c) === 'merge') {
            this.addFx({ kind: 'ring', x: rc.cx, y: rc.cy, r: 38, life: 0.5, color: HEROES['夏夏'].aura });
            this.addFx({ kind: 'text', x: rc.cx, y: rc.cy - 26, text: '巧手', color: HEROES['夏夏'].aura, life: 0.7, size: 16 });
            // 巧手造物：合成后额外召出一个同等级单位，每局最多 3 次
            const merged = b.card;
            if (merged && merged.kind === 'unit' && s.xiaCraft < 3 && s.unitCap(merged.key) > s.aliveCount(merged.key)) {
              s.xiaCraft++;
              this.spawnUnit(s, merged.key, merged.level, rc.cx, { y: rc.cy, bonusSpawn: true });
              this.addFx({ kind: 'text', x: rc.cx, y: rc.cy + 26, text: `造物 ${s.xiaCraft}/3`, color: HEROES['夏夏'].aura, life: 0.8, size: 14 });
            }
          }
        } else {
          // 场上没有可合的，就合备战席（同样走拖动合成的规则）
          let benchPair = null;
          for (let i = 0; i < s.shop.length && !benchPair; i++) {
            const a = s.shop[i];
            if (!a || a.kind !== 'unit' || !JQ.cardLevelOk(a)) continue;
            for (let j = i + 1; j < s.shop.length; j++) {
              const b = s.shop[j];
              if (b && b.kind === 'unit' && JQ.sameCard(a, b)) {
                benchPair = [i, j];
                break;
              }
            }
          }
          if (benchPair) {
            const [i, j] = benchPair;
            if (this.benchMove(s.id, i, j) === 'merge') {
              const rc = JQ.shopRect ? JQ.shopRect(j) : { x: C.W / 2, y: s.id === 0 ? 1150 : 150, w: 0, h: 0 };
              this.addFx({ kind: 'ring', x: rc.x + rc.w / 2, y: rc.y + rc.h / 2, r: 28, life: 0.5, color: HEROES['夏夏'].aura });
              this.addFx({ kind: 'text', x: rc.x + rc.w / 2, y: rc.y + 8, text: '巧手', color: HEROES['夏夏'].aura, life: 0.7, size: 14 });
            }
          }
        }
      }
    }

    // 自身被动与持续状态：回血、产包子、周期护盾、灼烧、分身到期
    stepStatus(u, dt) {
      const P = u.passive;
      if (u.expire && this.time > u.expire) {
        u.hp = 0;
        this.addFx({ kind: 'clone', x: u.x, y: u.y, color: HEROES[u.key].aura, life: 0.6 });
        return false;
      }
      if (P && !u.clone) {
        if (P.regen && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * P.regen * dt);
        if (P.income && (u.incomeT += dt) >= P.income.every) {
          u.incomeT = 0;
          this.sides[u.side].buns += P.income.buns;
          this.addFx({ kind: 'text', x: u.x, y: u.y - 40, text: '+' + P.income.buns, color: '#ffcf5a', life: 0.9, size: 18, bun: true });
        }
        if (P.periodicShield && (u.shieldT += dt) >= P.periodicShield.every) {
          u.shieldT = 0;
          u.shield = Math.max(u.shield, u.maxHp * P.periodicShield.pct);
          this.addFx({ kind: 'ring', x: u.x, y: u.y, r: 40, life: 0.5, color: '#ffd700' });
        }
      }
      if (u.burnUntil > this.time) {
        u.burnAcc = (u.burnAcc || 0) + u.burnDps * dt;
        if ((u.burnTick = (u.burnTick || 0) - dt) <= 0) {
          u.burnTick = 0.5;
          const v = u.burnAcc;
          u.burnAcc = 0;
          this.addFx({ kind: 'burn', x: u.x, y: u.y - 6, color: '#ff6a20', life: 0.45 });
          this.damage(u.burnSrc, u, v, { skill: true, dot: true });
        }
      }
      return u.hp > 0;
    }

    stepUnits(dt) {
      this.stepAuras(dt);
      const foesBySide = [this.units.filter((u) => u.side !== 0), this.units.filter((u) => u.side !== 1)];
      for (const u of this.units) {
        if (u.hp <= 0) continue;
        u.anim = Math.max(0, u.anim - dt);
        u.flash = Math.max(0, u.flash - dt);
        u.atkT -= dt * (1 + (u.haste || 0));
        if (!this.stepStatus(u, dt)) continue;
        if (u.isOutpost) continue;
        if ((u.kx || u.ky) && !u.isOutpost) {
          u.x += u.kx * dt;
          u.y += u.ky * dt;
          u.kx *= Math.pow(0.02, dt);
          u.ky *= Math.pow(0.02, dt);
          if (Math.abs(u.kx) + Math.abs(u.ky) < 5) u.kx = u.ky = 0;
        }
        if (u.isHero && this.stepHeroAction(u, dt, foesBySide[u.side])) continue;
        if (u.stun > 0) {
          u.stun -= dt;
          continue;
        }
        if (u.isHero && !u.clone) this.stepSkill(u, dt, foesBySide[u.side]);
        if (u.hp <= 0 || u.action) continue;
        u.retarget -= dt;
        if (u.tauntUntil > this.time && u.tauntBy && u.tauntBy.hp > 0) u.target = u.tauntBy;
        else if (!u.target || u.target.hp <= 0 || u.retarget <= 0 || !this.canSee(u, u.target)) {
          u.target = this.pickTarget(u, foesBySide[u.side]);
          u.retarget = 0.3;
        }
        const t = u.target;
        if (t) {
          const d = Math.hypot(t.x - u.x, t.y - u.y);
          const reach = u.range + u.r + t.r;
          if (d > reach) this.moveToward(u, t.x, t.y, dt);
          else if (u.atkT <= 0) this.attack(u, t, foesBySide[u.side]);
        } else if (this.R.waves && u.side === 0) {
          // 无限模式：没有敌人时回到前线集结点待命，不再冲到顶消失
          const ry = L.E_BOTTOM + 170 + (u.isHero ? 30 : 0);
          if (Math.abs(u.y - ry) > 16) this.moveToward(u, Math.min(L.BX1 - 20, Math.max(L.BX0 + 20, u.x)), ry, dt);
        } else {
          // 无敌可打：冲对方基地
          const by = JQ.baseLine(1 - u.side);
          const dy = Math.abs(u.y - by);
          if (dy > u.range + u.r) {
            const tx = Math.min(L.BX1 - 20, Math.max(L.BX0 + 20, u.x));
            this.moveToward(u, tx, by, dt);
          } else if (u.atkT <= 0) this.attackBase(u);
        }
      }
      // 互相挤开
      const us = this.units;
      for (let i = 0; i < us.length; i++) {
        const a = us[i];
        if (a.hp <= 0) continue;
        for (let j = i + 1; j < us.length; j++) {
          const b = us[j];
          if (b.hp <= 0) continue;
          const dx = b.x - a.x, dy = b.y - a.y;
          const min = (a.r + b.r) * (a.side === b.side ? 0.85 : 0.7);
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2), push = (min - d) / 2;
          // 哨所只挡敌人；自己人直接穿过（否则前排铺满前哨会把自己的兵堵在基地里）
          if ((a.isOutpost || b.isOutpost) && (a.side === b.side || (a.isOutpost && b.isOutpost))) continue;
          const wa = a.isOutpost ? 0 : b.isOutpost ? 2 : a.isHero && !b.isHero ? 0.3 : 1;
          const wb = b.isOutpost ? 0 : a.isOutpost ? 2 : b.isHero && !a.isHero ? 0.3 : 1;
          a.x -= (dx / d) * push * wa; a.y -= (dy / d) * push * wa;
          b.x += (dx / d) * push * wb; b.y += (dy / d) * push * wb;
        }
      }
      for (const u of us) {
        if (u.isOutpost) continue;
        u.x = Math.min(C.W - 14, Math.max(14, u.x));
        u.y = Math.min(L.P_TOP - u.r * 0.5, Math.max(L.E_BOTTOM + u.r * 0.5, u.y));
      }
      this.units = us.filter((u) => u.hp > 0);
    }

    moveToward(u, tx, ty, dt) {
      const dx = tx - u.x, dy = ty - u.y;
      const d = Math.hypot(dx, dy) || 1;
      const slow = Math.max(u.slowUntil > this.time ? u.slowPct : 0, u.auraSlow || 0);
      const sp = u.speed * dt * (1 - slow);
      u.x += (dx / d) * sp;
      u.y += (dy / d) * sp;
      u.facing = dx >= 0 ? 1 : -1;
    }

    attack(u, t, foes) {
      u.atkT = u.rate;
      u.anim = 0.2;
      u.facing = t.x >= u.x ? 1 : -1;
      if (u.ranged) {
        const color = u.isHero ? HEROES[u.key].aura : null;
        this.projectiles.push({ kind: u.magic ? 'orb' : 'arrow', look: u.proj, side: u.side, x: u.x, y: u.y, target: t, src: u, dmg: u.atk, speed: u.magic ? 380 : 560, color });
        if (u.doubleShot && this.rand() < u.doubleShot) {
          const t2 = (foes || []).find((f) => f !== t && f.hp > 0 && Math.hypot(f.x - u.x, f.y - u.y) < u.range + 40) || t;
          this.projectiles.push({ kind: 'arrow', side: u.side, x: u.x + 6, y: u.y, target: t2, src: u, dmg: u.atk, speed: 600 });
        }
        return;
      }
      this.damage(u, t, u.atk);
      this.addFx({ kind: 'slash', x: (u.x + t.x) / 2, y: (u.y + t.y) / 2, life: 0.2, side: u.side, ang: Math.atan2(t.y - u.y, t.x - u.x), big: u.isHero, color: u.isHero ? HEROES[u.key].aura : null });
      // 三头六臂：顺带打到附近几个敌人
      const sp = u.passive && u.passive.splash;
      if (sp && foes) {
        const others = foes.filter((f) => f !== t && f.hp > 0 && Math.hypot(f.x - t.x, f.y - t.y) < 80).slice(0, sp.n);
        for (const f of others) {
          this.damage(u, f, u.atk * sp.pct);
          this.addFx({ kind: 'slash', x: f.x, y: f.y, life: 0.2, side: u.side, ang: Math.atan2(f.y - u.y, f.x - u.x), big: u.isHero, color: u.isHero ? HEROES[u.key].aura : null });
        }
      }
    }

    attackBase(u) {
      u.atkT = u.rate;
      u.anim = 0.2;
      const enemy = this.sides[1 - u.side];
      const dmg = u.atk * C.BASE_DMG * (this.overtime ? C.OVERTIME_ATK : 1) * (1 - (enemy.T.baseDr || 0));
      enemy.hp -= dmg;
      this.sides[u.side].stats.baseDmg += dmg;
      const by = JQ.baseLine(enemy.id);
      this.addFx({ kind: 'text', x: u.x + (this.rand() - 0.5) * 20, y: by + (enemy.id === 0 ? 14 : -14), text: '-' + Math.round(dmg), color: '#ff5040', life: 0.7, size: 18 });
      this.addFx({ kind: 'burst', x: u.x, y: by, color: '#ffb070', n: 5, life: 0.4, speed: 90 });
      if (enemy.id === 0) this.shake = Math.max(this.shake, 2.5);
      this.emit('baseHit', { side: enemy.id });
    }

    // opts：skill 技能伤害（不会被闪避、不触发普攻类被动）/ ult 大招 / dot 持续伤害 / burn 秒数 / reflect 反伤
    damage(src, t, amount, opts) {
      opts = opts || {};
      if (t.hp <= 0 || (t.invulnUntil && t.invulnUntil > this.time)) return;
      const SP = (src && src.passive) || {}, TP = t.passive || {};
      // 闪避：只躲普通攻击，天眼无视
      if (!opts.skill && TP.dodge && !SP.trueSight && this.rand() < TP.dodge) {
        this.addFx({ kind: 'text', x: t.x, y: t.y - t.r - 6, text: '闪', color: '#9fd8ff', life: 0.5, size: 15 });
        return;
      }
      let mult = this.overtime ? C.OVERTIME_ATK : 1;
      if (this.mods.rageUntil > this.time) mult *= 1.6;
      if (src && src.bonus) {
        const k = t.isHero ? 'hero' : t.key;
        if (src.bonus[k]) mult *= src.bonus[k];
      }
      if (src && src.ranged && t.rangedReduce && !opts.skill) mult *= 1 - t.rangedReduce;
      if (src && src.atkBuffUntil > this.time) mult *= src.atkBuff;
      if (src && src.auraAtk) mult *= 1 + src.auraAtk;
      if (src && src.side != null && this.sides[src.side].T.lastStand && this.sides[src.side].hp < this.sides[src.side].maxHp * 0.3) mult *= 1.4;
      let crit = false;
      if (!opts.dot) {
        if (SP.crit && this.rand() < SP.crit) (mult *= SP.critMult || 2), (crit = true);
        if (SP.heroBonus && t.isHero) mult *= 1 + SP.heroBonus;
        if (SP.longShot && Math.hypot(t.x - src.x, t.y - src.y) > 160) mult *= 1 + SP.longShot;
        if (SP.rage) mult *= 1 + SP.rage * (1 - src.hp / src.maxHp);
      }
      if (t.drUntil > this.time) mult *= 1 - t.dr;
      if (TP.dr) mult *= 1 - TP.dr;
      if (TP.lowHpDr && t.hp < t.maxHp * TP.lowHpDr.below) mult *= 1 - TP.lowHpDr.dr;
      if (TP.vuln) mult *= 1 + TP.vuln;
      if (t.auraDr) mult *= 1 - t.auraDr;
      if (!t.isHero && this.sides[t.side] && this.sides[t.side].T.unitDr) mult *= 1 - this.sides[t.side].T.unitDr;
      // 主场加成：在自家基地附近作战的一方占便宜，防止一波推平；决战时刻取消，免得僵持到底
      if (!this.overtime) {
        if (src && src.y != null && Math.abs(src.y - JQ.baseLine(src.side)) < C.HOME_RANGE) mult *= 1 + C.HOME_BONUS;
        if (Math.abs(t.y - JQ.baseLine(t.side)) < C.HOME_RANGE) mult *= 1 - C.HOME_BONUS;
      }
      let dmg = amount * mult;
      const shown = dmg;
      if (t.shield > 0) {
        const ab = Math.min(t.shield, dmg);
        t.shield -= ab;
        dmg -= ab;
      }
      t.hp -= dmg;
      t.flash = 0.12;
      if (src && src.lifesteal && src.hp > 0) src.hp = Math.min(src.maxHp, src.hp + dmg * src.lifesteal);
      // 命中附带的被动
      if (src && !opts.dot && !opts.reflect) {
        if (SP.burn) this.ignite(t, src, src.atk * SP.burn.pct, SP.burn.dur);
        if (opts.burn) this.ignite(t, src, src.atk * 0.5, opts.burn);
        if (SP.slowOnHit) (t.slowUntil = this.time + SP.slowOnHit.dur), (t.slowPct = SP.slowOnHit.pct);
        if (SP.knockOnHit && !opts.skill) {
          const d = Math.hypot(t.x - src.x, t.y - src.y) || 1;
          const k = t.isHero ? 0.3 : 1;
          t.kx = ((t.x - src.x) / d) * SP.knockOnHit * k;
          t.ky = ((t.y - src.y) / d) * SP.knockOnHit * k;
        }
        if (!opts.skill && src.hp > 0) {
          if (TP.thorns && !src.ranged) this.damage(t, src, dmg * TP.thorns, { skill: true, reflect: true });
          if (TP.charmOnHit && this.rand() < TP.charmOnHit) (src.stun = Math.max(src.stun, 1)), (src.charmUntil = this.time + 1);
        }
      }
      if (opts.dot) {
        if (shown >= 5) this.addFx({ kind: 'text', x: t.x + 10, y: t.y - t.r, text: String(Math.round(shown)), color: '#ff8a3a', life: 0.6, size: 13 });
      } else if (opts.skill || crit || (src && src.isHero) || t.isHero) {
        const ult = opts.ult;
        this.addFx({ kind: 'text', x: t.x + (this.rand() - 0.5) * 18, y: t.y - t.r - 6, text: (crit ? '暴击 ' : '') + Math.round(shown), color: ult || crit ? '#ff4d2e' : opts.skill ? '#ffd23f' : '#fff', life: 0.75, size: ult ? 26 : crit ? 22 : opts.skill ? 21 : 15, crit: !!(ult || crit) });
      }
      if (t.hp <= 0) this.kill(t, src);
    }

    ignite(t, src, dps, dur) {
      if (t.burnUntil > this.time && t.burnDps > dps) return (t.burnUntil = Math.max(t.burnUntil, this.time + dur));
      t.burnUntil = this.time + dur;
      t.burnDps = dps;
      t.burnSrc = src;
    }

    heal(u, amount) {
      if (u.hp <= 0 || u.hp >= u.maxHp) return;
      u.hp = Math.min(u.maxHp, u.hp + amount);
      this.addFx({ kind: 'text', x: u.x, y: u.y - u.r - 8, text: '+' + Math.round(amount), color: '#5f5', life: 0.8, size: 16 });
    }

    kill(t, src) {
      const owner = this.sides[t.side];
      const killer = this.sides[1 - t.side];
      if (t.isOutpost) {
        killer.buns += 3 + (killer.T.killBuns || 0);
        return this.loseOutpost(t);
      }
      killer.stats.kills++;
      killer.buns += (t.isHero && !t.clone ? C.HERO_KILL_BUNS : C.KILL_BUNS) + (killer.T.killBuns || 0);
      this.addFx({ kind: 'ink', x: t.x, y: t.y, life: 0.9, side: t.side, big: t.isHero, text: t.key });
      if (t.deathBlast && this.rand() < t.deathBlast) {
        for (const f of this.units) if (f.side !== t.side && f.hp > 0 && !f.isOutpost && Math.hypot(f.x - t.x, f.y - t.y) < 70) this.damage(null, f, 60 + t.maxHp * 0.3, { skill: true });
        this.addFx({ kind: 'meteor', x: t.x, y: t.y, r: 70, color: '#ff6020', life: 0.6, t: 0 });
      }
      if (t.isHero && !t.clone) {
        if (owner.heroAlive[t.key] === t) delete owner.heroAlive[t.key];
        owner.heroCd[t.key] = Math.max(owner.heroCd[t.key] || 0, HEROES[t.key].cd * 0.6 * owner.cdMult() * (owner.T.heroRespawn || 1));
        this.addFx({ kind: 'burst', x: t.x, y: t.y, color: HEROES[t.key].aura, n: 30, life: 1, speed: 200 });
        this.emit('heroDie', { side: t.side, name: t.key });
      }
    }

    stepProjectiles(dt) {
      for (const p of this.projectiles) {
        p.life = (p.life || 0) + dt;
        if (p.kind === 'pierce') {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          for (const f of this.units) {
            if (f.side === p.side || f.hp <= 0 || p.hit.has(f.id)) continue;
            if (Math.hypot(f.x - p.x, f.y - p.y) < f.r + (p.width || 16)) {
              p.hit.add(f.id);
              this.damage(p.src, f, p.dmg, { skill: true, ult: p.ult });
            }
          }
          if (p.life > (p.maxLife || 1.2) || p.y < 0 || p.y > C.H) p.dead = true;
          continue;
        }
        let t = p.target;
        if (!t || t.hp <= 0) {
          if (p.kind === 'fox') {
            // 追踪弹丢了目标就换一个
            const foes = this.units.filter((u) => u.side !== p.side);
            t = p.target = this.pickTarget({ x: p.x, y: p.y, range: 300 }, foes, 400);
          }
          if (!t) {
            p.dead = true;
            continue;
          }
        }
        const dx = t.x - p.x, dy = t.y - p.y;
        const d = Math.hypot(dx, dy);
        const sp = p.speed * dt;
        if (d <= sp + 8) {
          p.dead = true;
          this.damage(p.src, t, p.dmg, p.kind === 'fox' ? { skill: true, ult: p.ult } : null);
          if (p.kind === 'fox') this.addFx({ kind: 'burst', x: t.x, y: t.y, color: p.color, n: 10, life: 0.5, speed: 120 });
        } else if (p.kind === 'fox') {
          // 弧线追踪
          const want = Math.atan2(dy, dx);
          p.ang = p.ang == null ? want : p.ang + Math.atan2(Math.sin(want - p.ang), Math.cos(want - p.ang)) * Math.min(1, dt * 7);
          p.x += Math.cos(p.ang) * sp;
          p.y += Math.sin(p.ang) * sp;
          if (p.life > 3) p.dead = true;
        } else {
          p.x += (dx / d) * sp;
          p.y += (dy / d) * sp;
          p.ang = Math.atan2(dy, dx);
        }
      }
      this.projectiles = this.projectiles.filter((p) => !p.dead);
    }

    stepZones(dt) {
      for (const z of this.zones) {
        z.tickT -= dt;
        if (z.tickT > 0) continue;
        z.tickT = z.tick;
        for (const f of this.units) {
          if (f.side === z.side || f.hp <= 0 || Math.hypot(f.x - z.x, f.y - z.y) > z.r) continue;
          this.damage(z.src, f, z.dmg, { skill: true });
          if (z.stun) f.stun = Math.max(f.stun, z.tick + 0.05);
          if (z.slow) (f.slowUntil = this.time + z.tick + 0.1), (f.slowPct = z.slow);
        }
      }
      this.zones = this.zones.filter((z) => z.until > this.time);
    }

    // ---------- 英雄技能与大招 ----------
    // 冲锋、跳跃、连斩、旋风这类持续动作：返回 true 表示本帧被动作占用
    stepHeroAction(u, dt, foes) {
      const a = u.action;
      if (!a) return false;
      const aura = HEROES[u.key].aura;
      if (a.type === 'dash') {
        u.x += a.vx * dt;
        u.y += a.vy * dt;
        for (const f of foes) {
          if (f.hp <= 0 || a.hit.has(f.id) || Math.hypot(f.x - u.x, f.y - u.y) > 46) continue;
          a.hit.add(f.id);
          this.damage(u, f, u.atk * a.mult, { skill: true, ult: a.ult });
          if (a.knock) {
            const d = Math.hypot(f.x - u.x, f.y - u.y) || 1;
            f.kx = ((f.x - u.x) / d) * 260 + a.vx * 0.3;
            f.ky = ((f.y - u.y) / d) * 260 + a.vy * 0.3;
          }
        }
        this.addFx({ kind: 'after', x: u.x, y: u.y, text: u.key, color: aura, life: 0.35 });
        if (this.time >= a.until) u.action = null;
        return true;
      }
      if (a.type === 'leap') {
        const k = Math.min(1, (this.time - a.t0) / a.dur);
        u.x = a.fx + (a.tx - a.fx) * k;
        u.y = a.fy + (a.ty - a.fy) * k;
        u.lift = Math.sin(k * Math.PI) * 120;
        if (k >= 1) {
          u.lift = 0;
          u.action = null;
          for (const f of foes) {
            if (f.hp <= 0 || Math.hypot(f.x - u.x, f.y - u.y) > a.r) continue;
            this.damage(u, f, u.atk * a.mult, { skill: true, ult: a.ult });
            f.stun = Math.max(f.stun, a.stun || 0);
          }
          this.addFx({ kind: 'crater', x: u.x, y: u.y, r: a.r, life: 1.2, color: aura, glyph: a.glyph });
          this.addFx({ kind: 'burst', x: u.x, y: u.y, color: '#c89050', n: 40, life: 0.9, speed: 260 });
          this.shake = Math.max(this.shake, 14);
        }
        return true;
      }
      if (a.type === 'chain') {
        if (this.time < a.next) return true;
        const t = a.targets.find((f) => f.hp > 0 && !a.done.has(f.id));
        if (!t || a.done.size >= a.n) {
          u.action = null;
          u.invulnUntil = 0;
          return false;
        }
        a.done.add(t.id);
        this.addFx({ kind: a.fx || 'streak', x: u.x, y: u.y, x2: t.x, y2: t.y, color: aura, life: a.fx ? 0.6 : 0.4 });
        u.x = t.x + (this.rand() - 0.5) * 30;
        u.y = t.y + (u.side === 0 ? 20 : -20);
        this.damage(u, t, u.atk * a.mult, { skill: true, ult: a.ult });
        this.addFx({ kind: 'slash', x: t.x, y: t.y, life: 0.3, ang: this.rand() * 6, big: true, color: aura });
        a.next = this.time + 0.16;
        return true;
      }
      if (a.type === 'spins') {
        if (this.time >= a.next) {
          a.n--;
          a.next = this.time + 0.45;
          for (const f of foes) if (f.hp > 0 && Math.hypot(f.x - u.x, f.y - u.y) < a.r) this.damage(u, f, u.atk * a.mult, { skill: true, ult: a.ult });
          this.addFx({ kind: 'spin', x: u.x, y: u.y, r: a.r, life: 0.45, color: aura, follow: u, big: true });
          this.shake = Math.max(this.shake, 5);
          if (a.n <= 0) u.action = null;
        }
        // 旋风斩时也慢慢逼近敌人
        const t = this.pickTarget(u, foes);
        if (t) this.moveToward(u, t.x, t.y, dt * 0.7);
        return true;
      }
      return false;
    }

    castUlt(u, d) {
      this.sides[u.side].stats.ults++;
      u.ultT = d.ult.cd * (u.ultCdMult || 1);
      u.anim = 0.4;
      this.shake = Math.max(this.shake, 8);
      if (this.skillToast) this.addFx({ kind: 'banner', x: C.W / 2, y: u.side === 0 ? 700 : 470, text: d.ult.name, hero: d.name, color: d.aura, side: u.side, life: 1.5 });
      this.addFx({ kind: 'ring', x: u.x, y: u.y, r: 110, life: 0.7, color: d.aura });
      this.emit('ult', { side: u.side, name: d.name, ult: d.ult.name });
    }

    stepSkill(u, dt, foes) {
      const d = HEROES[u.key];
      const live = foes.filter((f) => f.hp > 0);
      // 大招：英雄到规定等级解锁
      if (u.level >= this.R.ultLevel) {
        u.ultT -= dt;
        if (u.ultT <= 0) {
          if (this.cast(u, d.ult, true, live)) return this.castUlt(u, d);
          u.ultT = 0.3;
        }
      }
      u.skillT -= dt;
      if (u.skillT > 0) return;
      if (this.cast(u, d.skill, false, live)) {
        u.skillT = d.skill.cd;
        u.anim = 0.35;
        if (this.skillToast) this.addFx({ kind: 'text', x: u.x, y: u.y - 44, text: d.skill.name, color: d.aura, life: 0.9, size: 18 });
        this.emit('skill', { side: u.side, name: u.key });
      } else u.skillT = 0.3;
    }

    allies(u, r) {
      return this.units.filter((a) => a.side === u.side && a.hp > 0 && Math.hypot(a.x - u.x, a.y - u.y) < r);
    }

    // 释放一个技能定义：条件不满足返回 false
    cast(u, def, isUlt, live) {
      const range = def.range || 260;
      const near = live.filter((f) => Math.hypot(f.x - u.x, f.y - u.y) < range && this.canSee(u, f));
      if (def.need === 'ally') {
        if (!this.allies(u, 320).some((a) => a.hp < a.maxHp * 0.8)) return false;
      } else {
        const need = typeof def.need === 'number' ? def.need : 1;
        if (near.length < need && !near.some((f) => f.isHero)) return false;
      }
      for (const e of def.do) this.effect(u, e, isUlt, live, near, range);
      return true;
    }

    // 通用技能效果
    effect(u, e, isUlt, live, near, range) {
      const s = this.sides[u.side];
      const aura = HEROES[u.key].aura;
      const opt = { skill: true, ult: isUlt, burn: e.burn };
      const fx = (o) => e.fx && this.addFx(Object.assign({ kind: e.fx, color: aura, life: e.big || isUlt ? 1.3 : 0.9, big: e.big, text: e.text }, o));
      const nearest = () => near.slice().sort((a, b) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(b.x - u.x, b.y - u.y))[0];
      const center = () => (e.at === 'self' ? u : e.at === 'densest' ? this.densest(u, near, e.r || 100, range) || nearest() : nearest());
      const hitArea = (x, y, r, mult, extra) => {
        for (const f of this.units) {
          if (f.side === u.side || f.hp <= 0 || Math.hypot(f.x - x, f.y - y) > r + f.r * 0.5) continue;
          this.damage(u, f, u.atk * mult, opt);
          if (e.stun) f.stun = Math.max(f.stun, e.stun);
          if (e.charm) (f.stun = Math.max(f.stun, e.charm)), (f.charmUntil = this.time + e.charm);
          if (e.slow) (f.slowUntil = this.time + 2), (f.slowPct = e.slow);
          if (e.knock) {
            const d = Math.hypot(f.x - x, f.y - y) || 1;
            f.kx = ((f.x - x) / d) * e.knock;
            f.ky = ((f.y - y) / d) * e.knock;
          }
          if (extra) extra(f);
        }
      };
      const dirTo = (t) => Math.atan2(t.y - u.y, t.x - u.x);
      switch (e.t) {
        case 'aoe': {
          const c = center();
          if (!c) return;
          const x = c.x, y = c.y;
          fx({ x, y, r: e.r });
          const go = () => {
            hitArea(x, y, e.r, e.mult);
            if (isUlt || e.big) this.shake = Math.max(this.shake, 10);
          };
          if (e.delay) this.after(e.delay, go);
          else go();
          break;
        }
        case 'heal': {
          const as = this.allies(u, e.r);
          for (const a of as) this.heal(a, a.maxHp * e.pct);
          fx({ x: u.x, y: u.y, r: e.r });
          as.slice(0, 8).forEach((a) => this.addFx({ kind: 'heal', x: a.x, y: a.y, color: '#6f6', life: 0.8 }));
          break;
        }
        case 'shield': {
          if (e.self) u.shield += u.maxHp * e.self;
          if (e.allies) for (const a of this.allies(u, e.r || 300)) a.shield += a.maxHp * e.allies;
          this.addFx({ kind: 'ring', x: u.x, y: u.y, r: e.r || 50, life: 0.6, color: '#ffe680' });
          break;
        }
        case 'buff': {
          const as = e.self ? [u] : this.allies(u, e.r);
          for (const a of as) {
            a.atkBuff = Math.max(a.atkBuffUntil > this.time ? a.atkBuff : 1, e.atk || 1);
            a.atkBuffUntil = this.time + e.dur;
            if (e.invuln) a.invulnUntil = this.time + e.invuln;
          }
          fx({ x: u.x, y: u.y, r: e.r || 80, follow: u });
          break;
        }
        case 'summon': {
          const kinds = Array.isArray(e.unit) ? e.unit : [e.unit];
          for (let i = 0; i < e.n; i++) {
            const a = (i / e.n) * Math.PI * 2;
            this.spawnUnit(s, kinds[i % kinds.length], u.level, u.x + Math.cos(a) * 46, { bonusSpawn: true, y: u.y + Math.sin(a) * 34 });
          }
          fx({ x: u.x, y: u.y, r: 70 });
          break;
        }
        case 'clone': {
          for (let i = 0; i < e.n; i++) {
            const a = (i / e.n) * Math.PI * 2;
            const c = this.spawnHero(s, u.key, u.level, u.x + Math.cos(a) * 50, { clone: true, expire: this.time + e.life });
            c.y = u.y + Math.sin(a) * 36;
            c.hp = c.maxHp = c.maxHp * e.pct;
            c.atk *= e.pct;
            this.addFx({ kind: e.fx || 'clone', x: c.x, y: c.y, color: aura, life: 0.8 });
          }
          break;
        }
        case 'dash': {
          const t = this.densest(u, near, 100, range) || nearest();
          const dir = u.side === 0 ? -1 : 1;
          const ang = Math.atan2(dir * 300, t ? (t.x - u.x) * 0.6 : 0);
          const dur = e.dur || 0.55;
          u.action = { type: 'dash', vx: Math.cos(ang) * 720, vy: Math.sin(ang) * 720, until: this.time + dur, hit: new Set(), mult: e.mult, knock: e.knock, ult: isUlt };
          u.invulnUntil = this.time + dur + 0.05;
          break;
        }
        case 'leap': {
          const t = this.densest(u, near, e.r, range);
          if (!t) return;
          u.action = { type: 'leap', fx: u.x, fy: u.y, tx: t.x, ty: t.y, t0: this.time, dur: 0.55, r: e.r, mult: e.mult, stun: e.stun, glyph: e.glyph, ult: isUlt };
          u.invulnUntil = this.time + 0.55;
          break;
        }
        case 'chain': {
          let ts = near.slice();
          if (e.prefer === 'ranged') ts.sort((a, b) => (b.ranged ? 1 : 0) - (a.ranged ? 1 : 0));
          else ts.sort((a, b) => (b.isHero ? 1 : 0) - (a.isHero ? 1 : 0));
          u.action = { type: 'chain', targets: ts.slice(0, e.n + 2), done: new Set(), next: this.time, n: e.n, mult: e.mult, fx: e.fx, ult: isUlt };
          if (e.n > 1) u.invulnUntil = this.time + 0.2 * e.n + 0.3;
          break;
        }
        case 'pierce': {
          const t = nearest();
          if (!t) return;
          const ang = dirTo(t), sp = e.speed || 520;
          this.projectiles.push({ kind: 'pierce', side: u.side, x: u.x, y: u.y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, ang, src: u, dmg: u.atk * e.mult, hit: new Set(), color: aura, maxLife: e.life || 0.7, width: e.width || 20, crescent: e.kind === 'crescent', ult: isUlt });
          break;
        }
        case 'line': {
          const t = this.densest(u, near, 80, range) || nearest();
          if (!t) return;
          const ang = dirTo(t), cx = Math.cos(ang), cy = Math.sin(ang);
          const x2 = u.x + cx * e.len, y2 = u.y + cy * e.len;
          for (const f of this.units) {
            if (f.side === u.side || f.hp <= 0) continue;
            const px = f.x - u.x, py = f.y - u.y;
            const along = px * cx + py * cy, perp = Math.abs(px * cy - py * cx);
            if (along < -10 || along > e.len || perp > e.width / 2 + f.r) continue;
            this.damage(u, f, u.atk * e.mult, opt);
            if (e.slow) (f.slowUntil = this.time + 2.5), (f.slowPct = e.slow);
            if (e.stun) f.stun = Math.max(f.stun, e.stun);
          }
          fx({ x: u.x, y: u.y, x2, y2, width: e.width, ang });
          if (isUlt) this.shake = Math.max(this.shake, 8);
          break;
        }
        case 'cone': {
          const t = nearest();
          if (!t) return;
          const ang = dirTo(t), cx = Math.cos(ang), cy = Math.sin(ang);
          for (const f of this.units) {
            if (f.side === u.side || f.hp <= 0) continue;
            const px = f.x - u.x, py = f.y - u.y;
            const along = px * cx + py * cy, perp = Math.abs(px * cy - py * cx);
            if (along < 0 || along > e.len || perp > 20 + (e.width / 2) * (along / e.len)) continue;
            this.damage(u, f, u.atk * e.mult, opt);
          }
          fx({ x: u.x, y: u.y, ang, len: e.len, width: e.width });
          if (isUlt) this.shake = Math.max(this.shake, 8);
          break;
        }
        case 'zone': {
          const c = center();
          if (!c) return;
          this.zones.push({ kind: 'rune', side: u.side, src: u, x: c.x, y: c.y, r: e.r, until: this.time + e.dur, born: this.time, tick: e.tick, tickT: 0, dmg: u.atk * e.mult, stun: e.stun, slow: e.slow, color: aura, glyphs: e.glyphs, hidden: e.hidden });
          if (e.fx) this.addFx({ kind: e.fx, x: c.x, y: c.y, r: e.r, color: aura, life: e.dur });
          break;
        }
        case 'spins': {
          u.action = { type: 'spins', n: e.n, next: this.time, r: e.r, mult: e.mult, ult: isUlt };
          if (e.dr) (u.dr = e.dr), (u.drUntil = this.time + e.n * 0.45 + 2);
          if (e.fx) this.addFx({ kind: e.fx, x: u.x, y: u.y, r: e.r * 0.6, color: aura, life: e.n * 0.45 + 0.3, follow: u });
          break;
        }
        case 'bolts': {
          const strike = (f) => {
            this.damage(u, f, u.atk * e.mult, opt);
            if (e.fx === 'ice') this.addFx({ kind: 'ice', x: f.x, y: f.y, r: 34, color: aura, life: 0.6 });
            else this.addFx({ kind: 'bolt', x: f.x, y: f.y, life: 0.4, color: aura, big: isUlt });
          };
          if (e.all) {
            for (let i = 0; i < e.n; i++)
              this.after((e.interval || 0.15) * i, () => {
                const fs = this.units.filter((f) => f.side !== u.side && f.hp > 0);
                if (!fs.length || u.hp <= 0) return;
                strike(fs[Math.floor(this.rand() * fs.length)]);
                this.shake = Math.max(this.shake, 3);
              });
            if (e.fx === 'storm') this.addFx({ kind: 'storm', x: C.W / 2, y: (L.E_BOTTOM + L.P_TOP) / 2, life: (e.interval || 0.15) * e.n + 0.4, color: aura });
          } else {
            const fs = live.filter((f) => Math.hypot(f.x - u.x, f.y - u.y) < (e.range || 320));
            for (let i = 0; i < e.n && fs.length; i++) strike(fs.splice(Math.floor(this.rand() * fs.length), 1)[0]);
          }
          break;
        }
        case 'homing': {
          if (!near.length) return;
          for (let i = 0; i < e.n; i++) {
            const a = (i / e.n) * Math.PI * 2;
            this.projectiles.push({ kind: 'fox', look: e.kind, side: u.side, x: u.x + Math.cos(a) * 30, y: u.y + Math.sin(a) * 30, ang: a, target: near[i % near.length], src: u, dmg: u.atk * e.mult, speed: 330, color: aura, ult: isUlt });
          }
          break;
        }
        case 'push': {
          const c = center();
          if (!c) return;
          const x = c.x, y = c.y;
          hitArea(x, y, e.r, e.mult, (f) => {
            const d = Math.hypot(f.x - x, f.y - y) || 1;
            const v = e.dist * 3.9 * (f.isHero ? 0.5 : 1); // 击退速度按衰减积分换算成位移
            f.kx = ((f.x - x) / d) * v;
            f.ky = ((f.y - y) / d) * v;
          });
          fx({ x, y, r: e.r });
          break;
        }
        case 'taunt': {
          for (const f of near) if (Math.hypot(f.x - u.x, f.y - u.y) < e.r) (f.tauntUntil = this.time + e.dur), (f.tauntBy = u), (f.target = u);
          fx({ x: u.x, y: u.y, r: e.r });
          break;
        }
        case 'stunTarget': {
          const t = near.find((f) => f.isHero) || nearest();
          if (!t) return;
          this.damage(u, t, u.atk * e.mult, opt);
          t.stun = Math.max(t.stun, e.dur);
          fx({ x: t.x, y: t.y, r: 50 });
          break;
        }
        case 'blink': {
          const t = this.densest(u, near, e.r, range);
          if (!t) return;
          this.addFx({ kind: e.fx || 'clone', x: u.x, y: u.y, color: aura, life: 0.7 });
          u.x = t.x;
          u.y = t.y + (u.side === 0 ? 16 : -16);
          this.addFx({ kind: e.fx || 'clone', x: u.x, y: u.y, color: aura, life: 0.7 });
          this.addFx({ kind: 'shock', x: u.x, y: u.y, r: e.r, life: 0.6, color: aura });
          hitArea(u.x, u.y, e.r, e.mult);
          this.shake = Math.max(this.shake, 8);
          break;
        }
      }
    }

    // ---------- 守关波次 ----------
    spawnWave() {
      const n = ++this.wave;
      const e = this.sides[1];
      this.waveT = Math.max(12, 20 - n * 0.3); // 越往后来得越快
      const keys = JQ.packUnits(e.pack);
      const count = Math.round((3 + n * 1.6) * (this.diff.wave || 1));
      const lv = Math.min(C.MAX_LEVEL, 1 + Math.floor(n / 3));
      // 我方兵力会持续积累，敌军属性也随波次成长（第 8 波起每波 +7%）
      const grow = 1 + 0.07 * Math.max(0, n - 8);
      for (let i = 0; i < count; i++) {
        const x = L.BX0 + 20 + this.rand() * (L.BX1 - L.BX0 - 40);
        const u = this.spawnUnit(e, keys[Math.floor(this.rand() * keys.length)], lv, x);
        u.y -= this.rand() * 40;
        u.hp = u.maxHp = u.maxHp * grow;
        u.atk *= grow;
      }
      if (n % 4 === 0) {
        const names = JQ.PACKS[e.pack].heroes.filter((h) => !e.heroAlive[h]);
        const name = names[Math.floor(this.rand() * names.length)];
        if (name) {
          const h = this.spawnHero(e, name, Math.min(C.MAX_LEVEL, 1 + Math.floor(n / 4)), C.W / 2);
          h.hp = h.maxHp = h.maxHp * grow;
          h.atk *= grow;
        }
      }
      this.addFx({ kind: 'banner', x: C.W / 2, y: 470, hero: '守关', text: `第 ${n} 波`, color: n % 4 === 0 ? '#ff4030' : '#ffd23f', side: 1, life: 1.4 });
      this.emit('wave', { n });
    }

    // ---------- 天命事件 ----------
    fireEvent() {
      this.eventT = 25;
      const ev = JQ.EVENTS[Math.floor(this.rand() * JQ.EVENTS.length)];
      const T = this.time;
      // 天命所归：只有一方带时，好事只给他、坏事只落对手
      const fav = this.sides.filter((x) => x.T.fateFavor);
      const lucky = fav.length === 1 ? fav[0] : null;
      const gets = (s) => !lucky || s === lucky;
      const hurts = (u) => !lucky || u.side !== lucky.id;
      switch (ev.name) {
        case '天降甘霖':
          for (const s of this.sides) if (gets(s)) s.buns += 30;
          break;
        case '神兵天降': {
          for (const s of this.sides.filter(gets)) {
            const keys = JQ.packUnits(s.pack);
            let slot = s.shop.findIndex((c) => !c);
            if (slot < 0) slot = Math.floor(this.rand() * C.SHOP_SIZE);
            s.shop[slot] = JQ.makeCard('unit', keys[Math.floor(this.rand() * keys.length)], 3);
          }
          break;
        }
        case '瘟疫横行':
          for (const u of this.units.filter(hurts)) {
            if (u.isOutpost) continue;
            u.hp *= 0.6;
            this.addFx({ kind: 'burst', x: u.x, y: u.y, color: '#6a9a30', n: 6, life: 0.6, speed: 60 });
          }
          break;
        case '杀气冲天':
          this.mods.rageUntil = T + 15;
          break;
        case '神行太保':
          this.mods.swiftUntil = T + 15;
          break;
        case '天雷滚滚':
          for (let i = 0; i < 10; i++)
            this.after(0.18 * i, () => {
              const us = this.units.filter((u) => u.hp > 0 && !u.isOutpost && hurts(u));
              if (!us.length) return;
              const f = us[Math.floor(this.rand() * us.length)];
              this.damage(null, f, 120, { skill: true });
              this.addFx({ kind: 'bolt', x: f.x, y: f.y, life: 0.4, color: '#9ad8ff', big: true });
              this.shake = Math.max(this.shake, 3);
            });
          break;
        case '招贤纳士':
          this.mods.freeUntil = T + 15;
          break;
      }
      this.mods.event = ev;
      this.mods.eventAt = T;
      this.addFx({ kind: 'banner', x: C.W / 2, y: 585, hero: '天命', text: ev.name, color: '#ffd23f', side: 0, life: 1.8 });
      this.emit('event', ev);
    }

    addFx(f) {
      f.t = 0;
      this.fx.push(f);
      if (this.fx.length > 240) this.fx.splice(0, this.fx.length - 240);
    }
  }

  JQ.Game = Game;
})();
