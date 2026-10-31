# Thiết kế lõi Mesocycle (chốt 27/10, bản 2)

Trí và Claude bàn và chốt ngày 27/10. Muốn đổi điểm nào thì bàn lại trước khi sửa code.

## Nguyên tắc sản phẩm

**Bên ngoài cực đơn giản, bên trong gánh hết độ phức tạp.**

Mọi lệch kế hoạch ngoài đời quy về 6 sự kiện: bắt đầu muộn, làm lâu hơn dự kiến, xong sớm, việc chen vào, bỏ qua, thời gian rảnh co lại. Cả 6 dẫn về một bài toán duy nhất, giải lại từ thời điểm hiện tại mỗi khi có thay đổi:

> Từ bây giờ tới hạn chót, việc còn lại có vừa thời gian còn lại không? Không vừa thì bỏ gì, theo thứ tự nào?

Những lỗi của lịch kín kiểu cũ mà Mesocycle phải tránh:
- Gắn giờ cho mọi việc nên trễ một việc là trễ dây chuyền (domino).
- Ước lượng luôn hụt (planning fallacy).
- Lỡ một việc là bỏ cả ngày (hiệu ứng "kệ luôn"), càng nặng khi lịch đánh dấu đỏ "thất bại".
- Bắt người dùng tự sửa lịch đúng lúc họ đang mệt và trễ.

Mesocycle dựa trên tâm lý **lập kế hoạch**, không tư vấn tâm lý hay sức khoẻ, không chấm tâm trạng.

## Bước đột phá (chốt bản 3, tối 27/10)

Bài học từ Greysteel Tasks: Trí bỏ engine xếp bù và quay sang chat với Claude, vì (1) engine bắt cài đặt trước, (2) xếp bù là đoán tương lai nên phát sinh tới lại vỡ, (3) engine coi thời gian như tiền lẻ, không hiểu nội dung việc nào quan trọng hơn, (4) chat có bối cảnh và chỉ cần nói. Mesocycle = trải nghiệm chat đó, cộng trí nhớ có cấu trúc, cộng luật bảo đảm, không cần cài đặt.

1. **Lập kế hoạch muộn và sổ nợ.** Chỉ hôm nay có hàng đợi cụ thể. Các ngày sau chỉ giữ ngân sách giờ theo vai trò và hạn chót. Việc làm thiếu thành **nợ** của mục tiêu đó, không bị nhét trước vào giờ nào. Agent trả nợ lúc check-in sáng hoặc khi có giờ trống, theo tình hình thật lúc đó.
2. **Mức sàn bảo vệ cuộc sống (luật cứng).** Mỗi vai trò có mục tiêu và mức sàn. Agent không bao giờ đề xuất cắt dưới sàn. Muốn phá sàn người dùng phải tự xác nhận. Pitch: *"Mesocycle không để bạn đổi cả cuộc sống lấy năng suất."* Đây là ngân sách thời gian, không phải lời khuyên sức khoẻ.
3. **Không cần cài đặt.** Không khai năng lượng hay khối đệm. App tự học từ hành vi thật (quá giờ bao nhiêu, làm gì hiệu quả lúc nào) và nói rõ điều đã học để người dùng sửa.

Vai trò của Trí theo thứ tự ưu tiên: GPA → Greysteel Education → Sức khoẻ và ngoại hình (gym, powerlifting) → Project → Hoạt động ngoại khoá (CLB, BCS). Thêm vai trò Gia đình và bạn bè với mức sàn. Trong hackathon, Greysteel là một vai trò có ngân sách giờ và việc kèm hạn chót, chưa chia theo mảng.

**Demo chính:** một ngày vỡ thật ("chiều nay bỏ 2 block Giải tích, tối có họp"). Agent tính nợ, báo rủi ro cho kỳ thi 08/11, đề xuất cắt đúng thứ tự, giữ nguyên mức sàn gia đình và gym. Kết bằng con số mô phỏng 100.000 ngày.

## Các quyết định

