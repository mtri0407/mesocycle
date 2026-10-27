# Thiết kế lõi Mesocycle (đã chốt 27/10)

Trí và Claude bàn và chốt ngày 27/10. Muốn đổi điểm nào thì bàn lại trước khi sửa code.

## Các quyết định

| Câu hỏi | Chốt |
|---|---|
| Ai xếp lịch | **Lai**: model quyết định qua tool, code kiểm tra từng lệnh và trả lỗi để model tự sửa |
| Dữ liệu | **Vai trò có ngân sách giờ mỗi tuần** + việc + khối giờ cố định/linh hoạt + nhật ký thay đổi |
| Phạm vi xếp | **Cả tuần** |
| Dữ liệu demo | **Tuần thật của Trí** (HUST, Greysteel, thi giữa kỳ 08/11), ẩn thông tin nhạy cảm |
| Tuần quá tải | Agent nói rõ thiếu bao nhiêu giờ, đưa 2 cách cắt, **người dùng chọn** |
| Duyệt | Danh sách từng thay đổi, mỗi dòng bỏ được, có nút duyệt tất cả và hoàn tác |
| Giới hạn cá nhân | **Người dùng tự khai** (giờ thức, số giờ liền tối đa). App không khuyên về sức khoẻ |

## Dữ liệu

- `roles`: id, tên, số giờ mục tiêu mỗi tuần.
- `tasks`: id, tên, vai trò, thời lượng ước tính (phút), hạn chót, ưu tiên (cao/vừa/thấp), trạng thái.
- `blocks`: id, tên, bắt đầu, kết thúc, vai trò, task (nếu có), `fixed` (cố định) hoặc `flexible` (linh hoạt).
- `settings`: giờ thức (vd 06:30 đến 23:30), số phút liền tối đa cho một khối.
- `changes`: id, thời điểm, loại thao tác, trạng thái trước, trạng thái sau, đã duyệt/đã hoàn tác.

## Tool cho model

| Tool | Việc |
|---|---|
| `get_week` | Xem tuần: khối giờ, việc, giờ đã dùng theo vai trò |
| `find_free_slots` | Tìm giờ trống theo thời lượng và khoảng ngày |
| `add_block`, `move_block`, `remove_block` | Sửa lịch nháp |
| `propose_plan` | Nộp các thay đổi để người dùng duyệt |

Model chỉ sửa **bản nháp**. Lịch thật chỉ đổi khi người dùng duyệt.

## Luật code kiểm tra

1. Không trùng giờ với khối khác.
2. Không sửa hoặc dời khối cố định.
3. Không đặt khối của một việc sau hạn chót việc đó.
4. Không ra ngoài giờ thức người dùng khai.
5. Không vượt số phút liền tối đa.
6. Tham số tool sai khuôn (JSON hỏng, thiếu trường) thì trả lỗi rõ ràng, không sập.

### Luật bổ sung (chốt tối 27/10, lấy từ cách Trí tự lên lịch ôn thi)

7. Mỗi khối linh hoạt có hạng: **chính** (Block 1, 2, 3 theo thứ tự) hoặc **phụ**.
8. Khi thiếu giờ, thứ tự cắt bắt buộc: bỏ khối phụ trước, rồi rút Block 3. Agent đề xuất cắt theo đúng thứ tự này, người dùng duyệt.
9. Giờ ngủ là khối cố định. Không bao giờ lùi giờ ngủ để nhét việc.
10. Chỉ lấp tối đa một tỉ lệ giờ rảnh (mặc định 60%). Phần còn lại để dành cho ăn, chuyển việc, phát sinh.

Mọi con số (tỉ lệ lấp, độ dài block, đệm sau block, giờ ngủ) có giá trị mặc định theo quy tắc của Trí và người dùng tự chỉnh trong cài đặt.

Lệnh vi phạm bị từ chối kèm lý do cụ thể, ví dụ: `move_block rejected: overlaps fixed block "Class" 09:00-11:00`.

## Ranh giới với dự án cũ

Greysteel Tasks ("Lịch thông minh") là app khác, làm trước hackathon. Mesocycle viết mới hoàn toàn, không chép code cũ.

## Kế hoạch code

- **Ngày 2 (28/10):** dữ liệu + bộ kiểm tra luật + `find_free_slots`, test kỹ. Chưa cần model.
- **Ngày 3 (29/10):** vòng lặp agent gọi tool, màn duyệt và hoàn tác. Bàn system prompt với Trí trước khi viết.
