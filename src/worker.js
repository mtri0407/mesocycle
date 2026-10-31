// Cloudflare Worker: only what the browser cannot do alone, which is calling
// models (API keys live here, never in the browser), accounts and reminders.
// Planning itself runs in the browser, from public/core/. The agent runs the
// same code here, so a tool call is checked by the same rules on both sides.
import { chat, chatSafe, transcribe } from './models.js';
import { runAgent, noDashes } from './agent.js';
import { view } from '../public/core/handlers.js';
import { SETUP_PROMPT, BUILD_WEEK, validateWeek, buildDay, CHECKIN_PROMPT, checkinBrief, mondayOf, weekReview, NEXT_WEEK_PROMPT, PLAN_NEXT_WEEK, nextWeekBrief, validateNext } from '../public/core/setup.js';
import { verifyGoogleToken, createSession, sessionUser, loadData, saveData, deleteData, recordConsent } from './auth.js';
import { voiceProxy } from './voice.js';
import { saveReminders, deleteReminders, sendDue } from './push.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const AGENT_EFFORT = 'low'; // docs/BENCHMARK.md: the lowest level that kept the score

// Guard for routes that call a model or write to KV: a limit per visitor and
// per network (Cloudflare rate limit bindings), and a daily ceiling (KV).
const AI_ROUTES = ['/api/agent', '/api/setup', '/api/transcribe', '/api/checkin', '/api/model-check', '/api/feedback', '/api/reminders'];
const MAX_IMAGE_CHARS = 8e6;
const SOFT_CAP = 1200; // about 10 USD a day of Meta credit; past it, the open model answers
const HARD_CAP = 3000;
const RATE_ERROR = { ok: false, code: 'rate', error: 'Too many requests. Wait a minute and try again.' };
async function aiGuard(request, env, url) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  // Per person, not per network: judges in one office share an IP. A loose
  // limit per IP remains, so a made-up visitor id does not buy much.
  const claimed = request.headers.get('x-visitor') || url.searchParams.get('v') || '';
  const visitor = /^[a-z0-9]{8,40}$/.test(claimed) ? claimed : ip;
  if (env.AI_IP_LIMIT && !(await env.AI_IP_LIMIT.limit({ key: ip })).success) return { blocked: json(RATE_ERROR, 429) };
  if (env.AI_LIMIT && !(await env.AI_LIMIT.limit({ key: visitor })).success) return { blocked: json(RATE_ERROR, 429) };
  // This counter is only a ceiling on spending. KV allows 1,000 writes a day on
  // the free plan, so it counts in steps of 5, and a KV failure never stops the AI.
  if (env.FEEDBACK) {
    try {
      const key = `calls:${new Date().toISOString().slice(0, 10)}`;
      const n = Number(await env.FEEDBACK.get(key)) || 0;
      if (n >= HARD_CAP) return { blocked: json({ ok: false, code: 'cap', error: 'The demo hit its daily AI limit. Try again tomorrow, or watch the video.' }, 429) };
      if (Math.random() < 0.2) await env.FEEDBACK.put(key, String(n + 5), { expirationTtl: 3 * 86400 });
      return { overBudget: n >= SOFT_CAP };
    } catch { /* see above */ }
  }
  return {};
}

// One real model call per provider, at most every 10 minutes. The monitor in
// .github/workflows/uptime.yml reads this.
let health = { at: 0, body: null };
async function deepHealth(env) {
  if (Date.now() - health.at < 600_000) return health.body;
  const probe = (p) => chat(env, { messages: [{ role: 'user', content: 'Reply with exactly: ok' }], maxTokens: 1000, effort: 'minimal', timeoutMs: 20_000 }, p).then((o) => !!o.text, () => false);
  const [meta, open] = await Promise.all([probe('meta'), probe('open')]);
  health = { at: Date.now(), body: { ok: meta && open, meta, open } };
  return health.body;
}

