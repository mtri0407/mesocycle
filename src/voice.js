// Live speech to text. The browser cannot hold the API key, so it talks to
// this Worker over a WebSocket and the Worker talks to Muse Voice Transcribe.
// The Worker only passes audio up and transcripts down; nothing is stored.
const MAX_SESSION_MS = 120_000;
const MAX_CALL_MS = 600_000;
const MAX_FRAME_BYTES = 64_000;

export const handshake = (key, call = false, keywords = []) => ({
  authorization: { accessToken: `Bearer ${key}` },
  audioEncoding: 'PCM_24KHZ',
  model: 'muse-voice-transcribe-1.0',
  mode: call ? 'ENDPOINTING' : 'PUSH_TO_TALK', // a call needs the model to hear when a turn ends
  languageBias: ['Vietnamese', 'English'],
  ...(keywords.length ? { keywords } : {}),
});

// The only frame without a type is the handshake reply. Everything else that
// reaches the browser is a transcript or an error, in a fixed shape.
export function readUpstream(text) {
  let m;
  try { m = JSON.parse(text); } catch { return { kind: 'ignore' }; }
  if (!m.type) return { kind: 'ready' };
  if (m.type === 'transcript') return { kind: 'send', msg: { type: 'transcript', text: String(m.transcript || ''), final: !!m.final } };
  // In a call, speechComplete is the signal that a whole turn was heard.
  if (m.type === 'speechComplete') return { kind: 'send', msg: { type: 'turn', text: String(m.transcript || '') } };
  if (m.type === 'error') return { kind: 'send', msg: { type: 'error' } };
  return { kind: 'ignore' };
}

// Muse Voice Transcribe refuses the whole session if one keyword is longer
// than 30 characters (measured on the live API, 04/11). A task name is cut at a
// word boundary instead, and the same keyword is not sent twice.
export const MAX_KEYWORD = 30;
export function shortKeyword(k) {
  const s = k.replace(/\s+/g, ' ').trim();
  if (s.length <= MAX_KEYWORD) return s;
  const cut = s.slice(0, MAX_KEYWORD + 1).replace(/\s+\S*$/, '');
  return (cut && cut.length <= MAX_KEYWORD ? cut : s.slice(0, MAX_KEYWORD)).replace(/[\s:,;(.-]+$/, '');
}
export function readKeywords(text) {
  try {
    const { keywords } = JSON.parse(text);
    const list = (Array.isArray(keywords) ? keywords : []).filter((k) => typeof k === 'string' && k.trim()).map(shortKeyword).filter(Boolean);
    return [...new Set(list)].slice(0, 40);
  } catch { return []; }
}

export async function voiceProxy(env, call = false) {
  if (!env.MODEL_API_KEY) throw new Error('Missing MODEL_API_KEY for voice transcription.');
  const res = await fetch('https://api.meta.ai/v1/asr/realtime', { headers: { Upgrade: 'websocket' } });
  const meta = res.webSocket;
  if (!meta) throw new Error(`Voice connection failed: HTTP ${res.status}`);
  const [client, server] = Object.values(new WebSocketPair());
  meta.accept();
  server.accept();

  let ready = false;
  const waiting = [];
  const toMeta = (data) => { if (ready) meta.send(data); else waiting.push(data); };
  const closeAll = () => {
    clearTimeout(timer);
    try { server.close(1000, 'done'); } catch { /* already closed */ }
    try { meta.close(1000, 'done'); } catch { /* already closed */ }
  };
  const timer = setTimeout(closeAll, call ? MAX_CALL_MS : MAX_SESSION_MS);

  // Workers hand binary frames over as Blobs. Reading one takes a moment, so
  // frames go through a chain to reach Meta in the order they were spoken.
  let order = Promise.resolve();
  server.addEventListener('message', ({ data }) => {
    order = order.then(async () => {
      if (typeof data === 'string') {
        if (data === '{"type":"endStream"}') toMeta(data);
        else start(readKeywords(data));
        return;
      }
      const audio = data instanceof Blob ? await data.arrayBuffer() : data;
      if (audio.byteLength <= MAX_FRAME_BYTES) toMeta(audio);
    }).catch(closeAll);
  });
  meta.addEventListener('message', ({ data }) => {
    if (typeof data !== 'string') return;
    const r = readUpstream(data);
    if (r.kind === 'ready') {
      ready = true;
      waiting.splice(0).forEach((d) => meta.send(d));
    } else if (r.kind === 'send') server.send(JSON.stringify(r.msg));
  });
  server.addEventListener('close', closeAll);
  server.addEventListener('error', closeAll);
  meta.addEventListener('close', closeAll);
  meta.addEventListener('error', closeAll);

  // The browser may first send words from the plan (role and task names) so
  // they are heard correctly. It gets half a second, then the session starts.
  let started = false;
  const start = (keywords) => {
    if (started) return;
    started = true;
    meta.send(JSON.stringify(handshake(env.MODEL_API_KEY, call, keywords)));
  };
  setTimeout(() => start([]), 500);
  return new Response(null, { status: 101, webSocket: client });
}
