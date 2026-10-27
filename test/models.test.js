import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickProvider, buildChatRequest, readChatResponse } from '../src/models.js';

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
