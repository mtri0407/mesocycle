// Cloudflare Worker: serves the API. The web app itself comes from public/.
// API keys live only here (env), never in the browser.
// For now the browser keeps the plan state and sends it with each request;
// it moves to D1 storage before the live deploy.
import { chat, transcribe } from './models.js';
import { runAgent } from './agent.js';
import { runTool } from './tools.js';
import { applyEvent } from './planner.js';
import { demoState } from './demo-state.js';
import { SETUP_PROMPT, BUILD_WEEK, validateWeek, buildDay, forecastWeek } from './setup.js';
import { replan, toHHMM } from './planner.js';
import { verifyGoogleToken, createSession, sessionUser, loadData, saveData } from './auth.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const view = (state) => runTool(state, 'get_state', {}).result;

// Guard for routes that call a model: at most 12 a minute per visitor
// (Cloudflare rate limit binding) and a daily ceiling for the whole app (KV).
const AI_ROUTES = ['/api/agent', '/api/setup', '/api/transcribe'];
const DAILY_CAP = 3000;
async function aiGuard(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (env.AI_LIMIT) {
    const { success } = await env.AI_LIMIT.limit({ key: ip });
    if (!success) return json({ ok: false, code: 'rate', error: 'Too many requests. Wait a minute and try again.' }, 429);
  }
  if (env.FEEDBACK) {
    const key = `calls:${new Date().toISOString().slice(0, 10)}`;
    const n = Number(await env.FEEDBACK.get(key)) || 0;
    if (n >= DAILY_CAP) return json({ ok: false, code: 'cap', error: 'The demo hit its daily AI limit. Try again tomorrow, or watch the video.' }, 429);
    await env.FEEDBACK.put(key, String(n + 1), { expirationTtl: 3 * 86400 });
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && AI_ROUTES.includes(url.pathname)) {
        const blocked = await aiGuard(request, env);
        if (blocked) return blocked;
      }

      // Voice check-in: the browser sends a WAV clip, we return the text.
      if (url.pathname === '/api/transcribe' && request.method === 'POST') {
        const wav = await request.arrayBuffer();
        if (wav.byteLength > 32e6) return json({ ok: false, error: 'Recording too long' }, 413);
        return json({ ok: true, ...(await transcribe(env, wav)) });
      }

      const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
      if (request.method === 'POST' && !body) return json({ ok: false, error: 'Body must be JSON' }, 400);

      if (url.pathname === '/api/health') {
        return json({ ok: true, provider: env.MODEL_PROVIDER || 'meta' });
      }

      if (url.pathname === '/api/model-check') {
        const out = await chat(env, {
          messages: [{ role: 'user', content: 'Reply with exactly: Mesocycle is alive.' }],
          maxTokens: 400, // reasoning models think first; 30 tokens ran out before any answer
        }, url.searchParams.get('provider'));
        return json({ ok: true, provider: out.provider, ms: out.ms, text: out.text });
      }

      // Fresh demo day. ?now=HH:MM sets the clock for demos.
      if (url.pathname === '/api/demo') {
        const [h, m] = (url.searchParams.get('now') || '07:00').split(':').map(Number);
        const state = demoState(h * 60 + m, url.searchParams.get('lang') === 'vi' ? 'vi' : 'en');
        return json({ ok: true, state, view: view(state) });
      }

      // Buttons on the Now card (done, more time, skip) run a tool directly, no model needed.
      if (url.pathname === '/api/tool' && body) {
        const res = runTool(body.state, body.name, body.args || {});
        return json({ ok: res.ok, error: res.error, state: res.state, view: view(res.state) });
      }

      // The user approved one option of a cut proposal.
      if (url.pathname === '/api/approve' && body) {
        const state = applyEvent(body.state, { type: 'cut', ids: body.ids });
        return json({ ok: true, state, view: view(state) });
      }

      // Free text (later: voice) goes to the agent.
      if (url.pathname === '/api/agent' && body) {
        // Photos always go to Muse Spark (image understanding).
        const provider = body.image ? 'meta' : body.provider || url.searchParams.get('provider');
        if (body.image && !/^data:image\/(jpeg|jpg|png|webp|gif);base64,/.test(body.image)) return json({ ok: false, error: 'Image must be a JPEG, PNG, WebP or GIF data URL' }, 400);
        let modelMs = 0;
        const chatFn = async (messages, tools) => {
          const out = await chat(env, { messages, tools, maxTokens: 4000 }, provider);
          modelMs += out.ms;
          return out;
        };
        const args = { state: body.state, userText: String(body.text || '').slice(0, 2000), chatFn, image: body.image || null };
        if (!body.stream) {
          const out = await runAgent(args);
          return json({ ok: true, ...out, modelMs, view: view(out.state) });
        }
        // Streamed: one JSON line per tool call as it happens, then the result.
        const { readable, writable } = new TransformStream();
        const writer = writable.getWriter();
        const send = (obj) => writer.write(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
        ctx.waitUntil((async () => {
          try {
            const out = await runAgent({ ...args, onStep: (step) => send({ type: 'step', ...step }) });
            await send({ type: 'done', ok: true, ...out, modelMs, view: view(out.state) });
          } catch (err) {
            await send({ type: 'done', ok: false, error: String(err.message || err) });
          }
          await writer.close();
        })());
        return new Response(readable, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
      }

      // Set up my week: one description (and maybe a timetable photo) in,
      // a checked weekly template and today's plan out. Invalid arguments go
      // back to the model with the reasons, at most 3 tries.
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
          const out = await chat(env, { messages, tools: [BUILD_WEEK], maxTokens: 6000 }, 'meta');
          modelMs += out.ms;
          const call = out.toolCalls.find((c) => c.name === 'build_week');
          if (!call) { messages.push({ role: 'assistant', content: out.text || '' }, { role: 'user', content: 'Call build_week now.' }); steps.push({ ok: false, error: 'no build_week call' }); continue; }
          const v = validateWeek(call.args);
          steps.push({ ok: !v.errors, error: v.errors?.join(' ') });
          if (!v.errors) {
            const state = buildDay(v.template, { date: body.date, weekday: body.weekday, now: body.now });
            return json({ ok: true, template: v.template, state, view: view(state), steps, modelMs });
          }
          messages.push({ role: 'assistant', content: out.message?.content ?? '', tool_calls: out.message?.tool_calls });
          messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ error: v.errors }) });
        }
        return json({ ok: false, error: 'Could not build a valid week, try describing it again.', steps, modelMs }, 422);
      }

      // Today's plan from a saved weekly template (a new day, or after edits).
      if (url.pathname === '/api/day' && body) {
        const state = buildDay(body.template, { date: body.date, weekday: body.weekday, now: body.now });
        return json({ ok: true, state, view: view(state) });
      }

      // Rest-of-week forecast: where today's debt and open work would land.
      // Demo mode has no weekly template, so today's debt is the backlog.
      if (url.pathname === '/api/week' && body) {
        const s = body.state;
        const placed = replan(s).placed.map((p) => p.id);
        const template = body.template || {
          roles: s.roles,
          fixed: [],
          tasks: s.queue.filter((q) => q.status === 'skipped' || q.status === 'cut' || (q.status === 'todo' && !placed.includes(q.id)))
            .map((q) => ({ ...q, status: 'todo' })),
          wake: toHHMM(s.settings.wake),
          sleep: toHHMM(s.settings.sleep),
        };
        const done = s.queue.filter((q) => q.status === 'done').map((q) => q.id);
        return json({ ok: true, ...forecastWeek(template, { weekday: body.weekday, exclude: [...placed, ...done] }) });
      }

      // Accounts: Google sign-in, then one saved plan per person.
      if (url.pathname === '/api/config') {
        return json({ ok: true, googleClientId: env.GOOGLE_CLIENT_ID || null });
      }
      if (url.pathname === '/api/login' && body) {
        if (!env.GOOGLE_CLIENT_ID) return json({ ok: false, error: 'Sign-in is not set up yet' }, 503);
        try {
          const claims = await verifyGoogleToken(body.credential, env.GOOGLE_CLIENT_ID);
          const { sid, user } = await createSession(env, claims);
          return json({ ok: true, sid, user: { name: user.name, email: user.email }, data: await loadData(env, user) });
        } catch (err) {
          return json({ ok: false, error: String(err.message || err) }, 401);
        }
      }
      if (url.pathname === '/api/data') {
        const user = await sessionUser(request, env);
        if (!user) return json({ ok: false, code: 'auth', error: 'Please sign in again' }, 401);
        if (request.method === 'GET') return json({ ok: true, user: { name: user.name, email: user.email }, data: await loadData(env, user) });
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
