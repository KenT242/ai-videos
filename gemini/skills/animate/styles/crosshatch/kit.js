// =====================================================================
//  styles/crosshatch/kit.js — sketchy ink on warm paper. The drawing primitives live in kit/core.js
//  (ink, paint with hatch / cross / pencil / stipple textures, wobble on the boil, grain, monoText, handwrite,
//  drawPencil, irisHole, hexGrid, construct); this file adds the look's surfaces, props, hero, captions and STYLE.
//  Needs from the piece head: HAND (font stack), CX (caption centre x).
//  Shade with density functions (dens(x, y) -> 0..1), never flat fills; world-anchor textures when the camera pans.
// =====================================================================
const HANDF = HAND;
function handText(str, x, y, size, color, o = {}) {
  ctx.save();
  const R = RNG('ht', o.key ?? str, B);
  ctx.translate(x + R.n(0.7), y + R.n(0.7)); ctx.rotate((o.rot ?? 0) + R.n(0.006));
  ctx.font = `${o.weight ?? 400} ${size}px ${HANDF}`; ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
  const w = ctx.measureText(str).width, frac = clamp(o.frac ?? 1);
  if (frac <= 0) { ctx.restore(); return w; }
  if (frac < 1) { ctx.beginPath(); ctx.rect(-4, -size * 1.2, w * frac + 4, size * 1.7); ctx.clip(); }
  ctx.globalAlpha = o.al ?? 1; ctx.fillText(str, 0, 0);
  ctx.restore();
  return w;
}
function handW(str, size, weight = 400) { ctx.save(); ctx.font = `${weight} ${size}px ${HANDF}`; const w = ctx.measureText(str).width; ctx.restore(); return w; }
const box = (x, y, w, h) => resample([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, 30);   // dense, so trace() keeps the corners

// ---- surfaces: a full-bleed world in ink (paper, wood, cloth, the dark "inside the machine")
function paperSheet(key = 'sheet', o = {}) {   // warm paper with faint ruled lines
  paint(box(-40, -40, W + 80, H + 80), { raw: true, line: false, fill: o.fill || C.paper, key: key + 'b', tex: [{ k: 'pencil', c: '#fffaf0', al: 0.45, per: 700, a: -0.6 }] });
  if (o.ruled !== false) { ctx.save(); ctx.strokeStyle = C.paperLine; ctx.lineWidth = 1.4; ctx.beginPath(); for (let y = 260; y < H; y += 64) { ctx.moveTo(0, y); ctx.lineTo(W, y + RNG('rl', key, y).n(2)); } ctx.stroke(); ctx.restore(); }
}
function woodSurface(x0, y0, x1, y1, key, o = {}) {
  const S = RNG('woodS', key), R = RNG('woodR', key, B);
  paint(box(x0, y0, x1 - x0, y1 - y0), {
    raw: true, line: false, fill: o.fill || C.wood, key,
    tex: [{ k: 'pencil', c: C.woodL, al: 0.32, a: 0.02, len: 46, per: 900 }, { k: 'pencil', c: C.woodD, al: 0.16, a: -0.03, len: 30, per: 1400 }],
  });
  ctx.beginPath();
  for (let y = y0; y < y1; y += S.r(11, 24)) {
    const f = S.r(0.002, 0.006), ph = S.r(0, TAU), A = S.r(1, 5);
    let down = S.f() < 0.8, left = S.r(40, 420);
    for (let x = x0; x <= x1; x += 22) {
      const yy = y + Math.sin(x * f + ph) * A + R.n(0.5);
      if (down) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
      left -= 22;
      if (left <= 0) { down = !down; left = down ? S.r(60, 480) : S.r(10, 70); if (down) ctx.moveTo(x, yy); }
    }
  }
  ctx.strokeStyle = C.ink; ctx.lineWidth = o.gw ?? 1.3; ctx.globalAlpha = o.gal ?? 0.42; ctx.stroke(); ctx.globalAlpha = 1;
}
function darkWorld(key, o = {}) {   // navy, dust specks and tiny crosses: inside the computer
  fillAll(o.fill || C.navy);
  const R = RNG('dust', key), J = RNG('dustj', key, B);
  ctx.save(); screen();
  ctx.fillStyle = 'rgba(150,160,220,0.28)'; ctx.beginPath();
  for (let i = 0; i < (o.dust ?? 260); i++) ctx.rect(R.r(0, W) + J.n(0.6), R.r(0, H) + J.n(0.6), R.r(1, 2.4), R.r(1, 2.4));
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,44,90,0.5)'; ctx.lineWidth = 1; ctx.beginPath();
  for (let i = 0; i < 70; i++) { const x = R.r(0, W), y = R.r(0, H); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); }
  ctx.stroke(); ctx.restore();
}
function stripedCloth(key, o = {}) {
  paint(box(-600, -600, 2300, 2300 + H), { raw: true, line: false, fill: o.base || C.cream, key: key + 'b', tex: [{ k: 'pencil', c: '#fffaf0', al: 0.5, per: 500, a: -0.8 }] });
  for (let k = -12; k < 12; k++) {
    const x = k * 190, P = [[x, -600], [x + 95, -600], [x + 95 + 2300, 1700 + H], [x + 2300, 1700 + H]];
    paint(P, { raw: true, line: false, fill: o.stripe || 'rgba(240,205,120,0.45)', key: key + 's' + k, tex: [{ k: 'hatch', a: Math.atan2(2300, 2300), gap: 4, c: o.hatchC || '#d9a441', al: 0.35, w: 1, dash: [30, 140] }] });
  }
}

