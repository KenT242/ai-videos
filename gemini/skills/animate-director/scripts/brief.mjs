#!/usr/bin/env node
// Write agy's brief for one era (or all) from director/eras.json.
//   usage: node brief.mjs <piece dir> [era n ...]     -> director/briefs/eNN.md
// The brief is self-contained: agy starts cold, so it gets the paths, the era's timing, the director's motion table,
// the kit's names and semantics, the rules and a tool-call budget. Edit eras.json, not the generated brief.
import fs from 'node:fs';
import path from 'node:path';
import { piecePaths, loadEras, ANIMATE, DIRECTOR, tag } from './lib.mjs';

const [dir, ...ns] = process.argv.slice(2);
if (!dir) { console.error('usage: node brief.mjs <piece dir> [era n ...]'); process.exit(2); }
const P = piecePaths(dir);
const { cfg, meta, era } = loadEras(P);
const fps = meta.format?.fps || 24;

// a style's folder: beside/above the piece first, then the skill (same rule as build.mjs)
function styleDir(name) {
  for (let d = P.ROOT; ; d = path.dirname(d)) {
    const c = path.join(d, 'styles', name);
    if (fs.existsSync(path.join(c, 'kit.js'))) return c;
    if (path.dirname(d) === d) break;
  }
  return path.join(ANIMATE, 'styles', name);
}
const STYLE_DIR = styleDir(meta.style || 'cut-paper');
const topNames = (file) => fs.existsSync(file)
  ? [...fs.readFileSync(file, 'utf8').matchAll(/^(?:async\s+)?(?:function\*?\s+|const\s+|let\s+)([A-Za-z_$][\w$]*)/gm)].map((m) => m[1])
  : [];
const owned = new Set(cfg.eras.map((x) => x.file));
const shared = (meta.scenes || []).filter((f) => !owned.has(f)).map((f) => path.join(P.ROOT, f));
const API = [
  ['kit/core.js', topNames(path.join(ANIMATE, 'kit/core.js'))],
  [`style ${meta.style || 'cut-paper'} (kit.js)`, topNames(path.join(STYLE_DIR, 'kit.js'))],
  ...shared.map((f) => [path.relative(P.ROOT, f) + ' (shared)', topNames(f)]),
];

function brief(e) {
  const fn = e.fn || e.prefix, T = tag(e.n);
  const others = cfg.eras.filter((x) => x.n !== e.n).map((x) => x.file).join(', ');
  const motion = e.motion.map(([t, what]) => `| ${t} | ${what} |`).join('\n');
  const cues = e.cues && Object.keys(e.cues).length ? Object.entries(e.cues).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ') : '(none)';
  return `# Animate era ${e.n} of "${meta.title || meta.name}" (${T})

You animate ONE era of a procedural canvas video. The director (another agent) has already drawn this era's approved key frame(s) in your file; your job is to add the motion in the table below so the era plays as timed. Work fast: few, large steps.

## Your file — the only file you may edit
\`${path.join(P.ROOT, e.file)}\`
It defines \`function ${fn}()\`, called by the renderer every frame while TT is in [${e.t0}, ${e.t1}). Other agents are editing ${others || 'nothing else'} at the same time: never touch them, nor src/head.html, src/bridges.js, src/score.js, piece.json, the kit or the style.

## Timing
- Era: ${e.t0}s – ${e.t1}s (frames ${Math.round(e.t0 * fps)}–${Math.round(e.t1 * fps) - 1} at ${fps} fps).
- Approved key frame(s) at t = ${e.panels.join(', ')}s. **At those times the frame must still look like the approved panel** (the check measures SSIM ≥ ${cfg.ssimMin ?? 0.97}): motion happens before/after, and anything that moves *through* a panel time stays where the panel shows it.
- Cues (absolute seconds): ${cues}
- Bridge in: ${e.bridgeIn || 'none (hard cut or first era)'}
- Bridge out: ${e.bridgeOut || 'none (hard cut or last era)'}

## Motion table (the director's decisions — implement exactly, don't invent beats)
| t (s, absolute) | what happens |
|---|---|
${motion}
${e.life ? `\nIdle life (always on, small): ${e.life}\n` : ''}${e.notes ? `\nNotes: ${e.notes}\n` : ''}
## How time works (the kit)
- \`TT\` = current time in seconds (steps on 2s: \`TT = B*2/FPS\`). \`B\` = boil index. Everything is a pure function of TT: same TT → same pixels.
- \`ev(t, d=0.25)\` → 0..1 progress of an action starting at t lasting d. \`popS(t)\` → back-eased pop-in scale (0 before t). \`EZ.o3(u)\`, \`EZ.io(u)\`, \`EZ.back(u)\` easings. \`lerp(a,b,u)\`, \`clamp\`, \`seg(t,a,b)\`, \`past(t, c)\`.
- \`springMove(t0, a, b, SPRING.snappy|smooth|heavy|playful)\` for anything with mass; \`springTrack([[t, v], ...])\` for many targets.
- Write-ons: \`handText(..., { frac: ev(t, d) })\`, \`ink(P, { frac })\`, \`monoText(..., { count })\` where the style has them.
- Randomness only via \`RNG('key')\` (seeded). Idle wobble: \`Math.sin(TT * k)\`.
- Names available (read the files for signatures only if you need them):
${API.map(([k, v]) => `  - ${k}: ${v.join(', ')}`).join('\n')}
- Style rules: \`${path.join(STYLE_DIR, 'STYLE.md')}\` (read its motion section; skim the rest).

## Rules (the check fails on these)
- Every new top-level name starts with \`${e.prefix}\` (e.g. \`${e.prefix}Pen\`, \`${e.prefix}_wave\`). Prefer locals inside \`${fn}\`.
- No Math.random, Date, performance.now, timers, fetch, URLs, data: URIs, storage, eval.
- No new files. Don't run export.mjs or review.mjs. Don't chase visual polish beyond the table.

## Steps (budget: ~10 tool calls; you have about ${Math.round(parseInt(e.timeout || cfg.timeout || 900) / 60)} minutes)
1. Read your file (and STYLE.md's motion notes).
2. Rewrite your file in ONE write with all the motion.
3. Run: \`node ${path.join(DIRECTOR, 'scripts/check.mjs')} ${P.ROOT} ${e.n}\`
4. If it fails, fix and re-run at most twice. If it still fails, stop and report why.
5. Reply with: PASS/FAIL, the SSIM numbers, what you implemented per table row, and anything you could not do.
`;
}

fs.mkdirSync(P.BRIEFS, { recursive: true });
const list = ns.length ? ns.map((n) => era(n) || (console.error(`no era ${n}`), process.exit(2))) : cfg.eras;
for (const e of list) {
  const f = path.join(P.BRIEFS, `${tag(e.n)}.md`);
  fs.writeFileSync(f, brief(e));
  console.log('brief', path.relative(process.cwd(), f) || f);
}
