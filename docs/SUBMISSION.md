# Bài nộp (nháp, Trí duyệt và tự bấm Submit)

Nộp trên cerebralvalley.ai trước 09:00 sáng 05/11 giờ Việt Nam. Mục tiêu: xong trước 23:00 tối 04/11. Tên các ô có thể khác trên form thật.

**Track:** Indie. Giải phụ nhắm tới: Best Agentic, Best Open Weight, Most Viral trên X.

**Project name:** Mesocycle

**Tagline:** Your day broke. Say what happened. An AI you can call that re-plans your day and protects what must not be sacrificed: your sleep, your people, your health.

**Links**
- Repo: https://github.com/mtri0407/mesocycle
- Live: https://mesocycle.minhtriphamnguyen69.workers.dev
- Video: https://youtu.be/uaB4JyyA0O8

**What it does**

You call it and say what happened. "I slept through the afternoon, and there's a meeting at 7pm." The meeting lands on your timeline in about two seconds, and the rest of the day slides around it. When something has to give, two AI advisors weigh it in parallel: a Deadline Guardian defends your exams, a Life Guardian defends your health and your people. Each picks one option and says why. You choose out loud, and nothing is cut until you do. Missed work becomes debt, not a guess about the future. Weekly minimums protect the things people sacrifice first, and sleep never moves. Drop in a syllabus and it finds every date. Goals become phases of a few weeks, drafted by Muse Spark and checked by code, and a focus timer logs real minutes so estimates learn from what happened. Each week closes itself and proposes the next one from what really happened.

**Who it's for / Build for Your World**

I'm a first-year IT student running a small education company, and I built this for my own exam weeks. Every broken day used to cost me a second hour, spent re-planning in my head, and it was always my sleep and my family that lost. Mesocycle frees up that time and that mental space: say it once, and the rest of the day is worked out, with the hard choice shown only when there is one. It is for anyone whose week has more roles than hours: students who work, parents who study, founders who still want a life. Other AI calendars optimize work. This one protects what must not be sacrificed.

**How we used Meta AI**

- Muse Spark 1.3 runs a tool-calling agent with 10 checked tools. Parallel tool calls stream to the screen as they pass the checks, so the plan moves while the model is still working.
- Two Muse Spark advisors start as soon as code sees the day no longer fits, in parallel with the agent, with strict structured output and no tools. They choose only among cuts code has verified.
- Muse Voice Transcribe powers a hands-free call with no speech output model: realtime WebSocket through the Worker, endpointing to hear when a turn ends, silence streamed while the device talks, language bias for Vietnamese and English, and keywords taken from the person's own plan, so their own names are heard correctly.
- Muse Spark reads timetables, messages and PDF syllabi into strict JSON that the person approves.
- Muse Spark splits a goal into phases through a checked tool call: code refuses phases that leave gaps, drop under a weekly minimum, overfill the week or miss the deadline, and sends the reasons back.
- Reasoning effort is tuned per job from measurements: a typical turn went from 9.9 seconds to about 3, and the benchmark score rose from 18/20 to 20/20.
- Muse Spark Open on Baseten runs the same agent as a private mode and takes over within the turn if Meta fails, stalls or runs out of credit. It holds every rule across the same 40 scenarios.

**Technical depth**

The model never edits the plan. It calls tools, code validates every call and returns the reason when it refuses, so the agent corrects itself. The planning core is one set of files that runs in the browser and in the Worker: buttons are instant and work offline, and the same code judges the model. Every answer carries a receipt computed by code. Deadline risk is computed, and the agent must read it, so it cannot simply reassure you.

Evaluation on real models: 40 scenarios, English and Vietnamese, each run 3 times on each of two models: 239 of 240 runs passed under strict checks (the other was a provider HTTP 502), 0 rules broken, median about 3.7 seconds, about half a cent a turn, 84% of input tokens served from cache. 10 of the 40 are attacks, including instructions hidden in a photo; none got through. Stress tests: 100,000 broken days and 70,000 days of whole weeks, 0 broken promises, and 8 of 8 planted bugs caught. 138 unit tests and 44 browser checks that need no API key, plus 4 that run against the real models.

**What's new in this hackathon**

Everything. The first commit is October 27, 2026. My earlier planner app was not reused.

**Real use** (chỉ điền số thật từ `node scripts/usage-report.mjs`, không có thì bỏ cả mục này)

[Trí điền: số người, số ngày dùng, số lần xếp lại, số ngày cứu được, mức tối thiểu giữ được, góp ý được phép trích.]
