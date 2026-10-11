// Shared helpers for the animate-director scripts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DIRECTOR = path.resolve(HERE, '..');
// the animate skill: $ANIMATE_SKILL, else the user-level install
export const ANIMATE = path.resolve(process.env.ANIMATE_SKILL || path.join(os.homedir(), '.claude/skills/animate'));
if (!fs.existsSync(path.join(ANIMATE, 'tools/build.mjs'))) {
  console.error(`animate skill not found at ${ANIMATE} (set ANIMATE_SKILL)`); process.exit(2);
}

export function piecePaths(dir) {
  const ROOT = path.resolve(dir);
  const D = path.join(ROOT, 'director');
  return { ROOT, D, ERAS: path.join(D, 'eras.json'), LOCK: path.join(D, 'lock.json'), LOCKSRC: path.join(D, 'lock'),
    APPROVED: path.join(D, 'approved'), BRIEFS: path.join(D, 'briefs'), RUNS: path.join(D, 'runs'), CHECKS: path.join(D, 'checks'), STAGE: path.join(D, 'stage') };
}

export const pad = (n) => String(n).padStart(2, '0');
export const tag = (n) => `e${pad(n)}`;
export const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex').slice(0, 16);

export function loadEras(P) {
  if (!fs.existsSync(P.ERAS)) { console.error(`missing ${P.ERAS} (copy templates/eras.json and fill it in)`); process.exit(2); }
  const cfg = readJSON(P.ERAS);
  const meta = readJSON(path.join(P.ROOT, 'piece.json'));
  const errs = [];
  if (!Array.isArray(cfg.eras) || !cfg.eras.length) errs.push('eras.json: "eras" is empty');
  const scenes = meta.scenes || [];
  for (const e of cfg.eras || []) {
    const id = `era ${e.n}`;
    for (const k of ['n', 'file', 'prefix', 't0', 't1', 'panels', 'motion']) if (e[k] == null) errs.push(`${id}: missing "${k}"`);
    if (e.file && !scenes.includes(e.file)) errs.push(`${id}: ${e.file} is not listed in piece.json "scenes"`);
    if (e.file && !fs.existsSync(path.join(P.ROOT, e.file))) errs.push(`${id}: ${e.file} does not exist`);
    if (e.prefix && !/^[A-Za-z_$][\w$]*$/.test(e.prefix)) errs.push(`${id}: bad prefix "${e.prefix}"`);
    for (const t of e.panels || []) if (!(t >= e.t0 && t < e.t1)) errs.push(`${id}: panel t=${t} is outside [${e.t0}, ${e.t1})`);
  }
  const files = (cfg.eras || []).map((e) => e.file), prefixes = (cfg.eras || []).map((e) => e.prefix);
  if (new Set(files).size !== files.length) errs.push('two eras share a file');
  if (new Set(prefixes).size !== prefixes.length) errs.push('two eras share a prefix');
  if (errs.length) { console.error(errs.map((e) => '  ' + e).join('\n')); process.exit(2); }
  return { cfg, meta, era: (n) => cfg.eras.find((e) => e.n === Number(n)) };
}

// every file the build reads from the piece, relative to ROOT (what the lock protects)
export function pieceFiles(ROOT) {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) { for (const n of fs.readdirSync(abs).sort()) walk(path.join(rel, n)); } else out.push(rel);
  };
  for (const r of ['piece.json', 'beats.json', 'voice.json', 'src', 'assets']) walk(r);
  return out;
}

export function run(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, ...o });
  return { ok: r.status === 0, status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
export const tool = (name, args, o) => run(process.execPath, [path.join(ANIMATE, 'tools', name), ...args], o);

export const panelPng = (P, e, t) => path.join(P.APPROVED, `${tag(e.n)}@${Number(t).toFixed(2)}.png`);

// SSIM of two images of the same size (ffmpeg), 0..1
export function ssim(a, b) {
  const r = run('ffmpeg', ['-hide_banner', '-nostats', '-i', a, '-i', b, '-lavfi', 'ssim', '-f', 'null', '-']);
  const m = r.out.match(/All:([\d.]+)/);
  return m ? Number(m[1]) : null;
}