// ---- props
function inkMug(x, y, r, key = 'mug', o = {}) {   // a mug seen from above; the coffee is a good bridge object
  paint(ellipsePts(x + 16, y + 20, r, r, 0, 40), { fill: 'rgba(92,55,28,0.25)', line: false, key: key + 'sh', tex: [{ k: 'hatch', a: 0.8, gap: 5, al: 0.4 }] });
  paint(rrectPts(x + r * 0.7, y - 20, r * 0.75, 40, 18), { fill: '#f2ede2', key: key + 'h', w: 3 });
  paint(ellipsePts(x, y, r, r, 0, 44), { fill: '#f2ede2', key: key + 'b', w: 3.2, tex: [{ k: 'pencil', c: '#d9cdb8', al: 0.6, per: 60 }, { k: 'hatch', gap: 4, a: 0.7, al: 0.3, dash: [8, 24], dens: (px, py) => clamp((px - x + py - y) / r) }] });
  ink(ellipsePts(x, y, r * 0.84, r * 0.84, 0, 40), { closed: true, w: 2, key: key + 'rim' });
  paint(ellipsePts(x, y, r * 0.78, r * 0.78, 0, 40), { fill: '#6e4128', key: key + 'c', w: 1.6, tex: [{ k: 'cross', c: '#2e170b', al: 0.35, gap: 5 }] });
  if (o.steam !== false) for (let i = 0; i < 3; i++) { const P = []; for (let k = 0; k <= 10; k++) P.push([x - 30 + i * 30 + Math.sin(k * 0.8 + TT * 3 + i) * 10, y - r - 20 - k * 14]); ink(P, { w: 2.4, color: 'rgba(58,36,23,0.45)', key: key + 'st' + i }); }
}
function toolPill(label, arg, x, y, t, o = {}) {   // a hand-painted tool-call tag: Read(notes.md). Keep them true.
  const size = o.size ?? 30, cw = monoW(size), text = label + '(' + arg + ')';
  const w = 70 + cw * text.length, h = size * 1.75, pop = EZ.back(seg(TT, t, t + 0.12));
  if (pop <= 0) return;
  ctx.save(); ctx.translate(x, y); ctx.scale(pop, pop); ctx.rotate(o.rot ?? -0.02);
  paint(rrectPts(4, 6, w, h, 14), { fill: 'rgba(58,36,23,0.35)', line: false, key: 'pillsh' + label });
  paint(rrectPts(0, 0, w, h, 14), { fill: C.paper, key: 'pill' + label, w: 3, tex: [{ k: 'pencil', c: '#e8d6b0', al: 0.6, per: 90 }] });
  ctx.beginPath(); ctx.arc(30, h / 2, 9, 0, TAU); ctx.fillStyle = o.dot || C.green; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = C.ink; ctx.stroke();
  monoText(label, 50, h / 2 + size * 0.36, size, C.ink, { key: 'pl' + label });
  monoText('(' + arg + ')', 50 + cw * label.length, h / 2 + size * 0.36, size, '#8a5a3a', { key: 'pa' + label, weight: 400 });
  ctx.restore();
}
function planInk(P, o = {}) {   // the plan: red pencil dashes, written on
  if ((o.frac ?? 1) <= 0) return;
  ctx.save(); ctx.setLineDash(o.dash ?? [16, 11]);
  ink(P, { closed: o.closed, color: o.c ?? 'rgba(212,56,44,0.92)', w: o.w ?? 3.4, amt: o.amt ?? 2.2, key: o.key ?? 'plan', frac: o.frac, alpha: o.al ?? 1 });
  ctx.restore();
}

