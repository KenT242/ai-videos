#!/usr/bin/env node
// Parallel fact research coordinator for animate-director.
// Spawns multiple agy workers concurrently to check claims and questions in parallel,
// then merges results into director/research/report.json and runs research-check.mjs.
//
// Usage: node scripts/research.mjs <piece dir> [--parallel <N|max>] [--chunk <N>] [--single]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { piecePaths, DIRECTOR, HERE, run } from './lib.mjs';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`usage: node scripts/research.mjs <piece dir> [--parallel <N|max>] [--chunk <N>] [--single]

Options:
  --parallel <N|max>   Number of concurrent research workers (default: max / all chunks)
  --chunk <N>          Number of claims/questions per chunk (default: 2)
  --single             Run all claims in a single monolithic worker (legacy mode)
`);
  process.exit(0);
}
const dir = args.find((a) => !a.startsWith('-'));
if (!dir) {
  console.error('usage: node scripts/research.mjs <piece dir> [--parallel <N|max>] [--chunk <N>] [--single]');
  process.exit(2);
}

const P = piecePaths(dir);
const R = path.join(P.D, 'research');
const briefFile = path.join(R, 'brief.md');
if (!fs.existsSync(briefFile)) {
  console.error(`missing ${briefFile} (create brief.md from templates/research.md first)`);
  process.exit(2);
}

const AGY = process.env.AGY_BIN || path.join(os.homedir(), '.local/bin/agy-tracked');
const SCHEMA = path.join(DIRECTOR, 'templates/research.schema.json');
fs.mkdirSync(path.join(R, 'parts'), { recursive: true });

const opt = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const hasFlag = (name) => args.includes('--' + name);

const rawBrief = fs.readFileSync(briefFile, 'utf8');

// Parse brief.md into header, claimIntro, questionIntro, claims, questions, rules
function parseBrief(text) {
  const lines = text.split('\n');
  let section = 'header';
  const headerLines = [];
  const claimIntro = [];
  const questionIntro = [];
  const claimBlocks = [];
  const questionBlocks = [];
  const rulesLines = [];

  let curBlock = [];
  for (const line of lines) {
    if (/^##\s+Claims to check/i.test(line)) {
      section = 'claims';
      continue;
    } else if (/^##\s+Open questions/i.test(line)) {
      if (curBlock.length) {
        if (section === 'claims') claimBlocks.push(curBlock.join('\n').trim());
        curBlock = [];
      }
      section = 'questions';
      continue;
    } else if (/^##\s+Rules/i.test(line)) {
      if (curBlock.length) {
        if (section === 'claims') claimBlocks.push(curBlock.join('\n').trim());
        if (section === 'questions') questionBlocks.push(curBlock.join('\n').trim());
        curBlock = [];
      }
      section = 'rules';
      continue;
    }

    if (section === 'header') {
      headerLines.push(line);
    } else if (section === 'rules') {
      rulesLines.push(line);
    } else if (section === 'claims') {
      if (/^-\s+id:\s*/.test(line)) {
        if (curBlock.length) claimBlocks.push(curBlock.join('\n').trim());
        curBlock = [line];
      } else if (curBlock.length > 0) {
        curBlock.push(line);
      } else {
        claimIntro.push(line);
      }
    } else if (section === 'questions') {
      if (/^-\s+id:\s*/.test(line)) {
        if (curBlock.length) questionBlocks.push(curBlock.join('\n').trim());
        curBlock = [line];
      } else if (curBlock.length > 0) {
        curBlock.push(line);
      } else {
        questionIntro.push(line);
      }
    }
  }
  if (curBlock.length) {
    if (section === 'claims') claimBlocks.push(curBlock.join('\n').trim());
    if (section === 'questions') questionBlocks.push(curBlock.join('\n').trim());
  }

  return {
    header: headerLines.join('\n').trim(),
    claimIntro: claimIntro.join('\n').trim(),
    questionIntro: questionIntro.join('\n').trim(),
    claims: claimBlocks.filter((b) => b.length > 0),
    questions: questionBlocks.filter((b) => b.length > 0),
    rules: rulesLines.join('\n').trim()
  };
}

const parsed = parseBrief(rawBrief);

function runAgy(prompt, id, timeoutSec) {
  const a = [
    '-p', prompt,
    '--output-format', 'json',
    '--print-timeout', `${timeoutSec}s`,
    '--json-schema', SCHEMA,
    '--model', 'gemini-3.8-flash-high'
  ];
  return new Promise((resolve) => {
    const t0 = Date.now();
    const ch = spawn(AGY, a, { cwd: P.ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    ch.stdout.on('data', (d) => (out += d));
    ch.stderr.on('data', (d) => (err += d));
    ch.on('close', (code) => {
      const line = out.trim().split('\n').reverse().find((l) => l.trim().startsWith('{'));
      let r = {};
      try { r = line ? JSON.parse(line) : {}; } catch { r = {}; }
      let reportData = null;
      try {
        if (r.response) {
          reportData = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
        }
      } catch {}
      resolve({
        id,
        code,
        status: r.status || 'NO_RESULT',
        conversation_id: r.conversation_id || null,
        response: r.response || '',
        data: reportData,
        seconds: Math.round((Date.now() - t0) / 1000),
        stderr: err.trim().split('\n').slice(-3).join('\n')
      });
    });
  });
}

async function main() {
  if (hasFlag('single') || (parsed.claims.length <= 2 && parsed.questions.length <= 1)) {
    console.log(`[research] running single worker for ${parsed.claims.length} claims and ${parsed.questions.length} questions...`);
    const res = await runAgy(rawBrief, 'single', Math.max(180, (parsed.claims.length + parsed.questions.length) * 75));
    if (res.data) {
      fs.writeFileSync(path.join(R, 'report.json'), JSON.stringify(res.data, null, 2) + '\n');
      console.log(`[research] report written to ${path.join(R, 'report.json')} in ${res.seconds}s`);
    } else {
      console.error(`[research] worker failed: ${res.status}`);
      process.exit(1);
    }
  } else {
    // Partition claims and questions into chunks
    const chunkParam = parseInt(opt('chunk', '2'), 10);
    const chunkSize = Math.max(1, chunkParam);

    const claimChunks = [];
    for (let i = 0; i < parsed.claims.length; i += chunkSize) {
      claimChunks.push(parsed.claims.slice(i, i + chunkSize));
    }

    const questionChunks = [];
    for (let i = 0; i < parsed.questions.length; i += chunkSize) {
      questionChunks.push(parsed.questions.slice(i, i + chunkSize));
    }

    // Assemble parts
    const parts = [];
    let pIdx = 1;
    for (const cChunk of claimChunks) {
      parts.push({
        id: `part-${pIdx++}`,
        claims: cChunk,
        questions: []
      });
    }
    for (const qChunk of questionChunks) {
      parts.push({
        id: `part-${pIdx++}`,
        claims: [],
        questions: qChunk
      });
    }

    const parallelOpt = opt('parallel', 'max');
    const limit = (parallelOpt === 'max' || parallelOpt === 'all')
      ? parts.length
      : Math.min(parts.length, Math.max(1, parseInt(parallelOpt, 10)));

    console.log(`[research] spawning ${limit} parallel workers for ${parts.length} parts (${parsed.claims.length} claims, ${parsed.questions.length} questions)...`);

    const queue = [...parts];
    const results = [];
    const staggerMs = 300;

    const worker = async (workerIndex) => {
      let first = true;
      while (queue.length) {
        const part = queue.shift();
        if (first && workerIndex > 0 && staggerMs > 0) {
          await new Promise((r) => setTimeout(r, workerIndex * staggerMs));
        }
        first = false;

        const subBrief = [
          parsed.header,
          '',
          part.claims.length ? ['## Claims to check', '', parsed.claimIntro, '', ...part.claims].filter(Boolean).join('\n') : '',
          '',
          part.questions.length ? ['## Open questions', '', parsed.questionIntro, '', ...part.questions].filter(Boolean).join('\n') : '',
          '',
          parsed.rules
        ].filter(Boolean).join('\n');

        const partFile = path.join(R, 'parts', `${part.id}.md`);
        fs.writeFileSync(partFile, subBrief + '\n');

        const totalItems = part.claims.length + part.questions.length;
        const timeoutSec = Math.max(120, totalItems * 75);
        console.log(`[research] [${part.id}] started (${totalItems} items, timeout ${timeoutSec}s)`);
        const res = await runAgy(subBrief, part.id, timeoutSec);
        console.log(`[research] [${part.id}] finished in ${res.seconds}s: ${res.status}`);
        results.push(res);
      }
    };

    await Promise.all(Array.from({ length: limit }, (_, idx) => worker(idx)));

    // Merge results
    const mergedClaims = [];
    const mergedAnswers = [];
    for (const res of results) {
      if (res.data) {
        if (Array.isArray(res.data.claims)) mergedClaims.push(...res.data.claims);
        if (Array.isArray(res.data.answers)) mergedAnswers.push(...res.data.answers);
      }
    }

    const finalReport = { claims: mergedClaims, answers: mergedAnswers };
    const outPath = path.join(R, 'report.json');
    fs.writeFileSync(outPath, JSON.stringify(finalReport, null, 2) + '\n');
    console.log(`\n[research] merged report saved to ${outPath} (${mergedClaims.length} claims, ${mergedAnswers.length} answers)`);
  }

  // Run research check
  console.log('\n[research] verifying sources with research-check.mjs:');
  const chk = run(process.execPath, [path.join(HERE, 'research-check.mjs'), P.ROOT]);
  console.log(chk.out);
  process.exit(chk.ok ? 0 : 1);
}

main().catch((e) => {
  console.error('[research] fatal error:', e);
  process.exit(1);
});
