require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const path    = require('path');
const { nanoid } = require('nanoid');
const { init: initDb } = require('./db');

const app      = express();
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '') || 
                 (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));

// DB handle – lazy init, reused across requests (Vercel reuses instances)
let db = null;
async function getDb() {
  if (!db) db = await initDb();
  return db;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function detectPlatform(ua = '') {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return 'ios';
  if (/android/.test(u))          return 'android';
  return 'desktop';
}

function buildDeeplink(originalUrl, platform) {
  // Shopee product: shopee.vn/...-i.<shopId>.<itemId>
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [, shopId, itemId] = sp;
    return {
      deeplink: platform === 'ios'
        ? `shopee://i.${shopId}.${itemId}`
        : `shopee://product/${shopId}/${itemId}`,
      fallback: originalUrl,
      platform_name:   'shopee',
      ios_store:  'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store: 'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }

  // Shopee generic
  if (/shopee\.vn/i.test(originalUrl)) {
    return {
      deeplink: 'shopee://home',
      fallback: originalUrl,
      platform_name:   'shopee',
      ios_store:  'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store: 'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }

  // TikTok video
  const tv = originalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tv) {
    return {
      deeplink: `snssdk1233://aweme/detail?aweme_id=${tv[1]}`,
      fallback: originalUrl,
      platform_name:   'tiktok',
      ios_store:  'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store: 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    };
  }

  // TikTok profile
  const tu = originalUrl.match(/tiktok\.com\/@([^/?&#]+)/i);
  if (tu) {
    return {
      deeplink: `snssdk1233://user/profile?uniqueId=${tu[1]}`,
      fallback: originalUrl,
      platform_name:   'tiktok',
      ios_store:  'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store: 'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    };
  }

  return { deeplink: null, fallback: originalUrl, platform_name: 'generic' };
}

// ─── API: Shorten ────────────────────────────────────────────────────────────

app.post('/api/shorten', async (req, res) => {
  try {
    const db = await getDb();
    let { url, alias } = req.body;

    if (!url) return res.status(400).json({ error: 'URL không hợp lệ' });
    // Auto-prepend https if missing
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    // Decode nếu bị double-encode, sau đó validate
    try {
      // Thử parse thẳng trước
      new URL(url);
    } catch {
      // Thử decode rồi parse lại
      try {
        url = decodeURIComponent(url);
        new URL(url);
      } catch {
        return res.status(400).json({ error: 'URL không hợp lệ, vui lòng kiểm tra lại' });
      }
    }

    if (alias) {
      alias = alias.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (alias.length < 2) return res.status(400).json({ error: 'Alias phải có ít nhất 2 ký tự' });
      const taken = await db.getLinkByAlias(alias) || await db.getLinkByCode(alias);
      if (taken) return res.status(400).json({ error: 'Alias đã được dùng, hãy chọn alias khác' });
    } else {
      alias = null;
    }

    const existing = await db.getLinkByUrl(url);
    if (existing) {
      const code = existing.alias || existing.short_code;
      return res.json({ short_url: `${BASE_URL}/${code}`, short_code: code, original_url: url, clicks: existing.clicks, reused: true });
    }

    const shortCode = nanoid(7);
    await db.createLink(shortCode, url, alias);
    const code = alias || shortCode;
    return res.json({ short_url: `${BASE_URL}/${code}`, short_code: code, original_url: url, clicks: 0, reused: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Lỗi server: ' + err.message });
  }
});

// ─── API: Stats ──────────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  try {
    const db = await getDb();
    const totals = await db.getTotals();
    const recent = (await db.getRecentLinks()).map(l => ({
      ...l,
      short_url: `${BASE_URL}/${l.alias || l.short_code}`,
    }));
    res.json({ ...totals, recent });
  } catch (err) {
    console.error('stats error:', err);
    res.status(500).json({ error: 'Lỗi server: ' + err.message });
  }
});

// ─── Redirect ────────────────────────────────────────────────────────────────

app.get('/:code', async (req, res) => {
  const { code } = req.params;
  if (code.includes('.')) return res.status(404).send('Not found');

  try {
    const db = await getDb();
    const link = await db.getLinkByAlias(code) || await db.getLinkByCode(code);
    if (!link) return res.status(404).sendFile(path.join(__dirname, '..', 'public', '404.html'));

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || '';
    await db.recordClick(link.id, ip, req.headers['user-agent'] || '', req.headers['referer'] || '');

    const platform     = detectPlatform(req.headers['user-agent']);
    const deeplinkInfo = buildDeeplink(link.original_url, platform);

    if (platform === 'desktop' || !deeplinkInfo.deeplink) {
      return res.redirect(302, link.original_url);
    }
    return res.send(buildRedirectPage(link.original_url, deeplinkInfo, platform));
  } catch (err) {
    console.error(err);
    return res.status(500).send('Server error');
  }
});

// ─── Redirect Page ───────────────────────────────────────────────────────────

function buildRedirectPage(originalUrl, info, platform) {
  const { deeplink, fallback, platform_name, ios_store, play_store } = info;
  const labels = { shopee: 'Shopee', tiktok: 'TikTok', generic: '' };
  const colors = { shopee: '#ee4d2d', tiktok: '#010101', generic: '#6366f1' };
  const label  = labels[platform_name] || '';
  const color  = colors[platform_name] || '#6366f1';
  const icons  = {
    shopee: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="16" fill="#EE4D2D"/><path d="M32 12C25 12 19 18 19 25H16C15.4 25 15 25.4 15 26V48C15 48.6 15.4 49 16 49H48C48.6 49 49 48.6 49 48V26C49 25.4 48.6 25 48 25H45C45 18 39 12 32 12ZM32 15C37.5 15 42 19.5 42 25H22C22 19.5 26.5 15 32 15ZM18 28H46V46H18V28ZM32 31C29.8 31 28 32.8 28 35C28 37.2 29.8 39 32 39C34.2 39 36 37.2 36 35C36 32.8 34.2 31 32 31Z" fill="white"/></svg>`,
    tiktok: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="16" fill="#010101"/><path d="M46 22C43.2 22 40.8 20.8 39 18.8V35C39 41.6 33.6 47 27 47C20.4 47 15 41.6 15 35C15 28.4 20.4 23 27 23V29.8C23.8 29.8 21.2 32.4 21.2 35.6C21.2 38.8 23.8 41.4 27 41.4C30.2 41.4 32.8 38.8 32.8 35.6V15H39C39 20 42 24 46 24V22Z" fill="white"/></svg>`,
    generic: `<svg width="64" height="64" viewBox="0 0 64 64" fill="none"><rect width="64" height="64" rx="16" fill="#6366f1"/><path d="M32 14C22 14 14 22 14 32C14 42 22 50 32 50C42 50 50 42 50 32C50 22 42 14 32 14ZM30 45.8C23.4 44.8 18 39 18 32C18 30.8 18.2 29.6 18.5 28.5L26 36V37.5C26 39.2 27.3 40.5 29 40.5L30 45.8ZM41.2 42C40.7 40.5 39.3 39.5 37.5 39.5H35.5V34C35.5 33.2 34.8 32.5 34 32.5H24V29.5H27C27.8 29.5 28.5 28.8 28.5 28V25H31.5C32.8 25 33.8 24 33.8 22.8V22.2C37.6 23.6 40.6 26.9 41.7 31C41.9 31.6 42 32.3 42 33C42 36.1 41.8 39.3 41.2 42Z" fill="white"/></svg>`,
  };
  const storeUrl  = platform === 'ios' ? (ios_store || fallback) : (play_store || fallback);
  const storeText = platform === 'ios' ? 'Tải trên App Store' : 'Tải trên Google Play';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>Đang mở${label ? ' '+label : ''}...</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f4ff,#faf0ff);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:24px;padding:40px 28px;max-width:380px;width:100%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,.12)}
.icon{margin-bottom:20px}
.progress{width:64px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 24px;overflow:hidden}
.bar{height:100%;background:${color};border-radius:2px;animation:p 2.5s ease forwards}
@keyframes p{from{width:0}to{width:100%}}
h1{font-size:20px;font-weight:800;color:#111;margin-bottom:8px}
p{font-size:14px;color:#6b7280;margin-bottom:28px;line-height:1.6}
.btn{display:block;padding:15px 20px;border-radius:14px;font-size:15px;font-weight:700;text-decoration:none;margin-bottom:10px;transition:.15s}
.btn:active{transform:scale(.97)}
.btn-app{background:${color};color:#fff}
.btn-web{background:#f3f4f6;color:#374151}
.btn-store{background:#111;color:#fff;font-size:13px}
.sep{font-size:12px;color:#9ca3af;margin:4px 0 10px}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${icons[platform_name]||icons.generic}</div>
  <div class="progress"><div class="bar"></div></div>
  <h1 id="t">Đang mở${label?' '+label:''}...</h1>
  <p id="d">Chờ một chút, đang chuyển bạn vào ứng dụng.</p>
  <a href="${deeplink}" class="btn btn-app" id="btnApp">Mở trong ${label||'ứng dụng'}</a>
  <a href="${fallback}" class="btn btn-web">Xem trên trình duyệt</a>
  <div class="sep">Chưa cài ứng dụng?</div>
  <a href="${storeUrl}" class="btn btn-store">${storeText}</a>
</div>
<script>
(function(){
  var dl="${deeplink.replace(/"/g,'\\"')}",done=false;
  function go(){if(done)return;done=true;window.location.href=dl;setTimeout(function(){document.getElementById('t').textContent='Không mở được ứng dụng?';document.getElementById('d').textContent='Bạn có thể xem trên trình duyệt hoặc tải ứng dụng.';},2500);}
  setTimeout(go,300);
  document.getElementById('btnApp').onclick=function(e){e.preventDefault();done=false;go();};
})();
</script>
</body>
</html>`;
}

// ─── Export for Vercel ───────────────────────────────────────────────────────
module.exports = app;

// ─── Local dev ───────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}
