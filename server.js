const express = require('express');
const path    = require('path');
const { nanoid } = require('nanoid');
const { init: initDb } = require('./database');

const app      = express();
const PORT     = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// DB handle (populated after initDb resolves)
let db;

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectPlatform(ua = '') {
  const lower = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(lower)) return 'ios';
  if (/android/.test(lower))          return 'android';
  return 'desktop';
}

/**
 * Build deeplink info from the original URL.
 * Returns { deeplink, fallback, platform_name, android_package?, ios_store?, play_store? }
 */
function buildDeeplink(originalUrl, platform) {
  // ── Shopee product: shopee.vn/...-i.<shopId>.<itemId>
  const shopeeProduct = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (shopeeProduct) {
    const shopId = shopeeProduct[1];
    const itemId = shopeeProduct[2];
    return {
      deeplink: platform === 'ios'
        ? `shopee://i.${shopId}.${itemId}`
        : `shopee://product/${shopId}/${itemId}`,
      fallback: originalUrl,
      platform_name:   'shopee',
      android_package: 'com.shopee.vn',
      ios_store:  'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store: 'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }

  // ── Shopee generic (shop page / search / any shopee.vn)
  if (/shopee\.vn/i.test(originalUrl)) {
    return {
      deeplink: `shopee://home`,
      fallback: originalUrl,
      platform_name:   'shopee',
      android_package: 'com.shopee.vn',
      ios_store:  'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store: 'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }

  // ── TikTok video: tiktok.com/@user/video/<videoId>
  const tiktokVideo = originalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tiktokVideo) {
    const videoId = tiktokVideo[1];
    return {
      deeplink: `snssdk1233://aweme/detail?aweme_id=${videoId}`,
      fallback: originalUrl,
      platform_name:   'tiktok',
      android_package: 'com.zhiliaoapp.musically',
      ios_store:  'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store: 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    };
  }

  // ── TikTok profile
  const tiktokUser = originalUrl.match(/tiktok\.com\/@([^/?&#]+)/i);
  if (tiktokUser) {
    return {
      deeplink: `snssdk1233://user/profile?uniqueId=${tiktokUser[1]}`,
      fallback: originalUrl,
      platform_name:   'tiktok',
      android_package: 'com.zhiliaoapp.musically',
      ios_store:  'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store: 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    };
  }

  return { deeplink: null, fallback: originalUrl, platform_name: 'generic' };
}

// ─── API: Shorten ────────────────────────────────────────────────────────────

app.post('/api/shorten', async (req, res) => {
  try {
    let { url, alias } = req.body;

    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: 'URL không hợp lệ' });
    }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch {
      return res.status(400).json({ error: 'URL không hợp lệ' });
    }

    if (alias) {
      alias = alias.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (alias.length < 2) {
        return res.status(400).json({ error: 'Alias phải có ít nhất 2 ký tự hợp lệ' });
      }
      if (db.getLinkByAlias(alias) || db.getLinkByCode(alias)) {
        return res.status(400).json({ error: 'Alias này đã được dùng, hãy chọn alias khác' });
      }
    } else {
      alias = null;
    }

    // Reuse if URL already exists
    const existing = db.getLinkByUrl(url);
    if (existing) {
      const code = existing.alias || existing.short_code;
      return res.json({
        short_url:    `${BASE_URL}/${code}`,
        short_code:   code,
        original_url: url,
        clicks:       existing.clicks,
        reused:       true,
      });
    }

    const shortCode = nanoid(7);
    db.createLink(shortCode, url, alias);
    const code = alias || shortCode;

    return res.json({
      short_url:    `${BASE_URL}/${code}`,
      short_code:   code,
      original_url: url,
      clicks:       0,
      reused:       false,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Lỗi server: ' + err.message });
  }
});

// ─── API: Stats ──────────────────────────────────────────────────────────────

app.get('/api/stats', (req, res) => {
  try {
    const totals = db.getTotals();
    const recent = db.getRecentLinks().map(l => ({
      ...l,
      short_url: `${BASE_URL}/${l.alias || l.short_code}`,
    }));
    res.json({ ...totals, recent });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

// ─── Redirect ────────────────────────────────────────────────────────────────

const MIDDLE_DOMAIN = process.env.MIDDLE_DOMAIN || 'https://new-express.xyz';

app.get('/:code', async (req, res) => {
  const { code } = req.params;
  if (code.includes('.') || /^(api|uploads|admin)/.test(code)) 
    return res.status(404).send('Not found');

  try {
    const database = await getDb();
    const link = await database.getLinkByAlias(code) || await database.getLinkByCode(code);
    if (!link) return res.status(404).sendFile(path.join(__dirname,'..','public','404.html'));

    const ua = req.headers['user-agent'] || '';
    const platform = getMobilePlatform(ua);

    // Bot → OG page, không redirect, không count click
    if (isSocialBot(ua)) {
      res.set({ 'Cache-Control': 'no-cache,no-store,must-revalidate' });
      return res.send(buildOgPage(link, BASE_URL));
    }

    // Count click
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() 
             || req.socket?.remoteAddress || '';
    await database.recordClick(link.id, ip, ua, req.headers['referer']||'');

    const linkType = (link.link_type || 'direct').trim();
    
    // Video link
    if (linkType === 'video') return res.send(buildVideoPage(link));

    const info = detectPlatformDeep(link.original_url, platform);

    // ── Desktop → redirect thẳng ─────────────────────────────────────────
    if (platform === 'desktop') return res.redirect(302, link.original_url);

    // ── Shopee mobile → 301 qua new-express.xyz ──────────────────────────
    if (info.platform_name === 'shopee') {
      const middleUrl = `https://new-express.xyz/go?u=${encodeURIComponent(info.deeplink || link.original_url)}`;
      return res.redirect(301, middleUrl);
    }

    // ── TikTok + deeplink → bridge page ──────────────────────────────────
    if (info.deeplink || linkType === 'deeplink') {
      const shortUrl = `${BASE_URL}/${link.alias||link.short_code}`;
      res.set({ 'Cache-Control':'no-cache,no-store,must-revalidate', 'Pragma':'no-cache' });
      return res.send(buildDirectBridgePage(link, shortUrl, info));
    }

    // ── Mobile không có deeplink → redirect thẳng ────────────────────────
    return res.redirect(302, link.original_url);

  } catch(e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// ─── Redirect Page ───────────────────────────────────────────────────────────

function buildRedirectPage(originalUrl, info, platform) {
  const { deeplink, fallback, platform_name, ios_store, play_store } = info;

  const labels = { shopee: 'Shopee', tiktok: 'TikTok', generic: '' };
  const colors = { shopee: '#ee4d2d', tiktok: '#010101', generic: '#6366f1' };

  const label = labels[platform_name] || '';
  const color = colors[platform_name] || '#6366f1';

  const icons = {
    shopee: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="16" fill="#EE4D2D"/>
      <path d="M32 12C25 12 19 18 19 25H16C15.4 25 15 25.4 15 26V48C15 48.6 15.4 49 16 49H48C48.6 49 49 48.6 49 48V26C49 25.4 48.6 25 48 25H45C45 18 39 12 32 12ZM32 15C37.5 15 42 19.5 42 25H22C22 19.5 26.5 15 32 15ZM18 28H46V46H18V28ZM32 31C29.8 31 28 32.8 28 35C28 37.2 29.8 39 32 39C34.2 39 36 37.2 36 35C36 32.8 34.2 31 32 31Z" fill="white"/>
    </svg>`,
    tiktok: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="16" fill="#010101"/>
      <path d="M46 22C43.2 22 40.8 20.8 39 18.8V35C39 41.6 33.6 47 27 47C20.4 47 15 41.6 15 35C15 28.4 20.4 23 27 23V29.8C23.8 29.8 21.2 32.4 21.2 35.6C21.2 38.8 23.8 41.4 27 41.4C30.2 41.4 32.8 38.8 32.8 35.6V15H39C39 20 42 24 46 24V22Z" fill="white"/>
      <path d="M44 19.5C42 19.5 40.2 18.5 39 17V33C39 39.6 33.6 45 27 45C20.4 45 15 39.6 15 33C15 26.4 20.4 21 27 21V27.8C23.8 27.8 21.2 30.4 21.2 33.6C21.2 36.8 23.8 39.4 27 39.4C30.2 39.4 32.8 36.8 32.8 33.6V13H39C39 18 41.5 22 46 22L44 19.5Z" fill="#69C9D0" opacity="0.5"/>
    </svg>`,
    generic: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="16" fill="#6366f1"/>
      <path d="M32 14C22 14 14 22 14 32C14 42 22 50 32 50C42 50 50 42 50 32C50 22 42 14 32 14ZM30 45.8C23.4 44.8 18 39 18 32C18 30.8 18.2 29.6 18.5 28.5L26 36V37.5C26 39.2 27.3 40.5 29 40.5L30 45.8ZM41.2 42C40.7 40.5 39.3 39.5 37.5 39.5H35.5V34C35.5 33.2 34.8 32.5 34 32.5H24V29.5H27C27.8 29.5 28.5 28.8 28.5 28V25H31.5C32.8 25 33.8 24 33.8 22.8V22.2C37.6 23.6 40.6 26.9 41.7 31C41.9 31.6 42 32.3 42 33C42 36.1 41.8 39.3 41.2 42Z" fill="white"/>
    </svg>`,
  };

  const storeUrl  = platform === 'ios' ? (ios_store || fallback)  : (play_store || fallback);
  const storeText = platform === 'ios' ? 'Tải trên App Store' : 'Tải trên Google Play';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>Đang mở${label ? ' ' + label : ''}...</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f4ff 0%,#faf0ff 100%);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:24px;padding:40px 28px;max-width:380px;width:100%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,.12)}
.icon{margin-bottom:20px}
.progress{width:64px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 24px;overflow:hidden}
.progress-bar{height:100%;background:${color};border-radius:2px;animation:prog 2.5s ease forwards}
@keyframes prog{from{width:0}to{width:100%}}
.spinner{width:40px;height:40px;border:3px solid #e5e7eb;border-top-color:${color};border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 20px}
@keyframes spin{to{transform:rotate(360deg)}}
h1{font-size:20px;font-weight:800;color:#111;margin-bottom:8px}
p{font-size:14px;color:#6b7280;margin-bottom:28px;line-height:1.6}
.btn{display:block;padding:15px 20px;border-radius:14px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:10px;transition:transform .15s,opacity .15s}
.btn:active{transform:scale(.97)}
.btn-app{background:${color};color:#fff}
.btn-app:hover{opacity:.9}
.btn-web{background:#f3f4f6;color:#374151}
.btn-web:hover{background:#e5e7eb}
.btn-store{background:#111;color:#fff;font-size:13px}
.divider{font-size:12px;color:#9ca3af;margin:4px 0 10px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icons[platform_name] || icons.generic}</div>
  <div class="progress"><div class="progress-bar"></div></div>
  <h1 id="title">Đang mở${label ? ' ' + label : ''}...</h1>
  <p id="desc">Chờ một chút, đang chuyển bạn vào ứng dụng.</p>

  <a href="${deeplink}" class="btn btn-app" id="btnApp">
    Mở trong ${label || 'ứng dụng'}
  </a>
  <a href="${fallback}" class="btn btn-web">Xem trên trình duyệt</a>
  <div class="divider">Chưa cài ứng dụng?</div>
  <a href="${storeUrl}" class="btn btn-store">${storeText}</a>
</div>

<script>
(function(){
  var dl = ${JSON.stringify(deeplink)};
  var opened = false;

  function tryOpen(){
    if(opened) return;
    opened = true;
    window.location.href = dl;
    // After 2.5s still here → update UI
    setTimeout(function(){
      document.getElementById('title').textContent = 'Không mở được ứng dụng?';
      document.getElementById('desc').textContent = 'Bạn có thể xem trên trình duyệt hoặc tải ứng dụng về.';
    }, 2500);
  }

  // Auto-try on load
  setTimeout(tryOpen, 300);

  // Manual retry
  document.getElementById('btnApp').addEventListener('click', function(e){
    e.preventDefault();
    opened = false;
    tryOpen();
  });
})();
</script>
</body>
</html>`;
}

// ─── Start ───────────────────────────────────────────────────────────────────

(async () => {
  db = await initDb();
  app.listen(PORT, () => {
    console.log(`🚀 RutGonLink chạy tại ${BASE_URL}`);
    console.log(`   Deeplink: Shopee ✅  TikTok ✅`);
  });
})();
