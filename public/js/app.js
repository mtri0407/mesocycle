// The app: screens and accounts. Planning itself lives in /core, and larger
// features live in their own files next to this one.
import { $, esc, store } from '/js/dom.js';
import { handlers } from '/core/handlers.js';
import { replan, applyEvent } from '/core/planner.js';
import { checkPlan } from '/core/invariants.js';
import { deadlineRadar } from '/core/radar.js';
import { T } from '/js/strings.js';
import { planDiff, isEmptyDiff } from '/core/diff.js';
import { shareWeek } from '/js/picture.js';
import { setupReminders, setVapidKey, renderRemind, syncReminders } from '/js/reminders.js';
import { setupEditors, renderEditors, hasDraft, dropDraft } from '/js/editors.js';
import { setupImport, renderImport, clearImport } from '/js/importer.js';
import { setupVoice, inCall, micLabels } from '/js/voice.js';
import { setupFocus, nowButtons, renderFocusBar, renderLog, startFocus, stopFocus, dropFocus, focusOn, focusRunning } from '/js/focus.js';
import { setupPhases, phasesHtml, wirePhases, clearPhaseDrafts } from '/js/phases-ui.js';
import { setupTour, startTour, endTour } from '/js/tour.js';


const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Two modes: 'demo' (the author's Friday, demo clock) and 'real' (your week, real time).
let mode = store.get('meso-mode') || 'demo';
let template = null;
try { template = JSON.parse(store.get('meso-template')); } catch {}
let setupImage = null;
// Before 04:00 it is still yesterday: the day ends at bedtime, not at midnight.
const logicalNow = () => { const d = new Date(); const min = d.getHours() * 60 + d.getMinutes(); if (min >= 240) return { d, min }; d.setDate(d.getDate() - 1); return { d, min: min + 1440 }; };
const realNow = () => logicalNow().min;
const today = () => { const { d } = logicalNow(); return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, weekday: d.getDay() }; };
const saveTemplate = () => { if (template) template.updatedAt = Date.now(); store.set('meso-template', JSON.stringify(template)); };
// Times in the view are HH:MM; on a long day, 00:30 comes after 23:00.
const dayMin = (hhmm) => { const m = toMin(hhmm); const s = state?.settings; return s && m < s.wake && m + 1440 < s.sleep ? m + 1440 : m; };
function setMode(m) { mode = m; store.set('meso-mode', m); $('real-row').hidden = m !== 'real'; $('demo-box').hidden = m === 'real'; renderIntro(); renderGreet(); }

let stats;
try { stats = JSON.parse(store.get('meso-stats')) || null; } catch { stats = null; }
stats = { replans: 0, approvals: 0, doneMin: 0, debtRepaidMin: 0, days: [], calls: 0, rescuedDays: [], ...stats };
const saveStats = () => store.set('meso-stats', JSON.stringify(stats));
function count(kind, minutes = 0) {
  if (mode !== 'real' || template?.sample) return;
  const d = today().date;
  if (!stats.days.includes(d)) stats.days.push(d);
  if (kind === 'replan') { stats.replans++; stats.lastReplan = d; }
  if (kind === 'call') stats.calls++;
  // Rescued: the plan broke, it was re-planned, and work still got done that day.
  if (kind === 'done' && stats.lastReplan === d && !stats.rescuedDays.includes(d)) stats.rescuedDays.push(d);
  if (kind === 'approve') stats.approvals++;
  if (kind === 'done') stats.doneMin += minutes;
  if (kind === 'focus') stats.focusMin = (stats.focusMin || 0) + minutes;
  if (kind === 'repaid') stats.debtRepaidMin += minutes;
  saveStats();
}

