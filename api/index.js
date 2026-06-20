try {
  require("dotenv").config({
    path: require("path").join(__dirname, "..", ".env"),
  });
} catch (_) {}

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { nanoid } = require("nanoid");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { init: initDb } = require("./db");
const { isAffiliateShortenUrl } = require("../affiliate");

const app = express();
const BASE_URL =
  (process.env.BASE_URL || "").replace(/\/$/, "") ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");
const MIDDLE_DOMAIN = (process.env.MIDDLE_DOMAIN || "").replace(/\/$/, "");
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production"
    ? null
    : crypto.randomBytes(32).toString("hex"));
const TWO_FACTOR_ENCRYPTION_SECRET =
  process.env.TWO_FACTOR_ENCRYPTION_SECRET || JWT_SECRET;
const TWO_FACTOR_ISSUER = (process.env.TWO_FACTOR_ISSUER || "BocLink").trim() || "BocLink";
const TWO_FACTOR_PERIOD_SECONDS = 30;
const TWO_FACTOR_DIGITS = 6;
const TWO_FACTOR_WINDOW_STEPS = 1;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production");
}
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
  ? process.env.ADMIN_EMAIL.toLowerCase()
  : null;
const GOOGLE_CLIENT_ID = (process.env.GOOGLE_CLIENT_ID || "").trim();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const GUEST_SESSION_COOKIE = "guest_session";
const GUEST_SESSION_MAX_AGE = 30 * 24 * 3600 * 1000;
const REDIRECT_LOG_DIR = path.join(__dirname, "..", "logs");
const REDIRECT_LOG_FILE = path.join(REDIRECT_LOG_DIR, "redirect.log");
const ANALYTICS_TIME_ZONE = (process.env.APP_TIME_ZONE || "Asia/Ho_Chi_Minh").trim();
const regionNamesVi =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["vi"], { type: "region" })
    : null;
const regionNamesEn =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
let redirectLogDirReady = null;
let redirectLogWriteQueue = Promise.resolve();

// ── Cloudinary config ────────────────────────────────────────────────────────
const CLOUDINARY_OK = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
if (CLOUDINARY_OK) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log("[cloudinary] configured ✅");
} else {
  console.warn("[cloudinary] NOT configured – using local disk fallback");
}

const PLANS = {
  free: {
    dailyLimit: 10,
    deeplink: false,
    ogMeta: false,
    upload: false,
    videoLink: false,
  },
  pro: {
    dailyLimit: 500,
    deeplink: true,
    ogMeta: true,
    upload: true,
    videoLink: true,
  },
  business: {
    dailyLimit: 0,
    deeplink: true,
    ogMeta: true,
    upload: true,
    videoLink: true,
  },
  admin: {
    dailyLimit: 0,
    deeplink: true,
    ogMeta: true,
    upload: true,
    videoLink: true,
  },
};
const BILLING_PLANS = {
  pro: { code: "pro", label: "Pro", amount: 99000 },
  business: { code: "business", label: "Business", amount: 299000 },
};
function readEnvValue(...names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}
const PAYMENT_BANK_ID = readEnvValue("PAYMENT_BANK_ID", "VITE_PAYMENT_BANK_ID");
const PAYMENT_BANK_NAME = readEnvValue("PAYMENT_BANK_NAME", "VITE_PAYMENT_BANK_NAME");
const PAYMENT_BANK_ACCOUNT = readEnvValue(
  "PAYMENT_BANK_ACCOUNT",
  "PAYMENT_ACCOUNT_NO",
  "VITE_PAYMENT_ACCOUNT_NO",
);
const PAYMENT_ACCOUNT_HOLDER = readEnvValue(
  "PAYMENT_ACCOUNT_HOLDER",
  "PAYMENT_ACCOUNT_NAME",
  "VITE_PAYMENT_ACCOUNT_NAME",
);
const PAYMENT_QR_IMAGE_URL = readEnvValue("PAYMENT_QR_IMAGE_URL", "VITE_PAYMENT_QR_IMAGE_URL");
const PAYMENT_CONTACT = (process.env.PAYMENT_CONTACT || "Zalo 0969.361.607").trim();

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));
app.use(cookieParser());
app.use((req, res, next) => {
  const incomingRequestId = String(req.headers["x-request-id"] || "").trim();
  req.requestId = incomingRequestId || nanoid(12);
  res.setHeader("X-Request-Id", req.requestId);
  next();
});
app.use((req, res, next) => {
  if (req.cookies?.token) return next();

  const guestSessionId = req.cookies?.[GUEST_SESSION_COOKIE];
  if (guestSessionId) {
    req.guestSessionId = guestSessionId;
    return next();
  }

  req.guestSessionId = nanoid(24);
  res.cookie(GUEST_SESSION_COOKIE, req.guestSessionId, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: GUEST_SESSION_MAX_AGE,
    path: "/",
  });
  next();
});

function serveLanding(_req, res) {
  res.sendFile(path.join(__dirname, "..", "public", "landing.html"));
}

function serveAppShell(_req, res) {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
}

function redirectToCanonical(pathname) {
  return (req, res) => {
    const queryIndex = req.originalUrl.indexOf("?");
    const search = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : "";
    res.redirect(302, `${pathname}${search}`);
  };
}

const appShellRoutes = [
  "/dashboard",
  "/dashboard/",
  "/links",
  "/links/",
  "/create",
  "/create/",
  "/qr",
  "/qr/",
  "/bio",
  "/bio/",
  "/integrations",
  "/integrations/",
  "/team",
  "/team/",
  "/pricing",
  "/pricing/",
  "/stats",
  "/stats/",
  "/account",
  "/account/",
  "/admin",
  "/admin/",
  "/app",
  "/app/",
  "/app/:page",
  "/app/:page/",
  "/index.html",
];

app.get("/", serveLanding);
app.get(["/landing", "/landing/"], redirectToCanonical("/"));
app.get(appShellRoutes, serveAppShell);
const serveAuthHtml = (templatePath) => (_req, res) => {
  const html = fs
    .readFileSync(templatePath, "utf8")
    .replaceAll("__GOOGLE_CLIENT_ID__", GOOGLE_CLIENT_ID)
    .replaceAll("__SUPABASE_URL__", SUPABASE_URL)
    .replaceAll("__SUPABASE_ANON_KEY__", SUPABASE_ANON_KEY);
  res.type("html").send(html);
};
app.get(["/login", "/login/"], serveAuthHtml(
  path.join(__dirname, "..", "public", "user", "login", "index.html"),
));
app.get(["/register", "/register/"], serveAuthHtml(
  path.join(__dirname, "..", "public", "user", "register", "index.html"),
));
app.get(["/user/login", "/user/login/"], redirectToCanonical("/login"));
app.get(["/user/register", "/user/register/"], redirectToCanonical("/register"));
app.get("/favicon.ico", (_req, res) => {
  res.type("image/svg+xml");
  res.sendFile(path.join(__dirname, "..", "public", "favicon.svg"));
});

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    index: false,
  }),
);

// ── FIX 1: Thêm /robots.txt để tránh 404 và ngăn bot crawl ──────────────────
app.get("/robots.txt", (_, res) => {
  res.set("Content-Type", "text/plain");
  res.set("Cache-Control", "public, max-age=86400");
  res.send("User-agent: *\nDisallow: /api/\nAllow: /\n");
});

// ── Multer ───────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "..", "public", "uploads");
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (_) {}

const memStorage = multer.memoryStorage();

const upload = multer({
  storage: CLOUDINARY_OK
    ? memStorage
    : multer.diskStorage({
        destination: (_, __, cb) => cb(null, uploadsDir),
        filename: (_, file, cb) =>
          cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
      }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    cb(null, /\.(jpg|jpeg|png|webp|gif)$/i.test(file.originalname)),
});

const videoUploadMw = multer({
  storage: CLOUDINARY_OK
    ? memStorage
    : multer.diskStorage({
        destination: (_, __, cb) => cb(null, uploadsDir),
        filename: (_, file, cb) =>
          cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
      }),
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

async function uploadToCloudinary(
  fileBuffer,
  originalName,
  resourceType = "image",
) {
  return new Promise((resolve, reject) => {
    const folder =
      "rutgonlink/" + (resourceType === "video" ? "videos" : "images");
    const opts = {
      folder,
      resource_type: resourceType,
      public_id: nanoid(12),
      ...(resourceType === "video"
        ? {
            eager: [
              {
                format: "jpg",
                transformation: [{ width: 1200, height: 630, crop: "fill" }],
              },
            ],
          }
        : {}),
    };
    const stream = cloudinary.uploader.upload_stream(opts, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    const { Readable } = require("stream");
    const readable = new Readable();
    readable.push(fileBuffer);
    readable.push(null);
    readable.pipe(stream);
  });
}

let db = null;
async function getDb() {
  if (!db) db = await initDb();
  return db;
}

async function getPublicBaseUrl() {
  const database = await getDb();
  const primary = await database.getPrimaryDomain();
  if (primary?.hostname) return `https://${primary.hostname}`;
  return BASE_URL;
}

function buildShortUrl(baseUrl, code) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${code}`;
}

function buildLinkShortUrl(link, fallbackBaseUrl) {
  const domainHostname = normalizeDomainHost(link?.domain_hostname);
  if (domainHostname) {
    return buildShortUrl(`https://${domainHostname}`, link.alias || link.short_code);
  }
  return buildShortUrl(fallbackBaseUrl, link.alias || link.short_code);
}

function buildVideoLaunchUrl(link) {
  const code = encodeURIComponent(link?.alias || link?.short_code || "");
  if (!code) return "/go";
  if (MIDDLE_DOMAIN) return `${MIDDLE_DOMAIN}/go/${code}`;
  return `/go/${code}`;
}

function normalizeDomainHost(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = /^https?:\/\//i.test(raw)
    ? new URL(raw)
    : new URL(`https://${raw}`);
  return normalized.hostname.toLowerCase();
}

function normalizeBioSlug(input, fallback = "") {
  const raw = String(input || fallback || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return raw || null;
}

function normalizeBioLinkOrder(input) {
  let value = input;
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw.split(",").map((part) => part.trim());
    }
  }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function parseBioLinkSource(input) {
  const raw = String(input || "").trim();
  if (!raw) return { mode: "recent", order: [] };
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw);
      return {
        mode: parsed.mode === "all" ? "all" : "recent",
        order: normalizeBioLinkOrder(parsed.order),
      };
    } catch {}
  }
  if (raw.startsWith("ordered:")) {
    return {
      mode: "recent",
      order: normalizeBioLinkOrder(raw.slice("ordered:".length)),
    };
  }
  return {
    mode: raw === "all" ? "all" : "recent",
    order: [],
  };
}

function serializeBioLinkSource(mode, order) {
  const normalizedMode = mode === "all" ? "all" : "recent";
  const normalizedOrder = normalizeBioLinkOrder(order);
  if (normalizedOrder.length) {
    return JSON.stringify({ mode: normalizedMode, order: normalizedOrder });
  }
  return normalizedMode;
}

function buildBioShareUrl(baseUrl, slug) {
  return `${baseUrl}/u/${encodeURIComponent(slug)}`;
}

