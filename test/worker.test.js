import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { wakeMeta } from '../src/models.js';

function fakeKv(seed) {
  const m = new Map(Object.entries(seed));
  return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}
const sid = 'a'.repeat(64);
const del = (auth) => worker.fetch(new Request('http://x/api/data', { method: 'DELETE', headers: auth ? { Authorization: `Bearer ${auth}` } : {} }), { FEEDBACK: kv() }, {});
let kv;

test('deleting my data removes the saved plan and session, and nobody else\'s', async () => {
  const store = fakeKv({ [`sess:${sid}`]: JSON.stringify({ sub: '1', email: 'a@b.c', name: 'A' }), 'user:1': '{}', 'user:2': '{}' });
  kv = () => store;
  const res = await del(sid);
  assert.equal(res.status, 200);
  assert.deepEqual([...store.m.keys()], ['user:2']);
});

test('deleting needs a valid session', async () => {
  const store = fakeKv({ 'user:1': '{}' });
  kv = () => store;
  assert.equal((await del('b'.repeat(64))).status, 401);
  assert.equal((await del()).status, 401);
  assert.equal(store.m.size, 1);
});

test('signing in needs consent first', async () => {
  const res = await worker.fetch(new Request('http://x/api/login', { method: 'POST', body: JSON.stringify({ credential: 'x' }) }), { FEEDBACK: fakeKv({}), GOOGLE_CLIENT_ID: 'id' }, {});
  assert.equal(res.status, 400);
});

test('deleting also removes the consent record', async () => {
  const store = fakeKv({ [`sess:${sid}`]: JSON.stringify({ sub: '1' }), 'user:1': '{}', 'consent:1': '{}' });
  kv = () => store;
  await del(sid);
  assert.equal(store.m.size, 0);
});

test('a full KV never stops the AI routes', async () => {
  const broken = { get: async () => null, put: async () => { throw new Error('KV PUT failed: 429 Too Many Requests'); } };
  for (let i = 0; i < 20; i++) {
    const res = await worker.fetch(new Request('http://x/api/setup', { method: 'POST', body: '{}' }), { FEEDBACK: broken }, {});
    assert.equal(res.status, 400); // reached the route: "Describe your week first"
  }
});

test('oversized images are refused before any model call', async () => {
  const body = JSON.stringify({ image: 'x'.repeat(8e6 + 1) });
  const res = await worker.fetch(new Request('http://x/api/agent', { method: 'POST', body }), { FEEDBACK: fakeKv({}) }, {});
  assert.equal(res.status, 413);
});

test('a plan larger than any real one is refused before any model call', async () => {
  let calls = 0;
  const real = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return new Response('{}'); };
  try {
    const body = JSON.stringify({ text: 'hi', state: { queue: 'x'.repeat(300_001) } });
    const res = await worker.fetch(new Request('http://x/api/agent', { method: 'POST', body }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'k' }, {});
    assert.equal(res.status, 413);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = real; }
});

// Answers from a scripted model, one per call, in the OpenAI format.
async function withModel(answers, fn) {
  const real = globalThis.fetch;
  const realError = console.error;
  const asked = [];
  console.error = () => {};
  globalThis.fetch = async (url, init) => {
    asked.push(JSON.parse(init.body));
    const a = answers[Math.min(asked.length - 1, answers.length - 1)];
    return typeof a === 'number' ? new Response('provider detail', { status: a }) : new Response(JSON.stringify({ choices: [{ message: a }] }));
  };
  try { return { asked, out: await fn() }; } finally { globalThis.fetch = real; console.error = realError; wakeMeta(); }
}
const setup = (body) => worker.fetch(new Request('http://x/api/setup', { method: 'POST', body: JSON.stringify({ date: '2026-11-03', weekday: 2, now: 600, ...body }) }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'a', BASETEN_API_KEY: 'b' }, {});
const toolCall = (name, args) => ({ content: '', tool_calls: [{ id: 'c1', function: { name, arguments: JSON.stringify(args) } }] });
const goodWeek = { roles: [{ name: 'Study', priority: 1, weeklyHours: 10, floorHours: 5 }], fixed: [], tasks: [{ title: 'Read', role: 'Study', minutes: 60, rank: '1' }], wake: '07:00', sleep: '23:00' };

test('a refused week goes back to the model with the reasons, then succeeds', async () => {
  const { asked, out } = await withModel([toolCall('build_week', { ...goodWeek, wake: '7am' }), toolCall('build_week', goodWeek)], () => setup({ text: 'my week' }));
  const data = await out.json();
  assert.equal(out.status, 200);
  assert.equal(data.template.weekStart, '2026-11-02');
  assert.deepEqual(data.steps.map((s) => s.ok), [false, true]);
  assert.match(asked[1].messages.at(-1).content, /wake/);
});

test('a model that never makes the call gets three tries, then a plain failure', async () => {
  const { asked, out } = await withModel([{ content: 'Sure!' }], () => setup({ text: 'my week' }));
  assert.equal(out.status, 422);
  assert.equal(asked.length, 3);
  assert.match(asked[1].messages.at(-1).content, /Call build_week now/);
});

test('when no provider answers, the person gets a sentence, not provider details', async () => {
  const { out } = await withModel([503], () => setup({ text: 'my week' }));
  const data = await out.json();
  assert.equal(out.status, 503);
  assert.equal(data.code, 'ai');
  assert.ok(!JSON.stringify(data).includes('provider detail'));
});

