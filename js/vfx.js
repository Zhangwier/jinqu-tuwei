// 技能特效：JQ.VFX[kind](g, f, k, game) 场景特效，JQ.VFXP[kind](g, p, time) 飞行道具。
// 调用方负责 save/restore；k 为 0→1 的进度；随机数按位置播种，保证每帧一致。
(function () {
  const JQ = (window.JQ = window.JQ || {});
  const TAU = Math.PI * 2;
  const A = (hex, a) => JQ.alphaHex(hex || '#ffffff', Math.max(0, Math.min(1, a)));
  const ease = (k) => 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const seed = (f, n) => JQ.rng(Math.floor(f.x * 13 + f.y * 7 + (n || 0)) || 1);
  const fadeOut = (k, from) => (k < from ? 1 : 1 - (k - from) / (1 - from));

  const glowCache = new Map();
  function glowDot(g, x, y, r, color, core) {
    const key = (color || '#ffffff') + '|' + (core || '#ffffff');
    let c = glowCache.get(key);
    if (!c) {
      const S = 128;
      c = document.createElement('canvas');
      c.width = c.height = S;
      const gg = c.getContext('2d');
      const grd = gg.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
      grd.addColorStop(0, core || '#ffffff');
      grd.addColorStop(0.35, color || '#ffffff');
      grd.addColorStop(1, A(color, 0));
      gg.fillStyle = grd;
      gg.fillRect(0, 0, S, S);
      glowCache.set(key, c);
    }
    g.drawImage(c, x - r, y - r, r * 2, r * 2);
  }

  // 地面椭圆（透视压扁）
  function groundRing(g, x, y, r, color, width, alpha) {
    g.save();
    g.globalAlpha *= alpha;
    g.translate(x, y);
    g.scale(1, 0.5);
    g.strokeStyle = color;
    g.lineWidth = width;
    g.beginPath();
    g.arc(0, 0, Math.max(1, r), 0, TAU);
    g.stroke();
    g.restore();
  }

  function embers(g, f, x, y, n, spread, t, color, gravity) {
    const rnd = seed(f, 99);
    g.fillStyle = color;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = spread * (0.4 + rnd() * 0.6);
      const px = x + Math.cos(a) * sp * t, py = y + Math.sin(a) * sp * t * 0.6 + (gravity || 120) * t * t;
      const s = 1.5 + rnd() * 2.5;
      g.fillRect(px - s / 2, py - s / 2, s, s);
    }
  }

  function cracks(g, f, x, y, r, alpha) {
    const rnd = seed(f, 7);
    g.save();
    g.translate(x, y);
    g.scale(1, 0.5);
    g.strokeStyle = `rgba(40,25,10,${alpha})`;
    g.lineWidth = 2.5;
    for (let i = 0; i < 10; i++) {
      let a = rnd() * TAU, d = 8;
      g.beginPath();
      g.moveTo(Math.cos(a) * d, Math.sin(a) * d);
      for (let j = 0; j < 3; j++) {
        a += (rnd() - 0.5) * 0.5;
        d += r * (0.2 + rnd() * 0.15);
        g.lineTo(Math.cos(a) * d, Math.sin(a) * d);
      }
      g.stroke();
    }
    g.restore();
  }

  const VFX = {};

  // 唐刀：金色刀光沿直线/连斩轨迹掠过
  VFX.tangblade = function (g, f, k) {
    const x2 = f.x2 == null ? f.x : f.x2, y2 = f.y2 == null ? f.y : f.y2;
    const dx = x2 - f.x, dy = y2 - f.y, L = Math.hypot(dx, dy) || 1;
    const e = ease(k), hx = f.x + dx * e, hy = f.y + dy * e;
    const ang = Math.atan2(dy, dx);
    g.save();
    g.translate(hx, hy);
    g.rotate(ang);
    g.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      g.globalAlpha = (1 - k) * (0.5 - i * 0.11);
      g.strokeStyle = f.color || '#ffd86a';
      g.lineWidth = 13 - i * 3.5;
      g.beginPath();
      g.arc(-i * 13, 0, 46 - i * 4, -0.95, 0.95);
      g.stroke();
    }
    g.globalAlpha = 1 - k;
    g.strokeStyle = '#fff6d0';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, 44, -0.8, 0.8);
    g.stroke();
    g.restore();
    const rnd = seed(f, 3);
    g.globalAlpha = (1 - k) * 0.8;
    g.fillStyle = f.color || '#ffd86a';
    for (let i = 0; i < 10; i++) {
      const a = rnd() * TAU, d = 20 + rnd() * 46 * e;
      g.fillRect(hx + Math.cos(a) * d - 1.5, hy + Math.sin(a) * d * 0.5 - 1.5, 3, 3);
    }
  };

  // 铁骑：烟尘、枪旗和冲锋楔形
  VFX.warhorse = function (g, f, k) {
    const x2 = f.x2 == null ? f.x : f.x2, y2 = f.y2 == null ? f.y : f.y2;
    const dx = x2 - f.x, dy = y2 - f.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const e = ease(clamp(k * 1.3)), hx = f.x + dx * Math.min(1, e), hy = f.y + dy * Math.min(1, e);
    const a = fadeOut(k, 0.72);
    const rnd = seed(f, 11);
    g.globalAlpha = a * 0.4;
    g.fillStyle = '#c8a86a';
    for (let i = 0; i < 14; i++) {
      const back = 20 + rnd() * L * 0.8 * e;
      const side = (rnd() - 0.5) * 70;
      const s = 5 + rnd() * 9;
      g.beginPath();
      g.ellipse(hx - ux * back + nx * side, hy - uy * back + ny * side, s, s * 0.55, 0, 0, TAU);
      g.fill();
    }
    g.save();
    g.globalAlpha = a;
    g.translate(hx, hy);
    g.rotate(Math.atan2(dy, dx));
    g.fillStyle = f.color || '#ffd86a';
    g.beginPath();
    g.moveTo(26, 0);
    g.lineTo(-8, -16);
    g.lineTo(-2, 0);
    g.lineTo(-8, 16);
    g.closePath();
    g.fill();
    g.strokeStyle = 'rgba(255,246,208,0.9)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(-4, 0);
    g.lineTo(40, 0);
    g.stroke();
    g.restore();
  };

  // 1. 火流星
  VFX.meteor = function (g, f, k) {
    const r = f.r || 120, col = f.color || '#ff5a20';
    const fall = clamp(k / 0.35);
    if (k < 0.35) {
      const sx = f.x + 240, sy = f.y - 460;
      const x = sx + (f.x - sx) * fall * fall, y = sy + (f.y - sy) * fall * fall;
      const ang = Math.atan2(f.y - sy, f.x - sx);
      for (let i = 8; i >= 1; i--) {
        g.globalAlpha = 0.5 - i * 0.05;
        glowDot(g, x - Math.cos(ang) * i * 14, y - Math.sin(ang) * i * 14, 22 - i * 1.6, col, '#ffd080');
      }
      g.globalAlpha = 1;
      glowDot(g, x, y, 30, '#ff9a30', '#ffffff');
      return;
    }
    const e = (k - 0.35) / 0.65;
    // 焦痕
    g.save();
    g.globalAlpha = 0.55 * (1 - e);
    g.translate(f.x, f.y);
    g.scale(1, 0.5);
    const sc = g.createRadialGradient(0, 0, 4, 0, 0, r);
    sc.addColorStop(0, 'rgba(30,10,0,0.9)');
    sc.addColorStop(1, 'rgba(30,10,0,0)');
    g.fillStyle = sc;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.restore();
    // 火球爆开
    g.globalAlpha = 1 - e;
    glowDot(g, f.x, f.y - 10, r * (0.4 + 0.8 * ease(e)), col, '#fff6c0');
    groundRing(g, f.x, f.y, r * (0.3 + ease(e)), '#ffd060', 10 * (1 - e) + 1, 1 - e);
    embers(g, f, f.x, f.y - 10, 30, 260, e * 0.9, '#ffb040', 200);
    cracks(g, f, f.x, f.y, r, 0.6 * (1 - e));
  };

  // 2. 如来神掌
  function drawPalm(g, cx, cy, s) {
    const grd = g.createLinearGradient(cx - s * 0.6, cy - s, cx + s * 0.6, cy + s * 0.6);
    grd.addColorStop(0, '#fff3b0');
    grd.addColorStop(0.5, '#ffd040');
    grd.addColorStop(1, '#d08a10');
    g.fillStyle = grd;
    g.strokeStyle = '#8a5a00';
    g.lineWidth = 3;
    const fingers = [[-0.33, 0.62], [-0.11, 0.74], [0.11, 0.7], [0.33, 0.56]];
    for (const [fx, h] of fingers) {
      JQ.rr(g, cx + fx * s - s * 0.1, cy - s * 0.2 - h * s, s * 0.2, h * s + s * 0.2, s * 0.1);
      g.fill();
      g.stroke();
    }
    // 拇指
    g.save();
    g.translate(cx - s * 0.48, cy + s * 0.05);
    g.rotate(-0.7);
    JQ.rr(g, -s * 0.1, -s * 0.45, s * 0.2, s * 0.5, s * 0.1);
    g.fill();
    g.stroke();
    g.restore();
    JQ.rr(g, cx - s * 0.46, cy - s * 0.25, s * 0.92, s * 0.85, s * 0.25);
    g.fill();
    g.stroke();
    JQ.text(g, '卍', cx, cy + s * 0.18, s * 0.38, '#b06a00');
  }
  VFX.palm = function (g, f, k) {
    const r = f.r || 160;
    const d = clamp(k / 0.4);
    const py = f.y - 520 * (1 - ease(d)) - r * 0.35;
    const out = fadeOut(k, 0.7);
    if (k >= 0.4) {
      const e = (k - 0.4) / 0.6;
      // 金光放射
      g.save();
      g.globalAlpha = 0.8 * (1 - e);
      g.translate(f.x, f.y);
      const rnd = seed(f, 3);
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU + rnd() * 0.2;
        const len = r * (1.2 + rnd() * 0.8) * ease(e * 1.5);
        const grd = g.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len * 0.55);
        grd.addColorStop(0, 'rgba(255,240,150,0.9)');
        grd.addColorStop(1, 'rgba(255,200,40,0)');
        g.strokeStyle = grd;
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos(a) * len, Math.sin(a) * len * 0.55);
        g.stroke();
      }
      g.restore();
      groundRing(g, f.x, f.y, r * (0.4 + ease(e)), '#ffe080', 14 * (1 - e) + 2, 1 - e);
      cracks(g, f, f.x, f.y, r, 0.7 * (1 - e));
    }
    g.globalAlpha = out;
    g.shadowColor = '#ffd040';
    g.shadowBlur = 24;
    drawPalm(g, f.x, py, r * 0.75);
  };

  // 3. 金箍棒
  VFX.staff = function (g, f, k) {
    const r = f.r || 100;
    const d = clamp(k / 0.28);
    const len = 320, w = 16;
    const bottom = f.y + 6 - 520 * (1 - d * d);
    g.save();
    g.globalAlpha = fadeOut(k, 0.65);
    g.translate(f.x, bottom);
    g.rotate(0.12 * (1 - d));
    g.shadowColor = '#ffcf40';
    g.shadowBlur = 18;
    const grd = g.createLinearGradient(-w / 2, 0, w / 2, 0);
    grd.addColorStop(0, '#b07a10');
    grd.addColorStop(0.5, '#ffe680');
    grd.addColorStop(1, '#b07a10');
    g.fillStyle = grd;
    g.fillRect(-w / 2, -len, w, len);
    g.shadowBlur = 0;
    g.fillStyle = '#c0281a';
    g.fillRect(-w / 2 - 2, -len, w + 4, 34);
    g.fillRect(-w / 2 - 2, -36, w + 4, 34);
    g.fillStyle = '#ffd040';
    g.fillRect(-w / 2 - 3, -len + 30, w + 6, 6);
    g.fillRect(-w / 2 - 3, -40, w + 6, 6);
    g.restore();
    if (k > 0.28) {
      const e = (k - 0.28) / 0.72;
      groundRing(g, f.x, f.y, r * (0.3 + 1.1 * ease(e)), '#ffd060', 12 * (1 - e) + 1, 1 - e);
      groundRing(g, f.x, f.y, r * (0.2 + 0.7 * ease(e)), '#ffffff', 4, 1 - e);
      g.globalAlpha = 1 - e;
      embers(g, f, f.x, f.y, 26, 220, e * 0.8, 'rgba(150,110,60,0.9)', 160);
      cracks(g, f, f.x, f.y, r, 0.6 * (1 - e));
    }
  };

  // 4. 变身云烟
  VFX.clone = function (g, f, k) {
    const rnd = seed(f, 5);
    const a = 1 - ease(k);
    for (let i = 0; i < 8; i++) {
      const ang = rnd() * TAU, d = 10 + rnd() * 26 * ease(k);
      const R = (12 + rnd() * 14) * (0.6 + ease(k));
      g.globalAlpha = a * 0.85;
      const x = f.x + Math.cos(ang) * d, y = f.y + Math.sin(ang) * d * 0.6 - 10 - k * 10;
      const grd = g.createRadialGradient(x, y, 2, x, y, R);
      grd.addColorStop(0, '#ffffff');
      grd.addColorStop(0.7, A(f.color, 0.5));
      grd.addColorStop(1, A(f.color, 0));
      g.fillStyle = grd;
      g.beginPath();
      g.arc(x, y, R, 0, TAU);
      g.fill();
    }
    g.globalAlpha = a;
    for (let i = 0; i < 5; i++) {
      const ang = rnd() * TAU, d = 20 + 40 * ease(k);
      JQ.text(g, '✦', f.x + Math.cos(ang) * d, f.y - 10 + Math.sin(ang) * d * 0.6, 12, '#fff8c0', { font: 'sans-serif' });
    }
  };

  // 5. 东方龙
  VFX.dragon = function (g, f, k) {
    const col = f.color || '#bfe6ff';
    const dx = f.x2 - f.x, dy = f.y2 - f.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
    const head = clamp(k * 1.35);
    const out = fadeOut(k, 0.75);
    const at = (s) => {
      const w = Math.sin(s * 10 - k * 14) * 26 * (1 - Math.abs(s - 0.5) * 0.6);
      return [f.x + dx * s + nx * w, f.y + dy * s + ny * w];
    };
    // 云雾尾迹
    g.globalAlpha = 0.35 * out;
    for (let i = 0; i < 10; i++) {
      const s = head - i * 0.06;
      if (s < 0) break;
      const [x, y] = at(s);
      glowDot(g, x, y, 26 + i * 2, A('#ffffff', 0.6), '#ffffff');
    }
    // 身体
    const N = 22;
    for (let i = N; i >= 0; i--) {
      const s = head - i * 0.03;
      if (s < 0) continue;
      const [x, y] = at(s);
      const R = 15 - i * 0.5;
      g.globalAlpha = out;
      g.fillStyle = i % 2 ? col : A(col, 0.85);
      g.beginPath();
      g.arc(x, y, Math.max(3, R), 0, TAU);
      g.fill();
      if (i % 3 === 0 && R > 5) {
        // 背鳍
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.moveTo(x + nx * R, y + ny * R);
        g.lineTo(x + nx * (R + 9) - ux * 4, y + ny * (R + 9) - uy * 4);
        g.lineTo(x + nx * R - ux * 8, y + ny * R - uy * 8);
        g.fill();
      }
    }
    // 龙头
    const [hx, hy] = at(head);
    g.globalAlpha = out;
    g.shadowColor = col;
    g.shadowBlur = 16;
    g.fillStyle = col;
    g.beginPath();
    g.ellipse(hx, hy, 24, 16, Math.atan2(uy, ux), 0, TAU);
    g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = '#fff6d0';
    g.lineWidth = 3;
    for (const sgn of [-1, 1]) {
      g.beginPath();
      g.moveTo(hx - ux * 6 + nx * sgn * 8, hy - uy * 6 + ny * sgn * 8);
      g.lineTo(hx - ux * 26 + nx * sgn * 22, hy - uy * 26 + ny * sgn * 22);
      g.stroke();
      // 龙须
      g.beginPath();
      g.moveTo(hx + ux * 16 + nx * sgn * 6, hy + uy * 16 + ny * sgn * 6);
      g.quadraticCurveTo(hx + ux * 34 + nx * sgn * 22, hy + uy * 34 + ny * sgn * 22, hx + ux * 20 + nx * sgn * 34, hy + uy * 20 + ny * sgn * 34);
      g.stroke();
    }
    g.fillStyle = '#ff3020';
    g.beginPath();
    g.arc(hx + ux * 8 + nx * 6, hy + uy * 8 + ny * 6, 3, 0, TAU);
    g.fill();
  };

  // 6. 旋风
  VFX.tornado = function (g, f, k, game) {
    const r = f.r || 140, col = f.color || '#60c060';
    const grow = ease(clamp(k / 0.25)), a = fadeOut(k, 0.7);
    const t = (game && game.time) || 0;
    const H = r * 1.4 * grow;
    g.globalAlpha = a;
    for (let i = 0; i < 10; i++) {
      const p = i / 9;
      const y = f.y - p * H;
      const rr = (r * 0.12 + r * 0.5 * p) * grow;
      const sway = Math.sin(t * 6 + p * 4) * 10 * p;
      g.strokeStyle = i % 2 ? A(col, 0.75) : 'rgba(240,250,240,0.7)';
      g.lineWidth = 3 + p * 2;
      g.beginPath();
      g.ellipse(f.x + sway, y, rr, rr * 0.32, 0, t * 8 + i, t * 8 + i + 4.2);
      g.stroke();
    }
    const rnd = seed(f, 11);
    for (let i = 0; i < 16; i++) {
      const p = rnd(), ang = t * (5 + rnd() * 4) + rnd() * TAU;
      const rr = (r * 0.15 + r * 0.55 * p) * grow;
      const x = f.x + Math.cos(ang) * rr, y = f.y - p * H + Math.sin(ang) * rr * 0.3;
      g.save();
      g.translate(x, y);
      g.rotate(ang * 2);
      g.fillStyle = i % 3 ? '#5a9a3a' : '#c8a060';
      g.beginPath();
      g.ellipse(0, 0, 5, 2.2, 0, 0, TAU);
      g.fill();
      g.restore();
    }
    groundRing(g, f.x, f.y, r * 0.9 * grow, A(col, 0.6), 4, a);
  };

  // 7. 扇形火焰
  VFX.firewave = function (g, f, k, game) {
    const len = f.len || 220, width = f.width || 140, col = f.color || '#ff5a20';
    const reach = len * ease(clamp(k * 2.5));
    const a = fadeOut(k, 0.55);
    const t = (game && game.time) || 0;
    g.translate(f.x, f.y);
    g.rotate(f.ang || 0);
    g.globalAlpha = a;
    const half = (width / 2) * (reach / len);
    const grd = g.createLinearGradient(0, 0, reach, 0);
    grd.addColorStop(0, 'rgba(255,255,220,0.95)');
    grd.addColorStop(0.25, 'rgba(255,210,80,0.9)');
    grd.addColorStop(0.65, A(col, 0.75));
    grd.addColorStop(1, A(col, 0));
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -8);
    g.quadraticCurveTo(reach * 0.6, -half * 1.1, reach, -half * 0.3);
    g.lineTo(reach, half * 0.3);
    g.quadraticCurveTo(reach * 0.6, half * 1.1, 0, 8);
    g.closePath();
    g.fill();
    // 火舌
    const rnd = seed(f, 13);
    for (let i = 0; i < 16; i++) {
      const p = 0.15 + rnd() * 0.85;
      const x = reach * p;
      const off = (rnd() - 0.5) * 2 * (width / 2) * p;
      const h = 14 + rnd() * 18 + Math.sin(t * 20 + i) * 6;
      g.fillStyle = i % 2 ? 'rgba(255,230,120,0.85)' : A(col, 0.8);
      g.beginPath();
      g.moveTo(x - 8, off);
      g.quadraticCurveTo(x + h * 0.6, off - 6, x + h, off + Math.sin(t * 16 + i) * 5);
      g.quadraticCurveTo(x + h * 0.6, off + 6, x - 8, off);
      g.fill();
    }
    g.fillStyle = '#ffd060';
    for (let i = 0; i < 18; i++) {
      const p = rnd();
      const x = reach * p + k * 60, y = (rnd() - 0.5) * width * p - k * 30 * rnd();
      g.fillRect(x, y, 2.5, 2.5);
    }
  };

  // 8. 莲花
  VFX.lotus = function (g, f, k) {
    const R = Math.min(70, (f.r || 120) * 0.35) * (f.big ? 1.3 : 1);
    const open = ease(clamp(k / 0.45));
    const a = fadeOut(k, 0.65);
    g.globalAlpha = a * 0.6;
    glowDot(g, f.x, f.y - 10, R * 2, 'rgba(200,255,220,0.5)', 'rgba(255,255,240,0.9)');
    g.globalAlpha = a;
    g.save();
    g.translate(f.x, f.y);
    g.scale(1, 0.75);
    for (const layer of [0, 1]) {
      const n = 8, len = R * (layer ? 0.7 : 1), spread = (layer ? 0.5 : 0.9) * open;
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + ((i - (n - 1) / 2) / n) * Math.PI * 2 * spread + (layer ? 0.2 : 0);
        g.save();
        g.rotate(ang + Math.PI / 2);
        const grd = g.createLinearGradient(0, 0, 0, -len);
        grd.addColorStop(0, layer ? '#ffffff' : '#ffd0e0');
        grd.addColorStop(1, layer ? '#ffe0ec' : '#ff8ab0');
        g.fillStyle = grd;
        g.beginPath();
        g.moveTo(0, 0);
        g.quadraticCurveTo(len * 0.38, -len * 0.55, 0, -len);
        g.quadraticCurveTo(-len * 0.38, -len * 0.55, 0, 0);
        g.fill();
        g.restore();
      }
    }
    glowDot(g, 0, -4, R * 0.25, '#ffd040', '#fffbe0');
    g.restore();
    const rnd = seed(f, 17);
    for (let i = 0; i < 12; i++) {
      const px = f.x + (rnd() - 0.5) * R * 2.4, py = f.y - k * (60 + rnd() * 80) - rnd() * 20;
      g.fillStyle = A('#d8ffd0', 0.9 * (1 - k));
      g.beginPath();
      g.arc(px, py, 2 + rnd() * 2, 0, TAU);
      g.fill();
    }
  };

  // 9. 月光
  VFX.moon = function (g, f, k) {
    const r = f.r || 160;
    const a = fadeOut(k, 0.65) * Math.min(1, k / 0.12);
    g.globalAlpha = a;
    const top = f.y - 620;
    const pw = r * 0.55;
    const grd = g.createLinearGradient(f.x - pw, 0, f.x + pw, 0);
    grd.addColorStop(0, 'rgba(200,225,255,0)');
    grd.addColorStop(0.5, 'rgba(235,245,255,0.75)');
    grd.addColorStop(1, 'rgba(200,225,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(f.x - pw * 0.4, top);
    g.lineTo(f.x + pw * 0.4, top);
    g.lineTo(f.x + pw, f.y);
    g.lineTo(f.x - pw, f.y);
    g.closePath();
    g.fill();
    // 月牙
    const my = f.y - 300;
    g.shadowColor = '#d8ecff';
    g.shadowBlur = 30;
    g.fillStyle = '#f4f8ff';
    g.beginPath();
    g.arc(f.x, my, 42, 0, TAU);
    g.fill();
    g.shadowBlur = 0;
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(f.x + 18, my - 10, 38, 0, TAU);
    g.fill();
    g.globalCompositeOperation = 'source-over';
    // 冰圈与霜花
    g.save();
    g.translate(f.x, f.y);
    g.scale(1, 0.5);
    const ice = g.createRadialGradient(0, 0, 10, 0, 0, r * ease(k * 2));
    ice.addColorStop(0, 'rgba(220,240,255,0.7)');
    ice.addColorStop(1, 'rgba(160,200,255,0)');
    g.fillStyle = ice;
    g.beginPath();
    g.arc(0, 0, r * ease(k * 2), 0, TAU);
    g.fill();
    g.restore();
    const rnd = seed(f, 19);
    for (let i = 0; i < 14; i++) {
      const ang = rnd() * TAU, d = rnd() * r;
      JQ.text(g, '❄', f.x + Math.cos(ang) * d, f.y + Math.sin(ang) * d * 0.5 - k * 20, 10 + rnd() * 8, '#ffffff', { font: 'sans-serif' });
    }
  };

  // 10. 箭雨
  VFX.arrowRain = function (g, f, k) {
    const r = f.r || 140, col = f.color || '#ffb030';
    const rnd = seed(f, 23);
    g.globalAlpha = 0.35 * fadeOut(k, 0.8);
    g.save();
    g.translate(f.x, f.y);
    g.scale(1, 0.5);
    g.fillStyle = A('#b02010', 0.3);
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.fill();
    g.restore();
    for (let i = 0; i < 36; i++) {
      const t0 = rnd() * 0.7;
      const ang = rnd() * TAU, d = Math.sqrt(rnd()) * r;
      const tx = f.x + Math.cos(ang) * d, ty = f.y + Math.sin(ang) * d * 0.5;
      const p = (k - t0) / 0.12;
      if (p < 0) continue;
      if (p < 1) {
        g.globalAlpha = 1;
        const x = tx + 60 * (1 - p), y = ty - 260 * (1 - p);
        g.strokeStyle = '#3a2410';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 10, y - 40);
        g.stroke();
        g.fillStyle = col;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x - 3, y - 8);
        g.lineTo(x + 4, y - 7);
        g.fill();
      } else {
        const e = clamp((k - t0 - 0.12) / 0.3);
        g.globalAlpha = 1 - e;
        g.strokeStyle = '#3a2410';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(tx, ty);
        g.lineTo(tx + 5, ty - 18);
        g.stroke();
        g.fillStyle = 'rgba(150,120,80,0.6)';
        g.beginPath();
        g.ellipse(tx, ty, 6 + e * 8, 2 + e * 3, 0, 0, TAU);
        g.fill();
      }
    }
  };

  // 11. 鼓舞
  VFX.warcry = function (g, f, k) {
    const x = f.follow ? f.follow.x : f.x, y = f.follow ? f.follow.y : f.y;
    const r = Math.min(f.r || 200, 260), col = f.color || '#ffd23f';
    for (let i = 0; i < 3; i++) {
      const e = clamp(k * 1.4 - i * 0.18);
      if (e <= 0 || e >= 1) continue;
      groundRing(g, x, y, r * ease(e), col, 6 * (1 - e) + 1, 1 - e);
    }
    // 两面旗
    g.globalAlpha = fadeOut(k, 0.6);
    for (const s of [-1, 1]) {
      const bx = x + s * 42, by = y - 30;
      g.strokeStyle = '#5a3a10';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(bx, by + 30);
      g.lineTo(bx, by - 40);
      g.stroke();
      g.fillStyle = col;
      g.beginPath();
      g.moveTo(bx, by - 40);
      for (let j = 0; j <= 6; j++) g.lineTo(bx + s * (j * 5), by - 40 + Math.sin(k * 20 + j) * 3);
      for (let j = 6; j >= 0; j--) g.lineTo(bx + s * (j * 5), by - 18 + Math.sin(k * 20 + j) * 3);
      g.fill();
    }
    if (f.text) {
      const e = ease(clamp(k / 0.5));
      g.globalAlpha = fadeOut(k, 0.6);
      g.translate(x, y - 50 - e * 50);
      const s = 0.6 + e * 0.5;
      g.scale(s, s);
      JQ.text(g, f.text, 0, 0, 36, '#fff6d8', { stroke: col, strokeW: 7 });
    }
  };

  // 12. 风火轮
  VFX.wheels = function (g, f, k, game) {
    const x = f.follow ? f.follow.x : f.x, y = f.follow ? f.follow.y : f.y;
    const t = (game && game.time) || 0;
    const R = f.r || 70, col = f.color || '#ff4060';
    g.globalAlpha = fadeOut(k, 0.85) * Math.min(1, k / 0.1);
    for (let w = 0; w < 2; w++) {
      const ang = t * 7 + w * Math.PI;
      const cx = x + Math.cos(ang) * R, cy = y + Math.sin(ang) * R * 0.45;
      // 尾焰
      for (let i = 1; i <= 5; i++) {
        const a2 = ang - i * 0.18;
        glowDot(g, x + Math.cos(a2) * R, y + Math.sin(a2) * R * 0.45, 16 - i * 2, A('#ff7020', 0.6), '#ffd060');
      }
      g.save();
      g.translate(cx, cy);
      g.scale(1, 0.6);
      g.rotate(t * 20);
      g.shadowColor = '#ff6020';
      g.shadowBlur = 12;
      g.strokeStyle = '#ffd040';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(0, 0, 16, 0, TAU);
      g.stroke();
      g.strokeStyle = col;
      g.lineWidth = 2;
      for (let s = 0; s < 6; s++) {
        g.beginPath();
        g.moveTo(0, 0);
        g.lineTo(Math.cos((s * TAU) / 6) * 16, Math.sin((s * TAU) / 6) * 16);
        g.stroke();
      }
      g.fillStyle = '#ff7020';
      for (let s = 0; s < 8; s++) {
        const a3 = (s * TAU) / 8;
        g.beginPath();
        g.moveTo(Math.cos(a3) * 16, Math.sin(a3) * 16);
        g.lineTo(Math.cos(a3 + 0.25) * 26, Math.sin(a3 + 0.25) * 26);
        g.lineTo(Math.cos(a3 + 0.4) * 16, Math.sin(a3 + 0.4) * 16);
        g.fill();
      }
      g.restore();
    }
  };

  // 13. 天眼神光
  VFX.eye = function (g, f, k) {
    const ex = f.x, ey = f.y - 40;
    const col = f.color || '#40c0c0';
    const open = ease(clamp(k / 0.22));
    const a = fadeOut(k, 0.7);
    g.globalAlpha = a;
    // 竖眼
    g.fillStyle = '#fff6e0';
    g.strokeStyle = '#7a1010';
    g.lineWidth = 2;
    g.beginPath();
    g.ellipse(ex, ey, 6 * open + 1, 16, 0, 0, TAU);
    g.fill();
    g.stroke();
    g.fillStyle = '#d02010';
    g.beginPath();
    g.arc(ex, ey, 4 * open, 0, TAU);
    g.fill();
    if (k < 0.22) return;
    const e = (k - 0.22) / 0.78;
    const w = (f.width || 40) * (1 - e * 0.7);
    g.lineCap = 'round';
    g.shadowColor = col;
    g.shadowBlur = 24;
    g.strokeStyle = A(col, 0.8);
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(ex, ey);
    g.lineTo(f.x2, f.y2);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.lineWidth = w * 0.35;
    g.stroke();
    glowDot(g, f.x2, f.y2, w * 1.4, A(col, 0.7));
  };

  // 14. 浪潮
  VFX.wave = function (g, f, k, game) {
    const col = f.color || '#3080ff';
    const dx = f.x2 - f.x, dy = f.y2 - f.y, L = Math.hypot(dx, dy) || 1;
    const p = ease(clamp(k * 1.25));
    const w = f.width || 60;
    const t = (game && game.time) || 0;
    g.globalAlpha = fadeOut(k, 0.65);
    g.translate(f.x, f.y);
    g.rotate(Math.atan2(dy, dx));
    const front = L * p;
    const grd = g.createLinearGradient(0, 0, front, 0);
    grd.addColorStop(0, A(col, 0));
    grd.addColorStop(0.6, A(col, 0.55));
    grd.addColorStop(1, 'rgba(220,240,255,0.9)');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, -w * 0.3);
    for (let i = 0; i <= 10; i++) g.lineTo((front * i) / 10, -w / 2 + Math.sin(t * 10 + i) * 4);
    g.lineTo(front + 14, 0);
    for (let i = 10; i >= 0; i--) g.lineTo((front * i) / 10, w / 2 + Math.sin(t * 10 + i * 1.3) * 4);
    g.lineTo(0, w * 0.3);
    g.closePath();
    g.fill();
    // 浪尖白沫
    const rnd = seed(f, 29);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (let i = 0; i < 12; i++) {
      const yy = (rnd() - 0.5) * w;
      g.beginPath();
      g.arc(front - rnd() * 18, yy, 3 + rnd() * 4, 0, TAU);
      g.fill();
    }
    g.fillStyle = 'rgba(200,230,255,0.8)';
    for (let i = 0; i < 10; i++) {
      const xx = front * rnd(), yy = (rnd() - 0.5) * w * 1.4 - k * 20;
      g.fillRect(xx, yy, 3, 3);
    }
  };

  // 15. 冰刺
  VFX.ice = function (g, f, k) {
    const r = f.r || 60;
    const grow = ease(clamp(k / 0.2));
    const a = fadeOut(k, 0.6);
    g.globalAlpha = a * 0.5;
    glowDot(g, f.x, f.y, r * 1.2, 'rgba(180,220,255,0.5)', 'rgba(240,250,255,0.8)');
    g.globalAlpha = a;
    const rnd = seed(f, 31);
    const n = 9;
    const spikes = [];
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * TAU + rnd() * 0.3, d = r * (0.3 + rnd() * 0.6);
      spikes.push([f.x + Math.cos(ang) * d, f.y + Math.sin(ang) * d * 0.5, (18 + rnd() * 26) * grow, 5 + rnd() * 4]);
    }
    spikes.sort((p, q) => p[1] - q[1]);
    for (const [x, y, h, w] of spikes) {
      const grd = g.createLinearGradient(x - w, y, x + w, y - h);
      grd.addColorStop(0, '#9ccfff');
      grd.addColorStop(0.5, '#ffffff');
      grd.addColorStop(1, '#bfe4ff');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(x - w, y);
      g.lineTo(x + (rnd() - 0.5) * 4, y - h);
      g.lineTo(x + w, y);
      g.closePath();
      g.fill();
      g.strokeStyle = 'rgba(80,140,200,0.6)';
      g.lineWidth = 1;
      g.stroke();
    }
  };

  // 16. 灼烧小火苗
  VFX.burn = function (g, f, k, game) {
    const t = (game && game.time) || 0;
    g.globalAlpha = 1 - k;
    for (let i = 0; i < 3; i++) {
      const x = f.x + (i - 1) * 7, y = f.y - k * 10;
      const h = 12 + Math.sin(t * 25 + i * 2) * 3;
      g.fillStyle = i === 1 ? '#ffd040' : '#ff6a20';
      g.beginPath();
      g.moveTo(x - 4, y);
      g.quadraticCurveTo(x - 3, y - h * 0.7, x, y - h);
      g.quadraticCurveTo(x + 3, y - h * 0.7, x + 4, y);
      g.closePath();
      g.fill();
    }
  };

  // 17. 治疗
  VFX.heal = function (g, f, k) {
    const rnd = seed(f, 37);
    g.globalAlpha = 1 - k;
    for (let i = 0; i < 3; i++) {
      const x = f.x + (rnd() - 0.5) * 24, y = f.y - 10 - k * 36 - i * 8;
      const s = 4 + rnd() * 2;
      g.fillStyle = '#6fff7a';
      g.fillRect(x - s, y - s / 3, s * 2, (s * 2) / 3);
      g.fillRect(x - s / 3, y - s, (s * 2) / 3, s * 2);
    }
  };

  // 18. 召唤法阵
  VFX.portal = function (g, f, k, game) {
    const r = f.r || 70, col = f.color || '#ffd23f';
    const t = (game && game.time) || 0;
    const a = Math.min(1, k / 0.15) * fadeOut(k, 0.6);
    g.globalAlpha = a;
    const grd = g.createLinearGradient(0, f.y - 160, 0, f.y);
    grd.addColorStop(0, A(col, 0));
    grd.addColorStop(1, A(col, 0.45));
    g.fillStyle = grd;
    g.fillRect(f.x - r * 0.7, f.y - 160, r * 1.4, 160);
    g.translate(f.x, f.y);
    g.scale(1, 0.5);
    g.rotate(t * 2);
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(0, 0, r, 0, TAU);
    g.stroke();
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, 0, r * 0.78, 0, TAU);
    g.stroke();
    g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const ang = (i * 2 * TAU) / 5;
      g.lineTo(Math.cos(ang) * r * 0.75, Math.sin(ang) * r * 0.75);
    }
    g.stroke();
    for (let i = 0; i < 12; i++) {
      const ang = (i * TAU) / 12;
      g.beginPath();
      g.moveTo(Math.cos(ang) * r * 0.82, Math.sin(ang) * r * 0.82);
      g.lineTo(Math.cos(ang) * r * 0.96, Math.sin(ang) * r * 0.96);
      g.stroke();
    }
  };

  // ---------- 天命事件 ----------
  // 天降甘霖：金色雨点 + 铜钱从天而降，落在 f.x,f.y 一带（宽 f.w）
  VFX.evRain = function (g, f, k) {
    const rnd = seed(f, 3), a = fadeOut(k, 0.7);
    for (let i = 0; i < 46; i++) {
      const x0 = f.x + (rnd() - 0.5) * (f.w || 600), d = rnd(), sp = 0.6 + rnd() * 0.6;
      const y = f.y - 420 + ((k * sp * 1.6 + d) % 1) * 460;
      g.globalAlpha = a * 0.85;
      if (i % 5 === 0) {
        g.fillStyle = '#f0c040';
        g.beginPath();
        g.arc(x0, y, 6, 0, TAU);
        g.fill();
        g.fillStyle = '#7a5010';
        g.fillRect(x0 - 2, y - 2, 4, 4);
      } else {
        g.strokeStyle = 'rgba(255,225,140,0.9)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(x0, y);
        g.lineTo(x0 - 3, y + 16);
        g.stroke();
      }
    }
  };
  // 神兵天降：金色光柱落地 + 地面光环
  VFX.evPillar = function (g, f, k) {
    const a = fadeOut(k, 0.55), drop = ease(Math.min(1, k * 3));
    const top = f.y - 520 * drop;
    const grd = g.createLinearGradient(0, top, 0, f.y);
    grd.addColorStop(0, A('#fff3c0', 0));
    grd.addColorStop(1, A('#ffd23f', 0.75 * a));
    g.fillStyle = grd;
    const w = 46 * (1 - k * 0.5);
    g.fillRect(f.x - w / 2, top, w, f.y - top);
    glowDot(g, f.x, f.y, 70 * (0.6 + k), '#ffd23f', '#fffbe0');
    groundRing(g, f.x, f.y, 40 + 140 * ease(k), '#ffd23f', 6 * (1 - k) + 1, a);
  };
  // 瘟疫横行：绿色毒雾从中线往两边漫开
  VFX.evFog = function (g, f, k) {
    const rnd = seed(f, 5), a = Math.sin(Math.min(1, k) * Math.PI) * 0.55;
    for (let i = 0; i < 18; i++) {
      const x = rnd() * 720, y0 = f.y + (rnd() - 0.5) * 520, r = 60 + rnd() * 90;
      const y = y0 + (rnd() - 0.5) * 80 * k;
      g.globalAlpha = a;
      glowDot(g, x, y, r * (0.6 + 0.6 * k), '#5f8a2a', '#9fd04a');
    }
  };
  // 杀气冲天：中心爆出血色冲击波
  VFX.evRage = function (g, f, k) {
    const a = fadeOut(k, 0.3);
    groundRing(g, f.x, f.y, 60 + 520 * ease(k), '#ff3a20', 14 * (1 - k) + 2, a);
    groundRing(g, f.x, f.y, 30 + 360 * ease(k), '#ffb040', 6 * (1 - k) + 1, a);
    g.globalAlpha = a * 0.5;
    glowDot(g, f.x, f.y, 160 * (1 - k * 0.5), '#ff3a20', '#ffd0a0');
  };
  // 天雷：整场一闪白
  VFX.evFlash = function (g, f, k) {
    g.globalAlpha = (1 - k) * 0.35;
    g.fillStyle = '#e8f4ff';
    g.fillRect(-400, -400, 1520, 2080);
  };

  JQ.VFX = VFX;

  // ---------- 飞行道具 ----------
  const VFXP = {};
  const angOf = (p) => (p.ang != null ? p.ang : p.target ? Math.atan2(p.target.y - p.y, p.target.x - p.x) : 0);

  VFXP.fireball = function (g, p) {
    const a = angOf(p);
    for (let i = 6; i >= 1; i--) {
      g.globalAlpha = 0.55 - i * 0.07;
      glowDot(g, p.x - Math.cos(a) * i * 6, p.y - Math.sin(a) * i * 6, 11 - i, '#ff6a20', '#ffd060');
    }
    g.globalAlpha = 1;
    glowDot(g, p.x, p.y, 12, '#ff8a30', '#ffffff');
  };

  VFXP.ring = function (g, p, time) {
    g.translate(p.x, p.y);
    g.rotate(time * 18);
    g.shadowColor = '#ffd040';
    g.shadowBlur = 12;
    g.strokeStyle = '#ffd040';
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(0, 0, 12, 7, 0, 0, TAU);
    g.stroke();
    g.shadowBlur = 0;
    g.strokeStyle = '#fff6c0';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(0, 0, 12, 7, 0, -0.6, 0.6);
    g.stroke();
  };

  VFXP.water = function (g, p) {
    const a = angOf(p);
    for (let i = 4; i >= 1; i--) {
      g.globalAlpha = 0.5 - i * 0.1;
      g.fillStyle = '#9ad0ff';
      g.beginPath();
      g.arc(p.x - Math.cos(a) * i * 7, p.y - Math.sin(a) * i * 7, 5 - i * 0.8, 0, TAU);
      g.fill();
    }
    g.globalAlpha = 1;
    g.translate(p.x, p.y);
    g.rotate(a);
    const grd = g.createLinearGradient(-8, 0, 8, 0);
    grd.addColorStop(0, '#4a90ff');
    grd.addColorStop(1, '#e8f6ff');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(10, 0);
    g.quadraticCurveTo(0, -7, -8, 0);
    g.quadraticCurveTo(0, 7, 10, 0);
    g.fill();
  };

  VFXP.moonshard = function (g, p, time) {
    const a = angOf(p);
    glowDot(g, p.x, p.y, 14, 'rgba(190,220,255,0.6)', '#ffffff');
    g.translate(p.x, p.y);
    g.rotate(a + Math.sin(time * 20) * 0.2);
    g.fillStyle = '#eaf4ff';
    g.strokeStyle = '#8ab8f0';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(12, 0);
    g.lineTo(0, -5);
    g.lineTo(-8, 0);
    g.lineTo(0, 5);
    g.closePath();
    g.fill();
    g.stroke();
  };

  JQ.VFXP = VFXP;
})();
