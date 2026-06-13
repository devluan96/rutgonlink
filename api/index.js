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

const app        = express();
const BASE_URL   = (process.env.BASE_URL||'').replace(/\/$/,'') ||
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const JWT_SECRET = process.env.JWT_SECRET || 'rutgonlink-secret-2025';
// Email của admin (set trong .env hoặc mặc định)
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@rutgonlink.com').toLowerCase();

const PLANS = {
  free:     { dailyLimit: 10,  deeplink: false, ogMeta: false, upload: false, videoLink: false },
  pro:      { dailyLimit: 500, deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
  business: { dailyLimit: 0,   deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
  admin:    { dailyLimit: 0,   deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// File upload
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch(_){}
const upload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => cb(null, uploadsDir),
    filename: (_,file,cb) => cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_,file,cb) => cb(null, /\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)),
});

let db = null;
async function getDb() { if (!db) db = await initDb(); return db; }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function parseToken(req) {
  return req.cookies?.token || (req.headers.authorization||'').replace('Bearer ','') || null;
}

// IMPORTANT: always read plan from DB (not JWT) so plan changes take effect immediately
async function resolveUser(req) {
  const token = parseToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const database = await getDb();
    const user = await database.getUserById(payload.id);
    if (!user) return null;
    // Admin email always gets admin plan
    if (user.email.toLowerCase() === ADMIN_EMAIL) {
      user.plan = 'admin';
      user.role = 'admin';
    }
    return user;
  } catch { return null; }
}

function requireAuth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try { req._tokenPayload = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Token không hợp lệ' }); }
}

function requireAdmin(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: 'Chưa đăng nhập' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req._tokenPayload = p;
    // Will verify admin role in handler after DB lookup
    next();
  } catch { return res.status(401).json({ error: 'Token không hợp lệ' }); }
}

function getMobilePlatform(ua='') {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return 'ios';
  if (/android/.test(u)) return 'android';
  return 'desktop';
}

function isSocialBot(ua='') {
  return /facebookexternalhit|facebot|facebookcatalog|twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|vkshare|zalo|vibebot|line[\s/]|baiduspider|googlebot|applebot|bingbot|yandexbot|pinterestbot|snapchat|ia_archiver/i.test(ua);
}

