import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUpstream, handshake } from '../src/voice.js';

test('voice proxy: the key goes in the handshake frame, never to the browser', () => {
  assert.equal(handshake('k').authorization.accessToken, 'Bearer k');
  assert.deepEqual(readUpstream('{"sessionId":"s"}'), { kind: 'ready' });
  assert.deepEqual(readUpstream('{"type":"transcript","transcript":"hi","final":true,"extra":1}'), { kind: 'send', msg: { type: 'transcript', text: 'hi', final: true } });
  assert.deepEqual(readUpstream('{"type":"error","message":"secret detail"}'), { kind: 'send', msg: { type: 'error' } });
  assert.equal(readUpstream('not json').kind, 'ignore');
});