// A random id for rate limits, so people on one network do not block each other.
let visitorId = store.get('meso-visitor');
if (!visitorId) { visitorId = crypto.randomUUID().replace(/-/g, '').slice(0, 24); store.set('meso-visitor', visitorId); }
const aiHeaders = { 'Content-Type': 'application/json', 'X-Visitor': visitorId };
let sid = store.get('meso-sid');
let account = null, googleClientId = null, saveTimer = null, retryTimer = null;
// Set once the server has answered. Until the saved plan has been read, this
// device writes nothing, so an old copy here cannot replace a newer one there.
let configRead = false, cloudRead = false;
const authHeaders = () => (sid ? { Authorization: `Bearer ${sid}` } : {});
const CONSENT_VERSION = '2026-11-01';
const consented = () => store.get('meso-consent') === CONSENT_VERSION;
function renderConsent() {
  for (const id of ['login-consent', 'setup-consent']) {
    $(id).checked = consented();
    $(id).closest('[data-consent]').hidden = consented();
  }
  $('login-consent').closest('[data-consent]').hidden = consented() || !!sid || !googleClientId;
}
function giveConsent() { store.set('meso-consent', CONSENT_VERSION); renderConsent(); renderAccount(); loadGoogle(); }
function renderAccount() {
  const who = account ? t('signedIn')(account.name) : sid ? t('signedInOffline') : configRead && !googleClientId ? t('authOff') : t('signedOut');
  $('account-text').textContent = who + (stats.days.length ? ' ' + t('statsLine')(stats) : '');
  $('logout').hidden = !sid;
  $('delete-data').hidden = !account;
  $('logout').textContent = t('logout');
  $('gsi').hidden = !!sid || !googleClientId || !consented();
}
let savedSig = '';
// The clock moves every minute; that alone is not worth a write.
const planSig = () => JSON.stringify([template, state?.queue, state?.fixed, stats]);
function scheduleSave() {
  if (!sid || !cloudRead || mode !== 'real' || template?.sample) return;
  const sig = planSig();
  if (sig === savedSig) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(sig), 1500);
}
// A failed save stays visible and tries again; nothing is lost quietly.
function saveNow(sig, keepalive = false) {
  saveTimer = null;
  savedSig = sig;
  fetch('/api/data', { method: 'POST', keepalive, headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ mode, template, state, stats }) })
    .then((r) => {
      if (r.status === 401) { signOutLocal(); return; }
      if (!r.ok) throw new Error('save failed');
      $('save-note').hidden = true;
    })
    .catch(() => {
      savedSig = '';
      $('save-note').hidden = false;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(scheduleSave, 30000);
    });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && saveTimer) { clearTimeout(saveTimer); saveNow(planSig(), true); }
});
function useCloud(data) {
  if (!data || !data.template) return false;
  // Two copies of one plan: the newer one wins, whichever device it is on.
  if ((template?.updatedAt || 0) > (data.template.updatedAt || 0)) {
    // A newer week here, but the screen was on the demo: that day is not this person's.
    if (mode !== 'real') { state = null; store.set('meso-state', ''); }
  } else {
    template = data.template; store.set('meso-template', JSON.stringify(template));
    state = data.state; store.set('meso-state', JSON.stringify(state));
    if (data.stats) { stats = data.stats; saveStats(); }
    savedSig = planSig();
  }
  setMode('real');
  return true;
}
// The server's copy has arrived. If it changes what is on screen, the day
// opens again from it, as a new plan.
async function adoptCloud(data) {
  const was = { mode, template };
  if (useCloud(data) && (was.mode !== 'real' || template !== was.template)) { startPlan(); await openDay(); }
  scheduleSave();
}
function signOutLocal() { sid = null; account = null; cloudRead = false; store.set('meso-sid', ''); renderAccount(); loadGoogle(); }
async function onGoogle(resp) {
  try {
    const data = await api('/api/login', { credential: resp.credential, consent: CONSENT_VERSION });
    sid = data.sid; store.set('meso-sid', sid); account = data.user; cloudRead = true;
    renderAccount();
    renderGreet();
    await adoptCloud(data.data);
  } catch (e) { $('account-text').textContent = e.message; }
}
const getJson = (path, headers = {}) => fetch(path, { headers, signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
// The network part of starting up. It runs after the first draw, and again when
// a connection comes back, so a slow network never holds the plan on screen.
async function connect() {
  if (configRead && (cloudRead || !sid)) return;
  const [config, saved] = await Promise.all([
    configRead ? null : getJson('/api/config'),
    sid && !cloudRead ? getJson('/api/data', authHeaders()) : null,
  ]);
  offline(!config && !saved);
  if (config?.ok) { configRead = true; googleClientId = config.googleClientId; setVapidKey(config.vapidPublic); }
  // Only the server saying no ends a session. Being offline does not.
  if (saved?.ok) { cloudRead = true; account = saved.user; await adoptCloud(saved.data); }
  else if (saved?.code === 'auth') signOutLocal();
  $('save-note').hidden = !sid || cloudRead;
  renderConsent();
  renderAccount();
  renderGreet();
  renderRemind();
  loadGoogle();
}
// Google's script is only fetched for someone about to use its button.
let googleLoaded = false;
function loadGoogle() {
  if (googleLoaded || !googleClientId || sid || !consented()) return;
  googleLoaded = true;
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true;
  s.onload = () => {
    google.accounts.id.initialize({ client_id: googleClientId, callback: onGoogle });
    google.accounts.id.renderButton($('gsi'), { theme: 'outline', size: 'medium', text: 'signin_with', locale: lang });
  };
  document.head.appendChild(s);
}

let lang = store.get('meso-lang') || (navigator.language.startsWith('vi') ? 'vi' : 'en');
let state = null, view = null;
const t = (k) => T[lang][k];

function applyLang() {
  document.documentElement.lang = lang;
  $('lang').textContent = lang === 'vi' ? 'EN' : 'VI';
  renderAccount();
  $('guide').textContent = lang === 'vi' ? 'Hướng dẫn' : 'Guide';
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  $('say').placeholder = t('placeholder');
  $('setup-text').placeholder = t('setupPlaceholder');
  $('say').setAttribute('aria-label', t('changed'));
  $('setup-text').setAttribute('aria-label', t('setupTitle'));
  $('fb-text').setAttribute('aria-label', t('feedback'));
  $('send').setAttribute('aria-label', t('replan'));
  $('send').title = t('replan');
  $('photo').setAttribute('aria-label', t('photo'));
  $('call').setAttribute('aria-label', t('callBtn')); // the label stays when the button folds into a circle
  $('photo').title = t('photo');
  micLabels();
  $('setup-photo-chip').textContent = t('photoAdded');
  renderIntro();
  renderGreet();
  renderChips();
  if (view) { render(); renderExtras(); renderImport(); }
}

function renderIntro() {
  // The intro explains the demo, so it stays out of the way once the week is yours.
  $('intro').hidden = mode === 'real' || store.get('meso-intro') === 'hidden';
  if ($('intro').hidden) return;
  $('intro').innerHTML = `<h1 class="hero">${t('heroA')}<br><span class="grad">${t('heroB')}</span></h1>
    <p class="lead">${t('lead')}</p><p class="note">${t('note')}</p>
    <div class="row"><button class="primary" id="try">${t('tryDemo')}</button><button id="sample-open">${t('sampleBtn')}</button><button id="setup-open">${t('setupBtn')}</button>${ownWeek() ? `<button id="to-week">${t('toWeek')}</button>` : ''}<button id="tour-open">🧭 ${t('tourBtn')}</button><button class="small" id="hide">${t('hideIntro')}</button></div>`;
  $('try').onclick = tryDemo;
  $('tour-open').onclick = startTour;
  $('setup-open').onclick = openSetup;
  $('sample-open').onclick = loadSample;
  $('hide').onclick = () => { store.set('meso-intro', 'hidden'); $('intro').hidden = true; };
  if (ownWeek()) $('to-week').onclick = backToWeek;
}
const ownWeek = () => !!template && !template.sample;

// On your own week the composer is the front page: a greeting, then the question.
function renderGreet() {
  const box = $('greet');
  box.hidden = mode !== 'real';
  if (box.hidden) return;
  const h = new Date().getHours();
  const part = h < 4 ? 'night' : h < 12 ? 'morning' : h < 18 ? 'afternoon' : 'evening';
  const words = String(account?.name || '').trim().split(/\s+/).filter(Boolean);
  const name = words.length ? (lang === 'vi' ? words.at(-1) : words[0]) : '';
  box.innerHTML = `${esc(t('hello')[part])}${name ? `, ${esc(name)}` : ''}.<br><span class="grad">${esc(t('whatChanged'))}</span>`;
}

// Suggestions under the composer, until a conversation starts. On made-up
// plans (the demo, the sample week) they go out without asking for consent:
// nothing personal is in them.
function renderChips() {
  const box = $('chips');
  if (chatLog.length || sendCtl) { box.innerHTML = ''; return; }
  const own = mode === 'real' && !template?.sample;
  // The sample week has its own work, so its chips name what is really on it.
  const list = own ? t('chipsReal') : template?.sample && mode === 'real' ? t('chipsSample')(view?.queue[0]?.title) : t('chipsDemo');
  box.innerHTML = list.map((c, i) => `<button data-chip="${i}">${esc(c)}</button>`).join('');
  box.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { const text = list[Number(b.dataset.chip)]; $('say').value = text; send(text, null, { demo: !own }); };
  });
}

// Moving in a whole week (a file from Greysteel Tasks). It counts as an edit.
async function useWeek(next) {
  store.set('meso-own', '');
  setMode('real');
  startPlan();
  template = next;
  saveTemplate();
  await newDay();
  showTab('today');
}
const changeTemplate = (next) => apply({ template: next });
async function backToWeek() { setMode('real'); state = null; startPlan(); await openDay(); }

