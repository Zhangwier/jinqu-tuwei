// 对手 AI：和玩家用同一套接口（刷新招兵栏/拿卡/移动卡/卖卡）。
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const JQ = (G.JQ = G.JQ || {});
  const { C } = JQ;

  const free = (b, r, c) => {
    const x = b.cell(r, c);
    return !!(x && x.unlocked && !x.crystal && !x.card);
  };
  const hNeighbors = (b, x) => [b.cell(x.r, x.c - 1), b.cell(x.r, x.c + 1)].filter(Boolean);
  const isChar = (x) => x && x.card && x.card.kind === 'char';

  function linkedHeroes(b) {
    return new Set(b.links.map((l) => l.hero));
  }

  // 新英雄：与 ch 左右相邻能组成、且场上还没有的英雄
  function newHero(b, ch, other) {
    const h = b.heroOf(ch, other);
    return h && !linkedHeroes(b).has(h) ? h : null;
  }

  // 落单字旁边的空格留给它的另一半
  function reserved(b) {
    const set = new Set();
    for (const x of b.all()) if (isChar(x) && !x.links.length) for (const n of hNeighbors(b, x)) if (free(b, n.r, n.c)) set.add(n);
    return set;
  }

  function useful(game, sid, card) {
    const b = game.sides[sid].board;
    if (!card) return false;
    if (card.kind === 'tile') return b.tileFits(card.key);
    if (card.kind === 'item') return card.key !== '药' || game.sides[sid].hp < game.sides[sid].maxHp - 300;
    return b.emptyCells().length > 0 || b.all().some((x) => x.card && JQ.sameCard(x.card, card) && JQ.cardLevelOk(x.card));
  }

  // profile 缺省：对手用当前难度，玩家方（自动演示）用“普通玩家”画像
  JQ.aiThink = function (game, sid, profile) {
    const P = profile || (sid === 1 ? game.diff : JQ.DIFF.human);
    const s = game.sides[sid];
    const b = s.board;
    if (game.over) return;
    const shop = s.shop;
    // 每次思考只能做有限几步，像人一样一张张放，不会一瞬间铺满
    let budget = P.actions;
    const G = {
      take: (...a) => (budget > 0 && game.take(...a) ? (budget--, true) : false),
      move: (...a) => (budget > 0 && game.move(...a) ? (budget--, true) : false),
      recruit: (...a) => (budget > 0 && game.recruit(...a) ? (budget--, true) : false),
    };
    const rnd = () => game.rand();

    // 道具
    shop.forEach((h, i) => {
      if (!h || h.kind !== 'item') return;
      if (h.key === '金') G.take(sid, i);
      else if (h.key === '药' && s.hp < s.maxHp - 300) G.take(sid, i);
      else if (h.key === '令' && b.all().filter((x) => x.cd > 1.5).length >= 3) G.take(sid, i);
    });

    // 格子块：前排、靠中间优先
    shop.forEach((h, i) => {
      if (!h || h.kind !== 'tile') return;
      const mid = (C.COLS - 1) / 2;
      // 先往后方扩，后方满了才往战场里放前哨
      const rank = (x) => (x.r < 0 ? 10 - x.r : x.r);
      const spots = b.frontier().sort((a, x) => rank(a) - rank(x) || Math.abs(a.c - mid) - Math.abs(x.c - mid));
      for (const x of spots) if (G.take(sid, i, x.r, x.c)) break;
    });

    // 场上同名同级卡合并（低手速 AI 不会）
    for (let guard = 0; P.smart && guard < 10; guard++) {
      const cards = b.all().filter((x) => x.card && JQ.cardLevelOk(x.card));
      let done = false;
      for (const a of cards) {
        const t = cards.find((x) => x !== a && JQ.sameCard(x.card, a.card));
        if (t) {
          // 留下有英雄组合的那张
          const [from, to] = a.links.length ? [t, a] : [a, t];
          if (from.links.length) continue;
          if (b.canMove(from.r, from.c, to.r, to.c) === 'merge') G.move(sid, from.r, from.c, to.r, to.c);
          done = true;
          break;
        }
      }
      if (!done) break;
    }

    // 招兵栏的卡叠到场上同名同级卡
    shop.forEach((h, i) => {
      if (!h || !JQ.boardable(h)) return;
      const t = b.all().find((x) => x.card && b.canPlace(h, x.r, x.c) === 'merge');
      if (t) G.take(sid, i, t.r, t.c);
    });

    // 字：贴到能成新英雄的字旁边
    shop.forEach((h, i) => {
      if (!h || h.kind !== 'char') return;
      for (const x of b.all()) {
        if (!isChar(x) || !newHero(b, h.key, x.card.key)) continue;
        const spot = hNeighbors(b, x).find((n) => free(b, n.r, n.c));
        if (spot && G.take(sid, i, spot.r, spot.c)) return;
      }
      // 招兵栏里两字成对：找一对横向空格
      const j = shop.findIndex((o, k) => k !== i && o && o.kind === 'char' && newHero(b, h.key, o.key));
      if (j >= 0) {
        for (const x of b.emptyCells())
          if (free(b, x.r, x.c + 1)) {
            G.take(sid, i, x.r, x.c);
            G.take(sid, j, x.r, x.c + 1);
            return;
          }
      }
      if (b.emptyCells().length >= 3) {
        const spot = b.emptyCells().find((x) => free(b, x.r, x.c - 1) || free(b, x.r, x.c + 1));
        if (spot) G.take(sid, i, spot.r, spot.c);
      }
    });

    // 场上两个能成英雄的字不相邻：把其中一个挪过去（空格或换走非字卡）；简单难度不会
    for (const x of P.smart ? b.all() : []) {
      if (!isChar(x) || x.links.length) continue;
      const y = b.all().find((o) => o !== x && isChar(o) && !o.links.length && newHero(b, x.card.key, o.card.key));
      if (!y) continue;
      const spot = hNeighbors(b, x).find((n) => n.unlocked && !n.crystal && n !== y && !(n.card && (n.card.kind === 'char' || n.links.length)));
      if (spot) {
        G.move(sid, y.r, y.c, spot.r, spot.c);
        break;
      }
    }

    // 兵卡与建筑
    shop.forEach((h, i) => {
      if (!h || (h.kind !== 'unit' && h.kind !== 'building')) return;
      const empties = b.emptyCells();
      if (!empties.length) return;
      const res = reserved(b);
      const open = empties.filter((x) => !res.has(x));
      const pool = open.length ? open : empties.length > 2 ? [] : empties;
      if (!pool.length) return;
      // 兵卡放前排（离战场近），建筑放后排；简单难度随手乱放
      if (P.smart) pool.sort((a, x) => (h.kind === 'unit' ? a.r - x.r : x.r - a.r));
      const pick = P.smart ? pool[0] : pool[Math.floor(rnd() * pool.length)];
      G.take(sid, i, pick.r, pick.c);
    });

    // 招兵：栏里没用的了就刷新；钱多也刷
    const cost = s.recruitCost();
    const anyUseful = shop.some((h) => useful(game, sid, h));
    if (game.canRecruit(sid) && (!anyUseful || (P.smart && s.buns >= cost + 35))) G.recruit(sid);
  };
})();
