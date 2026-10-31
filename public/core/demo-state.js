// A real day from the author's midterm week (Friday, 30 Oct 2026), used for
// the demo. Course names are real; nothing private beyond that.
const VI = {
  roles: { gpa: 'Đại học (GPA)', company: 'Greysteel Education', health: 'Tập luyện', project: 'Dự án hackathon', clubs: 'CLB', people: 'Gia đình và bạn bè' },
  queue: {
    'q-1': 'Giải tích block 1: đạo hàm phần 2',
    'q-2': 'Giải tích block 2: đạo hàm phần 3',
    'q-3': 'Gym',
    'q-4': 'Đại số block 3: ma trận và định thức',
    'q-5': 'Greysteel: trả lời khách, kiểm tra học phí',
    'q-6': 'Làm lại đề Đại số năm trước (40 phút) và chấm',
    'q-7': 'Pháp luật: 30 phút đọc slide',
    'q-8': 'Làm hackathon',
    'q-9': 'Gọi về nhà',
  },
  deadline: 'Thi giữa kỳ Giải tích + Đại số (8/11)',
};

// lang 'vi' gives the same day with Vietnamese titles.
export function demoState(nowMin = 7 * 60, lang = 'en') {
  const s = baseDay(nowMin);
  if (lang !== 'vi') return s;
  for (const r of s.roles) r.name = VI.roles[r.id];
  for (const q of s.queue) q.title = VI.queue[q.id];
  s.deadlines[0].title = VI.deadline;
  return s;
}

function baseDay(nowMin) {
  return {
    date: '2026-10-30',
    now: nowMin,
    settings: { wake: 7 * 60, sleep: 23 * 60, fillRatio: 0.6, bufferMin: 15 },
    roles: [
      { id: 'gpa', name: 'University (GPA)', priority: 1, floorMin: 900 },
      { id: 'company', name: 'Greysteel Education', priority: 2, floorMin: 300 },
      { id: 'health', name: 'Training', priority: 3, floorMin: 270 },
      { id: 'project', name: 'Hackathon project', priority: 4, floorMin: 180 },
      { id: 'clubs', name: 'Clubs', priority: 5 },
      { id: 'people', name: 'Family & friends', priority: 6, floorMin: 240 },
    ],
    // Minutes this week outside today: done Mon to Thu, already planned for the
    // weekend (futureBudget), and what the weekend can still make room for (laterMin).
    week: {
      gpa: { done: 780, futureBudget: 240, laterMin: 300 },
      company: { done: 210, futureBudget: 60, laterMin: 60 },
      health: { done: 180, futureBudget: 0, laterMin: 90 },
      project: { done: 135, futureBudget: 60, laterMin: 0 },
      clubs: { done: 0, futureBudget: 0 },
      people: { done: 90, futureBudget: 120, laterMin: 120 },
    },
    fixed: [],
    queue: [
      { id: 'q-1', title: 'Calculus block 1: derivatives part 2', roleId: 'gpa', minutes: 90, rank: 1, status: 'todo' },
      { id: 'q-2', title: 'Calculus block 2: derivatives part 3', roleId: 'gpa', minutes: 90, rank: 2, status: 'todo' },
      { id: 'q-3', title: 'Gym', roleId: 'health', minutes: 90, rank: 2, status: 'todo' },
      { id: 'q-4', title: 'Algebra block 3: matrices and determinants', roleId: 'gpa', minutes: 90, rank: 3, status: 'todo' },
      { id: 'q-5', title: 'Greysteel: reply to leads, check class payments', roleId: 'company', minutes: 45, rank: 2, status: 'todo' },
      { id: 'q-6', title: 'Redo last year\'s algebra paper (40 min) and grade it', roleId: 'gpa', minutes: 50, rank: 'extra', status: 'todo' },
      { id: 'q-7', title: 'Law: 30 minutes of slides', roleId: 'gpa', minutes: 30, rank: 'extra', status: 'todo' },
      { id: 'q-8', title: 'Hackathon build', roleId: 'project', minutes: 60, rank: 2, status: 'todo' },
      { id: 'q-9', title: 'Call home', roleId: 'people', minutes: 30, rank: 'extra', status: 'todo' },
    ],
    deadlines: [
      // Calculus and Algebra midterms on Sun 8 Nov; free minutes per remaining day before them.
      { title: 'Calculus + Algebra midterms (8 Nov)', date: '2026-11-08', remainingMin: 1500, days: [480, 300, 360, 600, 600, 600, 600, 420].map((freeMin) => ({ freeMin })) },
    ],
    actuals: [],
  };
}
