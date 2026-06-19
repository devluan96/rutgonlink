# Video Deeplink Manual Checklist

Muc tieu: test nhanh nhanh video `link_type=video` de chac rang khi user bam lop mo thi app Shopee/TikTok mo dung, trong khi flow deeplink cua link thuong khong bi anh huong.

## Chuan bi

- Tao 2 short link video moi trong app:
  - 1 link Shopee
  - 1 link TikTok
- Moi link can:
  - `link_type = video`
  - `video_url` hop le
  - `original_url` la link dich that su can mo app
- Nen test tren:
  - 1 may Android co cai Shopee, TikTok, Facebook
  - 1 may iPhone co cai Shopee, TikTok, Facebook

## Ky vong chung

- User mo short link video
- Video page hien ra binh thuong
- Sau 5 giay, lop mo hien len
- User bam vao lop mo hoac nut `X`
- He thong chuyen qua `/go/:code`
- App dich mo dung neu may da cai app
- Neu khong mo duoc app thi fallback ve web dich

## Case 1: Shopee mobile browser

- Mo link video Shopee bang Chrome Android hoac Safari iPhone
- Cho 5 giay de lop mo hien ra
- Bam vao lop mo
- Ky vong:
  - Android:
    - neu la link product, Shopee app mo thang vao san pham
    - neu khong mo duoc app, trinh duyet quay ve trang Shopee web
  - iPhone:
    - Shopee app mo dung man hinh dich
    - neu fail, fallback ve Shopee web

## Case 2: TikTok mobile browser

- Mo link video TikTok bang Chrome Android hoac Safari iPhone
- Cho 5 giay de lop mo hien ra
- Bam vao lop mo
- Ky vong:
  - TikTok app mo dung video/profile/product tuong ung
  - neu fail, fallback ve URL TikTok goc tren web

## Case 3: Facebook in-app browser

- Gui link video Shopee vao Messenger hoac post/feed de mo bang Facebook app
- Mo link ngay trong Facebook in-app browser
- Cho 5 giay de lop mo hien ra
- Bam vao lop mo
- Ky vong:
  - Shopee:
    - di qua bridge page roi nhay app
    - neu app khong mo duoc thi ve Shopee web
  - TikTok:
    - di qua bridge page deeplink
    - neu app khong mo duoc thi ve TikTok web

## Case 4: Desktop fallback

- Mo link video Shopee va TikTok tren desktop browser
- Cho 5 giay de lop mo hien ra
- Bam vao lop mo
- Ky vong:
  - khong co co che mo native app
  - redirect thang ve URL dich goc

## Case 5: Nut X va lop mo cho cung mot ket qua

- Tren moi case o tren, test ca:
  - bam vao CTA o lop mo
  - bam vao nut `X`
- Ky vong:
  - ca 2 deu di chung 1 huong
  - khong co truong hop 1 nut mo app, 1 nut lai mo web sai

## Case 6: Link thuong khong bi anh huong

- Tao them 2 link khong phai video:
  - 1 link `deeplink` Shopee/TikTok
  - 1 link `direct`
- Test lai flow cu
- Ky vong:
  - `/:code` van hoat dong nhu truoc
  - link thuong khong bi chen video page
  - deeplink cu van mo dung app/web theo flow hien tai

## Neu co loi, ghi lai 4 thong tin nay

- URL short link
- Thiet bi + OS
- Mo tu dau:
  - Chrome
  - Safari
  - Facebook in-app
  - Messenger
- Ket qua thuc te:
  - mo app dung
  - mo web
  - dung o bridge page
  - khong lam gi

## Debug nhanh khi test fail

- Xac nhan user dang dung link video, khong phai link thuong
- Kiem tra sau khi bam lop mo, URL co nhay qua dang `/go/:code` hay khong
- Neu mo DevTools hoac proxy duoc, uu tien nhin 3 gia tri nay:
  - `X-RGL-Redirect-Mode`
  - `X-RGL-Redirect-Platform`
  - `Location`
- Cach doc nhanh:
  - `video-page`
    - short link dang vao dung trang video
  - `video-launch-shopee-direct-redirect`
    - overlay da day qua route moi va server dang redirect thang sang Shopee
  - `video-launch-deeplink-bridge`
    - overlay da day qua bridge deeplink, thuong gap voi TikTok
  - `video-launch-shopee-facebook-bridge`
    - overlay da vao nhanh Facebook in-app cho Shopee
  - `video-launch-desktop-redirect`
    - dang o desktop fallback
  - `video-launch-mobile-direct`
    - khong co deeplink dac biet, server dang day thang ve URL goc
- Neu khong thay `/go/:code`:
  - nghi truoc toi JS tren video page khong chay dung
  - hoac overlay/nut `X` khong goi `goApp()`
- Neu vao `/go/:code` roi nhung van khong mo app:
  - doi chieu `X-RGL-Redirect-Mode`
  - xem `Location` hoac body bridge page co dung domain dich mong doi khong
  - test lai tren browser ngoai app truoc, sau do moi test Facebook in-app

## Nhanh gon de ket luan

- Pass neu:
  - video page hien dung
  - lop mo bam duoc
  - `/go/:code` mo dung app hoac fallback dung web
  - link thuong van giu nguyen flow cu
- Fail neu:
  - bam lop mo ma dung o video page
  - mo sai app/sai man hinh
  - Facebook in-app bi ket
  - link thuong bi doi hanh vi sau khi them route moi
