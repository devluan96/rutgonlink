try { require('dotenv').config({ path: require('path').join(__dirname,'..', '.env') }); } catch(_){}

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { nanoid }   = require('nanoid');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
const { init: initDb } = require('./db');

const app      = express();
const BASE_URL = (process.env.BASE_URL||'').replace(/\/$/,'') ||
                 (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const JWT_SECRET = process.env.JWT_SECRET || 'rutgonlink-secret-2025';

// Plan limits
const PLANS = {
  free:     { dailyLimit: 10,  deeplink: false, ogMeta: false, upload: false },
  pro:      { dailyLimit: 500, deeplink: true,  ogMeta: true,  upload: true  },
  business: { dailyLimit: 0,   deeplink: true,  ogMeta: true,  upload: true  },
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Uploads dir (only works when self-hosted, not on Vercel)
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch(_){}

const storage = multer.diskStorage({
  destination: (_,__,cb) => cb(null, uploadsDir),
  filename: (_,file,cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, nanoid(12) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    cb(null, /\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname));
  },
});

let db = null;
async function getDb() { if (!db) db = await initDb(); return db; }

// ─── Auth Middleware ──────────────────────────────────────────────────────────

function parseToken(req) {
  const cookie = req.cookies?.token;
  const header = req.headers.authorization?.replace('Bearer ', '');
  return cookie || header || null;
}

function requireAuth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Token không hợp lệ' }); }
}