const CODES = { rate: 'errRate', cap: 'errCap', region: 'errRegion', ai: 'errAi' };
const errMsg = (d) => (CODES[d?.code] ? t(CODES[d.code]) : d?.error || t('errNet'));
async function api(path, body) {
  // Planning runs here in the browser. Only AI and accounts use the network.
  const [route, query] = path.split('?');
  if (handlers[route]) {
    const data = JSON.parse(JSON.stringify(handlers[route](body || Object.fromEntries(new URLSearchParams(query)))));
    if (!data.ok && !data.state) throw new Error(errMsg(data));
    return data;
  }
  let res;
  // Long enough for three tries at building a week, short enough to never hang.
  try { res = await fetch(path, { ...(body ? { method: 'POST', headers: aiHeaders, body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(150000) }); }
  catch { throw new Error(t('errNet')); }
  const data = await res.json().catch(() => ({}));
  if (!data.ok && !data.state) throw Object.assign(new Error(errMsg(data)), { code: data.code });
  return data;
}

// A result arrives in two steps, so the week can be updated between them and
// everything drawn next (radar, goals, forecast) already counts it.
function adopt(data) {
  if (data.template) { template = data.template; saveTemplate(); }
  if (data.state) state = data.state;
  if (data.view) view = data.view;
}
function draw() {
  if (mode === 'real' && template && state) {
    state.radar = deadlineRadar(template, state, { date: state.date, weekday: realDay() });
    view.deadlines = state.radar;
  }
  store.set('meso-state', JSON.stringify(state));
  render();
  loadWeek();
  scheduleSave();
  syncReminders();
  if (!chatLog.length) renderChips(); // suggestions follow the plan on screen
}
function apply(data) { adopt(data); draw(); }

let weekSeq = 0;
async function loadWeek() {
  const seq = ++weekSeq;
  const weekday = realDay();
  try {
    const f = await api('/api/week', { state, template: mode === 'real' ? template : null, weekday, date: state.date });
    if (seq !== weekSeq) return;
    weekData = f;
    // Debt already, or about to be (does not fit today).
    const debtIds = new Set([...state.queue.filter((q) => q.status === 'skipped' || q.status === 'cut').map((q) => q.id), ...view.doesNotFit.map((x) => x.id)]);
    const item = (i) => `<div class="it ${debtIds.has(i.id) ? 'debt' : ''}" style="${rcStyle(i.roleId)}">${debtIds.has(i.id) ? '↩ ' : ''}${esc(i.title)}</div>`;
    const html = f.days.length ? `<p class="hint" style="margin-top:14px"><b>${t('rest')}</b><br>${t('restHint')}</p><div class="days">${f.days.map((d) => `
      <div class="day"><b>${t('days')[d.weekday]} · ${(d.items.reduce((s, i) => s + i.minutes, 0) / 60).toFixed(1)}h</b>${d.items.slice(0, 4).map(item).join('')}${d.items.length > 4 ? `<div class="it muted">+${d.items.length - 4} ${t('moreN')}</div>` : ''}</div>`).join('')}</div>
      ${f.left.length ? `<p class="hint">${t('leftOver')}: ${f.left.map((i) => esc(i.title)).join(', ')}</p>` : ''}` : '';
    $('week-forecast').innerHTML = html;
  } catch { /* forecast is optional */ }
  renderExtras();
}

async function resetDay(time = '07:00') {
  startPlan();
  apply(await api(`/api/demo?now=${time}&lang=${lang}`));
}

// A new day or a new plan starts clean, and this is the one place that says
// what that means: the conversation, a proposal, undo, half-made edits, and any
// AI answer still on its way all belonged to the old plan.
let run = 0;
let focus = null; // { id, end } of the Now item when it first became Now, for the late banner
function startPlan() {
  run++;
  focus = null; // a new plan starts on time
  sendCtl?.abort();
  sendCtl = null;
  $('send').disabled = false;
  chatLog = [];
  pendingProposal = null;
  undoStack.length = 0;
  dropDraft();
  clearImport();
  nextPlan = null; reviewOpen = false;
  $('demo-cap').hidden = true;
  clearPhaseDrafts();
  dropFocus();
  endTour();
  renderThread();
  $('live-me').hidden = true; $('live-me').textContent = '';
  $('answer').innerHTML = ''; $('live-steps').innerHTML = ''; $('status').textContent = '';
  renderChips();
}

async function refresh() { apply(await api('/api/tool', { state, name: 'get_state' })); }

const roleName = (id) => (view.roles.find((r) => r.id === id) || {}).name || id;
const span = (q) => dayMin(q.end) - dayMin(q.start);

// The estimate moved because of how long this role really takes the person.
function paceLine(item) {
  const it = state.queue.find((q) => q.id === item.id);
  return it?.base && !it.touched && it.minutes !== it.base ? `<p class="hint">⏱ ${esc(t('pace')(roleName(item.role), it.minutes, it.base))}</p>` : '';
}

function lateBanner(now) {
  if (!now) { focus = null; return ''; }
  if (!focus || focus.id !== now.id) focus = { id: now.id, end: dayMin(now.end) };
  const late = state.now - focus.end;
  if (late < 10) return '';
  return `<div class="caption" style="margin:0 0 12px">⏰ ${esc(t('late')(late))}
    <div class="row" style="margin-top:8px"><button class="primary small" id="late-go">${t('lateReplan')}</button><button class="small" id="late-more">${t('lateStill')}</button></div></div>`;
}

// Pixels per minute: tighter on a phone, so a whole evening fits on one screen.
const narrow = matchMedia('(max-width: 899px)');
function renderTimeline() {
  const PX = narrow.matches ? 0.55 : 0.75;
  const tl = $('tl');
  const sleep = state.settings?.sleep ?? dayMin(view.sleep);
  const from = Math.max(0, Math.floor((state.now - 30) / 60) * 60);
  const y = (m) => (m - from) * PX;
  tl.style.height = `${y(sleep) + 20}px`;
  tl.querySelectorAll('.hr').forEach((n) => n.remove());
  for (let m = from; m <= sleep; m += 60) tl.insertAdjacentHTML('beforeend', `<div class="hr" style="top:${y(m)}px">${String((m / 60) % 24).padStart(2, '0')}:00</div>`);
  const blocks = [
    ...view.fixed.map((x, i) => ({ key: 'f' + i + x.title, title: x.title, start: dayMin(x.start), end: dayMin(x.end), fixed: true })),
    ...view.queue.map((q) => ({ key: q.id, title: q.title, role: q.role, start: dayMin(q.start), end: dayMin(q.end) })),
  ].filter((b) => b.end > from);
  const seen = new Set();
  for (const b of blocks) {
    seen.add(b.key);
    let el = tl.querySelector(`[data-k="${CSS.escape(b.key)}"]`);
    if (!el) { el = document.createElement('div'); el.dataset.k = b.key; el.style.top = `${y(b.start)}px`; tl.appendChild(el); }
    el.className = 'blk' + (b.fixed ? ' fixed' : '');
    if (b.role) el.style.setProperty('--rc', `var(--r${roleIdx(b.role)})`);
    el.textContent = `${String(Math.floor(b.start / 60) % 24).padStart(2, '0')}:${String(b.start % 60).padStart(2, '0')} ${b.title}`;
    requestAnimationFrame(() => { el.style.top = `${y(Math.max(b.start, from))}px`; el.style.height = `${Math.max(16, (b.end - Math.max(b.start, from)) * PX - 2)}px`; });
  }
  tl.querySelectorAll('.blk').forEach((el) => { if (!seen.has(el.dataset.k)) { el.classList.add('gone'); setTimeout(() => el.remove(), 400); } });
  let nl = tl.querySelector('.nowline');
  if (!nl) { nl = document.createElement('div'); nl.className = 'nowline'; tl.appendChild(nl); }
  nl.style.top = `${y(state.now)}px`;
  let sl = tl.querySelector('.sleep');
  if (!sl) { sl = document.createElement('div'); sl.className = 'sleep'; tl.appendChild(sl); }
  sl.style.top = `${y(sleep)}px`;
  sl.textContent = `${view.sleep} 🌙`;
}

const hasBacklog = () => mode === 'real' && !!template?.tasks.some((x) => x.status === 'todo' && !state.queue.some((q) => q.id === x.id));

function renderRisk() {
  const box = $('risk-bar');
  const risks = mode === 'real' ? (view.deadlines || []).filter((d) => !d.ok) : [];
  box.hidden = !risks.length;
  if (box.hidden) return;
  const first = risks[0];
  box.innerHTML = `<div class="row" style="justify-content:space-between"><span>⚠ ${esc(t('riskLine')(first.title, first.date.slice(8, 10) + '/' + first.date.slice(5, 7), hrs(first.shortMin)))}${risks.length > 1 ? ` ${t('riskMore')(risks.length - 1)}` : ''}</span><button class="primary small" id="risk-go">${t('riskFix')}</button></div>`;
  $('risk-go').onclick = () => { $('say').value = t('riskText')(first.title, first.date); send(); };
}

function render() {
  renderRisk();
  $('date').textContent = `${mode === 'real' ? t('today') : t('date')}, ${view.now}`;
  $('clock').value = view.now;
  const [now, ...next] = view.queue;

  const banner = lateBanner(now);
  $('now-card').style.cssText = now ? rcStyle(now.role) : '';
  $('now-card').innerHTML = now ? `
    <h2>${t('now')}</h2>${banner}
    <div class="now-title">${esc(now.title)}</div>
    <div class="row muted" style="margin-bottom:12px">
      <span>${now.start} - ${now.end}</span><span class="chip role">${esc(roleName(now.role))}</span>
    </div>
    ${nowButtons(now)}
    <p class="hint">${t('nowHint')}</p>${paceLine(now)}` : `<h2>${t('now')}</h2><div class="now-title">${state.now >= (state.settings?.sleep ?? 1380) ? t('pastBedtime') : t('nothingLeft')}</div>
    <p class="hint">${t('debtNote')}</p>${hasBacklog() ? `<button class="primary" id="pull-more">${t('pullMore')}</button>` : ''}`;
  if (!now && hasBacklog()) $('pull-more').onclick = async () => apply(await api('/api/more', { template, state }));
  if (now) $('now-card').querySelectorAll('button[data-act]').forEach((b) => { b.onclick = () => act(b.dataset.act, now); });
  renderFocusBar(now);
  if (banner) {
    const late = state.now - focus.end;
    $('late-go').onclick = () => { focus = { id: now.id, end: state.now }; $('say').value = t('lateText')(late, now.title); send(); };
    $('late-more').onclick = () => { focus = { id: now.id, end: state.now + 15 }; act('more', now); };
  }

  const misfit = view.doesNotFit.length ? `<p class="warn" style="margin:10px 0 0">${t('doesNotFit')}: ${view.doesNotFit.map((x) => esc(x.title)).join(', ')}. ${t('doesNotFitTail')}</p>` : '';
  $('next-card').innerHTML = `<h2>${t('next')}</h2>${next.slice(0, 3).map((n) => `
    <div class="next"><span><span class="dot" style="${rcStyle(n.role)}"></span>${esc(n.title)}</span><span class="muted">${n.start}</span></div>`).join('') || `<p class="muted" style="margin:0">${t('nothingElse')}</p>`}
    ${view.fixed.length ? `<p class="muted" style="margin:10px 0 0">${t('fixed')}: ${view.fixed.map((f) => `${esc(f.title)} ${f.start}`).join(', ')}</p>` : ''}${misfit}`;

  renderTimeline();
  renderPromises();
  const debt = view.debtMinutes;
  $('week-card').innerHTML = `<h2>${t('week')}</h2>` + view.roles.filter((r) => r.floorMin || r.targetMin).map((r) => {
    const done = r.weekSoFarMin;
    const today = view.queue.filter((q) => q.role === r.id).reduce((s, q) => s + span(q), 0);
    const goal = r.targetMin || r.floorMin;
    const scale = Math.max(goal, done + today, 1);
    const pct = (m) => Math.round((m / scale) * 100);
    return `<div class="floor" style="${rcStyle(r.id)}"><span><span class="dot"></span>${esc(r.name)}</span><span class="muted">${t('weekLine')(hrs(done), hrs(today), hrs(goal))}${debt[r.id] ? `, ${hrs(debt[r.id])}h ${t('debt')}` : ''}</span>
      <div class="bar" style="grid-column:1/3"><i style="width:${pct(done)}%"></i><i class="plan" style="width:${pct(today)}%"></i>${r.floorMin ? `<b class="tick" style="left:${pct(r.floorMin)}%" title="${t('floor')} ${hrs(r.floorMin)}h"></b>` : ''}</div></div>`;
  }).join('') + (view.roles.some((r) => r.floorMin) ? `<p class="hint">${t('weekKey')}</p>` : '') + [...view.deadlines].sort((a, b) => a.ok - b.ok).slice(0, 5).map((d) => `<p style="margin:8px 0 0" class="${d.ok ? 'muted' : 'warn'}">${esc(d.title)}: ${d.ok ? t('onTrack') : `${t('short')} ${hrs(d.shortMin)}h`}</p>`).join('');
}

function recordDone(id, roleId, minutes) {
  const task = template.tasks.find((x) => x.id === id);
  if (task) { if (task.debt) count('repaid', minutes); task.status = 'done'; }
  count('done', minutes);
  template.done = template.done || {};
  template.done[roleId] = (template.done[roleId] || 0) + minutes;
  template.actuals = state.actuals;
  saveTemplate();
}
function markDebt(ids) {
  if (mode !== 'real' || !template) return;
  for (const id of ids) { const task = template.tasks.find((x) => x.id === id); if (task) task.debt = true; }
  saveTemplate();
}
function syncAgent(before) {
  if (mode !== 'real' || !template) return;
  const was = new Map(before.queue.map((q) => [q.id, q.status]));
  const changed = state.queue.filter((q) => was.get(q.id) !== q.status);
  // One turn can finish several items, each with its own real minutes.
  const spent = (state.actuals || []).slice(before.actuals?.length || 0);
  for (const q of changed.filter((x) => x.status === 'done')) {
    const i = spent.findIndex((a) => a.roleId === q.roleId);
    recordDone(q.id, q.roleId, i >= 0 ? spent.splice(i, 1)[0].actual : q.minutes);
  }
  markDebt(changed.filter((q) => q.status === 'skipped' || q.status === 'cut').map((q) => q.id));
  if (changed.some((q) => q.status === 'cut')) count('approve'); // chosen out loud
}

async function morningCheckin() {
  if (mode !== 'real' || !template || template.sample || !view?.queue.length || template.checkinDate === state.date) return;
  template.checkinDate = state.date;
  saveTemplate(); scheduleSave();
  try {
    const { text } = await api('/api/checkin', { template, state, weekday: realDay(), lang, provider: provider() });
    if (!text) return;
    const box = $('checkin');
    box.hidden = false;
    box.innerHTML = `<div class="ai-head"><img src="/icon.svg" alt="">${t('checkinTitle')}</div><p>${esc(text)}</p>
      <div class="row"><button class="primary small" id="checkin-ok">${t('checkinOk')}</button><button class="small" id="checkin-change">${t('checkinChange')}</button></div>`;
    $('checkin-ok').onclick = () => { box.hidden = true; };
    $('checkin-change').onclick = () => { box.hidden = true; $('say').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('say').focus(); };
  } catch { /* the day works fine without it */ }
}

async function act(kind, item) {
  if (sendCtl) return; // the agent is changing this plan right now
  if (kind === 'focus') { startFocus(item); render(); return; }
  if (kind === 'drop') { dropFocus(); render(); return; }
  if (kind === 'stop') {
    // Stopped before it was finished: what is left of the block gets shorter.
    const minutes = await stopFocus();
    if (minutes) apply(await api('/api/progress', { state, id: item.id, minutes }));
    return;
  }
  let args;
  if (kind === 'done') {
    // Real minutes: from the timer if it ran, otherwise from the item's start to the clock.
    const timed = focusOn(item) ? await stopFocus() : null;
    const spent = timed || (state.now > dayMin(item.start) ? state.now - dayMin(item.start) : span(item));
    args = { id: item.id, status: 'done', minutes: spent };
    // The demo clock stands still, so finishing moves it on. On a real day the
    // next block simply starts now, even if this one ended early.
    if (!realClock()) state.now = Math.max(state.now, dayMin(item.end));
  } else if (kind === 'more') {
    args = { id: item.id, status: 'more_time', minutes: 15 };
  } else {
    args = { id: item.id, status: 'skipped' };
  }
  adopt(await api('/api/tool', { state, name: 'update_item', args }));
  if (kind === 'skip') markDebt([item.id]);
  if (kind === 'done' && mode === 'real' && template) recordDone(item.id, item.role, args.minutes);
  draw();
}


// Tabs: Today, Week, Goals. The chosen tab is remembered on this browser.
let tab = store.get('meso-tab') || 'today';
function showTab(name) {
  tab = name;
  store.set('meso-tab', name);
  for (const p of ['today', 'week', 'goals']) $(`p-${p}`).hidden = p !== name;
  $('call').hidden = name !== 'today' || inCall();
  document.querySelectorAll('#tabs button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', b.dataset.tab === name); });
  window.scrollTo({ top: 0 });
}
document.querySelectorAll('#tabs button').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

