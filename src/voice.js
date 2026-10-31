// Live speech to text. The browser cannot hold the API key, so it talks to
// this Worker over a WebSocket and the Worker talks to Muse Voice Transcribe.
// The Worker only passes audio up and transcripts down; nothing is stored.
const MAX_SESSION_MS = 120_000;
const MAX_FRAME_BYTES = 64_000;

export const handshake = (key) => ({
  authorization: { accessToken: `Bearer ${key}` },
  audioEncoding: 'PCM_24KHZ',
  model: 'muse-voice-transcribe-1.0',
  mode: 'PUSH_TO_TALK',
});

// The only frame without a type is the handshake reply. Everything else that
// reaches the browser is a transcript or an error, in a fixed shape.
export function readUpstream(text) {
  let m;
  try { m = JSON.parse(text); } catch { return { kind: 'ignore' }; }
  if (!m.type) return { kind: 'ready' };
  if (m.type === 'transcript') return { kind: 'send', msg: { type: 'transcript', text: String(m.transcript || ''), final: !!m.final } };
  if (m.type === 'error') return { kind: 'send', msg: { type: 'error' } };
  return { kind: 'ignore' };
}

export async function voiceProxy(env) {
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
  const timer = setTimeout(closeAll, MAX_SESSION_MS);

  // Workers hand binary frames over as Blobs. Reading one takes a moment, so
  // frames go through a chain to reach Meta in the order they were spoken.
  let order = Promise.resolve();
  server.addEventListener('message', ({ data }) => {
    order = order.then(async () => {
      if (typeof data === 'string') {
        if (data === '{"type":"endStream"}') toMeta(data); // the only text frame allowed through
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

  meta.send(JSON.stringify(handshake(env.MODEL_API_KEY)));
  return new Response(null, { status: 101, webSocket: client });
}
