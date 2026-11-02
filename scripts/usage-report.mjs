// Totals for the submission, from real use. Prints totals only: no names, no
// emails, no task titles. Feedback is quoted only where the person allowed it.
//   node scripts/usage-report.mjs
import { execSync } from 'node:child_process';

const kv = (args) => execSync(`npx wrangler kv key ${args} --binding FEEDBACK --remote`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const keys = (prefix) => JSON.parse(kv(`list --prefix ${prefix}`)).map((k) => k.name);
const read = (key) => { try { return JSON.parse(kv(`get "${key}"`)); } catch { return null; } };

const totals = { people: 0, activePeople: 0, days: 0, replans: 0, approvals: 0, calls: 0, doneMin: 0, debtRepaidMin: 0, rescuedDays: 0, weeks: 0, floorsChecked: 0, floorsKept: 0 };
for (const key of keys('user:')) {
  const u = read(key);
  if (!u?.template) continue;
  const s = u.stats || {};
  totals.people++;
  if ((s.days || []).length >= 2) totals.activePeople++;
  totals.days += (s.days || []).length;
  for (const f of ['replans', 'approvals', 'calls', 'doneMin', 'debtRepaidMin']) totals[f] += s[f] || 0;
  totals.rescuedDays += (s.rescuedDays || []).length;
  for (const week of u.template.history || []) {
    totals.weeks++;
    for (const r of week.roles) if (r.floorMin) { totals.floorsChecked++; if (r.floorKept) totals.floorsKept++; }
  }
}
const entries = keys('2026-').map(read).filter(Boolean);
const taps = entries.filter((n) => typeof n.helped === 'boolean');
const notes = entries.filter((n) => typeof n.helped !== 'boolean');
const helped = (where) => { const these = taps.filter((n) => n.where === where); return `${these.filter((n) => n.helped).length} of ${these.length}`; };
const rated = notes.filter((n) => Number.isInteger(n.rating));
const average = rated.length ? (rated.reduce((s, n) => s + n.rating, 0) / rated.length).toFixed(1) : 'n/a';

console.log('People with a saved plan:', totals.people, `(${totals.activePeople} on 2 or more days)`);
console.log('Days used:', totals.days);
console.log('Re-plans:', totals.replans, ' Calls:', totals.calls, ' Proposals approved:', totals.approvals);
console.log('Hours done:', (totals.doneMin / 60).toFixed(1), ' Hours of debt paid back:', (totals.debtRepaidMin / 60).toFixed(1));
console.log('Days rescued (re-planned, then work still got done):', totals.rescuedDays);
console.log('Weeks closed:', totals.weeks, ' Weekly minimums kept:', totals.floorsChecked ? `${totals.floorsKept}/${totals.floorsChecked}` : 'n/a');
console.log('Said a re-plan helped, on a real week:', helped('week'), ' In the demo:', helped('demo'));
console.log('Feedback notes:', notes.length, ' Average rating:', average, `(${rated.length} rated)`);
console.log('\nMay be quoted (the person ticked the box):');
for (const n of notes.filter((x) => x.quote)) console.log(`- ${n.text}`);