test('phases from the model are checked, refused ones go back with the reasons', async () => {
  const { sampleWeek } = await import('../public/core/sample.js');
  const template = sampleWeek({ date: '2026-11-03', weekday: 2, lang: 'en' });
  const goal = template.goals[0];
  const floor = template.roles.find((r) => r.id === goal.roleId).floorMin / 60;
  const phases = [{ title: 'Base', start: '2026-11-03', end: '2026-11-23', weeklyHours: floor + 1, expect: 'All units reviewed' }];
  const post = () => worker.fetch(new Request('http://x/api/phases', { method: 'POST', body: JSON.stringify({ template, goalId: goal.id, date: '2026-11-03', lang: 'en' }) }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'a', BASETEN_API_KEY: 'b' }, {});
  const { asked, out } = await withModel([toolCall('plan_phases', { phases: [{ ...phases[0], start: '2026-11-10' }] }), toolCall('plan_phases', { phases })], post);
  const data = await out.json();
  assert.equal(out.status, 200);
  assert.equal(data.phases[0].weeklyMin, (floor + 1) * 60);
  assert.match(asked[1].messages.at(-1).content, /start today/);
  const missing = await worker.fetch(new Request('http://x/api/phases', { method: 'POST', body: JSON.stringify({ template, goalId: 'nope', date: '2026-11-03' }) }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'a' }, {});
  assert.equal(missing.status, 400);
});

test('a PDF is never sent to a provider that cannot read it', async () => {
  const body = JSON.stringify({ file: 'data:application/pdf;base64,AAAA', date: '2026-11-01' });
  const { asked, out } = await withModel([503], () => worker.fetch(new Request('http://x/api/import', { method: 'POST', body }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'a', BASETEN_API_KEY: 'b' }, {}));
  assert.equal(out.status, 503);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].model, 'muse-spark-1.3');
});

test('import: only documents, only well-formed future dates, and private mode never sends a PDF', async () => {
  const post = (b) => worker.fetch(new Request('http://x/api/import', { method: 'POST', body: JSON.stringify(b) }), { FEEDBACK: fakeKv({}), MODEL_API_KEY: 'k' }, {});
  assert.equal((await post({ file: 'data:text/html;base64,AAAA', date: '2026-11-01' })).status, 400);
  const res = await post({ file: 'data:application/pdf;base64,AAAA', date: '2026-11-01', provider: 'open' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).code, 'private-pdf');
  const { readImport } = await import('../src/import.js');
  const out = readImport(JSON.stringify({
    deadlines: [{ title: 'Midterm', date: '2026-11-26', estimateHours: 8 }, { title: 'Past', date: '2026-01-01', estimateHours: 2 }, { title: 'Bad', date: 'soon', estimateHours: 2 }],
    events: [{ title: 'Exam', date: '2026-11-26', start: '13:00', end: '15:00' }, { title: 'No time', date: '2026-11-27', start: null, end: null }],
  }), '2026-11-01');
  assert.deepEqual(out.deadlines, [{ title: 'Midterm', date: '2026-11-26', minutes: 480 }]);
  assert.deepEqual(out.events.map((e) => e.title), ['Exam']);
  assert.deepEqual(readImport('not json', '2026-11-01'), { deadlines: [], events: [] });
});

test('feedback keeps the rating only if valid, and quoting needs an explicit yes', async () => {
  const store = fakeKv({});
  const send = (b) => worker.fetch(new Request('http://x/api/feedback', { method: 'POST', body: JSON.stringify(b) }), { FEEDBACK: store }, {});
  await send({ text: 'a', rating: 5, quote: true });
  await send({ text: 'b', rating: 99, quote: 'yes' });
  const notes = [...store.m.entries()].filter(([k]) => k.startsWith('2026') || /^\d{4}-/.test(k)).map(([, v]) => JSON.parse(v));
  const a = notes.find((n) => n.text === 'a');
  const b = notes.find((n) => n.text === 'b');
  assert.equal(a.rating, 5);
  assert.equal(a.quote, true);
  assert.equal(b.rating, null);
  assert.equal(b.quote, false);
});

test('one tap keeps yes or no and where, and nothing else', async () => {
  const store = fakeKv({});
  const send = (b) => worker.fetch(new Request('http://x/api/feedback', { method: 'POST', body: JSON.stringify(b) }), { FEEDBACK: store }, {});
  assert.equal((await send({ helped: true, where: 'week', text: 'my private plan', extra: 'x' })).status, 200);
  await send({ helped: false, where: 'anything else' });
  const notes = [...store.m.entries()].filter(([k]) => /^\d{4}-/.test(k)).map(([, v]) => JSON.parse(v));
  assert.deepEqual(notes, [{ helped: true, where: 'week' }, { helped: false, where: 'demo' }]);
});

test("Meta's restricted territories get no AI, everyone else does", async () => {
  const from = (cf, path = '/api/setup') => {
    const req = new Request(`http://x${path}`, { method: 'POST', body: '{}' });
    Object.defineProperty(req, 'cf', { value: cf });
    return worker.fetch(req, { FEEDBACK: fakeKv({}) }, {});
  };
  for (const country of ['HK', 'CN', 'RU', 'PK']) assert.equal((await from({ country })).status, 451, country);
  assert.equal((await from({ country: 'UA', regionCode: '43' })).status, 451);
  assert.equal((await from({ country: 'UA', regionCode: '30' })).status, 400); // reached the route
  assert.equal((await from({ country: 'VN' })).status, 400);
  assert.equal((await from({ country: 'US' })).status, 400);
});
