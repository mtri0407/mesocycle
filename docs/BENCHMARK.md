# Muse Spark vs Muse Spark Open

Same agent, tools and rules; 10 scenarios in English and Vietnamese on the demo day. Run 2026-10-31, reasoning effort low.

| Model | Runs | Task done, rules kept | No rejected call | Median model calls | Median time | Slowest |
|---|---|---|---|---|---|---|
| Muse Spark 1.3 | 20 | 20/20 (100%) | 20/20 (100%) | 2 | 3.1s | 4.6s |
| Muse Spark Open | 20 | 20/20 (100%) | 20/20 (100%) | 3 | 4.5s | 6.7s |

A run counts as done when the requested change is in the plan, the agent finished on its own, and every planner promise in src/invariants.js still holds.
