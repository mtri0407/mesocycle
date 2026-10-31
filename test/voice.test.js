import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUpstream, handshake } from '../src/voice.js';

test('voice proxy: the key goes in the handshake frame, never to the browser', () => {
  assert.equal(handshake('k').authorization.accessToken, 'Bearer k');
  assert.deepEqual(readUpstream('{"sessionId":"s"}'), { kind: 'ready' });
  assert.deepEqual(readUpstream('{"type":"transcript","transcript":"hi","final":true,"extra":1}'), { kind: 'send', msg: { type: 'transcript', text: 'hi', final: true } });
  assert.deepEqual(readUpstream('{"type":"error","message":"secret detail"}'), { kind: 'send', msg: { type: 'error' } });
  assert.deepEqual(readUpstream('{"type":"speechComplete","turnId":0,"transcript":"hi there"}'), { kind: 'send', msg: { type: 'turn', text: 'hi there' } });
  assert.equal(readUpstream('{"type":"audioProgress"}').kind, 'ignore');
  assert.equal(readUpstream('not json').kind, 'ignore');
  assert.equal(handshake('k').mode, 'PUSH_TO_TALK');
  assert.equal(handshake('k', true).mode, 'ENDPOINTING');
});
