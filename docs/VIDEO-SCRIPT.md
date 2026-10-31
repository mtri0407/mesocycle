# Kịch bản video demo 3 phút (bản 3, chờ Trí duyệt)

Lời thoại tiếng Anh (Trí đọc). Ghi chú quay tiếng Việt. Luật cuộc thi: phải chỉ rõ phần làm mới trong hackathon (câu ở 0:15 và 2:50). Không cần lộ mặt.

| Thời điểm | Hình | Lời thoại |
|---|---|---|
| 0:00 đến 0:12 | Chữ trên nền: "First-year IT student. Runs an education company. Midterms next week." | "Every day I make a plan, and every day something breaks it. One late start, and the whole day collapses like dominoes." |
| 0:12 đến 0:25 | Lướt trang chủ, ba tab | "So during this hackathon I built Mesocycle from scratch: a planning agent on Meta's Muse models that re-plans your day, and never trades your whole life for productivity." |
| 0:25 đến 0:50 | Lập tuần: bấm Speak, chữ hiện dần khi nói, thêm ảnh thời khoá biểu, Build. Cắt đoạn chờ | "Setup is one sentence and a photo. My words appear live from Muse Voice Transcribe. Muse Spark reads my timetable and builds my roles, my goals, my weekly minimums and my study blocks." |
| 0:50 đến 1:10 | Thẻ Bây giờ, bấm Cần thêm 15 phút, dòng thời gian màu trượt | "I look at one card: Now. Only classes and sleep have fixed times; everything else is a queue. When I run late, it slides instead of collapsing." |
| 1:10 đến 1:45 | Ngày demo 17:00, nói câu ngủ quên và họp 7h tối. Các bước hiện dần, Suggested và Or | "My real Friday. I say what happened. The agent adds the meeting, keeps my two calculus blocks, and asks before moving anything to debt. Sleep at eleven never moves." |
| 1:45 đến 2:00 | Bấm Approve, tab Tuần, việc ↩ màu cam | "Nothing is lost. Missed work becomes debt and lands where there is room, and my weekly minimum for family stays protected." |
| 2:00 đến 2:20 | Tab Mục tiêu có cảnh báo tụt nhịp, rồi Tổng kết tuần, Lập tuần tới, bảng 20h → 14h kèm lý do, Đồng ý | "It connects the day to what I'm working toward. When a goal falls behind, it tells me. Each week closes itself, and Muse Spark proposes next week from what really happened. Nothing changes until I approve." |
| 2:20 đến 2:42 | Terminal `npm run simulate` "Broken promises: 0", bảng benchmark | "The model never edits my plan. It calls tools, and code checks every call. A hundred thousand broken days: zero broken promises. And open-weight Muse Spark Open runs the same agent as reliably: 19 out of 20 scenarios, about ten seconds a turn." |
| 2:42 đến 3:00 | Logo, link repo, link live | "Mesocycle protects your deadlines and your life, not the clock. Everything here was built during the hackathon; the commit history starts October 27. Try it at the link below." |

## Clip 30 giây cho X (dọc, có phụ đề)

| Thời điểm | Hình | Phụ đề |
|---|---|---|
| 0:00 đến 0:04 | Thẻ Bây giờ, chữ to | "My plan broke at 5pm." |
| 0:04 đến 0:12 | Nói câu ngủ quên, chữ hiện dần | "So I just said what happened." |
| 0:12 đến 0:20 | Các bước agent ✗ ✓, Suggested và Or | "The AI re-plans. Code checks every step. It asks before cutting anything." |
| 0:20 đến 0:26 | Dòng thời gian trượt, giờ ngủ 23:00 đứng yên | "Sleep never moves." |
| 0:26 đến 0:30 | Link | "Mesocycle. Built on @Meta Muse." |

Bài đăng X (Trí tự đăng, kiểm tra tài khoản Meta đúng trước khi gắn thẻ):
> My plan broke at 5pm, so I built an AI that re-plans the day and never touches my sleep. Code checks every move it makes: 100,000 simulated broken days, 0 broken promises. Built on Meta's Muse models for the Meta AI hackathon. Open source: [link]

## Ghi chú quay
- Quay màn hình: Win + Alt + R hoặc OBS. Thu nhỏ Chrome cỡ điện thoại.
- Đoạn Lập tuần và Mục tiêu dùng tuần lập sẵn: lập trước một tuần giả, không dùng lịch thật ngoài ngày demo.
- Cảnh Tổng kết tuần cần có giờ đã làm: bấm Xong vài việc trước khi quay. Tụt nhịp chỉ hiện từ thứ Ba trở đi.
- Trước đoạn demo: bấm "Quay lại ngày demo".
- Đoạn chờ model (10 đến 20 giây) cắt còn 2 giây, ghi chữ nhỏ "sped up".
- Không mở `.dev.vars`, không để lộ tab dev.meta.ai hay Gmail.
- Các con số là số đo thật: docs/BENCHMARK.md và `npm run simulate`.
- Bảng 20h → 14h ở cảnh 2:00 phải là số hiện thật trên màn hình lúc quay; sửa lời nếu khác.
