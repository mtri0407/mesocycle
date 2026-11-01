// Hand edits work on a draft copy. Typing only changes the draft and never
// redraws the row, so Vietnamese input methods are not interrupted.
import { $, esc } from '/js/dom.js';

let app, draft = null;
export const hasDraft = () => !!draft;
export const dropDraft = () => { draft = null; $('edit-bar').hidden = true; };

const roleOptions = (d, sel) => d.roles.map((r) => `<option value="${esc(r.id)}" ${r.id === sel ? 'selected' : ''}>${esc(r.name)}</option>`).join('');
const field = (c, id, f, value, attrs = '') => `<input ${attrs} data-c="${c}" data-i="${esc(id)}" data-f="${f}" value="${esc(value ?? '')}">`;

export function renderEditors() {
  const { mode, template, t, rcStyle, openSetup, loadSample } = app;
  const real = mode === 'real' && !!template;
  $('import-start').hidden = !real;
  $('edit-week').hidden = !real;
  $('edit-goals').hidden = !real;
  $('week-invite').hidden = real;
  if (!real) {
    $('week-invite').innerHTML = `<div class="invite"><p style="margin-top:0">${t('weekInvite')}</p><div class="row" style="justify-content:center"><button class="primary" id="week-invite-sample">${t('sampleBtn')}</button><button id="week-invite-go">${t('setupBtn')}</button></div></div>`;
    $('week-invite-go').onclick = openSetup;
    $('week-invite-sample').onclick = loadSample;
    return;
  }
  const d = draft || template;
  const used = (id) => d.tasks.some((x) => x.roleId === id && x.status === 'todo') || (d.goals || []).some((g) => g.roleId === id);
  const del = (c, id, off) => `<button class="small icon" data-del="${c}" data-i="${esc(id)}" aria-label="${t('remove')}" title="${off ? t('roleInUse') : t('remove')}" ${off ? 'disabled' : ''}>✕</button>`;

  $('ed-roles').innerHTML = d.roles.map((r) => `<div class="edit-row"><div class="line"><span class="dot" style="${rcStyle(r.id)}"></span>${field('roles', r.id, 'name', r.name, `type="text" aria-label="${t('role')}"`)}${del('roles', r.id, used(r.id))}</div>
    <div class="line"><label>${t('priority')} ${field('roles', r.id, 'priority', r.priority, 'type="number" min="1" max="8"')}</label><label>${t('targetH')} ${field('roles', r.id, 'targetMin', r.targetMin / 60, 'type="number" min="0" max="80" step="0.5"')}</label><label>${t('floorH')} ${field('roles', r.id, 'floorMin', r.floorMin / 60, 'type="number" min="0" max="80" step="0.5"')}</label><select data-c="roles" data-i="${esc(r.id)}" data-f="kind" aria-label="${t('role')}"><option value="commitment" ${r.kind !== 'life' ? 'selected' : ''}>${t('kindWork')}</option><option value="life" ${r.kind === 'life' ? 'selected' : ''}>${t('kindLife')}</option></select></div></div>`).join('');

  const order = [1, 2, 3, 4, 5, 6, 0];
  $('ed-fixed').innerHTML = d.fixed.map((f) => `<div class="edit-row"><div class="line">${field('fixed', f.id, 'title', f.title, `type="text" aria-label="${t('fixed')}"`)}${del('fixed', f.id)}</div>
    <div class="line">${field('fixed', f.id, 'start', f.start, 'type="time"')} ${field('fixed', f.id, 'end', f.end, 'type="time"')}</div>
    <div class="line">${order.map((wd) => `<label class="dayp"><input type="checkbox" data-c="fixed" data-i="${esc(f.id)}" data-day="${wd}" ${f.days.includes(wd) ? 'checked' : ''}><span>${t('days')[wd]}</span></label>`).join('')}</div></div>`).join('') || `<p class="hint">${t('noneYet')}</p>`;

  $('ed-tasks').innerHTML = d.tasks.filter((x) => x.status === 'todo').map((x) => `<div class="edit-row"><div class="line">${field('tasks', x.id, 'title', x.title, `type="text" aria-label="${t('task')}"`)}${del('tasks', x.id)}</div>
    <div class="line"><select data-c="tasks" data-i="${esc(x.id)}" data-f="roleId" aria-label="${t('role')}">${roleOptions(d, x.roleId)}</select>
    <label>${t('minutes')} ${field('tasks', x.id, 'minutes', x.minutes, 'type="number" min="15" max="180" step="5"')}</label>
    <select data-c="tasks" data-i="${esc(x.id)}" data-f="rank" aria-label="${t('rank')}">${['1', '2', '3', 'extra'].map((v) => `<option value="${v}" ${String(x.rank) === v ? 'selected' : ''}>${v === 'extra' ? t('rankExtra') : `${t('rank')} ${v}`}</option>`).join('')}</select>
    <label>${t('deadline')} ${field('tasks', x.id, 'deadline', x.deadline, 'type="date"')}</label>${x.debt ? `<span class="chip">${t('debt')}</span>` : ''}</div></div>`).join('') || `<p class="hint">${t('noneYet')}</p>`;

  $('ed-times').innerHTML = `<label>${t('wake')} ${field('root', '', 'wake', d.wake, 'type="time"')}</label> <label>${t('sleepAt')} ${field('root', '', 'sleep', d.sleep, 'type="time"')}</label>`;

  $('ed-goals').innerHTML = (d.goals || []).map((g) => `<div class="edit-row"><div class="line">${field('goals', g.id, 'title', g.title, `type="text" aria-label="${t('goalsTab')}"`)}${del('goals', g.id)}</div>
    <div class="line"><select data-c="goals" data-i="${esc(g.id)}" data-f="roleId" aria-label="${t('role')}">${roleOptions(d, g.roleId)}</select>${field('goals', g.id, 'measure', g.measure, `type="text" placeholder="${t('measure')}" aria-label="${t('measure')}"`)}<label>${t('deadline')} ${field('goals', g.id, 'deadline', g.deadline, 'type="date"')}</label></div></div>`).join('') || `<p class="hint">${t('noGoals')}</p>`;
}

