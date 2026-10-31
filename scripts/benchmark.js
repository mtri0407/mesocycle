// Muse Spark vs Muse Spark Open on the same agent, tools and rules.
// 20 scenarios (10 English, 10 Vietnamese) on the demo day. For each run:
// did the agent do what was asked, how many tool calls were rejected,
// how many model round trips, how long. Keys come from .dev.vars.
//   node scripts/benchmark.js [meta,open] [runsPerScenario]
import { readFileSync, writeFileSync } from 'node:fs';
import { chat } from '../src/models.js';
import { runAgent } from '../src/agent.js';
import { replan, toMin } from '../src/planner.js';
import { checkPlan } from '../src/invariants.js';
import { demoState } from '../src/demo-state.js';

const env = Object.fromEntries(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8')
  .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
  .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const providers = (process.argv[2] || 'meta,open').split(',');
const reps = Number(process.argv[3] || 1);

const hasFixedAt = (hhmm) => (s) => s.fixed.some((f) => f.start === toMin(hhmm));
const status = (id, st) => (s) => s.queue.find((q) => q.id === id)?.status === st;
const added = (s0) => (s) => s.queue.length > s0;
const longer = (id, min) => (s) => s.queue.find((q) => q.id === id).minutes >= min;

// [time, English, Vietnamese, check]
const SCENARIOS = [
  ['13:00', 'Class committee meeting at 7pm for an hour', 'Tối nay 7 giờ có họp ban cán sự 1 tiếng', hasFixedAt('19:00')],
  ['17:00', "I slept through the afternoon, and there's a class meeting at 7pm for an hour", 'Chiều nay tôi ngủ quên, 7 giờ tối có họp 1 tiếng', hasFixedAt('19:00')],
  ['08:00', "I can't do the gym today", 'Hôm nay tôi không đi gym được', status('q-3', 'skipped')],
  ['07:00', 'Calculus block 1 needs 30 more minutes', 'Block 1 Giải tích cần thêm 30 phút', longer('q-1', 120)],
  ['09:00', 'Add a 45 minute task: reply to parents about the SAT class, it matters', 'Thêm việc 45 phút: trả lời phụ huynh về lớp SAT, việc quan trọng', added(9)],
  ['10:00', 'Dentist at 3pm for 90 minutes', 'Đi nha sĩ lúc 3 giờ chiều, 90 phút', hasFixedAt('15:00')],
  ['16:00', 'Extra algebra class 6pm to 8pm', 'Lớp ôn Đại số từ 6 giờ đến 8 giờ tối', hasFixedAt('18:00')],
  ['20:00', 'Skip the law slides tonight', 'Tối nay bỏ phần đọc slide Pháp luật', status('q-7', 'skipped')],
  ['12:00', 'Lunch with my mom at 12:30 for an hour', 'Ăn trưa với mẹ lúc 12 giờ 30, 1 tiếng', hasFixedAt('12:30')],
  ['18:00', 'Team call 9pm for 30 minutes and I am already late', 'Họp nhóm 9 giờ tối 30 phút, mà tôi đang trễ rồi', hasFixedAt('21:00')],
];

async function runOne(provider, lang, [time, en, vi, check]) {
  const state = demoState(toMin(time), lang);
  let calls = 0;
  const chatFn = async (messages, tools) => { calls++; return chat(env, { messages, tools, maxTokens: 4000 }, provider); };
  const t0 = Date.now();
  try {
    const out = await runAgent({ state, userText: lang === 'vi' ? vi : en, chatFn });
    const errors = checkPlan(out.state, replan(out.state));
    const rejected = out.trace.filter((s) => !s.ok).length;
    return { provider, lang, time, ok: check(out.state) && !out.stopped && errors.length === 0, rejected, calls, ms: Date.now() - t0 };
  } catch (e) {
    return { provider, lang, time, ok: false, rejected: 0, calls, ms: Date.now() - t0, error: String(e.message).slice(0, 120) };
  }
}

const jobs = [];
for (const p of providers) for (let r = 0; r < reps; r++) for (const sc of SCENARIOS) for (const lang of ['en', 'vi']) jobs.push([p, lang, sc]);

const results = [];
const POOL = 4;
let next = 0;
await Promise.all(Array.from({ length: POOL }, async () => {
  while (next < jobs.length) {
    const [p, lang, sc] = jobs[next++];
    const r = await runOne(p, lang, sc);
    results.push(r);
    console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${p.padEnd(4)} ${lang} ${sc[0]} rejected=${r.rejected} calls=${r.calls} ${(r.ms / 1000).toFixed(1)}s ${r.error || ''}`);
  }
}));

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const lines = ['| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time |', '|---|---|---|---|---|---|'];
for (const p of providers) {
  const rs = results.filter((r) => r.provider === p);
  const pct = (n) => `${n}/${rs.length} (${Math.round((n / rs.length) * 100)}%)`;
  lines.push(`| ${p === 'meta' ? 'Muse Spark 1.3' : 'Muse Spark Open'} | ${rs.length} | ${pct(rs.filter((r) => r.ok).length)} | ${pct(rs.filter((r) => r.rejected === 0).length)} | ${median(rs.map((r) => r.calls))} | ${(median(rs.map((r) => r.ms)) / 1000).toFixed(1)}s |`);
}
const table = lines.join('\n');
console.log('\n' + table);
writeFileSync(new URL('../docs/BENCHMARK.md', import.meta.url), `# Muse Spark vs Muse Spark Open\n\nSame agent, tools and rules; 10 scenarios in English and Vietnamese on the demo day. Run ${new Date().toISOString().slice(0, 10)}.\n\n${table}\n\nA run counts as done when the requested change is in the plan, the agent finished on its own, and every planner promise in src/invariants.js still holds.\n`);