// ---- the hero: the cat duo (black cat & white cat); alternates by context
//      (paper/desk = white cat, machine/dark navy = black cat, or explicit variant: 'white'|'black')
function catHeadPts(x, y, r, o = {}) {
  const tiltL = o.tiltL ?? 0, tiltR = o.tiltR ?? 0;
  const raw = [
    [x, y - 0.62 * r],                // forehead center
    [x + 0.22 * r, y - 0.64 * r],     // forehead right
    [x + 0.40 * r, y - (0.85 + tiltR) * r],     // ear inner slope right
    [x + 0.58 * r, y - (1.08 + tiltR) * r],     // ear tip right
    [x + 0.74 * r, y - (0.75 + tiltR * 0.5) * r], // ear outer slope right
    [x + 0.86 * r, y - 0.40 * r],     // ear base right
    [x + 0.98 * r, y - 0.05 * r],     // cheek upper right
    [x + 1.02 * r, y + 0.25 * r],     // cheek apex right
    [x + 0.95 * r, y + 0.56 * r],     // cheek lower right
    [x + 0.75 * r, y + 0.82 * r],     // chin right
    [x + 0.45 * r, y + 0.95 * r],     // chin lower right
    [x, y + 0.98 * r],                // chin bottom
    [x - 0.45 * r, y + 0.95 * r],     // chin lower left
    [x - 0.75 * r, y + 0.82 * r],     // chin left
    [x - 0.95 * r, y + 0.56 * r],     // cheek lower left
    [x - 1.02 * r, y + 0.25 * r],     // cheek apex left
    [x - 0.98 * r, y - 0.05 * r],     // cheek upper left
    [x - 0.86 * r, y - 0.40 * r],     // ear base left
    [x - 0.74 * r, y - (0.75 + tiltL * 0.5) * r], // ear outer slope left
    [x - 0.58 * r, y - (1.08 + tiltL) * r],     // ear tip left
    [x - 0.40 * r, y - (0.85 + tiltL) * r],     // ear inner slope left
    [x - 0.22 * r, y - 0.64 * r],     // forehead left
  ];
  return resample(raw, true, 8);
}

