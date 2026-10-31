// A made-up student's week, so a new visitor can see goals, a week review and
// the trend chart in seconds, before typing anything. Nothing here is real and
// the app labels it as a sample. Hours follow today's weekday so the numbers
// look like a week in progress on any day.
import { mondayOf, addDays } from './setup.js';

const WORDS = {
  en: {
    roles: ['Study', 'Part-time job', 'Gym', 'Family and friends'],
    fixed: ['Biology class', 'Chemistry class', 'Cafe shift'],
    goals: [['GPA 3.6 this term', 'Term GPA'], ['Finish the database project', 'Project submitted'], ['Save for a laptop', 'Savings target'], ['Gym 3 times a week', 'Sessions a week']],
    study: ['Biology review', 'Database project: schema', 'Chemistry problem set', 'Database project: report', 'Reading for seminar', 'Extra practice exam'],
    job: ['Prepare shift handover', 'Stock count', 'Update menu sheet'],
    gym: ['Gym session 1', 'Gym session 2', 'Gym session 3'],
    family: ['Call home', 'Dinner with friends'],
  },
  vi: {
    roles: ['Học', 'Làm thêm', 'Tập gym', 'Gia đình và bạn bè'],
    fixed: ['Lớp Sinh học', 'Lớp Hoá học', 'Ca làm quán cà phê'],
    goals: [['GPA 3.6 học kỳ này', 'GPA học kỳ'], ['Hoàn thành đồ án cơ sở dữ liệu', 'Đã nộp đồ án'], ['Tiết kiệm mua laptop', 'Mức tiết kiệm'], ['Tập gym 3 buổi một tuần', 'Số buổi mỗi tuần']],
    study: ['Ôn Sinh học', 'Đồ án: thiết kế bảng', 'Bài tập Hoá học', 'Đồ án: viết báo cáo', 'Đọc tài liệu seminar', 'Làm thêm đề luyện'],
    job: ['Chuẩn bị bàn giao ca', 'Kiểm kho', 'Cập nhật bảng menu'],
    gym: ['Buổi gym 1', 'Buổi gym 2', 'Buổi gym 3'],
    family: ['Gọi về nhà', 'Ăn tối cùng bạn bè'],
  },
};

const TARGET = [1080, 600, 240, 180];
const FLOOR = [600, 360, 120, 120];
const PAST_WEEKS = [[840, 640, 100, 150], [980, 610, 180, 120], [1010, 600, 230, 190]];
const PACE_THIS_WEEK = [0.9, 1, 0.3, 1]; // the gym role falls behind, so a goal shows its warning

export function sampleWeek({ date, weekday, lang }) {
  const w = WORDS[lang === 'vi' ? 'vi' : 'en'];
  const monday = mondayOf(date);
  const roles = w.roles.map((name, i) => ({ id: `r${i + 1}`, name, priority: i + 1, targetMin: TARGET[i], floorMin: FLOOR[i] }));
  const task = (title, roleId, minutes, rank, extra = {}) => ({ title, roleId, minutes, rank, deadline: null, status: 'todo', ...extra });
  const tasks = [
    ...w.study.map((title, i) => task(title, 'r1', 120, [1, 1, 2, 2, 3, 'extra'][i], i === 1 ? { deadline: addDays(date, 3) } : i === 2 ? { debt: true } : {})),
    ...w.job.map((title, i) => task(title, 'r2', 90, i + 1)),
    ...w.gym.map((title, i) => task(title, 'r3', 60, i + 1)),
    ...w.family.map((title, i) => task(title, 'r4', 60, i + 1)),
  ].map((t, i) => ({ id: `t${i + 1}`, ...t }));
  const goals = w.goals.map(([title, measure], i) => ({
    id: `g${i + 1}`, title, measure, roleId: ['r1', 'r1', 'r2', 'r3'][i], deadline: i === 1 ? addDays(date, 21) : null,
  }));
  const history = PAST_WEEKS.map((done, i) => ({
    weekStart: addDays(monday, (i - 3) * 7),
    roles: roles.map((r, j) => ({ id: r.id, name: r.name, targetMin: r.targetMin, floorMin: r.floorMin, doneMin: done[j], floorKept: done[j] >= r.floorMin })),
    goals: goals.map((g) => ({ id: g.id, title: g.title, roleId: g.roleId, doneMin: done[Number(g.roleId.slice(1)) - 1] })),
    tasksDone: 9 + i,
    tasksTotal: 14,
    debtMin: [240, 150, 120][i],
  }));
  const daysPassed = (weekday + 6) % 7;
  return {
    sample: true,
    roles,
    fixed: [
      { id: 'f1', title: w.fixed[0], days: [1, 3], start: '08:00', end: '11:00' },
      { id: 'f2', title: w.fixed[1], days: [4], start: '13:00', end: '16:00' },
      { id: 'f3', title: w.fixed[2], days: [6], start: '09:00', end: '13:00' },
    ],
    tasks,
    goals,
    wake: '07:00',
    sleep: '23:00',
    weekStart: monday,
    history,
    reviewedWeek: history.at(-1).weekStart,
    done: Object.fromEntries(roles.map((r, i) => [r.id, Math.round(((r.targetMin * daysPassed) / 7) * PACE_THIS_WEEK[i])])),
  };
}
