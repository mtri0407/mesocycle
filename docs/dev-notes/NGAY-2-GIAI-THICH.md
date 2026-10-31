# Ngày 2: bộ xếp lịch và bộ mô phỏng (giải thích cho Trí)

Làm tối 27/10, sớm hơn kế hoạch một ngày. Chưa gọi model nào, không tốn credit.

## Có gì mới

```
src/planner.js       bộ xếp lịch: luật nằm ở đây
src/invariants.js    "giám thị": 8 lời hứa viết thành phép kiểm tra
scripts/simulate.js  bộ mô phỏng ngày bị vỡ
test/planner.test.js 14 phép thử cho từng luật
```

Chạy thử:
```
npm test                       # 19 phép thử
npm run simulate               # 100.000 ngày, khoảng 17 giây
npm run simulate -- 1000 42    # 1.000 ngày với hạt giống 42
```

## Các khái niệm

**Hàm thuần (pure function).** Mọi hàm trong `planner.js` chỉ nhận dữ liệu vào và trả kết quả ra. Không đọc mạng, không ghi file, không gọi AI. Cùng đầu vào thì luôn cùng đầu ra. Nhờ vậy test chạy rất nhanh, và mô phỏng được 100.000 ngày trong vài giây.

**Giờ tính bằng phút.** 07:30 được lưu là 450. Cộng trừ số nguyên không bao giờ sai kiểu "23:55 cộng 10 phút". `toMin` và `toHHMM` đổi qua lại.

**Hàng đợi tự trượt.** Việc linh hoạt chỉ có thứ tự, giờ chỉ là ước tính. Hàm `layout` đặt từng việc vào chỗ trống đầu tiên đủ dài, sau mỗi việc chừa thời gian đệm. Dậy muộn 40 phút thì cả hàng trượt 40 phút, không có gì "vỡ".

**Thuật toán tham lam theo ưu tiên (greedy).** Khi không đủ chỗ, `replan` xét từng việc theo thứ tự ưu tiên:
1. Việc giúp một vai trò đạt mức sàn (ví dụ gọi về nhà khi tuần này mới có 3 giờ cho gia đình).
2. Block 1, rồi Block 2, Block 3, cuối cùng block phụ.
3. Cùng hạng thì vai trò ưu tiên cao hơn đi trước.

Việc nào thêm vào mà vẫn vừa thì giữ, không vừa thì đưa vào **đề xuất cắt**. Một việc kém quan trọng không bao giờ đẩy được việc quan trọng hơn ra ngoài.

**App không tự cắt.** `replan` chỉ trả về `cuts` kèm `needsUser: true`. Việc chỉ thật sự bị cắt khi người dùng đồng ý (sự kiện `cut`). Việc bị cắt hay bị bỏ không mất đi: nó thành **nợ** của vai trò đó (`debtByRole`), trả sau khi có giờ trống thật.

**6 sự kiện đời thực** (`applyEvent`): `late` (bắt đầu muộn), `work` (làm xong, quá giờ, xong sớm hoặc làm dở), `interrupt` (việc chen vào có giờ cứng), `skip` (bỏ), `add` (thêm việc), `cut` (đồng ý cắt). Hàm này không sửa dữ liệu cũ mà trả bản mới, nên luôn hoàn tác được.

**Tự học tốc độ** (`learnPace`). So giờ thật với giờ dự kiến của từng vai trò, lấy trung vị (median: số ở giữa khi xếp theo thứ tự, ít bị một ngày bất thường kéo lệch như số trung bình). Cần ít nhất 3 lần đo, và giới hạn trong khoảng 0,8 đến 2 lần. `adjustEstimate` trả kèm câu giải thích, ví dụ "You usually take 25% longer on this".

## Bộ mô phỏng

Chương trình tự tạo 100.000 ngày ngẫu nhiên: giờ dậy và giờ ngủ khác nhau, 0 đến 3 lớp học, 2 đến 9 việc, rồi tung xúc xắc cho chuyện xảy ra (trễ, quá giờ, họp chen vào, bỏ việc, thêm việc, đồng ý cắt). Sau **mỗi lần** xếp lại, "giám thị" kiểm tra 8 lời hứa:

1. Không lấn giờ ngủ, không xếp vào quá khứ.
2. Không chồng giờ với lớp học, lịch họp, hay với nhau.
3. Lịch cố định không bao giờ bị dời hay xoá.
4. Không việc nào biến mất âm thầm: mỗi việc hoặc có chỗ, hoặc nằm trong đề xuất cắt.
5. Không lấp quá tỉ lệ giờ rảnh (mặc định 60%).
6. Cắt việc thì luôn phải hỏi người dùng.
7. Chỉ đề xuất cắt khi việc đó thật sự không vừa.
8. Xuống dưới mức sàn thì luôn được báo.

**Hạt giống (seed).** Xúc xắc trong máy tính là giả ngẫu nhiên: cùng hạt giống thì ra cùng dãy số. Nếu ngày thứ 73.512 phạm luật, chạy lại với cùng hạt giống sẽ ra đúng ngày đó để sửa.

**Kiểm tra chính bộ kiểm tra.** "0 lỗi" chỉ có giá trị nếu giám thị thật sự bắt được lỗi. Tôi đã cố tình cài 3 lỗi vào một bản sao (cho làm lố giờ ngủ 30 phút, cắt việc mà không hỏi, quên luật 60%). Cả 3 bị bắt ngay trong 1.000 ngày đầu. Kỹ thuật này trong ngành gọi là *mutation testing*.

## Kết quả

```
Simulated 100,000 broken days, 995,856 re-plans in 17062 ms (seed 20261027).
Events: late 100,890, work 510,285, interrupt 90,064, cut 67,212, add 65,498, skip 70,102
Cut proposals asked: 223,463, floor warnings: 44,540.
Broken promises: 0
```

## Ngày 3

Agent: model đọc tình hình qua tool, đề xuất bằng tool, mọi lệnh đi qua `planner.js`. **Bàn system prompt với Trí trước khi viết.**
