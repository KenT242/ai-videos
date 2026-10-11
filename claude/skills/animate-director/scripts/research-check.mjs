#!/usr/bin/env node
// Check agy's research report: every source URL must resolve to a real page (not a 404, not a bounce to the
// site's homepage), and every claim must keep >= 2 live sources. agy can cite plausible URLs that don't exist.
//   usage: node scripts/research-check.mjs <piece dir>      reads director/research/report.json
//   writes director/research/check.json; exit 0 = no dead source and >= 2 reachable-or-blocked sources per item,
//   1 = dead or missing sources (re-research them). Sources marked unchecked (bot walls) still need your own look.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node scripts/research-check.mjs <piece dir>'); process.exit(2); }
const R = path.join(path.resolve(dir), 'director', 'research');
const rep = JSON.parse(fs.readFileSync(path.join(R, 'report.json'), 'utf8'));
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const BLOCKS = /(^|\.)(twitter\.com|x\.com|businessinsider\.com|nytimes\.com|linkedin\.com)$/;   // bot walls: can't be checked here

async function probe(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return { url, verdict: 'bad-url' }; }
  if (BLOCKS.test(host)) return { url, verdict: 'unchecked', note: 'site blocks scripts: verify by hand' };
  try {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    const res = await fetch(url, { redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA } });
    clearTimeout(timer);
    const fin = new URL(res.url), deep = new URL(url).pathname.replace(/\/$/, '').length > 1;
    if (res.status === 401 || res.status === 403 || res.status === 429) return { url, status: res.status, verdict: 'unchecked', note: 'blocked: verify by hand' };
    if (res.status >= 400) return { url, status: res.status, verdict: 'dead' };
    if (deep && fin.pathname.replace(/\/$/, '').length <= 1) return { url, status: res.status, final: res.url, verdict: 'dead', note: 'bounced to the homepage' };
    return { url, status: res.status, verdict: 'live' };
  } catch (e) { return { url, verdict: 'unchecked', note: String(e.cause?.code || e.name) }; }
}

const items = [...rep.claims.map((c) => ({ id: c.id, text: c.claim, support: c.support, sources: c.sources })),
  ...(rep.answers || []).map((a, i) => ({ id: 'q' + (i + 1), text: a.question, support: '-', sources: a.sources }))];
const out = [];
let bad = 0;
for (const it of items) {
  const probes = await Promise.all((it.sources || []).map((s) => probe(s.url)));
  const live = probes.filter((p) => p.verdict === 'live').length, dead = probes.filter((p) => p.verdict === 'dead' || p.verdict === 'bad-url').length;
  const ok = dead === 0 && probes.length - dead >= 2;
  if (!ok) bad++;
  out.push({ id: it.id, ok, live, dead, support: it.support, probes });
  console.log(`${ok ? 'OK  ' : 'CHECK'} ${it.id.padEnd(4)} live ${live} dead ${dead} (${it.support})  ${it.text.slice(0, 70)}`);
  for (const p of probes) if (p.verdict !== 'live') console.log(`        ${p.verdict}${p.status ? ' ' + p.status : ''}${p.note ? ' (' + p.note + ')' : ''}  ${p.url}`);
}
fs.writeFileSync(path.join(R, 'check.json'), JSON.stringify(out, null, 1));
const unchecked = out.filter((o) => o.ok && o.live < 2).map((o) => o.id);
console.log(bad ? `\n${bad} item(s) with dead or missing sources: re-research them` : '\nno dead sources');
if (unchecked.length) console.log(`fewer than 2 sources confirmed live (bot walls): ${unchecked.join(', ')}; verify those yourself`);
process.exit(bad ? 1 : 0);
