// Phases on the Goals tab: a strip of blocks of weeks, how the current one is
// going, a look back when one ends, and Muse Spark drafting new ones. A draft
// changes nothing until the person approves it.
import { esc } from '/js/dom.js';
import { phaseProgress, replacePhases } from '/core/phases.js';

let app;
const drafts = new Map(); // goal id -> phases proposed by the model
const t = (k) => app.t(k);
const short = (d) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '');

export const clearPhaseDrafts = () => drafts.clear();

export function phasesHtml(goal) {
  const { template } = app;
  const today = app.today().date;
  const phases = [...(goal.phases || [])].sort((a, b) => a.start.localeCompare(b.start));
  const progress = new Map(phaseProgress({ ...template, goals: [{ ...goal, phases }] }, { ...goal, phases }, today).map((p) => [p.id, p]));
  const draft = drafts.get(goal.id);
  const strip = phases.length ? `<div class="ph-strip" aria-hidden="true">${phases.map((p) => `<i class="${progress.get(p.id).stage}" style="flex:${progress.get(p.id).weeks}"></i>`).join('')}</div>` : '';
  const rows = phases.map((p) => {
    const g = progress.get(p.id);
    const when = g.stage === 'now' ? t('phaseWeek')(g.weekNo, g.weeks) : g.stage === 'next' ? t('phaseNext') : t('phaseEnded');
    const hours = p.weeklyMin != null ? ` · ${t('phaseHours')(app.hrs(p.weeklyMin))}` : '';
    const sofar = g.stage !== 'next' && g.doneMin ? `<p class="hint">${t('phaseSoFar')(app.hrs(g.perWeekMin))}</p>` : '';
    const retro = g.needsRetro
      ? `<div class="row"><span class="hint" style="margin:0">${t('phaseHow')}</span>${['reached', 'partly', 'not'].map((v) => `<button class="small" data-ph-retro="${esc(goal.id)}|${esc(p.id)}|${v}">${t('verdict')[v]}</button>`).join('')}</div>`
      : p.retro ? `<p class="hint">✓ ${t('verdict')[p.retro.verdict] || ''}</p>` : '';
    return `<div class="ph ${g.stage}"><b>${esc(p.title)}</b> <span class="hint">${short(p.start)} → ${short(p.end)} · ${when}${hours}</span>${p.expect ? `<p class="hint">${t('phaseExpect')}: ${esc(p.expect)}</p>` : ''}${sofar}${retro}</div>`;
  }).join('');
  const drafted = draft ? `<div class="ph now"><b>${t('phaseDraft')}</b>${draft.map((p) => `<p class="hint">${short(p.start)} → ${short(p.end)} · <b>${esc(p.title)}</b> · ${t('phaseHours')(app.hrs(p.weeklyMin))}<br>${t('phaseExpect')}: ${esc(p.expect)}</p>`).join('')}
    <div class="row"><button class="primary small" data-ph-use="${esc(goal.id)}">${t('phaseUse')}</button><button class="small" data-ph-no="${esc(goal.id)}">${t('cancel')}</button></div></div>` : '';
  return `<div class="phases"><h2 style="margin:6px 0 0">${t('phasesTitle')}</h2>${strip}${rows || (draft ? '' : `<p class="hint">${t('phaseNone')}</p>`)}${drafted}
    ${draft ? '' : `<div class="row" style="margin-top:10px"><button class="small" data-ph-ai="${esc(goal.id)}">${t('phaseAi')}</button></div>`}<div class="hint" data-ph-status="${esc(goal.id)}"></div></div>`;
}

async function draftPhases(goalId, status) {
  if (!(await app.askConsent())) return;
  status.textContent = t('phaseThinking');
  const mine = app.run;
  try {
    const out = await app.api('/api/phases', { template: app.template, goalId, date: app.today().date, lang: app.lang, provider: app.provider() });
    if (mine !== app.run) return;
    drafts.set(goalId, out.phases);
    app.renderGoals();
  } catch (e) { status.textContent = e.message; }
}

// The approved draft goes through the same checks as a hand edit.
async function usePhases(goalId) {
  const { template, state } = app;
  const today = app.today().date;
  const next = { ...template, goals: template.goals.map((g) => (g.id === goalId ? replacePhases(g, drafts.get(goalId), today) : g)) };
  try {
    const data = await app.api('/api/edit', { template: next, state, weekday: app.realDay(), lang: app.lang });
    drafts.delete(goalId);
    app.apply(data);
  } catch (e) { const s = document.querySelector(`[data-ph-status="${CSS.escape(goalId)}"]`); if (s) s.textContent = e.message; }
}

function look(goalId, phaseId, verdict) {
  const { template } = app;
  const goals = template.goals.map((g) => (g.id !== goalId ? g : { ...g, phases: g.phases.map((p) => (p.id === phaseId ? { ...p, retro: { verdict, at: app.today().date } } : p)) }));
  app.changeTemplate({ ...template, goals });
}

export function wirePhases(box) {
  box.querySelectorAll('[data-ph-ai]').forEach((b) => { b.onclick = () => draftPhases(b.dataset.phAi, box.querySelector(`[data-ph-status="${CSS.escape(b.dataset.phAi)}"]`)); });
  box.querySelectorAll('[data-ph-use]').forEach((b) => { b.onclick = () => usePhases(b.dataset.phUse); });
  box.querySelectorAll('[data-ph-no]').forEach((b) => { b.onclick = () => { drafts.delete(b.dataset.phNo); app.renderGoals(); }; });
  box.querySelectorAll('[data-ph-retro]').forEach((b) => { b.onclick = () => look(...b.dataset.phRetro.split('|')); });
}

export function setupPhases(context) { app = context; }
