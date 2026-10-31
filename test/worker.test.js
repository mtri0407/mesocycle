import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';

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
