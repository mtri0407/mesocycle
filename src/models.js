// One small layer in front of every model call.
// Meta Model API and Baseten both speak the OpenAI "Chat Completions" format,
// so the rest of the app never needs to know which model is answering.

export const PROVIDERS = {
  meta: {
    label: 'Muse Spark 1.3 (Meta Model API)',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    keyName: 'MODEL_API_KEY',
  },
  open: {
    label: 'Muse Spark Open (open weights, served by Baseten)',
    baseUrl: 'https://inference.baseten.co/v1',
    model: 'meta-models/muse-spark-open-1026',
    keyName: 'BASETEN_API_KEY',
  },
};

export function pickProvider(env, override) {
  const name = override || env.MODEL_PROVIDER || 'meta';
  const p = PROVIDERS[name];
  if (!p) throw new Error(`Unknown model provider "${name}". Use "meta" or "open".`);
  const key = env[p.keyName];
  if (!key) throw new Error(`Missing ${p.keyName}. Put it in .dev.vars (local) or run: wrangler secret put ${p.keyName}`);
  return { name, ...p, key };
}

// Builds the HTTP request without sending it, so tests can check it offline.
export function buildChatRequest(provider, { messages, tools, maxTokens = 800 }) {
  const body = { model: provider.model, messages, max_tokens: maxTokens };
  if (tools && tools.length) body.tools = tools;
  return {
    url: `${provider.baseUrl}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.key}`,
      },
      body: JSON.stringify(body),
    },
  };
}

// Reads the first choice into a shape the agent can use:
// { text, toolCalls: [{ id, name, args }] }. Bad tool arguments are kept as
// args=null with the raw string, because the model's JSON is not guaranteed.
export function readChatResponse(json) {
  const msg = json?.choices?.[0]?.message;
  if (!msg) throw new Error('Model returned no message');
  const toolCalls = (msg.tool_calls || []).map((c) => {
    let args = null;
    try { args = JSON.parse(c.function?.arguments || '{}'); } catch { /* keep null */ }
    return { id: c.id, name: c.function?.name, args, rawArgs: c.function?.arguments };
  });
  return { text: msg.content || '', toolCalls, message: msg };
}

export async function chat(env, opts, override) {
  const provider = pickProvider(env, override);
  const { url, init } = buildChatRequest(provider, opts);
  const started = Date.now();
  const res = await fetch(url, init);
  const raw = await res.text();
  if (!res.ok) throw new Error(`${provider.label} HTTP ${res.status}: ${raw.slice(0, 300)}`);
  return { provider: provider.name, ms: Date.now() - started, ...readChatResponse(JSON.parse(raw)) };
}

// Muse Voice Transcribe: one recorded clip (WAV) in, plain text out.
// Asking for text/plain gives one line per turn, sometimes prefixed with a
// speaker label such as "A:" or "unknown:", which we strip.
export async function transcribe(env, wav) {
  if (!env.MODEL_API_KEY) throw new Error('Missing MODEL_API_KEY for voice transcription.');
  const form = new FormData();
  form.append('request', new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], { type: 'application/json' }));
  form.append('audio', new Blob([wav], { type: 'audio/wav' }), 'checkin.wav');
  const started = Date.now();
  const res = await fetch('https://api.meta.ai/v1/asr/transcribe', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MODEL_API_KEY}`, Accept: 'text/plain' },
    body: form,
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`Muse Voice Transcribe HTTP ${res.status}: ${raw.slice(0, 300)}`);
  const text = raw.split('\n').map((l) => l.replace(/^[A-Za-z]+:/, '').trim()).filter(Boolean).join(' ');
  return { text, ms: Date.now() - started };
}
