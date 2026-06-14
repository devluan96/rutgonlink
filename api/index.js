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

// ── FIX 1: Thêm /robots.txt để tránh 404 và ngăn bot crawl ──────────────────
app.get('/robots.txt', (_,res) => {
  res.set('Content-Type', 'text/plain');
  res.set('Cache-Control', 'public, max-age=86400');
  res.send('User-agent: *\nDisallow: /api/\nAllow: /\n');
});

// ── Multer ───────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
try { if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true }); } catch(_){}

const memStorage = multer.memoryStorage();

const upload = multer({
  storage: CLOUDINARY_OK ? memStorage : multer.diskStorage({
    destination: (_,__,cb) => cb(null, uploadsDir),
    filename:    (_,file,cb) => cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_,file,cb) => cb(null, /\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)),
});

const videoUploadMw = multer({
  storage: CLOUDINARY_OK ? memStorage : multer.diskStorage({
    destination: (_,__,cb) => cb(null, uploadsDir),
    filename:    (_,file,cb) => cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_,file,cb) => cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

async function uploadToCloudinary(fileBuffer, originalName, resourceType = 'image') {
  return new Promise((resolve, reject) => {
    const folder = 'rutgonlink/' + (resourceType === 'video' ? 'videos' : 'images');
    const opts   = {
      folder,
      resource_type: resourceType,
      public_id:     nanoid(12),
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

function esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function parseToken(req) {
  return req.cookies?.token || (req.headers.authorization||'').replace('Bearer ','') || null;
}

async function resolveUser(req) {
  const token = parseToken(req);
  if (!token) return null;
  try {
    const payload  = jwt.verify(token, JWT_SECRET);
    const database = await getDb();
    const user     = await database.getUserById(payload.id);
    if (!user) return null;
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
    next();
  } catch { return res.status(401).json({ error: 'Token không hợp lệ' }); }
}

function getMobilePlatform(ua='') {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return 'ios';
  if (/android/.test(u)) return 'android';
  return 'desktop';
}

// ── FIX 2: Nhận diện Facebook bot CHÍNH XÁC hơn, tách khỏi Facebook in-app browser ──
function isSocialBot(ua='') {
  if (!ua) return false;
  // Facebook crawler bot (KHÔNG phải user dùng FB app)
  if (/facebookexternalhit|facebot/i.test(ua)) return true;
  return /twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|vkshare|zalo|vibebot|line[\s/]|baiduspider|googlebot|applebot|bingbot|yandexbot|pinterestbot|snapchat|ia_archiver|AhrefsBot|SemrushBot|rogerbot/i.test(ua);
}

const TIKTOK_ANDROID_PACKAGE = 'com.ss.android.ugc.trill';
const TIKTOK_APP_STORE_ID    = '1235601864';
const SHOPEE_ANDROID_PACKAGE = 'com.shopee.vn';
const SHOPEE_APP_STORE_ID    = '959841449';
const FACEBOOK_APP_ID        = process.env.FACEBOOK_APP_ID || '1609970790226254';

function buildTikTokAppScheme(destinationUrl) {
  try {
    const url  = new URL(destinationUrl);
    const path = url.pathname;
    const videoMatch = path.match(/\/video\/(\d+)/);
    if (videoMatch) return `snssdk1233://aweme/detail/?aweme_id=${videoMatch[1]}`;
    const profileMatch = path.match(/\/@([\w.]+)/);
    if (profileMatch) return `snssdk1233://user/profile/?uniqueId=${profileMatch[1]}`;
    if (path.includes('/view/product/') || url.hostname.includes('shop')) {
      const productMatch = path.match(/\/view\/product\/(\d+)/);
      const productId    = productMatch?.[1] || '';
      const encodedUrl   = encodeURIComponent(destinationUrl);
      const chainKey     = url.searchParams.get('chain_key')     || '';
      const trackParams  = url.searchParams.get('trackParams')   || '';
      const encodeParams = url.searchParams.get('encode_params') || '';
      return `snssdk1180://ec/pdp` +
        `?biz_type=0&gd_label=share_from_pdp_auto&need_mall=1&needlaunchlog=1&page_name=reflow_pdp` +
        `&params_url=${encodedUrl}&refer=web&scene=pdp&use_land_page=1&is_commerce=1&_svg=1` +
        (productId    ? `&requestParams=${encodeURIComponent(JSON.stringify({product_id:[productId]}))}` : '') +
        (chainKey     ? `&chain_key=${encodeURIComponent(chainKey)}`       : '') +
        (trackParams  ? `&trackParams=${encodeURIComponent(trackParams)}`   : '') +
        (encodeParams ? `&encode_params=${encodeURIComponent(encodeParams)}`: '');
    }
    return destinationUrl;
  } catch { return destinationUrl; }
}

function detectPlatformDeep(originalUrl, platform) {
   // ── Shopee product: -i.<shopId>.<itemId>
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [, shopId, itemId] = sp;
    // Universal Link – OS tự mở app, không cần JS trick
    const universalLink = `https://shopee.vn/universal-link/product/${shopId}/${itemId}`;
    return {
      deeplink:         universalLink,   // dùng Universal Link thay custom scheme
      deeplink_ios:     universalLink,
      deeplink_android: universalLink,
      platform_name: 'shopee', fallback: originalUrl,
      ios_store:  `https://apps.apple.com/vn/app/shopee-vn/id${SHOPEE_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${SHOPEE_ANDROID_PACKAGE}`,
    };
  }

  // ── Shopee generic (shop page, search, v.v.)
  if (/(?:^|\.)shopee\./i.test(originalUrl)) {
    // Redirect thẳng về original – Shopee đã cấu hình App Links
    // Browser/OS sẽ tự mở app nếu đã cài
    return {
      deeplink:         originalUrl,  // <-- redirect thẳng, không cần trick
      deeplink_ios:     originalUrl,
      deeplink_android: originalUrl,
      platform_name: 'shopee', fallback: originalUrl,
      ios_store:  `https://apps.apple.com/vn/app/shopee-vn/id${SHOPEE_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${SHOPEE_ANDROID_PACKAGE}`,
    };
  }
  if (/tiktok\.com/i.test(originalUrl)) {
    const scheme = buildTikTokAppScheme(originalUrl);
    return {
      deeplink:         scheme,
      deeplink_ios:     scheme,
      deeplink_android: scheme,
      universal_link:   originalUrl,
      platform_name:   'tiktok', fallback:originalUrl,
      ios_store:`https://apps.apple.com/vn/app/tiktok/id${TIKTOK_APP_STORE_ID}`,
      play_store:`https://play.google.com/store/apps/details?id=${TIKTOK_ANDROID_PACKAGE}`,
    };
  }
  return { deeplink:null, deeplink_ios:null, deeplink_android:null, platform_name:'generic', fallback:originalUrl };
}


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

app.post('/api/upload-image', requireAuth, upload.single('image'), async (req,res) => {
  const user = await resolveUser(req);
  const plan = user?.plan || 'free';
  if (!PLANS[plan]?.upload) return res.status(403).json({ error:'Tính năng này yêu cầu gói Pro', upgrade:true });
  if (!req.file) return res.status(400).json({ error:'Không có file hoặc định dạng không hợp lệ' });
  try {
    if (CLOUDINARY_OK && req.file.buffer) {
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'image');
      return res.json({ url: result.secure_url, public_id: result.public_id, source: 'cloudinary' });
    } else {
      return res.json({ url:`/uploads/${req.file.filename}`, source:'local' });
    }
  } catch(e) {
    console.error('[upload-image]', e.message);
    return res.status(500).json({ error:'Upload thất bại: ' + e.message });
  }
});

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

async function checkAdmin(req, res) {
  const user = await resolveUser(req);
  if (!user || (user.role !== 'admin' && user.email.toLowerCase() !== ADMIN_EMAIL)) {
    res.status(403).json({ error:'Không có quyền truy cập' });
    return null;
  }
  if (user.email.toLowerCase() === ADMIN_EMAIL && user.role !== 'admin') {
    const database = await getDb();
    await database.updateUserRole(user.id, 'admin');
    await database.updateUserPlan(user.id, 'admin');
  }
  return user;
}

app.get('/api/admin/users', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const users = await database.getAllUsers();
    res.json({ users });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

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

app.delete('/api/admin/users/:id', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const uid = Number(req.params.id);
    await database.deleteUser(uid);
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

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

app.delete('/api/admin/links/:id', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    await database.deleteLink(Number(req.params.id));
    res.json({ ok:true });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get('/api/admin/stats', requireAdmin, async (req,res) => {
  if (!await checkAdmin(req,res)) return;
  try {
    const database = await getDb();
    const totals = await database.getAdminTotals();
    res.json(totals);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

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

    if (planCfg.dailyLimit > 0) {
      const todayCount = await database.countTodayLinks(userId);
      if (todayCount >= planCfg.dailyLimit)
        return res.status(403).json({ error:`Đã đạt giới hạn ${planCfg.dailyLimit} link/ngày. Vui lòng nâng cấp.`, upgrade:true });
    }

    if (!planCfg.deeplink && /shopee\.vn|tiktok\.com/i.test(url))
      return res.status(403).json({ error:'Deeplink Shopee & TikTok yêu cầu gói Pro trở lên', upgrade:true });

    link_type = link_type || 'direct';
    if (link_type === 'video' && !planCfg.videoLink)
      return res.status(403).json({ error:'Link Video yêu cầu gói Pro trở lên', upgrade:true });

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

app.post('/api/extract-thumb', requireAuth, async (req,res) => {
  const { video_url } = req.body;
  if (!video_url) return res.status(400).json({ error:'Thiếu video_url' });
  const ytMatch = video_url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) {
    return res.json({ thumb:`https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`, source:'youtube' });
  }
  res.json({ thumb:null, source:'local' });
});

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

// ─── REDIRECT ─────────────────────────────────────────────────────────────────

app.get('/:code', async (req,res) => {
  const { code } = req.params;
  if (code.includes('.') || /^(api|uploads|admin)/.test(code)) return res.status(404).send('Not found');

  try {
    const database = await getDb();
    const link = await database.getLinkByAlias(code) || await database.getLinkByCode(code);
    if (!link) return res.status(404).sendFile(path.join(__dirname,'..','public','404.html'));

    const ua = req.headers['user-agent'] || '';
    const platform = getMobilePlatform(ua);

    // ── FIX 3: Social bot → trả OG page KHÔNG redirect, KHÔNG count click ──
    if (isSocialBot(ua)) {
      res.set({
        'Cache-Control': 'no-cache,no-store,must-revalidate',
        'Pragma': 'no-cache',
        'Content-Type': 'text/html;charset=utf-8',
        // Quan trọng: cho phép Facebook đọc App Links meta
        'X-Frame-Options': 'SAMEORIGIN',
      });
      return res.send(buildOgPage(link, BASE_URL));
      // NOTE: Không recordClick ở đây → tránh đếm lượt click ảo từ bot
    }

    // Count click (chỉ user thật)
    const ip = (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.socket?.remoteAddress||'';
    await database.recordClick(link.id, ip, ua, req.headers['referer']||'');

    // ── Video link ──────────────────────────────────────────────────────────
    const linkType = (link.link_type || 'direct').trim();
    if (linkType === 'video') return res.send(buildVideoPage(link));

    const info = detectPlatformDeep(link.original_url, platform);

    // ── Desktop → redirect thẳng ─────────────────────────────────────────
    if (platform === 'desktop') return res.redirect(302, link.original_url);

    // ── Mobile có deeplink → DirectBridgePage ────────────────────────────
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

app.get('/_og/:code', async (req, res) => {
  try {
    const database = await getDb();
    const { code } = req.params;
    const link = await database.getLinkByAlias(code) || await database.getLinkByCode(code);
    if (!link) return res.status(404).send('Not found');
    res.set({ 'Cache-Control':'no-cache,no-store,must-revalidate', 'Pragma':'no-cache', 'Content-Type':'text/html;charset=utf-8' });
    return res.send(buildOgPage(link, BASE_URL));
  } catch(e) { res.status(500).send('Server error'); }
});

function buildAppLinkMetaTags(canonicalUrl, webFallbackUrl, appLinkOverrideUrl, options) {
  const webUrl     = webFallbackUrl || canonicalUrl;
  const fallbackApp = appLinkOverrideUrl || webFallbackUrl || '';
  const androidUrl = options?.androidUrl || fallbackApp;
  const iosUrl     = options?.iosUrl     || fallbackApp;
  const hasAndroid = Boolean(androidUrl);
  const hasIos     = Boolean(iosUrl);

  const tags = [
    `<meta property="al:web:url" content="${esc(webUrl)}" />`,
    `<meta property="al:web:should_fallback" content="true" />`,
  ];

  if (hasAndroid || hasIos) {
    if (hasAndroid) {
      tags.push(`<meta property="al:android:url" content="${esc(androidUrl)}" />`);
      if (options?.androidPackage)
        tags.push(`<meta property="al:android:package" content="${esc(options.androidPackage)}" />`);
      if (options?.androidAppName)
        tags.push(`<meta property="al:android:app_name" content="${esc(options.androidAppName)}" />`);
    }
    if (hasIos) {
      tags.push(`<meta property="al:ios:url" content="${esc(iosUrl)}" />`);
      if (options?.iosAppName)
        tags.push(`<meta property="al:ios:app_name" content="${esc(options.iosAppName)}" />`);
      if (options?.iosAppStoreId)
        tags.push(`<meta property="al:ios:app_store_id" content="${esc(options.iosAppStoreId)}" />`);
    }
  }
  return tags.join('\n');
}

// ─── DIRECT BRIDGE PAGE ───────────────────────────────────────────────────────
// FIX 4: Cải thiện logic để nhảy app ngay, giảm delay, dùng sessionStorage đúng
function buildDirectBridgePage(link, canonicalUrl, info) {
  const title   = link.og_title?.trim() || 'RutGonLink';
  const desc    = link.og_desc?.trim()  || 'Đang mở ứng dụng gốc để tiếp tục xem nội dung.';
  const image   = link.og_image || '';
  const dest    = link.original_url;

  const appScheme  = info.deeplink || dest;
  const iosScheme  = info.deeplink_ios  || appScheme;
  const andScheme  = info.deeplink_android || appScheme;
  const platform   = info.platform_name;

  // Shopee dùng Universal Link → không cần khai báo al:android/ios:url riêng
// vì al:web:url đã đủ để OS intercept và mở app
const appMeta = platform === 'tiktok' ? {
  androidUrl: andScheme, androidPackage: TIKTOK_ANDROID_PACKAGE, androidAppName: 'TikTok',
  iosUrl: iosScheme, iosAppName: 'TikTok', iosAppStoreId: TIKTOK_APP_STORE_ID,
} : platform === 'shopee' ? {
  // Universal Link: dùng chung 1 URL cho cả iOS lẫn Android
  androidUrl:      andScheme,
  androidPackage:  SHOPEE_ANDROID_PACKAGE,
  androidAppName:  'Shopee',
  iosUrl:          iosScheme,
  iosAppName:      'Shopee',
  iosAppStoreId:   SHOPEE_APP_STORE_ID,
} : undefined;

const appLinkMeta = buildAppLinkMetaTags(canonicalUrl, dest, appScheme, appMeta);
// Shopee Universal Link → không cần intent:// trick nên androidPkg để trống
const androidPkg  = platform === 'tiktok' ? TIKTOK_ANDROID_PACKAGE : '';

const escJs = s => (s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/'/g,"\\'").replace(/\n/g,'\\n').replace(/\r/g,'\\r');

const ogImageTag = image ? `<meta property="og:image" content="${esc(image)}" />` : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<meta name="robots" content="noindex, nofollow" />
<link rel="canonical" href="${esc(canonicalUrl)}" />
<meta property="fb:app_id" content="${FACEBOOK_APP_ID}" />
${appLinkMeta}
<meta property="og:locale" content="vi_VN" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${esc(canonicalUrl)}" />
<meta property="og:site_name" content="RutGonLink" />
${ogImageTag}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
${ogImageTag}
</head>
<body>
<script>
(function() {
  var appUrl      = "${escJs(appScheme)}";
  var iosUrl      = "${escJs(iosScheme)}";
  var androidUrl  = "${escJs(andScheme)}";
  var webUrl      = "${escJs(dest)}";
  var canonical   = "${escJs(canonicalUrl)}";
  var androidPkg  = "${escJs(androidPkg)}";
  var platform    = "${escJs(platform)}";

  var ua         = navigator.userAgent || '';
  var isIOS      = /iphone|ipad|ipod/i.test(ua);
  var isAndroid  = /android/i.test(ua);
  // FIX: Nhận diện chính xác Facebook in-app browser
  var isFacebook = /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
  var isZalo     = /ZaloApp/i.test(ua);
  var isInApp    = isFacebook || isZalo;

  // FIX: Dùng localStorage thay sessionStorage để persist qua redirect
  // sessionStorage bị xóa khi FB mở tab mới → loop vô tận
  var flagKey    = 'rgl_v2_redirected_' + location.pathname;
  var escapedKey = 'rgl_v2_escaped_'    + location.pathname;

  function setFlag(key) {
    try { localStorage.setItem(key, Date.now().toString()); } catch(_) {}
  }
  function hasFlag(key) {
    try {
      var val = localStorage.getItem(key);
      if (!val) return false;
      // Flag hết hạn sau 30 giây (tránh kẹt khi user thật click lại)
      return (Date.now() - parseInt(val, 10)) < 30000;
    } catch(_) { return false; }
  }
  function clearFlag(key) {
    try { localStorage.removeItem(key); } catch(_) {}
  }

  // ── Shopee Universal Link: redirect thẳng, OS tự mở app ──────────────────
  // Không cần intent://, không cần trick gì cả
  if (platform === 'shopee') {
    window.location.href = appUrl;  // appUrl = Universal Link
    setTimeout(function() {
      if (!document.hidden) window.location.replace(webUrl);
    }, 2500);
    return;
  }

  // ── Android trong FB/Zalo in-app browser ────────────────────────────────
  if (isInApp && isAndroid) {
    if (hasFlag(escapedKey)) {
      // Đã escape ra Chrome rồi nhưng vẫn quay lại đây → fallback web
      clearFlag(escapedKey);
      window.location.replace(webUrl);
      return;
    }
    setFlag(escapedKey);

    if (platform === 'tiktok') {
      var intentUrl = 'intent://' +
        webUrl.replace(/^https?:\/\//, '') +
        '#Intent;scheme=https;package=' + (androidPkg || 'com.ss.android.ugc.trill') +
        ';S.browser_fallback_url=' + encodeURIComponent(webUrl) + ';end';
      window.location.href = intentUrl;
      setTimeout(function() { if (!document.hidden) window.location.replace(webUrl); }, 2000);
      return;
    }

    // Shopee: escape ra Chrome, Chrome sẽ xử lý custom scheme
    var intentEscape = 'intent://' +
      canonical.replace(/^https?:\/\//, '') +
      '#Intent;scheme=https;package=com.android.chrome' +
      ';S.browser_fallback_url=' + encodeURIComponent(canonical) + ';end';
    window.location.href = intentEscape;
    setTimeout(function() { if (!document.hidden) window.location.replace(canonical); }, 1500);
    return;
  }

  // ── iOS trong FB/Zalo in-app browser ────────────────────────────────────
  if (isInApp && isIOS) {
    if (hasFlag(escapedKey)) {
      clearFlag(escapedKey);
      window.location.replace(webUrl);
      return;
    }
    setFlag(escapedKey);

    var target = (platform === 'tiktok') ? webUrl : canonical;
    var a = document.createElement('a');
    a.href = target;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function() { window.location.replace(webUrl); }, 1500);
    return;
  }

  // ── Tránh loop cho browser bình thường ──────────────────────────────────
  if (hasFlag(flagKey)) return;
  setFlag(flagKey);

  // ── iOS bình thường (Safari, Chrome iOS) ────────────────────────────────
  if (isIOS) {
    if (appUrl && appUrl !== webUrl) {
      window.location.href = iosUrl;
      // FIX: Giảm timeout xuống 1500ms → cảm giác nhanh hơn
      setTimeout(function() {
        if (!document.hidden) window.location.replace(webUrl);
      }, 1500);
    } else {
      window.location.replace(webUrl);
    }
    return;
  }

  // ── Android bình thường ─────────────────────────────────────────────────
  if (isAndroid) {
    if (androidUrl && androidUrl !== webUrl) {
      var didLeave = false;
      window.addEventListener('blur', function() { didLeave = true; }, { once: true });
      // FIX: Giảm timeout → nếu app mở được thì page đã blur rồi
      setTimeout(function() {
        if (!didLeave && !document.hidden) window.location.replace(webUrl);
      }, 1500);
      window.location.href = androidUrl;
    } else {
      window.location.replace(webUrl);
    }
    return;
  }

  // ── Desktop fallback ────────────────────────────────────────────────────
  window.location.replace(webUrl);
})();
</script>
</body>
</html>`;
}

// ─── OG PAGE (cho bot crawler) ───────────────────────────────────────────────
function buildOgPage(link, baseUrl) {
  const shortUrl = `${baseUrl}/${link.alias||link.short_code}`;
  const title = esc(link.og_title || 'RutGonLink');
  const desc  = esc(link.og_desc  || 'Nhấn vào link để xem nội dung');
  const image = link.og_image ? esc(link.og_image) : `${baseUrl}/og-default.png`;
  const dest  = link.original_url;
  const info  = detectPlatformDeep(dest, 'ios');
  const appMeta = info.platform_name !== 'generic' ? buildAppLinkMetaTags(shortUrl, dest, info.deeplink_ios,
    info.platform_name === 'tiktok'
      ? { androidUrl:info.deeplink_android, androidPackage:TIKTOK_ANDROID_PACKAGE, androidAppName:'TikTok', iosUrl:info.deeplink_ios, iosAppName:'TikTok', iosAppStoreId:TIKTOK_APP_STORE_ID }
      : { androidUrl:info.deeplink_android, androidPackage:SHOPEE_ANDROID_PACKAGE, androidAppName:'Shopee', iosUrl:info.deeplink_ios, iosAppName:'Shopee', iosAppStoreId:SHOPEE_APP_STORE_ID }
  ) : '';

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta property="fb:app_id" content="${FACEBOOK_APP_ID}" />
${appMeta}
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta property="og:type"         content="website" />
<meta property="og:url"          content="${esc(shortUrl)}" />
<meta property="og:title"        content="${title}" />
<meta property="og:description"  content="${desc}" />
<meta property="og:image"        content="${image}" />
<meta property="og:image:width"  content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name"    content="RutGonLink" />
<meta name="twitter:card"        content="summary_large_image" />
<meta name="twitter:title"       content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image"       content="${image}" />
</head>
<body>
<script>window.location.href = ${JSON.stringify(dest)};</script>
</body>
</html>`;
}

// ─── VIDEO UPLOAD ─────────────────────────────────────────────────────────────
const videoUpload = multer({
  storage: multer.diskStorage({
    destination: (_,__,cb) => {
      const dir = require('path').join(__dirname,'..','public','uploads');
      try { if (!require('fs').existsSync(dir)) require('fs').mkdirSync(dir,{recursive:true}); } catch(_){}
      cb(null, dir);
    },
    filename: (_,file,cb) => cb(null, nanoid(12) + require('path').extname(file.originalname).toLowerCase()),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_,file,cb) => cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

app.post('/api/upload-video', requireAuth, videoUploadMw.single('video'), async (req,res) => {
  const user = await resolveUser(req);
  const plan = user?.plan || 'free';
  if (!PLANS[plan]?.videoLink) return res.status(403).json({ error:'Tính năng này yêu cầu gói Pro', upgrade:true });
  if (!req.file) return res.status(400).json({ error:'Không có file hoặc định dạng không hợp lệ (mp4, webm, mov)' });

  try {
    if (CLOUDINARY_OK && req.file.buffer) {
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname, 'video');
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
html,body{width:100%;height:100%;background:#000;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,sans-serif}
.scene{position:relative;width:100vw;height:100dvh;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden}
.vbox{position:relative;width:100%;height:100%}
.cd-wrap{position:absolute;top:14px;right:14px;z-index:30;display:flex;align-items:center;justify-content:center}
.cd-svg{width:44px;height:44px}
.cd-bg{fill:none;stroke:rgba(255,255,255,.2);stroke-width:3}
.cd-prog{fill:none;stroke:#fff;stroke-width:3;stroke-linecap:round;stroke-dasharray:120.6;stroke-dashoffset:0;transform:rotate(-90deg);transform-origin:50% 50%}
.cd-num{position:absolute;font-size:14px;font-weight:800;color:#fff;top:50%;left:50%;transform:translate(-50%,-50%)}
.x-btn{position:absolute;top:14px;right:14px;z-index:40;width:36px;height:36px;border-radius:50%;background:rgba(0,0,0,.6);border:1.5px solid rgba(255,255,255,.3);color:#fff;font-size:15px;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);opacity:0;pointer-events:none;transition:opacity .25s}
.x-btn.show{opacity:1;pointer-events:all}
.overlay{position:absolute;inset:0;z-index:31;cursor:pointer;display:flex;align-items:flex-end;justify-content:center;padding-bottom:clamp(28px,7vh,70px);background:linear-gradient(to bottom,rgba(0,0,0,0) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,.5) 65%,rgba(0,0,0,.82) 100%);opacity:0;pointer-events:none;transition:opacity .3s}
.overlay.show{opacity:1;pointer-events:all}
.cta-btn{background:linear-gradient(135deg,#ee4d2d,#ff6b35);color:#fff;border:none;border-radius:100px;padding:14px 28px;font-size:15px;font-weight:800;pointer-events:none;box-shadow:0 6px 28px rgba(238,77,45,.55);max-width:84vw;text-align:center;line-height:1.4;animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}
.pf{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:29;font-size:52px;opacity:0;pointer-events:none;transition:opacity .15s}
.pf.show{opacity:1}
</style>
</head>
<body>
<div class="scene">
  <div class="vbox" id="vbox">
    ${videoHtml}
    <div class="pf" id="pf">⏸</div>
    <div class="cd-wrap" id="cdWrap">
      <svg class="cd-svg" viewBox="0 0 42 42">
        <circle class="cd-bg" cx="21" cy="21" r="19.2"/>
        <circle class="cd-prog" cx="21" cy="21" r="19.2" id="cdProg"/>
      </svg>
      <span class="cd-num" id="cdNum">5</span>
    </div>
    <div class="overlay" id="overlay" onclick="goApp()">
      <div class="cta-btn">${overlayText}</div>
    </div>
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

module.exports = app;
if (require.main === module) {
  const PORT = process.env.PORT||3000;
  app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}  admin: ${ADMIN_EMAIL}`));
}