// Colors: each role keeps the color of its place in the role list.
const roleIdx = (id) => { const list = template && mode === 'real' ? template.roles : view ? view.roles : []; return Math.max(0, list.findIndex((r) => r.id === id)) % 8; };
const rcStyle = (id) => `--rc:var(--r${roleIdx(id)})`;
const hrs = (m) => (Math.round(m / 6) / 10).toString();
// Before 04:00 it is still yesterday, for the weekday as for the date.
const realDay = () => (mode === 'real' ? today().weekday : 5);
const realClock = () => mode === 'real' && !template?.sample;

let weekData = null, reviewOpen = false, nextPlan = null;

// The eight promises, checked after every change, right here on this device.
function renderPromises() {
  const errors = checkPlan(state, replan(state));
  const broken = new Set(errors.map((e) => PROMISE_OF(e)));
  const list = t('promises');
  const kept = list.length - broken.size;
  $('promises-sum').textContent = broken.size ? `✗ ${t('promisesBad')(broken.size)}` : `✓ ${t('promisesOk')(kept, list.length)}`;
  $('promises').classList.toggle('bad', broken.size > 0);
  $('promises-list').innerHTML = list.map((p, i) => `<li class="${broken.has(i) ? 'no' : ''}">${broken.has(i) ? '✗' : '✓'} ${esc(p)}</li>`).join('');
}
const PROMISE_OF = (e) => {
  const key = ['sleep', 'wake', 'past', 'overlap', 'fixed moved', 'lost', 'overfilled', 'silent cut', 'needless cut', 'silent floor'].findIndex((k) => e.startsWith(k));
  return [0, 0, 0, 1, 2, 3, 4, 5, 6, 7][key] ?? 0;
};

