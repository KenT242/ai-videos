#!/usr/bin/env node
// Hand eras to agy in parallel, then check each one.
//   usage: node run.mjs <piece dir> [era n ...] [--parallel <N|max>] [-j <N|max>] [--max]
//          node run.mjs <piece dir> --followup <n> "<message>"
// Default: runs ALL eras concurrently in parallel (maximum parallelism) to maximize speed.
// Regenerates the briefs from eras.json first. Per era: director/runs/eNN.json (agy's result) and
// director/checks/eNN.json (check.mjs). Live logs: ~/.gemini/antigravity-cli/agent-runs/<id>.log (agy-tracked).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { piecePaths, loadEras, ANIMATE, DIRECTOR, HERE, tag, readJSON, run } from './lib.mjs';

const rawArgs = process.argv.slice(2);
if (rawArgs.includes('--help') || rawArgs.includes('-h')) {
  console.log(`usage: node run.mjs <piece dir> [era n ...] [--parallel <N|max>] [-j <N|max>] [--stagger <ms>] | --followup <n> "<message>"

Options:
  --parallel, -j <N|max>   Concurrency limit (default: all eras simultaneously / max)
  --max, --all             Force maximum concurrency across all eras
  --stagger <ms>           Launch delay between workers for smooth terminal pane stacking (default: 300ms)
  --followup <n> "<msg>"   Continue conversation for era n with prompt message
`);
  process.exit(0);
}
const dir = rawArgs.find((a) => !a.startsWith('-'));
if (!dir) {
  console.error('usage: node run.mjs <piece dir> [era n ...] [--parallel <N|max>] [-j <N|max>] | --followup <n> "<message>"');
  process.exit(2);
}

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

// Parse args
const isFollowup = rawArgs.includes('--followup');
let recs = [];

if (isFollowup) {
  const fIdx = rawArgs.indexOf('--followup');
  const targetEraN = rawArgs[fIdx + 1];
  const msg = rawArgs.slice(fIdx + 2).join(' ');
  const e = era(targetEraN);
  if (!e || !msg) { console.error('usage: node run.mjs <piece dir> --followup <n> "<message>"'); process.exit(2); }
  const prev = path.join(P.RUNS, `${tag(e.n)}.json`);
  const id = fs.existsSync(prev) ? readJSON(prev).conversation_id : null;
  if (!id) { console.error(`no earlier conversation for ${tag(e.n)}`); process.exit(2); }
  const tail = `\n\nWhen done, run: node ${path.join(DIRECTOR, 'scripts/check.mjs')} ${P.ROOT} ${e.n} and reply with PASS/FAIL and the SSIM numbers.`;
  recs.push(await one(e, msg + tail, id));
} else {
  // Extract options
  const opt = (name) => {
    const idx = rawArgs.indexOf('--' + name);
    return idx >= 0 && rawArgs[idx + 1] ? rawArgs[idx + 1] : null;
  };
  const parallelOpt = opt('parallel') || opt('j') || (rawArgs.indexOf('-j') >= 0 ? rawArgs[rawArgs.indexOf('-j') + 1] : null);
  const maxFlag = rawArgs.includes('--max') || rawArgs.includes('--all');
  const staggerOpt = opt('stagger');

  // Positional era numbers (excluding dir and flag values)
  const skipIndices = new Set();
  const dirIdx = rawArgs.indexOf(dir);
  if (dirIdx >= 0) skipIndices.add(dirIdx);
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i].startsWith('-')) {
      skipIndices.add(i);
      if (['--parallel', '-j', '--stagger'].includes(rawArgs[i]) && i + 1 < rawArgs.length) {
        skipIndices.add(i + 1);
      }
    }
  }

  const eraNums = rawArgs.filter((_, idx) => !skipIndices.has(idx));
  const list = eraNums.length
    ? eraNums.map((n) => era(n) || (console.error(`no era ${n}`), process.exit(2)))
    : cfg.eras;

  const b = run(process.execPath, [path.join(HERE, 'brief.mjs'), P.ROOT, ...list.map((e) => String(e.n))]);
  if (!b.ok) { console.error(b.out); process.exit(1); }

  // Concurrency resolution: DEFAULT TO MAXIMUM PARALLELISM (spawn all eras at once)
  let limit;
  if (maxFlag || parallelOpt === 'max' || parallelOpt === 'all') {
    limit = list.length;
  } else if (parallelOpt) {
    limit = Math.max(1, parseInt(parallelOpt, 10));
  } else if (process.env.ANIMATE_PARALLEL) {
    const envVal = process.env.ANIMATE_PARALLEL;
    limit = (envVal === 'max' || envVal === 'all') ? list.length : Math.max(1, parseInt(envVal, 10));
  } else if (cfg.parallel === 'max' || cfg.parallel === 'all' || !cfg.parallel || cfg.parallel === 3) {
    // Default to spawning ALL eras in parallel (eliminate legacy 3-era cap)
    limit = list.length;
  } else if (typeof cfg.parallel === 'number' && cfg.parallel > 0) {
    limit = cfg.parallel;
  } else {
    limit = list.length;
  }
  limit = Math.min(limit, list.length);

  console.log(`[director] Spawning ${limit} parallel workers (total ${list.length} era${list.length > 1 ? 's' : ''}, max concurrency)...`);

  const queue = [...list];
  const staggerMs = parseInt(staggerOpt || '300', 10);

  const worker = async (workerIndex) => {
    let first = true;
    while (queue.length) {
      const e = queue.shift();
      if (first && workerIndex > 0 && staggerMs > 0) {
        await new Promise((r) => setTimeout(r, workerIndex * staggerMs));
      }
      first = false;
      const briefContent = fs.readFileSync(path.join(P.BRIEFS, `${tag(e.n)}.md`), 'utf8');
      recs.push(await one(e, briefContent));
    }
  };

  await Promise.all(Array.from({ length: limit }, (_, idx) => worker(idx)));
}

recs.sort((a, b) => a.era - b.era);
console.log('\nera  agy        check  secs  conversation');
for (const r of recs) console.log(`${tag(r.era)}  ${r.status.padEnd(9)}  ${r.check.padEnd(5)}  ${String(r.seconds).padStart(4)}  ${r.conversation_id || '-'}`);
process.exit(recs.every((r) => r.check === 'PASS' && r.status === 'SUCCESS' && r.response.trim()) ? 0 : 1);