| Câu hỏi | Chốt |
|---|---|
| Ai xếp lịch | **Lai**: model quyết định qua tool, code kiểm tra từng lệnh và trả lỗi để model tự sửa |
| Việc linh hoạt | **Hàng đợi có thứ tự trong ngày**, giờ chỉ là ước tính và tự trượt. Chỉ lớp, thi, ngủ, lịch hẹn có giờ cứng |
| Dữ liệu | Vai trò có ngân sách giờ/tuần + việc + khối cố định + hàng đợi linh hoạt + nhật ký thay đổi |
| Phạm vi | **Cả tuần**, canh hạn chót chứ không canh giờ |
| Khi nào hỏi người dùng | **Chỉ khi phải cắt việc, dời sang ngày khác, hoặc hạn chót bị đe doạ.** Lệch nhỏ tự trượt. Mọi thay đổi hoàn tác được |
| Tuần quá tải | Agent nói thiếu bao nhiêu giờ, đề xuất cắt theo thứ tự luật 8, người dùng chọn |
| Ước lượng | **Tự học tốc độ thật** (giờ thật so với dự kiến theo từng vai trò/loại việc), cộng thêm và **hiện rõ lý do**. Tắt được |
| Màn chính | **Thẻ "Bây giờ"**: một việc nên làm ngay + 2 việc tiếp theo + nút nói/"Lệch kế hoạch". Lịch tuần là màn phụ |
| Thao tác hằng ngày | Xong / Cần thêm thời gian (+15, +30) / Không làm được, hoặc nói một câu ("tôi trễ 40 phút") |
| Giọng điệu | Không chữ đỏ, không "thất bại", không chuỗi phạt. Trễ thì kế hoạch co lại, không trách |
| Dữ liệu demo | Tuần thật của Trí (HUST, thi giữa kỳ 08/11), ẩn thông tin nhạy cảm |
| Giới hạn cá nhân | Mặc định theo quy tắc của Trí, người dùng tự chỉnh |

## Dữ liệu

- `roles`: id, tên, số giờ mục tiêu mỗi tuần.
- `tasks`: id, tên, vai trò, thời lượng ước tính, hạn chót, trạng thái.
- `fixed`: khối giờ cứng (lớp, thi, ngủ, hẹn): bắt đầu, kết thúc.
- `queue`: hàng đợi theo ngày: thứ tự, task, thời lượng, hạng (chính 1, 2, 3 hoặc phụ).
- `actuals`: giờ bắt đầu/kết thúc thật, để học tốc độ.
- `settings`: giờ ngủ, tỉ lệ lấp, độ dài block, đệm sau block.
- `changes`: nhật ký thay đổi, trạng thái trước/sau, để hoàn tác.

## Luật code kiểm tra

1. Không trùng giờ cứng.
2. Không sửa khối cố định.
3. Không đặt việc sau hạn chót của nó.
4. Không ra ngoài giờ thức.
5. Không vượt số phút liền tối đa.
6. Tham số tool sai khuôn thì trả lỗi rõ ràng, không sập.
7. Mỗi việc trong hàng đợi có hạng: chính (Block 1, 2, 3) hoặc phụ.
8. Thiếu giờ thì cắt theo thứ tự: phụ trước, rồi Block 3. Không tự cắt, phải đề xuất.
9. Không bao giờ lùi giờ ngủ.
10. Chỉ lấp tối đa một tỉ lệ giờ rảnh (mặc định 60%).

Lệnh vi phạm bị từ chối kèm lý do, ví dụ: `move rejected: overlaps fixed "Class" 09:00-11:00`.

## Tool cho model

`get_state` (hôm nay, tuần, hạn chót, tốc độ thật), `find_capacity` (giờ rảnh còn lại tới một mốc), `reorder_queue`, `move_to_day`, `add_item`, `cut_item`, `propose` (gửi đề xuất cần người dùng chọn).

## Kiểm chứng: bộ mô phỏng

Sinh ngẫu nhiên khoảng 100.000 ngày bị vỡ (trễ, quá giờ, chen việc, bỏ việc trộn lẫn), chạy bộ xếp lịch và kiểm tra luật không bao giờ bị phạm: giờ ngủ nguyên vẹn, khối cố định nguyên vẹn, hạn chót được giữ hoặc được báo trước. Kết quả đưa vào README và video demo.

## Ranh giới với dự án cũ

Greysteel Tasks là app khác, làm trước hackathon. Mesocycle viết mới hoàn toàn, không chép code cũ. Bài học rút ra từ nó (quá phức tạp, lịch kín gây domino) là lý do Mesocycle được thiết kế như trên.

## Kế hoạch code

- **Ngày 2 (28/10):** dữ liệu, bộ kiểm tra luật, hàng đợi tự trượt, tính giờ rảnh còn lại, bộ mô phỏng. Chưa cần model.
- **Ngày 3 (29/10):** vòng lặp agent gọi tool, thẻ "Bây giờ", đề xuất cắt và hoàn tác. Bàn system prompt với Trí trước khi viết.