async function resolvePublicBioLinks(database, profile) {
  const source = parseBioLinkSource(profile.link_source);
  const pool = await database.getRecentLinks(profile.user_id);
  const byCode = new Map();
  for (const link of pool || []) {
    if (link.short_code) byCode.set(String(link.short_code), link);
    if (link.alias) byCode.set(String(link.alias), link);
  }

  if (source.order.length) {
    const ordered = source.order.map((code) => byCode.get(code)).filter(Boolean);
    if (ordered.length) return ordered;
  }

  const limit = Math.max(1, Number(profile.link_count || 8));
  const base = (source.mode === "all" ? pool : pool.slice(0, limit)).filter(Boolean);
  return source.mode === "all" ? base : base.slice(0, limit);
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function isAdminEmail(email) {
  return !!ADMIN_EMAIL && email?.toLowerCase() === ADMIN_EMAIL;
}

function parseToken(req) {
  return (
    req.cookies?.token ||
    (req.headers.authorization || "").replace("Bearer ", "") ||
    null
  );
}

async function resolveUser(req) {
  const token = parseToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const database = await getDb();
    const user = await database.getUserById(payload.id);
    if (!user) return null;
    if (user.role === "admin" || isAdminEmail(user.email)) {
      user.plan = "admin";
      user.role = "admin";
    }
    return user;
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    req._tokenPayload = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

function requireAdmin(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req._tokenPayload = p;
    next();
  } catch {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

function getMobilePlatform(ua = "") {
  const u = ua.toLowerCase();
  if (/iphone|ipad|ipod/.test(u)) return "ios";
  if (/android/.test(u)) return "android";
  return "desktop";
}

// ── FIX 2: Nhận diện Facebook bot CHÍNH XÁC hơn, tách khỏi Facebook in-app browser ──
function isSocialBot(ua = "") {
  if (!ua) return false;
  // Facebook crawler bot (KHÔNG phải user dùng FB app)
  if (/facebookexternalhit|facebot/i.test(ua)) return true;
  return /twitterbot|linkedinbot|whatsapp|telegrambot|slackbot|discordbot|vkshare|zalo|vibebot|line[\s/]|baiduspider|googlebot|applebot|bingbot|yandexbot|pinterestbot|snapchat|ia_archiver|AhrefsBot|SemrushBot|rogerbot/i.test(
    ua,
  );
}

function isFacebookInAppBrowser(ua = "") {
  if (!ua) return false;
  if (/facebookexternalhit|facebot/i.test(ua)) return false;
  return /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
}

function getRedirectUaKind(ua = "") {
  if (isSocialBot(ua)) return "social_bot";
  if (isFacebookInAppBrowser(ua)) return "facebook_in_app";
  return getMobilePlatform(ua);
}

function setRedirectDebugHeaders(res, meta) {
  res.set("X-RGL-Redirect-Mode", meta.mode);
  if (meta.platform) {
    res.set("X-RGL-Redirect-Platform", meta.platform);
  }
}

function getRefererHost(referer = "") {
  try {
    return new URL(referer).hostname;
  } catch {
    return "";
  }
}

function logRedirectDecision(meta) {
  const entry = {
    event: "shortlink_redirect",
    timestamp: new Date().toISOString(),
    requestId: meta.requestId || null,
    linkId: meta.linkId || null,
    code: meta.code || null,
    mode: meta.mode,
    platform: meta.platform || null,
    uaKind: meta.uaKind || null,
    status: meta.status || null,
    target: meta.target || null,
  };
  const refererHost = getRefererHost(meta.referer || "");
  if (refererHost) {
    entry.refererHost = refererHost;
  }
  console.log(
    `[redirect-runtime] ${JSON.stringify({
      requestId: entry.requestId,
      code: entry.code,
      mode: entry.mode,
      platform: entry.platform,
      uaKind: entry.uaKind,
      status: entry.status,
      target: entry.target,
      refererHost: entry.refererHost || null,
    })}`,
  );
  console.info(`[redirect] ${JSON.stringify(entry)}`);
  persistRedirectLogEntry(entry);
}

function ensureRedirectLogDir() {
  if (!redirectLogDirReady) {
    redirectLogDirReady = fs.promises.mkdir(REDIRECT_LOG_DIR, {
      recursive: true,
    });
  }
  return redirectLogDirReady;
}

function persistRedirectLogEntry(entry) {
  const line = `${JSON.stringify(entry)}\n`;
  redirectLogWriteQueue = redirectLogWriteQueue
    .then(() => ensureRedirectLogDir())
    .then(() => fs.promises.appendFile(REDIRECT_LOG_FILE, line, "utf8"))
    .catch((error) => {
      console.error(`[redirect-log] ${error.message}`);
    });
}

async function readRecentRedirectLogEntries(limit = 20) {
  await redirectLogWriteQueue;
  try {
    const raw = await fs.promises.readFile(REDIRECT_LOG_FILE, "utf8");
    const lines = raw.split(/\r?\n/).filter(Boolean);
    return lines
      .slice(-limit)
      .reverse()
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

const TIKTOK_ANDROID_PACKAGE = "com.ss.android.ugc.trill";
const TIKTOK_APP_STORE_ID = "1235601864";
const SHOPEE_ANDROID_PACKAGE = "com.shopee.vn";
const SHOPEE_APP_STORE_ID = "959841449";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "1609970790226254";

function buildTikTokAppScheme(destinationUrl) {
  try {
    const url = new URL(destinationUrl);
    const path = url.pathname;
    const videoMatch = path.match(/\/video\/(\d+)/);
    if (videoMatch)
      return `snssdk1233://aweme/detail/?aweme_id=${videoMatch[1]}`;
    const profileMatch = path.match(/\/@([\w.]+)/);
    if (profileMatch)
      return `snssdk1233://user/profile/?uniqueId=${profileMatch[1]}`;
    if (path.includes("/view/product/") || url.hostname.includes("shop")) {
      const productMatch = path.match(/\/view\/product\/(\d+)/);
      const productId = productMatch?.[1] || "";
      const encodedUrl = encodeURIComponent(destinationUrl);
      const chainKey = url.searchParams.get("chain_key") || "";
      const trackParams = url.searchParams.get("trackParams") || "";
      const encodeParams = url.searchParams.get("encode_params") || "";
      return (
        `snssdk1180://ec/pdp` +
        `?biz_type=0&gd_label=share_from_pdp_auto&need_mall=1&needlaunchlog=1&page_name=reflow_pdp` +
        `&params_url=${encodedUrl}&refer=web&scene=pdp&use_land_page=1&is_commerce=1&_svg=1` +
        (productId
          ? `&requestParams=${encodeURIComponent(JSON.stringify({ product_id: [productId] }))}`
          : "") +
        (chainKey ? `&chain_key=${encodeURIComponent(chainKey)}` : "") +
        (trackParams ? `&trackParams=${encodeURIComponent(trackParams)}` : "") +
        (encodeParams
          ? `&encode_params=${encodeURIComponent(encodeParams)}`
          : "")
      );
    }
    return destinationUrl;
  } catch {
    return destinationUrl;
  }
}

function detectPlatformDeep(originalUrl, platform) {
  // ── Shopee product: -i.<shopId>.<itemId>
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [, shopId, itemId] = sp;
    // Universal Link – OS tự mở app, không cần JS trick
    const universalLink = `https://shopee.vn/universal-link/product/${shopId}/${itemId}`;
    return {
      deeplink: universalLink, // dùng Universal Link thay custom scheme
      deeplink_ios: universalLink,
      deeplink_android: universalLink,
      platform_name: "shopee",
      fallback: originalUrl,
      ios_store: `https://apps.apple.com/vn/app/shopee-vn/id${SHOPEE_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${SHOPEE_ANDROID_PACKAGE}`,
    };
  }

  // ── Shopee generic (shop page, search, v.v.)
  if (/(?:^|\.)shopee\./i.test(originalUrl)) {
    // Redirect thẳng về original – Shopee đã cấu hình App Links
    // Browser/OS sẽ tự mở app nếu đã cài
    return {
      deeplink: originalUrl, // <-- redirect thẳng, không cần trick
      deeplink_ios: originalUrl,
      deeplink_android: originalUrl,
      platform_name: "shopee",
      fallback: originalUrl,
      ios_store: `https://apps.apple.com/vn/app/shopee-vn/id${SHOPEE_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${SHOPEE_ANDROID_PACKAGE}`,
    };
  }
  if (/tiktok\.com/i.test(originalUrl)) {
    const scheme = buildTikTokAppScheme(originalUrl);
    return {
      deeplink: scheme,
      deeplink_ios: scheme,
      deeplink_android: scheme,
      universal_link: originalUrl,
      platform_name: "tiktok",
      fallback: originalUrl,
      ios_store: `https://apps.apple.com/vn/app/tiktok/id${TIKTOK_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${TIKTOK_ANDROID_PACKAGE}`,
    };
  }
  return {
    deeplink: null,
    deeplink_ios: null,
    deeplink_android: null,
    platform_name: "generic",
    fallback: originalUrl,
  };
}

function normalizeAnalyticsText(input, maxLength = 80) {
  const value = String(input || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!value) return null;
  return value.slice(0, maxLength);
}

function stripVietnameseMarks(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function sanitizeAliasInput(input, maxLength = 40) {
  const compact = stripVietnameseMarks(input)
    .toLowerCase()
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return compact.slice(0, maxLength).replace(/-+$/g, "");
}

function humanizeSlugTitle(input, maxLength = 120) {
  const compact = String(input || "")
    .trim()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
  if (!compact) return null;
  const pretty = compact.charAt(0).toUpperCase() + compact.slice(1);
  return pretty.slice(0, maxLength);
}

function normalizeShareTitleInput(input, maxLength = 120) {
  if (typeof input === "undefined") return undefined;
  const compact = String(input || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!compact) return null;
  const looksLikeSlug =
    !/\s/.test(compact) &&
    /[-_]/.test(compact) &&
    !compact.includes("://");
  return looksLikeSlug
    ? humanizeSlugTitle(compact, maxLength)
    : compact.slice(0, maxLength);
}

function normalizeCountryCode(input) {
  const value = String(input || "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return null;
  if (value === "XX" || value === "T1") return null;
  return value;
}

function getCountryNameFromCode(code) {
  if (!code) return null;
  return (
    regionNamesVi?.of(code) ||
    regionNamesEn?.of(code) ||
    code
  );
}

function getCountryEnglishNameFromCode(code) {
  if (!code) return null;
  return regionNamesEn?.of(code) || code;
}

function extractClickGeo(req) {
  const countryCode = normalizeCountryCode(
    req.headers["cf-ipcountry"] ||
      req.headers["x-vercel-ip-country"] ||
      req.headers["x-country-code"] ||
      req.headers["x-country"] ||
      "",
  );
  const countryName =
    normalizeAnalyticsText(
      req.headers["x-vercel-ip-country-name"] ||
        req.headers["x-country-name"] ||
        req.headers["cf-country-name"] ||
        "",
      120,
    ) ||
    getCountryNameFromCode(countryCode);
  const city = normalizeAnalyticsText(
    req.headers["cf-ipcity"] ||
      req.headers["x-vercel-ip-city"] ||
      req.headers["x-city"] ||
      "",
    120,
  );
  return {
    country_code: countryCode,
    country_name: countryName,
    city,
  };
}

function getAnalyticsDayKey(input) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ANALYTICS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(input));
  } catch {
    return String(input || "").slice(0, 10);
  }
}

function getLinkAnalyticsPlatform(link) {
  if ((link?.link_type || "").trim() === "video") {
    return {
      key: "video",
      label: "Video Overlay",
      color: "#f59e0b",
    };
  }
  const detected = detectPlatformDeep(link?.original_url || "", "desktop");
  if (detected.platform_name === "shopee") {
    return {
      key: "shopee",
      label: "Shopee",
      color: "#ee4d2d",
    };
  }
  if (detected.platform_name === "tiktok") {
    return {
      key: "tiktok",
      label: "TikTok",
      color: "#69c9d0",
    };
  }
  return {
    key: "generic",
    label: "Khác",
    color: "#6366f1",
  };
}

function buildStatsAnalytics(clickRows = []) {
  const timelineMap = new Map();
  const countryMap = new Map();
  const platformMap = new Map();
  let trackedGeoClicks = 0;

  for (const row of clickRows) {
    const clickedAt = row?.clicked_at;
    if (clickedAt) {
      const dayKey = getAnalyticsDayKey(clickedAt);
      timelineMap.set(dayKey, (timelineMap.get(dayKey) || 0) + 1);
    }

    const countryCode = normalizeCountryCode(row?.country_code);
    const countryName =
      normalizeAnalyticsText(row?.country_name, 120) ||
      getCountryNameFromCode(countryCode) ||
      "Không rõ";
    const cityName = normalizeAnalyticsText(row?.city, 120) || "Không rõ";
    if (countryCode) {
      trackedGeoClicks += 1;
      if (!countryMap.has(countryCode)) {
        countryMap.set(countryCode, {
          country_code: countryCode,
          country_name: countryName,
          clicks: 0,
          cities: new Map(),
        });
      }
      const countryEntry = countryMap.get(countryCode);
      countryEntry.clicks += 1;
      countryEntry.cities.set(cityName, (countryEntry.cities.get(cityName) || 0) + 1);
    }

    const platform = getLinkAnalyticsPlatform(row?.link || row);
    if (!platformMap.has(platform.key)) {
      platformMap.set(platform.key, {
        key: platform.key,
        label: platform.label,
        color: platform.color,
        clicks: 0,
      });
    }
    platformMap.get(platform.key).clicks += 1;
  }

  const totalClicks = clickRows.length;
  const timeline = [...timelineMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, clicks]) => ({ date, clicks }));
  const topCountries = [...countryMap.values()]
    .sort((a, b) => b.clicks - a.clicks)
    .map((country) => {
      const topCity =
        [...country.cities.entries()].sort((a, b) => b[1] - a[1])[0] || [];
      return {
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: getCountryEnglishNameFromCode(country.country_code),
        clicks: country.clicks,
        city: topCity[0] || "Không rõ",
        city_clicks: topCity[1] || 0,
      };
    });
  const platformDistribution = [...platformMap.values()]
    .sort((a, b) => b.clicks - a.clicks)
    .map((platform) => ({
      ...platform,
      percent: totalClicks
        ? Math.round((platform.clicks / totalClicks) * 1000) / 10
        : 0,
    }));

  return {
    total_clicks: totalClicks,
    timeline,
    geo: {
      tracked_clicks: trackedGeoClicks,
      unknown_clicks: Math.max(totalClicks - trackedGeoClicks, 0),
      countries: topCountries.map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: country.country_name_en,
        clicks: country.clicks,
      })),
      top_countries: topCountries.slice(0, 8),
    },
    platforms: {
      distribution: platformDistribution,
      top_platforms: platformDistribution.slice(0, 8),
    },
  };
}

function normalizeDomainVerificationStatus(input) {
  const value = String(input || "").trim().toLowerCase();
  if (value === "verified" || value === "pending" || value === "failed") {
    return value;
  }
  return null;
}

function normalizeExpiryDateInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = raw.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime())) return null;
  return normalized;
}

function getRequestIp(req) {
  return normalizeAnalyticsText(
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      "",
    120,
  );
}

function detectDeviceTypeFromUa(ua = "") {
  const lower = ua.toLowerCase();
  if (/ipad|tablet|playbook|silk/i.test(lower)) return "tablet";
  if (/mobi|iphone|ipod|android/i.test(lower)) return "mobile";
  return "desktop";
}

