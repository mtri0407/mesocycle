// Reads a calendar file (.ics), the kind every calendar app can export. This
// brings a real calendar in without asking for access to anyone's account.
const DAY = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const MAX_ITEMS = 40;
const pad = (n) => String(n).padStart(2, '0');

// A timed value: 20261103T130000 is local time, a trailing Z is UTC.
function readTime(value) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})\d{2}(Z?)$/.exec(value || '');
  if (!m) return null;
  const [, y, mo, d, h, mi, utc] = m;
  if (!utc) return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}`, weekday: new Date(`${y}-${mo}-${d}T00:00:00Z`).getUTCDay() };
  const local = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  return {
    date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
    time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    weekday: local.getDay(),
  };
}

export function parseIcs(text, today, { horizonDays = 120 } = {}) {
  const last = new Date(`${today}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() + horizonDays);
  const lastDay = last.toISOString().slice(0, 10);
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n'); // long lines continue with a space
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).split(';')[0];
    cur[key] = line.slice(i + 1);
  }

  const out = [];
  for (const e of events) {
    const title = (e.SUMMARY || '').replace(/\\([,;\\])/g, '$1').replace(/\\n/gi, ' ').trim().slice(0, 120);
    const start = readTime(e.DTSTART);
    const end = readTime(e.DTEND);
    if (!title || !start || !end || end.time <= start.time) continue; // all-day and overnight items are not time blocks
    const rule = Object.fromEntries((e.RRULE || '').split(';').filter(Boolean).map((p) => p.split('=')));
    if (rule.FREQ === 'WEEKLY') {
      if (rule.UNTIL && rule.UNTIL.slice(0, 8) < today.replace(/-/g, '')) continue;
      const days = rule.BYDAY ? rule.BYDAY.split(',').map((d) => DAY[d.slice(-2)]).filter((d) => d !== undefined) : [start.weekday];
      if (days.length) out.push({ kind: 'weekly', title, days, start: start.time, end: end.time });
    } else if (!rule.FREQ && start.date >= today && start.date <= lastDay) {
      out.push({ kind: 'event', title, date: start.date, start: start.time, end: end.time });
    }
  }
  return out.slice(0, MAX_ITEMS);
}