function optionalAuth(req, res, next) {
  const token = parseToken(req);
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch {}
  }
  next();
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function detectPlatformDeep(originalUrl, platform) {
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [,shopId,itemId] = sp;
    return { deeplink: platform==='ios' ? `shopee://i.${shopId}.${itemId}` : `shopee://product/${shopId}/${itemId}`,
      platform_name:'shopee', fallback: originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn' };
  }
  if (/shopee\.vn/i.test(originalUrl)) {
    return { deeplink:'shopee://home', platform_name:'shopee', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn' };
  }
  const tv = originalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tv) return { deeplink:`snssdk1233://aweme/detail?aweme_id=${tv[1]}`, platform_name:'tiktok', fallback:originalUrl,
    ios_store:'https://apps.apple.com/vn/app/tiktok/id1235601864',
    play_store:'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically' };
  const tu = originalUrl.match(/tiktok\.com\/@([^/?&#]+)/i);
  if (tu) return { deeplink:`snssdk1233://user/profile?uniqueId=${tu[1]}`, platform_name:'tiktok', fallback:originalUrl,
    ios_store:'https://apps.apple.com/vn/app/tiktok/id1235601864',
    play_store:'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically' };
  return { deeplink:null, platform_name:'generic', fallback:originalUrl };
}

function getMobilePlatform(ua='') {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return 'ios';
  if (/android/.test(u)) return 'android';
  return 'desktop';
}

// Social bots: must return OG page, not redirect
function isSocialBot(ua='') {
  return /facebookexternalhit|facebot|facebookcatalog|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|vkshare|zalo|vibebot|line\s|baiduspider|googlebot|applebot|bingbot|yandexbot|pinterestbot|snapchat/i.test(ua);
}

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── API: Debug ───────────────────────────────────────────────────────────────
app.get('/api/debug', (req,res) => res.json({
  has_turso_url: !!process.env.TURSO_DATABASE_URL,
  has_turso_token: !!process.env.TURSO_AUTH_TOKEN,
  base_url: BASE_URL,
}));

// ─── API: Auth ────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req,res) => {
  try {
    const db = await getDb();
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu phải có ít nhất 6 ký tự' });
    const hashed = await bcrypt.hash(password, 10);
    const user   = await db.createUser(email.toLowerCase().trim(), hashed, name);
    const token  = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch(e) {
    if (e.message === 'EMAIL_EXISTS') return res.status(400).json({ error: 'Email này đã được đăng ký' });
    console.error(e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

app.post('/api/auth/login', async (req,res) => {
  try {
    const db = await getDb();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
    const user = await db.getUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });
    const token = jwt.sign({ id: user.id, email: user.email, plan: user.plan }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('token', token, { httpOnly: true, maxAge: 7*24*3600*1000, sameSite: 'lax' });
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

app.post('/api/auth/logout', (req,res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', optionalAuth, async (req,res) => {
  if (!req.user) return res.json({ user: null });
  try {
    const db   = await getDb();
    const user = await db.getUserById(req.user.id);
    if (!user) return res.json({ user: null });
    res.json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── API: Upload Image ────────────────────────────────────────────────────────
// NOTE: On Vercel serverless, filesystem is ephemeral. Use Cloudinary/S3 for production.
app.post('/api/upload-image', requireAuth, upload.single('image'), (req,res) => {
  const plan = req.user?.plan || 'free';
  if (!PLANS[plan]?.upload) return res.status(403).json({ error: 'Tính năng này yêu cầu gói Pro', upgrade: true });
  if (!req.file) return res.status(400).json({ error: 'Không có file hoặc định dạng không hợp lệ (jpg, png, webp)' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ─── API: Shorten ─────────────────────────────────────────────────────────────

app.post('/api/shorten', optionalAuth, async (req,res) => {
  try {
    const db = await getDb();
    let { url, alias, og_title, og_desc, og_image } = req.body;

    if (!url) return res.status(400).json({ error: 'URL không hợp lệ' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch {
      try { url = decodeURIComponent(url); new URL(url); }
      catch { return res.status(400).json({ error: 'URL không hợp lệ' }); }
    }

    const userId   = req.user?.id    || null;
    const userPlan = req.user?.plan  || 'free';
    const planCfg  = PLANS[userPlan] || PLANS.free;

    // Check daily limit
    if (planCfg.dailyLimit > 0) {
      const todayCount = await db.countTodayLinks(userId);
      if (todayCount >= planCfg.dailyLimit) {
        return res.status(403).json({ error: `Bạn đã đạt giới hạn ${planCfg.dailyLimit} link/ngày của gói ${userPlan}. Vui lòng nâng cấp.`, upgrade: true });
      }
    }

    // Block deeplink/OG for free plan
    if (!planCfg.deeplink && (/shopee\.vn|tiktok\.com/i.test(url))) {
      return res.status(403).json({
        error: 'Deeplink Shopee & TikTok yêu cầu gói Pro trở lên',
        upgrade: true,
      });
    }

    if (!planCfg.ogMeta) { og_title = null; og_desc = null; og_image = null; }

    if (alias) {
      alias = alias.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (alias.length < 2) return res.status(400).json({ error: 'Alias phải có ít nhất 2 ký tự' });
      const taken = await db.getLinkByAlias(alias) || await db.getLinkByCode(alias);
      if (taken) return res.status(400).json({ error: 'Alias đã được dùng, hãy chọn alias khác' });
    } else { alias = null; }

    if (og_image) { try { new URL(og_image); } catch { og_image = null; } }

    const existing = await db.getLinkByUrl(url);
    if (existing && !og_title && !og_desc && !og_image && !alias) {
      const code = existing.alias || existing.short_code;
      return res.json({ short_url:`${BASE_URL}/${code}`, short_code:code, original_url:url, clicks:existing.clicks, reused:true });
    }

    const shortCode = nanoid(7);
    await db.createLink(shortCode, url, alias, og_title, og_desc, og_image, userId);
    const code = alias || shortCode;
    return res.json({ short_url:`${BASE_URL}/${code}`, short_code:code, original_url:url, clicks:0, reused:false });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

// ─── API: Stats ───────────────────────────────────────────────────────────────

app.get('/api/stats', optionalAuth, async (req,res) => {
  try {
    const db     = await getDb();
    const userId = req.user?.id || null;
    const totals = await db.getTotals(userId);
    const recent = (await db.getRecentLinks(userId)).map(l => ({
      ...l, short_url: `${BASE_URL}/${l.alias||l.short_code}`,
    }));
    res.json({ ...totals, recent, plan: req.user?.plan || 'guest' });
  } catch(e) {
    console.error(e);
    res.status(500).json({ error: 'Lỗi server: ' + e.message });
  }
});

// ─── Redirect ─────────────────────────────────────────────────────────────────

app.get('/:code', async (req,res) => {
  const { code } = req.params;
  if (code.includes('.') || code.startsWith('api') || code.startsWith('uploads')) return res.status(404).send('Not found');

  try {
    const db   = await getDb();
    const link = await db.getLinkByAlias(code) || await db.getLinkByCode(code);
    if (!link) return res.status(404).sendFile(path.join(__dirname,'..','public','404.html'));

    const ua = req.headers['user-agent'] || '';

    // ── Social bot → serve OG HTML page ──────────────────────────
    if (isSocialBot(ua)) {
      return res.send(buildOgPage(link, BASE_URL));
    }

    // ── Real user → count click then redirect ─────────────────────
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket?.remoteAddress||'';
    await db.recordClick(link.id, ip, ua, req.headers['referer']||'');

    const platform = getMobilePlatform(ua);
    const info     = detectPlatformDeep(link.original_url, platform);

    if (platform === 'desktop' || !info.deeplink) {
      return res.redirect(302, link.original_url);
    }
    return res.send(buildRedirectPage(link, info, platform));
  } catch(e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// ─── OG Page ──────────────────────────────────────────────────────────────────

function buildOgPage(link, baseUrl) {
  const shortUrl = `${baseUrl}/${link.alias||link.short_code}`;
  const title    = esc(link.og_title || link.original_url);
  const desc     = esc(link.og_desc  || 'Liên kết được rút gọn bởi RutGonLink');
  const image    = esc(link.og_image || `${baseUrl}/og-default.png`);
  const dest     = link.original_url;
  return `<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="UTF-8"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:type"        content="website"/>
<meta property="og:url"         content="${esc(shortUrl)}"/>
<meta property="og:title"       content="${title}"/>
<meta property="og:description" content="${desc}"/>
<meta property="og:image"       content="${image}"/>
<meta property="og:image:width"  content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:site_name"   content="RutGonLink"/>
<meta name="twitter:card"        content="summary_large_image"/>
<meta name="twitter:title"       content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image"       content="${image}"/>
<meta http-equiv="refresh" content="0;url=${esc(dest)}"/>
</head><body>
<script>window.location.replace(${JSON.stringify(dest)});</script>
</body></html>`;
}

// ─── Mobile Redirect Page ─────────────────────────────────────────────────────

function buildRedirectPage(link, info, platform) {
  const { deeplink, fallback, platform_name, ios_store, play_store } = info;
  const colors = { shopee:'#ee4d2d', tiktok:'#010101', generic:'#6366f1' };
  const labels = { shopee:'Shopee', tiktok:'TikTok', generic:'' };
  const color  = colors[platform_name]||'#6366f1';
  const label  = labels[platform_name]||'';
  const storeUrl  = platform==='ios' ? (ios_store||fallback) : (play_store||fallback);
  const storeText = platform==='ios' ? 'Tải trên App Store' : 'Tải trên Google Play';
  const ogImg = link.og_image ? `<img src="${esc(link.og_image)}" style="width:100%;border-radius:10px;margin-bottom:12px;max-height:180px;object-fit:cover" onerror="this.style.display='none'"/>` : '';
  const ogTitle = link.og_title ? `<p style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:4px;text-align:left">${esc(link.og_title)}</p>` : '';
  const ogDesc  = link.og_desc  ? `<p style="font-size:12px;color:#6b7280;margin-bottom:14px;text-align:left;line-height:1.5">${esc(link.og_desc)}</p>` : '';

  return `<!DOCTYPE html>
<html lang="vi"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>${esc(link.og_title||(label?'Mở '+label:'Đang mở...'))}</title>
<meta property="og:title" content="${esc(link.og_title||'')}"/>
<meta property="og:image" content="${esc(link.og_image||'')}"/>
<meta property="og:description" content="${esc(link.og_desc||'')}"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:linear-gradient(135deg,#f0f4ff,#faf0ff);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:100%;text-align:center;box-shadow:0 12px 60px rgba(0,0,0,.12)}
.progress{width:56px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 18px;overflow:hidden}
.bar{height:100%;background:${color};border-radius:2px;animation:p 2.5s ease forwards}
@keyframes p{from{width:0}to{width:100%}}
h1{font-size:18px;font-weight:800;color:#111;margin-bottom:6px}
.sub{font-size:13px;color:#6b7280;margin-bottom:20px}
.btn{display:block;padding:13px 20px;border-radius:12px;font-size:14px;font-weight:700;text-decoration:none;margin-bottom:9px;transition:.15s}
.btn:active{transform:scale(.97)}
.btn-app{background:${color};color:#fff}
.btn-web{background:#f3f4f6;color:#374151}
.btn-store{background:#111;color:#fff;font-size:13px}
.sep{font-size:11px;color:#9ca3af;margin:4px 0 9px}
</style>
</head><body>
<div class="card">
  <div class="progress"><div class="bar"></div></div>
  ${ogImg}${ogTitle}${ogDesc}
  <h1 id="t">Đang mở${label?' '+label:''}...</h1>
  <p class="sub" id="d">Chờ một chút...</p>
  <a href="${deeplink}" class="btn btn-app" id="btnApp">Mở trong ${label||'ứng dụng'}</a>
  <a href="${fallback}" class="btn btn-web">Xem trên trình duyệt</a>
  <div class="sep">Chưa cài ứng dụng?</div>
  <a href="${storeUrl}" class="btn btn-store">${storeText}</a>
</div>
<script>
(function(){
  var dl=${JSON.stringify(deeplink)},done=false;
  function go(){if(done)return;done=true;window.location.href=dl;
    setTimeout(function(){document.getElementById('t').textContent='Không mở được ứng dụng?';
    document.getElementById('d').textContent='Xem trên trình duyệt hoặc tải ứng dụng.';},2500);}
  setTimeout(go,300);
  document.getElementById('btnApp').onclick=function(e){e.preventDefault();done=false;go();};
})();
</script>
</body></html>`;
}

// ─── Export ───────────────────────────────────────────────────────────────────
module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT||3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`));
}