function detectBrowserFromUa(ua = "") {
  if (!ua) return "Trình duyệt lạ";
  if (/edg\//i.test(ua)) return "Edge";
  if (/opr\//i.test(ua) || /opera/i.test(ua)) return "Opera";
  if (/samsungbrowser\//i.test(ua)) return "Samsung Internet";
  if (/firefox\//i.test(ua)) return "Firefox";
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua)) return "Chrome";
  if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return "Safari";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "Facebook In-App";
  if (/instagram/i.test(ua)) return "Instagram In-App";
  if (/zalo/i.test(ua)) return "Zalo";
  return "Trình duyệt lạ";
}

function detectOsFromUa(ua = "") {
  if (!ua) return "Hệ điều hành lạ";
  if (/windows nt/i.test(ua)) return "Windows";
  if (/iphone|ipad|ipod/i.test(ua)) return "iOS";
  if (/android/i.test(ua)) return "Android";
  if (/mac os x/i.test(ua)) return "macOS";
  if (/linux/i.test(ua)) return "Linux";
  return "Hệ điều hành lạ";
}

function getDeviceTypeLabel(deviceType = "desktop") {
  if (deviceType === "mobile") return "Mobile";
  if (deviceType === "tablet") return "Tablet";
  return "Desktop";
}

function buildLoginDeviceContext(req) {
  const userAgent = String(req.headers["user-agent"] || "").trim();
  const browserName = detectBrowserFromUa(userAgent);
  const osName = detectOsFromUa(userAgent);
  const deviceType = detectDeviceTypeFromUa(userAgent);
  const deviceLabel = [browserName, osName, getDeviceTypeLabel(deviceType)]
    .filter(Boolean)
    .join(" • ");
  const deviceFingerprint = crypto
    .createHash("sha1")
    .update([browserName.toLowerCase(), osName.toLowerCase(), deviceType].join("|"))
    .digest("hex");
  return {
    deviceFingerprint,
    deviceLabel,
    browserName,
    osName,
    deviceType,
    ip: getRequestIp(req),
    userAgent,
  };
}

function buildQuotaAlert(planName, linksToday, hasAccount = true) {
  const effectivePlan = planName === "guest" ? "free" : planName;
  const planCfg = PLANS[effectivePlan] || PLANS.free;
  const dailyLimit = Number(planCfg.dailyLimit || 0);
  const used = Math.max(Number(linksToday || 0), 0);
  if (dailyLimit < 1) {
    return {
      active: false,
      level: "normal",
      key: "",
      daily_limit: 0,
      used,
      remaining: null,
      ratio: 0,
      has_account: hasAccount,
      plan: planName,
    };
  }

  const remaining = Math.max(dailyLimit - used, 0);
  const ratio = dailyLimit ? used / dailyLimit : 0;
  let level = "normal";
  if (used >= dailyLimit) level = "critical";
  else if (ratio >= 0.8 || remaining <= Math.min(5, Math.ceil(dailyLimit * 0.2))) level = "warn";
  const todayKey = getAnalyticsDayKey(new Date());

  return {
    active: hasAccount && level !== "normal",
    level,
    key: !hasAccount || level === "normal" ? "" : `quota:${effectivePlan}:${level}:${todayKey}`,
    daily_limit: dailyLimit,
    used,
    remaining,
    ratio: Math.round(ratio * 1000) / 10,
    has_account: hasAccount,
    plan: planName,
  };
}

function buildClickSpikeAlert(clickRows = [], currentTime = Date.now()) {
  const bucketMinutes = 15;
  const bucketMs = bucketMinutes * 60 * 1000;
  const currentBucketStart = Math.floor(currentTime / bucketMs) * bucketMs;
  const oldestBucketStart = currentBucketStart - 4 * bucketMs;
  const countsByBucket = new Map();

  for (const row of clickRows) {
    const clickedAtMs = new Date(row?.clicked_at || 0).getTime();
    if (!Number.isFinite(clickedAtMs) || clickedAtMs < oldestBucketStart) continue;
    const bucketStart = Math.floor(clickedAtMs / bucketMs) * bucketMs;
    countsByBucket.set(bucketStart, (countsByBucket.get(bucketStart) || 0) + 1);
  }

  const currentClicks = countsByBucket.get(currentBucketStart) || 0;
  const previousBuckets = [1, 2, 3, 4].map(
    (index) => countsByBucket.get(currentBucketStart - index * bucketMs) || 0,
  );
  const baselineClicks =
    previousBuckets.reduce((total, value) => total + value, 0) / previousBuckets.length;
  const ratio = baselineClicks > 0 ? currentClicks / baselineClicks : currentClicks;
  const active =
    currentClicks >= 12 &&
    ((baselineClicks >= 3 && ratio >= 3) || (baselineClicks < 3 && currentClicks >= 18));

  return {
    active,
    level: active ? "warn" : "normal",
    key: active ? `click-spike:${new Date(currentBucketStart).toISOString()}` : "",
    bucket_minutes: bucketMinutes,
    bucket_started_at: new Date(currentBucketStart).toISOString(),
    current_clicks: currentClicks,
    baseline_clicks: Math.round(baselineClicks * 10) / 10,
    ratio: Math.round(ratio * 10) / 10,
  };
}

function buildSecurityAlert(loginEvent) {
  if (!loginEvent?.is_new_device) {
    return {
      active: false,
      level: "normal",
      key: "",
    };
  }
  const occurredAtMs = new Date(loginEvent.occurred_at || 0).getTime();
  if (!Number.isFinite(occurredAtMs) || Date.now() - occurredAtMs > 7 * 24 * 3600 * 1000) {
    return {
      active: false,
      level: "normal",
      key: "",
    };
  }
  return {
    active: true,
    level: "warn",
    key: `security:new-device:${loginEvent.id}`,
    occurred_at: loginEvent.occurred_at,
    device_label: normalizeAnalyticsText(loginEvent.device_label, 120) || "Thiết bị mới",
    browser_name: normalizeAnalyticsText(loginEvent.browser_name, 80),
    os_name: normalizeAnalyticsText(loginEvent.os_name, 80),
    device_type: normalizeAnalyticsText(loginEvent.device_type, 40),
  };
}

function getDaysUntilExpiry(dateValue, currentTime = Date.now()) {
  const normalized = normalizeExpiryDateInput(dateValue);
  if (!normalized) return null;
  const expiryMs = new Date(`${normalized}T00:00:00.000Z`).getTime();
  const currentDate = new Date(currentTime);
  const todayMs = Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    currentDate.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  return Math.floor((expiryMs - todayMs) / (24 * 60 * 60 * 1000));
}

function buildDomainAlerts(domains = [], currentTime = Date.now()) {
  const alerts = [];
  const dayKey = getAnalyticsDayKey(new Date(currentTime));

  for (const domain of domains) {
    if (!domain || domain.is_active === false) continue;
    const hostname = normalizeAnalyticsText(domain.hostname, 120) || "domain";
    const verificationStatus = normalizeDomainVerificationStatus(domain.verification_status) || "verified";
    if (verificationStatus === "failed") {
      alerts.push({
        key: `domain:verify:${domain.id}:failed:${dayKey}`,
        type: "verify_failed",
        level: "err",
        hostname,
        title: "Domain lỗi verify",
        message: `${hostname} đang ở trạng thái verify failed.`,
      });
    }

    const daysUntilExpiry = getDaysUntilExpiry(domain.expires_at, currentTime);
    if (daysUntilExpiry === null) continue;
    if (daysUntilExpiry < 0) {
      alerts.push({
        key: `domain:expiry:${domain.id}:expired:${Math.abs(daysUntilExpiry)}`,
        type: "expired",
        level: "err",
        hostname,
        title: "Domain đã hết hạn",
        message: `${hostname} đã hết hạn ${Math.abs(daysUntilExpiry)} ngày.`,
        expires_at: normalizeExpiryDateInput(domain.expires_at),
      });
    } else if (daysUntilExpiry <= 14) {
      alerts.push({
        key: `domain:expiry:${domain.id}:${daysUntilExpiry}`,
        type: "expiring",
        level: "warn",
        hostname,
        title: "Domain sắp hết hạn",
        message: `${hostname} còn ${daysUntilExpiry} ngày trước khi hết hạn.`,
        expires_at: normalizeExpiryDateInput(domain.expires_at),
        days_until_expiry: daysUntilExpiry,
      });
    }
  }

  return alerts.sort((left, right) => {
    const severity = { err: 0, warn: 1, info: 2 };
    const severityDiff = (severity[left.level] ?? 9) - (severity[right.level] ?? 9);
    if (severityDiff !== 0) return severityDiff;
    return String(left.hostname || "").localeCompare(String(right.hostname || ""));
  });
}

function buildSessionAlertsFromLoginEvent(loginEvent) {
  const securityAlert = buildSecurityAlert(loginEvent);
  if (!securityAlert.active) return [];
  return [
    {
      key: securityAlert.key,
      title: "Thiết bị mới đăng nhập",
      message: `${securityAlert.device_label} vừa đăng nhập vào tài khoản của bạn.`,
      kind: "warn",
      createdAt: securityAlert.occurred_at,
    },
  ];
}

function alertLevelToNotificationKind(level = "info") {
  if (level === "err" || level === "critical") return "err";
  if (level === "warn") return "warn";
  if (level === "ok") return "ok";
  return "info";
}

function buildStatsAlertPayload({ planName, linksToday, hasAccount, clickRows, latestLoginEvent }) {
  const quota = buildQuotaAlert(planName, linksToday, hasAccount);
  const clickSpike = buildClickSpikeAlert(clickRows);
  const sessionItems = buildSessionAlertsFromLoginEvent(latestLoginEvent);
  const active = [];

  if (quota.active) {
    active.push({
      key: quota.key,
      title: quota.level === "critical" ? "Đã chạm giới hạn gói" : "Sắp chạm ngưỡng quota",
      message:
        quota.level === "critical"
          ? `Bạn đã dùng ${quota.used}/${quota.daily_limit} link hôm nay.`
          : `Bạn đã dùng ${quota.used}/${quota.daily_limit} link hôm nay, còn ${quota.remaining}.`,
      kind: alertLevelToNotificationKind(quota.level),
      page: "pricing",
    });
  }

  if (clickSpike.active) {
    active.push({
      key: clickSpike.key,
      title: "Click tăng đột biến",
      message: `${clickSpike.current_clicks} click / ${clickSpike.bucket_minutes} phút, gấp ${clickSpike.ratio} lần mức nền.`,
      kind: alertLevelToNotificationKind(clickSpike.level),
      page: "stats",
      createdAt: clickSpike.bucket_started_at,
    });
  }

  sessionItems.forEach((item) => {
    active.push({
      ...item,
      page: "",
    });
  });

  return {
    quota,
    click_spike: clickSpike,
    session: buildSecurityAlert(latestLoginEvent),
    active,
  };
}

function buildWorkspaceInvitationAlert(context) {
  const membership = context?.membership || null;
  const workspace = context?.workspace || null;
  if (
    !membership ||
    membership.status !== "pending" ||
    membership.role === "owner" ||
    !workspace
  ) {
    return null;
  }
  const roleLabel =
    membership.role === "owner"
      ? "Owner"
      : membership.role === "analyst"
        ? "Analyst"
        : "Editor";
  return {
    key: `team-invite:${workspace.id}:${membership.id}`,
    title: "Lời mời workspace mới",
    message: `Bạn được mời vào ${workspace.name || "workspace"} với quyền ${roleLabel}.`,
    kind: "info",
    page: "team",
    createdAt: membership.updated_at || membership.created_at || new Date().toISOString(),
  };
}

function buildAdminAlertPayload(domains = []) {
  const domainAlerts = buildDomainAlerts(domains);
  return {
    domains: domainAlerts,
    active: domainAlerts.map((item) => ({
      key: item.key,
      title: item.title,
      message: item.message,
      kind: alertLevelToNotificationKind(item.level),
      page: "admin",
    })),
  };
}

app.get("/og-default.png", (_, res) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#1e2535"/><stop offset="100%" style="stop-color:#0d1117"/></linearGradient></defs>
    <rect width="1200" height="630" fill="url(#g)"/>
    <rect x="80" y="200" width="1040" height="8" rx="4" fill="#2a3347"/>
    <text x="600" y="280" font-family="Arial,sans-serif" font-size="72" font-weight="bold" fill="#3b82f6" text-anchor="middle">🔗 BocLink</text>
    <text x="600" y="370" font-family="Arial,sans-serif" font-size="32" fill="#64748b" text-anchor="middle">Rút gọn link thông minh</text>
    <text x="600" y="430" font-family="Arial,sans-serif" font-size="24" fill="#334155" text-anchor="middle">Deeplink Shopee &amp; TikTok · Custom Preview</text>
  </svg>`;
  res.set("Content-Type", "image/svg+xml");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(svg);
});

app.get("/api/debug", (req, res) =>
  res.json({
    has_turso_url: !!process.env.TURSO_DATABASE_URL,
    base_url: BASE_URL,
    admin_email: ADMIN_EMAIL,
  }),
);

// ─── AUTH ─────────────────────────────────────────────────────────────────────

function buildAuthUserPayload(user, isAdmin = false) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone || null,
    avatar_url: user.avatar_url || null,
    plan: isAdmin ? "admin" : user.plan,
    role: isAdmin ? "admin" : user.role || "user",
    two_factor_enabled: !!user.two_factor_enabled,
    created_at: user.created_at,
  };
}

function getTwoFactorEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(String(TWO_FACTOR_ENCRYPTION_SECRET || JWT_SECRET || "boclink"))
    .digest();
}

function encryptSensitiveValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getTwoFactorEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("hex")}.${tag.toString("hex")}.${encrypted.toString("hex")}`;
}

function decryptSensitiveValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") {
    return null;
  }
  try {
    const [, ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getTwoFactorEncryptionKey(),
      Buffer.from(ivHex, "hex"),
    );
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

function encodeBase32(buffer) {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input) {
  const normalized = String(input || "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function generateTwoFactorSecret() {
  return encodeBase32(crypto.randomBytes(20));
}

function sanitizeTwoFactorCode(input) {
  return String(input || "")
    .replace(/\D/g, "")
    .slice(0, TWO_FACTOR_DIGITS);
}

function generateTotpCode(secret, counter) {
  const secretBuffer = decodeBase32(secret);
  if (!secretBuffer.length) return null;
  const counterBuffer = Buffer.alloc(8);
  const normalizedCounter = BigInt(counter);
  counterBuffer.writeBigUInt64BE(normalizedCounter);
  const hmac = crypto.createHmac("sha1", secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const modulo = 10 ** TWO_FACTOR_DIGITS;
  return String(binary % modulo).padStart(TWO_FACTOR_DIGITS, "0");
}

function verifyTotpCode(secret, code, windowSteps = TWO_FACTOR_WINDOW_STEPS) {
  const normalizedCode = sanitizeTwoFactorCode(code);
  if (normalizedCode.length !== TWO_FACTOR_DIGITS) return false;
  const currentCounter = Math.floor(Date.now() / 1000 / TWO_FACTOR_PERIOD_SECONDS);
  for (let delta = -windowSteps; delta <= windowSteps; delta += 1) {
    if (generateTotpCode(secret, currentCounter + delta) === normalizedCode) {
      return true;
    }
  }
  return false;
}

function buildTwoFactorProvisioningUri(user, secret) {
  const accountName = encodeURIComponent(user.email || `user-${user.id}`);
  const issuer = encodeURIComponent(TWO_FACTOR_ISSUER);
  return `otpauth://totp/${issuer}:${accountName}?secret=${encodeURIComponent(secret)}&issuer=${issuer}&algorithm=SHA1&digits=${TWO_FACTOR_DIGITS}&period=${TWO_FACTOR_PERIOD_SECONDS}`;
}

function readEnabledTwoFactorSecret(user) {
  if (!user?.two_factor_enabled) return null;
  const secret = decryptSensitiveValue(user.two_factor_secret);
  if (!secret) throw new Error("TWO_FACTOR_SECRET_INVALID");
  return secret;
}

function readPendingTwoFactorSecret(user) {
  return decryptSensitiveValue(user?.two_factor_pending_secret);
}

function buildTwoFactorChallengeToken(userId) {
  return jwt.sign({ purpose: "2fa-login", userId }, JWT_SECRET, {
    expiresIn: "10m",
  });
}

function parseTwoFactorChallengeToken(token) {
  const payload = jwt.verify(String(token || ""), JWT_SECRET);
  if (payload?.purpose !== "2fa-login" || !payload?.userId) {
    throw new Error("INVALID_TWO_FACTOR_CHALLENGE");
  }
  return payload;
}

function buildTwoFactorChallengeResponse(user) {
  return {
    twoFactorRequired: true,
    challenge_token: buildTwoFactorChallengeToken(user.id),
    user: {
      email: user.email,
      name: user.name || user.email?.split("@")[0] || "User",
      avatar_url: user.avatar_url || null,
    },
    message: "Tài khoản này đã bật xác thực 2 lớp. Vui lòng nhập mã 6 số.",
  };
}

function normalizePhoneInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const normalized = raw.replace(/[^\d+\s().-]/g, "").replace(/\s+/g, " ").slice(0, 32);
  const digits = normalized.replace(/\D/g, "");
  if (digits.length < 8) return null;
  return normalized;
}

function normalizeAvatarUrlInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (/^\/uploads\/[a-z0-9._/-]+$/i.test(raw)) {
    return raw.slice(0, 500);
  }
  try {
    const parsed = new URL(raw);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString().slice(0, 500);
  } catch {
    return null;
  }
}

function getBillingPlanMeta(plan) {
  return BILLING_PLANS[String(plan || "").trim().toLowerCase()] || null;
}

function resolvePublicAssetUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${BASE_URL}${raw}`;
  return `${BASE_URL}/${raw.replace(/^\/+/, "")}`;
}

function buildPaymentTransferNote(user, planCode, referenceCode) {
  const planMeta = getBillingPlanMeta(planCode);
  const code = String(referenceCode || "").trim();
  return `BOCLINK ${planMeta?.label?.toUpperCase() || String(planCode || "").toUpperCase()} U${user?.id || "0"} ${code}`.slice(0, 80);
}

function getPaymentConfig() {
  return {
    bank_id: PAYMENT_BANK_ID,
    bank_name: PAYMENT_BANK_NAME,
    bank_account: PAYMENT_BANK_ACCOUNT,
    account_holder: PAYMENT_ACCOUNT_HOLDER,
    qr_image_url: resolvePublicAssetUrl(PAYMENT_QR_IMAGE_URL),
    contact: PAYMENT_CONTACT,
    plans: Object.values(BILLING_PLANS),
  };
}

function normalizeWorkspaceRole(input) {
  const value = String(input || "").trim().toLowerCase();
  if (value === "owner" || value === "analyst") return value;
  return "editor";
}

function normalizeWorkspaceStatus(input) {
  const value = String(input || "").trim().toLowerCase();
  if (value === "pending" || value === "paused") return value;
  return "active";
}

function getWorkspaceSeatLimitForUser(user) {
  if (!user) return 1;
  if (user.role === "admin" || user.plan === "admin" || user.plan === "business") return 10;
  if (user.plan === "pro") return 5;
  return 3;
}

function canManageWorkspaceMembers(membership, workspace, user) {
  return (
    !!membership &&
    membership.role === "owner" &&
    membership.status === "active" &&
    Number(workspace?.owner_user_id || 0) === Number(user?.id || 0)
  );
}

function canManageWorkspaceTemplates(membership) {
  return !!membership && membership.status === "active" && ["owner", "editor"].includes(membership.role);
}

function formatWorkspaceDisplayName(value, fallback = "Workspace") {
  return String(value || fallback).trim().slice(0, 120) || fallback;
}

function buildDefaultWorkspaceName(user) {
  const label = String(user?.name || user?.email?.split("@")[0] || "Workspace").trim();
  return formatWorkspaceDisplayName(`${label} Workspace`);
}

function buildWorkspaceMemberResponse(member) {
  const email = String(member?.email || "").trim().toLowerCase();
  return {
    id: member?.id,
    workspace_id: member?.workspace_id,
    user_id: member?.user_id || null,
    email,
    display_name:
      String(member?.display_name || "").trim() ||
      String(member?.name || "").trim() ||
      (email ? email.split("@")[0] : "Member"),
    role: normalizeWorkspaceRole(member?.role),
    status: normalizeWorkspaceStatus(member?.status),
    invited_by: member?.invited_by || null,
    joined_at: member?.joined_at || null,
    created_at: member?.created_at || null,
    updated_at: member?.updated_at || null,
  };
}

function buildWorkspaceTemplateResponse(template, memberMap = new Map(), publicBaseUrl = BASE_URL) {
  const creator = memberMap.get(Number(template?.created_by_user_id || 0));
  const sourceLink = template?.source_link_id ? memberMap.get(`link:${template.source_link_id}`) : null;
  return {
    id: template?.id,
    workspace_id: template?.workspace_id,
    created_by_user_id: template?.created_by_user_id || null,
    creator_name: creator?.display_name || creator?.email || "Member",
    source_link_id: template?.source_link_id || null,
    source_link_short_url: sourceLink?.short_url || null,
    name: formatWorkspaceDisplayName(template?.name, "Template"),
    og_title: template?.og_title || "",
    og_desc: template?.og_desc || "",
    og_image: template?.og_image || "",
    link_type: template?.link_type || "direct",
    video_url: template?.video_url || "",
    video_overlay_text: template?.video_overlay_text || "",
    domain_hostname: template?.domain_hostname || null,
    created_at: template?.created_at || null,
    updated_at: template?.updated_at || null,
    preview_domain: template?.domain_hostname || new URL(publicBaseUrl).hostname,
  };
}

async function resolveWorkspaceContext(database, user, { ensureOwnerWorkspace = true } = {}) {
  if (!database || !user?.id) return null;
  const rawMemberships = await database.listWorkspaceMembershipsForIdentity(user.id, user.email);
  const normalizedEmail = String(user.email || "").trim().toLowerCase();
  const normalizedMemberships = [];

  for (const rawMembership of rawMemberships) {
    const workspace = rawMembership?.workspaces || null;
    if (!workspace) continue;
    let member = buildWorkspaceMemberResponse(rawMembership);
    const shouldBindUser =
      !member.user_id &&
      normalizedEmail &&
      member.email === normalizedEmail;
    if (shouldBindUser || member.display_name !== (user.name || member.display_name)) {
      member = buildWorkspaceMemberResponse(
        (await database.updateWorkspaceMember(member.id, {
          user_id: shouldBindUser ? user.id : member.user_id,
          display_name: user.name || member.display_name,
          status: member.status,
          joined_at: member.joined_at,
        })) || rawMembership,
      );
    }
    normalizedMemberships.push({ workspace, member });
  }

  const activeJoined = normalizedMemberships.find(
    (item) =>
      item.member.status === "active" &&
      Number(item.workspace?.owner_user_id || 0) !== Number(user.id),
  );
  const activeOwned = normalizedMemberships.find(
    (item) =>
      item.member.status === "active" &&
      Number(item.workspace?.owner_user_id || 0) === Number(user.id),
  );
  const pendingJoined = normalizedMemberships.find(
    (item) =>
      item.member.status === "pending" &&
      Number(item.workspace?.owner_user_id || 0) !== Number(user.id),
  );

  let selected = activeJoined || pendingJoined || activeOwned || null;
  if (!selected && ensureOwnerWorkspace) {
    let workspace = await database.getWorkspaceByOwnerUserId(user.id);
    if (!workspace) {
      workspace = await database.createWorkspace(user.id, buildDefaultWorkspaceName(user));
    } else if (!workspace.name) {
      workspace = (await database.updateWorkspace(workspace.id, { name: buildDefaultWorkspaceName(user) })) || workspace;
    }
    const ownerMember = await database.upsertWorkspaceMember(workspace.id, {
      user_id: user.id,
      email: normalizedEmail,
      display_name: user.name || normalizedEmail.split("@")[0] || "Owner",
      role: "owner",
      status: "active",
      invited_by: user.id,
      joined_at: new Date().toISOString(),
    });
    selected = {
      workspace,
      member: buildWorkspaceMemberResponse(ownerMember),
    };
  }
  if (!selected) return null;

  const workspace = await database.getWorkspaceById(selected.workspace.id);
  const members = (await database.listWorkspaceMembers(workspace.id)).map(buildWorkspaceMemberResponse);
  const links = await database.getRecentLinks(user.id, null);
  const linkMap = new Map(
    links.map((link) => [
      `link:${link.id}`,
      {
        short_url: buildLinkShortUrl(link, BASE_URL),
      },
    ]),
  );
  const memberMap = new Map(members.map((member) => [Number(member.user_id || 0), member]));
  for (const [key, value] of linkMap.entries()) {
    memberMap.set(key, value);
  }
  const templates = (await database.listWorkspaceTemplates(workspace.id)).map((template) =>
    buildWorkspaceTemplateResponse(template, memberMap, BASE_URL),
  );

  return {
    workspace,
    membership: selected.member,
    members,
    templates,
    sourceLinks: links.map((link) => ({
      id: link.id,
      short_url: buildLinkShortUrl(link, BASE_URL),
      short_code: link.alias || link.short_code || "",
      alias: link.alias || "",
      original_url: link.original_url || "",
      og_title: link.og_title || "",
      og_desc: link.og_desc || "",
      og_image: link.og_image || "",
      link_type: link.link_type || "direct",
      video_url: link.video_url || "",
      video_overlay_text: link.video_overlay_text || "",
      domain_hostname: link.domain_hostname || null,
      created_at: link.created_at || null,
      workspace_id: link.workspace_id || null,
    })),
  };
}

function buildTeamWorkspacePayload(context, user) {
  const membership = context?.membership || null;
  const isPendingInvite =
    membership?.status === "pending" && membership?.role !== "owner";
  const visibleMembers = isPendingInvite
    ? (context?.members || []).filter((member) => member.role === "owner")
    : context?.members || [];
  return {
    workspace: {
      id: context.workspace.id,
      owner_user_id: context.workspace.owner_user_id,
      name: context.workspace.name,
      seat_limit: getWorkspaceSeatLimitForUser(user),
    },
    membership,
    members: visibleMembers,
    templates: isPendingInvite ? [] : context.templates || [],
    source_links: isPendingInvite ? [] : context.sourceLinks || [],
    invitation_pending: isPendingInvite,
  };
}

function buildShopeeAppLinkUrl(originalUrl) {
  const webUrl = String(originalUrl || "").trim();
  if (!webUrl) return "";
  return `shopeevn://reactPath?navigate_url=${encodeURIComponent(webUrl)}&path=${encodeURIComponent("shopee/TRANSFER_PAGE")}&tab=buy&use_deeplink=1&version=1`;
}

async function promoteAdminIfNeeded(database, user) {
  const isAdmin = user.role === "admin" || isAdminEmail(user.email);
  if (isAdmin && (user.role !== "admin" || user.plan !== "admin")) {
    await database.updateUserRole(user.id, "admin");
    await database.updateUserPlan(user.id, "admin");
    user.role = "admin";
    user.plan = "admin";
  }
  return isAdmin;
}

async function issueAuthSession(req, res, user, isAdmin = false) {
  const database = await getDb();
  if (req.guestSessionId) {
    await database.claimGuestLinks(req.guestSessionId, user.id);
  }
  await database.recordLoginEvent({
    userId: user.id,
    ...buildLoginDeviceContext(req),
  });
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: "30d",
  });
  res.cookie("token", token, {
    httpOnly: true,
    maxAge: 30 * 24 * 3600 * 1000,
    sameSite: "lax",
  });
  res.json({ user: buildAuthUserPayload(user, isAdmin) });
}

