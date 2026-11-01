// One small layer in front of every model call.
// Meta Model API and Baseten both speak the OpenAI "Chat Completions" format,
// so the rest of the app never needs to know which model is answering.

export const PROVIDERS = {
  meta: {
    label: 'Muse Spark 1.3 (Meta Model API)',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    keyName: 'MODEL_API_KEY',
    cacheKey: 'mesocycle-v1',
  },
  open: {
    label: 'Muse Spark Open (open weights, served by Baseten)',
    baseUrl: 'https://inference.baseten.co/v1',
    model: 'meta-models/muse-spark-open-1026',
    keyName: 'BASETEN_API_KEY',
    efforts: { minimal: 'low' }, // Muse Spark Open has no minimal level
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
export function buildChatRequest(provider, { messages, tools, maxTokens = 800, effort, format }) {
  const body = { model: provider.model, messages, max_tokens: maxTokens };
  if (tools && tools.length) body.tools = tools;
  if (effort) body.reasoning_effort = provider.efforts?.[effort] || effort;
  if (format) body.response_format = format;
  if (provider.cacheKey) body.prompt_cache_key = provider.cacheKey; // same prefix, same cache, cheaper and faster
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
  return { text: msg.content || '', toolCalls, message: msg, usage: json.usage };
}

// Failures that are the provider's, not ours: trying the other model can help.
// 401, 402 and 403 belong here because a key or credit running out at one
// provider must not take the app down while the other one can answer.
const SWITCH_ON = new Set([401, 402, 403, 404, 408, 429, 500, 502, 503, 504, 529]);

export async function chat(env, opts, override) {
  const provider = pickProvider(env, override);
  const { url, init } = buildChatRequest(provider, opts);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs || 30_000) });
  } catch (err) {
    throw Object.assign(new Error(`${provider.label}: ${err.message}`), { canSwitch: true });
  }
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`${provider.label} HTTP ${res.status}: ${raw.slice(0, 300)}`), { status: res.status, canSwitch: SWITCH_ON.has(res.status) });
  let json;
  try { json = readChatResponse(JSON.parse(raw)); }
  catch { throw Object.assign(new Error(`${provider.label}: unreadable answer`), { canSwitch: true }); }
  return { provider: provider.name, ms: Date.now() - started, ...json };
}

// After Meta fails, this copy of the Worker leaves it alone for a minute. A
// stalled provider would otherwise cost every model call of a turn its full
// timeout, one after another, while the person waits.
const REST_MS = 60_000;
let metaRestsUntil = 0;
export const wakeMeta = () => { metaRestsUntil = 0; };

// Meta first, Muse Spark Open if Meta fails. Never the other way round: a
// person who chose the open model chose where their words go.
export async function chatSafe(env, opts, prefer) {
  const first = prefer || env.MODEL_PROVIDER || 'meta';
  const backup = first === 'meta' && !!env.BASETEN_API_KEY;
  // The last resort, so it gets more time than a first try.
  const openModel = async () => ({ ...(await chat(env, { ...opts, timeoutMs: 2 * (opts.timeoutMs || 30_000) }, 'open')), fellBack: true });
  if (backup && Date.now() < metaRestsUntil) return openModel();
  try {
    return await chat(env, opts, first);
  } catch (err) {
    if (!backup || !err.canSwitch) throw err;
    metaRestsUntil = Date.now() + REST_MS;
    opts.onSwitch?.();
    return openModel();
  }
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
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (!res.ok) throw Object.assign(new Error(`Muse Voice Transcribe HTTP ${res.status}: ${raw.slice(0, 300)}`), { status: res.status });
  const text = raw.split('\n').map((l) => l.replace(/^[A-Za-z]+:/, '').trim()).filter(Boolean).join(' ');
  return { text, ms: Date.now() - started };
}
