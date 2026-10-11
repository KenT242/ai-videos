#!/usr/bin/env node
// Lock the approved storyboard before handing eras to agy.
//   usage: node lock.mjs <piece dir>
// Builds the piece, renders every era's approved panel(s) to director/approved/eNN@t.png, snapshots src/ to
// director/lock/src and writes director/lock.json (a hash of every file the build reads). check.mjs compares
// against all three. Re-run it whenever you (the director) change a shared file or re-approve a panel.
import fs from 'node:fs';
import path from 'node:path';
import { piecePaths, loadEras, pieceFiles, sha, tool, panelPng, tag } from './lib.mjs';

const dir = process.argv[2];
if (!dir) { console.error('usage: node lock.mjs <piece dir>'); process.exit(2); }
const P = piecePaths(dir);
const { cfg } = loadEras(P);

const b = tool('build.mjs', [P.ROOT]);
if (!b.ok) { console.error('build failed — fix it before locking:\n' + b.out); process.exit(1); }

fs.rmSync(P.APPROVED, { recursive: true, force: true });
fs.mkdirSync(P.APPROVED, { recursive: true });
for (const e of cfg.eras) {
  for (const t of e.panels) {
    const out = panelPng(P, e, t);
    const r = tool('still.mjs', [P.ROOT, String(t), out, '--scale', '0.5']);
    if (!r.ok || !fs.existsSync(out)) { console.error(`panel ${tag(e.n)} t=${t} failed:\n${r.out}`); process.exit(1); }
  }
}

fs.rmSync(P.LOCKSRC, { recursive: true, force: true });
const files = {};
for (const rel of pieceFiles(P.ROOT)) {
  files[rel] = sha(path.join(P.ROOT, rel));
  if (rel.startsWith('src' + path.sep)) {
    const to = path.join(P.LOCKSRC, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(P.ROOT, rel), to);
  }
}
fs.writeFileSync(P.LOCK, JSON.stringify({ locked: new Date().toISOString(), files }, null, 2) + '\n');
const nPanels = cfg.eras.reduce((s, e) => s + e.panels.length, 0);
console.log(`locked ${Object.keys(files).length} files, ${cfg.eras.length} eras, ${nPanels} approved panels -> ${P.D}`);
