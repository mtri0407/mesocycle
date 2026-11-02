// Tests the tests: plants bugs one at a time and checks they are caught.
//   node scripts/mutants.cjs
const fs = require('fs');
const { spawnSync } = require('child_process');
const R = require('path').join(__dirname, '..') + '/';
const MUTANTS = [
  ['drop the fit check when filling a day', 'public/core/setup.js', "    if (replan(trial).needsUser) continue;\n", ''],
  ['lose debt when a week closes', 'public/core/setup.js', "    .filter((x) => !(x.status === 'done' && (x.oneOff || x.deadline)))\n", "    .filter((x) => !(x.status === 'done' && (x.oneOff || x.deadline)) && !x.debt)\n"],
  ['duplicate an item in a hand edit', 'public/core/setup.js', "  return fill(next, fresher.filter((t) => !next.queue.some((q) => q.id === t.id)), { pace, share, soon: addDays(state.date, 1) });", "  return fill(next, fresher, { pace, share, soon: addDays(state.date, 1) });"],
  ['radar forgets to compare with the deadline', 'public/core/radar.js', "    for (const w of work) if (w.t.deadline === day) w.short = w.left;\n", ''],
  ['candidates ignore weekly floors', 'public/core/tradeoff.js', " && !floorBroken(state, ids).length;", ";"],
  ['work ignores its time of day', 'public/core/planner.js', '    const win = timeOfDay[it.roleId];\n', '    const win = null;\n'],
  ['set-aside work never gets another try', 'public/core/planner.js', '  for (let again = cuts.length > 0 && Object.keys(timeOfDay).length > 0; again;) {', '  for (let again = false; again;) {'],
  ['week tools may drop a role check', 'public/core/week-tools.js', "    if (!hasRole(a.role)) return reject(`Unknown role \"${a.role}\". Roles: ${roles}.`);\n    if (!(Number.isInteger(a.minutes) && a.minutes >= 15", "    if (!(Number.isInteger(a.minutes) && a.minutes >= 15"],
];
let caught = 0;
for (const [name, file, from, to] of MUTANTS) {
  const orig = fs.readFileSync(R + file, 'utf8');
  const clean = orig.replace(/\r\n/g, '\n');
  if (clean.split(from).length < 2) { console.log('NOT APPLIED', name); continue; }
  fs.writeFileSync(R + file, clean.split(from).join(to));
  const sim = spawnSync('node', ['scripts/simulate-weeks.mjs', '1200'], { cwd: R, encoding: 'utf8', timeout: 90000 });
  const unit = sim.status === 0 ? spawnSync('npm.cmd', ['test'], { cwd: R, encoding: 'utf8', shell: true, timeout: 60000 }) : null;
  fs.writeFileSync(R + file, orig);
  const hit = sim.status !== 0 ? 'simulator' : unit && unit.status !== 0 ? 'unit tests' : null;
  if (hit) caught++;
  console.log(`${hit ? 'caught ' : 'MISSED '} ${name}${hit ? ` (by ${hit})` : ''}${sim.status !== 0 ? ': ' + (sim.stderr.split('\n').find((l) => l.includes('BROKEN')) || sim.stderr.slice(0, 80)).slice(0, 90) : ''}`);
}
console.log(`${caught} of ${MUTANTS.length} planted bugs caught`);
