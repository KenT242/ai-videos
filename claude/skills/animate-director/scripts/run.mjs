#!/usr/bin/env node
// Hand eras to agy in parallel, then check each one.
//   usage: node run.mjs <piece dir> [era n ...]                 all eras (or the listed ones), cfg.parallel at a time
//          node run.mjs <piece dir> --followup <n> "<message>"  continue era n's agy conversation, then re-check
// Regenerates the briefs from eras.json first. Per era: director/runs/eNN.json (agy's result) and
// director/checks/eNN.json (check.mjs). Live logs: ~/.claude/agent-runs/<id>.log (agy-tracked).
// Run it with Bash run_in_background — a full set takes minutes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { piecePaths, loadEras, ANIMATE, DIRECTOR, HERE, tag, readJSON, run } from './lib.mjs';

const args = process.argv.slice(2);
const dir = args.shift();
if (!dir) { console.error('usage: node run.mjs <piece dir> [era n ...] | --followup <n> "<message>"'); process.exit(2); }
const P = piecePaths(dir);
const { cfg, era } = loadEras(P);
if (!fs.existsSync(P.LOCK)) { console.error('no lock: run lock.mjs after the storyboard is approved'); process.exit(2); }
const AGY = process.env.AGY_BIN || path.join(os.homedir(), '.local/bin/agy-tracked');
fs.mkdirSync(P.RUNS, { recursive: true });

function agy(e, prompt, conversation) {
  const a = ['-p', prompt, '--output-format', 'json', '--print-timeout', e.timeout || cfg.timeout || '900s', '--dangerously-skip-permissions',
    '--model', e.model || cfg.model || 'gemini-3.8-flash-medium', '--add-dir', ANIMATE, '--add-dir', DIRECTOR];
  if (conversation) a.push('--conversation', conversation);
  return new Promise((resolve) => {
    const t0 = Date.now(), ch = spawn(AGY, a, { cwd: P.ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => (out += d)); ch.stderr.on('data', (d) => (err += d));
    ch.on('close', (code) => {
      const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
      let r = {};
      try { r = line ? JSON.parse(line) : {}; } catch { r = {}; }
      resolve({ code, status: r.status || 'NO_RESULT', conversation_id: r.conversation_id || conversation || null,
        response: r.response || '', denied_actions: r.denied_actions || [], num_turns: r.num_turns, seconds: Math.round((Date.now() - t0) / 1000),
        ...(r.status ? {} : { stderr: err.trim().split('\n').slice(-5).join('\n') }) });
    });
  });
}

async function one(e, prompt, conversation) {
  const T = tag(e.n);
  console.log(`[${T}] agy started${conversation ? ' (follow-up)' : ''}`);
  const r = await agy(e, prompt, conversation);
  const c = run(process.execPath, [path.join(HERE, 'check.mjs'), P.ROOT, String(e.n), '--quiet']);
  const chk = fs.existsSync(path.join(P.CHECKS, `${T}.json`)) ? readJSON(path.join(P.CHECKS, `${T}.json`)) : { pass: false };
  const rec = { era: e.n, ...r, check: chk.pass ? 'PASS' : 'FAIL', finished: new Date().toISOString() };
  const runFile = path.join(P.RUNS, `${T}.json`);
  const prev = fs.existsSync(runFile) ? readJSON(runFile) : null;
  fs.writeFileSync(runFile, JSON.stringify({ ...rec, history: [...(prev?.history || []), ...(prev ? [{ ...prev, history: undefined }] : [])] }, null, 2) + '\n');
  const flags = [r.status !== 'SUCCESS' && `status ${r.status}`, !r.response.trim() && 'EMPTY response', r.denied_actions.length && `${r.denied_actions.length} denied actions`].filter(Boolean);
  console.log(`[${T}] agy ${r.status} in ${r.seconds}s, check ${rec.check}${flags.length ? ' — ' + flags.join(', ') : ''}`);
  if (c.status === 2) console.log(`[${T}] check error: ${c.out.trim()}`);
  return rec;
}

let recs = [];
if (args[0] === '--followup') {
  const e = era(args[1]), msg = args.slice(2).join(' ');
  if (!e || !msg) { console.error('usage: node run.mjs <piece dir> --followup <n> "<message>"'); process.exit(2); }
  const prev = path.join(P.RUNS, `${tag(e.n)}.json`);
  const id = fs.existsSync(prev) ? readJSON(prev).conversation_id : null;
  if (!id) { console.error(`no earlier conversation for ${tag(e.n)}`); process.exit(2); }
  const tail = `\n\nWhen done, run: node ${path.join(DIRECTOR, 'scripts/check.mjs')} ${P.ROOT} ${e.n} and reply with PASS/FAIL and the SSIM numbers.`;
  recs.push(await one(e, msg + tail, id));
} else {
  const list = args.length ? args.map((n) => era(n) || (console.error(`no era ${n}`), process.exit(2))) : cfg.eras;
  const b = run(process.execPath, [path.join(HERE, 'brief.mjs'), P.ROOT, ...list.map((e) => String(e.n))]);
  if (!b.ok) { console.error(b.out); process.exit(1); }
  const queue = [...list], limit = Math.max(1, cfg.parallel || 3);
  const worker = async () => { while (queue.length) { const e = queue.shift(); recs.push(await one(e, fs.readFileSync(path.join(P.BRIEFS, `${tag(e.n)}.md`), 'utf8'))); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
}

recs.sort((a, b) => a.era - b.era);
console.log('\nera  agy        check  secs  conversation');
for (const r of recs) console.log(`${tag(r.era)}  ${r.status.padEnd(9)}  ${r.check.padEnd(5)}  ${String(r.seconds).padStart(4)}  ${r.conversation_id || '-'}`);
process.exit(recs.every((r) => r.check === 'PASS' && r.status === 'SUCCESS' && r.response.trim()) ? 0 : 1);
