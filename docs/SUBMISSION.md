# Bài nộp (nháp, Trí duyệt và tự bấm Submit)

Nộp trên cerebralvalley.ai trước 09:00 sáng 05/11 giờ Việt Nam. Mục tiêu: xong trước 23:00 tối 04/11. Tên các ô có thể khác trên form thật.

**Track:** Indie. Giải phụ nhắm tới: Best Agentic, Best Open Weight, Most Viral trên X.

**Project name:** Mesocycle

**Tagline:** A planning agent that re-plans your day when life breaks the plan, and never trades your whole life for productivity.

**Links**
- Repo: https://github.com/mtri0407/mesocycle
- Live: https://mesocycle.minhtriphamnguyen69.workers.dev
- Video: [Trí điền sau khi quay]

**What it does**

Mesocycle plans your week from one spoken sentence and a photo of your timetable. It shows one card, Now. When life breaks the plan, you say what happened and a Muse Spark agent re-plans the rest of the day. It asks before cutting anything. Missed work becomes debt, not a guess about the future. Weekly minimums protect family, training and work, and sleep never moves. Goals link to the roles that serve them. Each week closes itself, and the agent proposes next week from what really happened, for you to approve.

**Who it's for / Build for Your World**

I'm a first-year IT student running a small education company. I built this for my own exam weeks, and it plans my real days. It is for anyone whose week has more roles than hours: students who work, parents who study, founders who still want a life.

**How we used Meta AI**

- Muse Spark 1.3: tool-calling agent with six checked tools, plus week setup, next-week proposals, morning check-ins and reading timetable photos.
- Muse Voice Transcribe: live speech through a realtime WebSocket proxied by the Worker, with the batch endpoint as fallback.
- Muse Spark Open on Baseten: the same agent, tools and rules on open weights, selectable in the app. Measured on 20 runs: 19/20 against 18/20 for Muse Spark 1.3, about 10 seconds a turn on both.

**Technical depth**

The model never edits the plan. It calls tools, and code validates every call and returns the reason when it refuses, so the agent corrects itself. Eight promises are written as code checks. A simulator lived through 100,000 randomly broken days, 994,609 re-plans, with 0 broken promises, and planted bugs were caught. Cut options are computed by code, which took a turn from 30 to 50 seconds down to about 10. Next-week proposals are rejected if they drop a floor or ask for more hours than the week can hold. Runs on Cloudflare Workers, 47 automated tests.

**What's new in this hackathon**

Everything. The first commit is October 27, 2026. My earlier planner app was not reused.

**Real use** (chỉ điền số thật, không có thì bỏ cả mục này)

[Trí điền: số ngày tự dùng, số lần xếp lại, góp ý thật. Tính đến 01/11: 0 góp ý trong KV.]
