// Focus: a timer on the Now card that counts up, and a log of real minutes.
// Finishing with the timer gives the planner the real time a block took, so
// estimates learn from what happened, not from a guess.
import { $, esc, store } from '/js/dom.js';

let app, run = null, removed = null;
try { run = JSON.parse(store.get('meso-focus')); } catch { run = null; }
const LONG_MIN = 120; // past this, the timer may have been forgotten
const t = (k) => app.t(k);
const save = () => store.set('meso-focus', run ? JSON.stringify(run) : '');
const clock = (msec) => { const s = Math.max(0, Math.floor(msec / 1000)); const h = Math.floor(s / 3600); const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0'); const ss = String(s % 60).padStart(2, '0'); return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`; };
const minutesOf = (from, to) => Math.max(1, Math.round((to - from) / 60000));

export const focusOn = (item) => !!run && !!item && run.id === item.id;
export const focusRunning = () => !!run;

export function startFocus(item) {
  run = { id: item.id, title: item.title, roleId: item.role, at: Date.now() };
  save();
}
export function dropFocus() { run = null; save(); }

// Asks before trusting a very long run: people forget timers.
function stopTime(from) {
  const ran = Date.now() - from;
  if (ran < LONG_MIN * 60000) return Promise.resolve(Date.now());
  const box = $('focus-check');
  const h = (ran / 3600000).toFixed(1);
  $('focus-check-text').textContent = t('focusLong')(h);
  const d = new Date();
  $('focus-end').value = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  box.showModal();
  return new Promise((done) => {
    const finish = (end) => { box.close(); done(end); };
    $('focus-right').onclick = () => finish(Date.now());
    $('focus-use').onclick = () => {
      const [hh, mm] = $('focus-end').value.split(':').map(Number);
      const end = new Date(); end.setHours(hh, mm, 0, 0);
      finish(Number.isFinite(end.getTime()) && end.getTime() > from && end.getTime() <= Date.now() ? end.getTime() : Date.now());
    };
    box.onclose = () => done(Date.now());
  });
}

// Ends the run and logs it. Returns the real minutes.
export async function stopFocus() {
  if (!run) return null;
  const r = run;
  const end = await stopTime(r.at);
  run = null;
  save();
  const minutes = minutesOf(r.at, end);
  logSession({ roleId: r.roleId, title: r.title, start: r.at, end, minutes });
  return minutes;
}

function logSession(s) {
  const { template, mode } = app;
  app.count('focus', s.minutes);
  if (mode !== 'real' || !template || template.sample) return;
  app.changeTemplate({ ...template, log: [...(template.log || []), { id: `s${Date.now().toString(36)}`, ...s }].slice(-500) });
}

// The Now card's buttons while the timer runs, or the button that starts it.
export function nowButtons(item) {
  if (focusOn(item)) {
    return `<div class="focus-time" data-focus aria-live="off">${clock(Date.now() - run.at)}</div>
      <div class="row"><button class="primary" data-act="done">${t('done')}</button><button data-act="stop">${t('focusStop')}</button><button class="small" data-act="drop">${t('focusDrop')}</button></div>`;
  }
  return `<div class="row"><button class="primary" data-act="done">${t('done')}</button><button data-act="focus">${t('focusBtn')}</button><button data-act="more">${t('more')}</button><button data-act="skip">${t('skip')}</button></div>`;
}

// A run whose block is no longer Now still shows, so it can be stopped.
export function renderFocusBar(nowItem) {
  const bar = $('focus-bar');
  bar.hidden = !run || focusOn(nowItem);
  if (bar.hidden) return;
  bar.innerHTML = `<span>⏱ ${t('focusing')}: <b>${esc(run.title)}</b></span><span class="focus-time" data-focus>${clock(Date.now() - run.at)}</span><span class="grow"></span><button class="small" id="focus-bar-stop">${t('focusStop')}</button>`;
  $('focus-bar-stop').onclick = () => app.act('stop', { id: run.id, title: run.title, role: run.roleId });
}

// Week tab: real minutes per day for the last seven days, and the latest sessions.
export function renderLog() {
  const box = $('log-card');
  const { template, mode } = app;
  box.hidden = mode !== 'real' || !template || !!template.sample;
  if (box.hidden) return;
  const log = template.log || [];
  const midnight = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const today = midnight(Date.now());
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * 86400000);
  const perDay = days.map((d) => log.filter((s) => midnight(s.start) === d));
  const top = Math.max(60, ...perDay.map((list) => list.reduce((s, x) => s + x.minutes, 0)));
  const weekStart = Date.parse(`${template.weekStart || ''}T00:00:00`) || 0;
  const thisWeek = log.filter((s) => s.start >= weekStart).reduce((s, x) => s + x.minutes, 0);
  const role = (id) => template.roles.find((r) => r.id === id);
  const bars = perDay.map((list) => `<div class="col" title="${list.reduce((s, x) => s + x.minutes, 0)} ${t('min')}">${list.map((s) => `<i style="height:${(s.minutes / top) * 100}%;${app.rcStyle(s.roleId)}"></i>`).join('')}</div>`).join('');
  const labels = days.map((d) => `<span>${t('days')[new Date(d).getDay()]}</span>`).join('');
  const recent = [...log].reverse().slice(0, 6).map((s) => {
    const d = new Date(s.start);
    return `<div class="sess" style="${app.rcStyle(s.roleId)}"><span><span class="dot"></span>${t('days')[d.getDay()]} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} · ${s.minutes} ${t('min')} · ${esc(role(s.roleId)?.name || '')}${s.title ? ` · ${esc(s.title)}` : ''}</span><button class="small icon" data-sess="${esc(s.id)}" aria-label="${t('remove')}">✕</button></div>`;
  }).join('');
  box.innerHTML = `<div class="row" style="justify-content:space-between"><h2 style="margin:0">${t('logTitle')}</h2>${removed ? `<button class="small" id="log-undo">${t('logUndo')}</button>` : ''}</div>
    ${log.length ? `<p class="hint">${t('logWeek')(app.hrs(thisWeek))}</p><div class="lbars">${bars}</div><div class="ldays">${labels}</div>${recent}` : `<p class="hint">${t('logEmpty')}</p>`}`;
  box.querySelectorAll('[data-sess]').forEach((b) => {
    b.onclick = () => {
      const s = (app.template.log || []).find((x) => x.id === b.dataset.sess);
      removed = s || null;
      app.changeTemplate({ ...app.template, log: (app.template.log || []).filter((x) => x.id !== b.dataset.sess) });
      // The way back stays a few seconds, then the log is tidy again.
      setTimeout(() => { if (removed === s) { removed = null; renderLog(); } }, 8000);
    };
  });
  if (removed) $('log-undo').onclick = () => { const s = removed; removed = null; app.changeTemplate({ ...app.template, log: [...(app.template.log || []), s].sort((a, b) => a.start - b.start) }); };
}

export function setupFocus(context) {
  app = context;
  setInterval(() => { if (run) document.querySelectorAll('[data-focus]').forEach((el) => { el.textContent = clock(Date.now() - run.at); }); }, 1000);
}
