// Syllabus or photo in, dated items out. Nothing joins the plan until ticked.
import { $, esc } from '/js/dom.js';
import { runWeekTool } from '/core/week-tools.js';
import { parseIcs } from '/core/ics.js';
import { isGreysteel, fromGreysteel } from '/core/greysteel.js';
import { checkTemplate } from '/core/setup.js';

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
let app, importList = null, carried = null;
export const clearImport = () => { importList = null; carried = null; renderImport(); };
const readAsDataUrl = (blob) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(blob); });
async function importDoc(file, name) {
  const { state, t, askConsent, shrink, api, lang, provider } = app;
  // A Greysteel Tasks file is read right here too, into a whole week.
  if (/\.json$/i.test(name) || file.type === 'application/json') { await readPlanner(file); return; }
  // A calendar file is read right here: nothing leaves the device.
  if (/\.ics$/i.test(name) || file.type === 'text/calendar') {
    const items = parseIcs(await file.text(), state.date);
    $('import-status').textContent = items.length ? '' : t('importEmpty');
    if (items.length) { importList = items.map((x) => ({ ...x, keep: true })); renderImport(); }
    return;
  }
  if (!(await askConsent())) return;
  const note = $('import-status');
  note.textContent = t('importing');
  $('import-open').disabled = $('import-sample').disabled = true;
  const mine = app.run;
  try {
    const data = file.type === 'application/pdf' ? await readAsDataUrl(file) : await shrink(file);
    const out = await api('/api/import', { file: data, name, date: state.date, lang, provider: provider() });
    if (mine !== app.run) return;
    if (!out.deadlines.length && !out.events.length) { note.textContent = t('importEmpty'); return; }
    note.textContent = '';
    importList = [
      ...out.deadlines.map((d) => ({ ...d, kind: 'deadline', keep: true })),
      ...out.events.map((e) => ({ ...e, kind: 'event', keep: true })),
    ];
    renderImport();
  } catch (e) {
    note.textContent = e.code === 'private-pdf' ? t('importPrivate') : e.message;
  } finally {
    $('import-open').disabled = $('import-sample').disabled = false;
  }
}
async function readPlanner(file) {
  const { t, lang } = app;
  const note = $('import-status');
  let data = null;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!isGreysteel(data)) { note.textContent = t('gsBad'); app.showTab('goals'); return; }
  const out = fromGreysteel(data, { today: app.today().date });
  const errors = checkTemplate(out.template, lang);
  if (errors.length) { note.textContent = errors[0]; return; }
  note.textContent = '';
  carried = out;
  importList = null;
  app.showTab('goals');
  renderImport();
  $('import-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderCarried(box) {
  const { t, template } = app;
  const s = carried.summary;
  const replacing = template && !template.sample;
  box.innerHTML = `<h2>${t('gsTitle')}</h2><p style="margin:0 0 8px">${t('gsSummary')(s, app.hrs(s.focusMin))}</p>
    <p class="hint">${t('gsHint')}${replacing ? ` ${t('gsReplace')}` : ''}</p>
    <div class="row" style="margin-top:12px"><button class="primary" id="gs-use">${t('gsUse')}</button><button id="gs-no">${t('cancel')}</button></div>`;
  $('gs-no').onclick = () => { carried = null; renderImport(); };
  $('gs-use').onclick = () => {
    const keep = replacing ? template : null;
    const next = { ...carried.template, history: keep?.history || [], log: [...(keep?.log || []), ...carried.template.log].slice(-500) };
    carried = null;
    renderImport();
    app.useWeek(next);
  };
}

export function renderImport() {
  const box = $('import-card');
  box.hidden = !importList && !carried;
  if (carried) { renderCarried(box); return; }
  if (!importList) return;
  const { template, t, hrs } = app;
  const shortDate = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  box.innerHTML = `<h2>${t('importTitle')}</h2><p class="hint" style="margin-top:0">${t('importHint')}</p>
    ${importList.map((x, i) => `<label class="pick"><input type="checkbox" data-i="${i}" ${x.keep ? 'checked' : ''}><span><b>${esc(x.title)}</b><br><span class="hint">${x.kind === 'weekly' ? `${x.days.map((d) => t('days')[d]).join(', ')}, ${x.start} - ${x.end}` : ''}${x.kind === 'weekly' ? '' : shortDate(x.date)}${x.kind === 'weekly' ? '' : x.kind === 'event' ? `, ${x.start} - ${x.end}` : `, ${t('importEstimate')(hrs(x.minutes))}`}</span></span></label>`).join('')}
    <div class="row" style="margin-top:10px"><label style="font-size:14px">${t('role')} <select id="import-role">${template.roles.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('')}</select></label></div>
    <div class="row" style="margin-top:10px"><button class="primary" id="import-add"></button><button id="import-no">${t('cancel')}</button></div>`;
  const count = () => { $('import-add').textContent = t('importAdd')(importList.filter((x) => x.keep).length); };
  box.querySelectorAll('input[type=checkbox]').forEach((c) => { c.onchange = () => { importList[Number(c.dataset.i)].keep = c.checked; count(); }; });
  count();
  $('import-no').onclick = () => { importList = null; renderImport(); };
  $('import-add').onclick = addImported;
}
// Big work becomes blocks of two hours, all due on the same date.
async function addImported() {
  const { state, template, t, api, realDay, lang, apply, showTab, snapshotForUndo } = app;
  const roleId = $('import-role').value;
  const day = { today: state.date };
  let next = template;
  const addOne = (name, args) => { const r = runWeekTool(next, name, args, day); if (r.ok) next = r.template; };
  for (const x of importList.filter((i) => i.keep)) {
    if (x.kind === 'weekly') {
      addOne('add_event', { title: x.title, start: x.start, minutes: toMin(x.end) - toMin(x.start), days: x.days });
      continue;
    }
    if (x.kind === 'event') {
      if (x.date > state.date) addOne('add_event', { title: x.title, start: x.start, minutes: toMin(x.end) - toMin(x.start), date: x.date });
      continue;
    }
    const blocks = Math.ceil(x.minutes / 120);
    for (let i = 1; i <= blocks; i++) {
      addOne('add_task', { title: blocks > 1 ? `${x.title} (${i}/${blocks})` : x.title, role: roleId, minutes: Math.max(15, Math.round(x.minutes / blocks)), rank: i === 1 ? '1' : '2', deadline: x.date });
    }
  }
  snapshotForUndo();
  clearImport();
  apply(await api('/api/edit', { template: next, state, weekday: realDay(), lang }));
  $('import-status').textContent = t('importDone');
  showTab('today');
}

export function setupImport(context) {
  app = context;
  $('gs-open').onclick = () => $('doc-file').click();
  $('import-open').onclick = () => $('doc-file').click();
  $('doc-file').onchange = () => {
    const file = $('doc-file').files[0];
    $('doc-file').value = '';
    if (file) importDoc(file, file.name);
  };
  $('import-sample').onclick = async () => importDoc(await fetch('/sample-syllabus.pdf').then((r) => r.blob()), 'sample-syllabus.pdf');
}