function catHero(x, y, r, o = {}) {
  const key = o.key ?? 'hero', dark = !!o.dark;
  const variant = o.variant ?? (dark ? 'black' : 'white');
  const mood = o.mood ?? 'normal';
  const rot = o.rot ?? (mood === 'thinking' ? 0.08 : (mood === 'curious' ? -0.06 : 0));

  y += Math.sin(TT * TAU * 0.9 + key.length) * r * 0.04;                  // idle bob
  SPARK_AT = toScreen(x, y);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.translate(-x, -y);

  if (!dark && o.shadow !== false) {
    paint(ellipsePts(x + r * 0.45, y + r * 0.85, r * 1.15, r * 0.65, 0, 24), {
      fill: 'rgba(58,36,23,0.3)', line: false, key: key + 'sh',
      tex: [{ k: 'hatch', a: 0.8, gap: 4, al: 0.6 }]
    });
  }

  const tiltL = mood === 'curious' ? 0.08 : 0;
  const tiltR = mood === 'thinking' ? 0.08 : 0;
  const P = catHeadPts(x, y, r, { tiltL, tiltR });

  const isBlink = o.blink === true || (o.blink == null && (B + key.length * 7) % 45 < 2);
  const isBlack = variant === 'black';

  if (isBlack) {
    if (dark) {
      ink(P, { closed: true, color: 'rgba(82,214,196,0.22)', w: r * 0.6, key: key + 'g' });
      ink(P, { closed: true, color: 'rgba(200,208,240,0.25)', w: 16, key: key + 'g2' });
    }
    paint(P, {
      fill: dark ? '#0f1124' : '#261c16', key,
      line: dark ? C.peri : C.ink, w: dark ? 4.5 : Math.max(3.2, r * 0.08),
      tex: [{ k: 'cross', c: dark ? '#1c1f40' : '#140e0a', al: 0.45, gap: 5 }]
    });
  } else {
    paint(P, {
      fill: C.cream, key,
      line: C.ink, w: Math.max(3.5, r * 0.085),
      tex: [{ k: 'pencil', c: '#e5d7be', al: 0.4, per: 60, dens: (px, py) => clamp((x - px + y - py) / (r * 1.5)) }]
    });
  }

  // Draw Eyes
  const ey = y + r * 0.11;
  const erx = r * (mood === 'wow' ? 0.16 : 0.135);
  const ery = r * (mood === 'wow' ? 0.28 : (mood === 'sleepy' ? 0.15 : 0.24));
  const eyeCol = isBlack ? '#fffaf0' : C.ink;
  const notchCol = isBlack ? (dark ? '#0f1124' : '#261c16') : '#fffaf0';

  for (const s of [-1, 1]) {
    const ex = x + s * r * 0.49;
    const eyeBlink = isBlink || (mood === 'wink' && s === 1);

    if (eyeBlink) {
      ink([[ex - erx * 1.1, ey], [ex + erx * 1.1, ey]], { w: r * 0.065, color: eyeCol, key: key + 'bl' + s, amt: 0.3 });
    } else if (mood === 'happy') {
      ink(arcPts(ex, ey + ery * 0.2, erx * 0.95, Math.PI * 1.1, Math.PI * 1.9, 10), {
        w: r * 0.07, color: eyeCol, key: key + 'hp' + s, amt: 0.3
      });
    } else {
      ctx.fillStyle = eyeCol;
      ctx.beginPath();
      ctx.ellipse(ex, ey, erx, ery, 0, 0, TAU);
      ctx.fill();

      // Notch or Pupil direction
      let lookAngle = 0;
      if (o.look) {
        lookAngle = Math.atan2(o.look[1] - ey, o.look[0] - ex);
      } else if (mood === 'thinking') {
        lookAngle = -Math.PI * 0.35; // looking up-right
      } else if (mood === 'curious') {
        lookAngle = -Math.PI * 0.75; // looking up-left
      }

      ctx.fillStyle = notchCol;
      ctx.beginPath();
      const nx = ex + Math.cos(lookAngle) * erx * 0.95;
      const ny = ey + Math.sin(lookAngle) * ery * 0.95;
      ctx.moveTo(nx, ny);
      ctx.lineTo(ex + Math.cos(lookAngle + 0.7) * erx * 0.2, ey + Math.sin(lookAngle + 0.7) * ery * 0.2);
      ctx.lineTo(ex + Math.cos(lookAngle - 0.7) * erx * 0.2, ey + Math.sin(lookAngle - 0.7) * ery * 0.2);
      ctx.closePath();
      ctx.fill();

      // Half-closed eyelids for sleepy / skeptical
      if (mood === 'sleepy') {
        ctx.fillStyle = isBlack ? (dark ? '#0f1124' : '#261c16') : C.cream;
        ctx.beginPath();
        ctx.rect(ex - erx * 1.2, ey - ery * 1.2, erx * 2.4, ery * 1.1);
        ctx.fill();
        ink([[ex - erx * 1.2, ey], [ex + erx * 1.2, ey]], { w: r * 0.06, color: eyeCol, key: key + 'slp' + s });
      }
    }
  }

  // Nose
  ctx.fillStyle = isBlack ? '#fffaf0' : C.ink;
  ctx.beginPath();
  ctx.ellipse(x, y + r * 0.46, r * 0.10, r * 0.068, 0, 0, TAU);
  ctx.fill();

  // Mouth by mood
  const mouthCol = isBlack ? '#fffaf0' : C.ink;
  if (mood === 'happy') {
    ink(arcPts(x, y + r * 0.58, r * 0.14, Math.PI * 0.12, Math.PI * 0.88, 10), { w: r * 0.055, color: mouthCol, key: key + 'm', amt: 0.35 });
  } else if (mood === 'wow') {
    paint(ellipsePts(x, y + r * 0.65, r * 0.07, r * 0.10, 0, 16), { fill: mouthCol, line: mouthCol, w: 2, key: key + 'mo' });
  } else if (mood === 'thinking' || mood === 'curious') {
    ink([[x - r * 0.06, y + r * 0.62], [x, y + r * 0.58], [x + r * 0.08, y + r * 0.61]], { w: r * 0.05, color: mouthCol, key: key + 'mw' });
  } else if (mood === 'sleepy') {
    ink([[x - r * 0.06, y + r * 0.60], [x + r * 0.06, y + r * 0.60]], { w: r * 0.05, color: mouthCol, key: key + 'ms' });
  }

  // Thinking / Curious question mark accent
  if (mood === 'thinking' || mood === 'curious') {
    ctx.save();
    ctx.font = 'bold ' + Math.round(r * 0.42) + 'px sans-serif';
    ctx.fillStyle = isBlack ? (dark ? C.peri : '#fffaf0') : C.ink;
    ctx.globalAlpha = 0.85;
    ctx.fillText('?', x + r * 0.85, y - r * 0.65);
    ctx.restore();
  }

  ctx.restore();
  return P;
}
const dotHero = catHero;   // backward compatibility alias