function renderExtras() {
  renderLog();
  renderBanner();
  renderReview();
  renderGoals();
  renderTrend();
  renderSampleBar();
  renderRemind();
  if (!hasDraft()) renderEditors();
}

const closedWeek = () => (mode === 'real' && template?.history?.length ? template.history.at(-1) : null);
const unseenWeek = () => { const c = closedWeek(); return c && template.reviewedWeek !== c.weekStart ? c : null; };

function renderBanner() {
  const box = $('week-banner');
  box.hidden = !unseenWeek();
  if (box.hidden) return;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><span>${t('newWeek')}</span><button class="primary small" id="see-review">${t('seeReview')}</button></div>`;
  $('see-review').onclick = () => showTab('week');
}

// A week still running has not missed a minimum yet: it shows progress, not a cross.
const floorCell = (x, open) => !x.floorMin ? '' : x.floorKept ? `<td class="n ok">✓ ${hrs(x.floorMin)}h</td>` : open ? `<td class="n muted">⏳ ${hrs(x.doneMin)}/${hrs(x.floorMin)}h</td>` : `<td class="n warn">✗ ${hrs(x.floorMin)}h</td>`;
function reviewHtml(r, open = false) {
  return `<table class="rv"><tr><th>${t('role')}</th><th class="n">${t('planned')}</th><th class="n">${t('actual')}</th><th class="n">${t('floor')}</th></tr>
    ${r.roles.map((x) => `<tr><td><span class="dot" style="${rcStyle(x.id)}"></span>${esc(x.name)}</td><td class="n">${hrs(x.targetMin)}h</td><td class="n">${hrs(x.doneMin)}h</td>${floorCell(x, open) || '<td></td>'}</tr>`).join('')}
  </table><p class="hint">${t('reviewLine')(r.tasksDone, r.tasksTotal, hrs(r.debtMin))}${open ? ` ${t('reviewOpenNote')}` : ''}</p>`;
}

// Week by week: one small chart per role, on one scale of its own.
function renderTrend() {
  const box = $('trend-card');
  const weeks = [...(template?.history || []), weekData?.review].filter(Boolean);
  box.hidden = mode !== 'real' || !template || weeks.length < 2;
  if (box.hidden) return;
  const shortDate = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');
  const panels = template.roles.map((r) => {
    const done = weeks.map((w) => w.roles.find((x) => x.id === r.id)?.doneMin || 0);
    const top = Math.max(r.targetMin, ...done, 60);
    const bars = done.map((m, i) => `<i class="tb ${i === weeks.length - 1 ? 'cur' : ''}" style="height:${Math.max(3, Math.round((m / top) * 100))}%" title="${esc(t('weekOf')(shortDate(weeks[i].weekStart), hrs(m)))}"></i>`).join('');
    return `<div style="${rcStyle(r.id)}">
      <div class="name"><span class="dot"></span>${esc(r.name)}</div>
      <div class="tbars">${bars}<span class="tgt" style="bottom:${Math.round((r.targetMin / top) * 100)}%"></span></div>
      <div class="val">${hrs(done.at(-1))}h / ${hrs(r.targetMin)}h</div>
    </div>`;
  }).join('');
  const debts = weeks.slice(0, -1).map((w) => `${hrs(w.debtMin)}h`).join(', ');
  box.innerHTML = `<h2>${t('trendTitle')}</h2><div class="trend">${panels}</div><p class="hint">${t('trendHint')}${debts ? ` ${t('debtLine')(debts)}.` : ''}</p>`;
}

function renderSampleBar() {
  const box = $('sample-bar');
  box.hidden = !(mode === 'real' && template?.sample);
  if (box.hidden) return;
  box.innerHTML = `<div class="row" style="justify-content:space-between"><span>${t('sampleBar')}</span><div class="row"><button class="primary small" id="sample-own">${t('setupBtn')}</button><button class="small" id="sample-exit">${t('sampleExit')}</button></div></div>`;
  $('sample-own').onclick = openSetup;
  $('sample-exit').onclick = exitSample;
}
async function loadSample() {
  // A week the person already has is kept aside, not overwritten.
  if (template && !template.sample) store.set('meso-own', JSON.stringify(template));
  setMode('real');
  startPlan();
  apply(await api('/api/sample', { ...today(), lang }));
  showTab('today');
}
async function exitSample() {
  let own = null;
  try { own = JSON.parse(store.get('meso-own')); } catch {}
  store.set('meso-own', '');
  if (own) { startPlan(); template = own; await newDay(); return; }
  template = null;
  store.set('meso-template', '');
  setMode('demo');
  await resetDay('07:00');
}

function renderReview() {
  const box = $('review-card');
  box.hidden = mode !== 'real' || !template;
  if (box.hidden) return;
  const closed = unseenWeek();
  const r = closed || (reviewOpen && weekData?.review) || null;
  if (!r) {
    box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">${t('reviewTitle')}</h2><button id="review-open">${t('reviewBtn')}</button></div>${template.pending ? `<p class="hint">${t('pendingNote')}</p>` : ''}`;
    $('review-open').onclick = () => { reviewOpen = true; renderReview(); };
    return;
  }
  const plan = nextPlan ? `<h2 style="margin-top:16px">${t('nextTitle')}</h2>
    <table class="rv"><tr><th>${t('role')}</th><th class="n">${t('hoursChange')}</th></tr>
    ${nextPlan.roles.map((x) => `<tr><td><span class="dot" style="${rcStyle(x.id)}"></span>${esc(x.name)}${x.why ? `<div class="hint" style="margin:2px 0 0">${esc(x.why)}</div>` : ''}</td><td class="n">${hrs(x.fromMin)}h → <b>${hrs(x.targetMin)}h</b></td></tr>`).join('')}</table>
    <p class="hint">${t('nextLine')(nextPlan.tasks.length)}</p>
    <div class="row"><button class="primary" id="next-ok">${t('approve')}</button><button id="next-no">${t('cancel')}</button></div>` : '';
  box.innerHTML = `<h2>${closed ? t('reviewLast') : t('reviewTitle')}</h2>${reviewHtml(r, !closed)}
    ${nextPlan ? plan : `<div class="row"><button class="primary" id="next-go">${t('nextBtn')}</button><button id="share-week">${t('recapBtn')}</button>${closed ? `<button id="review-skip">${t('keepWeek')}</button>` : `<button class="small" id="review-close">${t('hideIntro')}</button>`}</div>`}
    <div class="hint" id="next-status"></div>`;
  if (nextPlan) {
    $('next-ok').onclick = () => approveNext(closed);
    $('next-no').onclick = () => { nextPlan = null; renderReview(); };
    return;
  }
  $('next-go').onclick = () => planNext(r);
  $('share-week').onclick = () => shareWeek(r, { t, hrs, open: !closed });
  if (closed) $('review-skip').onclick = () => { template.reviewedWeek = closed.weekStart; saveTemplate(); scheduleSave(); renderExtras(); };
  else $('review-close').onclick = () => { reviewOpen = false; renderReview(); };
}

async function planNext(review) {
  $('next-go').disabled = true;
  $('next-status').textContent = t('nextThinking');
  const mine = run;
  try {
    const data = await api('/api/setup', { previous: template, review, lang, provider: provider() });
    if (mine !== run) return;
    nextPlan = data.next;
    renderReview();
  } catch (e) {
    $('next-status').textContent = e.message;
    $('next-go').disabled = false;
  }
}