function startDraft() {
  if (!draft) draft = JSON.parse(JSON.stringify(app.template));
  $('edit-bar').hidden = false;
  $('edit-status').textContent = '';
}

function onEditInput(e) {
  const el = e.target;
  const { c, i, f, day } = el.dataset;
  if (!c) return;
  startDraft();
  const item = c === 'root' ? draft : draft[c].find((x) => x.id === i);
  if (day !== undefined) {
    const wd = Number(day);
    item.days = el.checked ? [...item.days, wd] : item.days.filter((x) => x !== wd);
  } else if (f === 'targetMin' || f === 'floorMin') item[f] = Math.round(Number(el.value) * 60);
  else if (f === 'minutes' || f === 'priority') item[f] = Number(el.value);
  else if (f === 'rank') item[f] = el.value === 'extra' ? 'extra' : Number(el.value);
  else if (f === 'deadline') item[f] = el.value || null;
  else item[f] = el.value;
}

function onEditClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  const { realDay } = app;
  const uid = `e${Date.now().toString(36)}`;
  if (btn.dataset.del) {
    startDraft();
    draft[btn.dataset.del] = draft[btn.dataset.del].filter((x) => x.id !== btn.dataset.i);
    renderEditors();
  } else if (btn.dataset.add) {
    startDraft();
    const c = btn.dataset.add;
    const role = draft.roles[0].id;
    if (c === 'roles') draft.roles.push({ id: uid, name: '', priority: draft.roles.length + 1, targetMin: 120, floorMin: 0 });
    if (c === 'fixed') draft.fixed.push({ id: uid, title: '', days: [realDay()], start: '08:00', end: '09:00' });
    if (c === 'tasks') draft.tasks.push({ id: uid, title: '', roleId: role, minutes: 60, rank: 2, deadline: null, status: 'todo' });
    if (c === 'goals') (draft.goals = draft.goals || []).push({ id: uid, title: '', roleId: role, measure: '', deadline: null });
    renderEditors();
  }
}
async function save() {
  const { t, api, state, realDay, lang, apply } = app;
  $('edit-save').disabled = true;
  $('edit-status').textContent = t('saving');
  try {
    const data = await api('/api/edit', { template: draft, state, weekday: realDay(), lang });
    dropDraft();
    $('edit-status').textContent = '';
    apply(data);
  } catch (e) {
    $('edit-status').textContent = e.message;
  } finally {
    $('edit-save').disabled = false;
  }
}

export function setupEditors(context) {
  app = context;
  for (const box of ['edit-week', 'edit-goals']) {
    $(box).addEventListener('input', onEditInput);
    $(box).addEventListener('change', onEditInput);
    $(box).addEventListener('click', onEditClick);
  }
  $('edit-save').onclick = save;
  $('edit-cancel').onclick = () => { dropDraft(); renderEditors(); };
}