function maybeStartTwoFactorChallenge(res, user) {
  const secret = readEnabledTwoFactorSecret(user);
  if (!secret) return false;
  res.status(202).json(buildTwoFactorChallengeResponse(user));
  return true;
}

async function verifyGoogleCredential(credential) {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error("GOOGLE_LOGIN_DISABLED");
  }
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`,
  );
  if (!response.ok) {
    throw new Error("INVALID_GOOGLE_TOKEN");
  }
  const payload = await response.json();
  if (payload.aud !== GOOGLE_CLIENT_ID) {
    throw new Error("INVALID_GOOGLE_AUDIENCE");
  }
  if (payload.email_verified !== "true") {
    throw new Error("GOOGLE_EMAIL_UNVERIFIED");
  }
  return payload;
}

async function verifySupabaseAccessToken(accessToken) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_LOGIN_DISABLED");
  }
  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/user`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
      },
    },
  );
  if (!response.ok) {
    throw new Error("INVALID_SUPABASE_TOKEN");
  }
  return response.json();
}

app.post("/api/auth/register", async (req, res) => {
  try {
    const database = await getDb();
    const { email, password, name } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    if (password.length < 6)
      return res
        .status(400)
        .json({ error: "Mật khẩu phải có ít nhất 6 ký tự" });
    const normalEmail = email.toLowerCase().trim();
    const hashed = await bcrypt.hash(password, 10);
    const isAdmin = isAdminEmail(normalEmail);
    const user = await database.createUser(
      normalEmail,
      hashed,
      name,
      isAdmin ? "admin" : "user",
    );
    if (req.guestSessionId) {
      await database.claimGuestLinks(req.guestSessionId, user.id);
    }
    return issueAuthSession(req, res, user, isAdmin);
  } catch (e) {
    if (e.message === "EMAIL_EXISTS")
      return res.status(400).json({ error: "Email này đã được đăng ký" });
    console.error(e);
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const database = await getDb();
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email và mật khẩu là bắt buộc" });
    const user = await database.getUserByEmail(email.toLowerCase().trim());
    if (!user)
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok)
      return res.status(401).json({ error: "Email hoặc mật khẩu không đúng" });
    const isAdmin = user.role === "admin" || isAdminEmail(user.email);
    if (isAdmin && (user.role !== "admin" || user.plan !== "admin")) {
      await database.updateUserRole(user.id, "admin");
      await database.updateUserPlan(user.id, "admin");
      user.role = "admin";
      user.plan = "admin";
    }
    if (maybeStartTwoFactorChallenge(res, user)) {
      return;
    }
    return issueAuthSession(req, res, user, isAdmin);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.post("/api/auth/google", async (req, res) => {
  try {
    const { credential } = req.body || {};
    if (!credential) {
      return res
        .status(400)
        .json({ error: "Thiếu thông tin đăng nhập Google" });
    }
    const payload = await verifyGoogleCredential(credential);
    const email = (payload.email || "").toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: "Google không trả về email" });
    }

    const database = await getDb();
    let user = await database.getUserByEmail(email);
    const name =
      (payload.name || payload.given_name || email.split("@")[0] || "").trim() ||
      null;
    const isAdmin = isAdminEmail(email);

    if (!user) {
      const tempPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        10,
      );
      user = await database.createUser(
        email,
        tempPassword,
        name,
        isAdmin ? "admin" : "user",
      );
    } else if (!user.name && name) {
      await database.updateUserName(user.id, name);
      user.name = name;
    }

    const effectiveIsAdmin = await promoteAdminIfNeeded(database, user);
    if (maybeStartTwoFactorChallenge(res, user)) {
      return;
    }
    return issueAuthSession(req, res, user, effectiveIsAdmin || isAdmin);
  } catch (e) {
    console.error(e);
    if (e.message === "GOOGLE_LOGIN_DISABLED") {
      return res
        .status(503)
        .json({ error: "Đăng nhập bằng Google chưa được cấu hình" });
    }
    if (
      e.message === "INVALID_GOOGLE_TOKEN" ||
      e.message === "INVALID_GOOGLE_AUDIENCE" ||
      e.message === "GOOGLE_EMAIL_UNVERIFIED"
    ) {
      return res.status(401).json({ error: "Google login không hợp lệ" });
    }
    res.status(500).json({ error: "Lỗi đăng nhập Google: " + e.message });
  }
});

app.post("/api/auth/supabase", async (req, res) => {
  try {
    const { access_token: accessToken } = req.body || {};
    if (!accessToken) {
      return res
        .status(400)
        .json({ error: "Thiếu access token từ Supabase" });
    }

    const supabaseUser = await verifySupabaseAccessToken(accessToken);
    const email = String(supabaseUser.email || "").toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ error: "Supabase không trả về email" });
    }

    const database = await getDb();
    let user = await database.getUserByEmail(email);
    const metadata = supabaseUser.user_metadata || supabaseUser.userMetadata || {};
    const name =
      String(
        metadata.full_name ||
          metadata.name ||
          metadata.username ||
          supabaseUser.display_name ||
          email.split("@")[0] ||
          "",
      ).trim() || null;
    const isAdmin = isAdminEmail(email);

    if (!user) {
      const tempPassword = await bcrypt.hash(
        crypto.randomBytes(32).toString("hex"),
        10,
      );
      user = await database.createUser(
        email,
        tempPassword,
        name,
        isAdmin ? "admin" : "user",
      );
    } else if (!user.name && name) {
      await database.updateUserName(user.id, name);
      user.name = name;
    }

    if (req.guestSessionId) {
      await database.claimGuestLinks(req.guestSessionId, user.id);
    }

    const effectiveIsAdmin = await promoteAdminIfNeeded(database, user);
    if (maybeStartTwoFactorChallenge(res, user)) {
      return;
    }
    return issueAuthSession(req, res, user, effectiveIsAdmin || isAdmin);
  } catch (e) {
    if (e.message === "SUPABASE_LOGIN_DISABLED") {
      return res
        .status(503)
        .json({ error: "Supabase chưa được cấu hình trên máy chủ" });
    }
    if (e.message === "INVALID_SUPABASE_TOKEN") {
      return res.status(401).json({ error: "Đăng nhập Supabase không hợp lệ" });
    }
    console.error(e);
    res.status(500).json({ error: "Lỗi đăng nhập Supabase: " + e.message });
  }
});

app.post("/api/auth/logout", (_, res) => {
  res.clearCookie("token");
  res.json({ ok: true });
});

