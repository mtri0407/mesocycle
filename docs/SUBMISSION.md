# Bài nộp (nháp, Trí duyệt và tự bấm Submit)

Nộp trên cerebralvalley.ai trước 09:00 sáng 05/11 giờ Việt Nam. Mục tiêu: xong trước 23:00 tối 04/11. Tên các ô có thể khác trên form thật.

**Track:** Indie. Giải phụ nhắm tới: Best Agentic, Best Open Weight, Most Viral trên X.

**Project name:** Mesocycle

**Tagline:** Your day broke. Say what happened. An AI you can call that re-plans your day and protects what must not be sacrificed: your sleep, your people, your health.

**Links**
- Repo: https://github.com/mtri0407/mesocycle
- Live: https://mesocycle.minhtriphamnguyen69.workers.dev
- Video: [Trí điền sau khi quay]

**What it does**

You call it and say what happened. "I slept through the afternoon, and there's a meeting at 7pm." The meeting lands on your timeline in about two seconds, and the rest of the day slides around it. When something has to give, two AI advisors weigh it in parallel: a Deadline Guardian defends your exams, a Life Guardian defends your health and your people. Each picks one option and says why. You choose out loud, and nothing is cut until you do. Missed work becomes debt, not a guess about the future. Weekly minimums protect the things people sacrifice first, and sleep never moves. Drop in a syllabus and it finds every date. Each week closes itself and proposes the next one from what really happened.

**Who it's for / Build for Your World**

I'm a first-year IT student running a small education company, and I built this for my own exam weeks. It is for anyone whose week has more roles than hours: students who work, parents who study, founders who still want a life. Other AI calendars optimize work. This one protects what must not be sacrificed.

**How we used Meta AI**

- Muse Spark 1.3 runs a tool-calling agent with 10 checked tools, parallel calls, tuned reasoning effort and prompt caching.
- Two Muse Spark advisors run in parallel with strict structured output and no tools, choosing only among cuts code has verified.
- Muse Voice Transcribe powers a hands-free call: realtime WebSocket through the Worker, endpointing to hear when a turn ends, language bias for Vietnamese and English, and keywords taken from the person's own plan.
- Muse Spark reads timetables, messages and PDF syllabi into strict JSON that the person approves.
- Muse Spark Open on Baseten runs the same agent as a private mode and takes over automatically if Meta fails. It passes the same 40 scenarios.

**Technical depth**

The model never edits the plan. It calls tools, code validates every call and returns the reason when it refuses, so the agent corrects itself. The planning core is one set of files that runs in the browser and in the Worker: buttons are instant and work offline, and the same code judges the model. Every answer carries a receipt computed by code. Deadline risk is computed, and the agent must read it, so it cannot simply reassure you.

Evaluation on real models: 40 scenarios, English and Vietnamese, 40/40 on both models, 0 rules broken, median 3.4 seconds, under half a cent a turn. 10 of the 40 are attacks, including instructions hidden in a photo; none got through. Stress tests: 100,000 broken days and 70,000 days of whole weeks, 0 broken promises, and 6 of 6 planted bugs caught. 101 unit tests and browser tests. Tuning reasoning effort took a typical turn from 9.9 seconds to about 3 with no loss in score.

**What's new in this hackathon**

Everything. The first commit is October 27, 2026. My earlier planner app was not reused.

**Real use** (chỉ điền số thật từ `node scripts/usage-report.mjs`, không có thì bỏ cả mục này)

[Trí điền: số người, số ngày dùng, số lần xếp lại, số ngày cứu được, mức tối thiểu giữ được, góp ý được phép trích.]
