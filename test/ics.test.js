import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIcs } from '../public/core/ics.js';

const ics = (...events) => ['BEGIN:VCALENDAR', ...events.flatMap((e) => ['BEGIN:VEVENT', ...e, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

test('one-time and weekly events, with long lines and escapes', () => {
  const out = parseIcs(ics(
    ['SUMMARY:Project review\\, room 2', 'DTSTART;TZID=Asia/Ho_Chi_Minh:20261110T140000', 'DTEND;TZID=Asia/Ho_Chi_Minh:20261110T153000'],
    ['SUMMARY:Algebra lec', ' ture', 'DTSTART:20260907T080000', 'DTEND:20260907T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE;UNTIL=20270110T000000Z'],
  ), '2026-11-01');
  assert.deepEqual(out[0], { kind: 'event', title: 'Project review, room 2', date: '2026-11-10', start: '14:00', end: '15:30' });
  assert.deepEqual(out[1], { kind: 'weekly', title: 'Algebra lecture', days: [1, 3], start: '08:00', end: '10:00' });
});

test('past, all-day, finished and far-off events are left out', () => {
  const out = parseIcs(ics(
    ['SUMMARY:Old', 'DTSTART:20261001T080000', 'DTEND:20261001T090000'],
    ['SUMMARY:Holiday', 'DTSTART;VALUE=DATE:20261120', 'DTEND;VALUE=DATE:20261121'],
    ['SUMMARY:Ended class', 'DTSTART:20260101T080000', 'DTEND:20260101T090000', 'RRULE:FREQ=WEEKLY;UNTIL=20260601T000000Z'],
    ['SUMMARY:Next year', 'DTSTART:20280101T080000', 'DTEND:20280101T090000'],
  ), '2026-11-01');
  assert.deepEqual(out, []);
});

test('a weekly event with no BYDAY keeps its own weekday, and junk is harmless', () => {
  const out = parseIcs(ics(['SUMMARY:Lab', 'DTSTART:20261104T090000', 'DTEND:20261104T110000', 'RRULE:FREQ=WEEKLY']), '2026-11-01');
  assert.deepEqual(out[0].days, [3]);
  assert.deepEqual(parseIcs('not a calendar', '2026-11-01'), []);
});
