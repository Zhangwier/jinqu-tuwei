// 棋盘模型：格子解锁、放卡/移卡/合卡、英雄字组合、格子块、主角巡营路线。
// 行 0 = 面向战场的一排，行号越大越靠后；渲染时由 cellRect 决定上下镜像。
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const JQ = (G.JQ = G.JQ || {});
  const { C } = JQ;

  let nextCardId = 1;
  JQ.makeCard = function (kind, key, level) {
    return { id: nextCardId++, kind, key, level: level || 1 };
  };

  JQ.sameCard = (a, b) => !!(a && b && a.kind === b.kind && a.key === b.key && a.level === b.level);
  JQ.boardable = (card) => card && (card.kind === 'unit' || card.kind === 'char' || card.kind === 'building' || card.kind === 'item');

  const NB = [[0, 1], [0, -1], [1, 0], [-1, 0]];

  class Board {
    constructor(pack) {
      this.pack = pack || 'sanguo';
      // 行号 -FWD..-1 是伸进战场的前哨排，0..ROWS-1 是基地后方
      this.rows = [];
      for (let r = -C.FWD; r < C.ROWS; r++) this.rows.push(r);
      this.cells = this.rows.map((r) => {
        const row = [];
        for (let c = 0; c < C.COLS; c++) row.push({ r, c, unlocked: false, crystal: false, card: null, cd: 0, links: [], forward: r < 0 });
        return row;
      });
      const mid = Math.floor(C.COLS / 2);
      for (const c of [mid - 1, mid, mid + 1]) {
        this.cell(0, c).unlocked = true;
        this.cell(1, c).unlocked = true;
      }
      this.cell(0, mid).crystal = true;
      this.links = [];
      this.rebuild();
    }

    cell(r, c) {
      const row = this.cells[r + C.FWD];
      return row && row[c];
    }

    all() {
      return this.cells.flat();
    }

    // 主角路线：蛇形，偶数排左→右、奇数排右→左；主角沿它来回走
    // 英雄：同一排左右相邻的两个字能组成英雄就合成（不分先后），同名英雄只取等级最高的一对
    rebuild() {
      this.path = [];
      for (const r of this.rows) {
        const row = this.cell(r, 0) && this.cells[r + C.FWD].filter((x) => x.unlocked);
        this.path.push(...((r + C.FWD) % 2 ? row.reverse() : row));
      }
      for (const x of this.all()) x.links = [];
      const best = {};
      for (const r of this.rows)
        for (let c = 0; c < C.COLS - 1; c++) {
          const A = this.cell(r, c), B = this.cell(r, c + 1);
          if (!A.card || !B.card || A.card.kind !== 'char' || B.card.kind !== 'char') continue;
          const hero = JQ.heroOf(A.card.key, B.card.key, this.pack);
          if (!hero) continue;
          // 英雄只算一个等级：取两字中较高的那级
          const level = Math.max(A.card.level, B.card.level);
          if (!best[hero] || best[hero].level < level) best[hero] = { hero, r, c, level, cells: [A, B] };
        }
      this.links = Object.values(best);
      for (const l of this.links) for (const x of l.cells) x.links.push(l);
    }

    // 把这个字喂给格子上的英雄：该英雄的任一字（不论几级）都能让英雄升 1 级
    heroLinkFor(cell, card) {
      if (!cell || !card || card.kind !== 'char') return null;
      const ls = cell.links.filter((l) => l.level < C.MAX_LEVEL && JQ.HEROES[l.hero].chars.includes(card.key));
      return ls.sort((a, b) => a.level - b.level)[0] || null;
    }

    upgradeLink(link) {
      const lv = link.level + 1;
      for (const x of link.cells) x.card.level = Math.max(x.card.level, lv);
    }

    // 卡能否放到 (r,c)：返回 'place' | 'merge' | null
    canPlace(card, r, c) {
      const cell = this.cell(r, c);
      if (!cell || !cell.unlocked || cell.crystal || !JQ.boardable(card)) return null;
      if (!cell.card) return 'place';
      if (this.heroLinkFor(cell, card)) return 'merge';
      if (!cell.links.length && JQ.sameCard(cell.card, card) && JQ.cardLevelOk(cell.card)) return 'merge';
      return null;
    }

    place(card, r, c) {
      const how = this.canPlace(card, r, c);
      const cell = this.cell(r, c);
      if (how === 'place') {
        cell.card = card;
        cell.cd = 0;
      } else if (how === 'merge') {
        const link = this.heroLinkFor(cell, card);
        if (link) this.upgradeLink(link);
        else cell.card.level++;
      }
      if (how) this.rebuild();
      return how;
    }

    // 备战席的卡顶替场上一张不同的卡：返回被换下来的卡
    canReplace(card, r, c) {
      const cell = this.cell(r, c);
      return !!(cell && cell.unlocked && !cell.crystal && cell.card && JQ.boardable(card) && !this.canPlace(card, r, c));
    }

    swapIn(card, r, c) {
      if (!this.canReplace(card, r, c)) return null;
      const cell = this.cell(r, c);
      const old = cell.card;
      cell.card = card;
      cell.cd = 0;
      this.rebuild();
      return old;
    }

    // 场上卡移动：空格=移动，同名同级=合并，其他卡=互换
    canMove(r1, c1, r2, c2) {
      const a = this.cell(r1, c1), b = this.cell(r2, c2);
      if (!a || !b || a === b || !a.card || !b.unlocked || b.crystal) return null;
      if (!b.card) return 'move';
      const link = this.heroLinkFor(b, a.card);
      if (link && !link.cells.includes(a)) return 'merge';
      if (!b.links.length && JQ.sameCard(a.card, b.card) && JQ.cardLevelOk(b.card)) return 'merge';
      return 'swap';
    }

    move(r1, c1, r2, c2) {
      const how = this.canMove(r1, c1, r2, c2);
      if (!how) return null;
      const a = this.cell(r1, c1), b = this.cell(r2, c2);
      if (how === 'merge') {
        const link = this.heroLinkFor(b, a.card);
        if (link) this.upgradeLink(link);
        else b.card.level++;
        a.card = null;
        a.cd = 0;
      } else {
        [a.card, b.card] = [b.card, a.card];
        [a.cd, b.cd] = [b.cd, a.cd];
      }
      this.rebuild();
      return how;
    }

    remove(r, c) {
      const cell = this.cell(r, c);
      if (!cell || !cell.card) return null;
      const card = cell.card;
      cell.card = null;
      cell.cd = 0;
      this.rebuild();
      return card;
    }

    touchesUnlocked(cell) {
      return NB.some(([dr, dc]) => {
        const n = this.cell(cell.r + dr, cell.c + dc);
        return n && n.unlocked;
      });
    }

    heroOf(a, b) {
      return JQ.heroOf(a, b, this.pack);
    }

    // 格子块放在锚点 (r,c)：出界或已解锁的格子跳过，只填能填的；
    // 返回要解锁的格子（至少一格贴着已解锁格），放不了返回 null
    tileCells(key, r, c) {
      const cells = JQ.TILES[key].cells.map(([dr, dc]) => this.cell(r + dr, c + dc)).filter((x) => x && !x.unlocked);
      return cells.length && cells.some((x) => this.touchesUnlocked(x)) ? cells : null;
    }

    canPlaceTile(key, r, c) {
      return !!this.tileCells(key, r, c);
    }

    // 指着 (r,c) 放块：块里任意一格对准它都行，挑能填最多格的摆法
    tileAnchor(key, r, c) {
      const target = this.cell(r, c);
      if (!target || target.unlocked) return null;
      let best = null;
      for (const [dr, dc] of JQ.TILES[key].cells) {
        const cells = this.tileCells(key, r - dr, c - dc);
        if (cells && cells.includes(target) && (!best || cells.length > best.cells.length)) best = { r: r - dr, c: c - dc, cells };
      }
      return best;
    }

    placeTile(key, r, c) {
      const at = this.tileAnchor(key, r, c);
      if (!at) return null;
      for (const x of at.cells) x.unlocked = true;
      this.rebuild();
      return at;
    }

    // 能接新格子的位置（未解锁且贴着已解锁）
    frontier() {
      return this.all().filter((x) => !x.unlocked && this.touchesUnlocked(x));
    }

    tileFits(key) {
      return this.frontier().length > 0;
    }

    emptyCells() {
      return this.all().filter((x) => x.unlocked && !x.crystal && !x.card);
    }

    levelSum(kind, key) {
      let s = 0;
      for (const x of this.all()) if (x.card && x.card.kind === kind && x.card.key === key) s += x.card.level;
      return s;
    }
  }
  JQ.Board = Board;
})();
