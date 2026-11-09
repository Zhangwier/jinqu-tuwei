// 画面：全部画在 720x1280 的逻辑画布上，水墨汉字风格。
(function () {
  const JQ = (window.JQ = window.JQ || {});
  const { C, UNITS, HEROES, L } = JQ;
  const FONT = '"STKaiti","KaiTi","楷体","Kaiti SC",serif';
  JQ.FONT = FONT;
  const TAU = Math.PI * 2;

  // UI 布局（逻辑坐标）
  const UI = {
    shop: { x: 84, y: 1150, w: 86, h: 88, gap: 8 },
    bun: { x: 6, y: 1150, w: 74, h: 88 },
    recruit: { x: 556, y: 1150, w: 156, h: 88 },
    pause: { x: 10, y: 6, w: 42, h: 42 },
    speed: { x: 668, y: 6, w: 42, h: 42 },
    info: { y: 1258 },
  };
  JQ.UI = UI;
  // 长屏手机：逻辑区上下多出 padY，顶部 HUD 往上、底部招兵栏往下贴屏幕边（输入用同一组矩形，自动跟着走）
  const UI0 = JSON.parse(JSON.stringify(UI));
  const VIEW = { padX: 0, padY: 0, top: 0, bot: 0 };
  JQ.VIEW = VIEW;
  JQ.setViewPad = function (px, py) {
    VIEW.padX = px;
    VIEW.padY = py;
    VIEW.top = Math.min(py, 200);
    VIEW.bot = Math.min(py, 200);
    for (const k of ['pause', 'speed']) UI[k].y = UI0[k].y - VIEW.top;
    for (const k of ['shop', 'bun', 'recruit', 'info']) UI[k].y = UI0[k].y + VIEW.bot;
  };
  JQ.shopRect = (i) => ({ x: UI.shop.x + i * (UI.shop.w + UI.shop.gap), y: UI.shop.y, w: UI.shop.w, h: UI.shop.h });

  // ---------- 界面素材图集（img/ui.webp，绿幕素材表抠出来的，坐标 = 图集像素） ----------
  // 没加载完时各处都回落到代码绘制
  const ATLAS = {
    btn_gold: [0, 0, 225, 73], btn_paper: [227, 0, 222, 73], btn_wood: [451, 0, 222, 73], btn_red: [675, 0, 223, 73],
    btn_stone: [0, 75, 225, 73], tab_on: [227, 75, 217, 100], tab_off: [446, 75, 218, 80], disc: [666, 75, 147, 147],
    panel: [815, 75, 208, 183], scroll: [0, 260, 296, 151], card: [298, 260, 155, 152], slot: [455, 260, 165, 165],
    ic_hero: [622, 260, 173, 168], ic_unit: [797, 260, 173, 168], ic_talent: [0, 430, 172, 168], ic_custom: [174, 430, 173, 168],
    ic_test: [349, 430, 173, 167], ic_gear: [524, 430, 173, 168], ic_help: [699, 430, 172, 168], ic_close: [0, 600, 173, 167],
    coin: [175, 600, 164, 164], bun: [341, 600, 168, 141], lock: [511, 600, 170, 164], chest: [683, 600, 196, 158],
  };
  const uiImg = new Image();
  uiImg.src = 'img/ui.webp?v=20261109r';
  const uiOk = () => uiImg.complete && uiImg.naturalWidth > 0;
  JQ.uiOk = uiOk;
  // 整张贴（图标），按宽高缩放
  JQ.uiDraw = function (g, name, x, y, w, h) {
    if (!uiOk()) return false;
    const a = ATLAS[name];
    g.drawImage(uiImg, a[0], a[1], a[2], a[3], x, y, w, h);
    return true;
  };
  // 横向三段（按钮/页签）：整体按高度等比缩放，只拉伸中间；cap = 左右端头在图集里的像素宽
  JQ.ui3 = function (g, name, x, y, w, h, cap) {
    if (!uiOk()) return false;
    const [sx, sy, sw, sh] = ATLAS[name];
    cap = cap || 40;
    const k = h / sh, dc = Math.min(cap * k, w / 2);
    g.drawImage(uiImg, sx, sy, cap, sh, x, y, dc, h);
    g.drawImage(uiImg, sx + cap, sy, sw - 2 * cap, sh, x + dc, y, w - 2 * dc, h);
    g.drawImage(uiImg, sx + sw - cap, sy, cap, sh, x + w - dc, y, dc, h);
    return true;
  };
  // 九宫格（面板/卡框/槽位）：四角不变形，边和中间拉伸；inset = 图集里的角宽，d = 画出来的角宽
  JQ.ui9 = function (g, name, x, y, w, h, inset, d) {
    if (!uiOk()) return false;
    const [sx, sy, sw, sh] = ATLAS[name];
    const i = inset || 36;
    d = Math.min(d || i, w / 2, h / 2);
    const xs = [sx, sx + i, sx + sw - i], ws = [i, sw - 2 * i, i];
    const ys = [sy, sy + i, sy + sh - i], hs = [i, sh - 2 * i, i];
    const dx = [x, x + d, x + w - d], dw = [d, w - 2 * d, d];
    const dy = [y, y + d, y + h - d], dh = [d, h - 2 * d, d];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.drawImage(uiImg, xs[c], ys[r], ws[c], hs[r], dx[c], dy[r], dw[c], dh[r]);
    return true;
  };

  const INK = ['#141414', '#7d1212'];
  const TEAM = ['#3d8bff', '#ff4a3a'];

  // ---------- 小工具 ----------
  function rr(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }
  JQ.rr = rr;
  const ease = (k) => 1 - Math.pow(1 - k, 3);
  JQ.ease = ease;
  function alphaHex(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  JQ.alphaHex = alphaHex;
  function text(g, s, x, y, size, color, opts) {
    opts = opts || {};
    g.font = `${opts.bold === false ? '' : 'bold '}${size}px ${opts.font || FONT}`;
    g.textAlign = opts.align || 'center';
    g.textBaseline = opts.base || 'middle';
    if (opts.stroke) {
      g.lineWidth = opts.strokeW || size / 6;
      g.strokeStyle = opts.stroke;
      g.lineJoin = 'round';
      g.strokeText(s, x, y);
    }
    g.fillStyle = color;
    g.fillText(s, x, y);
  }
  JQ.text = text;

  // ---------- 小图缓存 ----------
  // 卡面/汉字/英雄光晕每帧重画会不断创建渐变、描边和字形，手机上填充率吃不消。
  // 统一预渲染到离屏画布（2 倍超采样），运行时只 drawImage。
  const spriteCache = new Map();
  let spritePx = 2;
  // 主循环按实际画布像素密度设置，贴图分辨率跟屏幕匹配，避免 2 倍贴图无谓降采样。
  JQ.setRenderScale = function (px) {
    const q = Math.max(1, Math.min(2, (px || 1) * 1.05));
    if (Math.abs(q - spritePx) > 0.06) {
      spritePx = q;
      spriteCache.clear();
    }
  };
  function sprite(key, w, h, paint) {
    let c = spriteCache.get(key);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * spritePx));
    c.height = Math.max(1, Math.ceil(h * spritePx));
    const gg = c.getContext('2d');
    gg.scale(spritePx, spritePx);
    paint(gg);
    spriteCache.set(key, c);
    if (spriteCache.size > 180) spriteCache.delete(spriteCache.keys().next().value);
    return c;
  }
  // 单行文字贴图；返回逻辑尺寸，调用方按中心点绘制。
  function glyph(str, size, color, stroke, strokeW) {
    const sw = strokeW || 0;
    const w = Math.ceil(size * Math.max(1, str.length) * 1.05 + sw * 2);
    const h = Math.ceil(size * 1.24 + sw * 2);
    const key = `g|${str}|${size}|${color}|${stroke || ''}|${sw}`;
    const c = sprite(key, w, h, (gg) => {
      gg.font = `bold ${size}px ${FONT}`;
      gg.textAlign = 'center';
      gg.textBaseline = 'middle';
      if (stroke) {
        gg.lineWidth = sw;
        gg.strokeStyle = stroke;
        gg.lineJoin = 'round';
        gg.strokeText(str, w / 2, h / 2);
      }
      gg.fillStyle = color;
      gg.fillText(str, w / 2, h / 2);
    });
    return { c, w, h };
  }
  function drawGlyph(g, str, x, y, size, color, stroke, strokeW, scale) {
    const s = glyph(str, size, color, stroke, strokeW);
    const k = scale || 1;
    g.drawImage(s.c, x - (s.w * k) / 2, y - (s.h * k) / 2, s.w * k, s.h * k);
  }

  // ---------- 背景 ----------
  let bg = null;
  const BG_EXT = 260; // 背景上下各多画一截，长屏手机不留黑边
  function makeBackground() {
    const c = document.createElement('canvas');
    c.width = C.W;
    c.height = C.H + 2 * BG_EXT;
    const g = c.getContext('2d');
    g.translate(0, BG_EXT);
    const base = g.createLinearGradient(0, -BG_EXT, 0, C.H + BG_EXT);
    base.addColorStop(0, '#cfc3a2');
    base.addColorStop(0.5, '#dcd2b4');
    base.addColorStop(1, '#cbbf9d');
    g.fillStyle = base;
    g.fillRect(0, -BG_EXT, C.W, C.H + 2 * BG_EXT);
    const rnd = JQ.rng(7);
    for (let i = 0; i < 380; i++) {
      const x = rnd() * C.W, y = rnd() * (C.H + 2 * BG_EXT) - BG_EXT, r = 20 + rnd() * 90;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.04 + rnd() * 0.05;
      grd.addColorStop(0, rnd() < 0.5 ? `rgba(110,90,60,${a})` : `rgba(255,250,235,${a})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    for (let i = 0; i < 5600; i++) {
      g.fillStyle = rnd() < 0.5 ? 'rgba(80,60,30,0.07)' : 'rgba(255,255,255,0.08)';
      g.fillRect(rnd() * C.W, rnd() * (C.H + 2 * BG_EXT) - BG_EXT, 1.5, 1.5);
    }
    g.strokeStyle = 'rgba(90,75,55,0.2)';
    g.lineWidth = 1.2;
    for (let i = 0; i < 30; i++) {
      let x = rnd() * C.W, y = 320 + rnd() * 520;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rnd() - 0.5) * 60;
        y += (rnd() - 0.5) * 40;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    const corner = (cx, cy) => {
      for (let i = 0; i < 22; i++) {
        const x = cx + (rnd() - 0.5) * 130, y = cy + (rnd() - 0.5) * 100;
        g.fillStyle = rnd() < 0.6 ? `rgba(70,${110 + rnd() * 50},60,0.75)` : `rgba(120,115,105,0.85)`;
        g.beginPath();
        g.ellipse(x, y, 8 + rnd() * 16, 5 + rnd() * 10, rnd() * 3, 0, TAU);
        g.fill();
      }
    };
    corner(30, 330); corner(700, 320); corner(30, 830); corner(700, 840);
    g.setLineDash([14, 12]);
    g.strokeStyle = 'rgba(90,70,40,0.18)';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(40, 585);
    g.lineTo(C.W - 40, 585);
    g.stroke();
    g.setLineDash([]);
    g.save();
    g.globalAlpha = 0.06;
    text(g, '禁', C.W / 2, 585, 340, '#3a2a10');
    g.restore();
    const v = g.createRadialGradient(C.W / 2, C.H / 2, 300, C.W / 2, C.H / 2, 950);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(40,25,5,0.4)');
    g.fillStyle = v;
    g.fillRect(0, -BG_EXT, C.W, C.H + 2 * BG_EXT);
    return c;
  }

  // ---------- 卡面 ----------
  // 卡底色只区分种类，并且避开等级色（灰/绿/蓝/紫/金）：兵卡素纸、字卡粉红、建筑木色、道具朱砂、格子石灰
  function cardColors(card) {
    switch (card.kind) {
      case 'char': return ['#fbe3e3', '#efb4b4', '#b05454'];
      case 'building': return ['#f3e6d2', '#d6bf9c', '#8a6a3a'];
      case 'item': return ['#fbeae4', '#e8b8a8', '#a0402a'];
      case 'tile': return ['#ecebe6', '#c9c4b8', '#6f6875'];
    }
    return ['#fbfaf4', '#e9e4d6', '#8a7a5a'];
  }

  function levelBadge(g, lv, x, y, s) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath();
    g.arc(x + 1, y + 1.5, s * 1.1, 0, TAU);
    g.fill();
    g.fillStyle = JQ.LEVEL_COLORS[Math.min(lv, C.MAX_LEVEL)] || '#e0302a';
    g.beginPath();
    g.arc(x, y, s * 1.1, 0, TAU);
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = '#fff';
    g.stroke();
    text(g, lv > 99 ? '99+' : String(lv), x, y + 1, s * (lv > 9 ? 1.1 : 1.3), '#fff', { font: 'sans-serif' });
    g.restore();
  }

  // 画一张卡：x,y,w,h 为卡框。卡面预渲染，运行时只贴图。
  function paintCard(g, card, x, y, w, h, opts, lv) {
    const [top, bottom, edge] = cardColors(card);
    if (!opts.flat) {
      g.fillStyle = 'rgba(0,0,0,0.25)';
      rr(g, x + 3, y + 5, w - 4, h - 4, 7);
      g.fill();
    }
    rr(g, x + 2, y + 2, w - 4, h - 4, 7);
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, top);
    grd.addColorStop(0.6, top);
    grd.addColorStop(1, bottom);
    g.fillStyle = grd;
    g.fill();
    drawLevelFrame(g, lv, x, y, w, h, edge, opts.flat, true);
    g.globalAlpha = 0.35;
    g.fillStyle = '#fff';
    rr(g, x + 5, y + 5, w - 10, h * 0.28, 5);
    g.fill();
    g.globalAlpha = 1;
    const cx = x + w / 2, cy = y + h / 2;
    if (card.kind === 'tile') drawTileIcon(g, card.key, cx, cy - h * 0.08, h * 0.17);
    else if (card.kind === 'item') drawItemIcon(g, card.key, cx, cy - h * 0.06, h * 0.3);
    else {
      const color = card.kind === 'char' ? '#8a1818' : card.kind === 'building' ? '#5a3a10' : '#141414';
      text(g, card.key, cx, cy + (opts.label ? -h * 0.07 : 2), h * (opts.label ? 0.5 : 0.6), color);
    }
    if (card.kind !== 'tile') levelBadge(g, card.level, x + w - h * 0.15, y + h * 0.15, h * 0.12);
    if (opts.label) text(g, labelOf(card, opts.pack), cx, y + h - 11, 12, edge, { bold: false, font: 'sans-serif' });
  }

  function drawCard(g, card, x, y, w, h, opts) {
    opts = opts || {};
    const lv = card.kind === 'tile' ? 0 : card.level;
    // flat 是场上卡：数量多且没有投影，留 2px 即可；3 级起外发光，留 14px。商店卡留 10px。
    const pad = opts.flat ? (lv >= 3 ? 14 : 2) : 10;
    const key = `c|${card.kind}|${card.key}|${lv}|${w.toFixed(1)}|${h.toFixed(1)}|${opts.label ? 1 : 0}|${opts.flat ? 1 : 0}|${opts.pack || ''}`;
    const img = sprite(key, w + pad * 2, h + pad * 2, (gg) => {
      gg.translate(pad, pad);
      paintCard(gg, card, 0, 0, w, h, opts, lv);
    });
    g.drawImage(img, x - pad, y - pad, w + pad * 2, h + pad * 2);
    if (lv >= 5) {
      // 金卡流光：只有满级卡才有，单独叠一层，不参与缓存
      const k = ((performance.now() / 1400) % 1) * 2 - 0.5;
      g.save();
      rr(g, x + 2, y + 2, w - 4, h - 4, 7);
      g.clip();
      const sx = x + w * k;
      const sh = g.createLinearGradient(sx - 20, y, sx + 20, y + h);
      sh.addColorStop(0, 'rgba(255,255,255,0)');
      sh.addColorStop(0.5, 'rgba(255,255,230,0.55)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(x, y, w, h);
      g.restore();
    }
  }
  JQ.drawCard = drawCard;

  // 等级框：1 级普通边；2 绿 3 蓝 4 紫 5 金，越高边越粗、底色越浓、外发光越强，5 级带流光
  function drawLevelFrame(g, lv, x, y, w, h, edge, flat, noShine) {
    lv = Math.max(0, Math.min(C.MAX_LEVEL, lv)); // 小兵等级可以超过 5，边框只取前 5 档颜色
    if (lv < 2) {
      g.lineWidth = 2;
      g.strokeStyle = edge;
      rr(g, x + 2, y + 2, w - 4, h - 4, 7);
      g.stroke();
      return;
    }
    const col = JQ.LEVEL_COLORS[lv];
    g.save();
    rr(g, x + 2, y + 2, w - 4, h - 4, 7);
    const tint = g.createLinearGradient(0, y, 0, y + h);
    tint.addColorStop(0, alphaHex(col, 0.06 + lv * 0.03));
    tint.addColorStop(1, alphaHex(col, 0.18 + lv * 0.06));
    g.fillStyle = tint;
    g.fill();
    // 场上卡数量多，flat 模式不做外发光，省下大量 shadowBlur
    if (lv >= 3 && !flat) {
      g.shadowColor = col;
      g.shadowBlur = 4 + lv * 2.5;
    }
    g.lineWidth = 1.5 + lv * 0.8;
    g.strokeStyle = col;
    g.stroke();
    g.shadowBlur = 0;
    // 内描一圈白，边框更立体
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    rr(g, x + 3 + lv * 0.4, y + 3 + lv * 0.4, w - 6 - lv * 0.8, h - 6 - lv * 0.8, 6);
    g.stroke();
    if (lv >= 5 && !noShine) {
      const k = ((performance.now() / 1400) % 1) * 2 - 0.5;
      g.beginPath();
      rr(g, x + 2, y + 2, w - 4, h - 4, 7);
      g.clip();
      const sx = x + w * k;
      const sh = g.createLinearGradient(sx - 20, y, sx + 20, y + h);
      sh.addColorStop(0, 'rgba(255,255,255,0)');
      sh.addColorStop(0.5, 'rgba(255,255,230,0.55)');
      sh.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sh;
      g.fillRect(x, y, w, h);
    }
    g.restore();
  }
  JQ.drawLevelFrame = drawLevelFrame;

  function labelOf(card, pack) {
    if (card.kind === 'unit') return '兵·' + UNITS[card.key].desc.slice(0, 4);
    if (card.kind === 'char') {
      // 只显示本局卡包里能合成的英雄，避免跨卡包同字串味
      const names = (JQ.CHAR_HEROES[card.key] || []).filter((n) => !pack || JQ.heroInPack(n, pack));
      return names.join('/');
    }
    if (card.kind === 'building') return '建筑';
    if (card.kind === 'item') return '道具·点用/拖存';
    if (card.kind === 'tile') return '格子·' + JQ.TILES[card.key].name;
    return '';
  }

  function drawTileIcon(g, key, cx, cy, s) {
    const cells = JQ.TILES[key].cells;
    const rows = Math.max(...cells.map((c) => c[0])) + 1, cols = Math.max(...cells.map((c) => c[1])) + 1;
    g.save();
    for (const [r, c] of cells) {
      const x = cx + (c - cols / 2) * s * 1.08, y = cy + (r - rows / 2) * s * 1.08;
      g.fillStyle = '#b7b1a8';
      g.strokeStyle = '#4f4955';
      g.lineWidth = 2.5;
      g.fillRect(x, y, s, s);
      g.strokeRect(x, y, s, s);
    }
    g.restore();
  }

  function drawItemIcon(g, key, cx, cy, s) {
    g.save();
    if (key === '药') {
      g.fillStyle = '#c33';
      g.beginPath();
      g.ellipse(cx, cy + s * 0.15, s * 0.6, s * 0.7, 0, 0, TAU);
      g.fill();
      g.fillStyle = '#7a4a20';
      g.fillRect(cx - s * 0.18, cy - s * 0.85, s * 0.36, s * 0.35);
      text(g, '药', cx, cy + s * 0.18, s * 0.8, '#fff');
    } else if (key === '金') {
      for (let i = 2; i >= 0; i--) {
        g.fillStyle = '#e8b830';
        g.strokeStyle = '#8a6010';
        g.lineWidth = 2;
        g.beginPath();
        g.ellipse(cx, cy + s * 0.4 - i * s * 0.32, s * 0.7, s * 0.28, 0, 0, TAU);
        g.fill();
        g.stroke();
      }
      text(g, '金', cx, cy - s * 0.25, s * 0.5, '#7a4a00');
    } else if (key === '令') {
      g.fillStyle = '#b8862b';
      rr(g, cx - s * 0.45, cy - s * 0.8, s * 0.9, s * 1.6, 6);
      g.fill();
      g.strokeStyle = '#6a4a10';
      g.lineWidth = 2;
      g.stroke();
      text(g, '令', cx, cy, s * 0.9, '#7a1010');
    }
    g.restore();
  }

  function drawBun(g, cx, cy, s) {
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.18)';
    g.beginPath();
    g.ellipse(cx, cy + s * 0.55, s * 0.9, s * 0.22, 0, 0, TAU);
    g.fill();
    const grd = g.createRadialGradient(cx - s * 0.3, cy - s * 0.3, s * 0.1, cx, cy, s);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#ddd6c6');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(cx, cy, s, s * 0.72, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#b9ae98';
    g.lineWidth = Math.max(1, s / 14);
    for (let i = -2; i <= 2; i++) {
      g.beginPath();
      g.moveTo(cx, cy - s * 0.62);
      g.quadraticCurveTo(cx + i * s * 0.25, cy - s * 0.2, cx + i * s * 0.4, cy + s * 0.1);
      g.stroke();
    }
    g.restore();
  }
  JQ.drawBun = drawBun;

  function drawCrystal(g, cx, cy, side, t) {
    g.save();
    g.fillStyle = '#8d857a';
    rr(g, cx - 18, cy + 8, 36, 12, 3);
    g.fill();
    g.fillStyle = '#6d655a';
    g.fillRect(cx - 22, cy + 18, 44, 6);
    const col = side === 0 ? ['#d6f0ff', '#3b8be8'] : ['#ffd8d0', '#d8382a'];
    const bob = Math.sin(t * 2.5) * 2.5;
    const glow = g.createRadialGradient(cx, cy - 6 + bob, 2, cx, cy - 6 + bob, 26);
    glow.addColorStop(0, alphaHex(col[1], 0.5));
    glow.addColorStop(1, alphaHex(col[1], 0));
    g.fillStyle = glow;
    g.fillRect(cx - 30, cy - 36, 60, 60);
    const grd = g.createLinearGradient(cx, cy - 26, cx, cy + 8);
    grd.addColorStop(0, col[0]);
    grd.addColorStop(1, col[1]);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(cx, cy - 26 + bob);
    g.lineTo(cx + 9, cy - 8 + bob);
    g.lineTo(cx, cy + 7 + bob);
    g.lineTo(cx - 9, cy - 8 + bob);
    g.closePath();
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.moveTo(cx, cy - 22 + bob);
    g.lineTo(cx - 5, cy - 8 + bob);
    g.lineTo(cx, cy + 2 + bob);
    g.closePath();
    g.fill();
    g.restore();
  }

  // ---------- 棋盘 ----------
  // 棋盘底板（石框+格子）整层缓存：解锁/前哨变化时才重画，平时一次贴图。
  function drawBoardBase(g, sid, shown) {
    if (!shown.length) return;
    const pad = 6;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, sig = sid + '|';
    for (const x of shown) {
      const r = JQ.cellRect(sid, x.r, x.c);
      if (r.x - pad < x0) x0 = r.x - pad;
      if (r.y - pad < y0) y0 = r.y - pad;
      if (r.x + r.w + pad > x1) x1 = r.x + r.w + pad;
      if (r.y + r.h + pad + 4 > y1) y1 = r.y + r.h + pad + 4;
      sig += x.r + ',' + x.c + ',' + (x.forward ? 1 : 0) + ';';
    }
    const w = x1 - x0, h = y1 - y0;
    const c = sprite('board|' + sig, w, h, (gg) => {
      gg.translate(-x0, -y0);
      for (const x of shown) {
        const r = JQ.cellRect(sid, x.r, x.c);
        gg.fillStyle = '#4c4652';
        gg.fillRect(r.x - pad, r.y - pad + 4, r.w + pad * 2, r.h + pad * 2);
        gg.fillStyle = x.forward ? '#8a6a5a' : '#7a7380';
        gg.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
        gg.fillStyle = x.forward ? '#b3a49a' : '#b8b2a8';
        gg.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
      }
    });
    g.drawImage(c, x0, y0, w, h);
  }

  function drawBoard(game, sid, view) {
    const g = view.g;
    const s = game.sides[sid];
    const b = s.board;
    const t = game.time;
    const shown = b.all().filter((x) => x.unlocked);
    drawBoardBase(g, sid, shown);

    const now = performance.now();
    const selCell = sid === 0 && view.selectedCell && view.selectedCell.card ? view.selectedCell : null;
    const selShop = sid === 0 && view.selected >= 0 ? s.shop[view.selected] : null;
    const dragging = sid === 0 && !!view.heldCard;
    const held = sid === 0 ? view.heldCard || selShop || (selCell && selCell.card) : null;
    const fromCell = sid === 0 ? (view.dragFrom && view.dragFrom.cell) || (!dragging && !selShop && selCell) || null : null;
    const target = dragging ? view.target : null;
    // 拖格子块：边上能拼的位置显示“+”，指着的位置预览整块
    if (held && held.kind === 'tile') {
      for (const x of b.frontier()) {
        const r = JQ.cellRect(sid, x.r, x.c);
        g.fillStyle = 'rgba(230,226,215,0.55)';
        rr(g, r.x + 5, r.y + 5, r.w - 10, r.h - 10, 6);
        g.fill();
        g.setLineDash([6, 5]);
        g.strokeStyle = '#6f6875';
        g.lineWidth = 2;
        g.stroke();
        g.setLineDash([]);
        text(g, '+', r.cx, r.cy, 30, '#6f6875', { font: 'sans-serif' });
      }
      const tc = target && target.cell;
      const at = tc && b.tileAnchor(held.key, tc.r, tc.c);
      if (at)
        for (const [dr, dc] of JQ.TILES[held.key].cells) {
          const cell = b.cell(at.r + dr, at.c + dc);
          const r = JQ.cellRect(sid, at.r + dr, at.c + dc);
          if (cell && at.cells.includes(cell)) {
            g.fillStyle = 'rgba(80,200,90,0.6)';
            g.fillRect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
          } else {
            // 这一格放不下（已有格子或出界），会被跳过
            g.strokeStyle = 'rgba(220,60,40,0.7)';
            g.lineWidth = 2;
            g.setLineDash([5, 4]);
            g.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
            g.setLineDash([]);
          }
        }
    }

    // 英雄连线底：两格合成一条绸带
    for (const link of b.links) {
      const [A, B] = link.cells.map((x) => JQ.cellRect(sid, x.r, x.c));
      const aura = HEROES[link.hero].aura;
      const ult = link.level >= game.R.ultLevel;
      g.save();
      rr(g, A.x + 1, A.y + 1, B.x + B.w - A.x - 2, A.h - 2, 8);
      const grd = g.createLinearGradient(A.x, 0, B.x + B.w, 0);
      grd.addColorStop(0, '#f7cfcf');
      grd.addColorStop(0.5, alphaHex(aura, 0.55));
      grd.addColorStop(1, '#f7cfcf');
      g.fillStyle = grd;
      g.fill();
      if (ult) {
        g.shadowColor = aura;
        g.shadowBlur = 10 + Math.sin(t * 5) * 5;
      }
      const lc = link.level >= 2 ? JQ.LEVEL_COLORS[link.level] : aura;
      if (!ult && link.level >= 3) {
        g.shadowColor = lc;
        g.shadowBlur = 4 + link.level * 2.5;
      }
      g.lineWidth = 1.5 + link.level * 0.9;
      g.strokeStyle = lc;
      g.stroke();
      g.restore();
    }

    const popOf = (x) => {
      if (sid !== 0) return null;
      for (const a of view.anims) if (a.kind === 'pop' && a.r === x.r && a.c === x.c && now - a.t0 < 320) return { k: (now - a.t0) / 320, how: a.how };
      return null;
    };
    const flying = (x) => sid === 0 && view.anims.some((a) => a.kind === 'back' && a.cell === x && now - a.t0 < 200);
    for (const x of shown) {
      const r = JQ.cellRect(sid, x.r, x.c);
      if (x.crystal) {
        drawCrystal(g, r.cx, r.cy, sid, t);
        continue;
      }
      const pop = popOf(x);
      if (pop) {
        // 落位光圈
        const col = pop.how === 'merge' ? '#ffc020' : pop.how === 'swap' ? '#6aa0ff' : '#ffffff';
        g.save();
        g.globalAlpha = 1 - pop.k;
        g.strokeStyle = col;
        g.lineWidth = 4;
        const e = 4 + pop.k * 14;
        rr(g, r.x - e, r.y - e, r.w + e * 2, r.h + e * 2, 8);
        g.stroke();
        g.restore();
      }
      if (!x.card || flying(x)) continue;
      const ghost = dragging && fromCell === x;
      // 只有拖动/落位动画才需要改透明度或缩放，普通卡直接画，省掉 save/restore
      if (ghost || pop) {
        g.save();
        if (ghost) g.globalAlpha = 0.3;
        if (pop) {
          // 先放大再回弹
          const sc = 1 + 0.28 * Math.sin(Math.min(1, pop.k * 1.4) * Math.PI) * (1 - pop.k * 0.5);
          g.translate(r.cx, r.cy);
          g.scale(sc, sc);
          g.translate(-r.cx, -r.cy);
        }
      }
      if (x.links.length) {
        drawGlyph(g, x.card.key, r.cx, r.cy + 1, 36, '#7a1010');
      } else drawCard(g, x.card, r.x, r.y, r.w, r.h, { flat: true, pack: s.pack });
      if (ghost || pop) g.restore();

      // 冷却：时钟式扫过
      if (x.card.kind === 'unit' && x.cd > 0) {
        const f = Math.min(1, x.cd / (UNITS[x.card.key].cd * s.cdMult()));
        g.save();
        g.beginPath();
        g.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4);
        g.clip();
        g.fillStyle = 'rgba(20,20,30,0.42)';
        g.beginPath();
        g.moveTo(r.cx, r.cy);
        g.arc(r.cx, r.cy, r.w, -Math.PI / 2, -Math.PI / 2 + TAU * f);
        g.closePath();
        g.fill();
        g.restore();
      }
    }

    // 英雄名牌与状态
    for (const link of b.links) {
      const [A, B] = link.cells.map((x) => JQ.cellRect(sid, x.r, x.c));
      const mx = (A.cx + B.cx) / 2;
      const alive = s.heroAlive[link.hero];
      const cd = s.heroCd[link.hero] || 0;
      g.save();
      const label = alive ? link.hero + '·出战' : cd > 0 ? `${link.hero} ${Math.ceil(cd)}s` : link.hero;
      g.font = `bold 12px ${FONT}`;
      const tw = g.measureText(label).width + 12;
      g.fillStyle = alive ? 'rgba(170,30,30,0.92)' : 'rgba(40,30,20,0.85)';
      rr(g, mx - tw / 2, A.y + A.h - 15, tw, 15, 7);
      g.fill();
      text(g, label, mx, A.y + A.h - 7, 12, alive ? '#fff' : cd > 0 ? '#ccc' : '#ffe9a0');
      levelBadge(g, link.level, B.x + B.w - 9, A.y + 9, 8);
      if (link.level >= game.R.ultLevel) text(g, '大招', mx, A.y + 8, 11, '#ffd23f', { stroke: '#7a1010', strokeW: 3 });
      g.restore();
    }

    // 选中的场上卡：金色呼吸边框
    if (selCell && !dragging) {
      const r = JQ.cellRect(0, selCell.r, selCell.c);
      g.save();
      g.strokeStyle = '#ffc020';
      g.lineWidth = 3 + Math.sin(t * 8) * 1.5;
      g.shadowColor = '#ffc020';
      g.shadowBlur = 10;
      g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
      g.restore();
    }
    // 拿着卡时：所有可放位置淡显；吸附到的落点实心预览
    if (sid === 0 && held && JQ.boardable(held)) {
      const COL = { merge: '#ffb000', swap: '#6aa0ff', move: '#3fbf3f', place: '#3fbf3f', replace: '#c070ff' };
      for (const x of shown) {
        const how = fromCell ? b.canMove(fromCell.r, fromCell.c, x.r, x.c) : b.canPlace(held, x.r, x.c);
        if (!how || x === fromCell) continue;
        const r = JQ.cellRect(sid, x.r, x.c);
        g.strokeStyle = COL[how];
        g.globalAlpha = 0.75;
        g.lineWidth = 2;
        g.setLineDash([6, 5]);
        g.lineDashOffset = -t * 30;
        g.strokeRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
      if (target && target.cell) {
        const x = target.cell, r = JQ.cellRect(0, x.r, x.c);
        const col = COL[target.how];
        g.save();
        g.fillStyle = alphaHex(col, 0.3);
        g.fillRect(r.x, r.y, r.w, r.h);
        g.strokeStyle = col;
        g.lineWidth = 4;
        g.shadowColor = col;
        g.shadowBlur = 12;
        g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
        g.shadowBlur = 0;
        // 幽灵卡：放下后的样子
        if (target.how !== 'merge') {
          g.globalAlpha = 0.55;
          drawCard(g, held, r.x, r.y, r.w, r.h, { flat: true, pack: s.pack });
        }
        g.restore();
        if (target.how === 'swap') text(g, '⇄', r.cx, r.y - 10, 20, '#6aa0ff', { font: 'sans-serif', stroke: '#000', strokeW: 4 });
        if (target.how === 'replace') text(g, `替换·${x.card.key}回手`, r.cx, r.y - 10, 14, '#e0b0ff', { stroke: '#000', strokeW: 4 });
      }
    }
    // 前哨血条
    for (const x of shown) {
      const o = x.outpost;
      if (!o || o.hp >= o.maxHp) continue;
      const r = JQ.cellRect(sid, x.r, x.c);
      const f = Math.max(0, o.hp / o.maxHp);
      g.fillStyle = '#222';
      g.fillRect(r.x + 4, r.y + (sid === 0 ? 2 : r.h - 8), r.w - 8, 6);
      g.fillStyle = f > 0.5 ? '#e0b030' : '#e04030';
      g.fillRect(r.x + 5, r.y + (sid === 0 ? 3 : r.h - 7), (r.w - 10) * f, 4);
      if (o.flash > 0) {
        g.fillStyle = `rgba(255,80,40,${o.flash * 3})`;
        g.fillRect(r.x, r.y, r.w, r.h);
      }
    }
    drawWalker(g, s, t);
  }

  function drawWalker(g, s, t) {
    const w = s.walker;
    const sid = s.id;
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(w.x, w.y + 20, 14, 5, 0, 0, TAU);
    g.fill();
    const col = sid === 0 ? ['#2a8cff', '#bff0ff'] : ['#ff4a2a', '#ffd080'];
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.38;
      const len = 18 + Math.sin(t * 9 + i * 1.7) * 4;
      g.fillStyle = i % 2 ? col[0] : col[1];
      g.beginPath();
      g.moveTo(w.x + Math.cos(a - 0.3) * 10, w.y - 6 + Math.sin(a - 0.3) * 10);
      g.lineTo(w.x + Math.cos(a) * len, w.y - 6 + Math.sin(a) * len);
      g.lineTo(w.x + Math.cos(a + 0.3) * 10, w.y - 6 + Math.sin(a + 0.3) * 10);
      g.fill();
    }
    g.fillStyle = '#1b1b24';
    g.beginPath();
    g.arc(w.x, w.y, 14, 0, TAU);
    g.fill();
    g.strokeStyle = col[0];
    g.lineWidth = 2.5;
    g.stroke();
    text(g, sid === 0 ? '帅' : '将', w.x, w.y + 1, 16, '#fff');
    g.restore();
  }

  function drawHpBar(g, s, y, view) {
    const x = C.W / 2 - 160, w = 320, h = 20;
    const f = Math.max(0, s.hp / s.maxHp);
    const lagKey = 'lag' + s.id;
    view[lagKey] = view[lagKey] == null || view[lagKey] < f ? f : Math.max(f, view[lagKey] - 0.004);
    g.save();
    g.fillStyle = '#2a1a1a';
    rr(g, x - 3, y - 3, w + 6, h + 6, 8);
    g.fill();
    g.fillStyle = '#4a3030';
    rr(g, x, y, w, h, 6);
    g.fill();
    g.fillStyle = '#f5e6c0';
    rr(g, x, y, w * view[lagKey], h, 6);
    g.fill();
    const grd = g.createLinearGradient(0, y, 0, y + h);
    grd.addColorStop(0, '#ff7a60');
    grd.addColorStop(1, s.id === 0 ? '#c0302a' : '#a8201a');
    g.fillStyle = grd;
    if (f > 0) {
      rr(g, x, y, Math.max(12, w * f), h, 6);
      g.fill();
    }
    text(g, `${Math.ceil(s.hp)} / ${s.maxHp}`, C.W / 2, y + h / 2 + 1, 15, '#fff', { font: 'sans-serif', stroke: 'rgba(0,0,0,0.6)', strokeW: 3 });
    g.fillStyle = '#e0302a';
    g.beginPath();
    const hx = x - 2, hy = y + h / 2;
    g.moveTo(hx, hy + 10);
    g.bezierCurveTo(hx - 16, hy - 2, hx - 8, hy - 14, hx, hy - 5);
    g.bezierCurveTo(hx + 8, hy - 14, hx + 16, hy - 2, hx, hy + 10);
    g.fill();
    g.restore();
  }

  // 英雄脚下光晕：按颜色缓存，避免每个英雄每帧重建径向渐变
  function drawAura(g, color, x, y, r) {
    const c = sprite('aura|' + color + '|' + r, r * 2, r * 2, (gg) => {
      const grd = gg.createRadialGradient(r, r, 4, r, r, r);
      grd.addColorStop(0, alphaHex(color, 0.6));
      grd.addColorStop(1, alphaHex(color, 0));
      gg.fillStyle = grd;
      gg.fillRect(0, 0, r * 2, r * 2);
    });
    g.drawImage(c, x - r, y - r, r * 2, r * 2);
  }

  // ---------- 单位 ----------
  function drawUnit(g, u, game) {
    if (u.isOutpost) return; // 哨所画在棋盘格上
    const t = game.time;
    const sid = u.side;
    let ox = 0, oy = 0;
    if (u.anim > 0 && u.target) {
      const k = Math.sin((u.anim / 0.2) * Math.PI) * 6;
      const dx = u.target.x - u.x, dy = u.target.y - u.y, d = Math.hypot(dx, dy) || 1;
      ox = (dx / d) * k;
      oy = (dy / d) * k;
    }
    const age = t - u.born;
    // 兜底：时间回拨/异常 born 时也不能给 ellipse 传负半径
    const pop = Math.max(0.05, age < 0.25 ? 0.2 + 0.8 * ease(age / 0.25) : 1);
    const bob = Math.sin(t * 10 + u.id) * 1.5;
    const x = u.x + ox, y = u.y + oy + bob - (u.lift || 0);
    const baseA = u.clone ? 0.6 : u.stealthUntil > t ? 0.35 : 1;
    if (baseA !== 1) {
      g.save();
      g.globalAlpha = baseA;
    }
    // 阵营底盘
    g.fillStyle = alphaHex(TEAM[sid], 0.3);
    g.beginPath();
    g.ellipse(u.x, u.y + u.r * 0.8, u.r * pop, u.r * 0.36 * pop, 0, 0, TAU);
    g.fill();
    if (u.level >= 2) {
      g.strokeStyle = JQ.LEVEL_COLORS[Math.min(u.level, C.MAX_LEVEL)];
      g.lineWidth = 1 + u.level * 0.5;
      g.stroke();
    }
    if (u.isHero) {
      const aura = HEROES[u.key].aura;
      drawAura(g, aura, x, y, 50);
      g.strokeStyle = alphaHex(aura, 0.85);
      g.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(x, y + 4, 34, t * 2 + (i * TAU) / 3, t * 2 + (i * TAU) / 3 + 1.1);
        g.stroke();
      }
      if (u.shield > 0) {
        g.strokeStyle = 'rgba(255,230,120,0.85)';
        g.lineWidth = 3;
        g.beginPath();
        g.arc(x, y, 30, 0, TAU);
        g.stroke();
      }
      if (u.invulnUntil > t) {
        g.fillStyle = 'rgba(255,255,255,0.25)';
        g.beginPath();
        g.arc(x, y, 30, 0, TAU);
        g.fill();
      }
      // 贴图自带缩放，不用 save/translate/scale/restore
      drawGlyph(g, u.key, x, y, 38, INK[sid], sid === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(255,225,215,0.85)', 6, pop);
      if (u.flash > 0) {
        g.globalAlpha = baseA * (u.flash / 0.12);
        drawGlyph(g, u.key, x, y, 38, '#fff', null, 0, pop);
        g.globalAlpha = baseA;
      }
      const w = 62, hp = Math.max(0, u.hp / u.maxHp);
      g.fillStyle = '#1a1a1a';
      rr(g, x - w / 2 - 1, y - 39, w + 2, 9, 3);
      g.fill();
      g.fillStyle = sid === 0 ? '#3fdf5f' : '#f04030';
      if (hp > 0) {
        rr(g, x - w / 2, y - 38, Math.max(4, w * hp), 7, 3);
        g.fill();
      }
      if (u.shield > 0) {
        g.fillStyle = '#ffe680';
        g.fillRect(x - w / 2, y - 38, Math.min(w, (w * u.shield) / u.maxHp), 2.5);
      }
      drawGlyph(g, '★'.repeat(Math.min(u.level, C.MAX_LEVEL)), x, y - 47, 11, '#ffd34d', '#5a3a00', 2.5);
      if (u.level >= game.R.ultLevel && u.ultT <= 0.5) drawGlyph(g, '大', x + w / 2 + 9, y - 34, 14, '#fff', '#d02010', 5);
    } else {
      const buffed = u.atkBuffUntil > t;
      drawGlyph(g, u.key, x, y, 30, INK[sid], buffed ? 'rgba(255,200,80,0.95)' : sid === 0 ? 'rgba(220,235,255,0.75)' : 'rgba(255,215,205,0.75)', 4, pop);
      if (u.flash > 0) {
        g.globalAlpha = baseA * (u.flash / 0.12) * 0.9;
        drawGlyph(g, u.key, x, y, 30, '#fff', null, 0, pop);
        g.globalAlpha = baseA;
      }
      if (u.hp < u.maxHp) {
        const w = 24, hp = Math.max(0, u.hp / u.maxHp);
        g.fillStyle = '#222';
        g.fillRect(x - w / 2, y - 22, w, 4);
        g.fillStyle = sid === 0 ? '#3fdf5f' : '#f04030';
        g.fillRect(x - w / 2, y - 22, w * hp, 4);
      }
      if (u.level > 1) drawGlyph(g, '★'.repeat(Math.min(4, u.level - 1)), x, y + 19, 9, JQ.LEVEL_COLORS[Math.min(u.level, C.MAX_LEVEL)]);
    }
    if (u.stun > 0) {
      const charm = u.charmUntil > t;
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + (i * TAU) / 3;
        drawGlyph(g, charm ? '♥' : '✦', x + Math.cos(a) * 12, y - u.r - 8 + Math.sin(a) * 4, 11, charm ? '#ff5fa8' : '#ffe040');
      }
    }
    if (baseA !== 1) g.restore();
  }

  function drawProjectile(g, p, t) {
    const look = p.look && JQ.VFXP && JQ.VFXP[p.look];
    if (look) {
      g.save();
      try {
        look(g, p, t);
      } catch (e) {}
      g.restore();
      return;
    }
    g.save();
    if (p.kind === 'arrow') {
      const a = p.ang != null ? p.ang : p.target ? Math.atan2(p.target.y - p.y, p.target.x - p.x) : 0;
      g.translate(p.x, p.y);
      g.rotate(a);
      const col = p.tower ? '#5a3a1a' : p.color || (p.side === 0 ? '#1a2a4a' : '#5a1010');
      g.strokeStyle = 'rgba(255,255,255,0.35)';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(-26, 0);
      g.lineTo(-10, 0);
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = p.tower ? 3 : 2;
      g.beginPath();
      g.moveTo(-14, 0);
      g.lineTo(8, 0);
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(11, 0);
      g.lineTo(3, -4);
      g.lineTo(3, 4);
      g.fill();
    } else if (p.kind === 'orb' || p.kind === 'fox') {
      const col = p.color || '#b48cff';
      const big = p.kind === 'fox';
      const R = big ? 16 : 11;
      if (big && p.ang != null)
        for (let i = 5; i >= 1; i--) {
          g.globalAlpha = 0.5 - i * 0.08;
          g.fillStyle = col;
          g.beginPath();
          g.arc(p.x - Math.cos(p.ang) * i * 7, p.y - Math.sin(p.ang) * i * 7, R * (1 - i * 0.14), 0, TAU);
          g.fill();
        }
      g.globalAlpha = 1;
      const grd = g.createRadialGradient(p.x, p.y, 1, p.x, p.y, R);
      grd.addColorStop(0, '#fff');
      grd.addColorStop(0.35, col);
      grd.addColorStop(1, alphaHex(col, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(p.x, p.y, R, 0, TAU);
      g.fill();
    } else if (p.kind === 'pierce') {
      g.translate(p.x, p.y);
      g.rotate(p.ang);
      g.shadowColor = p.color;
      g.shadowBlur = 16;
      g.strokeStyle = p.color;
      g.lineWidth = 7;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(-10, 0, 30, -1.1, 1.1);
      g.stroke();
      g.strokeStyle = '#fff';
      g.lineWidth = 2.5;
      g.stroke();
    }
    g.restore();
  }

  function drawZone(g, z, t) {
    if (z.hidden) return;
    const k = (t - z.born) / (z.until - z.born);
    const a = k < 0.1 ? k / 0.1 : k > 0.85 ? (1 - k) / 0.15 : 1;
    g.save();
    g.globalAlpha = Math.max(0, a);
    g.translate(z.x, z.y);
    g.scale(1, 0.55);
    const grd = g.createRadialGradient(0, 0, 10, 0, 0, z.r);
    grd.addColorStop(0, alphaHex(z.color, 0.35));
    grd.addColorStop(1, alphaHex(z.color, 0.08));
    g.fillStyle = grd;
    g.beginPath();
    g.arc(0, 0, z.r, 0, TAU);
    g.fill();
    g.strokeStyle = z.color;
    g.lineWidth = 4;
    g.beginPath();
    g.arc(0, 0, z.r, 0, TAU);
    g.stroke();
    g.lineWidth = 2;
    g.beginPath();
    g.arc(0, 0, z.r * 0.72, 0, TAU);
    g.stroke();
    g.rotate(t * 0.8);
    const runes = (z.glyphs || '言灵操纵天地').padEnd(6, '阵');
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6;
      g.save();
      g.translate(Math.cos(ang) * z.r * 0.86, Math.sin(ang) * z.r * 0.86);
      g.rotate(ang + Math.PI / 2);
      text(g, runes[i], 0, 0, 22, z.color);
      g.restore();
    }
    g.rotate(-t * 1.8);
    g.beginPath();
    for (let i = 0; i < 6; i++) {
      const ang = (i * TAU) / 6;
      g.lineTo(Math.cos(ang) * z.r * 0.7, Math.sin(ang) * z.r * 0.7);
    }
    g.closePath();
    g.stroke();
    g.restore();
  }

  // ---------- 特效 ----------
  const BUILTIN = new Set(['text', 'slash', 'ring', 'shock', 'spin', 'bolt', 'ink', 'pulse', 'burst', 'runeburst', 'after', 'streak', 'crater', 'sword', 'petals', 'storm', 'tails', 'abyss']);
  function drawFx(g, f, game) {
    const k = f.t / f.life;
    const v = JQ.VFX && JQ.VFX[f.kind];
    if (v && !BUILTIN.has(f.kind)) {
      g.save();
      try {
        v(g, f, k, game);
      } catch (e) {}
      g.restore();
      return;
    }
    if (!BUILTIN.has(f.kind)) {
      // vfx.js 还没提供的特效：简单光环
      g.save();
      g.globalAlpha = 1 - k;
      g.strokeStyle = f.color || '#fff';
      g.lineWidth = 5 * (1 - k) + 1;
      const x = f.follow ? f.follow.x : f.x, y = f.follow ? f.follow.y : f.y;
      g.translate(x, y);
      g.scale(1, 0.6);
      g.beginPath();
      g.arc(0, 0, Math.max(4, (f.r || 60) * (0.3 + 0.7 * ease(k))), 0, TAU);
      g.stroke();
      g.restore();
      if (f.x2 != null) {
        g.save();
        g.globalAlpha = 1 - k;
        g.strokeStyle = f.color || '#fff';
        g.lineWidth = (f.width || 20) * (1 - k);
        g.lineCap = 'round';
        g.beginPath();
        g.moveTo(f.x, f.y);
        g.lineTo(f.x2, f.y2);
        g.stroke();
        g.restore();
      }
      return;
    }
    g.save();
    switch (f.kind) {
      case 'text': {
        const pop = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.5);
        g.globalAlpha = 1 - Math.max(0, k - 0.6) / 0.4;
        g.translate(f.x, f.y - ease(k) * 34);
        if (f.crit) g.scale(pop, pop);
        if (f.bun) drawBun(g, -18, 0, 9);
        text(g, f.text, f.bun ? 6 : 0, 0, f.size || 18, f.color || '#fff', { font: 'sans-serif', stroke: 'rgba(0,0,0,0.7)', strokeW: 3.5 });
        break;
      }
      case 'slash': {
        g.globalAlpha = 1 - k;
        g.translate(f.x, f.y);
        g.rotate(f.ang + Math.PI / 2);
        g.strokeStyle = f.color || (f.side === 0 ? '#222' : '#8a1010');
        g.lineCap = 'round';
        g.lineWidth = f.big ? 6 : 2.5;
        if (f.big) {
          g.shadowColor = f.color || '#fff';
          g.shadowBlur = 10;
        }
        g.beginPath();
        g.arc(0, 0, f.big ? 26 : 14, -0.9 + k, 0.9 + k);
        g.stroke();
        break;
      }
      case 'ring': {
        g.globalAlpha = 1 - k;
        g.strokeStyle = f.color;
        g.lineWidth = 7 * (1 - k) + 1;
        g.translate(f.x, f.y);
        g.scale(1, 0.6);
        g.beginPath();
        g.arc(0, 0, f.r * (0.3 + 0.7 * ease(k)), 0, TAU);
        g.stroke();
        g.fillStyle = alphaHex(f.color, 0.15);
        g.fill();
        break;
      }
      case 'shock': {
        const R = f.inward ? f.r * (1 - ease(k)) : f.r * ease(k);
        g.globalAlpha = 1 - k;
        g.translate(f.x, f.y);
        g.scale(1, 0.6);
        g.strokeStyle = f.color;
        g.lineWidth = f.big ? 16 * (1 - k) + 2 : 8 * (1 - k) + 1;
        g.beginPath();
        g.arc(0, 0, Math.max(1, R), 0, TAU);
        g.stroke();
        if (f.big) {
          g.strokeStyle = '#fff';
          g.lineWidth = 3;
          g.beginPath();
          g.arc(0, 0, Math.max(1, R * 0.8), 0, TAU);
          g.stroke();
          g.scale(1, 1 / 0.6);
          g.globalAlpha = Math.max(0, 1 - k * 1.5);
          text(g, '喝！', 0, -60 - k * 30, 52, '#fff', { stroke: f.color, strokeW: 8 });
        }
        break;
      }
      case 'spin': {
        const x = f.follow ? f.follow.x : f.x, y = f.follow ? f.follow.y : f.y;
        g.globalAlpha = 1 - k;
        g.translate(x, y);
        g.scale(1, 0.65);
        g.lineCap = 'round';
        const a0 = k * Math.PI * 4;
        g.shadowColor = f.color;
        g.shadowBlur = f.big ? 18 : 8;
        for (let i = 0; i < 2; i++) {
          g.strokeStyle = f.color;
          g.lineWidth = f.big ? 16 : 10;
          g.beginPath();
          g.arc(0, 0, f.r * 0.8, a0 + i * Math.PI, a0 + i * Math.PI + 1.8);
          g.stroke();
          g.strokeStyle = '#fff';
          g.lineWidth = 3;
          g.stroke();
        }
        break;
      }
      case 'bolt': {
        g.globalAlpha = 1 - k;
        g.strokeStyle = f.color;
        g.shadowColor = '#fff';
        g.shadowBlur = 14;
        g.lineWidth = f.big ? 6 : 4;
        const rnd = JQ.rng(Math.floor(f.x * 7 + f.y));
        g.beginPath();
        let x = f.x + (rnd() - 0.5) * 40, y = f.y - 260;
        const pts = [[x, y]];
        while (y < f.y) {
          y = Math.min(f.y, y + 26);
          x = f.x + (rnd() - 0.5) * 34 * (1 - (y - f.y + 260) / 300);
          pts.push([x, y]);
        }
        pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
        g.stroke();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
        g.shadowBlur = 0;
        g.fillStyle = alphaHex(f.color, 0.45);
        g.beginPath();
        g.ellipse(f.x, f.y, 30, 12, 0, 0, TAU);
        g.fill();
        break;
      }
      case 'ink': {
        g.globalAlpha = 0.75 * (1 - k);
        const col = f.side === 0 ? '#111' : '#6a0d0d';
        g.fillStyle = col;
        const rnd = JQ.rng(Math.floor(f.x * 13 + f.y * 7));
        const n = f.big ? 16 : 8;
        for (let i = 0; i < n; i++) {
          const a = rnd() * TAU, d = (6 + rnd() * (f.big ? 50 : 22)) * (0.4 + ease(k));
          g.beginPath();
          g.arc(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, 2 + rnd() * (f.big ? 7 : 4), 0, TAU);
          g.fill();
        }
        g.globalAlpha = 0.55 * (1 - k);
        text(g, f.text, f.x, f.y + k * 16, f.big ? 30 : 22, col);
        break;
      }
      case 'pulse': {
        g.globalAlpha = 1 - k;
        g.strokeStyle = f.color || (f.side === 0 ? '#5ab0ff' : '#ff6a4a');
        g.lineWidth = 4;
        const s = (f.size || 30) * (0.9 + k * 0.6);
        rr(g, f.x - s, f.y - s, s * 2, s * 2, 8);
        g.stroke();
        break;
      }
      case 'burst': {
        const rnd = JQ.rng(Math.floor(f.x * 31 + f.y * 17 + (f.n || 0)));
        g.globalAlpha = 1 - k;
        g.fillStyle = f.color;
        for (let i = 0; i < (f.n || 12); i++) {
          const a = rnd() * TAU, sp = (0.4 + rnd() * 0.6) * (f.speed || 150);
          const d = sp * f.t * (1 - k * 0.5);
          const px = f.x + Math.cos(a) * d, py = f.y + Math.sin(a) * d * 0.7 + 60 * f.t * f.t;
          const sz = (1.5 + rnd() * 3) * (1 - k * 0.6);
          g.fillRect(px - sz / 2, py - sz / 2, sz, sz);
        }
        break;
      }
      case 'runeburst': {
        g.globalAlpha = 1 - k;
        g.translate(f.x, f.y);
        g.scale(1, 0.6);
        g.rotate(k * 3);
        g.strokeStyle = f.color;
        g.lineWidth = 3;
        g.beginPath();
        for (let i = 0; i <= 5; i++) {
          const a = (i * 2 * TAU) / 5;
          g.lineTo(Math.cos(a) * f.r * ease(k), Math.sin(a) * f.r * ease(k));
        }
        g.stroke();
        g.beginPath();
        g.arc(0, 0, f.r * ease(k), 0, TAU);
        g.stroke();
        break;
      }
      case 'after': {
        g.globalAlpha = 0.5 * (1 - k);
        text(g, f.text, f.x, f.y, 38, f.color);
        break;
      }
      case 'streak': {
        g.globalAlpha = 1 - k;
        g.strokeStyle = f.color;
        g.shadowColor = f.color;
        g.shadowBlur = 12;
        g.lineCap = 'round';
        g.lineWidth = 8 * (1 - k) + 1;
        g.beginPath();
        g.moveTo(f.x, f.y);
        g.lineTo(f.x2, f.y2);
        g.stroke();
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.stroke();
        break;
      }
      case 'crater': {
        g.globalAlpha = k < 0.7 ? 0.9 : ((1 - k) / 0.3) * 0.9;
        g.translate(f.x, f.y);
        g.save();
        g.scale(1, 0.5);
        const grd = g.createRadialGradient(0, 0, 4, 0, 0, f.r);
        grd.addColorStop(0, 'rgba(40,25,10,0.7)');
        grd.addColorStop(0.7, 'rgba(80,55,25,0.35)');
        grd.addColorStop(1, 'rgba(80,55,25,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(0, 0, f.r, 0, TAU);
        g.fill();
        const rnd = JQ.rng(Math.floor(f.x + f.y * 3));
        g.strokeStyle = 'rgba(30,18,5,0.8)';
        g.lineWidth = 2.5;
        for (let i = 0; i < 9; i++) {
          const a = rnd() * TAU;
          g.beginPath();
          g.moveTo(Math.cos(a) * 15, Math.sin(a) * 15);
          g.lineTo(Math.cos(a + 0.2) * f.r * 0.6, Math.sin(a + 0.2) * f.r * 0.6);
          g.lineTo(Math.cos(a - 0.1) * f.r * 0.95, Math.sin(a - 0.1) * f.r * 0.95);
          g.stroke();
        }
        g.restore();
        if ((f.glyph || f.ding) && k < 0.5) {
          g.globalAlpha = 1 - k * 2;
          text(g, f.glyph || '鼎', 0, -26 - k * 30, 64, '#5a3a10', { stroke: '#ffd080', strokeW: 6 });
        }
        break;
      }
      case 'sword': {
        const fall = Math.min(1, k / 0.5);
        const y = f.y - 420 * (1 - ease(fall)) - 60;
        g.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        g.translate(f.x, y);
        g.shadowColor = f.color;
        g.shadowBlur = 24;
        const grd = g.createLinearGradient(-14, 0, 14, 0);
        grd.addColorStop(0, '#d8d8e8');
        grd.addColorStop(0.5, '#ffffff');
        grd.addColorStop(1, '#a8a8c0');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, 70);
        g.lineTo(14, 40);
        g.lineTo(14, -90);
        g.lineTo(-14, -90);
        g.lineTo(-14, 40);
        g.closePath();
        g.fill();
        g.fillStyle = f.color;
        g.fillRect(-36, -98, 72, 12);
        g.fillStyle = '#8a5a20';
        g.fillRect(-6, -140, 12, 44);
        g.fillStyle = f.color;
        g.beginPath();
        g.arc(0, -144, 9, 0, TAU);
        g.fill();
        break;
      }
      case 'petals': {
        const rnd = JQ.rng(Math.floor(f.x * 3 + f.y));
        g.globalAlpha = 1 - k;
        for (let i = 0; i < 40; i++) {
          const a = rnd() * TAU + k * 2, d = rnd() * f.r * (0.3 + ease(k) * 0.7);
          g.fillStyle = i % 3 ? f.color : '#ffd0e8';
          g.beginPath();
          g.ellipse(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d * 0.6 + k * 30, 7, 3.5, a * 3 + k * 6, 0, TAU);
          g.fill();
        }
        g.strokeStyle = f.color;
        g.lineWidth = 3;
        g.beginPath();
        g.ellipse(f.x, f.y, f.r * ease(k), f.r * ease(k) * 0.6, 0, 0, TAU);
        g.stroke();
        break;
      }
      case 'storm': {
        const a = Math.min(1, k * 5, (1 - k) * 3);
        g.globalAlpha = a * 0.35;
        g.fillStyle = '#0a1530';
        g.fillRect(0, L.E_BOTTOM, C.W, L.P_TOP - L.E_BOTTOM);
        g.globalAlpha = a * 0.7;
        const rnd = JQ.rng(9);
        for (let i = 0; i < 9; i++) {
          const x = ((rnd() * C.W + k * 200 * (rnd() + 0.5)) % (C.W + 100)) - 50, y = L.E_BOTTOM + 20 + rnd() * 80;
          g.fillStyle = 'rgba(60,70,90,0.8)';
          g.beginPath();
          g.ellipse(x, y, 70, 22, 0, 0, TAU);
          g.fill();
        }
        break;
      }
      case 'tails': {
        const x = f.follow ? f.follow.x : f.x, y = f.follow ? f.follow.y : f.y;
        g.globalAlpha = k < 0.2 ? k / 0.2 : (1 - k) / 0.8;
        for (let i = 0; i < 9; i++) {
          const a = -Math.PI / 2 + (i - 4) * 0.28 + Math.sin(game.time * 4 + i) * 0.08;
          g.save();
          g.translate(x, y + 6);
          g.rotate(a);
          const grd = g.createLinearGradient(0, 0, 70, 0);
          grd.addColorStop(0, alphaHex(f.color, 0.9));
          grd.addColorStop(1, 'rgba(255,255,255,0.9)');
          g.fillStyle = grd;
          g.beginPath();
          g.moveTo(10, -5);
          g.quadraticCurveTo(50, -16, 74, 0);
          g.quadraticCurveTo(50, 16, 10, 5);
          g.closePath();
          g.fill();
          g.restore();
        }
        break;
      }
      case 'abyss': {
        const a = k < 0.15 ? k / 0.15 : k > 0.7 ? (1 - k) / 0.3 : 1;
        g.globalAlpha = a;
        g.translate(f.x, f.y);
        g.save();
        g.scale(1, 0.5);
        const grd = g.createRadialGradient(0, 0, 10, 0, 0, f.r);
        grd.addColorStop(0, 'rgba(10,0,0,0.95)');
        grd.addColorStop(0.6, 'rgba(90,0,0,0.6)');
        grd.addColorStop(1, 'rgba(120,0,0,0)');
        g.fillStyle = grd;
        g.beginPath();
        g.arc(0, 0, f.r, 0, TAU);
        g.fill();
        g.restore();
        const rnd = JQ.rng(Math.floor(f.x + 5));
        g.fillStyle = '#2a0000';
        for (let i = 0; i < 14; i++) {
          const ang = rnd() * TAU, d = rnd() * f.r * 0.8;
          const px = Math.cos(ang) * d, py = Math.sin(ang) * d * 0.5;
          const h = 30 * Math.min(1, k * 6) * (0.6 + rnd());
          g.beginPath();
          g.moveTo(px - 5, py);
          g.lineTo(px, py - h);
          g.lineTo(px + 5, py);
          g.fill();
        }
        break;
      }
    }
    g.restore();
  }

  // 大招横幅：画在最上层
  function drawBanner(g, f) {
    const k = f.t / f.life;
    const inK = Math.min(1, k / 0.15), outK = k > 0.8 ? (k - 0.8) / 0.2 : 0;
    g.save();
    g.globalAlpha = 1 - outK;
    const w = C.W * ease(inK);
    const y = f.y;
    g.fillStyle = 'rgba(15,10,5,0.82)';
    g.beginPath();
    g.moveTo(C.W / 2 - w / 2, y - 46);
    g.quadraticCurveTo(C.W / 2, y - 60, C.W / 2 + w / 2, y - 40);
    g.lineTo(C.W / 2 + w / 2 - 20, y + 44);
    g.quadraticCurveTo(C.W / 2, y + 58, C.W / 2 - w / 2 + 10, y + 40);
    g.closePath();
    g.fill();
    g.strokeStyle = f.color;
    g.lineWidth = 3;
    g.stroke();
    const slide = (1 - ease(inK)) * (f.side === 0 ? -200 : 200);
    const big = f.text.length > 5 ? 34 : 46;
    text(g, f.hero, 110 + slide, y + 2, 32, f.color, { stroke: '#000', strokeW: 5 });
    text(g, f.text, C.W / 2 + 60 - slide, y + 2, big, '#fff6d8', { stroke: f.color, strokeW: 7 });
    g.restore();
  }

  // ---------- HUD ----------
  let panelGrad = null;
  function drawHud(game, view) {
    const g = view.g;
    const s = game.sides[0];
    const t = game.time;
    // 底部操作区底板：从招兵栏上沿一直铺到屏幕底
    const py = UI.shop.y - 10, pb = C.H + VIEW.padY;
    if (!panelGrad || panelGrad.y !== py) {
      panelGrad = g.createLinearGradient(0, py, 0, pb);
      panelGrad.y = py;
      panelGrad.addColorStop(0, 'rgba(60,40,15,0.0)');
      panelGrad.addColorStop(Math.min(0.5, 12 / (pb - py)), 'rgba(60,40,15,0.42)');
      panelGrad.addColorStop(1, 'rgba(40,25,8,0.7)');
    }
    g.fillStyle = panelGrad;
    g.fillRect(-VIEW.padX, py, C.W + 2 * VIEW.padX, pb - py);
    g.save();
    g.translate(0, -VIEW.top);
    if (game.R.waves) {
      g.save();
      g.fillStyle = 'rgba(30,20,10,0.7)';
      rr(g, C.W / 2 - 160, 10, 320, 32, 14);
      g.fill();
      text(g, `守关 · 第 ${game.wave} 波 · 下一波 ${Math.ceil(game.waveT)}s`, C.W / 2, 27, 18, game.wave % 4 === 3 ? '#ff8060' : '#ffe9a0');
      g.restore();
    } else drawHpBar(g, game.sides[1], 16, view);
    const left = game.R.time === Infinity ? game.time : Math.max(0, game.R.time - game.time);
    const mm = String(Math.floor(left / 60)).padStart(2, '0'), ss = String(Math.floor(left % 60)).padStart(2, '0');
    // 关卡号做成显眼的小牌，模式/难度退到第二行
    g.save();
    g.fillStyle = 'rgba(25,16,8,0.62)';
    rr(g, 56, 10, 138, 40, 12);
    g.fill();
    g.strokeStyle = 'rgba(255,220,150,0.35)';
    g.lineWidth = 1.5;
    g.stroke();
    text(g, game.R.waves ? `第 ${game.wave} 波` : `第 ${game.stage} 关`, 66, 25, 19, '#ffe9a0', { align: 'left', stroke: '#2a1a08', strokeW: 4 });
    text(g, game.mode.name + ' · ' + game.diff.name, 66, 40, 10, '#d8c8a0', { align: 'left', font: 'sans-serif', bold: false });
    if (game.R.events) {
      const m = game.mods;
      const act = [];
      if (m.rageUntil > game.time) act.push(`杀气 ${Math.ceil(m.rageUntil - game.time)}s`);
      if (m.swiftUntil > game.time) act.push(`神行 ${Math.ceil(m.swiftUntil - game.time)}s`);
      if (m.freeUntil > game.time) act.push(`免费招兵 ${Math.ceil(m.freeUntil - game.time)}s`);
      text(g, (act.length ? act.join(' ') + ' · ' : '') + `下次天命 ${Math.ceil(game.eventT)}s`, C.W - 12, 64, 13, '#7a1a10', { align: 'right', font: 'sans-serif' });
    }
    g.restore();
    g.save();
    g.fillStyle = 'rgba(30,20,10,0.65)';
    rr(g, 568, 12, 88, 30, 14);
    g.fill();
    text(g, `${mm}:${ss}`, 612, 28, 20, game.overtime ? '#ff6a4a' : '#ffe9a0', { font: 'sans-serif' });
    g.restore();
    g.restore();
    // 我方基地血条跟着招兵栏走
    drawHpBar(g, s, UI.shop.y - 32, view);
    roundBtn(g, UI.pause, 'Ⅱ');
    roundBtn(g, UI.speed, view.speed + 'x');
    if (game.overtime && !game.over) {
      g.save();
      g.globalAlpha = 0.25 + Math.sin(t * 4) * 0.12;
      const v = g.createRadialGradient(C.W / 2, 585, 250, C.W / 2, 585, 650);
      v.addColorStop(0, 'rgba(180,0,0,0)');
      v.addColorStop(1, 'rgba(180,0,0,0.8)');
      g.fillStyle = v;
      g.fillRect(-VIEW.padX, -VIEW.padY, C.W + 2 * VIEW.padX, C.H + 2 * VIEW.padY);
      g.globalAlpha = 0.7 + Math.sin(t * 6) * 0.25;
      text(g, '决战时刻 · 伤害翻倍', C.W / 2, 330, 26, '#b01c10', { stroke: '#f5e6c0', strokeW: 5 });
      g.restore();
    }
    // 包子
    const bun = UI.bun;
    if (view.target && view.target.sell) {
      g.save();
      g.shadowColor = '#ffd23f';
      g.shadowBlur = 20;
      g.strokeStyle = '#ffd23f';
      g.lineWidth = 3;
      rr(g, bun.x, bun.y, bun.w, bun.h, 10);
      g.stroke();
      g.restore();
    }
    const bs = view.target && view.target.sell ? 1.15 : 1;
    if (!JQ.uiDraw(g, 'bun', bun.x + bun.w / 2 - 28 * bs, bun.y + 30 - 24 * bs, 56 * bs, 47 * bs)) drawBun(g, bun.x + bun.w / 2, bun.y + 30, view.target && view.target.sell ? 28 : 24);
    const pop = view.bunPop > 0 ? 1 + view.bunPop * 0.6 : 1;
    g.save();
    g.translate(bun.x + bun.w / 2, bun.y + 70);
    g.scale(pop, pop);
    text(g, String(Math.floor(s.buns)), 0, 0, 24, '#fff', { font: 'sans-serif', stroke: '#3a2a10', strokeW: 4 });
    g.restore();
    if (view.heldCard && view.dragFrom && view.heldCard.kind !== 'item') text(g, `卖+${game.sellValue(view.heldCard)}`, bun.x + bun.w / 2, bun.y - 10, 14, '#ffe9a0', { font: 'sans-serif', stroke: '#3a2a10', strokeW: 3 });

    // 招兵栏
    for (let i = 0; i < C.SHOP_SIZE; i++) {
      const r = JQ.shopRect(i);
      g.fillStyle = 'rgba(255,250,235,0.18)';
      rr(g, r.x, r.y, r.w, r.h, 9);
      g.fill();
      g.strokeStyle = view.selected === i ? '#ffb000' : 'rgba(255,240,200,0.45)';
      g.lineWidth = view.selected === i ? 4 : 1.5;
      g.stroke();
      const card = s.shop[i];
      if (!card || (view.dragFrom && view.dragFrom.shop === i)) continue;
      const nowMs = performance.now();
      if (view.anims.some((an) => an.kind === 'back' && an.shop === i && nowMs - an.t0 < 200)) continue;
      // 刷新时依次翻入
      const a = view.shopAnim != null ? Math.min(1, Math.max(0, (nowMs - view.shopAnim) / 220 - i * 0.35)) : 1;
      if (a <= 0) continue;
      const pop = view.anims.find((an) => an.kind === 'pop' && an.shop === i && nowMs - an.t0 < 320);
      const animating = a < 1 || !!pop;
      if (animating) {
        g.save();
        g.translate(r.x + r.w / 2, r.y + r.h / 2);
        g.scale(ease(a), 1);
        g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        if (pop) {
          const k = (nowMs - pop.t0) / 320;
          const sc = 1 + 0.2 * Math.sin(Math.min(1, k * 1.4) * Math.PI);
          g.translate(r.x + r.w / 2, r.y + r.h / 2);
          g.scale(sc, sc);
          g.translate(-(r.x + r.w / 2), -(r.y + r.h / 2));
        }
      }
      drawCard(g, card, r.x, r.y, r.w, r.h, { label: true, pack: s.pack });
      if (animating) g.restore();
    }

    // 备战席落点高亮
    if (view.target && view.target.shop != null) {
      const r = JQ.shopRect(view.target.shop);
      const how = view.target.how;
      const col = how === 'merge' ? '#ffb000' : how === 'swap' ? '#6aa0ff' : '#3fbf3f';
      g.save();
      g.strokeStyle = col;
      g.lineWidth = 4;
      g.shadowColor = col;
      g.shadowBlur = 14;
      rr(g, r.x - 2, r.y - 2, r.w + 4, r.h + 4, 10);
      g.stroke();
      g.shadowBlur = 0;
      const label = { swap: '换位', move: '挪过来', return: '收回' }[how];
      if (label) text(g, label, r.x + r.w / 2, r.y - 10, 15, col, { stroke: '#000', strokeW: 4 });
      g.restore();
    }

    // 招兵按钮
    const rb = UI.recruit;
    const ok = game.canRecruit(0);
    g.save();
    if (ok) {
      g.shadowColor = '#ffcf5a';
      g.shadowBlur = 10 + Math.sin(t * 5) * 8;
    }
    if (!JQ.ui3(g, ok ? 'btn_gold' : 'btn_stone', rb.x, rb.y, rb.w, rb.h, 46)) {
      rr(g, rb.x, rb.y, rb.w, rb.h, 14);
      const grd = g.createLinearGradient(0, rb.y, 0, rb.y + rb.h);
      grd.addColorStop(0, ok ? '#ffe39a' : '#cfc7b4');
      grd.addColorStop(1, ok ? '#e09a33' : '#a9a191');
      g.fillStyle = grd;
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = 3;
      g.strokeStyle = '#6a4a20';
      g.stroke();
    }
    g.shadowBlur = 0;
    text(g, '招 兵', rb.x + rb.w / 2, rb.y + 24, 30, '#3a2a10');
    const bv = game.benchValue(0);
    text(g, bv ? `卖备战席 +${bv}` : '整排刷新', rb.x + rb.w / 2, rb.y + 48, 12, '#6a4a20', { font: 'sans-serif', bold: false });
    if (!JQ.uiDraw(g, 'bun', rb.x + rb.w / 2 - 33, rb.y + 61, 24, 20)) drawBun(g, rb.x + rb.w / 2 - 20, rb.y + 70, 10);
    text(g, String(s.recruitCost()), rb.x + rb.w / 2 + 10, rb.y + 71, 18, s.buns >= s.recruitCost() ? '#3a2a10' : '#b02010', { font: 'sans-serif' });
    g.restore();

    if (view.info) {
      g.save();
      g.globalAlpha = Math.min(1, view.infoT * 2);
      text(g, view.info, C.W / 2, UI.info.y, 17, '#ffeec0', { stroke: 'rgba(0,0,0,0.6)', strokeW: 4 });
      g.restore();
    }
  }

  function roundBtn(g, r, txt) {
    g.save();
    if (JQ.uiDraw(g, 'disc', r.x - 2, r.y - 2, r.w + 4, r.h + 4)) {
      text(g, txt, r.x + r.w / 2, r.y + r.h / 2 + 1, 17, '#fff3d6', { font: 'sans-serif', stroke: '#2a1a08', strokeW: 3 });
      return g.restore();
    }
    g.fillStyle = 'rgba(40,30,20,0.7)';
    g.beginPath();
    g.arc(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, 0, TAU);
    g.fill();
    g.strokeStyle = 'rgba(255,230,180,0.6)';
    g.lineWidth = 2;
    g.stroke();
    text(g, txt, r.x + r.w / 2, r.y + r.h / 2 + 1, 17, '#fff', { font: 'sans-serif' });
    g.restore();
  }

  JQ.render = function (game, view) {
    const g = view.g;
    if (!bg) bg = makeBackground();
    g.save();
    if (game.shake > 0) g.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    g.drawImage(bg, 0, -BG_EXT);
    if (!view.test) {
      drawBoard(game, 1, view);
      drawBoard(game, 0, view);
    }
    for (const z of game.zones) drawZone(g, z, game.time);
    const ground = (f) => f.kind === 'crater' || f.kind === 'abyss' || f.kind === 'storm';
    for (const f of game.fx) if (ground(f)) drawFx(g, f, game);
    const us = game.units.slice().sort((a, b) => a.y - b.y);
    for (const u of us) drawUnit(g, u, game);
    for (const p of game.projectiles) drawProjectile(g, p, game.time);
    for (const f of game.fx) if (!ground(f) && f.kind !== 'banner') drawFx(g, f, game);
    g.restore();
    if (!view.test && !view.noHud) {
      drawHud(game, view);
      for (const f of game.fx) if (f.kind === 'banner') drawBanner(g, f);
    }
    const now = performance.now();
    for (const an of view.anims) {
      if (an.kind !== 'back') continue;
      const k = Math.min(1, (now - an.t0) / 200);
      if (k >= 1) continue;
      const e = ease(k);
      const sz = an.to.w;
      const x = an.x + (an.to.x + an.to.w / 2 - an.x) * e, y = an.y + (an.to.y + an.to.h / 2 - an.y) * e;
      drawCard(g, an.card, x - sz / 2, y - an.to.h / 2, sz, an.to.h, { pack: game.packs[0] });
    }
    if (view.heldCard && view.dragPos && view.dragFrom) {
      const snap = view.target && view.target.cell;
      const sz = snap ? 58 : view.dragFrom.cell ? 66 : 76;
      g.save();
      g.globalAlpha = snap ? 0.75 : 0.95;
      g.shadowColor = 'rgba(0,0,0,0.45)';
      g.shadowBlur = 14;
      g.shadowOffsetY = 8;
      drawCard(g, view.heldCard, view.dragPos.x - sz / 2, view.dragPos.y - sz / 2, sz, sz, { pack: game.packs[0] });
      g.restore();
    }
  };
})();