// ---- captions: a paper card with an ink outline, drawn after the camera (DEFER)
function inkCard(str, x, y, size, o = {}) {
  const w = handW(str, size) + size * 0.9, h = size * 1.45, s = o.s ?? 1; if (s <= 0.01) return;
  ctx.save(); ctx.translate(x, y); ctx.rotate(o.rot ?? -0.02); ctx.scale(s, s);
  paint(rrectPts(-w / 2 + 6, -h / 2 + 8, w, h, 10), { fill: 'rgba(58,36,23,0.3)', line: false, key: 'cardsh' + str, tex: [{ k: 'hatch', a: 0.8, gap: 4, al: 0.5 }] });
  paint(rrectPts(-w / 2, -h / 2, w, h, 10), { fill: C.paper, key: 'card' + str, w: 3, tex: [{ k: 'pencil', c: '#e8d6b0', al: 0.5, per: 90 }] });
  handText(str, -w / 2 + size * 0.45, size * 0.36, size, o.color ?? C.ink, { key: 'cardt' + str, frac: o.frac });
  ctx.restore();
}
const inkTag = (str) => { const f = () => inkCard(str, 70 + (handW(str, 80) + 72) / 2, 330, 80, { rot: -0.04, s: popS(E0 + 0.2) }); if (DEFER) DEFER.push(f); else f(); };
const inkCaption = (str) => { const f = () => inkCard(str, CX, 1440, 50, { rot: 0.012, frac: ev(E0 + 0.45, 0.6) }); if (DEFER) DEFER.push(f); else f(); };

// =====================================================================
//  STYLE — the renderer's hooks (see styles/cut-paper/kit.js for the contract)
// =====================================================================
const STYLE = {
  name: 'crosshatch',
  paper: C.paper,
  backdrop(c) { paint(box(-40, -40, W + 80, H + 80), { raw: true, line: false, fill: c, key: 'backdrop', tex: [{ k: 'pencil', c: '#fffaf0', al: 0.35, per: 700, a: -0.6 }] }); },
  window(P, key, src) {   // the world seen through an inked hole with a hatched shadow
    const Q = wobble(P, true, 2.5, key, 9);
    ctx.save(); ctx.translate(10, 14); trace(Q, true); ctx.clip(); hatch(bbox(Q, 20), { key: key + 'sh', a: 0.8, gap: 5, al: 0.45 }); ctx.restore();
    ctx.save(); trace(Q, true); ctx.clip(); ctx.drawImage(src, 0, 0); ctx.restore();
    ink(P, { closed: true, w: 4.5, key: key + 'rim', double: true });
  },
  blob(P, c, key) { paint(P, { fill: c, key, w: 4, tex: [{ k: 'hatch', a: 0.8, gap: 6, al: 0.35 }, { k: 'pencil', c: '#fff6e0', al: 0.3, per: 80 }] }); },
  hero(x, y, r, o) { catHero(x, y, r * 0.6, { ...o, key: o.key }); },
  heroColor: C.ink,
  heroPts: (x, y, r) => catHeadPts(x, y, r * 0.6),
  post() { grain({ n: 2600 }); },
};
