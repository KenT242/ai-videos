#!/usr/bin/env node
// Check one era after agy worked on it, against the locked storyboard.
//   usage: node check.mjs <piece dir> <era n> [--quiet]
// Builds a private stage (director/stage/eNN: the locked src/ with only this era's live file swapped in), so eras
// being written in parallel never break each other's build, then checks:
//   1. ownership   no file outside this era's own file changed since the lock (and no new files in src/)
//   2. rules       no Math.random / Date / timers / network / URLs in the era file; every top-level name starts with the prefix
//   3. build       the stage builds (syntax ok, no forbidden URLs)
//   4. panels      each approved panel re-rendered at its time: SSIM vs director/approved >= ssimMin (default 0.97)
//   5. tile        12 frames across the era render without page errors and deterministically
// Writes director/checks/eNN.json and director/stage/eNN/{tile.png, panel PNGs}. Exit 0 = PASS.
import fs from 'node:fs';
import path from 'node:path';
import { piecePaths, loadEras, pieceFiles, sha, tool, panelPng, ssim, tag, readJSON } from './lib.mjs';

const args = process.argv.slice(2);
const quiet = args.includes('--quiet');
const [dir, nArg] = args.filter((a) => !a.startsWith('--'));
if (!dir || !nArg) { console.error('usage: node check.mjs <piece dir> <era n>'); process.exit(2); }
const P = piecePaths(dir);
const { cfg, meta, era } = loadEras(P);
const e = era(nArg);
if (!e) { console.error(`no era ${nArg} in eras.json`); process.exit(2); }
if (!fs.existsSync(P.LOCK)) { console.error('no lock: run lock.mjs after the storyboard is approved'); process.exit(2); }
const lock = readJSON(P.LOCK);
const T = tag(e.n), fps = meta.format?.fps || 24, ssimMin = cfg.ssimMin ?? 0.9;
const res = { era: e.n, file: e.file, pass: true, ownership: [], rules: [], build: null, panels: [], tile: null, warnings: [] };
const fail = (k, msg) => { res.pass = false; res[k].push(msg); };

// 1. ownership
const owned = new Set(cfg.eras.map((x) => path.normalize(x.file)));
const now = pieceFiles(P.ROOT);
for (const [rel, h] of Object.entries(lock.files)) {
  if (owned.has(path.normalize(rel))) continue;
  if (!fs.existsSync(path.join(P.ROOT, rel))) fail('ownership', `deleted: ${rel}`);
  else if (sha(path.join(P.ROOT, rel)) !== h) fail('ownership', `changed (shared, director-owned): ${rel}`);
}
for (const rel of now) if (!(rel in lock.files) && rel.startsWith('src' + path.sep)) fail('ownership', `new file: ${rel}`);
const live = path.join(P.ROOT, e.file);
if (lock.files[e.file] && sha(live) === lock.files[e.file]) res.warnings.push(`${e.file} is unchanged since the lock`);

