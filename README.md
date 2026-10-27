# Mesocycle

**An agent that re-plans your study, work and personal time when the plan breaks.**

Built for the [Meta Global AI Developer Hackathon](https://cerebralvalley.ai/e/meta-ai-developer-hackathon) (Indie track, theme: Build for Your World), October 27 to November 4, 2026.

> Status: day 1 of 9. This README grows with the project.

## The problem

I'm a first-year IT student who also runs a small company and trains seriously. Every week I make a plan, and every week something breaks it: a surprise meeting, an exam moved, a bad night of sleep. Planners list tasks but don't re-plan. Mesocycle borrows one idea from athletic periodization, plan in blocks and adjust to what actually happened, and applies it to time.

## What it does (planned)

1. **Voice check-in**: a short morning note ("extra club meeting at 4, low energy, keep the afternoon light") is transcribed by **Muse Voice Transcribe**.
2. **Read photos**: timetables, course outlines and task lists become structured time blocks through **Muse Spark** image understanding.
3. **Plan with tools**: a **Muse Spark** agent breaks goals into blocks and re-plans the week through tool calls. Every change is a proposal the user approves or undoes.
4. **Weekly review**: planned vs. actual hours per role.

The scheduling rules live in code and are tested; the model proposes actions, the code checks them before anything changes.

Mesocycle is a time-planning tool. It does not give medical, mental health, nutrition or training advice.

## Models

| Use | Model | Access |
|---|---|---|
| Agent and image reading | `muse-spark-1.3` | Meta Model API |
| Agent on open weights | `meta-models/muse-spark-open-1026` | Baseten |
| Voice check-in | Muse Voice Transcribe | Meta Model API |

Both providers use the OpenAI Chat Completions format, so `src/models.js` switches between them with one setting (`MODEL_PROVIDER=meta` or `open`).

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your keys in .dev.vars
npm test
npm run dev                      # open http://localhost:8787
```

Keys are read from environment variables (`MODEL_API_KEY`, `BASETEN_API_KEY`). `.dev.vars` is git-ignored. In production they are set with `wrangler secret put`.

## Built during the hackathon

Everything in this repository was written during the hackathon (first commit: October 27, 2026). Daily progress is visible in the commit history.

AI coding assistants were used during development. Product decisions, testing with real daily data, and the demo are my own.

## License

MIT
