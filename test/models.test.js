import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickProvider, buildChatRequest, readChatResponse, chatSafe } from '../src/models.js';

test('pickProvider defaults to Meta and reads the right key', () => {
  const p = pickProvider({ MODEL_API_KEY: 'k1' });
  assert.equal(p.name, 'meta');
  assert.equal(p.model, 'muse-spark-1.3');
  assert.equal(p.key, 'k1');
});

test('pickProvider can switch to the open-weight model', () => {
  const p = pickProvider({ MODEL_PROVIDER: 'open', BASETEN_API_KEY: 'k2' });
  assert.equal(p.model, 'meta-models/muse-spark-open-1026');
  assert.equal(p.key, 'k2');
});

test('pickProvider explains a missing key instead of failing later', () => {
  assert.throws(() => pickProvider({}), /Missing MODEL_API_KEY/);
});

test('buildChatRequest targets chat/completions with a bearer token', () => {
  const p = pickProvider({ MODEL_API_KEY: 'secret' });
  const { url, init } = buildChatRequest(p, { messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(url, 'https://api.meta.ai/v1/chat/completions');
  assert.equal(init.headers.Authorization, 'Bearer secret');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'muse-spark-1.3');
  assert.equal(body.tools, undefined);
});

test('readChatResponse parses tool calls and survives broken JSON args', () => {
  const out = readChatResponse({
    choices: [{ message: { content: null, tool_calls: [
      { id: 'a', function: { name: 'move_block', arguments: '{"id":"b1","start":"09:00"}' } },
      { id: 'b', function: { name: 'add_block', arguments: '{not json' } },
    ] } }],
  });
  assert.equal(out.text, '');
  assert.deepEqual(out.toolCalls[0].args, { id: 'b1', start: '09:00' });
  assert.equal(out.toolCalls[1].args, null);
  assert.equal(out.toolCalls[1].rawArgs, '{not json');
});

test('effort and cache key reach the request; the open model has no minimal level', () => {
  const body = (env, o) => JSON.parse(buildChatRequest(pickProvider(env), { messages: [], ...o }).init.body);
  const meta = body({ MODEL_API_KEY: 'k' }, { effort: 'minimal' });
  assert.equal(meta.reasoning_effort, 'minimal');
  assert.equal(meta.prompt_cache_key, 'mesocycle-v1');
  const open = body({ MODEL_PROVIDER: 'open', BASETEN_API_KEY: 'k' }, { effort: 'minimal' });
  assert.equal(open.reasoning_effort, 'low');
  assert.equal(open.prompt_cache_key, undefined);
});

async function withFetch(fake, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  try { return await fn(); } finally { globalThis.fetch = real; }
}
const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }));
const env = { MODEL_API_KEY: 'a', BASETEN_API_KEY: 'b' };

test('when Meta fails, Muse Spark Open takes over', async () => {
  for (const status of [404, 429, 503]) {
    const hosts = [];
    const out = await withFetch(async (url) => {
      hosts.push(new URL(url).hostname);
      return hosts.length === 1 ? new Response('no', { status }) : ok();
    }, () => chatSafe(env, { messages: [] }, 'meta'));
    assert.deepEqual(hosts, ['api.meta.ai', 'inference.baseten.co']);
    assert.equal(out.fellBack, true);
  }
  const out = await withFetch(async (url) => {
    if (new URL(url).hostname === 'api.meta.ai') throw new Error('network');
    return ok();
  }, () => chatSafe(env, { messages: [] }));
  assert.equal(out.provider, 'open');
});

test('our own mistakes do not switch, and a choice of the open model is kept', async () => {
  let calls = 0;
  await assert.rejects(withFetch(async () => { calls++; return new Response('bad', { status: 400 }); }, () => chatSafe(env, { messages: [] }, 'meta')));
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(withFetch(async () => { calls++; return new Response('down', { status: 503 }); }, () => chatSafe(env, { messages: [] }, 'open')));
  assert.equal(calls, 1);
});