export default {
  // Every 5 minutes: wake the browsers that have a block starting now.
  scheduled(event, env, ctx) { ctx.waitUntil(sendDue(env, Date.now())); },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      let overBudget = false;
      if ((request.method === 'POST' || url.pathname === '/api/model-check') && AI_ROUTES.includes(url.pathname)) {
        const guard = await aiGuard(request, env, url);
        if (guard.blocked) return guard.blocked;
        overBudget = !!guard.overBudget;
      }

      // Live voice: a WebSocket through this Worker, which holds the key.
      if (url.pathname === '/api/voice') {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ ok: false, error: 'WebSocket only' }, 426);
        const { blocked } = await aiGuard(request, env, url);
        return blocked || await voiceProxy(env, url.searchParams.get('call') === '1');
      }

      // Voice check-in: the browser sends a WAV clip, we return the text.
      if (url.pathname === '/api/transcribe' && request.method === 'POST') {
        const wav = await request.arrayBuffer();
        if (wav.byteLength > 32e6) return json({ ok: false, error: 'Recording too long' }, 413);
        return json({ ok: true, ...(await transcribe(env, wav)) });
      }

      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      if (request.method === 'POST' && !body) return json({ ok: false, error: 'Body must be JSON' }, 400);
      if (body?.image?.length > MAX_IMAGE_CHARS) return json({ ok: false, error: 'Image too large' }, 413);

      if (url.pathname === '/api/health') {
        if (url.searchParams.get('deep') !== '1') return json({ ok: true, provider: env.MODEL_PROVIDER || 'meta' });
        const { blocked } = await aiGuard(request, env, url);
        if (blocked) return blocked;
        const body = await deepHealth(env);
        return json(body, body.ok ? 200 : 503);
      }

      if (url.pathname === '/api/model-check') {
        const out = await chat(env, {
          messages: [{ role: 'user', content: 'Reply with exactly: Mesocycle is alive.' }],
          maxTokens: 1000, // reasoning models think first; a small limit leaves no answer
          effort: 'minimal',
        }, url.searchParams.get('provider'));
        return json({ ok: true, provider: out.provider, ms: out.ms, text: out.text });
      }

      // Text, voice and photos go to the agent.
      if (url.pathname === '/api/agent' && body) {
        const chosen = body.provider === 'open' ? 'open' : 'meta';
        const provider = overBudget ? 'open' : chosen;
        if (body.image && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(body.image)) return json({ ok: false, error: 'Image must be a JPEG, PNG, WebP or GIF data URL' }, 400);
        let modelMs = 0, usedProvider = provider, fellBack = false;
        const chatFn = async (messages, tools) => {
          const out = await chatSafe(env, { messages, tools, maxTokens: 4000, effort: AGENT_EFFORT }, provider);
          modelMs += out.ms;
          usedProvider = out.provider;
          fellBack = fellBack || !!out.fellBack;
          return out;
        };
        // Only short plain turns are kept as memory of the conversation.
        const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
          .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
          .map((m) => ({ role: m.role, content: m.content.slice(0, 1000) }));
        const args = { state: body.state, userText: String(body.text || '').slice(0, 2000), chatFn, image: body.image || null, history, template: body.template || null, pending: body.pending || null, weekday: body.weekday ?? 0, call: !!body.call };
        if (!body.stream) {
          const out = await runAgent(args);
          return json({ ok: true, ...out, modelMs, provider: usedProvider, fellBack, view: view(out.state) });
        }
        // Streamed: one JSON line per tool call as it happens, then the result.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const send = (obj) => writer.write(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
        ctx.waitUntil((async () => {
          try {
            const out = await runAgent({ ...args, onStep: (step) => send({ type: 'step', ...step }) });
            await send({ type: 'done', ok: true, ...out, modelMs, provider: usedProvider, fellBack, view: view(out.state) });
          } catch (err) {
            await send({ type: 'done', ok: false, error: String(err.message || err) });
          }
          await writer.close();
        })());
        return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
      }

      // Morning check-in: read-only, no tools, so it cannot change the plan.
      if (url.pathname === '/api/checkin' && body) {
        const out = await chatSafe(env, { effort: 'minimal', messages: [
          { role: 'system', content: CHECKIN_PROMPT },
          { role: 'user', content: `Language: ${body.lang === 'vi' ? 'Vietnamese' : 'English'}.\n${checkinBrief(body.template, view(body.state), { weekday: body.weekday, date: body.state.date })}` },
        ], maxTokens: 3000 }, overBudget ? 'open' : 'meta');
        return json({ ok: true, text: noDashes(out.text.trim()) });
      }

      // Set up my week: one description (and maybe a timetable photo) in,
      // a checked weekly template and today's plan out. Invalid arguments go
      // back to the model with the reasons, at most 3 tries.
      // Plan next week from how the last one went. This only proposes: the
      // browser shows old and new hours, and nothing applies until approved.
      if (url.pathname === '/api/setup' && body?.previous) {
        const t = body.previous;
        const review = body.review || weekReview(t);
        const messages = [{ role: 'system', content: NEXT_WEEK_PROMPT }, { role: 'user', content: `Language: ${body.lang === 'vi' ? 'Vietnamese' : 'English'}.\nLast week:\n${nextWeekBrief(t, review)}\n\n${String(body.text || '').slice(0, 2000)}` }];
        const steps = [];
        let modelMs = 0;
        for (let i = 0; i < 3; i++) {
          const out = await chatSafe(env, { messages, tools: [PLAN_NEXT_WEEK], maxTokens: 6000, effort: 'low', timeoutMs: 45_000 }, overBudget ? 'open' : 'meta');
          modelMs += out.ms;
          const call = out.toolCalls.find((c) => c.name === 'plan_next_week');
          if (!call) { messages.push({ role: 'assistant', content: out.text || '' }, { role: 'user', content: 'Call plan_next_week now.' }); steps.push({ ok: false, error: 'no plan_next_week call' }); continue; }
          const v = validateNext(t, call.args);
          steps.push({ ok: !v.errors, error: v.errors?.join(' ') });
          if (!v.errors) return json({ ok: true, next: v.next, steps, modelMs });
          messages.push({ role: 'assistant', content: out.message?.content ?? '', tool_calls: out.message?.tool_calls });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: v.errors }) });
        }
        return json({ ok: false, error: 'Could not plan next week, try again.', steps, modelMs }, 422);
      }

      if (url.pathname === '/api/setup' && body) {
        const text = String(body.text || '').trim().slice(0, 4000);
        if (!text && !body.image) return json({ ok: false, error: 'Describe your week first' }, 400);
        if (body.image && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(body.image)) return json({ ok: false, error: 'Image must be a JPEG, PNG, WebP or GIF data URL' }, 400);
        const intro = `Today is ${body.date} (weekday ${body.weekday}, 0=Sunday).\n\n${text || 'Build my week from this timetable.'}`;
        const user = body.image
          ? { role: 'user', content: [{ type: 'text', text: intro }, { type: 'image_url', image_url: { url: body.image } }] }
          : { role: 'user', content: intro };
        const messages = [{ role: 'system', content: SETUP_PROMPT }, user];
        const steps = [];
        let modelMs = 0;
        for (let i = 0; i < 3; i++) {
          const out = await chatSafe(env, { messages, tools: [BUILD_WEEK], maxTokens: 6000, effort: 'low', timeoutMs: 45_000 }, overBudget ? 'open' : 'meta');
          modelMs += out.ms;
          const call = out.toolCalls.find((c) => c.name === 'build_week');
          if (!call) { messages.push({ role: 'assistant', content: out.text || '' }, { role: 'user', content: 'Call build_week now.' }); steps.push({ ok: false, error: 'no build_week call' }); continue; }
          const v = validateWeek(call.args);
          steps.push({ ok: !v.errors, error: v.errors?.join(' ') });
          if (!v.errors) {
            v.template.weekStart = mondayOf(body.date);
            const state = buildDay(v.template, { date: body.date, weekday: body.weekday, now: body.now });
            return json({ ok: true, template: v.template, state, view: view(state), steps, modelMs });
          }
          messages.push({ role: 'assistant', content: out.message?.content ?? '', tool_calls: out.message?.tool_calls });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: v.errors }) });
        }
        return json({ ok: false, error: 'Could not build a valid week, try describing it again.', steps, modelMs }, 422);
      }

      // Reminders: a push address and today's times, never task names.
      if (url.pathname === '/api/reminders' && body) {
        if (body.off) await deleteReminders(env, String(body.endpoint));
        else await saveReminders(env, { endpoint: String(body.endpoint), times: body.times });
        return json({ ok: true });
      }

      // Accounts: Google sign-in, then one saved plan per person.
      if (url.pathname === '/api/config') {
        return json({ ok: true, googleClientId: env.GOOGLE_CLIENT_ID || null, vapidPublic: env.VAPID_JWK ? env.VAPID_PUBLIC : null });
      }
      if (url.pathname === '/api/login' && body) {
        if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: 'Sign-in is not set up yet' }, 503);
        if (!body.consent) return json({ ok: false, error: 'Please confirm you are 18 or older and agree to the privacy policy.' }, 400);
        try {
          const claims = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
          const { sid, user } = await createSession(env, claims);
          await recordConsent(env, user, body.consent);
          return json({ ok: true, sid, user: { name: user.name, email: user.email }, data: await loadData(env, user) });
        } catch (err) {
          return json({ ok: false, error: String(err.message || err) }, 401);
        }
      }
      if (url.pathname === '/api/data') {
        const user = await sessionUser(request, env);
        if (!user) return json({ ok: false, code: 'auth', error: 'Please sign in again' }, 401);
        if (request.method === 'GET') return json({ ok: true, user: { name: user.name, email: user.email }, data: await loadData(env, user) });
        if (request.method === 'DELETE') { await deleteData(env, user); return json({ ok: true }); }
        if (request.method === 'POST' && body) {
          await saveData(env, user, { mode: body.mode, template: body.template, state: body.state, stats: body.stats });
          return json({ ok: true });
        }
      }
      if (url.pathname === '/api/logout' && body) {
        const user = await sessionUser(request, env);
        if (user) await env.FEEDBACK.delete(`sess:${user.sid}`);
        return json({ ok: true });
      }

      // Feedback from testers: short text, stored in KV, never shown publicly.
      if (url.pathname === '/api/feedback' && body) {
        const text = String(body.text || '').trim().slice(0, 2000);
        if (!text) return json({ ok: false, error: 'Empty feedback' }, 400);
        const key = `${new Date().toISOString()}-${crypto.randomUUID().slice(0, 8)}`;
        await env.FEEDBACK.put(key, JSON.stringify({ text, lang: body.lang || '', rating: body.rating ?? null }));
        return json({ ok: true });
      }

      return json({ ok: false, error: 'Not found' }, 404);
    } catch (err) {
      return json({ ok: false, error: String(err.message || err) }, 500);
    }
  },
};
