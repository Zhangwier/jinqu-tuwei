// 静态数据：卡牌、兵种、英雄、数值常量。纯数据，浏览器和 Node 测试共用。
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const JQ = (G.JQ = G.JQ || {});

  const C = {
    W: 720,
    H: 1280,
    COLS: 7,
    ROWS: 4,                // 基地后方的排数
    FWD: 2,                 // 可往战场方向延伸的前哨排数
    OUTPOST_HP: 600,        // 前哨格血量
    CELL: 60,
    BASE_HP: 3000,
    MATCH_TIME: 300,        // 秒；到时比基地血量百分比
    OVERTIME_ATK: 2,        // 最后 60 秒攻击倍率
    START_BUNS: 20,
    INCOME: 1.8,            // 每秒包子
    CRYSTAL_BUNS: 3,        // 主角踩到水晶
    RECRUIT_COST: 15,       // 刷新一次招兵栏
    RECRUIT_STEP: 3,
    RECRUIT_MAX: 45,
    SHOP_SIZE: 5,
    MAX_LEVEL: 5,           // 英雄/建筑/道具等级上限；小兵不设上限（见 JQ.cardMaxLevel）
    ULT_LEVEL: 3,           // 英雄到这个等级解锁大招
    WALK_TIME: 0.42,        // 主角走一格的秒数
    CAP_PER_LEVEL: 4,       // 每级兵卡提供的同兵种在场上限
    CAP_MAX: 30,
    KILL_BUNS: 1,
    HERO_KILL_BUNS: 10,
    BASE_DMG: 0.25,         // 打基地伤害系数
    TOWER_RANGE: 130,       // 基地箭楼：离基地线多远开始射
    TOWER_DMG: 40,
    TOWER_RATE: 0.45,
    HOME_RANGE: 170,        // 主场加成范围
    HOME_BONUS: 0.25,
    PARTNER_PITY: 0.25,     // 抽到字时，25% 几率改成场上需要的字（太高会让某个字刷屏）
    TILE_PITY: 0.6,         // 棋盘没空位且招兵栏没格子时，保底塞一个格子块
    MAX_STAGE: 200,         // 经典/天命关卡数
    UNIT_WEIGHT: 7,         // 每个小兵种类在卡池里的基础权重
  };
  JQ.C = C;

  // 小兵。cd=卡牌内置冷却；bonus=对某类目标的伤害倍率；melee/ranged 用于天赋分类。
  // 不同卡包可以有不同的兵种组合，但同一个字在所有卡包里属性完全一样。
  const UNITS = {
    刀: { hp: 120, atk: 18, range: 24, rate: 0.8, speed: 55, cd: 4, melee: true, desc: '近战步兵，攻速快' },
    盾: { hp: 320, atk: 8, range: 24, rate: 1.0, speed: 40, cd: 5, melee: true, rangedReduce: 0.5, desc: '高血量，远程伤害减半' },
    弓: { hp: 70, atk: 15, range: 170, rate: 1.1, speed: 45, cd: 4.5, ranged: true, desc: '远程输出，皮薄' },
    枪: { hp: 130, atk: 20, range: 48, rate: 1.0, speed: 50, cd: 5, melee: true, bonus: { hero: 1.8 }, desc: '长兵，对英雄 1.8 倍' },
    剑: { hp: 150, atk: 30, range: 26, rate: 1.0, speed: 55, cd: 6, melee: true, bonus: { 盾: 1.5 }, desc: '高伤近战，破盾 1.5 倍' },
    刺: { hp: 80, atk: 36, range: 22, rate: 0.9, speed: 85, cd: 6, melee: true, assassin: true, bonus: { 弓: 2 }, desc: '刺客，绕后先杀远程' },
    // 扩展兵种
    骑: { hp: 260, atk: 26, range: 26, rate: 1.0, speed: 80, cd: 6, melee: true, bonus: { 弓: 1.4 }, desc: '轻骑冲锋，克制远程' },
    弩: { hp: 90, atk: 28, range: 200, rate: 1.5, speed: 40, cd: 6, ranged: true, desc: '重弩远射，射速较慢' },
    陌: { hp: 180, atk: 34, range: 30, rate: 1.1, speed: 50, cd: 7, melee: true, splash: 0.4, desc: '陌刀劈砍，溅射周围敌人' },
    甲: { hp: 420, atk: 16, range: 24, rate: 1.2, speed: 36, cd: 7, melee: true, rangedReduce: 0.6, desc: '重甲步卒，极抗远程' },
    妖: { hp: 100, atk: 32, range: 26, rate: 0.85, speed: 75, cd: 5, melee: true, assassin: true, bonus: { 弓: 1.5 }, desc: '妖兵绕后，专杀远程' },
    魔: { hp: 380, atk: 22, range: 26, rate: 1.1, speed: 38, cd: 6, melee: true, rangedReduce: 0.4, desc: '魔卒血厚，抗远程' },
    猴: { hp: 140, atk: 20, range: 24, rate: 0.65, speed: 70, cd: 4, melee: true, desc: '猴兵灵动，攻速极快' },
    僧: { hp: 220, atk: 14, range: 120, rate: 1.2, speed: 42, cd: 6, ranged: true, healAura: { r: 120, pct: 0.006 }, desc: '僧兵远程，周围友军回血' },
    龙: { hp: 300, atk: 30, range: 150, rate: 1.2, speed: 44, cd: 7, ranged: true, magic: true, desc: '龙兵远程，法术伤害' },
    鬼: { hp: 90, atk: 40, range: 22, rate: 0.9, speed: 80, cd: 6, melee: true, assassin: true, stealth: 2.5, bonus: { 弓: 2 }, desc: '鬼兵隐身出场，刺杀后排' },
  };
  for (const k of Object.keys(UNITS)) UNITS[k].name = k;
  JQ.UNITS = UNITS;

  // 每个卡包的小兵种类（8 种；同字跨卡包属性一致）
  const PACK_UNITS = {
    sanguo: ['刀', '盾', '弓', '枪', '剑', '刺', '骑', '弩'],
    xiyou: ['妖', '魔', '猴', '僧', '龙', '鬼', '弓', '盾'],
    tang: ['陌', '甲', '弩', '骑', '枪', '弓', '剑', '刀'],
    custom: ['刀', '盾', '弓', '枪', '剑', '刺', '骑', '弩'],
  };
  JQ.PACK_UNITS = PACK_UNITS;
  JQ.ALL_UNITS = Object.keys(UNITS);


  // ---------- 英雄 ----------
  // 两个字左右相邻即合成（不分谁左谁右），同一卡包里字可以被多个英雄共用。
  // passive：被动特长（见 sim.js applyPassive / damage）；skill/ult.do：通用效果列表（见 sim.js runEffects）。
  // 效果的 at：self 自身 / target 最近敌人 / densest 敌人最密处；fx：特效名（render.js 内置或 vfx.js 提供）。
  const H = (name, pack, o) => Object.assign({ name, pack, chars: name.split('') }, o);
  const HEROES = {};
  [
    // ===== 三国 =====
    H('刘备', 'sanguo', { role: '辅助', hp: 1100, atk: 34, range: 30, rate: 1.0, speed: 48, cd: 16, aura: '#3fbf6f',
      passive: { name: '仁德', desc: '周围友军每秒回 2% 血', auraRegen: { r: 170, pct: 0.02 } },
      skill: { name: '仁德', cd: 7, desc: '为周围友军回复 18% 血', need: 'ally', do: [{ t: 'heal', r: 220, pct: 0.18, fx: 'lotus' }] },
      ult: { name: '桃园结义', cd: 16, desc: '全军回血 30%，攻击 +35% 持续 6 秒', need: 'ally', do: [{ t: 'heal', r: 320, pct: 0.3 }, { t: 'buff', r: 320, atk: 1.35, dur: 6, fx: 'warcry', text: '桃园结义' }] } }),
    H('关羽', 'sanguo', { role: '战士', hp: 1300, atk: 55, range: 34, rate: 1.0, speed: 52, cd: 18, aura: '#2ecc71',
      passive: { name: '武圣', desc: '20% 几率暴击，造成 2 倍伤害', crit: 0.2, critMult: 2 },
      skill: { name: '青龙偃月', cd: 7, desc: '劈出贯穿刀气', do: [{ t: 'pierce', mult: 2.5, width: 26, kind: 'crescent' }] },
      ult: { name: '单刀赴会', cd: 16, desc: '向前冲锋，沿途 4 倍伤害并击退', do: [{ t: 'dash', mult: 4, knock: true }] } }),
    H('张飞', 'sanguo', { role: '坦克', hp: 1700, atk: 40, range: 30, rate: 1.0, speed: 46, cd: 18, aura: '#e04a3a',
      passive: { name: '燕人', desc: '血量低于一半时受到伤害 -35%', lowHpDr: { below: 0.5, dr: 0.35 } },
      skill: { name: '怒吼', cd: 7, desc: '震晕身边敌人 1 秒', range: 90, do: [{ t: 'aoe', at: 'self', r: 90, mult: 1.5, stun: 1, fx: 'shock' }] },
      ult: { name: '当阳断桥', cd: 16, desc: '一声暴喝，大范围震晕 2.5 秒并重创，自身获得护盾', range: 220, do: [{ t: 'aoe', at: 'self', r: 220, mult: 3, stun: 2.5, fx: 'shock', big: true }, { t: 'shield', self: 0.4 }] } }),
    H('赵云', 'sanguo', { role: '刺客', hp: 1150, atk: 52, range: 30, rate: 0.8, speed: 70, cd: 16, assassin: true, aura: '#5ab4ff',
      passive: { name: '龙胆', desc: '30% 几率闪避普通攻击', dodge: 0.3 },
      skill: { name: '龙胆突刺', cd: 6, desc: '突进到目标身边刺击', do: [{ t: 'chain', n: 1, mult: 2.5 }] },
      ult: { name: '七进七出', cd: 15, desc: '在 7 个敌人之间连续突刺，期间无敌', do: [{ t: 'chain', n: 7, mult: 2.5, fx: 'dragon' }] } }),
    H('孔明', 'sanguo', { role: '法师', hp: 650, atk: 30, range: 190, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, aura: '#5ad1ff',
      passive: { name: '八阵', desc: '身边 140 内的敌人移速 -30%', auraSlow: { r: 140, pct: 0.3 } },
      skill: { name: '天雷', cd: 6, desc: '天雷劈落 3 个敌人', do: [{ t: 'bolts', n: 3, mult: 3, range: 320 }] },
      ult: { name: '借东风', cd: 16, desc: '东风起，雷暴席卷战场，12 道天雷', range: 999, do: [{ t: 'bolts', n: 12, mult: 3, all: true, interval: 0.15, fx: 'storm' }] } }),
    H('黄忠', 'sanguo', { role: '射手', hp: 700, atk: 42, range: 240, rate: 1.1, speed: 46, cd: 16, ranged: true, aura: '#ffb030',
      passive: { name: '百步穿杨', desc: '攻击 160 外的目标伤害 +60%', longShot: 0.6 },
      skill: { name: '穿云箭', cd: 6, desc: '射出贯穿一切的重箭', do: [{ t: 'pierce', mult: 3, width: 16, speed: 760, life: 0.9, kind: 'arrow' }] },
      ult: { name: '定军山', cd: 16, desc: '箭雨覆盖敌群 2 秒', range: 320, do: [{ t: 'zone', at: 'densest', r: 140, dur: 2, tick: 0.25, mult: 1, fx: 'arrowRain', hidden: true }] } }),
    H('曹操', 'sanguo', { role: '战士', hp: 1200, atk: 45, range: 30, rate: 0.9, speed: 52, cd: 18, aura: '#a05ad8',
      passive: { name: '奸雄', desc: '造成伤害的 30% 转为自身血量', lifesteal: 0.3 },
      skill: { name: '奸雄号令', cd: 9, desc: '号令召出 3 名刀兵', do: [{ t: 'summon', unit: '刀', n: 3, fx: 'portal' }] },
      ult: { name: '挟天子以令诸侯', cd: 18, desc: '召出 8 名精兵，周围友军攻击 +40%', do: [{ t: 'summon', unit: ['刀', '枪'], n: 8, fx: 'portal' }, { t: 'buff', r: 300, atk: 1.4, dur: 6, fx: 'warcry', text: '令' }] } }),
    H('曹仁', 'sanguo', { role: '坦克', hp: 1900, atk: 30, range: 30, rate: 1.0, speed: 42, cd: 16, aura: '#8a9ab0',
      passive: { name: '铁壁', desc: '远程伤害减半，反弹 20% 近战伤害', rangedReduce: 0.5, thorns: 0.2 },
      skill: { name: '坚守', cd: 8, desc: '嘲讽周围敌人 3 秒并获得护盾', range: 160, do: [{ t: 'taunt', r: 160, dur: 3, fx: 'ring' }, { t: 'shield', self: 0.3 }] },
      ult: { name: '八门金锁', cd: 16, desc: '布下金锁阵 4 秒，阵中敌人持续受伤、无法行动', range: 280, do: [{ t: 'zone', at: 'densest', r: 160, dur: 4, tick: 0.4, mult: 0.6, stun: true, glyphs: '八门金锁休生' }] } }),
    H('典韦', 'sanguo', { role: '战士', hp: 1550, atk: 48, range: 30, rate: 0.8, speed: 52, cd: 18, aura: '#c02020',
      passive: { name: '恶来', desc: '越残血越凶，最多攻击 +80%', rage: 0.8 },
      skill: { name: '双戟', cd: 6, desc: '舞动双戟横扫身边', range: 85, do: [{ t: 'aoe', at: 'self', r: 85, mult: 2, fx: 'spin' }] },
      ult: { name: '死战', cd: 18, desc: '4 秒无敌，攻击翻倍', range: 200, do: [{ t: 'buff', self: true, atk: 2, dur: 5, invuln: 4, fx: 'warcry', text: '死战' }] } }),
    H('许褚', 'sanguo', { role: '战士', hp: 1500, atk: 52, range: 30, rate: 1.0, speed: 52, cd: 18, aura: '#d08030',
      passive: { name: '裸衣', desc: '攻击 +40%，但受到伤害 +15%', atkMult: 1.4, vuln: 0.15 },
      skill: { name: '虎痴撞', cd: 7, desc: '撞开身边敌人', range: 90, do: [{ t: 'aoe', at: 'self', r: 90, mult: 2, knock: 220, fx: 'shock' }] },
      ult: { name: '虎痴', cd: 16, desc: '跃入敌群砸地，5 倍伤害并震晕', range: 360, do: [{ t: 'leap', r: 140, mult: 5, stun: 1, glyph: '虎' }] } }),
    H('孙策', 'sanguo', { role: '战士', hp: 1250, atk: 52, range: 32, rate: 0.9, speed: 56, cd: 18, aura: '#ff7040',
      passive: { name: '小霸王', desc: '对英雄伤害 +50%', heroBonus: 0.5 },
      skill: { name: '霸王枪', cd: 7, desc: '直线突刺 200 距离内敌人', do: [{ t: 'line', len: 200, width: 34, mult: 2.5, fx: 'wave' }] },
      ult: { name: '江东猛虎', cd: 18, desc: '三连旋风斩，期间减伤 40%', range: 140, do: [{ t: 'spins', n: 3, r: 130, mult: 2.5, dr: 0.4 }] } }),
    H('孙权', 'sanguo', { role: '辅助', hp: 800, atk: 30, range: 180, rate: 1.0, speed: 46, cd: 18, ranged: true, aura: '#30b0b0',
      passive: { name: '制衡', desc: '在场时每 6 秒为己方产 4 包子', income: { buns: 4, every: 6 } },
      skill: { name: '制衡', cd: 8, desc: '周围友军攻击 +25% 持续 5 秒', do: [{ t: 'buff', r: 220, atk: 1.25, dur: 5, fx: 'warcry', text: '制衡' }] },
      ult: { name: '坐断东南', cd: 18, desc: '召出 6 名弓手，箭雨覆盖敌群', range: 320, do: [{ t: 'summon', unit: '弓', n: 6, fx: 'portal' }, { t: 'zone', at: 'densest', r: 130, dur: 1.6, tick: 0.25, mult: 0.8, fx: 'arrowRain', hidden: true }] } }),
    H('周瑜', 'sanguo', { role: '法师', hp: 700, atk: 32, range: 170, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, proj: 'fireball', aura: '#ff5a20',
      passive: { name: '火攻', desc: '攻击附带灼烧，3 秒内追加伤害', burn: { pct: 0.7, dur: 3 } },
      skill: { name: '火攻', cd: 6, desc: '喷出扇形烈火并点燃敌人', do: [{ t: 'cone', len: 220, width: 140, mult: 2.6, burn: 3, fx: 'firewave' }] },
      ult: { name: '火烧赤壁', cd: 18, desc: '烈焰横扫半个战场，5 秒灼烧', range: 400, do: [{ t: 'cone', len: 520, width: 420, mult: 3.5, burn: 5, fx: 'firewave', big: true }] } }),
    H('吕蒙', 'sanguo', { role: '刺客', hp: 950, atk: 50, range: 28, rate: 0.85, speed: 66, cd: 16, assassin: true, aura: '#d8d8f0',
      passive: { name: '白衣', desc: '出场 4 秒内隐身，不会被普攻锁定', stealth: 4 },
      skill: { name: '奇袭', cd: 7, desc: '闪到敌方后排刺杀远程', do: [{ t: 'chain', n: 1, mult: 3, prefer: 'ranged' }] },
      ult: { name: '白衣渡江', cd: 16, desc: '潜入敌群中心突袭，4 倍伤害并震晕', range: 360, do: [{ t: 'blink', r: 130, mult: 4, stun: 1.5, fx: 'clone' }] } }),
    H('吕布', 'sanguo', { role: '战士', hp: 1300, atk: 62, range: 34, rate: 1.1, speed: 55, cd: 20, aura: '#ff3030',
      passive: { name: '无双', desc: '攻击 +25%，10% 几率暴击', atkMult: 1.25, crit: 0.1, critMult: 2 },
      skill: { name: '方天横扫', cd: 8, desc: '大范围 3 倍横扫', range: 105, need: 2, do: [{ t: 'aoe', at: 'self', r: 105, mult: 3, fx: 'spin' }] },
      ult: { name: '天下无双', cd: 18, desc: '连续三次旋风斩，期间减伤 50%', range: 140, do: [{ t: 'spins', n: 3, r: 130, mult: 2.5, dr: 0.5 }] } }),
    H('貂蝉', 'sanguo', { role: '法师', hp: 700, atk: 28, range: 160, rate: 1.0, speed: 48, cd: 18, ranged: true, magic: true, aura: '#ff6fb0',
      passive: { name: '闭月', desc: '打她的敌人 20% 几率被魅惑 1 秒', charmOnHit: 0.2 },
      skill: { name: '魅惑', cd: 6, desc: '范围法伤并魅惑 1.5 秒', do: [{ t: 'aoe', at: 'target', r: 85, mult: 2, charm: 1.5, fx: 'ring' }] },
      ult: { name: '闭月', cd: 16, desc: '大范围魅惑 2.5 秒，并为友军回血 25%', range: 260, do: [{ t: 'aoe', at: 'self', r: 260, mult: 2, charm: 2.5, fx: 'petals' }, { t: 'heal', r: 260, pct: 0.25 }] } }),

    // ===== 西游 =====
    H('悟空', 'xiyou', { role: '战士', hp: 1400, atk: 55, range: 34, rate: 0.9, speed: 60, cd: 18, aura: '#ffc020',
      passive: { name: '金刚不坏', desc: '每 10 秒获得 25% 血量护盾', periodicShield: { pct: 0.25, every: 10 } },
      skill: { name: '金箍棒', cd: 7, desc: '金箍棒砸向敌群', range: 220, do: [{ t: 'aoe', at: 'densest', r: 100, mult: 2.8, stun: 0.5, fx: 'staff' }] },
      ult: { name: '七十二变', cd: 18, desc: '变出 3 个分身助战 10 秒', range: 300, do: [{ t: 'clone', n: 3, pct: 0.45, life: 10, fx: 'clone' }, { t: 'aoe', at: 'self', r: 120, mult: 2 }] } }),
    H('八戒', 'xiyou', { role: '坦克', hp: 1800, atk: 40, range: 30, rate: 1.0, speed: 44, cd: 16, aura: '#f09090',
      passive: { name: '天蓬', desc: '每秒回复 2% 血量', regen: 0.02 },
      skill: { name: '九齿钉耙', cd: 7, desc: '钉耙砸地，击退身边敌人', range: 95, do: [{ t: 'aoe', at: 'self', r: 95, mult: 2, knock: 200, fx: 'shock' }] },
      ult: { name: '猪突猛进', cd: 16, desc: '向前猛冲，沿途 3.5 倍伤害并撞飞', do: [{ t: 'dash', mult: 3.5, knock: true }] } }),
    H('沙僧', 'xiyou', { role: '坦克', hp: 1600, atk: 36, range: 30, rate: 1.0, speed: 46, cd: 16, aura: '#b09060',
      passive: { name: '卷帘', desc: '身边 140 内友军受到伤害 -15%', auraDr: { r: 140, pct: 0.15 } },
      skill: { name: '降妖杖', cd: 7, desc: '优先击晕敌方英雄 2 秒', do: [{ t: 'stunTarget', mult: 2.5, dur: 2, fx: 'shock' }] },
      ult: { name: '流沙河', cd: 16, desc: '流沙陷阵 4 秒，阵中敌人持续受伤并大幅减速', range: 280, do: [{ t: 'zone', at: 'densest', r: 170, dur: 4, tick: 0.4, mult: 0.6, slow: 0.6, glyphs: '流沙河八百里' }] } }),
    H('唐僧', 'xiyou', { role: '辅助', hp: 800, atk: 22, range: 150, rate: 1.0, speed: 46, cd: 16, ranged: true, magic: true, aura: '#ffe080',
      passive: { name: '金蝉', desc: '身边 160 内友军每秒回 2.5% 血', auraRegen: { r: 160, pct: 0.025 } },
      skill: { name: '紧箍咒', cd: 8, desc: '优先定住敌方英雄 2.5 秒', do: [{ t: 'stunTarget', mult: 2, dur: 2.5, fx: 'ring' }] },
      ult: { name: '普度众生', cd: 16, desc: '全军回血 40% 并获得护盾', need: 'ally', do: [{ t: 'heal', r: 320, pct: 0.4, fx: 'lotus' }, { t: 'shield', allies: 0.15, r: 320 }] } }),
    H('白龙', 'xiyou', { role: '射手', hp: 750, atk: 36, range: 200, rate: 1.0, speed: 50, cd: 16, ranged: true, proj: 'water', aura: '#bfe6ff',
      passive: { name: '龙鳞', desc: '25% 几率闪避普通攻击', dodge: 0.25 },
      skill: { name: '龙吟', cd: 6, desc: '水龙吟贯穿直线敌人', do: [{ t: 'line', len: 260, width: 32, mult: 2.5, fx: 'wave' }] },
      ult: { name: '白龙出水', cd: 16, desc: '白龙破浪而出，直线 5 倍伤害', range: 400, do: [{ t: 'line', len: 520, width: 60, mult: 5, fx: 'dragon' }] } }),
    H('龙王', 'xiyou', { role: '法师', hp: 800, atk: 30, range: 180, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, proj: 'water', aura: '#3080ff',
      passive: { name: '兴风作浪', desc: '攻击使敌人减速 35%', slowOnHit: { pct: 0.35, dur: 1.5 } },
      skill: { name: '冰锥', cd: 6, desc: '冰锥刺穿 4 个敌人', do: [{ t: 'bolts', n: 4, mult: 2.2, range: 300, fx: 'ice' }] },
      ult: { name: '翻江倒海', cd: 18, desc: '巨浪横扫战场，4 倍伤害并减速', range: 400, do: [{ t: 'line', len: 600, width: 130, mult: 4, slow: 0.5, fx: 'wave', big: true }] } }),
    H('哪吒', 'xiyou', { role: '战士', hp: 1150, atk: 46, range: 30, rate: 0.7, speed: 64, cd: 16, aura: '#ff4060',
      passive: { name: '三头六臂', desc: '每次攻击额外打到 2 个敌人（50% 伤害）', splash: { n: 2, pct: 0.5 } },
      skill: { name: '乾坤圈', cd: 6, desc: '掷出 3 个追踪乾坤圈', range: 320, do: [{ t: 'homing', n: 3, mult: 2, kind: 'ring' }] },
      ult: { name: '风火轮', cd: 16, desc: '脚踏风火轮四连旋斩', range: 140, do: [{ t: 'spins', n: 4, r: 120, mult: 2, fx: 'wheels' }] } }),
    H('二郎', 'xiyou', { role: '射手', hp: 850, atk: 44, range: 210, rate: 1.0, speed: 50, cd: 18, ranged: true, aura: '#40c0c0',
      passive: { name: '天眼', desc: '无视闪避和隐身，对英雄伤害 +30%', trueSight: true, heroBonus: 0.3 },
      skill: { name: '三尖两刃刀', cd: 7, desc: '劈出贯穿刀气', do: [{ t: 'pierce', mult: 2.5, width: 26, kind: 'crescent' }] },
      ult: { name: '天眼神光', cd: 16, desc: '天眼射出神光，直线 6 倍伤害，哮天犬助战', range: 400, do: [{ t: 'line', len: 480, width: 40, mult: 6, fx: 'eye' }, { t: 'summon', unit: '刺', n: 2 }] } }),
    H('观音', 'xiyou', { role: '辅助', hp: 800, atk: 24, range: 160, rate: 1.0, speed: 46, cd: 16, ranged: true, magic: true, aura: '#90f0c0',
      passive: { name: '净瓶', desc: '身边 200 内友军每秒回 2% 血', auraRegen: { r: 200, pct: 0.02 } },
      skill: { name: '杨柳枝', cd: 7, desc: '为周围友军回复 20% 血', need: 'ally', do: [{ t: 'heal', r: 220, pct: 0.2, fx: 'lotus' }] },
      ult: { name: '千手观音', cd: 16, desc: '全军回血 50% 并获得 20% 护盾', need: 'ally', do: [{ t: 'heal', r: 320, pct: 0.5, fx: 'lotus', big: true }, { t: 'shield', allies: 0.2, r: 320 }] } }),
    H('如来', 'xiyou', { role: '法师', hp: 1100, atk: 34, range: 170, rate: 1.1, speed: 44, cd: 20, ranged: true, magic: true, aura: '#ffd700',
      passive: { name: '佛光', desc: '受到伤害 -30%', dr: 0.3 },
      skill: { name: '佛印', cd: 7, desc: '金色佛印镇压敌人', do: [{ t: 'aoe', at: 'target', r: 90, mult: 2.2, fx: 'runeburst' }] },
      ult: { name: '如来神掌', cd: 18, desc: '佛掌从天而降，7 倍伤害并震晕 2 秒', range: 320, do: [{ t: 'aoe', at: 'densest', r: 160, mult: 7, stun: 2, fx: 'palm', delay: 0.4 }] } }),
    H('牛魔', 'xiyou', { role: '坦克', hp: 1800, atk: 46, range: 30, rate: 1.1, speed: 46, cd: 16, aura: '#a05020',
      passive: { name: '大力', desc: '普通攻击把敌人撞退', knockOnHit: 160 },
      skill: { name: '蛮牛冲撞', cd: 7, desc: '短距离冲撞，2.5 倍伤害', do: [{ t: 'dash', mult: 2.5, dur: 0.3, knock: true }] },
      ult: { name: '混天大圣', cd: 16, desc: '跃入敌群，5 倍伤害并震晕', range: 360, do: [{ t: 'leap', r: 150, mult: 5, stun: 1.2, glyph: '牛' }] } }),
    H('铁扇', 'xiyou', { role: '法师', hp: 750, atk: 28, range: 170, rate: 1.0, speed: 48, cd: 16, ranged: true, magic: true, aura: '#60c060',
      passive: { name: '芭蕉', desc: '攻击把敌人吹退', knockOnHit: 120 },
      skill: { name: '芭蕉扇', cd: 7, desc: '扇起旋风吹飞敌人', do: [{ t: 'push', at: 'target', r: 120, dist: 140, mult: 2, fx: 'tornado' }] },
      ult: { name: '一扇千里', cd: 16, desc: '狂风把身边敌人全部吹飞，3 倍伤害', range: 260, do: [{ t: 'push', at: 'self', r: 280, dist: 280, mult: 3, fx: 'tornado', big: true }] } }),
    H('嫦娥', 'xiyou', { role: '法师', hp: 700, atk: 32, range: 180, rate: 1.0, speed: 48, cd: 16, ranged: true, magic: true, proj: 'moonshard', aura: '#c0d8ff',
      passive: { name: '广寒', desc: '攻击使敌人减速 30%', slowOnHit: { pct: 0.3, dur: 1.5 } },
      skill: { name: '月华', cd: 6, desc: '冰封一小片敌人 1 秒', do: [{ t: 'aoe', at: 'target', r: 85, mult: 2.2, stun: 1, fx: 'ice' }] },
      ult: { name: '奔月', cd: 16, desc: '月光倾泻，4 倍伤害并冰封 2.5 秒', range: 320, do: [{ t: 'aoe', at: 'densest', r: 200, mult: 4, stun: 2.5, fx: 'moon' }] } }),
    H('太白', 'xiyou', { role: '辅助', hp: 750, atk: 24, range: 160, rate: 1.0, speed: 48, cd: 16, ranged: true, magic: true, aura: '#fff0a0',
      passive: { name: '金星', desc: '在场时每 8 秒为己方产 3 包子', income: { buns: 3, every: 8 } },
      skill: { name: '天宫敕令', cd: 8, desc: '周围友军攻击 +30% 持续 5 秒', do: [{ t: 'buff', r: 220, atk: 1.3, dur: 5, fx: 'warcry', text: '敕' }] },
      ult: { name: '天兵天将', cd: 18, desc: '召来 2 名天枪兵、2 名天盾兵', do: [{ t: 'summon', unit: ['枪', '盾'], n: 4, fx: 'portal' }] } }),
    H('红孩', 'xiyou', { role: '刺客', hp: 950, atk: 48, range: 28, rate: 0.85, speed: 68, cd: 16, assassin: true, aura: '#ff3010',
      passive: { name: '三昧真火', desc: '攻击附带灼烧', burn: { pct: 0.6, dur: 3 } },
      skill: { name: '火尖枪', cd: 6, desc: '火焰枪喷出烈火', do: [{ t: 'cone', len: 160, width: 100, mult: 2.2, burn: 3, fx: 'firewave' }] },
      ult: { name: '三昧真火', cd: 16, desc: '火流星砸进敌群，5 倍伤害并灼烧', range: 320, do: [{ t: 'aoe', at: 'densest', r: 150, mult: 5, burn: 4, fx: 'meteor', delay: 0.35 }] } }),
    H('玉帝', 'xiyou', { role: '法师', hp: 900, atk: 30, range: 180, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, aura: '#ffd23f',
      passive: { name: '天威', desc: '身边 200 内友军攻击 +15%', auraAtk: { r: 200, pct: 0.15 } },
      skill: { name: '天罚', cd: 6, desc: '天雷劈落 3 个敌人', do: [{ t: 'bolts', n: 3, mult: 3, range: 320 }] },
      ult: { name: '天庭震怒', cd: 18, desc: '天雷滚滚，12 道金雷', range: 999, do: [{ t: 'bolts', n: 12, mult: 3, all: true, interval: 0.15, fx: 'storm' }] } }),
    // ===== 唐朝 =====
    H('李靖', 'tang', { role: '统帅', hp: 1250, atk: 46, range: 32, rate: 0.95, speed: 52, cd: 18, aura: '#d8b45a',
      passive: { name: '军神', desc: '身边 180 内友军攻击 +18%', auraAtk: { r: 180, pct: 0.18 } },
      skill: { name: '六花阵', cd: 8, desc: '布下战阵，阵内敌人持续受伤并减速', do: [{ t: 'zone', at: 'densest', r: 110, dur: 4, tick: 0.6, mult: 1.1, slow: 0.35, glyphs: '六花军阵' }] },
      ult: { name: '阴山奔袭', cd: 17, desc: '铁骑直线冲锋，3.2 倍伤害并减速', range: 320, do: [{ t: 'line', len: 360, width: 120, mult: 3.2, slow: 0.4, fx: 'warhorse', big: true }] } }),
    H('秦琼', 'tang', { role: '战士', hp: 1350, atk: 50, range: 32, rate: 1.0, speed: 54, cd: 17, aura: '#3f8cff',
      passive: { name: '门神', desc: '受到的所有伤害 -15%', dr: 0.15 },
      skill: { name: '双锏', cd: 7, desc: '双锏震地，身边敌人受伤并眩晕 0.7 秒', do: [{ t: 'aoe', at: 'self', r: 90, mult: 1.6, stun: 0.7, fx: 'shock' }] },
      ult: { name: '万军取将', cd: 17, desc: '连刺 5 名敌人，优先武将', range: 300, do: [{ t: 'chain', n: 5, mult: 2.8, fx: 'tangblade' }] } }),
    H('敬德', 'tang', { role: '坦克', hp: 1900, atk: 38, range: 30, rate: 1.0, speed: 44, cd: 16, aura: '#8a7a6a',
      passive: { name: '铁壁', desc: '减伤 12%，被近战攻击时反伤 15%', dr: 0.12, thorns: 0.15 },
      skill: { name: '钢鞭', cd: 7, desc: '重击最近敌人，2 倍伤害并眩晕 1.2 秒', do: [{ t: 'stunTarget', mult: 2, dur: 1.2, fx: 'pulse' }] },
      ult: { name: '玄武门', cd: 16, desc: '范围 2.4 倍伤害、眩晕 1.6 秒，自身获护盾', do: [{ t: 'aoe', at: 'self', r: 170, mult: 2.4, stun: 1.6, fx: 'shock', big: true }, { t: 'shield', self: 0.35 }] } }),
    H('咬金', 'tang', { role: '坦克', hp: 1750, atk: 44, range: 30, rate: 0.9, speed: 48, cd: 16, aura: '#d08030',
      passive: { name: '混世', desc: '血量越低伤害越高，最多 +35%', rage: 0.35 },
      skill: { name: '劈山斧', cd: 7, desc: '前方锥形 2.4 倍伤害', do: [{ t: 'cone', len: 150, width: 100, mult: 2.4, fx: 'slash', big: true }] },
      ult: { name: '三斧定瓦岗', cd: 16, desc: '三连旋斩，每段 1.8 倍，期间减伤 35%', do: [{ t: 'spins', n: 3, r: 100, mult: 1.8, dr: 0.35, fx: 'spin' }] } }),
    H('仁贵', 'tang', { role: '射手', hp: 800, atk: 46, range: 230, rate: 1.0, speed: 48, cd: 17, ranged: true, aura: '#e8e8ff',
      passive: { name: '三箭定天山', desc: '对 160 距离外敌人伤害 +35%', longShot: 0.35 },
      skill: { name: '穿云箭', cd: 7, desc: '贯穿直线敌人 2.8 倍', do: [{ t: 'pierce', mult: 2.8, speed: 700, width: 16, life: 0.8 }] },
      ult: { name: '将军三箭', cd: 17, desc: '三箭齐发，随机重创 3 名敌人，每箭 3.2 倍', range: 420, do: [{ t: 'bolts', n: 3, mult: 3.2, range: 420 }] } }),
    H('子仪', 'tang', { role: '统帅', hp: 1650, atk: 40, range: 30, rate: 1.0, speed: 46, cd: 17, aura: '#4a9a6a',
      passive: { name: '再造唐室', desc: '身边友军减伤 12%，每秒回 0.6% 血', auraDr: { r: 180, pct: 0.12 }, auraRegen: { r: 180, pct: 0.006 } },
      skill: { name: '单骑退敌', cd: 8, desc: '嘲讽周围敌人 2 秒并获得 25% 护盾', range: 160, do: [{ t: 'taunt', r: 150, dur: 2, fx: 'warcry' }, { t: 'shield', self: 0.25 }] },
      ult: { name: '郭令公', cd: 18, desc: '治疗全军 28%，召来 2 枪 2 盾', need: 'ally', do: [{ t: 'heal', r: 320, pct: 0.28, fx: 'lotus' }, { t: 'summon', unit: ['枪', '盾'], n: 4, fx: 'portal' }] } }),
    H('玄奘', 'tang', { role: '辅助', hp: 1400, atk: 26, range: 150, rate: 1.0, speed: 46, cd: 16, ranged: true, magic: true, aura: '#ffe080',
      passive: { name: '慈悲', desc: '身边 190 内友军每秒回 1.2% 血', auraRegen: { r: 190, pct: 0.012 } },
      skill: { name: '般若', cd: 8, desc: '周围友军获 12% 护盾并回 5% 血', need: 'ally', do: [{ t: 'shield', allies: 0.12, r: 220 }, { t: 'heal', r: 220, pct: 0.05, fx: 'lotus' }] },
      ult: { name: '大雁塔', cd: 18, desc: '全军回 30% 血，并获得 15% 护盾', need: 'ally', do: [{ t: 'heal', r: 320, pct: 0.3, fx: 'lotus', big: true }, { t: 'shield', allies: 0.15, r: 320 }] } }),
    H('则天', 'tang', { role: '法师', hp: 850, atk: 34, range: 190, rate: 1.0, speed: 44, cd: 19, ranged: true, magic: true, aura: '#ff4f9a',
      passive: { name: '威仪', desc: '身边 160 内敌人移速 -28%', auraSlow: { r: 160, pct: 0.28 } },
      skill: { name: '明堂火', cd: 8, desc: '落点 2.6 倍伤害并灼烧 3 秒', do: [{ t: 'aoe', at: 'densest', r: 110, mult: 2.6, burn: 3, fx: 'meteor' }] },
      ult: { name: '曌临天下', cd: 19, desc: '大范围 3.2 倍伤害并魅惑 1.8 秒', range: 300, do: [{ t: 'aoe', at: 'densest', r: 180, mult: 3.2, charm: 1.8, fx: 'meteor', big: true }] } }),
    H('天罡', 'tang', { role: '法师', hp: 800, atk: 32, range: 180, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, aura: '#5ad1ff',
      passive: { name: '推演', desc: '看破隐身，20% 几率闪避普攻', trueSight: true, dodge: 0.2 },
      skill: { name: '北斗', cd: 7, desc: '雷击 4 名敌人，每道 2.4 倍', do: [{ t: 'bolts', n: 4, mult: 2.4, range: 340 }] },
      ult: { name: '天罗地网', cd: 18, desc: '阵内敌人持续受伤、眩晕并减速', range: 300, do: [{ t: 'zone', at: 'densest', r: 150, dur: 4, tick: 0.5, mult: 1, stun: true, slow: 0.3, glyphs: '天罗地网' }] } }),
    H('仁杰', 'tang', { role: '辅助', hp: 900, atk: 30, range: 180, rate: 1.0, speed: 46, cd: 17, ranged: true, magic: true, aura: '#3fbf6f',
      passive: { name: '断案', desc: '看破隐身，对武将伤害 +15%', trueSight: true, heroBonus: 0.15 },
      skill: { name: '律令', cd: 7, desc: '锁定最近敌人，2 倍伤害并眩晕 1.5 秒', do: [{ t: 'stunTarget', mult: 2, dur: 1.5, fx: 'pulse' }] },
      ult: { name: '狄公案', cd: 17, desc: '范围 2.2 倍伤害，眩晕 1.6 秒并减速', range: 300, do: [{ t: 'aoe', at: 'densest', r: 140, mult: 2.2, stun: 1.6, slow: 0.3, fx: 'ink', big: true, text: '案' }] } }),
    H('玉环', 'tang', { role: '辅助', hp: 800, atk: 28, range: 170, rate: 1.0, speed: 48, cd: 17, ranged: true, magic: true, aura: '#ff8fb0',
      passive: { name: '霓裳', desc: '普攻 15% 几率魅惑敌人 1 秒', charmOnHit: 0.15 },
      skill: { name: '胡旋舞', cd: 7, desc: '身边敌人 1.5 倍伤害并魅惑 1.2 秒', do: [{ t: 'aoe', at: 'self', r: 130, mult: 1.5, charm: 1.2, fx: 'petals' }] },
      ult: { name: '长恨歌', cd: 18, desc: '魅惑 1.8 秒，友军攻击 +25% 持续 6 秒', range: 300, do: [{ t: 'aoe', at: 'densest', r: 160, mult: 2, charm: 1.8, fx: 'petals', big: true }, { t: 'buff', r: 320, atk: 1.25, dur: 6, fx: 'warcry', text: '长恨' }] } }),
    H('李白', 'tang', { role: '刺客', hp: 1000, atk: 55, range: 30, rate: 0.8, speed: 72, cd: 16, assassin: true, aura: '#b48cff',
      passive: { name: '醉剑', desc: '25% 闪避普攻，20% 几率暴击 2 倍', dodge: 0.25, crit: 0.2, critMult: 2 },
      skill: { name: '青莲剑歌', cd: 6, desc: '剑气贯穿直线敌人 2.6 倍', do: [{ t: 'pierce', mult: 2.6, width: 24, life: 0.6, kind: 'crescent' }] },
      ult: { name: '十步杀一人', cd: 16, desc: '连刺 6 名敌人，每击 2.6 倍', range: 320, do: [{ t: 'chain', n: 6, mult: 2.6, fx: 'tangblade' }] } }),
    H('杜甫', 'tang', { role: '辅助', hp: 850, atk: 26, range: 160, rate: 1.0, speed: 46, cd: 16, ranged: true, magic: true, aura: '#8a9ab0',
      passive: { name: '诗史', desc: '每秒回复 1% 最大生命', regen: 0.01 },
      skill: { name: '茅屋秋风', cd: 8, desc: '为周围友军加 14% 护盾', need: 'ally', do: [{ t: 'shield', allies: 0.14, r: 240 }] },
      ult: { name: '三吏三别', cd: 18, desc: '友军回 18% 血，敌人减速并眩晕 0.6 秒', range: 300, do: [{ t: 'heal', r: 300, pct: 0.18, fx: 'lotus' }, { t: 'aoe', at: 'densest', r: 150, mult: 1.8, slow: 0.4, stun: 0.6, fx: 'ink', big: true, text: '诗' }] } }),
    H('王维', 'tang', { role: '法师', hp: 780, atk: 30, range: 190, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, aura: '#60c060',
      passive: { name: '诗中有画', desc: '身边 170 内敌人移速 -22%', auraSlow: { r: 170, pct: 0.22 } },
      skill: { name: '空山新雨', cd: 8, desc: '友军回 12% 血，落点降细雨持续伤害', need: 'ally', do: [{ t: 'heal', r: 220, pct: 0.12, fx: 'heal' }, { t: 'zone', at: 'densest', r: 120, dur: 3, tick: 0.6, mult: 0.5, slow: 0.25 }] },
      ult: { name: '大漠孤烟', cd: 18, desc: '沙暴 5 秒，持续伤害并减速 30%', range: 300, do: [{ t: 'zone', at: 'densest', r: 160, dur: 5, tick: 0.5, mult: 1.2, slow: 0.3, glyphs: '大漠孤烟' }] } }),
    H('居易', 'tang', { role: '法师', hp: 820, atk: 30, range: 180, rate: 1.0, speed: 46, cd: 18, ranged: true, magic: true, aura: '#d8a030',
      passive: { name: '长恨', desc: '普攻附带 25% 减速，持续 1.5 秒', slowOnHit: { pct: 0.25, dur: 1.5 } },
      skill: { name: '琵琶行', cd: 7, desc: '直线 1.8 倍伤害并减速 40%', do: [{ t: 'line', len: 300, width: 70, mult: 1.8, slow: 0.4, fx: 'wave' }] },
      ult: { name: '卖炭翁', cd: 18, desc: '召来 4 名兵士，友军攻击 +25% 持续 6 秒', need: 'ally', do: [{ t: 'summon', unit: ['刀', '盾'], n: 4, fx: 'portal' }, { t: 'buff', r: 280, atk: 1.25, dur: 6, fx: 'warcry', text: '卖炭' }] } }),
    H('禄山', 'tang', { role: '战士', hp: 1450, atk: 52, range: 30, rate: 0.9, speed: 58, cd: 17, aura: '#8a5a2a',
      passive: { name: '胡骑', desc: '攻击 +12%', atkMult: 1.12 },
      skill: { name: '铁骑冲锋', cd: 7, desc: '冲锋 2.6 倍伤害并击退', do: [{ t: 'dash', mult: 2.6, knock: true }] },
      ult: { name: '渔阳鼙鼓', cd: 17, desc: '召来 5 名精兵，周围 2.2 倍伤害', do: [{ t: 'summon', unit: ['刺', '枪'], n: 5, fx: 'portal' }, { t: 'aoe', at: 'self', r: 130, mult: 2.2, fx: 'warcry', big: true }] } }),
    // ===== 自定义专属 =====
    H('夏夏', 'custom', { role: '特殊', hp: 950, atk: 26, range: 150, rate: 1.0, speed: 48, cd: 16, ranged: true, magic: true, aura: '#ffd166',
      passive: { name: '巧手', desc: '在场时每 1 秒自动把两张同级小兵合成', autoMerge: { every: 1 } },
      skill: { name: '飞针', cd: 7, desc: '飞针点穴，1.8 倍伤害并眩晕 1.2 秒', do: [{ t: 'stunTarget', mult: 1.8, dur: 1.2, fx: 'pulse' }] },
      ult: { name: '天工开物', cd: 17, desc: '友军获 18% 护盾，攻击 +25% 持续 6 秒', need: 'ally', do: [{ t: 'shield', allies: 0.18, r: 300 }, { t: 'buff', r: 300, atk: 1.25, dur: 6, fx: 'warcry', text: '天工' }] } }),
  ].forEach((h) => (HEROES[h.name] = h));
  JQ.HEROES = HEROES;

  // 卡包：决定招兵能抽到哪些字、能合哪些英雄、能抽到哪些小兵
  JQ.PACKS = {
    sanguo: { name: '三国', open: true },
    xiyou: { name: '西游', open: true },
    xuanhuan: { name: '玄幻', open: false },
    mofa: { name: '魔法', open: false },
    tang: { name: '唐朝', open: true },
    song: { name: '宋朝', open: false },
    custom: { name: '自定义', open: true },
  };
  for (const [k, p] of Object.entries(JQ.PACKS)) {
    p.heroes = Object.values(HEROES).filter((h) => h.pack === k).map((h) => h.name);
    p.units = (PACK_UNITS[k] || PACK_UNITS.custom).slice();
  }
  JQ.OPEN_PACKS = Object.keys(JQ.PACKS).filter((k) => JQ.PACKS[k].open);

  // ---------- 关卡与自定义卡包 ----------
  JQ.stageBoost = (stage) => {
    const n = Math.max(0, Math.min(C.MAX_STAGE, stage || 1) - 1);
    return 1 + 0.009 * n + 0.000015 * n * n; // 第 200 关约 3.39 倍
  };
  JQ.stageBoss = (stage) => (stage >= 20 && stage % 20 === 0 ? (stage >= 100 ? 2 : 1) : 0); // 每 20 关敌方多一位开局英雄
  JQ.DEFAULT_CUSTOM_UNITS = ['刀', '盾', '弓', '枪', '剑', '刺', '骑', '弩'];
  JQ.DEFAULT_CUSTOM_HEROES = ['夏夏', '刘备', '关羽', '张飞', '赵云', '孔明', '黄忠', '曹操', '曹仁', '典韦', '许褚', '孙策', '孙权', '周瑜', '吕布', '貂蝉'];
  JQ.customReady = () => !!(JQ.PACKS.custom && JQ.PACKS.custom.ready);
  JQ.setCustomPack = function (cfg) {
    cfg = cfg || {};
    const heroes = [...new Set((cfg.heroes || []).filter((n) => HEROES[n]))].slice(0, 16);
    const units = [...new Set((cfg.units || []).filter((k) => UNITS[k]))].slice(0, 12);
    JQ.PACKS.custom.heroes = heroes;
    JQ.PACKS.custom.units = units.length >= 6 ? units : JQ.DEFAULT_CUSTOM_UNITS.slice();
    JQ.PACKS.custom.ready = heroes.length === 16 && JQ.PACKS.custom.units.length >= 6;
    return JQ.PACKS.custom.ready;
  };
  JQ.setCustomPack({ heroes: JQ.DEFAULT_CUSTOM_HEROES, units: JQ.DEFAULT_CUSTOM_UNITS });

  JQ.packUnits = (pack) => ((JQ.PACKS[pack] && JQ.PACKS[pack].units) || JQ.PACK_UNITS.custom).slice();
  JQ.heroInPack = (name, pack) => !!(JQ.PACKS[pack] && JQ.PACKS[pack].heroes.includes(name));
  JQ.partnerOf = (name, ch) => {
    const cs = HEROES[name].chars;
    return cs[0] === cs[1] ? cs[0] : cs.find((x) => x !== ch);
  };
  JQ.cardMaxLevel = (card) => (card && card.kind === 'unit' ? Infinity : C.MAX_LEVEL);
  JQ.cardLevelOk = (card) => !!card && card.level < JQ.cardMaxLevel(card);

  // 字 → 能参与的英雄（全卡包）
  JQ.CHAR_HEROES = {};
  for (const h of Object.values(HEROES)) for (const ch of new Set(h.chars)) (JQ.CHAR_HEROES[ch] = JQ.CHAR_HEROES[ch] || []).push(h.name);
  JQ.packChars = (pack) => [...new Set((JQ.PACKS[pack].heroes || []).flatMap((n) => HEROES[n].chars))];
  JQ.heroOf = function (a, b, pack) {
    for (const name of JQ.CHAR_HEROES[a] || []) {
      if (pack && !JQ.heroInPack(name, pack)) continue;
      const cs = HEROES[name].chars;
      if ((cs[0] === a && cs[1] === b) || (cs[0] === b && cs[1] === a)) return name;
    }
    return null;
  };
  // 一个字能和哪些字凑英雄
  JQ.partnersOf = (ch) => (JQ.CHAR_HEROES[ch] || []).map((n) => JQ.partnerOf(n, ch)).filter(Boolean);

  // 建筑：占格子，常驻生效
  const BUILDINGS = {
    马: { desc: '主角移速 +20%/级' },
    鼓: { desc: '全部卡牌冷却 -8%/级' },
    旗: { desc: '我方小兵攻击 +8%/级' },
    粮: { desc: '主角踩到 +3 包子/级' },
  };
  JQ.BUILDINGS = BUILDINGS;

  // 道具：点一下使用；也可以拖到格子上存着，同名同级可合成升级，等级越高效果越强
  const ITEMS = {
    药: { desc: '基地回复 400×等级 血' },
    金: { desc: '立得 25×等级 包子' },
    令: { desc: '清空卡牌和英雄冷却；2 级起英雄技能大招立刻就绪；3 级起全军攻击 +30% 持续 6 秒' },
  };
  JQ.ITEMS = ITEMS;

  // 格子块：拼到棋盘边上扩大巡营路线（坐标为 [行, 列]，行 0 在最前排）
  const TILES = {
    单: { name: '单格', cells: [[0, 0]], w: 1 },
    横: { name: '横二', cells: [[0, 0], [0, 1]], w: 0.8 },
    竖: { name: '竖二', cells: [[0, 0], [1, 0]], w: 0.8 },
    曲: { name: '曲尺', cells: [[0, 0], [1, 0], [1, 1]], w: 0.4 },
    田: { name: '田字', cells: [[0, 0], [0, 1], [1, 0], [1, 1]], w: 0.25 },
  };
  JQ.TILES = TILES;

  // 招兵卡池权重：小兵按卡包单独加（见 sim.js buildPool），这里只放公共的建筑/道具/格子
  const POOL = [];
  const add = (kind, key, w) => POOL.push({ kind, key, w });
  for (const k of Object.keys(BUILDINGS)) add('building', k, 2);
  for (const k of Object.keys(ITEMS)) add('item', k, 0.3);
  for (const [k, t] of Object.entries(TILES)) add('tile', k, t.w);
  JQ.POOL = POOL;
  JQ.CHAR_WEIGHT = 16; // 文字卡总权重：再略降一档
  JQ.POOL_TOTAL = POOL.reduce((s, p) => s + p.w, 0);

  // 每局规则：模式在默认值上覆盖
  JQ.defaultRules = () => ({
    time: 300,              // 对局时长（秒），Infinity = 不限时
    overtime: 60,           // 最后多少秒进入决战时刻
    income: C.INCOME,
    crystal: C.CRYSTAL_BUNS,
    recruitCost: C.RECRUIT_COST,
    recruitStep: C.RECRUIT_STEP,
    recruitMax: C.RECRUIT_MAX,
    baseHp: C.BASE_HP,
    startBuns: C.START_BUNS,
    ultLevel: C.ULT_LEVEL,
    walkTime: C.WALK_TIME,
    weights: {},            // 卡池按种类加权，如 { char: 3 }
    startHero: false,       // 开局送一位英雄
    events: false,          // 天命事件
    waves: false,           // 守关：没有对手棋盘，敌军按波次来
  });

  JQ.MODES = {
    classic: { name: '经典', desc: '200 关闯关，打爆对面基地；每关敌人更强', rules: {} },
    fate: {
      name: '天命',
      desc: '200 关闯关 + 开局送英雄、天命事件、天赋成长',
      rules: { events: true, ultLevel: 2, weights: { char: 2.2, unit: 0.75 }, startHero: true, meta: true },
    },
    survival: {
      name: '无限',
      desc: '没有对手棋盘，敌军一波比一波强，每 4 波来一位敌将，看你能守几波',
      rules: { waves: true, time: Infinity },
    },
  };

  // 天赋词条（天命模式）：最多同时带 3 条；每赢一局商店随机刷出 3 条可买。fx 字段由 sim.js mergeTalents/各处解释
  const TL = (cat, id, name, cost, desc, fx) => ({ cat, id, name, cost, desc, fx });
  JQ.TALENTS = [
    // 经济
    TL('经济', 'tuntian', '屯田', 60, '包子产出 +15%', { income: 1.15 }),
    TL('经济', 'shanggu', '商贾', 50, '招兵便宜 3 包', { recruitDiscount: 3 }),
    TL('经济', 'xianshou', '先手', 40, '开局多 40 包子', { startBuns: 40 }),
    TL('经济', 'jiejian', '节俭', 30, '卖卡每张多得 1 包', { sellBonus: 1 }),
    TL('经济', 'fushang', '富商', 70, '每次招兵 20% 几率不花钱', { freeRecruit: 0.2 }),
    TL('经济', 'dianshi', '点石成金', 60, '卖卡价格翻倍', { sellMult: 2 }),
    // 卡池
    TL('卡池', 'qigong', '弃弓', 40, '招兵不再出现「弓」，其他兵更常见', { ban: '弓' }),
    TL('卡池', 'qidun', '弃盾', 40, '招兵不再出现「盾」，其他兵更常见', { ban: '盾' }),
    TL('卡池', 'qici', '弃刺', 40, '招兵不再出现「刺」，其他兵更常见', { ban: '刺' }),
    TL('卡池', 'qiqiang', '弃枪', 40, '招兵不再出现「枪」，其他兵更常见', { ban: '枪' }),
    TL('卡池', 'qiuxian', '求贤', 80, '文字卡出现率 +40%', { w: { char: 1.4 } }),
    TL('卡池', 'jingbing', '精兵', 60, '兵卡出现率 +40%，文字卡 -30%', { w: { unit: 1.4, char: 0.7 } }),
    TL('卡池', 'zhucheng', '筑城', 40, '格子块出现率翻倍', { w: { tile: 2 } }),
    // 兵种
    TL('兵种', 'zhanshi', '战士强化', 90, '刀、剑、枪攻击 +20%', { meleeAtk: 1.2 }),
    TL('兵种', 'yuancheng', '远程强化', 90, '弓攻击 +25%，射程 +30', { rangedAtk: 1.25, rangedRange: 30 }),
    TL('兵种', 'cike', '刺客突袭', 80, '刺出场隐身 2.5 秒，攻击 +25%', { assassinStealth: 2.5, assassinAtk: 1.25 }),
    TL('兵种', 'dunzhen', '铁壁盾阵', 70, '盾血量 +40%', { shieldHp: 1.4 }),
    TL('兵种', 'changqiang', '长枪如林', 70, '枪对英雄伤害 1.8 倍 → 2.6 倍', { spearBonus: 2.6 }),
    TL('兵种', 'jianqi', '剑气纵横', 80, '剑攻击时顺带砍到身边 1 个敌人（50% 伤害）', { swordSplash: 0.5 }),
    TL('兵种', 'liannu', '连弩', 80, '弓 35% 几率一次射出两箭', { bowDouble: 0.35 }),
    TL('兵种', 'tieqi', '铁骑', 60, '小兵移速 +20%', { unitSpeed: 1.2 }),
    TL('兵种', 'modao', '磨刀', 90, '小兵攻击 +12%', { unitAtk: 1.12 }),
    TL('兵种', 'jianjia', '坚甲', 90, '小兵血量 +15%', { unitHp: 1.15 }),
    TL('兵种', 'yinxue', '饮血', 80, '小兵造成伤害的 12% 转为血量', { unitLifesteal: 0.12 }),
    TL('兵种', 'sishi', '死士', 70, '小兵阵亡时 30% 几率自爆，炸伤身边敌人', { deathBlast: 0.3 }),
    TL('兵种', 'liangcao', '粮草充足', 60, '同兵种在场上限 +50%', { capMult: 1.5 }),
    TL('兵种', 'yuanjun', '援军', 90, '每 25 秒自动召出 3 名刀兵', { reinforce: 25 }),
    // 英雄
    TL('英雄', 'mingjiang', '名将', 100, '英雄血量 +20%', { heroHp: 1.2 }),
    TL('英雄', 'shentong', '神通', 100, '英雄大招冷却 -25%', { ultCd: 0.75 }),
    TL('英雄', 'shuangying', '双英', 120, '开局多送一位英雄', { extraHero: 1 }),
    TL('英雄', 'tongshuai', '统帅', 90, '英雄身边 160 内的友军攻速 +25%', { command: 0.25 }),
    TL('英雄', 'wangzhe', '王者归来', 70, '英雄阵亡后复活冷却减半', { heroRespawn: 0.5 }),
    // 防守与节奏
    TL('防守', 'chengfang', '城防', 70, '基地 +800 血，箭楼伤害 +50%', { baseHp: 800, tower: 1.5 }),
    TL('防守', 'jincheng', '金城汤池', 80, '基地受到伤害 -20%', { baseDr: 0.2 }),
    TL('防守', 'huichun', '回春', 60, '基地每秒回复 4 血', { baseRegen: 4 }),
    TL('防守', 'qianshao', '前哨', 50, '前哨格血量翻倍', { outpost: 2 }),
    TL('防守', 'kuaima', '快马', 50, '主角移速 +25%', { walk: 1.25 }),
    TL('防守', 'jixing', '急行军', 70, '全部卡牌冷却 -15%', { cdMult: 0.85 }),
    // 特殊
    TL('特殊', 'tianming', '天命所归', 110, '瘟疫、天雷只落在对手头上；甘霖、神兵只给自己', { fateFavor: true }),
    TL('特殊', 'pofu', '破釜沉舟', 80, '全军攻击 +25%，但基地血量 -30%', { allAtk: 1.25, baseHpMult: 0.7 }),
    TL('特殊', 'beishui', '背水一战', 70, '基地血量低于 30% 时全军伤害 +40%', { lastStand: true }),
    TL('特殊', 'tanlan', '贪婪', 60, '赢一场多得 60% 金币，但对手多带一条天赋', { greed: true }),
    // ===== 扩展天赋 =====
    TL('经济', 'zhongshui', '重税', 55, '包子产出 +25%，小兵血量 -10%', { income: 1.25, unitHp: 0.9 }),
    TL('经济', 'zhanlipin', '战利品', 65, '每次击杀额外 +1 包子', { killBuns: 1 }),
    TL('经济', 'jiedai', '借贷', 40, '开局 +80 包子，基地 -300 血', { startBuns: 80, baseHp: -300 }),
    TL('经济', 'jingsuan', '精打细算', 55, '招兵便宜 2 包，卖价 -25%', { recruitDiscount: 2, sellMult: 0.75 }),
    TL('经济', 'taojin', '淘金', 50, '卖卡每张多得 2 包', { sellBonus: 2 }),
    TL('卡池', 'mubing', '募兵', 70, '兵卡出现率 +30%，文字卡 -20%', { w: { unit: 1.3, char: 0.8 } }),
    TL('卡池', 'keju', '科举', 70, '文字卡出现率 +50%，兵卡 -20%', { w: { char: 1.5, unit: 0.8 } }),
    TL('卡池', 'gongjiang', '工匠', 50, '格子块出现率 +150%', { w: { tile: 2.5 } }),
    TL('卡池', 'qijian', '弃剑', 40, '招兵不再出现「剑」', { ban: '剑' }),
    TL('卡池', 'qinu', '弃弩', 40, '招兵不再出现「弩」', { ban: '弩' }),
    TL('卡池', 'qiqi', '弃骑', 40, '招兵不再出现「骑」', { ban: '骑' }),
    TL('兵种', 'dunqiang', '盾墙', 75, '盾血量 +60%，小兵移速 -10%', { shieldHp: 1.6, unitSpeed: 0.9 }),
    TL('兵种', 'qiangnu', '强弩', 80, '远程攻击 +20%，射程 +40', { rangedAtk: 1.2, rangedRange: 40 }),
    TL('兵种', 'qishe', '骑射', 70, '小兵移速 +25%，攻击 +8%', { unitSpeed: 1.25, unitAtk: 1.08 }),
    TL('兵种', 'guiying', '鬼影', 75, '刺客隐身 +3 秒，攻击 +15%', { assassinStealth: 3, assassinAtk: 1.15 }),
    TL('兵种', 'xuezhan', '血战', 65, '小兵吸血 8%，血量 -10%', { unitLifesteal: 0.08, unitHp: 0.9 }),
    TL('兵种', 'tiejia', '铁甲', 75, '小兵受到伤害 -10%', { unitDr: 0.1 }),
    TL('兵种', 'kuangre', '狂热', 85, '小兵攻击 +20%，血量 -15%', { unitAtk: 1.2, unitHp: 0.85 }),
    TL('英雄', 'yinghun', '英魂', 90, '英雄攻击 +20%', { heroAtk: 1.2 }),
    TL('英雄', 'yingyan', '鹰眼', 70, '英雄射程 +40', { heroRange: 40 }),
    TL('英雄', 'shuangjue', '双绝', 85, '英雄大招冷却 -15%', { ultCd: 0.85 }),
    TL('英雄', 'taoyuan', '桃园', 70, '英雄血量 +15%，基地 -200 血', { heroHp: 1.15, baseHp: -200 }),
    TL('英雄', 'zhaoxian', '招贤', 100, '开局多送一位英雄，英雄血量 -15%', { extraHero: 1, heroHp: 0.85 }),
    TL('英雄', 'wuhun', '武魂', 80, '英雄攻击 +10%，小兵攻击 -5%', { heroAtk: 1.1, unitAtk: 0.95 }),
    TL('防守', 'jianta', '箭塔', 65, '箭塔伤害 +100%', { tower: 2 }),
    TL('防守', 'chengzhuan', '城砖', 55, '基地 +500 血', { baseHp: 500 }),
    TL('防守', 'tiebi', '铁壁', 65, '基地受到伤害 -15%，包子 -10%', { baseDr: 0.15, income: 0.9 }),
    TL('防守', 'qianshao2', '前哨加固', 60, '前哨格血量 +150%', { outpost: 2.5 }),
    TL('防守', 'jixing2', '疾行', 55, '主角移速 +35%，卡牌冷却 +10%', { walk: 1.35, cdMult: 1.1 }),
    TL('防守', 'buji', '补给', 55, '基地每秒回 8 血，基地 -200 血', { baseRegen: 8, baseHp: -200 }),
    TL('特殊', 'xiaxia', '巧手强化', 80, '夏夏自动合成间隔 -30%', { autoMerge: 0.7 }),
    TL('特殊', 'tiangong', '天工', 70, '文字保底概率 +20%', { charPity: 0.2 }),
    TL('特殊', 'fuxing', '福星', 65, '格子保底从 7 次缩到约 4 次', { tilePity: 0.6 }),
    TL('特殊', 'baofu', '暴富', 60, '开局 +100 包子，基地 -500 血', { startBuns: 100, baseHp: -500 }),
    TL('特殊', 'guzhu', '孤注一掷', 85, '全军攻击 +30%，基地血量 -40%', { allAtk: 1.3, baseHpMult: 0.6 }),
    TL('特殊', 'changsheng', '长生', 60, '基地每秒回 2 血，前哨血量 +20%', { baseRegen: 2, outpost: 1.2 }),
  ];
  JQ.TALENT_CATS = { 经济: '#d8a030', 卡池: '#6a8ad0', 兵种: '#c05040', 英雄: '#b060c0', 防守: '#4a9a6a', 特殊: '#808080' };
  JQ.TALENT_BY_ID = Object.fromEntries(JQ.TALENTS.map((t) => [t.id, t]));
  JQ.MAX_TALENTS = 3;
  // 天命阶数对应的对手：天赋条数、加持倍率（7 阶起每阶 +5%）
  JQ.fateEnemy = (tier) => ({ talents: Math.min(3, Math.floor(tier / 2)), boost: 1 + 0.05 * Math.max(0, tier - 6) });
  // 对手优先挑的战斗类天赋
  JQ.COMBAT_TALENTS = ['modao', 'jianjia', 'mingjiang', 'shentong', 'tieqi', 'chengfang', 'pofu', 'tuntian', 'zhanshi', 'yuancheng', 'tongshuai', 'jincheng', 'zhongshui', 'dunqiang', 'qiangnu', 'qishe', 'guiying', 'tiejia', 'kuangre', 'yinghun', 'yingyan', 'jianta', 'tiebi', 'guzhu'];

  // 天命事件：fn(game) 生效
  JQ.EVENTS = [
    { name: '天降甘霖', desc: '双方各得 30 包子' },
    { name: '神兵天降', desc: '双方备战席各得一张 3 级兵卡' },
    { name: '瘟疫横行', desc: '场上所有单位损失 40% 血量' },
    { name: '杀气冲天', desc: '15 秒内所有单位伤害 ×1.6' },
    { name: '神行太保', desc: '15 秒内主角移速翻倍' },
    { name: '天雷滚滚', desc: '天雷随机劈落 10 次，不分敌我' },
    { name: '招贤纳士', desc: '15 秒内招兵免费' },
  ];

  JQ.levelMult = (lv) => 1 + 0.35 * (lv - 1);
  JQ.heroLevelMult = (lv) => 1 + 0.3 * (lv - 1);
  JQ.unitCount = (lv) => (lv >= 5 ? 4 : [1, 1, 2, 2][lv - 1] || 1); // 5 级起每次召 4 个，作为合卡门槛
  // 等级配色：1 灰、2 绿、3 蓝、4 紫、5 金
  JQ.LEVEL_COLORS = ['#888', '#8c8c8c', '#2fa84f', '#2a7be0', '#9a3ee0', '#f0a020'];

  // 可复现随机数
  JQ.rng = function (seed) {
    let s = seed >>> 0 || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  };
})();
