import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPushEndpoint, splitDue, saveReminders, sendDue } from '../src/push.js';

function fakeKv() {
  const m = new Map();
  return {
    m,
    get: async (k) => m.get(k) ?? null,
    put: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); },
    list: async ({ prefix }) => ({ keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}

test('only real push services are accepted', () => {
  assert.ok(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc'));
  assert.ok(isPushEndpoint('https://web.push.apple.com/xyz'));
  assert.ok(!isPushEndpoint('https://evil.example/fcm.googleapis.com'));
  assert.ok(!isPushEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!isPushEndpoint('https://fcm.googleapis.com.evil.example/x'));
  assert.ok(!isPushEndpoint('not a url'));
});

test('a time fires once: inside the 5 minute window, then it is gone', () => {
  const now = 1_000_000_000;
  const { due, ahead } = splitDue([now - 400_000, now - 60_000, now + 60_000], now);
  assert.deepEqual(due, [now - 60_000]);
  assert.deepEqual(ahead, [now + 60_000]);
});

test('the cron job pushes what is due, with no content, and keeps what is ahead', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { FEEDBACK: fakeKv(), VAPID_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)), VAPID_PUBLIC: 'pub' };
  const now = 1_000_000_000;
  await saveReminders(env, { endpoint: 'https://fcm.googleapis.com/x', times: [now - 1000, now + 1000] });
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { status: 201 }; };
  try { await sendDue(env, now); } finally { globalThis.fetch = real; }
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.body, undefined);
  assert.match(calls[0].init.headers.Authorization, /^vapid t=.+\..+\..+, k=pub$/);
  assert.deepEqual(JSON.parse([...env.FEEDBACK.m.values()][0]).times, [now + 1000]);
});

test('a dead subscription is removed', async () => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const env = { FEEDBACK: fakeKv(), VAPID_JWK: JSON.stringify(await crypto.subtle.exportKey('jwk', keys.privateKey)), VAPID_PUBLIC: 'pub' };
  const now = 1_000_000_000;
  await saveReminders(env, { endpoint: 'https://fcm.googleapis.com/x', times: [now - 1000] });
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ status: 410 });
  try { await sendDue(env, now); } finally { globalThis.fetch = real; }
  assert.equal(env.FEEDBACK.m.size, 0);
});
