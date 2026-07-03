# Search Console SEO Checklist

Domain triển khai: `https://boclink.click`

## 1. Việc cần làm ngay

1. Deploy bản hiện tại lên production.
2. Mở `https://boclink.click/robots.txt` và kiểm tra có dòng `Sitemap: https://boclink.click/sitemap.xml`.
3. Mở `https://boclink.click/sitemap.xml` và xác nhận có đủ 5 URL public bên dưới.
4. Vào Google Search Console, submit sitemap: `https://boclink.click/sitemap.xml`.
5. Dùng URL Inspection để `Request Indexing` cho 5 URL chính theo đúng thứ tự ở bảng dưới.

## 2. Danh sách URL cần submit

| Thứ tự | URL | Loại trang | Canonical mong muốn | Title hiện tại | Meta description hiện tại | Sitemap |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `https://boclink.click/` | Landing | `https://boclink.click/` | `BocLink.click \| Rút gọn link, tạo QR code và bio link cho Shopee, TikTok` | `Rút gọn link, tạo QR code, bio link và theo dõi click theo thời gian thực cho Shopee, TikTok và chiến dịch social commerce với BocLink.click.` | Có |
| 2 | `https://boclink.click/resources` | Hub tài nguyên | `https://boclink.click/resources` | `Tài nguyên BocLink cho short link, bio link và QR code \| BocLink.click` | `Trung tâm tài nguyên của BocLink về rút gọn link, bio link, QR code và tracking cho Shopee, TikTok, creator và social commerce.` | Có |
| 3 | `https://boclink.click/resources/rut-gon-link-shopee-tiktok` | Bài viết | `https://boclink.click/resources/rut-gon-link-shopee-tiktok` | `Hướng dẫn rút gọn link Shopee và TikTok hiệu quả hơn \| BocLink.click` | `Hướng dẫn rút gọn link Shopee và TikTok hiệu quả hơn với short link, QR code, bio link và cách đọc click cho social commerce.` | Có |
| 4 | `https://boclink.click/resources/bio-link-social-commerce` | Bài viết | `https://boclink.click/resources/bio-link-social-commerce` | `Bio link là gì và khi nào nên dùng cho social commerce? \| BocLink.click` | `Tìm hiểu bio link là gì, khi nào nên dùng bio link cho social commerce, creator, affiliate và cách gom nhiều CTA về một trang gọn hơn.` | Có |
| 5 | `https://boclink.click/resources/qr-code-ban-hang-social-commerce` | Bài viết | `https://boclink.click/resources/qr-code-ban-hang-social-commerce` | `Cách dùng QR code cho bán hàng và social post hiệu quả hơn \| BocLink.click` | `Cách dùng QR code cho bán hàng, social post, livestream và bề mặt offline để kéo traffic về Shopee, TikTok hoặc bio link hiệu quả hơn.` | Có |

## 3. Cách submit trong Search Console

Làm lần lượt cho từng URL:

1. Mở `Search Console > URL Inspection`.
2. Dán URL đầy đủ.
3. Chờ Google kiểm tra live URL.
4. Nếu trang truy cập được và không bị chặn index, bấm `Request Indexing`.
5. Ghi lại trạng thái vào bảng theo dõi bên dưới.

## 4. Không submit các URL này

Các URL nội bộ đã đặt `noindex` hoặc bị chặn crawl, không đưa vào vòng submit:

- `https://boclink.click/login`
- `https://boclink.click/register`
- `https://boclink.click/dashboard`
- Các route app như `/links`, `/create`, `/qr`, `/bio`, `/team`, `/admin`
- `https://boclink.click/404.html`
- `https://boclink.click/index.html`

## 5. Theo dõi trong 7-14 ngày

Sau khi submit, mỗi 2-3 ngày kiểm tra 4 điểm này:

1. URL nào đã được index.
2. Query nào bắt đầu có impression.
3. Trang nào có impression nhưng CTR thấp.
4. Trang nào chưa được index hoặc bị canonical sang URL khác.

## 6. Bảng theo dõi đề xuất

| URL | Submitted ngày | Index status | Canonical Google chọn | Impressions | Clicks | CTR | Avg position | Ghi chú hành động tiếp |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `https://boclink.click/` |  |  |  |  |  |  |  |  |
| `https://boclink.click/resources` |  |  |  |  |  |  |  |  |
| `https://boclink.click/resources/rut-gon-link-shopee-tiktok` |  |  |  |  |  |  |  |  |
| `https://boclink.click/resources/bio-link-social-commerce` |  |  |  |  |  |  |  |  |
| `https://boclink.click/resources/qr-code-ban-hang-social-commerce` |  |  |  |  |  |  |  |  |

## 7. Cách đọc dữ liệu để quyết định vòng tối ưu tiếp theo

- Có impression nhưng CTR thấp: sửa `title` và `meta description` trước.
- Chưa có impression: tăng internal link hoặc viết thêm bài cùng cụm chủ đề.
- Bị Google chọn canonical khác: kiểm tra lại internal link, redirect và nội dung trùng lặp.
- Có impression đúng keyword và bắt đầu có click: mở rộng thêm 2-3 bài liên quan trong cùng cluster.