function detectPlatformDeep(originalUrl, platform) {
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [,shopId,itemId] = sp;
    return {
      deeplink: platform==='ios' ? `shopee://i.${shopId}.${itemId}` : `shopee://product/${shopId}/${itemId}`,
      platform_name:'shopee', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }
  if (/shopee\.vn/i.test(originalUrl))
    return { deeplink:'shopee://home', platform_name:'shopee', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn' };
  const tv = originalUrl.match(/tiktok\.com\/@[^/]+\/video\/(\d+)/i);
  if (tv)
    return { deeplink:`snssdk1233://aweme/detail?aweme_id=${tv[1]}`, platform_name:'tiktok', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store:'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically' };
  const tu = originalUrl.match(/tiktok\.com\/@([^/?&#]+)/i);
  if (tu)
    return { deeplink:`snssdk1233://user/profile?uniqueId=${tu[1]}`, platform_name:'tiktok', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store:'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically' };
  return { deeplink:null, platform_name:'generic', fallback:originalUrl };
}

// ─── DEBUG ────────────────────────────────────────────────────────────────────
app.get('/api/debug', (req,res) => res.json({
  has_turso_url: !!process.env.TURSO_DATABASE_URL,
  base_url: BASE_URL,
  admin_email: ADMIN_EMAIL,
}));

// ─── AUTH ─────────────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req,res) => {
  try {
    const database = await getDb();
    const { email, password, name } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email và mật khẩu là bắt buộc' });
    if (password.length < 6) return res.status(400).json({ error:'Mật khẩu phải có ít nhất 6 ký tự' });
    const normalEmail = email.toLowerCase().trim();
    const hashed = await bcrypt.hash(password, 10);
    const isAdmin = normalEmail === ADMIN_EMAIL;
    const user = await database.createUser(normalEmail, hashed, name, isAdmin ? 'admin' : 'user');
    const effectivePlan = isAdmin ? 'admin' : user.plan;
    const token = jwt.sign({ id:user.id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    res.cookie('token', token, { httpOnly:true, maxAge:30*24*3600*1000, sameSite:'lax' });
    res.json({ user:{ id:user.id, email:user.email, name:user.name, plan:effectivePlan, role:isAdmin?'admin':'user' } });
  } catch(e) {
    if (e.message==='EMAIL_EXISTS') return res.status(400).json({ error:'Email này đã được đăng ký' });
    console.error(e);
    res.status(500).json({ error:'Lỗi server: '+e.message });
  }
});

app.post('/api/auth/login', async (req,res) => {
  try {
    const database = await getDb();
    const { email, password } = req.body;
    if (!email||!password) return res.status(400).json({ error:'Email và mật khẩu là bắt buộc' });
    const user = await database.getUserByEmail(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error:'Email hoặc mật khẩu không đúng' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error:'Email hoặc mật khẩu không đúng' });
    const isAdmin = user.email.toLowerCase() === ADMIN_EMAIL || user.role === 'admin';
    const effectivePlan = isAdmin ? 'admin' : user.plan;
    // Store only id in JWT – plan/role always fetched from DB
    const token = jwt.sign({ id:user.id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    res.cookie('token', token, { httpOnly:true, maxAge:30*24*3600*1000, sameSite:'lax' });
    res.json({ user:{ id:user.id, email:user.email, name:user.name, plan:effectivePlan, role:isAdmin?'admin':user.role||'user' } });
  } catch(e) { console.error(e); res.status(500).json({ error:'Lỗi server: '+e.message }); }
});

app.post('/api/auth/logout', (_,res) => {
  res.clearCookie('token');
  res.json({ ok:true });
});

app.get('/api/auth/me', async (req,res) => {
  const user = await resolveUser(req);
  if (!user) return res.json({ user:null });
  res.json({ user:{ id:user.id, email:user.email, name:user.name, plan:user.plan, role:user.role||'user' } });
});

// ─── UPLOAD IMAGE ─────────────────────────────────────────────────────────────
app.post('/api/upload-image', requireAuth, upload.single('image'), async (req,res) => {
  const user = await resolveUser(req);
  const plan = user?.plan || 'free';
  if (!PLANS[plan]?.upload) return res.status(403).json({ error:'Tính năng này yêu cầu gói Pro', upgrade:true });
  if (!req.file) return res.status(400).json({ error:'Không có file hoặc định dạng không hợp lệ' });
  res.json({ url:`/uploads/${req.file.filename}` });
});

// ─── ADMIN INIT (fix admin user in DB) ───────────────────────────────────────
app.post('/api/admin/init', async (req,res) => {
  const user = await resolveUser(req);
  if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error:'Không có quyền' });
  }
  const database = await getDb();
  await database.updateUserRole(user.id, 'admin');
  await database.updateUserPlan(user.id, 'admin');
  res.json({ ok:true, message:`User ${user.email} đã được set role=admin, plan=admin` });
});

// ─── ADMIN APIs ───────────────────────────────────────────────────────────────

async function checkAdmin(req, res) {
  const user = await resolveUser(req);
  if (!user || (user.role !== 'admin' && user.email.toLowerCase() !== ADMIN_EMAIL)) {
    res.status(403).json({ error:'Không có quyền truy cập' });
    return null;
  }
  // Auto-upgrade role in DB if needed
  if (user.email.toLowerCase() === ADMIN_EMAIL && user.role !== 'admin') {
    const database = await getDb();
    await database.updateUserRole(user.id, 'admin');
    await database.updateUserPlan(user.id, 'admin');
  }
  return user;
}

// GET all users
app.get('/api/admin/users', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const users = await database.getAllUsers();
    res.json({ users });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// PATCH user plan/role
app.patch('/api/admin/users/:id', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const { plan, role } = req.body;
    const uid = Number(req.params.id);
    if (plan) await database.updateUserPlan(uid, plan);
    if (role) await database.updateUserRole(uid, role);
    const updated = await database.getUserById(uid);
    res.json({ user:{ id:updated.id, email:updated.email, name:updated.name, plan:updated.plan, role:updated.role } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// DELETE user
app.delete('/api/admin/users/:id', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const uid = Number(req.params.id);
    await database.deleteUser(uid);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET all links (admin)
app.get('/api/admin/links', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const links = (await database.getAllLinks()).map(l => ({
      ...l, short_url:`${BASE_URL}/${l.alias||l.short_code}`,
    }));
    res.json({ links });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// DELETE link (admin)
app.delete('/api/admin/links/:id', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    await database.deleteLink(Number(req.params.id));
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// GET admin dashboard stats
app.get('/api/admin/stats', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const totals = await database.getAdminTotals();
    res.json(totals);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── SHORTEN ──────────────────────────────────────────────────────────────────

app.post('/api/shorten', async (req,res) => {
  try {
    const database = await getDb();
    const user = await resolveUser(req);
    let { url, alias, og_title, og_desc, og_image,
          link_type, video_url, video_overlay_text } = req.body;

    if (!url) return res.status(400).json({ error:'URL không hợp lệ' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch {
      try { url = decodeURIComponent(url); new URL(url); }
      catch { return res.status(400).json({ error:'URL không hợp lệ' }); }
    }

    const userId  = user?.id   || null;
    const plan    = user?.plan || 'free';
    const planCfg = PLANS[plan] || PLANS.free;

    // Daily limit (0 = unlimited)
    if (planCfg.dailyLimit > 0) {
      const todayCount = await database.countTodayLinks(userId);
      if (todayCount >= planCfg.dailyLimit)
        return res.status(403).json({ error:`Đã đạt giới hạn ${planCfg.dailyLimit} link/ngày. Vui lòng nâng cấp.`, upgrade:true });
    }

    // Deeplink gate
    if (!planCfg.deeplink && /shopee\.vn|tiktok\.com/i.test(url))
      return res.status(403).json({ error:'Deeplink Shopee & TikTok yêu cầu gói Pro trở lên', upgrade:true });

    // Video link gate
    link_type = link_type || 'direct';
    if (link_type === 'video' && !planCfg.videoLink)
      return res.status(403).json({ error:'Link Video yêu cầu gói Pro trở lên', upgrade:true });

    // OG gate
    if (!planCfg.ogMeta) { og_title=null; og_desc=null; og_image=null; }

    if (alias) {
      alias = alias.trim().replace(/[^a-zA-Z0-9_-]/g,'');
      if (alias.length < 2) return res.status(400).json({ error:'Alias phải có ít nhất 2 ký tự' });
      const taken = await database.getLinkByAlias(alias) || await database.getLinkByCode(alias);
      if (taken) return res.status(400).json({ error:'Alias đã được dùng' });
    } else { alias = null; }

    if (og_image) { try { new URL(og_image); } catch { og_image = null; } }
    if (video_url) { try { new URL(video_url); } catch { video_url = null; } }

    const shortCode = nanoid(7);
    await database.createLink(shortCode, url, alias, og_title, og_desc, og_image,
      userId, link_type, video_url||null, video_overlay_text||null);
    const code = alias || shortCode;
    return res.json({ short_url:`${BASE_URL}/${code}`, short_code:code, original_url:url, clicks:0, link_type });
  } catch(e) {
    console.error(e);
    return res.status(500).json({ error:'Lỗi server: '+e.message });
  }
});

// ─── STATS ────────────────────────────────────────────────────────────────────

app.get('/api/stats', async (req,res) => {
  try {
    const database = await getDb();
    const user   = await resolveUser(req);
    const userId = user?.id || null;
    const totals = await database.getTotals(userId);
    const recent = (await database.getRecentLinks(userId)).map(l => ({
      ...l, short_url:`${BASE_URL}/${l.alias||l.short_code}`,
    }));
    res.json({ ...totals, recent, plan: user?.plan||'guest' });
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

// ─── REDIRECT ─────────────────────────────────────────────────────────────────

app.get('/:code', async (req,res) => {
  const { code } = req.params;
  if (code.includes('.') || /^(api|uploads|admin)/.test(code)) return res.status(404).send('Not found');

  try {
    const database = await getDb();
    const link = await database.getLinkByAlias(code) || await database.getLinkByCode(code);
    if (!link) return res.status(404).sendFile(path.join(__dirname,'..','public','404.html'));

    const ua = req.headers['user-agent'] || '';

    // Bot → OG page
    if (isSocialBot(ua)) return res.send(buildOgPage(link, BASE_URL));

    // Count click
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket?.remoteAddress||'';
    await database.recordClick(link.id, ip, ua, req.headers['referer']||'');

    // ── Video link type ──────────────────────────────────────────
    if (link.link_type === 'video' && link.video_url) {
      return res.send(buildVideoPage(link));
    }

    // ── Normal deeplink ──────────────────────────────────────────
    const platform = getMobilePlatform(ua);
    const info     = detectPlatformDeep(link.original_url, platform);

    if (platform === 'desktop' || !info.deeplink)
      return res.redirect(302, link.original_url);

    return res.send(buildRedirectPage(link, info, platform));
  } catch(e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// ─── OG PAGE ──────────────────────────────────────────────────────────────────

function buildOgPage(link, baseUrl) {
  const shortUrl = `${baseUrl}/${link.alias||link.short_code}`;
  const title    = esc(link.og_title || link.original_url);
  const desc     = esc(link.og_desc  || 'Liên kết được rút gọn bởi RutGonLink');
  const image    = esc(link.og_image || `${baseUrl}/og-default.png`);
  return `<!DOCTYPE html><html lang="vi"><head>
<meta charset="UTF-8"/><title>${title}</title>
<meta name="description" content="${desc}"/>
<meta property="og:type"         content="website"/>
<meta property="og:url"          content="${esc(shortUrl)}"/>
<meta property="og:title"        content="${title}"/>
<meta property="og:description"  content="${desc}"/>
<meta property="og:image"        content="${image}"/>
<meta property="og:image:width"  content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:site_name"    content="RutGonLink"/>
<meta name="twitter:card"        content="summary_large_image"/>
<meta name="twitter:title"       content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image"       content="${image}"/>
<meta http-equiv="refresh" content="0;url=${esc(link.original_url)}"/>
</head><body><script>window.location.replace(${JSON.stringify(link.original_url)});</script></body></html>`;
}

// ─── VIDEO PAGE ───────────────────────────────────────────────────────────────

function buildVideoPage(link) {
  const deeplinkInfo = detectPlatformDeep(link.original_url, 'android');
  const deeplink     = deeplinkInfo.deeplink || link.original_url;
  const fallback     = link.original_url;
  const overlayText  = esc(link.video_overlay_text || '🛒 Bấm vào đây để ủng hộ và xem sản phẩm →');
  const ogTitle      = esc(link.og_title || 'Xem video');
  const ogImage      = esc(link.og_image || '');

  // Detect if video URL is YouTube, TikTok embed, or direct mp4
  const videoUrl  = link.video_url || '';
  let   videoHtml = '';

  const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const ytEmbed = videoUrl.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);

  if (ytMatch || ytEmbed) {
    const vid = ytMatch ? ytMatch[1] : ytEmbed[1];
    videoHtml = `<iframe id="videoEl" src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&enablejsapi=1"
      frameborder="0" allow="autoplay;encrypted-media" allowfullscreen
      style="width:100%;height:100%;position:absolute;top:0;left:0"></iframe>`;
  } else {
    // Direct video file or TikTok/other embed
    videoHtml = `<video id="videoEl" src="${esc(videoUrl)}" autoplay muted playsinline
      style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0"></video>`;
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>${ogTitle}</title>
${ogImage ? `<meta property="og:image" content="${ogImage}"/>` : ''}
<meta property="og:title" content="${ogTitle}"/>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}

/* Video container */
.video-wrap{position:relative;width:100vw;height:100vh;background:#000}

/* Overlay */
.overlay{
  position:absolute;inset:0;z-index:10;
  background:linear-gradient(to bottom,rgba(0,0,0,.15) 0%,rgba(0,0,0,.0) 40%,rgba(0,0,0,.0) 55%,rgba(0,0,0,.75) 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:flex-end;
  padding-bottom:60px;
  opacity:0;pointer-events:none;transition:opacity .4s;
}
.overlay.show{opacity:1;pointer-events:all}

/* CTA button */
.cta-btn{
  background:linear-gradient(135deg,#ee4d2d,#ff7849);
  color:#fff;border:none;border-radius:50px;
  padding:16px 36px;font-size:17px;font-weight:800;
  cursor:pointer;letter-spacing:.02em;
  box-shadow:0 6px 28px rgba(238,77,45,.55);
  animation:pulse 2s infinite;
  display:flex;align-items:center;gap:10px;
  max-width:88vw;text-align:center;
}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}

.cta-sub{
  color:rgba(255,255,255,.75);font-size:12px;margin-top:10px;text-align:center;
}

/* Countdown ring */
.countdown-wrap{position:absolute;top:20px;right:16px;z-index:11;display:flex;align-items:center;gap:6px}
.countdown-ring{width:42px;height:42px}
.ring-bg{fill:none;stroke:rgba(255,255,255,.2);stroke-width:3}
.ring-progress{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;
  stroke-dasharray:113;stroke-dashoffset:113;transform:rotate(-90deg);transform-origin:50% 50%;
  transition:stroke-dashoffset .9s linear}
.countdown-num{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  font-size:14px;font-weight:800;color:#fff}

/* Back button */
.back-btn{
  position:absolute;top:16px;left:14px;z-index:11;
  background:rgba(0,0,0,.45);border:none;border-radius:50%;
  width:38px;height:38px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;color:#fff;font-size:18px;backdrop-filter:blur(4px);
  opacity:0;pointer-events:none;transition:opacity .3s;
}
.back-btn.show{opacity:1;pointer-events:all}

/* Pause indicator */
.pause-icon{
  position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  z-index:5;font-size:52px;opacity:0;pointer-events:none;transition:opacity .2s;
}
.pause-icon.show{opacity:1}
</style>
</head>
<body>
<div class="video-wrap" id="videoWrap">
  ${videoHtml}

  <!-- Countdown -->
  <div class="countdown-wrap" id="countdownWrap">
    <div style="position:relative;width:42px;height:42px">
      <svg class="countdown-ring" viewBox="0 0 42 42">
        <circle class="ring-bg" cx="21" cy="21" r="18"/>
        <circle class="ring-progress" id="ringProgress" cx="21" cy="21" r="18"/>
      </svg>
      <div class="countdown-num" id="countdownNum">5</div>
    </div>
  </div>

  <!-- Pause icon -->
  <div class="pause-icon" id="pauseIcon">⏸</div>

  <!-- Overlay CTA -->
  <div class="overlay" id="overlay">
    <button class="cta-btn" id="ctaBtn">
      <span>🛒</span>
      <span id="ctaText">${overlayText}</span>
    </button>
    <div class="cta-sub">Bấm để mở Shopee / TikTok · Video sẽ tiếp tục khi quay lại</div>
  </div>

  <!-- Back button (after overlay shown) -->
  <button class="back-btn" id="backBtn" onclick="resumeVideo()">✕</button>
</div>

<script>
(function(){
  var DEEPLINK  = ${JSON.stringify(deeplink)};
  var FALLBACK  = ${JSON.stringify(fallback)};
  var OVERLAY_DELAY = 5000; // ms
  var videoEl   = document.getElementById('videoEl');
  var overlay   = document.getElementById('overlay');
  var backBtn   = document.getElementById('backBtn');
  var ctaBtn    = document.getElementById('ctaBtn');
  var pauseIcon = document.getElementById('pauseIcon');
  var ringProg  = document.getElementById('ringProgress');
  var countNum  = document.getElementById('countdownNum');
  var countWrap = document.getElementById('countdownWrap');
  var overlayShown = false;
  var paused = false;

  // Countdown: 5 → 0 then show overlay
  var remaining = 5;
  var circumference = 113;

  function updateRing(secs) {
    var frac = secs / 5;
    ringProg.style.strokeDashoffset = circumference * (1 - frac);
    countNum.textContent = Math.ceil(secs);
  }

  var startTime = Date.now();
  var rafId;
  function tick() {
    var elapsed = (Date.now() - startTime) / 1000;
    var left = Math.max(0, 5 - elapsed);
    updateRing(left);
    if (left > 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      showOverlay();
    }
  }
  rafId = requestAnimationFrame(tick);

  function showOverlay() {
    if (overlayShown) return;
    overlayShown = true;
    // Pause video
    try {
      if (videoEl.tagName === 'VIDEO') { videoEl.pause(); paused = true; }
      else if (videoEl.tagName === 'IFRAME') {
        videoEl.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}','*');
        paused = true;
      }
    } catch(e){}
    overlay.classList.add('show');
    backBtn.classList.add('show');
    countWrap.style.display = 'none';
    pauseIcon.classList.add('show');
    setTimeout(function(){ pauseIcon.classList.remove('show'); }, 800);
  }

  function resumeVideo() {
    overlay.classList.remove('show');
    backBtn.classList.remove('show');
    try {
      if (videoEl.tagName === 'VIDEO') { videoEl.play(); paused = false; }
      else if (videoEl.tagName === 'IFRAME') {
        videoEl.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}','*');
        paused = false;
      }
    } catch(e){}
  }
  window.resumeVideo = resumeVideo;

  // CTA click → deeplink
  ctaBtn.addEventListener('click', function() {
    var ua = navigator.userAgent.toLowerCase();
    var isIos = /iphone|ipad|ipod/.test(ua);
    // Try app deeplink first
    window.location.href = DEEPLINK;
    setTimeout(function() {
      // If still here after 2s → open in browser
      window.location.href = FALLBACK;
    }, 2000);
  });

  // Handle visibility change (user returns from app)
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden && overlayShown && paused) {
      resumeVideo();
    }
  });
})();
</script>
</body>
</html>`;
}

// ─── MOBILE REDIRECT PAGE ─────────────────────────────────────────────────────

function buildRedirectPage(link, info, platform) {
  const { deeplink, fallback, platform_name, ios_store, play_store } = info;
  const colors    = { shopee:'#ee4d2d', tiktok:'#010101', generic:'#6366f1' };
  const labels    = { shopee:'Shopee',  tiktok:'TikTok',  generic:''        };
  const color     = colors[platform_name]||'#6366f1';
  const label     = labels[platform_name]||'';
  const storeUrl  = platform==='ios' ? (ios_store||fallback) : (play_store||fallback);
  const storeText = platform==='ios' ? 'Tải trên App Store' : 'Tải trên Google Play';
  const ogImg   = link.og_image ? `<img src="${esc(link.og_image)}" style="width:100%;border-radius:10px;margin-bottom:12px;max-height:180px;object-fit:cover" onerror="this.style.display='none'"/>` : '';
  const ogTitle = link.og_title ? `<p style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:4px;text-align:left">${esc(link.og_title)}</p>` : '';
  const ogDesc  = link.og_desc  ? `<p style="font-size:12px;color:#6b7280;margin-bottom:14px;text-align:left;line-height:1.5">${esc(link.og_desc)}</p>` : '';

  return `<!DOCTYPE html><html lang="vi"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>${esc(link.og_title||(label?'Mở '+label:'Đang mở...'))}</title>
<meta property="og:title" content="${esc(link.og_title||'')}"/>
<meta property="og:image" content="${esc(link.og_image||'')}"/>
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
</style></head><body>
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
    setTimeout(function(){document.getElementById('t').textContent='Không mở được?';
    document.getElementById('d').textContent='Xem trên trình duyệt hoặc tải ứng dụng.';},2500);}
  setTimeout(go,300);
  document.getElementById('btnApp').onclick=function(e){e.preventDefault();done=false;go();};
})();
</script></body></html>`;
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT||3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}  admin: ${ADMIN_EMAIL}`));
}
