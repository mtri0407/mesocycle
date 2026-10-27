# Ngày 1: dựng khung dự án (giải thích cho Trí)

## Cấu trúc thư mục

```
mesocycle/
├─ public/index.html     giao diện web (trình duyệt tải về)
├─ src/worker.js         máy chủ: nhận yêu cầu từ trình duyệt, gọi model
├─ src/models.js         lớp gọi model, dùng chung cho Meta và Baseten
├─ test/models.test.js   kiểm thử tự động cho models.js
├─ .dev.vars.example     mẫu khai báo khoá bí mật (file thật .dev.vars không lên GitHub)
├─ .gitignore            danh sách file git bỏ qua
└─ wrangler.toml         cấu hình Cloudflare Worker
```

## Vì sao làm như vậy

**1. Khoá API chỉ nằm ở máy chủ.** Trình duyệt gọi `/api/...` của Worker, Worker mới cầm `MODEL_API_KEY` gọi Meta. Nếu đặt key trong `index.html`, ai mở trang web bấm F12 cũng thấy và tiêu tiền của bạn.

**2. Biến môi trường thay vì ghi key vào code.** Code chỉ viết `env.MODEL_API_KEY`. Ở máy bạn, giá trị nằm trong `.dev.vars`; trên Cloudflare nằm trong "secret". Repo public mà key vẫn an toàn, vì `.dev.vars` có tên trong `.gitignore`.

**3. Một lớp `models.js` cho mọi model.** Meta Model API và Baseten đều nói chung một "ngôn ngữ" (chuẩn Chat Completions của OpenAI): cùng đường dẫn `/chat/completions`, cùng dạng tin nhắn, cùng dạng tool call. Nên chỉ cần đổi `MODEL_PROVIDER=meta` thành `open` là agent chạy trên Muse Spark Open. Đây là cách để sau này so sánh hai model và nhắm giải "Best Build on Meta Open Weight Models".

**4. Tách "dựng yêu cầu" khỏi "gửi yêu cầu".** `buildChatRequest` chỉ tạo yêu cầu, không gửi. Nhờ vậy test chạy được mà không cần mạng, không tốn tiền API.

**5. Không tin tuyệt đối vào JSON của model.** Tài liệu Meta ghi rõ tham số tool call "không đảm bảo đúng khuôn". `readChatResponse` giữ lại chuỗi gốc khi JSON hỏng, để agent báo lỗi rõ ràng thay vì sập.

## Kiểm thử

`npm test` chạy 5 phép thử: chọn đúng model, báo lỗi rõ khi thiếu key, dựng đúng yêu cầu, đọc được tool call kể cả khi tham số hỏng.

## Còn chờ

- Key Meta Model API (sau khi bạn tạo tài khoản dev.meta.ai và gắn thẻ) và key Baseten (link một lần trong mail). Có key thì bấm nút "Check model connection" trên trang là biết model trả lời được chưa.