// 2. rules on the era file
const FORBID = [
  [/Math\.random/, 'Math.random (use RNG(...))'], [/\bDate\b|performance\.now/, 'wall-clock time (use TT)'],
  [/\bset(Timeout|Interval)\b|requestAnimationFrame/, 'timers (everything is a function of TT)'],
  [/\bfetch\s*\(|XMLHttpRequest|\bimport\s*\(/, 'network / dynamic import'], [/https?:\/\/|data:[a-z]+\//i, 'URL or data: URI'],
  [/localStorage|sessionStorage|\beval\s*\(|new Function/, 'storage / eval'],
];
const src = fs.readFileSync(live, 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/\/\/.*$/, ''));
code.forEach((l, i) => { for (const [re, why] of FORBID) if (re.test(l)) fail('rules', `line ${i + 1}: ${why}`); });
const names = [];
code.forEach((l, i) => {
  const m = l.match(/^(?:async\s+)?(?:function\*?\s+|const\s+|let\s+|var\s+|class\s+)([A-Za-z_$][\w$]*)/);
  if (m) { names.push(m[1]); if (!m[1].startsWith(e.prefix)) fail('rules', `line ${i + 1}: top-level "${m[1]}" lacks the prefix "${e.prefix}"`); }
  else if (/^(const|let|var)\s*[[{]/.test(l)) fail('rules', `line ${i + 1}: top-level destructuring (name each global with the prefix)`);
});
const fn = e.fn || e.prefix;
if (!names.includes(fn)) fail('rules', `the scene function "${fn}" is not defined at top level`);

// 3. stage build: locked src/ + this era's live file
const S = path.join(P.STAGE, T);
fs.rmSync(S, { recursive: true, force: true });
fs.mkdirSync(S, { recursive: true });
for (const n of fs.readdirSync(P.ROOT)) {
  const abs = path.join(P.ROOT, n);
  if (fs.statSync(abs).isFile() && n !== 'index.html') fs.copyFileSync(abs, path.join(S, n));
}
if (fs.existsSync(path.join(P.ROOT, 'assets'))) fs.symlinkSync(path.join(P.ROOT, 'assets'), path.join(S, 'assets'));
fs.cpSync(path.join(P.LOCKSRC, 'src'), path.join(S, 'src'), { recursive: true });
fs.copyFileSync(live, path.join(S, e.file));
const b = tool('build.mjs', [S]);
res.build = b.ok ? 'ok' : b.out.trim().split('\n').slice(-3).join(' | ');
if (!b.ok) res.pass = false;

if (b.ok) {
  // 4. panels
  for (const t of e.panels) {
    const out = path.join(S, `panel@${Number(t).toFixed(2)}.png`), ref = panelPng(P, e, t);
    const r = tool('still.mjs', [S, String(t), out, '--scale', '0.5']);
    const v = r.ok && fs.existsSync(ref) ? ssim(ref, out) : null;
    const ok = v != null && v >= ssimMin;
    res.panels.push({ t, ssim: v, ok, png: path.relative(P.ROOT, out), approved: path.relative(P.ROOT, ref), ...(r.ok ? {} : { error: r.out.trim().split('\n').pop() }) });
    if (!ok) res.pass = false;
  }
  // 5. tile across the era
  const f0 = Math.round(e.t0 * fps), f1 = Math.round(e.t1 * fps) - 1, N = Math.min(12, f1 - f0 + 1);
  const frames = [...new Set(Array.from({ length: N }, (_, i) => Math.round(f0 + (i * (f1 - f0)) / Math.max(1, N - 1))))];
  const tilePng = path.join(S, 'tile.png');
  const r = tool('tile.mjs', [S, tilePng, ...frames.map(String)]);
  const errs = r.out.split('\n').filter((l) => /PAGE ERROR|console: error/.test(l));
  const det = /deterministic: true/.test(r.out);
  const ms = (r.out.match(/ms\/frame ([\d ]+)/) || [])[1];
  res.tile = { frames, deterministic: det, pageErrors: errs.slice(0, 5), msPerFrame: ms?.trim(), png: path.relative(P.ROOT, tilePng) };
  if (!r.ok || !det || errs.length) res.pass = false;
}

fs.mkdirSync(P.CHECKS, { recursive: true });
fs.writeFileSync(path.join(P.CHECKS, `${T}.json`), JSON.stringify(res, null, 2) + '\n');
if (!quiet) {
  const L = [`${T} ${e.file}: ${res.pass ? 'PASS' : 'FAIL'}`];
  for (const k of ['ownership', 'rules']) L.push(`  ${k}: ${res[k].length ? '\n    ' + res[k].join('\n    ') : 'ok'}`);
  L.push(`  build: ${res.build}`);
  for (const p of res.panels) L.push(`  panel t=${p.t}: ssim ${p.ssim ?? '—'} (min ${ssimMin}) ${p.ok ? 'ok' : 'FAIL'}${p.error ? ' ' + p.error : ''}  ${p.png}`);
  if (res.tile) L.push(`  tile: deterministic ${res.tile.deterministic}, page errors ${res.tile.pageErrors.length}, ms/frame ${res.tile.msPerFrame}  ${res.tile.png}`);
  for (const w of res.warnings) L.push(`  warning: ${w}`);
  console.log(L.join('\n'));
}
process.exit(res.pass ? 0 : 1);
