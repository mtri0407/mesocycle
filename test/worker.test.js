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
