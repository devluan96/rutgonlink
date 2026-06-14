try { require('dotenv').config({ path: require('path').join(__dirname,'..', '.env') }); } catch(_){}

const express      = require('express');
const path         = require('path');
const fs           = require('fs');
const { nanoid }   = require('nanoid');
const bcrypt       = require('bcryptjs');
const jwt          = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer       = require('multer');
const cloudinary   = require('cloudinary').v2;
const { init: initDb } = require('./db');

const app        = express();
const BASE_URL   = (process.env.BASE_URL||'').replace(/\/$/,'') ||
                   (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const JWT_SECRET  = process.env.JWT_SECRET  || 'rutgonlink-secret-2025';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@rutgonlink.com').toLowerCase();

// ── Cloudinary config ────────────────────────────────────────────────────────
const CLOUDINARY_OK = !!(process.env.CLOUDINARY_CLOUD_NAME &&
                         process.env.CLOUDINARY_API_KEY    &&
                         process.env.CLOUDINARY_API_SECRET);
if (CLOUDINARY_OK) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure:     true,
  });
  console.log('[cloudinary] configured ✅');
} else {
  console.warn('[cloudinary] NOT configured – using local disk fallback');
}

const PLANS = {
  free:     { dailyLimit: 10,  deeplink: false, ogMeta: false, upload: false, videoLink: false },
  pro:      { dailyLimit: 500, deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
  business: { dailyLimit: 0,   deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
  admin:    { dailyLimit: 0,   deeplink: true,  ogMeta: true,  upload: true,  videoLink: true  },
};

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Multer: memory storage (for Cloudinary upload) ───────────────────────────
// Falls back to disk if Cloudinary not configured
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch(_){}

// Use memoryStorage so we can pipe to Cloudinary on Vercel (no disk)
const memStorage = multer.memoryStorage();

const upload = multer({
  storage: CLOUDINARY_OK ? memStorage : multer.diskStorage({
    destination: (_,__,cb) => cb(null, uploadsDir),
    filename:    (_,file,cb) => cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for images
  fileFilter: (_,file,cb) => cb(null, /\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)),
});

const videoUploadMw = multer({
  storage: CLOUDINARY_OK ? memStorage : multer.diskStorage({
    destination: (_,__,cb) => cb(null, uploadsDir),
    filename:    (_,file,cb) => cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for video
  fileFilter: (_,file,cb) => cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

// ── Upload helper (Cloudinary or local disk) ─────────────────────────────────
async function uploadToCloudinary(fileBuffer, originalName, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const ext    = path.extname(originalName).toLowerCase();
    const folder = 'rutgonlink/' + (resourceType === 'video' ? 'videos' : 'images');
    const opts   = {
      folder,
      resource_type: resourceType,
      public_id:     nanoid(12),
      // For video: generate thumbnail automatically
      ...(resourceType === 'video' ? { eager: [{ format:'jpg', transformation:[{width:1200,height:630,crop:'fill'}] }] } : {}),
    };
    const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    const { Readable } = require('stream');
    const readable = new Readable();
    readable.push(fileBuffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

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
    const payload  = jwt.verify(token, JWT_SECRET);
    const database = await getDb();
    const user     = await database.getUserById(payload.id);
    if (!user) return null;
    // Admin email ALWAYS gets admin plan+role regardless of DB value
    if (user.email.toLowerCase() === ADMIN_EMAIL || user.role === 'admin') {
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
  if (!ua) return false;
  // Chỉ match bot/crawler thực sự – KHÔNG match FB iOS/Android app user
  // facebookexternalhit = FB crawler (bot), KHÔNG phải user
  if (/facebookexternalhit|facebot/i.test(ua)) return true;
  return /twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|vkshare|zalo|vibebot|line[\s/]|baiduspider|googlebot|applebot|bingbot|yandexbot|pinterestbot|snapchat|ia_archiver|AhrefsBot|SemrushBot|rogerbot/i.test(ua);
}

function detectPlatformDeep(originalUrl, platform) {
  // ── Shopee product URL: shopee.vn/...-i.<shopId>.<itemId> ─────────────────
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [,shopId,itemId] = sp;
    return {
      deeplink: platform==='ios' ? `shopee://i.${shopId}.${itemId}` : `shopee://product/${shopId}/${itemId}`,
      deeplink_ios: `shopee://i.${shopId}.${itemId}`,
      deeplink_android: `shopee://product/${shopId}/${itemId}`,
      platform_name:'shopee', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };
  }
  // ── Shopee generic: shopee.vn, s.shopee.vn, etc. ─────────────────────────
  if (/(?:^|\.)shopee\./i.test(originalUrl))
    return {
      deeplink:'shopee://home', deeplink_ios:'shopee://home', deeplink_android:'shopee://home',
      platform_name:'shopee', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/shopee-vn/id959841854',
      play_store:'https://play.google.com/store/apps/details?id=com.shopee.vn',
    };

  // ── TikTok: iOS dùng tiktok:// scheme, Android dùng snssdk1233:// ─────────
  if (/tiktok\.com/i.test(originalUrl)) {
    // Lấy path từ URL gốc để build deeplink
    let iosDeeplink   = originalUrl;
    let androidDeeplink = originalUrl;

    try {
      const u = new URL(originalUrl);
      const pathAndQuery = u.pathname + u.search;

      // TikTok iOS Universal Link scheme: tiktok://
      // iOS: tiktok:// scheme được Shopee/TikTok app đăng ký
      iosDeeplink = `tiktok:/${pathAndQuery}`;

      // Android: snssdk1233:// scheme
      androidDeeplink = `snssdk1233:/${pathAndQuery}`;
    } catch(_) {}

    return {
      deeplink: iosDeeplink,
      deeplink_ios: iosDeeplink,
      deeplink_android: androidDeeplink,
      // Universal Link fallback nếu scheme không work
      universal_link: originalUrl,
      platform_name:'tiktok', fallback:originalUrl,
      ios_store:'https://apps.apple.com/vn/app/tiktok/id1235601864',
      play_store:'https://play.google.com/store/apps/details?id=com.zhiliaoapp.musically',
    };
  }

  return { deeplink:null, deeplink_ios:null, deeplink_android:null, platform_name:'generic', fallback:originalUrl };
}

// ─── OG DEFAULT IMAGE ─────────────────────────────────────────────────────────
app.get('/og-default.png', (_,res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1e2535"/><stop offset="100%" style="stop-color:#0d1117"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <rect x="80" y="200" width="1040" height="8" rx="4" fill="#2a3347"/>
    <text x="600" y="280" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="#3b82f6" text-anchor="middle">🔗 RutGonLink</text>
    <text x="600" y="370" font-family="Arial,sans-serif" font-size="32" fill="#64748b" text-anchor="middle">Rút gọn link thông minh</text>
    <text x="600" y="430" font-family="Arial,sans-serif" font-size="24" fill="#334155" text-anchor="middle">Deeplink Shopee &amp; TikTok · Custom Preview</text>
  </svg>`;
  res.set('Content-Type','image/svg+xml');
  res.set('Cache-Control','public, max-age=86400');
  res.send(svg);
});

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

    // Auto-fix admin role/plan in DB on every login
    if (isAdmin && (user.role !== 'admin' || user.plan !== 'admin')) {
      await database.updateUserRole(user.id, 'admin');
      await database.updateUserPlan(user.id, 'admin');
      user.role = 'admin';
      user.plan = 'admin';
    }

    const token = jwt.sign({ id:user.id, email:user.email }, JWT_SECRET, { expiresIn:'30d' });
    res.cookie('token', token, { httpOnly:true, maxAge:30*24*3600*1000, sameSite:'lax' });
    res.json({ user:{ id:user.id, email:user.email, name:user.name,
                      plan: isAdmin ? 'admin' : user.plan,
                      role: isAdmin ? 'admin' : (user.role||'user') } });
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

  try {
    if (CLOUDINARY_OK && req.file.buffer) {
      // Upload to Cloudinary
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'image');
      return res.json({
        url:       result.secure_url,
        public_id: result.public_id,
        source:    'cloudinary',
      });
    } else {
      // Disk fallback (local dev without Cloudinary)
      return res.json({ url:`/uploads/${req.file.filename}`, source:'local' });
    }
  } catch(e) {
    console.error('[upload-image]', e.message);
    return res.status(500).json({ error:'Upload thất bại: ' + e.message });
  }
});

// ─── ADMIN INIT (fix admin user in DB) ───────────────────────────────────────
// Supports both GET and POST so admin can open in browser
async function handleAdminInit(req, res) {
  const user = await resolveUser(req);
  if (!user || user.email.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Không có quyền – cần đăng nhập bằng admin email trước' });
  }
  const database = await getDb();
  await database.updateUserRole(user.id, 'admin');
  await database.updateUserPlan(user.id, 'admin');
  res.json({ ok: true, message: `✅ User ${user.email} đã được set role=admin, plan=admin` });
}
app.get('/api/admin/init',  handleAdminInit);
app.post('/api/admin/init', handleAdminInit);

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

// ─── API: Edit Link ───────────────────────────────────────────────────────────

app.get('/api/links/:id', async (req,res) => {
  try {
    const database = await getDb();
    const user     = await resolveUser(req);
    const link     = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error:'Không tìm thấy link' });
    const isAdmin = user?.role==='admin' || user?.email?.toLowerCase()===ADMIN_EMAIL;
    if (!isAdmin && link.user_id && link.user_id !== user?.id)
      return res.status(403).json({ error:'Không có quyền' });
    res.json({ link:{ ...link, short_url:`${BASE_URL}/${link.alias||link.short_code}` } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.patch('/api/links/:id', async (req,res) => {
  try {
    const database = await getDb();
    const user     = await resolveUser(req);
    if (!user) return res.status(401).json({ error:'Chưa đăng nhập' });
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error:'Không tìm thấy link' });
    const isAdmin = user.role==='admin' || user.email?.toLowerCase()===ADMIN_EMAIL;
    if (!isAdmin && link.user_id !== user.id)
      return res.status(403).json({ error:'Không có quyền chỉnh sửa link này' });
    const { og_title, og_desc, og_image, link_type, video_url, video_overlay_text } = req.body;
    await database.updateLink(Number(req.params.id), {
      og_title, og_desc, og_image, link_type, video_url, video_overlay_text,
    });
    const updated = await database.getLinkById(Number(req.params.id));
    res.json({ link:{ ...updated, short_url:`${BASE_URL}/${updated.alias||updated.short_code}` } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// Extract YouTube thumbnail server-side; local video thumbnail via client canvas
app.post('/api/extract-thumb', requireAuth, async (req,res) => {
  const { video_url } = req.body;
  if (!video_url) return res.status(400).json({ error:'Thiếu video_url' });
  const ytMatch = video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    return res.json({ thumb:`https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`, source:'youtube' });
  }
  res.json({ thumb:null, source:'local' });
});

// ─── STATS ────────────────────────────────────────────────────────────────────

app.get('/api/stats', async (req,res) => {
  try {
    const database = await getDb();
    const user   = await resolveUser(req);
    const userId = user?.id || null;
    const totals  = await database.getTotals(userId);
    const today   = await database.getTodayStats(userId);
    const recent  = (await database.getRecentLinks(userId)).map(l => ({
      ...l, short_url:`${BASE_URL}/${l.alias||l.short_code}`,
    }));
    res.json({ ...totals, ...today, recent, plan: user?.plan||'guest' });
  } catch(e) { console.error(e); res.status(500).json({ error:e.message }); }
});

// ─── DELETE OWN LINK ─────────────────────────────────────────────────────────
app.delete('/api/links/:id', async (req,res) => {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error:'Chưa đăng nhập' });
  try {
    const database = await getDb();
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error:'Không tìm thấy link' });
    const isAdmin = user.role==='admin' || user.email?.toLowerCase()===ADMIN_EMAIL;
    if (!isAdmin && link.user_id !== user.id)
      return res.status(403).json({ error:'Không có quyền xóa link này' });
    await database.deleteLink(Number(req.params.id));
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── EDIT LINK ────────────────────────────────────────────────────────────────
app.get('/api/links/:id', async (req,res) => {
  try {
    const database = await getDb();
    const user = await resolveUser(req);
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error:'Không tìm thấy link' });
    const isAdmin = user?.role==='admin' || user?.email?.toLowerCase()===ADMIN_EMAIL;
    if (!isAdmin && link.user_id && link.user_id !== user?.id)
      return res.status(403).json({ error:'Không có quyền' });
    res.json({ link:{ ...link, short_url:`${BASE_URL}/${link.alias||link.short_code}` } });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.patch('/api/links/:id', async (req,res) => {
  try {
    const database = await getDb();
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error:'Chưa đăng nhập' });
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error:'Không tìm thấy link' });
    const isAdmin = user.role==='admin' || user.email?.toLowerCase()===ADMIN_EMAIL;
    if (!isAdmin && link.user_id !== user.id)
      return res.status(403).json({ error:'Không có quyền chỉnh sửa' });
    const { og_title, og_desc, og_image, link_type, video_url, video_overlay_text } = req.body;
    await database.updateLink(Number(req.params.id), {
      og_title, og_desc, og_image, link_type, video_url, video_overlay_text,
    });
    const updated = await database.getLinkById(Number(req.params.id));
    res.json({ link:{ ...updated, short_url:`${BASE_URL}/${updated.alias||updated.short_code}` } });
  } catch(e) { res.status(500).json({ error:e.message }); }
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

    // ── Social bot → OG page (NO redirect, return HTML with meta tags) ──────
    if (isSocialBot(ua)) {
      res.set({
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Content-Type': 'text/html; charset=utf-8',
      });
      return res.send(buildOgPage(link, BASE_URL));
    }

    // Count click
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket?.remoteAddress||'';
    await database.recordClick(link.id, ip, ua, req.headers['referer']||'');

    // ── Video link → show video page ──────────────────────────────────────
    const linkType = (link.link_type || 'direct').trim();
    if (linkType === 'video') {
      return res.send(buildVideoPage(link));
    }

    // ── Deeplink type: luôn mở app, kể cả desktop ─────────────────────────
    const platform = getMobilePlatform(ua);
    const info     = detectPlatformDeep(link.original_url, platform);

    if (linkType === 'deeplink') {
      // Luôn show redirect page (cả desktop), tự detect iOS/Android bằng JS
      if (info.deeplink) return res.send(buildRedirectPage(link, info, platform));
      // Không có deeplink → redirect thẳng
      return res.redirect(302, link.original_url);
    }

    // ── Direct: redirect thẳng (desktop), redirect page (mobile) ──────────
    if (platform === 'desktop' || !info.deeplink)
      return res.redirect(302, link.original_url);

    return res.send(buildRedirectPage(link, info, platform));
  } catch(e) {
    console.error(e);
    res.status(500).send('Server error');
  }
});

// ─── FACEBOOK APP LINKS META TAGS ────────────────────────────────────────────
// Facebook đọc các tag này để tự mở app khi user click link trong FB WebView
function buildAppLinkMeta(originalUrl) {
  const info = detectPlatformDeep(originalUrl, 'ios');
  if (!info.deeplink || info.platform_name === 'generic') return '';

  const tags = [
    `<meta property="al:web:url" content="${esc(originalUrl)}" />`,
    `<meta property="al:web:should_fallback" content="true" />`,
  ];

  if (info.platform_name === 'shopee') {
    tags.push(`<meta property="al:ios:url" content="${esc(info.deeplink_ios || info.deeplink)}" />`);
    tags.push(`<meta property="al:ios:app_store_id" content="959841854" />`);
    tags.push(`<meta property="al:ios:app_name" content="Shopee" />`);
    tags.push(`<meta property="al:android:url" content="${esc(info.deeplink_android || info.deeplink)}" />`);
    tags.push(`<meta property="al:android:package" content="com.shopee.vn" />`);
    tags.push(`<meta property="al:android:app_name" content="Shopee" />`);
  } else if (info.platform_name === 'tiktok') {
    // al:ios:url dùng tiktok:// scheme
    tags.push(`<meta property="al:ios:url" content="${esc(info.deeplink_ios || info.deeplink)}" />`);
    tags.push(`<meta property="al:ios:app_store_id" content="1235601864" />`);
    tags.push(`<meta property="al:ios:app_name" content="TikTok" />`);
    // al:android:url dùng snssdk1233:// scheme
    tags.push(`<meta property="al:android:url" content="${esc(info.deeplink_android || info.deeplink)}" />`);
    tags.push(`<meta property="al:android:package" content="com.zhiliaoapp.musically" />`);
    tags.push(`<meta property="al:android:app_name" content="TikTok" />`);
  }

  return tags.join('\n');
}

// ─── OG PAGE ──────────────────────────────────────────────────────────────────

function buildOgPage(link, baseUrl) {
  const shortUrl = `${baseUrl}/${link.alias||link.short_code}`;
  const title = esc(link.og_title || 'Link rút gọn – RutGonLink');
  const desc  = esc(link.og_desc  || 'Nhấn vào link để xem nội dung');
  const image = link.og_image ? esc(link.og_image) : `${baseUrl}/og-default.png`;
  const dest  = link.original_url;
  const appLinkMeta = buildAppLinkMeta(dest);

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<title>${title}</title>
<meta name="description" content="${desc}"/>

<!-- Open Graph -->
<meta property="og:type"         content="website"/>
<meta property="og:url"          content="${esc(shortUrl)}"/>
<meta property="og:title"        content="${title}"/>
<meta property="og:description"  content="${desc}"/>
<meta property="og:image"        content="${image}"/>
<meta property="og:image:width"  content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:image:type"   content="image/jpeg"/>
<meta property="og:site_name"    content="RutGonLink"/>

<!-- Twitter Card -->
<meta name="twitter:card"        content="summary_large_image"/>
<meta name="twitter:title"       content="${title}"/>
<meta name="twitter:description" content="${desc}"/>
<meta name="twitter:image"       content="${image}"/>

<!-- Facebook App Links: tự mở app khi click trong FB WebView -->
${appLinkMeta}
</head>
<body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
<div style="text-align:center">
  <p style="font-size:16px;margin-bottom:16px">${title}</p>
  <a href="${esc(dest)}" style="color:#3b82f6;font-size:14px">Nhấn để xem →</a>
</div>
<script>window.location.replace(${JSON.stringify(dest)});</script>
</body>
</html>`;
}

// ─── UPLOAD VIDEO ─────────────────────────────────────────────────────────────
// NOTE: On Vercel serverless, filesystem is ephemeral – use S3/Cloudinary for production
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => {
      const dir = require('path').join(__dirname,'..','public','uploads');
      try { if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir,{recursive:true}); } catch(_){}
      cb(null, dir);
    },
    filename: (_,file,cb) => cb(null, nanoid(12) + require('path').extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
  fileFilter: (_,file,cb) => cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

// ─── UPLOAD VIDEO ─────────────────────────────────────────────────────────────
app.post('/api/upload-video', requireAuth, videoUploadMw.single('video'), async (req,res) => {
  const user = await resolveUser(req);
  const plan = user?.plan || 'free';
  if (!PLANS[plan]?.videoLink) return res.status(403).json({ error:'Tính năng này yêu cầu gói Pro', upgrade:true });
  if (!req.file) return res.status(400).json({ error:'Không có file hoặc định dạng không hợp lệ (mp4, webm, mov)' });

  try {
    if (CLOUDINARY_OK && req.file.buffer) {
      // Upload video to Cloudinary, auto-generate thumbnail
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'video');
      // Cloudinary auto thumbnail URL
      const thumbUrl = result.eager?.[0]?.secure_url ||
        result.secure_url.replace('/upload/', '/upload/so_0,w_1200,h_630,c_fill,f_jpg/').replace(/\.[^.]+$/, '.jpg');
      return res.json({
        url:       result.secure_url,
        thumb:     thumbUrl,
        public_id: result.public_id,
        source:    'cloudinary',
        duration:  result.duration,
      });
    } else {
      return res.json({ url:`/uploads/${req.file.filename}`, thumb:null, source:'local' });
    }
  } catch(e) {
    console.error('[upload-video]', e.message);
    return res.status(500).json({ error:'Upload video thất bại: ' + e.message });
  }
});


function buildVideoPage(link) {
  const iosInfo     = detectPlatformDeep(link.original_url, 'ios');
  const androidInfo = detectPlatformDeep(link.original_url, 'android');
  const fallback    = link.original_url;
  const overlayText = esc(link.video_overlay_text || 'Bấm vào đây để ủng hộ và xem sản phẩm →');
  const ogTitle     = esc(link.og_title || 'Xem video');
  const ogImage     = esc(link.og_image || '');
  const videoUrl    = link.video_url || '';

  let videoHtml = '';
  const ytMatch = videoUrl.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  const ytEmbed = videoUrl.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytMatch || ytEmbed) {
    const vid = ytMatch ? ytMatch[1] : ytEmbed[1];
    videoHtml = `<iframe id="videoEl"
      src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&enablejsapi=1&rel=0&modestbranding=1&playsinline=1"
      frameborder="0" allow="autoplay;encrypted-media;gyroscope;fullscreen"
      style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`;
  } else if (videoUrl) {
    videoHtml = `<video id="videoEl" src="${esc(videoUrl)}"
      autoplay muted playsinline
      style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:#000"
      onloadedmetadata="fitVideo(this)"></video>`;
  } else {
    videoHtml = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:16px">Không có video</div>`;
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>${ogTitle}</title>
${ogImage ? `<meta property="og:image" content="${ogImage}"/>` : ''}
<meta property="og:title" content="${ogTitle}"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{width:100%;height:100%;background:#000;overflow:hidden;
  font-family:-apple-system,BlinkMacSystemFont,sans-serif}

/* Scene: full screen black bg */
.scene{position:relative;width:100vw;height:100dvh;
  background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}

/* Video box – sized to video's natural aspect ratio */
.vbox{position:relative;width:100%;height:100%}

/* Countdown – top right */
.cd-wrap{position:absolute;top:14px;right:14px;z-index:30;
  display:flex;align-items:center;justify-content:center}
.cd-svg{width:44px;height:44px}
.cd-bg{fill:none;stroke:rgba(255,255,255,.2);stroke-width:3}
.cd-prog{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;
  stroke-dasharray:120.6;stroke-dashoffset:0;
  transform:rotate(-90deg);transform-origin:50% 50%}
.cd-num{position:absolute;font-size:14px;font-weight:800;color:#fff;
  top:50%;left:50%;transform:translate(-50%,-50%)}

/* X button – top RIGHT, bấm cũng nhảy app */
.x-btn{position:absolute;top:14px;right:14px;z-index:40;
  width:36px;height:36px;border-radius:50%;
  background:rgba(0,0,0,.6);border:1.5px solid rgba(255,255,255,.3);
  color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;backdrop-filter:blur(6px);
  opacity:0;pointer-events:none;transition:opacity .25s}
.x-btn.show{opacity:1;pointer-events:all}

/* Overlay: full screen click target */
.overlay{position:absolute;inset:0;z-index:31;cursor:pointer;
  display:flex;align-items:flex-end;justify-content:center;
  padding-bottom:clamp(28px,7vh,70px);
  background:linear-gradient(to bottom,
    rgba(0,0,0,0) 0%,rgba(0,0,0,0) 40%,
    rgba(0,0,0,.5) 65%,rgba(0,0,0,.82) 100%);
  opacity:0;pointer-events:none;transition:opacity .3s}
.overlay.show{opacity:1;pointer-events:all}

/* CTA button – no icon duplication */
.cta-btn{background:linear-gradient(135deg,#ee4d2d,#ff6b35);
  color:#fff;border:none;border-radius:100px;
  padding:14px 28px;font-size:15px;font-weight:800;
  pointer-events:none;
  box-shadow:0 6px 28px rgba(238,77,45,.55);
  max-width:84vw;text-align:center;line-height:1.4;
  animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}

/* Pause flash */
.pf{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);
  z-index:29;font-size:52px;opacity:0;pointer-events:none;transition:opacity .15s}
.pf.show{opacity:1}
</style>
</head>
<body>
<div class="scene">
  <div class="vbox" id="vbox">
    ${videoHtml}
    <div class="pf" id="pf">⏸</div>

    <!-- Countdown top-right -->
    <div class="cd-wrap" id="cdWrap">
      <svg class="cd-svg" viewBox="0 0 42 42">
        <circle class="cd-bg" cx="21" cy="21" r="19.2"/>
        <circle class="cd-prog" cx="21" cy="21" r="19.2" id="cdProg"/>
      </svg>
      <span class="cd-num" id="cdNum">5</span>
    </div>

    <!-- Full-screen overlay: bấm bất kỳ đâu = nhảy app -->
    <div class="overlay" id="overlay" onclick="goApp()">
      <div class="cta-btn">${overlayText}</div>
    </div>

    <!-- X góc phải: bấm cũng nhảy app -->
    <div class="x-btn" id="xBtn" onclick="goApp()">✕</div>
  </div>
</div>
<script>
(function(){
  var DL_IOS     = ${JSON.stringify(iosInfo.deeplink || fallback)};
  var DL_ANDROID = ${JSON.stringify(androidInfo.deeplink || fallback)};
  var FALLBACK   = ${JSON.stringify(fallback)};
  var CIRC = 120.6, DELAY = 5000;

  var videoEl = document.getElementById('videoEl');
  var overlay = document.getElementById('overlay');
  var xBtn    = document.getElementById('xBtn');
  var cdWrap  = document.getElementById('cdWrap');
  var cdProg  = document.getElementById('cdProg');
  var cdNum   = document.getElementById('cdNum');
  var pf      = document.getElementById('pf');
  var shown   = false;

  var isIos     = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var isAndroid = /android/i.test(navigator.userAgent);

  /* Fit video to natural aspect ratio */
  window.fitVideo = function(v) {
    if (!v.videoWidth) return;
    var sw=window.innerWidth, sh=window.innerHeight;
    var scale = Math.min(sw/v.videoWidth, sh/v.videoHeight);
    var w = v.videoWidth*scale, h = v.videoHeight*scale;
    var box = document.getElementById('vbox');
    box.style.width = w+'px'; box.style.height = h+'px';
    v.style.width='100%'; v.style.height='100%';
  };
  window.addEventListener('resize', function(){
    if(videoEl && videoEl.tagName==='VIDEO') fitVideo(videoEl);
  });

  /* Countdown */
  var t0=Date.now();
  function tick(){
    var left=Math.max(0,DELAY-(Date.now()-t0));
    cdProg.style.strokeDashoffset=CIRC*(1-left/DELAY);
    cdNum.textContent=Math.ceil(left/1000);
    if(left>0) requestAnimationFrame(tick); else showOverlay();
  }
  requestAnimationFrame(tick);

  function showOverlay(){
    if(shown)return; shown=true;
    try{
      if(videoEl&&videoEl.tagName==='VIDEO') videoEl.pause();
      else if(videoEl&&videoEl.tagName==='IFRAME')
        videoEl.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}','*');
    }catch(_){}
    pf.classList.add('show');
    setTimeout(function(){pf.classList.remove('show');},600);
    cdWrap.style.display='none';
    xBtn.classList.add('show');
    overlay.classList.add('show');
  }

  function goApp(){
    if(isAndroid&&DL_ANDROID!==FALLBACK){
      var u=DL_ANDROID
        .replace('shopee://','intent://shopee#Intent;scheme=shopee;package=com.shopee.vn;end')
        .replace('snssdk1233://','intent://tiktok#Intent;scheme=snssdk1233;package=com.zhiliaoapp.musically;end');
      window.location.href=u;
      setTimeout(function(){window.location.href=FALLBACK;},1500);
    } else if(isIos&&DL_IOS!==FALLBACK){
      window.location.href=DL_IOS;
      setTimeout(function(){window.location.href=FALLBACK;},2000);
    } else {
      window.open(FALLBACK,'_blank');
    }
  }
  window.goApp=goApp;

  document.addEventListener('visibilitychange',function(){
    if(!document.hidden&&shown){
      try{
        if(videoEl&&videoEl.tagName==='VIDEO') videoEl.play();
        else if(videoEl&&videoEl.tagName==='IFRAME')
          videoEl.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}','*');
      }catch(_){}
    }
  });
})();
</script>
</body>
</html>`;
}

// ─── MOBILE REDIRECT PAGE ─────────────────────────────────────────────────────

function buildRedirectPage(link, info, platform) {
  const { deeplink_ios, deeplink_android, deeplink, fallback, platform_name, ios_store, play_store } = info;
  const colors = { shopee:'#ee4d2d', tiktok:'#010101', generic:'#6366f1' };
  const labels = { shopee:'Shopee',  tiktok:'TikTok',  generic:'' };
  const color  = colors[platform_name] || '#6366f1';
  const label  = labels[platform_name] || '';
  const ogImg   = link.og_image ? `<img src="${esc(link.og_image)}" style="width:100%;border-radius:10px;margin-bottom:12px;max-height:180px;object-fit:cover" onerror="this.style.display='none'"/>` : '';
  const ogTitle = link.og_title ? `<p style="font-size:14px;font-weight:700;color:#1f2937;margin-bottom:4px;text-align:left">${esc(link.og_title)}</p>` : '';
  const ogDesc  = link.og_desc  ? `<p style="font-size:12px;color:#6b7280;margin-bottom:14px;text-align:left;line-height:1.5">${esc(link.og_desc)}</p>` : '';

  const dlIos     = deeplink_ios     || deeplink || fallback;
  const dlAndroid = deeplink_android || deeplink || fallback;

  // Android Intent URI (bypass WebView, mở thẳng app không qua browser)
  let intentAndroid = dlAndroid;
  if (platform_name === 'shopee') {
    const spMatch = dlAndroid.match(/^shopee:\/\/product\/(\d+)\/(\d+)/);
    if (spMatch)
      intentAndroid = `intent://product/${spMatch[1]}/${spMatch[2]}#Intent;scheme=shopee;package=com.shopee.vn;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
    else
      intentAndroid = `intent://home#Intent;scheme=shopee;package=com.shopee.vn;S.browser_fallback_url=${encodeURIComponent(fallback)};end`;
  } else if (platform_name === 'tiktok') {
    // TikTok dùng Universal Link (https://www.tiktok.com/...) → Android App Links tự mở app
    // Không cần intent scheme, dùng thẳng URL https
    intentAndroid = dlAndroid; // đã là https://www.tiktok.com/...
  }

  const shortUrl = `${BASE_URL}/${link.alias||link.short_code}`;
  const appLinkMeta = buildAppLinkMeta(fallback);

  return `<!DOCTYPE html><html lang="vi"><head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"/>
<title>${esc(link.og_title||(label?'Mở '+label:'Đang mở...'))}</title>
<!-- Facebook App Links: FB WebView tự mở app không cần JS -->
${appLinkMeta}
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:linear-gradient(135deg,#f0f4ff,#faf0ff);
  display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
.card{background:#fff;border-radius:20px;padding:28px;max-width:380px;width:100%;
  text-align:center;box-shadow:0 12px 60px rgba(0,0,0,.12)}
.prog{width:56px;height:4px;background:#e5e7eb;border-radius:2px;margin:0 auto 18px;overflow:hidden}
.bar{height:100%;background:${color};border-radius:2px;animation:p 2s ease forwards}
@keyframes p{from{width:0}to{width:100%}}
h1{font-size:17px;font-weight:800;color:#111;margin-bottom:5px}
.sub{font-size:12px;color:#6b7280;margin-bottom:18px;line-height:1.5}
.btn{display:block;padding:13px 18px;border-radius:12px;font-size:14px;font-weight:700;
  text-decoration:none;margin-bottom:8px;transition:.15s;cursor:pointer}
.btn:active{transform:scale(.97)}
.btn-app{background:${color};color:#fff}
.btn-ext{background:#f59e0b;color:#fff}
.btn-web{background:#f3f4f6;color:#374151}
.btn-store{background:#111;color:#fff;font-size:13px}
.sep{font-size:11px;color:#9ca3af;margin:3px 0 8px}
/* Facebook WebView warning */
.fb-warn{background:#fff3cd;border:1px solid #ffc107;border-radius:10px;
  padding:12px 14px;margin-bottom:14px;font-size:12px;color:#856404;
  text-align:left;line-height:1.5;display:none}
.fb-warn.show{display:block}
.fb-warn strong{display:block;margin-bottom:3px;font-size:13px}
</style>
</head>
<body>
<div class="card">
  <div class="prog"><div class="bar"></div></div>
  ${ogImg}${ogTitle}${ogDesc}

  <!-- Cảnh báo Facebook WebView (hiện khi detect FB browser) -->
  <div class="fb-warn" id="fbWarn">
    <strong>⚠️ Đang mở trong trình duyệt Facebook</strong>
    Để mở ứng dụng, bấm <strong>"Mở bằng trình duyệt"</strong> rồi bấm lại link.
  </div>

  <h1 id="t">Đang mở${label?' '+label:''}...</h1>
  <p class="sub" id="d">Chờ một chút...</p>

  <!-- Nút mở external browser (chỉ hiện trong FB WebView) -->
  <a href="${esc(shortUrl)}" class="btn btn-ext" id="btnExt"
     style="display:none">🌐 Mở bằng trình duyệt Chrome/Safari</a>

  <a href="#" class="btn btn-app" id="btnApp">Mở trong ${label||'ứng dụng'}</a>
  <a href="${esc(fallback)}" class="btn btn-web">Xem trên trình duyệt</a>
  <div class="sep">Chưa cài ứng dụng?</div>
  <a href="#" class="btn btn-store" id="btnStore">Tải ứng dụng</a>
</div>

<script>
(function(){
  var DL_IOS      = ${JSON.stringify(dlIos)};
  var DL_ANDROID  = ${JSON.stringify(dlAndroid)};
  var INTENT_AND  = ${JSON.stringify(intentAndroid)};
  var FALLBACK    = ${JSON.stringify(fallback)};
  var SHORT_URL   = ${JSON.stringify(shortUrl)};
  var IOS_STORE   = ${JSON.stringify(ios_store||fallback)};
  var PLAY_STORE  = ${JSON.stringify(play_store||fallback)};

  var ua        = navigator.userAgent || '';
  var isIos     = /iphone|ipad|ipod/i.test(ua);
  var isAndroid = /android/i.test(ua);

  // iOS FB WebView cho phép custom scheme (tiktok://, shopee://)
  // Chỉ block Android WebView của một số app
  var isAndroidWebView = isAndroid && (
    /wv\b/i.test(ua) ||
    /Instagram|ZaloApp|Messenger|KAKAOTALK|MicroMessenger/i.test(ua)
  );
  var isBlockedWebView = isAndroidWebView;

  // Với TikTok iOS: thử tiktok:// scheme trước, nếu fail thì Universal Link
  var DL_IOS_SCHEME = DL_IOS; // tiktok:// hoặc shopee://
  var DL_IOS_UNIV   = ${JSON.stringify(info.universal_link || dlIos)};

  var dl    = isIos ? DL_IOS_SCHEME : (isAndroid ? INTENT_AND : DL_IOS_SCHEME);
  var store = isIos ? IOS_STORE : PLAY_STORE;

  document.getElementById('btnStore').href = store;
  document.getElementById('btnStore').textContent = isIos ? '⬇️ Tải trên App Store' : '⬇️ Tải trên Google Play';
  document.getElementById('btnApp').href = dl;

  if (isBlockedWebView) {
    document.getElementById('fbWarn').classList.add('show');
    document.getElementById('btnExt').style.display = 'block';
    document.getElementById('btnApp').href = INTENT_AND;
    document.getElementById('btnExt').onclick = function(e) {
      e.preventDefault();
      window.location.href = 'intent://' + SHORT_URL.replace(/^https?:\/\//, '')
        + '#Intent;scheme=https;action=android.intent.action.VIEW;'
        + 'category=android.intent.category.BROWSABLE;package=com.android.chrome;'
        + 'S.browser_fallback_url=' + encodeURIComponent(SHORT_URL) + ';end';
    };
  }

  var done = false;
  function go() {
    if (done) return; done = true;
    window.location.href = dl;
    // Nếu sau 2s vẫn ở trang này → có thể scheme không work → thử Universal Link
    setTimeout(function() {
      if (isIos && DL_IOS_UNIV && DL_IOS_UNIV !== dl) {
        window.location.href = DL_IOS_UNIV;
      }
      setTimeout(function() {
        document.getElementById('t').textContent = 'Không mở được ứng dụng?';
        document.getElementById('d').textContent = 'Bấm "Xem trên trình duyệt" hoặc tải ứng dụng.';
      }, 1000);
    }, 2000);
  }

  if (!isBlockedWebView) {
    setTimeout(go, 300);
  }

  document.getElementById('btnApp').addEventListener('click', function(e) {
    e.preventDefault(); done = false; go();
  });
})();
</script>
</body></html>`;
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT||3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}  admin: ${ADMIN_EMAIL}`));
}
