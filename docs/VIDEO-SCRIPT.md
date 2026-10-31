# Kịch bản video demo 3 phút (bản 2, chờ Trí duyệt)

Lời thoại tiếng Anh (Trí đọc). Ghi chú quay tiếng Việt. Luật cuộc thi: phải chỉ rõ phần làm mới trong hackathon (câu ở 0:15 và 2:50). Không cần lộ mặt: cảnh 0:00 có thể là chữ trên nền màn hình.

| Thời điểm | Hình | Lời thoại |
|---|---|---|
| 0:00 đến 0:15 | Chữ trên nền: "First-year IT student. Runs an education company. Trains powerlifting. Midterms in 9 days." | "Every day I make a plan, and every day something breaks it. One late start, and the whole day collapses like dominoes." |
| 0:15 đến 0:30 | Lướt nhanh trang chủ Mesocycle | "So during this hackathon I built Mesocycle from scratch: a planning agent on Meta's Muse models that re-plans your day, and never trades your whole life for productivity." |
| 0:30 đến 0:55 | Bấm "Set up my week", bấm 🎙 nói mô tả tuần, thêm ảnh thời khoá biểu, bấm Build. Cắt đoạn chờ | "Setup is one sentence and a photo. Muse Voice Transcribe hears me, Muse Spark reads my timetable and builds my roles, my weekly minimums for family and training, my classes and my study blocks." |
| 0:55 đến 1:15 | Thẻ Now, bấm Need 15 more min, dòng thời gian trượt | "I only look at one card: Now. Only classes and sleep have fixed times; everything else is a queue. When I run late, it slides instead of collapsing." |
| 1:15 to 1:30 | Kéo đồng hồ demo qua giờ kết thúc, thẻ "You're 30 min behind" hiện ra | "And it notices when I fall behind, before I have to ask." |
| 1:30 to 2:05 | Chuyển sang ngày demo 17:00, nói: "I slept through the afternoon, and there's a class meeting at 7pm." Các bước hiện dần, có phương án Suggested và Or | "My real Friday. I say what happened. The agent adds the meeting, keeps my two calculus blocks, and asks before moving anything to debt, with a default and an alternative. Sleep at eleven never moves." |
| 2:05 to 2:20 | Bấm Approve, cuộn xuống phần tuần, các việc ↩ màu cam ở thứ Bảy | "Nothing is lost. Missed work becomes debt and lands on the days that still have room, and my weekly minimum for family stays protected." |
| 2:20 to 2:40 | Cửa sổ terminal: `npm run simulate` "Broken promises: 0", rồi bảng benchmark trong README | "The model never edits my plan. It calls tools, and code checks every call. I stress-tested the rules on a hundred thousand broken days: zero broken promises. And the open-weight Muse Spark Open runs the same agent as reliably: 19 out of 20 scenarios, about ten seconds a turn." |
| 2:40 to 3:00 | Logo, link repo, link live | "Mesocycle protects your deadlines and your life, not the clock. Everything here was built during the hackathon; the commit history starts October 27. Try it at the link below." |

## Ghi chú quay
- Quay màn hình: Win + Alt + R (Xbox Game Bar) hoặc OBS. Thu nhỏ Chrome cỡ điện thoại cho dễ nhìn.
- Trước mỗi lần quay: bấm "Back to the demo day" hoặc "Reset demo day".
- Đoạn chờ model (10 đến 20 giây) cắt còn 2 giây, ghi chữ nhỏ "sped up" cho trung thực.
- Không mở `.dev.vars`, không để lộ tab dev.meta.ai hay Gmail.
- Các con số trong lời thoại là số đo thật: docs/BENCHMARK.md và kết quả `npm run simulate`.
