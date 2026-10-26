# ViralLens

App nghiên cứu video viral và đề xuất cải thiện video để **giữ chân người xem** và **tăng tương tác** (lấy cảm hứng từ Blow Up). Phân tích bằng Claude (đọc hình ảnh + structured output + web search).

## Tính năng

| Tab | Làm gì |
|---|---|
| **Dán link** | Dán link TikTok / YouTube / Instagram Reels / Facebook → app tự tải video, lấy tiêu đề, caption, views/likes/comments/shares và lời thoại từ phụ đề (nếu có), điền sẵn vào form. Có ở cả tab Phân tích và Nghiên cứu viral. |
| **Phân tích video** | Tải video của bạn lên (hoặc dán link) → chấm điểm Hook / Giữ chân / Nhịp / Hình ảnh / Kể chuyện / Tương tác / Tiềm năng viral, timeline nguy cơ người xem lướt đi theo từng đoạn, đề xuất sửa có mốc thời gian (bấm để tua), 3 phương án hook mới, tiêu đề / caption / hashtag / cover, checklist dựng lại. Có thể chọn video viral trong thư viện để so sánh. |
| **Nghiên cứu viral** | Tải một video viral (kèm views/likes/comments/shares) → giải mã vì sao viral: kiểu hook, cấu trúc nhịp, kỹ thuật dựng, yếu tố cảm xúc, động lực tương tác, công thức áp dụng lại. Tự lưu vào Thư viện. |
| **Xu hướng** | Nhập ngách + nền tảng → Claude tìm kiếm web và tổng hợp xu hướng, mẫu hook, ý tưởng video, có nguồn. |
| **Thư viện** | Kho công thức viral đã mổ xẻ (lưu trong trình duyệt), dùng làm tham chiếu khi phân tích. |

## Cách hoạt động

- Trình duyệt tự trích ~20-28 khung hình (dày hơn ở 3 giây đầu để đánh giá hook), thu nhỏ còn ≤768px rồi gửi lên server — video gốc **không** bị upload.
- Server (Express + TypeScript) gửi khung hình kèm mốc thời gian cho Claude và nhận kết quả JSON theo schema (`src/schemas.ts`).
- Claude không nghe được âm thanh: hãy dán lời thoại / text trên màn hình vào ô tương ứng để phân tích chính xác hơn.

## Chạy

Cần Node 20+, một Anthropic API key, và để dùng tính năng dán link: [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg.

```bash
pip install yt-dlp           # và cài ffmpeg (brew/apt/choco install ffmpeg)
npm install
export ANTHROPIC_API_KEY=sk-ant-...
npm run dev        # http://localhost:3000
```

Tuỳ chọn: `PORT`, `CLAUDE_MODEL` (mặc định `claude-opus-5-5`), `YTDLP_PATH` (đường dẫn yt-dlp nếu không nằm trong PATH).

Về dán link: video tải về được lưu tạm và tự xoá sau 1 giờ. Video riêng tư / cần đăng nhập sẽ không tải được; nếu TikTok/Instagram báo lỗi, chạy `yt-dlp -U` để cập nhật. Chỉ nên dùng để nghiên cứu, không đăng lại nội dung của người khác.

Trình duyệt cần giải mã được định dạng video (MP4/H.264 trên Chrome/Edge/Safari, hoặc WebM).

## Cấu trúc

```
src/server.ts    # API: /api/import, /api/analyze, /api/research, /api/trends
src/importer.ts  # Tải video từ link bằng yt-dlp (metadata + phụ đề)
src/claude.ts    # Gọi Claude (structured output, web search, xử lý lỗi)
src/schemas.ts   # Schema request + kết quả phân tích
src/prompts.ts   # System prompt (tiếng Việt)
public/          # Giao diện (HTML/CSS/JS thuần, không cần build)
```
