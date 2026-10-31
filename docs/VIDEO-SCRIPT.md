# Kịch bản video demo 3 phút (bản nháp, chờ Trí duyệt)

Lời thoại tiếng Anh (Trí đọc). Ghi chú quay tiếng Việt. Luật cuộc thi: phải chỉ rõ phần làm mới trong hackathon, nên có câu ở 0:15 và 2:45.

| Thời điểm | Hình | Lời thoại |
|---|---|---|
| 0:00 đến 0:15 | Mặt Trí hoặc bàn học, lịch ôn kín | "I'm a first-year IT student, I run a small education company, and I train powerlifting. Midterms are in nine days. Every day I make a plan, and every day something breaks it." |
| 0:15 to 0:30 | Lịch cũ Greysteel Tasks bị đỏ, rồi chuyển sang Mesocycle | "I built a planner with a reschedule button before. I stopped using it. So during this hackathon I built Mesocycle from scratch: a planning agent on Meta's Muse models." |
| 0:30 to 0:50 | Thẻ Now lúc 07:00, bấm Done, Need 15 more min | "Only classes, exams and sleep have hard times. Everything else is a queue. When I run late, the queue slides. No domino." |
| 0:50 to 1:30 | Đổi đồng hồ 17:00. Bấm 🎙 nói: "I slept through the afternoon, and there's a class meeting at 7pm." Chờ (cắt bớt), hiện trả lời | "Real afternoon from last week. I just say it. Muse Voice Transcribe turns it into text, and the Muse Spark agent re-plans. The meeting goes in at seven. Tonight keeps two Calculus blocks; gym and the call home become debt for the weekend. Sleep at eleven doesn't move." |
| 1:30 to 2:00 | Mở "Agent steps", chỉ vào dấu ✗ rồi ✓ | "The model never edits my plan. It calls tools, and code checks every call. Here it proposed a cut that would push 'Family & friends' under its weekly floor. The tool refused and said why. The model read it and fixed its own proposal." |
| 2:00 to 2:20 | Bấm 📷, chụp ảnh lịch học bù, lịch tự thêm | "A photo of an extra class schedule: Muse Spark reads it and adds only what happens today, through the same checked tools." |
| 2:20 to 2:35 | Terminal chạy `npm run simulate`, dòng "Broken promises: 0" | "How do I know the rules hold? I stress-tested the planner on a hundred thousand randomly broken days, almost a million re-plans. Zero broken promises." |
| 2:35 to 2:45 | Chọn Muse Spark Open, chạy lại | "The same agent runs on open weights, Muse Spark Open on Baseten, with the same tools and rules." |
| 2:45 to 3:00 | Logo, link repo | "Mesocycle protects your deadlines and your life, not the clock. Everything shown was built during the hackathon; the commit history starts October 27. Thanks." |

## Ghi chú quay
- Quay màn hình bằng OBS hoặc Xbox Game Bar (Win + Alt + R), cửa sổ Chrome thu nhỏ cỡ điện thoại cho dễ nhìn.
- Bấm Reset demo day trước mỗi lần quay.
- Đoạn chờ model (30 đến 50 giây) cắt còn 2 giây, ghi chữ "sped up" ở góc cho trung thực.
- Không mở `.dev.vars`, không để lộ tab dev.meta.ai.
