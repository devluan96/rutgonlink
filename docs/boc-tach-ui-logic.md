# Boc tach UI + logic repo `rutgonlink`

Tai lieu nay dung de copy nhanh giao dien va luong logic cua repo hien tai ma khong can doc lan tung file.

## 1) Repo nay gom 3 lop chinh

### Lop 1: Landing page public
- File chinh: `public/landing.html`
- Hanh vi landing: `public/landing.js`
- Helper dung chung cho auth + affiliate detect: `public/shared-client.js`

Landing page la trang marketing + form rut gon nhanh. Phan nay co:
- Hero section, card 3D, animation typing, light/dark mode
- Form nhap URL de rut gon ngay
- Gate affiliate: link Shopee/TikTok thi bat dang nhap, co the yeu cau nang goi
- Ket qua link ngan + copy to clipboard

Neu ban muon copy giao dien ngoai vao ma chua can dashboard, day la cum file can lay dau tien.

### Lop 2: App shell sau dang nhap
- Markup man hinh app: `public/index.html`
- Style app: `public/app.css`
- Toan bo logic client: `public/app.js`

App shell la dashboard SPA thu cong, khong dung React/Vue. `public/app.js` la file rat lon, chua:
- Dieu huong tab: dashboard, stats, links, create, qr, bio, team, account, admin
- Render state nguoi dung
- Tao link, sua link, QR, bio page, team workspace
- Billing, notifications, 2FA, affiliate health

Neu ban chi muon copy giao dien, co the cat theo tung khu:
- Landing: `public/landing.html` + `public/landing.js`
- Dashboard/app: `public/index.html` + `public/app.css` + mot phan `public/app.js`

### Lop 3: Backend API + data
- Server/API: `api/index.js`
- Tang truy cap DB Supabase: `api/db.js`
- Rule nhan dien affiliate: `affiliate.js`

Backend dang gom:
- Auth cookie/JWT
- API rut gon link
- Upload image/video
- Link redirect, video preview page, OG meta page
- Team workspace, bio, billing, analytics

## 2) File nao giu logic nao

### `public/shared-client.js`
Day la helper frontend dung chung:
- Tao auth URL co `next`
- Tinh initials/display name
- Phat hien link affiliate Shopee/TikTok

Neu copy UI sang repo moi, nen giu file nay de tranh lap logic nho.

### `public/landing.js`
Day la logic landing public:
- Doc theme tu `localStorage`
- Goi `/api/auth/me` de biet user da dang nhap chua
- Xu ly submit form rut gon
- Chan affiliate neu chua co quyen
- Hien ket qua, copy link, animation typing

Logic quan trong nhat cua landing nam trong ham submit rut gon va gate affiliate.

### `public/app.js`
Day la bo nao cua dashboard:
- State lon o dau file
- Dinh nghia text giao dien, route, menu, widget
- Xu ly toan bo thao tac tao/sua/link/QR/bio/team
- Tu dong show app shell neu da co session

Muon copy tung man hinh thi nen tach nho file nay theo module:
- `links`
- `create`
- `stats`
- `bio`
- `team`
- `account`

### `api/index.js`
Day la backend Express:
- Serve landing va app shell
- API auth
- API shorten
- Redirect short link
- Tao trang OG / trang video overlay
- Upload media

Ban co the xem no nhu 2 nhom:
- Nhom public: `/`, `/login`, `/register`, short link, preview pages
- Nhom private: `/api/...` cho dashboard

### `api/db.js`
Day la DAL cho Supabase. Mot so ham can dung khi copy logic:
- User: create/get/update/revoke session
- Link: create/get/update/delete
- Click analytics: record click, recent links, totals, stats
- Domain, bio, workspace, billing

Neu clone app sang repo moi ma van dung Supabase, file nay la so do bang + query can hoc theo.

### `affiliate.js`
File nho nhung rat quan trong:
- Xac dinh URL nao duoc coi la affiliate
- Dung chung cho frontend va backend de rule khong bi lech

## 3) Flow ky thuat quan trong nhat

### Flow A: Rut gon link tu landing
1. User nhap URL trong landing form.
2. `public/landing.js` kiem tra co phai affiliate khong.
3. Neu la affiliate:
   - Chua dang nhap: bat login/register
   - Da dang nhap nhung chua du quyen: gate/upgrade
4. Frontend POST len `/api/shorten`.
5. `api/index.js` validate, tao short code/alias, luu DB qua `api/db.js`.
6. Frontend hien short URL va cho copy.

### Flow B: Mo short link
1. User hit vao short code.
2. Backend tim link theo alias/short code.
3. Neu la direct link thi redirect/serve OG meta.
4. Neu la video link thi render trang preview overlay roi moi deep link tiep.
5. Backend ghi click analytics.

### Flow C: App shell sau dang nhap
1. User vao route app nhu `/dashboard`.
2. `api/index.js` check session cookie.
3. Neu hop le thi serve `public/index.html`.
4. `public/app.js` goi `/api/auth/me`.
5. Co user thi render dashboard; khong co thi day ve login.

## 4) Neu ban muon copy "giao dien" thi lay gi truoc

### Goi minimum
- `public/landing.html`
- `public/landing.js`
- `public/shared-client.js`

Dung khi ban chi muon hero, form shorten, ket qua, theme, typing effect.

### Goi marketing + dashboard UI
- `public/landing.html`
- `public/landing.js`
- `public/index.html`
- `public/app.css`
- `public/app.js`
- `public/shared-client.js`

Dung khi ban muon copy giao dien gan nhu full.

### Goi full logic
- Toan bo `public/`
- `api/index.js`
- `api/db.js`
- `affiliate.js`
- `supabase/schema.sql`
- `supabase/migrations/*`

Dung khi ban muon copy ca UI lan behavior.

## 5) Thu tu doc de boc tach nhanh nhat

1. `public/shared-client.js`
2. `public/landing.js`
3. `api/index.js` voi route `/api/shorten`
4. `api/db.js` voi `createLink`, `getLinkByCode`, `recordClick`
5. `public/index.html`
6. `public/app.js`

Doc theo thu tu nay se de hieu luong end-to-end nhat.

## 6) Neu muon clone sang repo moi, nen tach lai nhu sau

Nen chia lai thanh cac module:
- `landing/`
- `auth/`
- `links/`
- `analytics/`
- `bio/`
- `team/`
- `billing/`

Frontend nen tach:
- `landing.js`
- `app-core.js`
- `app-links.js`
- `app-bio.js`
- `app-team.js`

Backend nen tach:
- `routes/auth.js`
- `routes/links.js`
- `routes/bio.js`
- `routes/team.js`
- `services/affiliate.js`
- `services/redirect.js`
- `services/video-preview.js`

## 7) Luu y khi copy

- Khong copy truc tiep secret trong `.env`
- Khong nen be nguyen `public/app.js` neu ban muon maintain lau dai, vi file dang rat to
- Rule affiliate frontend va backend phai giong nhau
- Neu doi domain, nho doi logic `BASE_URL`, domain active va OG image absolute URL

## 8) Muon minh boc tach sau hon theo link cu the?

Neu ban gui link website cu the, minh co the lam tiep 1 trong 3 kieu:
- Tach UI thanh HTML/CSS/component map
- Tach logic thanh flow API + event + state
- Dung lai bo suon tu repo nay de clone giao dien va behavior cua link do