async function approveNext(closed) {
  if (closed) {
    const data = await api('/api/edit', { template, next: nextPlan, state, weekday: realDay(), lang });
    data.template.reviewedWeek = closed.weekStart;
    startPlan();
    apply(data);
  } else {
    // The week is still running, so the new plan waits for Monday.
    template.pending = nextPlan;
    nextPlan = null; reviewOpen = false;
    saveTemplate(); scheduleSave(); renderExtras();
  }
}

function renderGoals() {
  const box = $('goals-card');
  if (mode !== 'real' || !template) {
    box.innerHTML = `<div class="invite"><h2>${t('goalsTab')}</h2><p>${t('goalsInvite')}</p><div class="row" style="justify-content:center"><button class="primary" id="invite-sample">${t('sampleBtn')}</button><button id="invite-go">${t('setupBtn')}</button></div></div>`;
    $('invite-go').onclick = openSetup;
    $('invite-sample').onclick = loadSample;
    return;
  }
  const goals = template.goals || [];
  const pace = new Map((weekData?.goals || []).map((g) => [g.id, g]));
  const used = new Set(goals.map((g) => g.roleId));
  const free = template.roles.filter((r) => !used.has(r.id)).map((r) => r.name);
  // Hours are counted by role, so goals on one role share one bar, and the card says so.
  const shared = (g) => goals.filter((o) => o.roleId === g.roleId && o.id !== g.id).map((o) => o.title).join(', ');
  box.innerHTML = `<h2>${t('goalsTab')}</h2>${goals.map((g) => {
    const p = pace.get(g.id);
    const role = template.roles.find((r) => r.id === g.roleId);
    const done = template.done?.[g.roleId] || 0;
    const target = role?.targetMin || 0;
    const left = p?.daysLeft;
    return `<div class="goal" style="${rcStyle(g.roleId)}">
      <div class="goal-title">${esc(g.title)}</div>
      <div class="row" style="margin:4px 0 8px"><span class="chip role">${esc(role?.name || '')}</span>${g.measure ? `<span class="hint" style="margin:0">${esc(g.measure)}</span>` : ''}${left != null ? `<span class="hint" style="margin:0">${left >= 0 ? t('daysLeft')(left) : t('deadlinePassed')}</span>` : ''}</div>
      <div class="hint" style="margin:0">${t('goalHours')(hrs(done), hrs(target))}${shared(g) ? ` ${esc(t('goalShared')(shared(g)))}` : ''}</div>
      <div class="bar"><i style="width:${target ? Math.min(100, Math.round((done / target) * 100)) : 0}%"></i></div>
      ${p?.behind ? `<p class="warn" style="margin:8px 0 0;font-size:14px">${t('goalBehind')(hrs(p.doneMin), hrs(p.expectedMin))}</p>` : ''}
      ${template.sample ? '' : phasesHtml(g)}
    </div>`;
  }).join('') || `<p class="muted" style="margin:0">${t('noGoals')}</p>`}
  ${free.length && goals.length ? `<p class="hint">${t('noGoalRoles')}: ${free.map(esc).join(', ')}</p>` : ''}${goals.length && !template.sample ? `<p class="hint">${t('phaseApplies')}</p>` : ''}`;
  wirePhases(box);
}

// Photo: shrink it in the browser, then hand it to the agent (Muse Spark reads images).
let photoTarget = 'say';
$('photo').onclick = () => { photoTarget = 'say'; $('photo-file').click(); };
$('setup-photo').onclick = () => { photoTarget = 'setup'; $('photo-file').click(); };
async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
$('photo-file').onchange = async () => {
  const file = $('photo-file').files[0];
  $('photo-file').value = '';
  if (!file) return;
  let image;
  try { image = await shrink(file); }
  catch { (photoTarget === 'setup' ? $('setup-status') : $('status')).textContent = t('errPhoto'); return; }
  if (photoTarget === 'setup') { setupImage = image; $('setup-photo-chip').hidden = false; return; }
  send($('say').value.trim() || (lang === 'vi' ? 'Thêm những gì trong ảnh vào hôm nay.' : 'Add what is in this photo to today.'), image);
};

$('send').onclick = () => send();
$('say').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
});

// Agent call, streamed: each tool step appears as soon as it happens.
const provider = () => (store.get('meso-private') === '1' ? 'open' : 'meta');
const syncPrivate = () => { $('private').checked = provider() === 'open'; $('private-hint').hidden = !$('private').checked; };
$('private').onchange = () => { store.set('meso-private', $('private').checked ? '1' : ''); syncPrivate(); };
syncPrivate();

// Earlier turns of the conversation; the latest answer sits below them.
function renderThread() {
  $('thread').innerHTML = chatLog.slice(0, -2).slice(-6).map((m) => `<div class="turn ${m.role === 'user' ? 'me' : 'ai'}">${esc(m.content)}</div>`).join('');
}

// Asked once, before the first thing leaves for an AI provider.
function askConsent() {
  if (consented()) return Promise.resolve(true);
  const box = $('consent-sheet');
  box.showModal();
  return new Promise((done) => {
    const finish = (ok) => { box.close(); if (ok) giveConsent(); done(ok); };
    $('consent-yes').onclick = () => finish(true);
    $('consent-no').onclick = () => finish(false);
  });
}

// Memory of the conversation, and a proposal still waiting for an answer.
let chatLog = [], pendingProposal = null, sendCtl = null;
async function send(textArg, image = null, opts = {}) {
  const text = (textArg ?? $('say').value).trim();
  if (!text || sendCtl) return null; // one turn at a time
  if (!navigator.onLine) { $('status').textContent = t('offlineAi'); return null; }
  if (!opts.demo && !(await askConsent())) return null;
  const ctl = new AbortController();
  sendCtl = ctl;
  // Nobody should wait for ever on a stream that went quiet. In the guided
  // demo, patience is shorter: the recording is ready to take over.
  let quiet;
  const alive = () => { clearTimeout(quiet); quiet = setTimeout(() => ctl.abort(), opts.demo ? 20000 : 60000); };
  alive();
  $('send').disabled = true;
  $('chips').innerHTML = '';
  $('live-me').textContent = text; $('live-me').hidden = false;
  $('status').textContent = image ? t('readingPhoto') : t('thinking');
  $('answer').innerHTML = ''; $('live-steps').innerHTML = '';
  const started = Date.now();
  const before = state;
  const beforeWeek = template;
  const snap = snapshot();
  try {
    const res = await fetch('/api/agent', { method: 'POST', signal: ctl.signal, headers: aiHeaders, body: JSON.stringify({ state, text, image, provider: provider(), stream: true, lang, call: !!opts.call, template: mode === 'real' ? template : null, pending: pendingProposal, history: chatLog.slice(-8), weekday: realDay() }) });
    if (!res.ok || !res.body) throw new Error(errMsg(await res.json().catch(() => ({}))));
    offline(false);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', done = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      alive();
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (!line.trim()) continue;
        const msg = JSON.parse(line);
        if (msg.type === 'step') {
          $('live-steps').insertAdjacentHTML('beforeend', stepHtml(msg));
          if (msg.ok && msg.state) { state = msg.state; view = msg.view; render(); } // the plan moves while the agent works
        }
        if (msg.type === 'council') councilProgress(msg);
        if (msg.type === 'switch') $('status').textContent = t('switching');
        if (msg.type === 'done') done = msg;
      }
    }
    if (!done?.ok) throw new Error(errMsg(done || { code: 'ai' }));
    undoStack.push(snap);
    adopt(done);
    syncAgent(before);
    draw();
    done.receipt = receiptHtml(before, beforeWeek, done);
    count('replan');
    chatLog.push({ role: 'user', content: text }, { role: 'assistant', content: done.reply });
    renderThread();
    pendingProposal = done.proposal || null;
    $('say').value = '';
    showAnswer(done);
    if (!done.proposal) askHelped();
    $('status').textContent = `${t('took')(((Date.now() - started) / 1000).toFixed(1))}${done.fellBack ? ` · ${t('fellBack')}` : ''}`;
    return done;
  } catch (e) {
    if (ctl !== sendCtl) return null; // the plan moved on, and this answer with it
    const noNet = e instanceof TypeError;
    if (noNet) offline(true);
    $('status').textContent = ctl.signal.aborted ? t('errSlow') : noNet ? t('offlineAi') : e.message;
    if (!opts.demo) { $('live-me').hidden = true; renderChips(); } // the words are still in the box
    return null;
  } finally {
    clearTimeout(quiet);
    if (ctl === sendCtl) { sendCtl = null; $('send').disabled = false; }
  }
}