app.get("/api/auth/me", async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.json({ user: null });
  res.json({ user: buildAuthUserPayload(user, user.role === "admin" || isAdminEmail(user.email)) });
});

app.patch("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const name = String(req.body?.name || "").trim().slice(0, 80);
    const phoneInput = String(req.body?.phone || "").trim();
    const avatarInput = String(req.body?.avatar_url || "").trim();
    const phone = phoneInput ? normalizePhoneInput(phoneInput) : null;
    const avatarUrl = avatarInput ? normalizeAvatarUrlInput(avatarInput) : null;
    if (phoneInput && !phone) {
      return res.status(400).json({ error: "Số điện thoại chưa đúng định dạng" });
    }
    if (avatarInput && !avatarUrl) {
      return res.status(400).json({ error: "Avatar phải là URL hợp lệ hoặc ảnh đã upload" });
    }
    await database.updateUserProfile(user.id, {
      name: name || null,
      phone,
      avatar_url: avatarUrl,
    });
    const updated = await database.getUserById(user.id);
    if (updated.email.toLowerCase() === ADMIN_EMAIL || updated.role === "admin") {
      updated.plan = "admin";
      updated.role = "admin";
    }
    res.json({ user: buildAuthUserPayload(updated, updated.role === "admin" || isAdminEmail(updated.email)) });
  } catch (e) {
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.get("/api/auth/login-events", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const events = await database.listLoginEvents(user.id, Number(req.query?.limit || 20));
    res.json({ events });
  } catch (e) {
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.post("/api/auth/2fa/setup", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const secret = generateTwoFactorSecret();
    await database.updateUserTwoFactor(user.id, {
      two_factor_pending_secret: encryptSensitiveValue(secret),
    });
    res.json({
      setup: {
        secret,
        manual_entry_key: secret.match(/.{1,4}/g)?.join(" ") || secret,
        otpauth_url: buildTwoFactorProvisioningUri(user, secret),
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Không thể khởi tạo 2FA: " + e.message });
  }
});

app.post("/api/auth/2fa/enable", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const pendingSecret = readPendingTwoFactorSecret(user);
    if (!pendingSecret) {
      return res.status(400).json({ error: "Chưa có phiên thiết lập 2FA nào đang mở" });
    }
    if (!verifyTotpCode(pendingSecret, req.body?.code)) {
      return res.status(400).json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
    }
    const database = await getDb();
    await database.updateUserTwoFactor(user.id, {
      two_factor_enabled: true,
      two_factor_secret: encryptSensitiveValue(pendingSecret),
      two_factor_pending_secret: null,
      two_factor_enabled_at: new Date().toISOString(),
    });
    const updated = await database.getUserById(user.id);
    res.json({
      ok: true,
      user: buildAuthUserPayload(updated, updated.role === "admin" || isAdminEmail(updated.email)),
    });
  } catch (e) {
    res.status(500).json({ error: "Không thể bật 2FA: " + e.message });
  }
});

app.post("/api/auth/2fa/disable", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const secret = readEnabledTwoFactorSecret(user);
    if (!secret) {
      return res.status(400).json({ error: "Tài khoản chưa bật 2FA" });
    }
    if (!verifyTotpCode(secret, req.body?.code)) {
      return res.status(400).json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
    }
    const database = await getDb();
    await database.updateUserTwoFactor(user.id, {
      two_factor_enabled: false,
      two_factor_secret: null,
      two_factor_pending_secret: null,
      two_factor_enabled_at: null,
    });
    const updated = await database.getUserById(user.id);
    res.json({
      ok: true,
      user: buildAuthUserPayload(updated, updated.role === "admin" || isAdminEmail(updated.email)),
    });
  } catch (e) {
    res.status(500).json({ error: "Không thể tắt 2FA: " + e.message });
  }
});

app.post("/api/auth/2fa/login", async (req, res) => {
  try {
    const payload = parseTwoFactorChallengeToken(req.body?.challenge_token);
    const database = await getDb();
    const user = await database.getUserById(payload.userId);
    if (!user) {
      return res.status(401).json({ error: "Phiên xác minh đã hết hạn" });
    }
    if (user.role === "admin" || isAdminEmail(user.email)) {
      user.plan = "admin";
      user.role = "admin";
    }
    const secret = readEnabledTwoFactorSecret(user);
    if (!secret) {
      return res.status(400).json({ error: "Tài khoản chưa bật 2FA" });
    }
    if (!verifyTotpCode(secret, req.body?.code)) {
      return res.status(400).json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
    }
    const isAdmin = user.role === "admin" || isAdminEmail(user.email);
    return issueAuthSession(req, res, user, isAdmin);
  } catch (e) {
    if (e.message === "INVALID_TWO_FACTOR_CHALLENGE" || /jwt/i.test(e.message || "")) {
      return res.status(401).json({ error: "Phiên xác minh 2FA không còn hợp lệ" });
    }
    res.status(500).json({ error: "Không thể hoàn tất đăng nhập 2FA: " + e.message });
  }
});

app.get("/api/billing/config", requireAuth, async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
  const database = await getDb();
  const requests = await database.listPaymentRequestsByUser(user.id, 5);
  res.json({
    config: getPaymentConfig(),
    requests,
  });
});

app.post("/api/billing/requests", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const planMeta = getBillingPlanMeta(req.body?.plan);
    if (!planMeta) {
      return res.status(400).json({ error: "Gói thanh toán không hợp lệ" });
    }
    const database = await getDb();
    const referenceCode = `PAY${Date.now().toString(36).toUpperCase()}${nanoid(4).toUpperCase()}`;
    const transferNote = buildPaymentTransferNote(user, planMeta.code, referenceCode);
    const request = await database.createPaymentRequest({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name || null,
      plan: planMeta.code,
      amount: planMeta.amount,
      status: "awaiting_payment",
      reference_code: referenceCode,
      transfer_note: transferNote,
      payer_note: String(req.body?.payer_note || "").trim().slice(0, 240) || null,
    });
    res.status(201).json({
      request,
      config: getPaymentConfig(),
    });
  } catch (e) {
    res.status(500).json({ error: "Không thể tạo yêu cầu thanh toán: " + e.message });
  }
});

app.patch("/api/billing/requests/:id/submit", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const requestId = Number(req.params.id);
    const database = await getDb();
    const request = await database.getPaymentRequestById(requestId);
    if (!request || Number(request.user_id) !== Number(user.id)) {
      return res.status(404).json({ error: "Không tìm thấy yêu cầu thanh toán" });
    }
    const updated = await database.updatePaymentRequest(requestId, {
      status: "submitted",
      payer_note: String(req.body?.payer_note || request.payer_note || "").trim().slice(0, 240) || null,
      submitted_at: new Date().toISOString(),
    });
    res.json({ request: updated });
  } catch (e) {
    res.status(500).json({ error: "Không thể gửi xác nhận thanh toán: " + e.message });
  }
});

app.get("/api/team/workspace", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    res.json(buildTeamWorkspacePayload(context, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể tải workspace: " + e.message });
  }
});

app.post("/api/team/members", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (!canManageWorkspaceMembers(context.membership, context.workspace, user)) {
      return res.status(403).json({ error: "Chỉ owner mới có thể mời thành viên" });
    }
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Email mời không hợp lệ" });
    }
    const role = normalizeWorkspaceRole(req.body?.role);
    const members = await database.listWorkspaceMembers(context.workspace.id);
    if (members.length >= getWorkspaceSeatLimitForUser(user)) {
      return res.status(403).json({
        error: "Workspace đã chạm giới hạn seat của gói hiện tại",
        upgrade: true,
      });
    }
    const existing = await database.getWorkspaceMemberByWorkspaceAndEmail(context.workspace.id, email);
    if (existing) {
      return res.status(400).json({ error: "Email này đã có trong workspace" });
    }
    const invitedUser = await database.getUserByEmail(email);
    await database.upsertWorkspaceMember(context.workspace.id, {
      user_id: invitedUser?.id || null,
      email,
      display_name: invitedUser?.name || email.split("@")[0],
      role,
      status: "pending",
      invited_by: user.id,
      joined_at: null,
    });
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể mời thành viên: " + e.message });
  }
});

app.patch("/api/team/members/:id", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (!canManageWorkspaceMembers(context.membership, context.workspace, user)) {
      return res.status(403).json({ error: "Chỉ owner mới có thể cập nhật thành viên" });
    }
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member || Number(member.workspace_id) !== Number(context.workspace.id)) {
      return res.status(404).json({ error: "Không tìm thấy thành viên" });
    }
    if (normalizeWorkspaceRole(member.role) === "owner") {
      return res.status(400).json({ error: "Không thể đổi trạng thái owner" });
    }
    const requestedStatus = normalizeWorkspaceStatus(req.body?.status);
    if (normalizeWorkspaceStatus(member.status) === "pending" && requestedStatus !== "pending") {
      return res.status(400).json({
        error: "Lời mời đang chờ user xác nhận, owner không thể tự kích hoạt",
      });
    }
    await database.updateWorkspaceMember(memberId, {
      status: requestedStatus,
      joined_at: requestedStatus === "active"
        ? member.joined_at || new Date().toISOString()
        : member.joined_at,
    });
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể cập nhật thành viên: " + e.message });
  }
});

app.delete("/api/team/members/:id", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (!canManageWorkspaceMembers(context.membership, context.workspace, user)) {
      return res.status(403).json({ error: "Chỉ owner mới có thể gỡ thành viên" });
    }
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member || Number(member.workspace_id) !== Number(context.workspace.id)) {
      return res.status(404).json({ error: "Không tìm thấy thành viên" });
    }
    if (normalizeWorkspaceRole(member.role) === "owner") {
      return res.status(400).json({ error: "Không thể gỡ owner khỏi workspace" });
    }
    await database.deleteWorkspaceMember(memberId);
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể gỡ thành viên: " + e.message });
  }
});

app.post("/api/team/templates", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (!canManageWorkspaceTemplates(context.membership)) {
      return res.status(403).json({ error: "Vai trò hiện tại không thể tạo mẫu chung" });
    }
    const sourceLinkId = Number(req.body?.source_link_id);
    if (!Number.isInteger(sourceLinkId) || sourceLinkId < 1) {
      return res.status(400).json({ error: "Thiếu link nguồn để tạo mẫu" });
    }
    const sourceLink = await database.getLinkById(sourceLinkId);
    if (!sourceLink) return res.status(404).json({ error: "Không tìm thấy link nguồn" });
    const canUseSourceLink =
      Number(sourceLink.user_id || 0) === Number(user.id) ||
      (sourceLink.workspace_id && Number(sourceLink.workspace_id) === Number(context.workspace.id));
    if (!canUseSourceLink) {
      return res.status(403).json({ error: "Bạn không có quyền dùng link này làm mẫu" });
    }
    const templateName = formatWorkspaceDisplayName(
      req.body?.name || sourceLink.og_title || sourceLink.alias || sourceLink.short_code || "Template",
      "Template",
    );
    await database.createWorkspaceTemplate({
      workspace_id: context.workspace.id,
      created_by_user_id: user.id,
      source_link_id: sourceLink.id,
      name: templateName,
      og_title: sourceLink.og_title || null,
      og_desc: sourceLink.og_desc || null,
      og_image: sourceLink.og_image || null,
      link_type: sourceLink.link_type || "direct",
      video_url: sourceLink.video_url || null,
      video_overlay_text: sourceLink.video_overlay_text || null,
      domain_hostname: sourceLink.domain_hostname || null,
    });
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể tạo mẫu chung: " + e.message });
  }
});

app.post("/api/team/invitations/:id/accept", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member) return res.status(404).json({ error: "Không tìm thấy lời mời" });
    const normalizedEmail = String(user.email || "").trim().toLowerCase();
    const canAccept =
      (member.user_id && Number(member.user_id) === Number(user.id)) ||
      (normalizedEmail && String(member.email || "").trim().toLowerCase() === normalizedEmail);
    if (!canAccept) {
      return res.status(403).json({ error: "Bạn không thể xác nhận lời mời này" });
    }
    if (normalizeWorkspaceStatus(member.status) !== "pending") {
      return res.status(400).json({ error: "Lời mời này không còn ở trạng thái chờ" });
    }
    await database.updateWorkspaceMember(memberId, {
      user_id: user.id,
      display_name: user.name || member.display_name || normalizedEmail.split("@")[0] || "Member",
      status: "active",
      joined_at: member.joined_at || new Date().toISOString(),
    });
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    res.json(buildTeamWorkspacePayload(context, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể chấp nhận lời mời: " + e.message });
  }
});

app.post("/api/team/invitations/:id/decline", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member) return res.status(404).json({ error: "Không tìm thấy lời mời" });
    const normalizedEmail = String(user.email || "").trim().toLowerCase();
    const canDecline =
      (member.user_id && Number(member.user_id) === Number(user.id)) ||
      (normalizedEmail && String(member.email || "").trim().toLowerCase() === normalizedEmail);
    if (!canDecline) {
      return res.status(403).json({ error: "Bạn không thể từ chối lời mời này" });
    }
    if (normalizeWorkspaceStatus(member.status) !== "pending") {
      return res.status(400).json({ error: "Lời mời này không còn ở trạng thái chờ" });
    }
    await database.deleteWorkspaceMember(memberId);
    const context = await resolveWorkspaceContext(database, user);
    if (!context) return res.status(404).json({ error: "Không tìm thấy workspace" });
    res.json(buildTeamWorkspacePayload(context, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể từ chối lời mời: " + e.message });
  }
});