function councilProgress(m) {
  if (m.stage === 'start') {
    $('live-steps').insertAdjacentHTML('beforeend', ['deadline', 'life'].map((by) => `<li id="g-${by}">⏳ ${t('guardian')[by]}: ${t('weighing')}</li>`).join(''));
  } else if ($(`g-${m.by}`)) {
    $(`g-${m.by}`).innerHTML = `<span class="ok">✓</span> ${t('guardian')[m.by]}: ${esc(m.why)}`;
  }
}

const stepHtml = (s) => `<li><span class="${s.ok ? 'ok' : 'no'}">${s.ok ? '✓' : '✗'}</span> ${esc(t('tool')[s.tool] || s.tool)}${s.error ? `: <span class="no">${esc(s.error)}</span>` : ''}</li>`;

// What changed according to the code, not according to the model.
function receiptHtml(before, beforeWeek, data) {
  const d = planDiff(before, state, beforeWeek, data.template || null);
  const rows = [
    ...d.fixedAdded.map((x) => `+ ${esc(x.title)}, ${x.start}`),
    ...d.added.map((x) => `+ ${esc(x.title)}, ${x.start}`),
    ...d.laterTasks.map((x) => `+ ${esc(x.title)}${x.deadline ? ` (${t('due')} ${x.deadline.slice(8, 10)}/${x.deadline.slice(5, 7)})` : ''}`),
    ...d.laterEvents.map((x) => `+ ${esc(x.title)}${x.on ? `, ${x.on.slice(8, 10)}/${x.on.slice(5, 7)}` : ''} ${x.start}`),
    ...d.goals.map((x) => `+ ${t('goalsTab')}: ${esc(x.title)}`),
    ...d.finished.map((x) => `✓ ${esc(x)}`),
    ...d.toDebt.map((x) => `↩ ${esc(x)}`),
    ...d.moved.slice(0, 4).map((x) => `→ ${esc(x.title)}: ${x.from} → ${x.to}`),
    ...(d.moved.length > 4 ? [`→ +${d.moved.length - 4} ${t('moreN')}`] : []),
    ...d.noRoom.map((x) => `! ${esc(x)}: ${t('noRoom')}`),
  ];
  const broken = checkPlan(state, replan(state)).length;
  const rejected = data.trace.filter((s) => !s.ok).length;
  return `${rows.length ? `<ul class="diff">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : ''}
    <p class="hint">${broken ? '✗' : '✓'} ${t('receipt')(data.trace.length, rejected, t('promises').length - Math.min(broken, 8), t('promises').length)}</p>
    ${isEmptyDiff(d) ? '' : `<button class="small" id="undo">${t('undo')}</button>`}`;
}

// Anything the AI changed can be taken back.
const undoStack = [];
const snapshot = () => ({ state: JSON.stringify(state), template: JSON.stringify(template), stats: JSON.stringify(stats) });
async function undo() {
  const s = undoStack.pop();
  if (!s) return;
  template = JSON.parse(s.template);
  if (template) saveTemplate();
  state = JSON.parse(s.state);
  stats = JSON.parse(s.stats);
  saveStats();
  pendingProposal = null;
  await refresh();
  $('answer').innerHTML = `<p class="reply muted">${t('undone')}</p>`;
}

const keptToday = (ids) => replan(applyEvent(state, { type: 'cut', ids })).placed.map((p) => (state.queue.find((q) => q.id === p.id) || {}).title);

function showAnswer(data) {
  const title = (id) => (state.queue.find((q) => q.id === id) || {}).title || id;
  const p = data.proposal;
  // What every option moves is not the choice, so it is said once, and each
  // card shows only what makes it different.
  const both = p && p.options.length > 1 ? p.options[0].ids.filter((id) => p.options.every((o) => o.ids.includes(id))) : [];
  $('live-steps').innerHTML = '';
  $('answer').innerHTML = `<div class="ai-head"><img src="/icon.svg" alt="">Mesocycle</div><p class="reply">${esc(data.reply)}</p>${data.receipt || ''}` +
    (both.length ? `<p class="hint">${t('eitherWay')}: ${esc(both.map(title).join(', '))}</p>` : '') +
    (p ? p.options.map((o, i) => `<div class="option ${o.by || ''}">
      <div class="row" style="justify-content:space-between"><strong>${t('guardian')[o.by] || (i === 0 ? t('suggested') : t('or'))}</strong>${o.suggested && !p.agreed ? `<span class="chip">${t('suggested')}</span>` : ''}</div>
      ${o.why ? `<p style="margin:6px 0 0">${esc(o.why)}</p>` : ''}
      <p style="margin:8px 0 0;font-size:14px"><b>${t('keeps')}:</b> ${esc(keptToday(o.ids).join(', ')) || '-'}</p>
      <p class="hint" style="margin:4px 0 8px"><b>${t('moveToDebt')}:</b> ${esc(o.ids.filter((id) => !both.includes(id)).map(title).join(', ')) || '-'}</p>
      <button class="${i === 0 ? 'primary' : ''}" data-opt="${i}">${t('approve')}</button></div>`).join('') : '') +
    `<details style="margin-top:12px" ${data.trace.some((s) => !s.ok) ? 'open' : ''}><summary>${t('steps')} (${data.trace.length})</summary>
      <ol class="steps">${data.trace.map(stepHtml).join('')}</ol><p class="hint">${t('stepsHint')}</p></details>`;
  // The answer is the point of the turn, so it comes to the person.
  $('answer').scrollIntoView({ behavior: 'smooth', block: 'start' });
  if ($('undo')) $('undo').onclick = undo;
  if (p) $('answer').querySelectorAll('[data-opt]').forEach((b) => {
    b.onclick = async () => {
      const { ids } = p.options[Number(b.dataset.opt)];
      undoStack.push(snapshot());
      adopt(await api('/api/approve', { state, ids }));
      markDebt(ids);
      draw();
      pendingProposal = null;
      count('approve');
      if (!$('demo-cap').hidden) caption('cap4');
      if (!data.recorded) askHelped();
      $('answer').innerHTML = `<p class="reply muted">${t('approved')}</p><button class="small" id="undo">${t('undo')}</button>`;
      $('undo').onclick = undo;
    };
  });
}

// One tap, once a day, after a re-plan has settled. It is the honest measure of
// whether this helps, and it carries nothing but the answer.
function askHelped() {
  const day = today().date;
  if (store.get('meso-helped') === day) return;
  store.set('meso-helped', day);
  $('answer').insertAdjacentHTML('beforeend', `<div class="row hint" id="helped"><span>${t('helpedQ')}</span><button class="small" data-h="1">${t('yes')}</button><button class="small" data-h="0">${t('no')}</button></div>`);
  $('helped').querySelectorAll('button').forEach((b) => {
    b.onclick = () => {
      $('helped').textContent = t('thanks');
      api('/api/feedback', { helped: b.dataset.h === '1', where: realClock() ? 'week' : 'demo' }).catch(() => {});
    };
  });
}

// If the AI cannot answer during the guided demo, a recording of one real
// run plays instead, and says so.
async function playRecording() {
  const mine = run;
  const events = await fetch(`/core/replay-${lang}.json`).then((r) => r.json()).catch(() => null);
  if (mine !== run) return;
  if (!events) { $('status').textContent = t('errNet'); return; }
  $('send').disabled = true;
  $('status').textContent = t('recording');
  $('live-steps').innerHTML = '';
  let last = 0;
  const before = state;
  for (const e of events) {
    await new Promise((r) => setTimeout(r, Math.min(1500, (e.at - last) / 2)));
    if (mine !== run) return;
    last = e.at;
    if (e.type === 'step') {
      $('live-steps').insertAdjacentHTML('beforeend', stepHtml(e));
      if (e.ok && e.state) { state = e.state; view = e.view; render(); }
    }
    if (e.type === 'council') councilProgress(e);
    if (e.type === 'done') {
      apply(e);
      pendingProposal = e.proposal || null;
      e.recorded = true;
      $('say').value = '';
      e.receipt = receiptHtml(before, null, e);
      showAnswer(e);
    }
  }
  $('send').disabled = false;
  $('status').textContent = t('recording');
}

// Guided demo: a broken afternoon, with a caption for each step.
function caption(k) { $('demo-cap').textContent = t(k); $('demo-cap').hidden = false; }
async function tryDemo() {
  await resetDay('17:00');
  const mine = run; // pressing Reset or Try again takes over from here
  caption('cap1');
  $('say').scrollIntoView({ behavior: 'smooth', block: 'center' });
  await new Promise((r) => { setTimeout(r, 2200); }); // time to read it
  if (mine !== run) return;
  $('say').value = t('demoText');
  caption('cap2');
  const live = await send(undefined, null, { demo: true });
  if (mine === run && !live) await playRecording();
  if (mine === run) caption('cap3');
}

function openSetup() {
  showTab('today');
  $('setup').hidden = false;
  $('setup').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('setup-text').focus();
}
$('setup-cancel').onclick = () => { $('setup').hidden = true; };
$('rebuild').onclick = openSetup;
$('to-demo').onclick = async () => { setMode('demo'); await resetDay('07:00'); };
$('setup-go').onclick = async () => {
  const text = $('setup-text').value.trim();
  if (!text && !setupImage) return;
  if (!consented()) { $('setup-status').textContent = t('consentNeed'); return; }
  $('setup-go').disabled = true;
  $('setup-status').textContent = t('building');
  try {
    const data = await api('/api/setup', { text, image: setupImage, ...today(), now: realNow(), lang, provider: provider() });
    data.template.history = template?.sample ? [] : template?.history || [];
    store.set('meso-own', '');
    setMode('real');
    if (!sid) $('setup-status').textContent = t('signedOut');
    $('setup').hidden = true; setupImage = null; $('setup-photo-chip').hidden = true; $('setup-text').value = '';
    startPlan();
    apply(data);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    $('setup-status').textContent = e.message;
  } finally {
    $('setup-go').disabled = false;
  }
};

// Real mode follows the real clock; a new day is built from the template.
// That is not an edit, so the time of the last change stays: a copy changed
// on another device is still the newer one.
async function newDay(previous) {
  const { updatedAt } = template;
  adopt(await api('/api/day', { template, state: previous, ...today(), now: realNow() }));
  template.updatedAt = updatedAt;
  store.set('meso-template', JSON.stringify(template));
  draw();
}
let started = false; // the morning check-in waits until the saved plan has been read
async function tick() {
  if (mode !== 'real' || !state || template?.sample || sendCtl) return;
  const d = today();
  if (state.date !== d.date && template) {
    if (inCall() || hasDraft() || focusRunning()) return; // the new day can wait for a call, an edit or a timer
    startPlan();
    await newDay(state);
    if (started) morningCheckin();
    return;
  }
  if (realNow() > state.now) { state.now = realNow(); await refresh(); }
}
setInterval(tick, 60000);

$('lang').onclick = async () => {
  lang = lang === 'vi' ? 'en' : 'vi';
  store.set('meso-lang', lang);
  applyLang();
  if (mode === 'demo') await resetDay(view ? view.now : '07:00');
};
$('reset').onclick = () => { store.set('meso-intro', ''); setMode('demo'); resetDay($('clock').value || '07:00'); };
$('clock').onchange = async () => {
  if (!$('clock').value) return; // the field was just cleared
  state.now = toMin($('clock').value);
  await refresh();
};
$('logout').onclick = async () => {
  await fetch('/api/logout', { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: '{}', signal: AbortSignal.timeout(4000) }).catch(() => {});
  if (window.google) google.accounts.id.disableAutoSelect();
  clearLocal();
  location.reload();
};
// Nothing of a signed-in person stays behind on a shared computer.
for (const id of ['login-consent', 'setup-consent']) $(id).onchange = (e) => { if (e.target.checked) giveConsent(); };

function clearLocal() {
  clearTimeout(saveTimer);
  try { Object.keys(localStorage).filter((k) => k.startsWith('meso-')).forEach((k) => localStorage.removeItem(k)); } catch {}
}
$('delete-data').onclick = async () => {
  if (!confirm(t('deleteAsk'))) return;
  try {
    const res = await fetch('/api/data', { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) throw new Error();
  } catch { $('account-text').textContent = t('errNet'); return; }
  clearLocal();
  location.reload();
};

let fbRating = null;
function renderStars() {
  $('fb-stars').innerHTML = [1, 2, 3, 4, 5].map((n) => `<button class="small ${fbRating === n ? 'primary' : ''}" role="radio" aria-checked="${fbRating === n}" data-n="${n}">${n}</button>`).join('') + `<span class="hint" style="margin:0">${t('fbRate')}</span>`;
  $('fb-stars').querySelectorAll('button').forEach((b) => { b.onclick = () => { fbRating = Number(b.dataset.n); renderStars(); }; });
}
renderStars();
$('fb-send').onclick = async () => {
  const text = $('fb-text').value.trim();
  if (!text) return;
  try { await api('/api/feedback', { text, lang, rating: fbRating, quote: $('fb-quote').checked }); $('fb-text').value = ''; $('fb-quote').checked = false; fbRating = null; renderStars(); $('fb-status').textContent = t('thanks'); }
  catch (e) { $('fb-status').textContent = e.message; }
};

// What the feature files may read and use. They change the plan only through
// these functions, so the rules of a new plan stay in one place.
const shared = {
  t, api, apply, send, askConsent, showTab, count, errMsg, hrs, rcStyle, realDay, dayMin, logicalNow, shrink, provider, visitorId, openSetup, loadSample,
  today, act, renderGoals, changeTemplate, useWeek,
  snapshotForUndo: () => undoStack.push(snapshot()),
  get mode() { return mode; }, get template() { return template; }, get state() { return state; }, get view() { return view; }, get lang() { return lang; }, get run() { return run; },
};
setupReminders(shared);
setupEditors(shared);
setupImport(shared);
setupVoice(shared);
setupFocus(shared);
setupPhases(shared);
setupTour(shared);
$('side-tour').onclick = startTour;
$('side-try').onclick = () => { setMode('demo'); showTab('today'); tryDemo(); };

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
// A failure nobody planned for still says something, and says the plan is safe.
addEventListener('unhandledrejection', () => { $('status').textContent = t('errApp'); });
// navigator.onLine can be wrong, so a failed request also counts.
const offline = (on) => { $('offline-bar').hidden = !on; };
const onlineBar = () => offline(!navigator.onLine);
addEventListener('online', () => { onlineBar(); connect(); scheduleSave(); });
addEventListener('offline', onlineBar);
onlineBar();

// Today, from what is on this device.
async function openDay() {
  if (mode !== 'real' || !template) { if (state) await refresh(); else await resetDay(); return; }
  await tick();
  if (!state) { await newDay(); return; }
  if (realClock()) state.now = Math.max(state.now, realNow());
  await refresh();
}

(async () => {
  $('font').media = 'all'; // loaded this way so a slow font never holds the first screen
  showTab(tab);
  applyLang();
  try { state = JSON.parse(store.get('meso-state')); } catch { state = null; }
  setMode(mode);
  renderConsent();
  // The plan is on this device, so it draws first; the network comes after.
  try { await openDay(); } catch {
    // A saved day this version cannot read must not leave a blank screen.
    state = null;
    try { await openDay(); } catch { setMode('demo'); await resetDay(); }
  }
  document.body.classList.add('ready');
  await connect();
  started = true;
  morningCheckin();
})();

// The floating call button folds into a circle once the page scrolls (phones only, in CSS).
addEventListener('scroll', () => $('call').classList.toggle('mini', scrollY > 120), { passive: true });
narrow.addEventListener?.('change', () => { if (view) renderTimeline(); });