app.get("/api/bio/me", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const existing = await database.getBioProfileByUserId(user.id);
    const parsedSource = parseBioLinkSource(existing?.link_source);
    const fallbackSlug = normalizeBioSlug(
      existing?.slug ||
        user.name ||
        user.email?.split("@")[0] ||
        `user-${user.id}`,
      `user-${user.id}`,
    );
    const profile = existing
      ? {
          ...existing,
          link_source: parsedSource.mode,
          link_order: parsedSource.order,
        }
      : {
          user_id: user.id,
          slug: fallbackSlug,
          title: user.name || "",
          subtitle: "Link-in-bio page được tạo từ BocLink.click.",
          avatar: (user.name || "D").charAt(0).toUpperCase(),
          accent: "#3b82f6",
          link_count: 5,
          link_source: "recent",
          link_order: [],
          is_published: true,
        };
    res.json({ profile });
  } catch (e) {
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.patch("/api/bio/me", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const rawSlug = normalizeBioSlug(req.body?.slug, user.email?.split("@")[0] || `user-${user.id}`);
    if (!rawSlug)
      return res.status(400).json({ error: "Slug không hợp lệ" });
    const taken = await database.getBioProfileBySlug(rawSlug);
    if (taken && taken.user_id !== user.id)
      return res.status(400).json({ error: "Slug này đã được dùng" });
    const linkOrder = normalizeBioLinkOrder(req.body?.link_order);
    const profile = await database.upsertBioProfile(user.id, {
      slug: rawSlug,
      title: String(req.body?.title || "").trim().slice(0, 120),
      subtitle: String(req.body?.subtitle || "").trim().slice(0, 220),
      avatar: String(req.body?.avatar || "").trim().slice(0, 220),
      accent: String(req.body?.accent || "#3b82f6").trim(),
      link_count: Number(req.body?.link_count || 5),
      link_source: serializeBioLinkSource(
        String(req.body?.link_source || "recent").trim(),
        linkOrder,
      ),
      link_order: linkOrder,
      is_published: req.body?.is_published !== false,
    });
    const parsedSource = parseBioLinkSource(profile.link_source);
    res.json({
      profile: {
        ...profile,
        link_source: parsedSource.mode,
        link_order: parsedSource.order,
      },
    });
  } catch (e) {
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.post(
  "/api/upload-image",
  requireAuth,
  upload.single("image"),
  async (req, res) => {
    const user = await resolveUser(req);
    const plan = user?.plan || "free";
    const uploadScope = String(req.query?.scope || "").trim().toLowerCase();
    const isAvatarUpload = uploadScope === "avatar";
    if (!isAvatarUpload && !PLANS[plan]?.upload)
      return res
        .status(403)
        .json({ error: "Tính năng này yêu cầu gói Pro", upgrade: true });
    if (!req.file)
      return res
        .status(400)
        .json({ error: "Không có file hoặc định dạng không hợp lệ" });
    try {
      if (CLOUDINARY_OK && req.file.buffer) {
        const result = await uploadToCloudinary(
          req.file.buffer,
          req.file.originalname,
          "image",
        );
        return res.json({
          url: result.secure_url,
          public_id: result.public_id,
          source: "cloudinary",
        });
      } else {
        return res.json({
          url: `/uploads/${req.file.filename}`,
          source: "local",
        });
      }
    } catch (e) {
      console.error("[upload-image]", e.message);
      return res.status(500).json({ error: "Upload thất bại: " + e.message });
    }
  },
);

async function handleAdminInit(req, res) {
  const user = await resolveUser(req);
  if (!user || !isAdminEmail(user.email)) {
    return res
      .status(403)
      .json({ error: "Không có quyền – cần đăng nhập bằng admin email trước" });
  }
  const database = await getDb();
  await database.updateUserRole(user.id, "admin");
  await database.updateUserPlan(user.id, "admin");
  res.json({
    ok: true,
    message: `✅ User ${user.email} đã được set role=admin, plan=admin`,
  });
}
app.get("/api/admin/init", handleAdminInit);
app.post("/api/admin/init", handleAdminInit);

async function checkAdmin(req, res) {
  const user = await resolveUser(req);
  if (!user || (user.role !== "admin" && !isAdminEmail(user.email))) {
    res.status(403).json({ error: "Không có quyền truy cập" });
    return null;
  }
  if (isAdminEmail(user.email) && user.role !== "admin") {
    const database = await getDb();
    await database.updateUserRole(user.id, "admin");
    await database.updateUserPlan(user.id, "admin");
  }
  return user;
}

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const users = await database.getAllUsers();
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/payments", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const requests = await database.listPaymentRequests(300);
    res.json({ requests, config: getPaymentConfig() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/admin/payments/:id", requireAdmin, async (req, res) => {
  const adminUser = await checkAdmin(req, res);
  if (!adminUser) return;
  try {
    const database = await getDb();
    const requestId = Number(req.params.id);
    const action = String(req.body?.status || "").trim().toLowerCase();
    const paymentRequest = await database.getPaymentRequestById(requestId);
    if (!paymentRequest) {
      return res.status(404).json({ error: "Không tìm thấy yêu cầu thanh toán" });
    }
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "Trạng thái duyệt không hợp lệ" });
    }
    const patch = {
      status: action,
      admin_note: String(req.body?.admin_note || "").trim().slice(0, 240) || null,
      reviewed_by: adminUser.id,
      reviewed_at: new Date().toISOString(),
    };
    const updated = await database.updatePaymentRequest(requestId, patch);
    if (action === "approved") {
      const planMeta = getBillingPlanMeta(updated.plan);
      if (planMeta) {
        await database.updateUserPlan(updated.user_id, planMeta.code);
      }
    }
    const requests = await database.listPaymentRequests(300);
    res.json({ request: updated, requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const { plan, role } = req.body;
    const uid = Number(req.params.id);
    if (plan) await database.updateUserPlan(uid, plan);
    if (role) await database.updateUserRole(uid, role);
    const updated = await database.getUserById(uid);
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        plan: updated.plan,
        role: updated.role,
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/users/bulk-delete", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const userIds = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    if (!userIds.length) {
      return res.status(400).json({ error: "Chưa chọn người dùng nào để xóa" });
    }
    await database.deleteUsers(userIds);
    res.json({ ok: true, deleted_count: userIds.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const uid = Number(req.params.id);
    await database.deleteUser(uid);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/links", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const links = (await database.getAllLinks()).map((l) => ({
      ...l,
      short_url: buildLinkShortUrl(l, publicBaseUrl),
    }));
    res.json({ links });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/links/:id", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    await database.deleteLink(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const totals = await database.getAdminTotals();
    const domains = await database.getDomains();
    res.json({
      ...totals,
      alerts: buildAdminAlertPayload(domains),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/domains", async (_req, res) => {
  try {
    const database = await getDb();
    const domains = await database.getActiveDomains();
    res.json({
      domains,
      primary:
        domains.find((domain) => domain.is_primary) ||
        domains[0] ||
        null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/redirects", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const requestedLimit = Number.parseInt(String(req.query.limit || "20"), 10);
    const limit = Math.min(Math.max(requestedLimit || 20, 1), 500);
    const events = await readRecentRedirectLogEntries(limit);
    res.json({
      events,
      limit,
      file: "logs/redirect.log",
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/domains", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const domains = await database.getDomains();
    res.json({ domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/domains", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const hostname = normalizeDomainHost(req.body?.hostname);
    const label = String(req.body?.label || "").trim().slice(0, 80);
    const isPrimary = req.body?.is_primary === true || req.body?.is_primary === "true";
    const verificationStatus =
      normalizeDomainVerificationStatus(req.body?.verification_status) || "verified";
    const expiresAt = normalizeExpiryDateInput(req.body?.expires_at);
    if (!hostname)
      return res.status(400).json({ error: "Domain không hợp lệ" });
    const existing = (await database.getDomains()).find((d) => d.hostname === hostname);
    if (existing)
      return res.status(400).json({ error: "Domain này đã tồn tại" });
    const domain = await database.addDomain({
      hostname,
      label,
      isPrimary,
      verificationStatus,
      expiresAt,
    });
    if (domain.is_primary) {
      await database.setPrimaryDomain(domain.id);
    } else {
      const primary = await database.getPrimaryDomain();
      if (!primary) await database.setPrimaryDomain(domain.id);
    }
    const domains = await database.getDomains();
    res.json({ domain, domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/admin/domains/:id", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const domainId = Number(req.params.id);
    const updates = {};
    if (typeof req.body?.label === "string") {
      updates.label = req.body.label.trim().slice(0, 80) || null;
    }
    if (typeof req.body?.is_active === "boolean") {
      updates.is_active = req.body.is_active;
    }
    if (req.body?.hostname) {
      const hostname = normalizeDomainHost(req.body.hostname);
      if (!hostname) return res.status(400).json({ error: "Domain không hợp lệ" });
      updates.hostname = hostname;
    }
    if (typeof req.body?.verification_status !== "undefined") {
      const verificationStatus = normalizeDomainVerificationStatus(req.body.verification_status);
      if (!verificationStatus) {
        return res.status(400).json({ error: "Trang thai verify khong hop le" });
      }
      updates.verification_status = verificationStatus;
    }
    if (typeof req.body?.expires_at !== "undefined") {
      const expiresAt = normalizeExpiryDateInput(req.body.expires_at);
      if (String(req.body.expires_at || "").trim() && !expiresAt) {
        return res.status(400).json({ error: "Ngay het han khong hop le" });
      }
      updates.expires_at = expiresAt;
    }
    const makePrimary = req.body?.is_primary === true || req.body?.is_primary === "true";
    if (makePrimary) {
      const domain = await database.setPrimaryDomain(domainId);
      if (!domain) return res.status(404).json({ error: "Không tìm thấy domain" });
      if (updates.label || updates.hostname || typeof updates.is_active === "boolean") {
        await database.updateDomain(domainId, updates);
      }
    } else if (Object.keys(updates).length) {
      const domain = await database.updateDomain(domainId, updates);
      if (!domain) return res.status(404).json({ error: "Không tìm thấy domain" });
    }
    const domains = await database.getDomains();
    res.json({ domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/admin/domains/:id", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    await database.deleteDomain(Number(req.params.id));
    const domains = await database.getDomains();
    res.json({ ok: true, domains });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/shorten", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const user = await resolveUser(req);
    const guestSessionId = user ? null : req.guestSessionId;
    let {
      url,
      alias,
      og_title,
      og_desc,
      og_image,
      domain_hostname,
      link_type,
      video_url,
      video_overlay_text,
      team_template_id,
    } = req.body;

    alias = sanitizeAliasInput(alias, 40);
    og_title = normalizeShareTitleInput(og_title, 120);

    if (!url) return res.status(400).json({ error: "URL không hợp lệ" });
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;
    try {
      new URL(url);
    } catch {
      try {
        url = decodeURIComponent(url);
        new URL(url);
      } catch {
        return res.status(400).json({ error: "URL không hợp lệ" });
      }
    }

    const isAffiliateUrl = isAffiliateShortenUrl(url);
    const userId = user?.id || null;
    const plan = user?.plan || "free";
    const isAdminPlan = plan === "admin" || user?.role === "admin";
    const hasAffiliateAccess =
      plan === "pro" || plan === "business" || isAdminPlan;
    let selectedWorkspaceId = null;
    let selectedTemplateId = null;
    if (isAffiliateUrl && !user) {
      return res.status(401).json({
        error: "Link affiliate cần đăng nhập hoặc đăng ký để rút gọn",
        authRequired: true,
      });
    }
    if (isAffiliateUrl && user && !hasAffiliateAccess) {
      return res.status(403).json({
        error: "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn",
        upgrade: true,
        affiliateUpgradeRequired: true,
        affiliateUrl: true,
      });
    }
    const planCfg = PLANS[plan] || PLANS.free;

    if (planCfg.dailyLimit > 0) {
      const todayCount = await database.countTodayLinks(userId, guestSessionId);
      if (todayCount >= planCfg.dailyLimit)
        return res
          .status(403)
          .json({
            error: `Đã đạt giới hạn ${planCfg.dailyLimit} link/ngày. Vui lòng nâng cấp.`,
            upgrade: true,
          });
    }

    if (!isAffiliateUrl && !planCfg.deeplink && /shopee\.vn|tiktok\.com/i.test(url))
      return res
        .status(403)
        .json({
          error: "Deeplink Shopee & TikTok yêu cầu gói Pro trở lên",
          upgrade: true,
        });

    link_type = link_type || "direct";
    if (link_type === "video" && !planCfg.videoLink)
      return res
        .status(403)
        .json({ error: "Link Video yêu cầu gói Pro trở lên", upgrade: true });

    if (!planCfg.ogMeta) {
      og_title = null;
      og_desc = null;
      og_image = null;
    }

    const normalizedTemplateId = Number(team_template_id);
    if (user && Number.isInteger(normalizedTemplateId) && normalizedTemplateId > 0) {
      const workspaceContext = await resolveWorkspaceContext(database, user, {
        ensureOwnerWorkspace: false,
      });
      if (!workspaceContext) {
        return res.status(403).json({ error: "Bạn chưa thuộc workspace nào để dùng mẫu chung" });
      }
      const template = await database.getWorkspaceTemplateById(normalizedTemplateId);
      if (!template || Number(template.workspace_id) !== Number(workspaceContext.workspace.id)) {
        return res.status(404).json({ error: "Không tìm thấy mẫu chung hoặc bạn không có quyền dùng mẫu này" });
      }
      if (workspaceContext.membership.status !== "active") {
        return res.status(403).json({ error: "Chỉ thành viên đang hoạt động mới có thể lấy link từ mẫu chung" });
      }
      selectedWorkspaceId = template.workspace_id;
      selectedTemplateId = template.id;
      og_title = normalizeShareTitleInput(template.og_title, 120);
      og_desc = template.og_desc || null;
      og_image = template.og_image || null;
      link_type = template.link_type || "direct";
      video_url = template.video_url || null;
      video_overlay_text = template.video_overlay_text || null;
      domain_hostname = template.domain_hostname || null;
    }

    if (alias) {
      if (alias.length < 2)
        return res.status(400).json({ error: "Alias phải có ít nhất 2 ký tự" });
      const taken =
        (await database.getLinkByAlias(alias)) ||
        (await database.getLinkByCode(alias));
      if (taken) return res.status(400).json({ error: "Alias đã được dùng" });
    } else {
      alias = null;
    }

    if (og_image) {
      try {
        new URL(og_image);
      } catch {
        og_image = null;
      }
    }
    if (video_url) {
      try {
        new URL(video_url);
      } catch {
        video_url = null;
      }
    }

    let selectedDomainHostname = null;
    if (domain_hostname) {
      selectedDomainHostname = normalizeDomainHost(domain_hostname);
      if (!selectedDomainHostname)
        return res.status(400).json({ error: "Domain tạo link không hợp lệ" });
      const activeDomains = await database.getActiveDomains();
      const matchedDomain = activeDomains.find(
        (domain) => domain.hostname === selectedDomainHostname,
      );
      if (!matchedDomain) {
        return res.status(400).json({ error: "Domain tạo link không còn hoạt động" });
      }
      selectedDomainHostname = matchedDomain.hostname;
    }

    const shortCode = nanoid(7);
    await database.createLink(
      shortCode,
      url,
      alias,
      og_title,
      og_desc,
      og_image,
      userId,
      link_type,
      video_url || null,
      video_overlay_text || null,
      guestSessionId,
      selectedDomainHostname,
      {
        workspace_id: selectedWorkspaceId,
        template_id: selectedTemplateId,
        created_from_template: !!selectedTemplateId,
      },
    );
    const code = alias || shortCode;
    const shortBaseUrl = selectedDomainHostname
      ? `https://${selectedDomainHostname}`
      : publicBaseUrl;
    return res.json({
      short_url: buildShortUrl(shortBaseUrl, code),
      short_code: code,
      original_url: url,
      clicks: 0,
      link_type,
      domain_hostname: selectedDomainHostname,
      template_id: selectedTemplateId,
      workspace_id: selectedWorkspaceId,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.get("/api/links/:id", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const user = await resolveUser(req);
    const guestSessionId = user ? null : req.guestSessionId;
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error: "Không tìm thấy link" });
    const isAdmin = user?.role === "admin" || isAdminEmail(user?.email);
    const isGuestOwner =
      !!guestSessionId &&
      !link.user_id &&
      link.guest_session_id === guestSessionId;
    if (!isAdmin && !isGuestOwner && link.user_id && link.user_id !== user?.id)
      return res.status(403).json({ error: "Không có quyền" });
    res.json({
      link: {
        ...link,
        short_url: buildLinkShortUrl(link, publicBaseUrl),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.patch("/api/links/:id", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const user = await resolveUser(req);
    const guestSessionId = user ? null : req.guestSessionId;
    if (!user && !guestSessionId)
      return res.status(401).json({ error: "Chưa đăng nhập" });
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error: "Không tìm thấy link" });
    const isAdmin = user?.role === "admin" || isAdminEmail(user?.email);
    const isGuestOwner =
      !!guestSessionId &&
      !link.user_id &&
      link.guest_session_id === guestSessionId;
    if (!isAdmin && !isGuestOwner && link.user_id !== user?.id)
      return res
        .status(403)
        .json({ error: "Không có quyền chỉnh sửa link này" });
    const {
      og_title,
      og_desc,
      og_image,
      domain_hostname,
      link_type,
      video_url,
      video_overlay_text,
    } = req.body;
    const updateFields = {
      og_title: normalizeShareTitleInput(og_title, 120),
      og_desc,
      og_image,
      link_type,
      video_url,
      video_overlay_text,
    };
    if (typeof domain_hostname !== "undefined") {
      let nextDomainHostname = null;
      if (String(domain_hostname || "").trim()) {
        nextDomainHostname = normalizeDomainHost(domain_hostname);
        if (!nextDomainHostname)
          return res.status(400).json({ error: "Domain tạo link không hợp lệ" });
        const activeDomains = await database.getActiveDomains();
        const matchedDomain = activeDomains.find(
          (domain) => domain.hostname === nextDomainHostname,
        );
        if (!matchedDomain) {
          return res.status(400).json({ error: "Domain tạo link không còn hoạt động" });
        }
        nextDomainHostname = matchedDomain.hostname;
      }
      updateFields.domain_hostname = nextDomainHostname;
    }
    await database.updateLink(Number(req.params.id), updateFields);
    const updated = await database.getLinkById(Number(req.params.id));
    res.json({
      link: {
        ...updated,
        short_url: buildLinkShortUrl(updated, publicBaseUrl),
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/extract-thumb", requireAuth, async (req, res) => {
  const { video_url } = req.body;
  if (!video_url) return res.status(400).json({ error: "Thiếu video_url" });
  const ytMatch = video_url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  if (ytMatch) {
    return res.json({
      thumb: `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`,
      source: "youtube",
    });
  }
  res.json({ thumb: null, source: "local" });
});

app.get("/api/stats", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const user = await resolveUser(req);
    const userId = user?.id || null;
    const guestSessionId = user ? null : req.guestSessionId;
    const totals = await database.getTotals(userId, guestSessionId);
    const today = await database.getTodayStats(userId, guestSessionId);
    const clickRows = await database.getClickAnalytics(userId, guestSessionId);
    const analytics = buildStatsAnalytics(clickRows);
    const latestLoginEvent = user ? await database.getLatestLoginEvent(user.id) : null;
    const workspaceContext = user
      ? await resolveWorkspaceContext(database, user, { ensureOwnerWorkspace: false })
      : null;
    const alerts = buildStatsAlertPayload({
      planName: user?.plan || "guest",
      linksToday: today.linksToday || 0,
      hasAccount: !!user,
      clickRows,
      latestLoginEvent,
    });
    const workspaceInviteAlert = buildWorkspaceInvitationAlert(workspaceContext);
    if (workspaceInviteAlert) {
      alerts.active = Array.isArray(alerts.active) ? alerts.active : [];
      alerts.active.push(workspaceInviteAlert);
    }
    const recent = (await database.getRecentLinks(userId, guestSessionId)).map(
      (l) => ({
        ...l,
        short_url: buildLinkShortUrl(l, publicBaseUrl),
      }),
    );
    res.json({
      ...totals,
      ...today,
      recent,
      analytics,
      alerts,
      plan: user?.plan || "guest",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/links/:id", async (req, res) => {
  const user = await resolveUser(req);
  const guestSessionId = user ? null : req.guestSessionId;
  if (!user && !guestSessionId)
    return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const database = await getDb();
    const link = await database.getLinkById(Number(req.params.id));
    if (!link) return res.status(404).json({ error: "Không tìm thấy link" });
    const isAdmin = user?.role === "admin" || isAdminEmail(user?.email);
    const isGuestOwner =
      !!guestSessionId &&
      !link.user_id &&
      link.guest_session_id === guestSessionId;
    if (!isAdmin && !isGuestOwner && link.user_id !== user?.id)
      return res.status(403).json({ error: "Không có quyền xóa link này" });
    await database.deleteLink(Number(req.params.id));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── REDIRECT ─────────────────────────────────────────────────────────────────

app.get("/go/:code", async (req, res) => {
  const { code } = req.params;
  if (code.includes(".") || /^(api|uploads|admin)/.test(code))
    return res.status(404).send("Not found");

  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const link =
      (await database.getLinkByAlias(code)) ||
      (await database.getLinkByCode(code));
    if (!link)
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));

    const ua = req.headers["user-agent"] || "";
    const referer = req.headers["referer"] || "";
    const platform = getMobilePlatform(ua);
    const codeValue = link.alias || link.short_code;
    const uaKind = getRedirectUaKind(ua);
    const linkType = (link.link_type || "direct").trim();
    const info = detectPlatformDeep(link.original_url, platform);
    const isFacebookInApp = isFacebookInAppBrowser(ua);

    // Route này chỉ dùng khi người xem bấm overlay video, nên không recordClick
    // để tránh double-count so với lần mở short link ban đầu.

    if (
      platform !== "desktop" &&
      info.platform_name === "shopee" &&
      isFacebookInApp
    ) {
      setRedirectDebugHeaders(res, {
        mode: "video-launch-shopee-facebook-bridge",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "video-launch-shopee-facebook-bridge",
        platform: info.platform_name,
        uaKind,
        status: 200,
        target: info.fallback || link.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
        "Content-Type": "text/html;charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      });
      return res.send(buildShopeeFacebookBridgePage(link, publicBaseUrl, info));
    }

    if (platform === "desktop") {
      setRedirectDebugHeaders(res, {
        mode: "video-launch-desktop-redirect",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "video-launch-desktop-redirect",
        platform: info.platform_name,
        uaKind,
        status: 302,
        target: link.original_url,
        referer,
      });
      return res.redirect(302, link.original_url);
    }

    if (info.platform_name === "shopee") {
      const shopeeTarget = info.deeplink || link.original_url;
      setRedirectDebugHeaders(res, {
        mode: "video-launch-shopee-direct-redirect",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "video-launch-shopee-direct-redirect",
        platform: info.platform_name,
        uaKind,
        status: 301,
        target: shopeeTarget,
        referer,
      });
      return res.redirect(301, shopeeTarget);
    }

    if (info.deeplink || linkType === "deeplink") {
      const shortUrl = buildLinkShortUrl(link, publicBaseUrl);
      setRedirectDebugHeaders(res, {
        mode: "video-launch-deeplink-bridge",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "video-launch-deeplink-bridge",
        platform: info.platform_name,
        uaKind,
        status: 200,
        target: info.deeplink || link.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
      });
      return res.send(buildDirectBridgePage(link, shortUrl, info));
    }

    setRedirectDebugHeaders(res, {
      mode: "video-launch-mobile-direct",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: link.id,
      code: codeValue,
      mode: "video-launch-mobile-direct",
      platform: info.platform_name,
      uaKind,
      status: 302,
      target: link.original_url,
      referer,
    });
    return res.redirect(302, link.original_url);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

app.get("/:code", async (req, res) => {
  const { code } = req.params;
  if (code.includes(".") || /^(api|uploads|admin)/.test(code))
    return res.status(404).send("Not found");

  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const link =
      (await database.getLinkByAlias(code)) ||
      (await database.getLinkByCode(code));
    if (!link)
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));

    const ua = req.headers["user-agent"] || "";
    const referer = req.headers["referer"] || "";
    const platform = getMobilePlatform(ua);
    const codeValue = link.alias || link.short_code;
    const uaKind = getRedirectUaKind(ua);

    // ── FIX 3: Social bot → trả OG page KHÔNG redirect, KHÔNG count click ──
    if (isSocialBot(ua)) {
      setRedirectDebugHeaders(res, {
        mode: "social-bot-og",
        platform: "bot",
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "social-bot-og",
        platform: "bot",
        uaKind,
        status: 200,
        target: buildLinkShortUrl(link, publicBaseUrl),
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
        "Content-Type": "text/html;charset=utf-8",
        // Quan trọng: cho phép Facebook đọc App Links meta
        "X-Frame-Options": "SAMEORIGIN",
      });
      return res.send(buildOgPage(link, publicBaseUrl));
      // NOTE: Không recordClick ở đây → tránh đếm lượt click ảo từ bot
    }

    // Count click (chỉ user thật)
    const ip =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "";
    await database.recordClick(
      link.id,
      ip,
      ua,
      req.headers["referer"] || "",
      extractClickGeo(req),
    );

    // ── Video link ──────────────────────────────────────────────────────────
    const linkType = (link.link_type || "direct").trim();
    if (linkType === "video") {
      setRedirectDebugHeaders(res, {
        mode: "video-page",
        platform: "video",
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "video-page",
        platform: "video",
        uaKind,
        status: 200,
        target: link.original_url,
        referer,
      });
      return res.send(buildVideoPage(link));
    }

    const info = detectPlatformDeep(link.original_url, platform);
    const isFacebookInApp = isFacebookInAppBrowser(ua);

    if (
      platform !== "desktop" &&
      info.platform_name === "shopee" &&
      isFacebookInApp
    ) {
      setRedirectDebugHeaders(res, {
        mode: "shopee-facebook-bridge",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "shopee-facebook-bridge",
        platform: info.platform_name,
        uaKind,
        status: 200,
        target: info.fallback || link.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
        "Content-Type": "text/html;charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      });
      return res.send(buildShopeeFacebookBridgePage(link, publicBaseUrl, info));
    }

    // ── Desktop → redirect thẳng ─────────────────────────────────────────
    if (platform === "desktop") {
      setRedirectDebugHeaders(res, {
        mode: "desktop-redirect",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "desktop-redirect",
        platform: info.platform_name,
        uaKind,
        status: 302,
        target: link.original_url,
        referer,
      });
      return res.redirect(302, link.original_url);
    }

    // ── Shopee mobile → 301 thẳng tới Shopee/App Link ───────────────────
    if (info.platform_name === "shopee") {
      const shopeeTarget = info.deeplink || link.original_url;
      setRedirectDebugHeaders(res, {
        mode: "shopee-direct-redirect",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "shopee-direct-redirect",
        platform: info.platform_name,
        uaKind,
        status: 301,
        target: shopeeTarget,
        referer,
      });
      return res.redirect(301, shopeeTarget);
    }

    // ── Mobile có deeplink → DirectBridgePage ────────────────────────────
    if (info.deeplink || linkType === "deeplink") {
      const shortUrl = buildLinkShortUrl(link, publicBaseUrl);
      setRedirectDebugHeaders(res, {
        mode: "deeplink-bridge",
        platform: info.platform_name,
      });
      logRedirectDecision({
        requestId: req.requestId,
        linkId: link.id,
        code: codeValue,
        mode: "deeplink-bridge",
        platform: info.platform_name,
        uaKind,
        status: 200,
        target: info.deeplink || link.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
      });
      return res.send(buildDirectBridgePage(link, shortUrl, info));
    }

    // ── Mobile không có deeplink → redirect thẳng ────────────────────────
    setRedirectDebugHeaders(res, {
      mode: "mobile-direct",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: link.id,
      code: codeValue,
      mode: "mobile-direct",
      platform: info.platform_name,
      uaKind,
      status: 302,
      target: link.original_url,
      referer,
    });
    return res.redirect(302, link.original_url);
  } catch (e) {
    console.error(e);
    res.status(500).send("Server error");
  }
});

app.get("/_og/:code", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const { code } = req.params;
    const link =
      (await database.getLinkByAlias(code)) ||
      (await database.getLinkByCode(code));
    if (!link) return res.status(404).send("Not found");
    res.set({
      "Cache-Control": "no-cache,no-store,must-revalidate",
      Pragma: "no-cache",
      "Content-Type": "text/html;charset=utf-8",
    });
    return res.send(buildOgPage(link, publicBaseUrl));
  } catch (e) {
    res.status(500).send("Server error");
  }
});

app.post("/api/links/bulk-delete", async (req, res) => {
  const user = await resolveUser(req);
  const guestSessionId = user ? null : req.guestSessionId;
  if (!user && !guestSessionId)
    return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const database = await getDb();
    const requestedIds = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))]
      : [];
    if (!requestedIds.length)
      return res.status(400).json({ error: "Chưa chọn link nào để xóa" });

    const isAdmin = user?.role === "admin" || isAdminEmail(user?.email);
    const linksToCheck = await Promise.all(
      requestedIds.map((linkId) => database.getLinkById(linkId)),
    );
    const deletableIds = linksToCheck
      .filter(Boolean)
      .filter((link) => {
        const isGuestOwner =
          !!guestSessionId &&
          !link.user_id &&
          link.guest_session_id === guestSessionId;
        return isAdmin || isGuestOwner || link.user_id === user?.id;
      })
      .map((link) => Number(link.id));

    if (!deletableIds.length)
      return res.status(403).json({ error: "Không có link hợp lệ để xóa" });

    await database.deleteLinks(deletableIds);
    return res.json({
      ok: true,
      deleted_count: deletableIds.length,
      skipped_count: requestedIds.length - deletableIds.length,
      deleted_ids: deletableIds,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.get("/u/:slug", async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const slug = normalizeBioSlug(req.params.slug);
    if (!slug)
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));
    const profile = await database.getBioProfileBySlug(slug);
    if (!profile || profile.is_published === false)
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));
    const owner = await database.getUserById(profile.user_id);
    const links = await resolvePublicBioLinks(database, profile);
    const canonicalUrl = buildBioShareUrl(publicBaseUrl, slug);
    res.set({
      "Cache-Control": "no-cache,no-store,must-revalidate",
      Pragma: "no-cache",
      "Content-Type": "text/html;charset=utf-8",
    });
    return res.send(buildBioPage(profile, owner, links, canonicalUrl));
  } catch (e) {
    console.error(e);
    return res.status(500).send("Server error");
  }
});

function buildAppLinkMetaTags(
  canonicalUrl,
  webFallbackUrl,
  appLinkOverrideUrl,
  options,
) {
  const webUrl = webFallbackUrl || canonicalUrl;
  const fallbackApp = appLinkOverrideUrl || webFallbackUrl || "";
  const androidUrl = options?.androidUrl || fallbackApp;
  const iosUrl = options?.iosUrl || fallbackApp;
  const hasAndroid = Boolean(androidUrl);
  const hasIos = Boolean(iosUrl);

  const tags = [
    `<meta property="al:web:url" content="${esc(webUrl)}" />`,
    `<meta property="al:web:should_fallback" content="true" />`,
  ];

  if (hasAndroid || hasIos) {
    if (hasAndroid) {
      tags.push(
        `<meta property="al:android:url" content="${esc(androidUrl)}" />`,
      );
      if (options?.androidPackage)
        tags.push(
          `<meta property="al:android:package" content="${esc(options.androidPackage)}" />`,
        );
      if (options?.androidAppName)
        tags.push(
          `<meta property="al:android:app_name" content="${esc(options.androidAppName)}" />`,
        );
    }
    if (hasIos) {
      tags.push(`<meta property="al:ios:url" content="${esc(iosUrl)}" />`);
      if (options?.iosAppName)
        tags.push(
          `<meta property="al:ios:app_name" content="${esc(options.iosAppName)}" />`,
        );
      if (options?.iosAppStoreId)
        tags.push(
          `<meta property="al:ios:app_store_id" content="${esc(options.iosAppStoreId)}" />`,
        );
    }
  }
  return tags.join("\n");
}

function buildBioPage(profile, owner, links, canonicalUrl) {
  const accent = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(profile.accent || "")
    ? profile.accent
    : "#3b82f6";
  const title =
    profile.title?.trim() ||
    owner?.name ||
    owner?.email?.split("@")[0] ||
    "BocLink";
  const subtitle =
    profile.subtitle?.trim() || "Link-in-bio page được tạo từ BocLink.click.";
  const avatar = profile.avatar?.trim() || (owner?.name || "R").charAt(0).toUpperCase();
  const pageBase = canonicalUrl.replace(/\/u\/[^/]+$/, "");
  const shortLinks = (links || []).map((l) => {
    return {
      shortUrl: l.short_url || buildLinkShortUrl(l, pageBase),
      originalUrl: l.original_url,
      title: l.og_title || l.original_url,
      clicks: l.clicks || 0,
      type: l.link_type || "direct",
    };
  });
  const isImageAvatar = /^https?:\/\//i.test(avatar);
  const avatarMarkup = isImageAvatar
    ? `<img class="bio-avatar" src="${esc(avatar)}" alt="${esc(title)}" />`
    : `<div class="bio-avatar">${esc(avatar)}</div>`;
  const linksMarkup = shortLinks.length
    ? shortLinks
        .map(
          (l) => `
            <a class="bio-link" href="${esc(l.shortUrl)}" target="_blank" rel="noreferrer">
              <div class="bio-link-title">${esc(l.title)}</div>
              <div class="bio-link-desc">${esc(l.originalUrl)}</div>
              <div class="bio-link-meta">
                <span>${esc(l.type)}</span>
                <span>👁 ${l.clicks.toLocaleString()}</span>
              </div>
            </a>`,
        )
        .join("")
    : `<div class="bio-empty">Chưa có link nào để hiển thị.</div>`;

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(title)} | BocLink</title>
  <meta name="description" content="${esc(subtitle)}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(subtitle)}" />
  <meta property="og:image" content="${esc(`${BASE_URL}/og-default.png`)}" />
  <meta property="og:url" content="${esc(canonicalUrl)}" />
  <meta property="og:type" content="profile" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    :root{color-scheme:dark;--bg:#0d1117;--bg2:#161b27;--bg3:#1e2535;--text:#e2e8f0;--text2:#94a3b8;--border:#2a3347;--accent:${accent};--accent2:#8b5cf6}
    *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:radial-gradient(circle at top, rgba(59,130,246,.22), transparent 35%), linear-gradient(180deg, #0b1020 0%, #090d16 100%);color:var(--text);min-height:100vh}
    a{text-decoration:none;color:inherit}
    .wrap{max-width:760px;margin:0 auto;padding:28px 18px 44px}
    .hero{background:linear-gradient(180deg, rgba(255,255,255,.04), rgba(255,255,255,.02));border:1px solid var(--border);border-radius:28px;padding:22px;box-shadow:0 24px 70px rgba(0,0,0,.25)}
    .cover{height:160px;border-radius:22px;background:linear-gradient(135deg, var(--accent), var(--accent2));margin-bottom:-56px}
    .body{padding:0 4px 10px}
    .bio-avatar{width:112px;height:112px;border-radius:30px;border:5px solid rgba(13,17,23,.9);margin:0 auto;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:42px;font-weight:900;color:#fff;overflow:hidden;box-shadow:0 18px 30px rgba(0,0,0,.25);object-fit:cover}
    h1{font-size:30px;line-height:1.1;text-align:center;margin:16px 0 8px}
    p.desc{text-align:center;color:var(--text2);margin:0 auto 18px;max-width:560px;line-height:1.6}
    .meta{display:flex;justify-content:center;gap:8px;flex-wrap:wrap;margin-bottom:18px}
    .pill{padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.05);border:1px solid var(--border);color:var(--text2);font-size:12px}
    .links{display:grid;gap:12px;margin-top:18px}
    .bio-link{display:block;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:20px;padding:16px 16px 14px;transition:.18s}
    .bio-link:hover{transform:translateY(-2px);border-color:var(--accent);background:rgba(255,255,255,.06)}
    .bio-link-title{font-weight:800;font-size:16px;margin-bottom:4px}
    .bio-link-desc{font-size:13px;color:var(--text2);line-height:1.4;word-break:break-word}
    .bio-link-meta{display:flex;justify-content:space-between;gap:10px;margin-top:10px;color:var(--text2);font-size:11px;text-transform:uppercase;letter-spacing:.06em}
    .bio-empty{padding:18px;border:1px dashed var(--border);border-radius:18px;text-align:center;color:var(--text2);background:rgba(255,255,255,.03)}
    .footer{margin-top:18px;text-align:center;font-size:12px;color:var(--text2)}
    .brand{font-weight:800;color:#fff}
    @media (max-width:520px){.wrap{padding:14px}.hero{padding:16px;border-radius:24px}.cover{height:124px;margin-bottom:-48px} h1{font-size:24px}.bio-avatar{width:92px;height:92px;font-size:34px}}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <div class="cover"></div>
      <div class="body">
        ${avatarMarkup}
        <h1>${esc(title)}</h1>
        <p class="desc">${esc(subtitle)}</p>
        <div class="meta">
          <span class="pill">${shortLinks.length.toLocaleString()} link</span>
          <span class="pill">${esc(profile.link_source || "recent")}</span>
          <span class="pill">BocLink Bio</span>
        </div>
        <div class="links">${linksMarkup}</div>
        <div class="footer">Tạo bằng <span class="brand">BocLink</span> · ${owner?.email ? esc(owner.email) : "Public profile"}</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

function buildShopeeFacebookBridgePage(link, baseUrl, info) {
  const shortUrl = buildLinkShortUrl(link, baseUrl);
  const shortBaseUrl = shortUrl.replace(/\/[^/]+$/, "");
  const title = esc(link.og_title || "BocLink");
  const desc = esc(
    link.og_desc || "Đang mở Shopee để tiếp tục xem nội dung.",
  );
  const image = link.og_image
    ? esc(link.og_image)
    : `${shortBaseUrl}/og-default.png`;
  const webUrl = info.fallback || link.original_url;
  const appUrl = buildShopeeAppLinkUrl(webUrl);
  const appMeta = buildAppLinkMetaTags(shortUrl, webUrl, appUrl, {
    androidUrl: appUrl,
    androidPackage: SHOPEE_ANDROID_PACKAGE,
    androidAppName: "Shopee",
    iosUrl: appUrl,
    iosAppName: "Shopee",
    iosAppStoreId: SHOPEE_APP_STORE_ID,
  });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta name="description" content="${desc}" />
<meta name="robots" content="noindex, nofollow" />
<link rel="canonical" href="${esc(shortUrl)}" />
<meta http-equiv="refresh" content="0;url=${esc(webUrl)}" />
<meta property="fb:app_id" content="${FACEBOOK_APP_ID}" />
${appMeta}
<meta property="og:locale" content="vi_VN" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${desc}" />
<meta property="og:url" content="${esc(shortUrl)}" />
<meta property="og:site_name" content="BocLink" />
<meta property="og:image" content="${image}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${desc}" />
<meta name="twitter:image" content="${image}" />
<style>
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    background: #0f172a;
    color: #e2e8f0;
    font: 600 15px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .hint { opacity: 0.72; letter-spacing: 0.01em; }
</style>
</head>
<body>
<div class="hint">Dang mo Shopee...</div>
<script>
(function() {
  var appUrl = ${JSON.stringify(appUrl)};
  var webUrl = ${JSON.stringify(webUrl)};
  var fallbackDelay = /iphone|ipad|ipod/i.test(navigator.userAgent || "") ? 380 : 520;

  if (appUrl) {
    try { window.location.href = appUrl; } catch (_) {}
  }

  setTimeout(function() {
    window.location.replace(webUrl);
  }, fallbackDelay);
})();
</script>
</body>
</html>`;
}

// ─── DIRECT BRIDGE PAGE ───────────────────────────────────────────────────────
// FIX 4: Cải thiện logic để nhảy app ngay, giảm delay, dùng sessionStorage đúng
function buildDirectBridgePage(link, canonicalUrl, info) {
  const title = link.og_title?.trim() || "BocLink";
  const desc =
    link.og_desc?.trim() || "Đang mở ứng dụng gốc để tiếp tục xem nội dung.";
  const image = link.og_image || "";
  const dest = link.original_url;

  const appScheme = info.deeplink || dest;
  const iosScheme = info.deeplink_ios || appScheme;
  const andScheme = info.deeplink_android || appScheme;
  const platform = info.platform_name;

  // Shopee dùng Universal Link → không cần khai báo al:android/ios:url riêng
  // vì al:web:url đã đủ để OS intercept và mở app
  const appMeta =
    platform === "tiktok"
      ? {
          androidUrl: andScheme,
          androidPackage: TIKTOK_ANDROID_PACKAGE,
          androidAppName: "TikTok",
          iosUrl: iosScheme,
          iosAppName: "TikTok",
          iosAppStoreId: TIKTOK_APP_STORE_ID,
        }
      : platform === "shopee"
        ? {
            // App Links cho Facebook nên trỏ thẳng vào custom scheme của Shopee
            // để tăng khả năng mở app khi user bấm short link trong comment/feed.
            androidUrl: buildShopeeAppLinkUrl(dest),
            androidPackage: SHOPEE_ANDROID_PACKAGE,
            androidAppName: "Shopee",
            iosUrl: buildShopeeAppLinkUrl(dest),
            iosAppName: "Shopee",
            iosAppStoreId: SHOPEE_APP_STORE_ID,
          }
        : undefined;

  const appLinkMeta = buildAppLinkMetaTags(
    canonicalUrl,
    dest,
    appScheme,
    appMeta,
  );
  // Shopee Universal Link → không cần intent:// trick nên androidPkg để trống
  const androidPkg = platform === "tiktok" ? TIKTOK_ANDROID_PACKAGE : "";

  const escJs = (s) =>
    (s || "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r");

  const ogImageTag = image
    ? `<meta property="og:image" content="${esc(image)}" />`
    : "";

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
<meta property="og:site_name" content="BocLink" />
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
  const shortUrl = buildLinkShortUrl(link, baseUrl);
  const shortBaseUrl = shortUrl.replace(/\/[^/]+$/, "");
  const title = esc(link.og_title || "BocLink");
  const desc = esc(link.og_desc || "Nhấn vào link để xem nội dung");
  const image = link.og_image
    ? esc(link.og_image)
    : `${shortBaseUrl}/og-default.png`;
  const dest = link.original_url;
  const info = detectPlatformDeep(dest, "ios");
  const isVideoLink = (link.link_type || "direct").trim() === "video";
  const appMeta =
    !isVideoLink && info.platform_name !== "generic"
      ? buildAppLinkMetaTags(
          shortUrl,
          dest,
          info.deeplink_ios,
          info.platform_name === "tiktok"
            ? {
                androidUrl: info.deeplink_android,
                androidPackage: TIKTOK_ANDROID_PACKAGE,
                androidAppName: "TikTok",
                iosUrl: info.deeplink_ios,
                iosAppName: "TikTok",
                iosAppStoreId: TIKTOK_APP_STORE_ID,
              }
            : {
                androidUrl: buildShopeeAppLinkUrl(dest),
                androidPackage: SHOPEE_ANDROID_PACKAGE,
                androidAppName: "Shopee",
                iosUrl: buildShopeeAppLinkUrl(dest),
                iosAppName: "Shopee",
                iosAppStoreId: SHOPEE_APP_STORE_ID,
              },
        )
      : "";
  const fbAppIdMeta = isVideoLink
    ? ""
    : `<meta property="fb:app_id" content="${FACEBOOK_APP_ID}" />`;

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
${fbAppIdMeta}
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
<meta property="og:site_name"    content="BocLink" />
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
    destination: (_, __, cb) => {
      const dir = require("path").join(__dirname, "..", "public", "uploads");
      try {
        if (!require("fs").existsSync(dir))
          require("fs").mkdirSync(dir, { recursive: true });
      } catch (_) {}
      cb(null, dir);
    },
    filename: (_, file, cb) =>
      cb(
        null,
        nanoid(12) + require("path").extname(file.originalname).toLowerCase(),
      ),
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_, file, cb) =>
    cb(null, /\.(mp4|webm|mov|avi|mkv)$/i.test(file.originalname)),
});

app.post(
  "/api/upload-video",
  requireAuth,
  videoUploadMw.single("video"),
  async (req, res) => {
    const user = await resolveUser(req);
    const plan = user?.plan || "free";
    if (!PLANS[plan]?.videoLink)
      return res
        .status(403)
        .json({ error: "Tính năng này yêu cầu gói Pro", upgrade: true });
    if (!req.file)
      return res
        .status(400)
        .json({
          error: "Không có file hoặc định dạng không hợp lệ (mp4, webm, mov)",
        });

    try {
      if (CLOUDINARY_OK && req.file.buffer) {
        const result = await uploadToCloudinary(
          req.file.buffer,
          req.file.originalname,
          "video",
        );
        const thumbUrl =
          result.eager?.[0]?.secure_url ||
          result.secure_url
            .replace("/upload/", "/upload/so_0,w_1200,h_630,c_fill,f_jpg/")
            .replace(/\.[^.]+$/, ".jpg");
        return res.json({
          url: result.secure_url,
          thumb: thumbUrl,
          public_id: result.public_id,
          source: "cloudinary",
          duration: result.duration,
        });
      } else {
        return res.json({
          url: `/uploads/${req.file.filename}`,
          thumb: null,
          source: "local",
        });
      }
    } catch (e) {
      console.error("[upload-video]", e.message);
      return res
        .status(500)
        .json({ error: "Upload video thất bại: " + e.message });
    }
  },
);

function buildVideoPage(link) {
  const launchUrl = buildVideoLaunchUrl(link);
  const overlayText = esc(
    link.video_overlay_text || "Bấm vào đây để ủng hộ và xem sản phẩm →",
  );
  const ogTitle = esc(link.og_title || "Xem video");
  const ogImage = esc(link.og_image || "");
  const videoUrl = link.video_url || "";

  let videoHtml = "";
  const ytMatch = videoUrl.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
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
${ogImage ? `<meta property="og:image" content="${ogImage}"/>` : ""}
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
  var LAUNCH_URL = ${JSON.stringify(launchUrl)};
  var CIRC = 120.6, DELAY = 5000;

  var videoEl = document.getElementById('videoEl');
  var overlay = document.getElementById('overlay');
  var xBtn    = document.getElementById('xBtn');
  var cdWrap  = document.getElementById('cdWrap');
  var cdProg  = document.getElementById('cdProg');
  var cdNum   = document.getElementById('cdNum');
  var pf      = document.getElementById('pf');
  var shown   = false;

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
    window.location.href=LAUNCH_URL;
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
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 http://localhost:${PORT}  admin: ${ADMIN_EMAIL}`),
  );
}
