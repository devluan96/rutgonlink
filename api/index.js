try {
  require("dotenv").config({
    path: require("path").join(__dirname, "..", ".env"),
  });
} catch (_) {}

const express = require("express");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const zlib = require("zlib");
const {
  S3Client,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { nanoid } = require("nanoid");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const cloudinary = require("cloudinary").v2;
const { init: initDb } = require("./db");
const { isAffiliateShortenUrl } = require("../affiliate");

const app = express();
function syncArticleFunnelLabSrcdocAsset() {
  const templatePath = path.join(__dirname, "templates", "admin-article-funnel-lab.html");
  const assetPath = path.join(__dirname, "..", "public", "article-funnel-lab-srcdoc.js");
  try {
    const templateHtml = fs.readFileSync(templatePath, "utf8");
    const assetContent =
      `window.__ARTICLE_FUNNEL_LAB_TEMPLATE_HTML__ = ${JSON.stringify(templateHtml)};\n`;
    fs.writeFileSync(assetPath, assetContent, "utf8");
  } catch (error) {
    console.error("[article-funnel-lab/srcdoc-sync] Failed to sync lab template asset", error);
  }
}
syncArticleFunnelLabSrcdocAsset();
const BASE_URL =
  (process.env.BASE_URL || "").replace(/\/$/, "") ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");
const JWT_SECRET =
  process.env.JWT_SECRET ||
  (process.env.NODE_ENV === "production"
    ? null
    : crypto.randomBytes(32).toString("hex"));
const TWO_FACTOR_ENCRYPTION_SECRET =
  process.env.TWO_FACTOR_ENCRYPTION_SECRET || JWT_SECRET;
const TWO_FACTOR_ISSUER =
  (process.env.TWO_FACTOR_ISSUER || "BocLink").trim() || "BocLink";
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
const SUPABASE_SERVICE_ROLE_KEY = (
  process.env.SUPABASE_SERVICE_ROLE_KEY || ""
).trim();
const SUPABASE_ANON_KEY = (process.env.SUPABASE_ANON_KEY || "").trim();
const GUEST_SESSION_COOKIE = "guest_session";
const GUEST_SESSION_MAX_AGE = 30 * 24 * 3600 * 1000;
const ANALYTICS_TIME_ZONE = (
  process.env.APP_TIME_ZONE || "Asia/Ho_Chi_Minh"
).trim();
const regionNamesVi =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["vi"], { type: "region" })
    : null;
const regionNamesEn =
  typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
let redirectLogWriteQueue = Promise.resolve();
const STATS_RESPONSE_CACHE_TTL_MS = Math.max(
  Number(process.env.STATS_RESPONSE_CACHE_TTL_MS) || 10000,
  0,
);
const statsResponseCache = new Map();
const statsResponseInFlight = new Map();
const ADMIN_STATS_RESPONSE_CACHE_TTL_MS = Math.max(
  Number(process.env.ADMIN_STATS_RESPONSE_CACHE_TTL_MS) ||
    STATS_RESPONSE_CACHE_TTL_MS,
  0,
);
const adminStatsResponseCache = new Map();
const adminStatsResponseInFlight = new Map();
const USER_STATS_RECENT_DAYS = 7;

// ── Cloudinary config ────────────────────────────────────────────────────────
const CLOUDINARY_OK = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);
const R2_VIDEO_ACCOUNT_ID = (process.env.R2_VIDEO_ACCOUNT_ID || "").trim();
const R2_VIDEO_ACCESS_KEY_ID = (
  process.env.R2_VIDEO_ACCESS_KEY_ID || ""
).trim();
const R2_VIDEO_SECRET_ACCESS_KEY = (
  process.env.R2_VIDEO_SECRET_ACCESS_KEY || ""
).trim();
const R2_VIDEO_BUCKET = (process.env.R2_VIDEO_BUCKET || "").trim();
const R2_VIDEO_PUBLIC_BASE_URL = (
  process.env.R2_VIDEO_PUBLIC_BASE_URL || ""
)
  .trim()
  .replace(/\/+$/, "");
const R2_VIDEO_PREFIX = String(
  process.env.R2_VIDEO_PREFIX || "rutgonlink/videos",
)
  .trim()
  .replace(/^\/+|\/+$/g, "");
const R2_VIDEO_OK = !!(
  R2_VIDEO_ACCOUNT_ID &&
  R2_VIDEO_ACCESS_KEY_ID &&
  R2_VIDEO_SECRET_ACCESS_KEY &&
  R2_VIDEO_BUCKET &&
  R2_VIDEO_PUBLIC_BASE_URL
);
let r2VideoClient = null;
if (R2_VIDEO_OK) {
  r2VideoClient = new S3Client({
    region: "auto",
    endpoint: `https://${R2_VIDEO_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_VIDEO_ACCESS_KEY_ID,
      secretAccessKey: R2_VIDEO_SECRET_ACCESS_KEY,
    },
  });
  console.log("[r2-video] configured ✅");
} else {
  console.warn("[r2-video] NOT configured – using Cloudinary/local fallback");
}
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
const PAYMENT_BANK_NAME = readEnvValue(
  "PAYMENT_BANK_NAME",
  "VITE_PAYMENT_BANK_NAME",
);
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
const PAYMENT_QR_IMAGE_URL = readEnvValue(
  "PAYMENT_QR_IMAGE_URL",
  "VITE_PAYMENT_QR_IMAGE_URL",
);
const PAYMENT_CONTACT = (
  process.env.PAYMENT_CONTACT || "Zalo 0969.361.607"
).trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const OPENAI_VIDEO_METADATA_MODEL =
  (process.env.OPENAI_VIDEO_METADATA_MODEL || "gpt-5.5").trim() || "gpt-5.5";
const VIDEO_LINK_DOMAIN = (
  process.env.VIDEO_LINK_DOMAIN || "goc8.click"
).trim();
const AFFILIATE_PRESET_MAX_LENGTH = 6000;
const DEFAULT_OG_IMAGE_URL = `${BASE_URL}/og-card.png`;

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

function renderHtmlTemplate(templatePath, replacements = {}) {
  let html = fs.readFileSync(templatePath, "utf8");
  for (const [token, value] of Object.entries(replacements)) {
    html = html.replaceAll(token, String(value ?? ""));
  }
  return html;
}

function escapeXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function serveLanding(_req, res) {
  res.set("Cache-Control", "no-store");
  const html = renderHtmlTemplate(
    path.join(__dirname, "..", "public", "landing.html"),
    {
      "__BASE_URL__": BASE_URL,
      "__OG_IMAGE_URL__": DEFAULT_OG_IMAGE_URL,
    },
  );
  res.type("html").send(html);
}

function servePublicTemplate(templatePath, replacements = {}, options = {}) {
  return (_req, res) => {
    res.set("Cache-Control", options.cacheControl || "no-store");
    const html = renderHtmlTemplate(templatePath, replacements);
    res.type("html").send(html);
  };
}

function serveAppShell(_req, res) {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
}

function requireAppShellSession(req, res, next) {
  const token = parseToken(req);
  if (!token) {
    return res.redirect(
      302,
      `/login?next=${encodeURIComponent(req.originalUrl || "/dashboard")}`,
    );
  }
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.redirect(
      302,
      `/login?next=${encodeURIComponent(req.originalUrl || "/dashboard")}`,
    );
  }
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
const publicResourcePages = [
  {
    pathname: "/resources",
    templatePath: path.join(
      __dirname,
      "..",
      "public",
      "resources-index.html",
    ),
    title:
      "Tài nguyên BocLink cho short link, bio link và QR code | BocLink.click",
    description:
      "Trung tâm tài nguyên của BocLink về rút gọn link, bio link, QR code và tracking cho Shopee, TikTok, creator và social commerce.",
    changefreq: "weekly",
    priority: "0.9",
  },
  {
    pathname: "/resources/rut-gon-link-shopee-tiktok",
    templatePath: path.join(
      __dirname,
      "..",
      "public",
      "resource-shopee-tiktok-guide.html",
    ),
    title:
      "Hướng dẫn rút gọn link Shopee và TikTok hiệu quả hơn | BocLink.click",
    description:
      "Hướng dẫn rút gọn link Shopee và TikTok hiệu quả hơn với short link, QR code, bio link và cách đọc click cho social commerce.",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    pathname: "/resources/bio-link-social-commerce",
    templatePath: path.join(
      __dirname,
      "..",
      "public",
      "resource-bio-link-social-commerce.html",
    ),
    title:
      "Bio link là gì và khi nào nên dùng cho social commerce? | BocLink.click",
    description:
      "Tìm hiểu bio link là gì, khi nào nên dùng bio link cho social commerce, creator, affiliate và cách gom nhiều CTA về một trang gọn hơn.",
    changefreq: "monthly",
    priority: "0.8",
  },
  {
    pathname: "/resources/qr-code-ban-hang-social-commerce",
    templatePath: path.join(
      __dirname,
      "..",
      "public",
      "resource-qr-code-social-commerce.html",
    ),
    title:
      "Cách dùng QR code cho bán hàng và social post hiệu quả hơn | BocLink.click",
    description:
      "Cách dùng QR code cho bán hàng, social post, livestream và bề mặt offline để kéo traffic về Shopee, TikTok hoặc bio link hiệu quả hơn.",
    changefreq: "monthly",
    priority: "0.8",
  },
];
app.get("/", serveLanding);
app.get(["/landing", "/landing/"], redirectToCanonical("/"));
app.get("/landing.html", redirectToCanonical("/"));
for (const page of publicResourcePages) {
  app.get(
    [page.pathname, `${page.pathname}/`],
    servePublicTemplate(
      page.templatePath,
      {
        "__BASE_URL__": BASE_URL,
        "__PAGE_URL__": `${BASE_URL}${page.pathname}`,
        "__PAGE_TITLE__": page.title,
        "__PAGE_DESCRIPTION__": page.description,
        "__OG_IMAGE_URL__": DEFAULT_OG_IMAGE_URL,
      },
      { cacheControl: "public, max-age=300" },
    ),
  );
}
app.get(appShellRoutes, requireAppShellSession, serveAppShell);
const serveAuthHtml = (templatePath) => (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  const html = renderHtmlTemplate(templatePath, {
    "__GOOGLE_CLIENT_ID__": GOOGLE_CLIENT_ID,
    "__SUPABASE_URL__": SUPABASE_URL,
    "__SUPABASE_ANON_KEY__": SUPABASE_ANON_KEY,
    "__BASE_URL__": BASE_URL,
  });
  res.type("html").send(html);
};
app.get(
  ["/login", "/login/"],
  serveAuthHtml(
    path.join(__dirname, "..", "public", "user", "login", "index.html"),
  ),
);
app.get(
  ["/register", "/register/"],
  serveAuthHtml(
    path.join(__dirname, "..", "public", "user", "register", "index.html"),
  ),
);
app.get(["/user/login", "/user/login/"], redirectToCanonical("/login"));
app.get("/user/login/index.html", redirectToCanonical("/login"));
app.get(
  ["/user/register", "/user/register/"],
  redirectToCanonical("/register"),
);
app.get("/user/register/index.html", redirectToCanonical("/register"));
app.post("/api/admin/article-funnel-lab/resolve-target", requireArticleFunnelLab, async (req, res) => {
  try {
    const inputUrl = String(req.body?.url || "").trim();
    const iosInAppOverride = String(
      req.body?.popup20sIosFbUrl ||
        req.body?.popup_20s_ios_fb_url ||
        req.body?.ios_fb_url ||
        "",
    ).trim();
    if (!inputUrl) {
      return res.status(400).json({ error: "Thiếu URL cần resolve" });
    }

    const inferredPlatform = inferAffiliatePlatformFromUrl(inputUrl);
    const normalizedUrl =
      normalizeAffiliatePresetUrl(
        inputUrl,
        inferredPlatform === "generic" ? "" : inferredPlatform,
      ) ||
      normalizeAffiliatePresetUrl(inputUrl) ||
      inputUrl;
    const health = await fetchAffiliateHealth(normalizedUrl);
    const finalUrl = String(health?.final_url || normalizedUrl || "").trim();
    const launchConfig = applyArticleFunnelStageDirectOverrides(
      {
        stage_key: "20s",
      },
      buildOverlayLaunchConfig(finalUrl),
      {
        overlay: {
          popup_20s_ios_fb_url: iosInAppOverride,
        },
      },
    );

    return res.json({
      ok: true,
      input_url: inputUrl,
      normalized_url: normalizedUrl,
      final_url: finalUrl,
      checked_at: health?.checked_at || new Date().toISOString(),
      platform: launchConfig.direct_platform || inferredPlatform || "generic",
      alive: Boolean(health?.alive),
      note: health?.note || "",
      status: Number(health?.status || 0),
      ...launchConfig,
    });
  } catch (error) {
    console.error("[article-funnel-lab/resolve-target]", error);
    return res.status(500).json({ error: "Resolve target thất bại" });
  }
});
app.post("/api/admin/article-funnel-lab/import-url", requireArticleFunnelLab, async (req, res) => {
  try {
    const sourceUrl = normalizeImportSourceUrl(req.body?.url || "");
    if (!sourceUrl) {
      return res.status(400).json({ error: "URL nguon khong hop le" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(sourceUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0 Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "vi,en-US;q=0.9,en;q=0.8",
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response || !response.ok) {
      return res.status(400).json({
        error: `Khong tai duoc URL nguon (${Number(response?.status || 0) || "no-response"})`,
      });
    }

    const finalUrl = normalizeImportSourceUrl(response.url || sourceUrl) || sourceUrl;
    const html = await response.text();
    const item = extractArticleFunnelImportPayload(html, finalUrl);
    if (!item.title && !item.description && !item.blocks.length) {
      return res.status(400).json({
        error: "Khong tim thay title, mo ta hoac media hop le tren URL nguon",
      });
    }

    return res.json({
      ok: true,
      item,
    });
  } catch (error) {
    console.error("[article-funnel-lab/import-url]", error);
    return res.status(500).json({ error: "Khong the lay nhanh du lieu tu URL nguon" });
  }
});
app.get("/api/admin/article-funnel-labs", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const rows = await database.listArticleFunnelLabs({
      createdByUserId: isAdminUserRecord(req.currentUser)
        ? 0
        : req.currentUser?.id || 0,
    });
    return res.json({
      ok: true,
      items: rows.map((item) => {
        const configJson =
          item.config_json && typeof item.config_json === "object"
            ? item.config_json
            : {};
        const publishedUrl =
          item.published_route_slug
            ? buildArticleFunnelPublicUrl(
                item.published_route_slug,
                normalizeDomainHost(configJson.source_domain),
                publicBaseUrl,
              )
            : "";
        const publishedTest20sUrl =
          item.published_route_slug && hasArticleFunnelStage(configJson, "20s")
            ? buildArticleFunnelPopupTestUrl(
                item.published_route_slug,
                normalizeDomainHost(configJson.source_domain),
                publicBaseUrl,
                "20s",
              )
            : "";
        return {
          id: item.id,
          name: item.name || `Lab ${item.id}`,
          title: item.title || "",
          published_route_slug: item.published_route_slug || "",
          published_url: publishedUrl,
          published_test_20s_url: publishedTest20sUrl,
          affiliate_clicks: Math.max(Number(item.affiliate_clicks) || 0, 0),
          created_by_user_id: item.created_by_user_id || null,
          created_at: item.created_at || null,
          updated_at: item.updated_at || item.created_at || null,
        };
      }),
    });
  } catch (error) {
    console.error("[article-funnel-labs/list]", error);
    return res.status(500).json({ error: "Khong the tai danh sach lab" });
  }
});
app.get("/api/admin/article-funnel-labs/:id", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const row = await database.getArticleFunnelLabById(req.params.id);
    if (!row) {
      return res.status(404).json({ error: "Khong tim thay lab" });
    }
    if (!canManageArticleFunnelLab(req.currentUser, row)) {
      return res.status(403).json({ error: "Khong co quyen xem lab nay" });
    }
    const configJson =
      row.config_json && typeof row.config_json === "object"
        ? row.config_json
        : {};
    const publishedUrl =
      row.published_route_slug
        ? buildArticleFunnelPublicUrl(
            row.published_route_slug,
            normalizeDomainHost(configJson.source_domain),
            publicBaseUrl,
          )
        : "";
    const publishedTest20sUrl =
      row.published_route_slug && hasArticleFunnelStage(configJson, "20s")
        ? buildArticleFunnelPopupTestUrl(
            row.published_route_slug,
            normalizeDomainHost(configJson.source_domain),
            publicBaseUrl,
            "20s",
          )
        : "";
    return res.json({
      ok: true,
      item: {
        id: row.id,
        name: row.name || `Lab ${row.id}`,
        title: row.title || "",
        published_route_slug: row.published_route_slug || "",
        published_url: publishedUrl,
        published_test_20s_url: publishedTest20sUrl,
        affiliate_clicks: Math.max(Number(row.affiliate_clicks) || 0, 0),
        created_by_user_id: row.created_by_user_id || null,
        created_at: row.created_at || null,
        updated_at: row.updated_at || row.created_at || null,
        config_json: configJson,
      },
    });
  } catch (error) {
    console.error("[article-funnel-labs/get]", error);
    return res.status(500).json({ error: "Khong the tai lab" });
  }
});
app.post("/api/admin/article-funnel-labs", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const rawConfig =
      req.body?.config && typeof req.body.config === "object"
        ? req.body.config
        : req.body?.config_json && typeof req.body.config_json === "object"
          ? req.body.config_json
          : req.body?.sourceDomain || req.body?.source_domain
            ? req.body
            : {};
    const normalizedConfig = normalizeArticleFunnelPreviewConfig(rawConfig);
    const row = await database.createArticleFunnelLab({
      name:
        String(req.body?.name || "").trim() ||
        normalizedConfig.title ||
        "Lab mới",
      title: normalizedConfig.title || null,
      config_json: normalizedConfig,
      created_by_user_id: req.currentUser?.id || null,
    });
    return res.json({
      ok: true,
      item: row,
    });
  } catch (error) {
    console.error("[article-funnel-labs/create]", error);
    return res.status(500).json({ error: "Khong the tao lab" });
  }
});
app.put("/api/admin/article-funnel-labs/:id", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const existingLab = await database.getArticleFunnelLabById(req.params.id);
    if (!existingLab) {
      return res.status(404).json({ error: "Khong tim thay lab" });
    }
    if (!canManageArticleFunnelLab(req.currentUser, existingLab)) {
      return res.status(403).json({ error: "Khong co quyen sua lab nay" });
    }
    const rawConfig =
      req.body?.config && typeof req.body.config === "object"
        ? req.body.config
        : req.body?.config_json && typeof req.body.config_json === "object"
          ? req.body.config_json
          : req.body?.sourceDomain || req.body?.source_domain
            ? req.body
            : {};
    const updatePayload = {};
    if (Object.keys(rawConfig).length) {
      const normalizedConfig = normalizeArticleFunnelPreviewConfig(rawConfig);
      updatePayload.config_json = normalizedConfig;
      updatePayload.title = normalizedConfig.title || null;
      if (!req.body?.name) {
        updatePayload.name = normalizedConfig.title || "Lab mới";
      }
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "name")) {
      updatePayload.name = String(req.body?.name || "").trim() || "Lab mới";
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "published_route_slug")) {
      updatePayload.published_route_slug =
        String(req.body?.published_route_slug || "").trim() || null;
    }
    const row = await database.updateArticleFunnelLab(req.params.id, updatePayload);
    return res.json({
      ok: true,
      item: row,
    });
  } catch (error) {
    console.error("[article-funnel-labs/update]", error);
    return res.status(500).json({ error: "Khong the luu lab" });
  }
});
app.delete("/api/admin/article-funnel-labs/:id", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const existingLab = await database.getArticleFunnelLabById(req.params.id);
    if (!existingLab) {
      return res.status(404).json({ error: "Khong tim thay lab" });
    }
    if (!canManageArticleFunnelLab(req.currentUser, existingLab)) {
      return res.status(403).json({ error: "Khong co quyen xoa lab nay" });
    }
    await database.deleteArticleFunnelLab(req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    console.error("[article-funnel-labs/delete]", error);
    return res.status(500).json({ error: "Khong the xoa lab" });
  }
});
app.post("/api/admin/article-funnel-lab/preview-link", requireArticleFunnelLab, async (req, res) => {
  try {
    const rawConfig =
      req.body?.config && typeof req.body.config === "object"
        ? req.body.config
        : req.body;
    const previewConfig = await resolveArticleFunnelConfig(rawConfig);
    const expiresAt = Date.now() + ARTICLE_FUNNEL_PREVIEW_TOKEN_TTL_MS;
    const token = encodeArticleFunnelPreviewToken({
      v: 1,
      exp: expiresAt,
      config: previewConfig,
    });
    const previewSlug = normalizeArticleFunnelPreviewSlug(
      previewConfig.slug || previewConfig.title,
    );
    const previewUrl = `${BASE_URL}/_lab/article-funnel/${previewSlug}/${token}`;
    return res.json({
      ok: true,
      preview_url: previewUrl,
      expires_at: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    console.error("[article-funnel-lab/preview-link]", error);
    return res.status(500).json({ error: "Không thể tạo preview link" });
  }
});
app.post("/api/admin/article-funnel-lab/publish", requireArticleFunnelLab, async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const rawConfig =
      req.body?.config && typeof req.body.config === "object"
        ? req.body.config
        : req.body;
    const publishedConfig = await resolveArticleFunnelConfig(rawConfig);
    const routeSlug = normalizeArticleFunnelPreviewSlug(
      publishedConfig.slug || publishedConfig.title,
    );
    if (isReservedPublishedArticleSlug(routeSlug)) {
      return res.status(400).json({
        error: "Slug này đang thuộc nhóm route hệ thống, hãy đổi slug khác.",
      });
    }
    const conflictingLink = await findShortLinkSlugConflict(database, routeSlug);
    if (conflictingLink) {
      return res.status(409).json({
        error: `Slug /${routeSlug} đang được dùng bởi link rút gọn thường. Hãy đổi slug khác để tránh đè deeplink thường.`,
      });
    }
    const requestedDomainHostname = normalizeDomainHost(
      publishedConfig.source_domain,
    );
    const activeRequestedDomain = requestedDomainHostname
      ? await resolveActiveDomainHostname(database, requestedDomainHostname)
      : null;
    const fallbackDomainHostname = normalizeDomainHost(publicBaseUrl);
    const selectedDomainHostname =
      activeRequestedDomain || fallbackDomainHostname || null;
    const draftLabId = Number(req.body?.lab_id || 0);
    if (Number.isInteger(draftLabId) && draftLabId > 0) {
      const draftLab = await database.getArticleFunnelLabById(draftLabId);
      if (!draftLab) {
        return res.status(404).json({ error: "Khong tim thay lab de publish" });
      }
      if (!canManageArticleFunnelLab(req.currentUser, draftLab)) {
        return res.status(403).json({ error: "Khong co quyen publish lab nay" });
      }
    }
    const saved = await database.upsertArticleFunnel({
      route_slug: routeSlug,
      domain_hostname: selectedDomainHostname,
      title: publishedConfig.title || null,
      config_json: publishedConfig,
      created_by_user_id: req.currentUser?.id || null,
    });
    if (Number.isInteger(draftLabId) && draftLabId > 0) {
      try {
        await database.updateArticleFunnelLab(draftLabId, {
          name: String(req.body?.lab_name || "").trim() || publishedConfig.title || "Lab mới",
          title: publishedConfig.title || null,
          config_json: publishedConfig,
          published_route_slug: saved.route_slug,
        });
      } catch (labError) {
        console.error("[article-funnel-lab/publish-sync-draft]", labError);
      }
    }
    const publishedUrl = buildArticleFunnelPublicUrl(
      saved.route_slug,
      saved.domain_hostname,
      publicBaseUrl,
    );
    const publishedTest20sUrl = hasArticleFunnelStage(publishedConfig, "20s")
      ? buildArticleFunnelPopupTestUrl(
          saved.route_slug,
          saved.domain_hostname,
          publicBaseUrl,
          "20s",
        )
      : "";
    const domainNote =
      requestedDomainHostname && requestedDomainHostname !== selectedDomainHostname
        ? `Domain ${requestedDomainHostname} chua nam trong danh sach domain dang hoat dong, da fallback sang ${selectedDomainHostname || normalizeDomainHost(BASE_URL) || "domain mac dinh"}.`
        : "";
    return res.json({
      ok: true,
      published_url: publishedUrl,
      published_test_20s_url: publishedTest20sUrl,
      route_slug: saved.route_slug,
      domain_hostname: saved.domain_hostname || "",
      domain_note: domainNote,
      updated_at: saved.updated_at || saved.created_at || new Date().toISOString(),
    });
  } catch (error) {
    console.error("[article-funnel-lab/publish]", error);
    return res.status(500).json({ error: "Khong the publish article funnel" });
  }
});
app.post("/api/article-funnel/track-click", async (req, res) => {
  try {
    const routeSlug = String(
      req.body?.route_slug || req.body?.routeSlug || "",
    ).trim();
    const stageKey = normalizeArticleFunnelStageKey(
      req.body?.stage_key || req.body?.stageKey || "",
    );
    if (!routeSlug || !stageKey) {
      return res.status(400).json({
        error: "route_slug va stage_key la bat buoc",
      });
    }

    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const articleFunnel = await database.getArticleFunnelBySlug(routeSlug);
    if (
      !articleFunnel ||
      !canServePublishedArticleFunnelOnHost(
        articleFunnel,
        getRequestHostname(req),
        publicBaseUrl,
      )
    ) {
      return res.status(404).json({ error: "Khong tim thay article funnel" });
    }

    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const stage = (config.stages || []).find(
      (item) => String(item?.stage_key || "").trim() === stageKey,
    );
    if (!stage) {
      return res.status(404).json({ error: "Khong tim thay popup stage" });
    }

    const result = await recordArticleFunnelStageClick({
      database,
      req,
      tracking: {
        articleFunnelId: articleFunnel.id,
        routeSlug: articleFunnel.route_slug,
      },
      stageKey,
    });
    return res.json({
      ok: true,
      route_slug: articleFunnel.route_slug,
      stage_key: stageKey,
      ...result,
    });
  } catch (error) {
    console.error("[article-funnel/track-click]", error);
    return res.status(500).json({ error: "Khong the ghi nhan click" });
  }
});
app.get(
  ["/_lab/article-funnel/:slug/:token", "/_lab/article-funnel/:slug/:token/"],
  async (req, res) => {
  try {
    const showPopupTestButton = await isAdminRequest(req);
    const payload = decodeArticleFunnelPreviewToken(req.params.token);
    const config = normalizeArticleFunnelPreviewConfig(payload?.config || {});
    const canonicalUrl = `${BASE_URL}/_lab/article-funnel/${encodeURIComponent(req.params.slug || "article-preview")}/${req.params.token}`;
    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "text/html;charset=utf-8",
    });
    return res.send(
      buildArticleFunnelPreviewPage(
        config,
        canonicalUrl,
        `/_lab/article-funnel-launch/${encodeURIComponent(req.params.slug || "article-preview")}/${req.params.token}`,
        { showPopupTestButton },
        `/_lab/article-funnel-bridge/${encodeURIComponent(req.params.slug || "article-preview")}/${req.params.token}`,
      ),
    );
  } catch (error) {
    const code = String(error?.message || "");
    const status =
      code === "PREVIEW_TOKEN_EXPIRED" || code.startsWith("INVALID_PREVIEW_")
        ? 400
        : 500;
    return res.status(status).send("Preview link không hợp lệ hoặc đã hết hạn");
  }
});
app.get(
  [
    "/_lab/article-funnel-launch/:slug/:token/:stageKey",
    "/_lab/article-funnel-launch/:slug/:token/:stageKey/",
  ],
  async (req, res) => {
    try {
      const payload = decodeArticleFunnelPreviewToken(req.params.token);
      const config = normalizeArticleFunnelPreviewConfig(payload?.config || {});
      const canonicalUrl = `${BASE_URL}/_lab/article-funnel-launch/${encodeURIComponent(req.params.slug || "article-preview")}/${req.params.token}/${encodeURIComponent(req.params.stageKey || "")}`;
      return await handleArticleFunnelStageLaunch({
        req,
        res,
        config,
        stageKey: String(req.params.stageKey || "").trim(),
        canonicalUrl,
      });
    } catch (error) {
      const code = String(error?.message || "");
      const status =
        code === "PREVIEW_TOKEN_EXPIRED" || code.startsWith("INVALID_PREVIEW_")
          ? 400
          : 500;
      return res.status(status).send("Launch link khong hop le hoac da het han");
    }
  },
);
app.get(
  [
    "/_lab/article-funnel-bridge/:slug/:token/:stageKey",
    "/_lab/article-funnel-bridge/:slug/:token/:stageKey/",
  ],
  async (req, res) => {
    try {
      const payload = decodeArticleFunnelPreviewToken(req.params.token);
      const config = normalizeArticleFunnelPreviewConfig(payload?.config || {});
      const canonicalUrl = `${BASE_URL}/_lab/article-funnel-bridge/${encodeURIComponent(req.params.slug || "article-preview")}/${req.params.token}/${encodeURIComponent(req.params.stageKey || "")}`;
      return await handleArticleFunnelStageLaunch({
        req,
        res,
        config,
        stageKey: String(req.params.stageKey || "").trim(),
        canonicalUrl,
        launchOptions: {
          preferPopup20sDirectBridgeFlow: true,
        },
      });
    } catch (error) {
      const code = String(error?.message || "");
      const status =
        code === "PREVIEW_TOKEN_EXPIRED" || code.startsWith("INVALID_PREVIEW_")
          ? 400
          : 500;
      return res.status(status).send("Bridge link khong hop le hoac da het han");
    }
  },
);
app.get(["/af/:slug", "/af/:slug/"], async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const articleFunnel = await database.getArticleFunnelBySlug(req.params.slug);
    if (!articleFunnel) {
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const showPopupTestButton =
      (await isAdminRequest(req)) ||
      isArticleFunnelPopupTestRequestAllowed(
        req,
        articleFunnel.route_slug,
        "20s",
      );
    const canonicalUrl = buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    );
    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "text/html;charset=utf-8",
    });
    return res.send(
      buildArticleFunnelPreviewPage(
        config,
        canonicalUrl,
        buildArticleFunnelLaunchBasePath(articleFunnel.route_slug),
        {
          routeSlug: articleFunnel.route_slug,
          showPopupTestButton,
        },
        buildArticleFunnelBridgeBasePath(articleFunnel.route_slug),
      ),
    );
  } catch (error) {
    console.error("[article-funnel/published]", error);
    return res.status(500).send("Khong the mo article funnel");
  }
});
app.get(["/af-bridge/:slug/:stageKey", "/af-bridge/:slug/:stageKey/"], async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const articleFunnel = await database.getArticleFunnelBySlug(req.params.slug);
    if (!articleFunnel) {
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const canonicalUrl = `${buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    ).replace(/\/+$/, "")}/bridge/${encodeURIComponent(req.params.stageKey || "")}`;
    return await handleArticleFunnelStageLaunch({
      req,
      res,
      config,
      stageKey: String(req.params.stageKey || "").trim(),
      canonicalUrl,
      tracking: {
        articleFunnelId: articleFunnel.id,
        routeSlug: articleFunnel.route_slug,
      },
      launchOptions: {
        preferPopup20sDirectBridgeFlow: true,
      },
    });
  } catch (error) {
    console.error("[article-funnel/published-bridge]", error);
    return res.status(500).send("Khong the mo article funnel bridge");
  }
});
app.get(["/af-launch/:slug/:stageKey", "/af-launch/:slug/:stageKey/"], async (req, res) => {
  try {
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const articleFunnel = await database.getArticleFunnelBySlug(req.params.slug);
    if (!articleFunnel) {
      return res
        .status(404)
        .sendFile(path.join(__dirname, "..", "public", "404.html"));
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const canonicalUrl = `${buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    ).replace(/\/+$/, "")}/launch/${encodeURIComponent(req.params.stageKey || "")}`;
    return await handleArticleFunnelStageLaunch({
      req,
      res,
      config,
      stageKey: String(req.params.stageKey || "").trim(),
      canonicalUrl,
      tracking: {
        articleFunnelId: articleFunnel.id,
        routeSlug: articleFunnel.route_slug,
      },
    });
  } catch (error) {
    console.error("[article-funnel/published-launch]", error);
    return res.status(500).send("Khong the launch article funnel");
  }
});
app.get(["/:slug/bridge/:stageKey", "/:slug/bridge/:stageKey/"], async (req, res, next) => {
  try {
    const routeSlug = String(req.params.slug || "").trim();
    if (isReservedPublishedArticleSlug(routeSlug)) {
      return next();
    }
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const conflictingLink = await findShortLinkSlugConflict(database, routeSlug);
    if (conflictingLink) {
      return next();
    }
    const articleFunnel = await database.getArticleFunnelBySlug(routeSlug);
    if (
      !articleFunnel ||
      !canServePublishedArticleFunnelOnHost(
        articleFunnel,
        getRequestHostname(req),
        publicBaseUrl,
      )
    ) {
      return next();
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const canonicalUrl = `${buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    ).replace(/\/+$/, "")}/bridge/${encodeURIComponent(req.params.stageKey || "")}`;
    return await handleArticleFunnelStageLaunch({
      req,
      res,
      config,
      stageKey: String(req.params.stageKey || "").trim(),
      canonicalUrl,
      tracking: {
        articleFunnelId: articleFunnel.id,
        routeSlug: articleFunnel.route_slug,
      },
      launchOptions: {
        preferPopup20sDirectBridgeFlow: true,
      },
    });
  } catch (error) {
    console.error("[article-funnel/published-bridge-direct]", error);
    return res.status(500).send("Khong the mo article funnel bridge");
  }
});
app.get(["/:slug/launch/:stageKey", "/:slug/launch/:stageKey/"], async (req, res, next) => {
  try {
    const routeSlug = String(req.params.slug || "").trim();
    if (isReservedPublishedArticleSlug(routeSlug)) {
      return next();
    }
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const conflictingLink = await findShortLinkSlugConflict(database, routeSlug);
    if (conflictingLink) {
      return next();
    }
    const articleFunnel = await database.getArticleFunnelBySlug(routeSlug);
    if (
      !articleFunnel ||
      !canServePublishedArticleFunnelOnHost(
        articleFunnel,
        getRequestHostname(req),
        publicBaseUrl,
      )
    ) {
      return next();
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const canonicalUrl = `${buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    ).replace(/\/+$/, "")}/launch/${encodeURIComponent(req.params.stageKey || "")}`;
    return await handleArticleFunnelStageLaunch({
      req,
      res,
      config,
      stageKey: String(req.params.stageKey || "").trim(),
      canonicalUrl,
      tracking: {
        articleFunnelId: articleFunnel.id,
        routeSlug: articleFunnel.route_slug,
      },
    });
  } catch (error) {
    console.error("[article-funnel/published-launch-direct]", error);
    return res.status(500).send("Khong the launch article funnel");
  }
});
app.get("/:slug", async (req, res, next) => {
  try {
    const routeSlug = String(req.params.slug || "").trim();
    if (isReservedPublishedArticleSlug(routeSlug)) {
      return next();
    }
    const database = await getDb();
    const publicBaseUrl = await getPublicBaseUrl();
    const articleFunnel = await database.getArticleFunnelBySlug(routeSlug);
    if (
      !articleFunnel ||
      !canServePublishedArticleFunnelOnHost(
        articleFunnel,
        getRequestHostname(req),
        publicBaseUrl,
      )
    ) {
      return next();
    }
    const config = normalizeArticleFunnelPreviewConfig(
      articleFunnel.config_json || {},
    );
    const showPopupTestButton =
      (await isAdminRequest(req)) ||
      isArticleFunnelPopupTestRequestAllowed(
        req,
        articleFunnel.route_slug,
        "20s",
      );
    const canonicalUrl = buildArticleFunnelPublicUrl(
      articleFunnel.route_slug,
      articleFunnel.domain_hostname,
      publicBaseUrl,
    );
    res.set({
      "Cache-Control": "no-store",
      "Content-Type": "text/html;charset=utf-8",
    });
    return res.send(
      buildArticleFunnelPreviewPage(
        config,
        canonicalUrl,
        buildArticleFunnelLaunchBasePath(articleFunnel.route_slug),
        {
          routeSlug: articleFunnel.route_slug,
          showPopupTestButton,
        },
        buildArticleFunnelBridgeBasePath(articleFunnel.route_slug),
      ),
    );
  } catch (error) {
    console.error("[article-funnel/published-direct]", error);
    return res.status(500).send("Khong the mo article funnel");
  }
});
app.get("/favicon.ico", (_req, res) => {
  res.type("image/svg+xml");
  res.sendFile(path.join(__dirname, "..", "public", "favicon.svg"));
});

app.use(
  express.static(path.join(__dirname, "..", "public"), {
    index: false,
  }),
);

app.get("/robots.txt", (_, res) => {
  res.set("Content-Type", "text/plain");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /api/",
      "Disallow: /dashboard",
      "Disallow: /links",
      "Disallow: /create",
      "Disallow: /qr",
      "Disallow: /bio",
      "Disallow: /integrations",
      "Disallow: /team",
      "Disallow: /pricing",
      "Disallow: /stats",
      "Disallow: /account",
      "Disallow: /admin",
      "Disallow: /app",
      "Disallow: /index.html",
      `Sitemap: ${BASE_URL}/sitemap.xml`,
      "",
    ].join("\n"),
  );
});

app.get("/sitemap.xml", (_req, res) => {
  const sitemapEntries = [
    {
      loc: `${BASE_URL}/`,
      lastmod: fs
        .statSync(path.join(__dirname, "..", "public", "landing.html"))
        .mtime.toISOString(),
      changefreq: "weekly",
      priority: "1.0",
    },
    ...publicResourcePages.map((page) => ({
      loc: `${BASE_URL}${page.pathname}`,
      lastmod: fs.statSync(page.templatePath).mtime.toISOString(),
      changefreq: page.changefreq || "monthly",
      priority: page.priority || "0.8",
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapEntries
  .map(
    (entry) => `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
    <lastmod>${entry.lastmod}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>`;
  res.type("application/xml").send(xml);
});

// ── Multer ───────────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, "..", "public", "uploads");
try {
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
} catch (_) {}

const memStorage = multer.memoryStorage();
const CLOUDINARY_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const CLOUDINARY_VIDEO_FOLDER = "rutgonlink/videos";
const VIDEO_REMOTE_UPLOAD_OK = R2_VIDEO_OK || CLOUDINARY_OK;

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
  storage: VIDEO_REMOTE_UPLOAD_OK
    ? memStorage
    : multer.diskStorage({
        destination: (_, __, cb) => cb(null, uploadsDir),
        filename: (_, file, cb) =>
          cb(null, nanoid(12) + path.extname(file.originalname).toLowerCase()),
      }),
  limits: { fileSize: CLOUDINARY_VIDEO_MAX_BYTES },
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

const VIDEO_EXT_TO_CONTENT_TYPE = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
};

const VIDEO_CONTENT_TYPE_TO_EXT = {
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
};

function normalizeVideoUploadExt(originalName = "", contentType = "") {
  const inputExt = path.extname(String(originalName || "")).toLowerCase();
  if (VIDEO_EXT_TO_CONTENT_TYPE[inputExt]) return inputExt;
  const normalizedType = String(contentType || "")
    .trim()
    .toLowerCase()
    .split(";")[0];
  return VIDEO_CONTENT_TYPE_TO_EXT[normalizedType] || null;
}

function normalizeVideoUploadContentType(originalName = "", contentType = "") {
  const normalizedType = String(contentType || "")
    .trim()
    .toLowerCase()
    .split(";")[0];
  if (VIDEO_CONTENT_TYPE_TO_EXT[normalizedType]) return normalizedType;
  const ext = normalizeVideoUploadExt(originalName, contentType);
  return VIDEO_EXT_TO_CONTENT_TYPE[ext] || "application/octet-stream";
}

function buildR2VideoObjectKey(originalName = "", contentType = "") {
  const ext = normalizeVideoUploadExt(originalName, contentType);
  if (!ext) {
    throw new Error("VIDEO_TYPE_NOT_SUPPORTED");
  }
  return `${R2_VIDEO_PREFIX}/${nanoid(16)}${ext}`;
}

function buildR2VideoPublicUrl(key = "") {
  return `${R2_VIDEO_PUBLIC_BASE_URL}/${String(key || "").replace(/^\/+/, "")}`;
}

async function createR2VideoUploadSignature({
  originalName = "",
  contentType = "",
} = {}) {
  if (!R2_VIDEO_OK || !r2VideoClient) {
    throw new Error("R2_VIDEO_NOT_CONFIGURED");
  }
  const key = buildR2VideoObjectKey(originalName, contentType);
  const normalizedContentType = normalizeVideoUploadContentType(
    originalName,
    contentType,
  );
  const command = new PutObjectCommand({
    Bucket: R2_VIDEO_BUCKET,
    Key: key,
    ContentType: normalizedContentType,
  });
  const uploadUrl = await getSignedUrl(r2VideoClient, command, {
    expiresIn: 15 * 60,
  });
  return {
    provider: "r2",
    key,
    uploadUrl,
    publicUrl: buildR2VideoPublicUrl(key),
    contentType: normalizedContentType,
  };
}

async function uploadVideoBufferToR2(
  fileBuffer,
  { originalName = "", contentType = "" } = {},
) {
  if (!R2_VIDEO_OK || !r2VideoClient) {
    throw new Error("R2_VIDEO_NOT_CONFIGURED");
  }
  const key = buildR2VideoObjectKey(originalName, contentType);
  const normalizedContentType = normalizeVideoUploadContentType(
    originalName,
    contentType,
  );
  await r2VideoClient.send(
    new PutObjectCommand({
      Bucket: R2_VIDEO_BUCKET,
      Key: key,
      Body: fileBuffer,
      ContentType: normalizedContentType,
    }),
  );
  return {
    key,
    url: buildR2VideoPublicUrl(key),
    thumb: null,
    source: "r2",
  };
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
    return buildShortUrl(
      `https://${domainHostname}`,
      link.alias || link.short_code,
    );
  }
  return buildShortUrl(fallbackBaseUrl, link.alias || link.short_code);
}

function buildVideoLaunchUrl(link) {
  const code = encodeURIComponent(link?.alias || link?.short_code || "");
  if (!code) return "/go";
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

async function resolveActiveDomainHostname(database, input) {
  const normalizedHostname = normalizeDomainHost(input);
  if (!normalizedHostname) return null;
  const activeDomains = await database.getActiveDomains();
  const matchedDomain = activeDomains.find(
    (domain) => domain.hostname === normalizedHostname,
  );
  if (!matchedDomain) return null;
  return matchedDomain.hostname;
}

async function resolveVideoLinkDomainHostname(database) {
  const preferredHostname = normalizeDomainHost(VIDEO_LINK_DOMAIN);
  if (!preferredHostname) return null;
  return resolveActiveDomainHostname(database, preferredHostname);
}

function normalizeAffiliatePresetUrl(input, platform = "") {
  const raw = String(input || "").trim();
  if (!raw) return null;
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(normalized);
    if (!/^https?:$/i.test(url.protocol)) return null;
    const hostname = url.hostname.toLowerCase();
    const targetPlatform = String(platform || "")
      .trim()
      .toLowerCase();
    if (targetPlatform === "shopee") {
      if (
        hostname !== "shopee.vn" &&
        !hostname.endsWith(".shopee.vn") &&
        hostname !== "s.shopee.vn" &&
        hostname !== "shp.ee"
      ) {
        return null;
      }
    } else if (targetPlatform === "tiktok") {
      if (
        hostname !== "tiktok.com" &&
        !hostname.endsWith(".tiktok.com") &&
        hostname !== "vm.tiktok.com" &&
        hostname !== "vt.tiktok.com" &&
        !isTikTokOneLinkHostname(hostname)
      ) {
        return null;
      }
    } else if (!isAffiliateShortenUrl(url.toString())) {
      return null;
    }
    return url.toString().slice(0, AFFILIATE_PRESET_MAX_LENGTH);
  } catch {
    return null;
  }
}

function inferAffiliatePlatformFromUrl(input = "") {
  try {
    const normalized = /^https?:\/\//i.test(String(input || "").trim())
      ? String(input || "").trim()
      : `https://${String(input || "").trim()}`;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === "shopee.vn" ||
      hostname.endsWith(".shopee.vn") ||
      hostname === "s.shopee.vn" ||
      hostname === "shp.ee"
    ) {
      return "shopee";
    }
    if (
      hostname === "tiktok.com" ||
      hostname.endsWith(".tiktok.com") ||
      hostname === "vm.tiktok.com" ||
      hostname === "vt.tiktok.com" ||
      isTikTokOneLinkHostname(hostname)
    ) {
      return "tiktok";
    }
  } catch {}
  return "generic";
}

function isSessionRevokedForUser(user, tokenPayload) {
  const revokedAt = user?.session_revoked_after
    ? new Date(user.session_revoked_after).getTime()
    : 0;
  const issuedAt = Number(tokenPayload?.iat || 0) * 1000;
  if (!revokedAt || !issuedAt) return false;
  return issuedAt <= revokedAt;
}

async function resolveUserFromTokenPayload(tokenPayload) {
  if (!tokenPayload?.id) return null;
  const database = await getDb();
  const user = await database.getUserById(tokenPayload.id);
  if (!user) return null;
  if (isSessionRevokedForUser(user, tokenPayload)) {
    return null;
  }
  if (user.role === "admin" || isAdminEmail(user.email)) {
    user.plan = "admin";
    user.role = "admin";
  }
  return user;
}

async function fetchAffiliateHealth(url) {
  const checkedAt = new Date().toISOString();
  const input = String(url || "").trim();
  if (!input) {
    return {
      alive: false,
      checked_at: checkedAt,
      note: "Thiếu URL affiliate để kiểm tra",
      final_url: "",
      status: 0,
    };
  }
  const platform = inferAffiliatePlatformFromUrl(input);
  const requestHeaders = {
    "user-agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "accept-language": "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
    "cache-control": "no-cache",
  };
  const attempts = [
    { method: "HEAD", redirect: "manual" },
    { method: "GET", redirect: "manual" },
    { method: "GET", redirect: "follow" },
  ];
  let lastErrorMessage = "";

  for (const attempt of attempts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(input, {
        method: attempt.method,
        redirect: attempt.redirect,
        signal: controller.signal,
        headers: requestHeaders,
      });
      const status = response.status || 0;
      const locationHeader = response.headers.get("location");
      const redirectedUrl = locationHeader
        ? new URL(locationHeader, input).toString()
        : "";
      const finalUrl =
        attempt.redirect === "follow"
          ? response.url || redirectedUrl || input
          : redirectedUrl || input;
      const detectedPlatform =
        inferAffiliatePlatformFromUrl(finalUrl) || platform;
      const hasRedirect = status >= 300 && status < 400;
      const botProtected = status === 401 || status === 403 || status === 405;
      const definitelyDead = status === 404 || status === 410;
      const likelyAlive =
        response.ok || hasRedirect || (botProtected && platform !== "generic");

      if (!likelyAlive && !definitelyDead) {
        lastErrorMessage = `Link trả về HTTP ${status}.`;
        continue;
      }

      return {
        alive: likelyAlive,
        checked_at: checkedAt,
        status,
        final_url: finalUrl,
        platform: detectedPlatform,
        note: response.ok
          ? "Link affiliate phản hồi bình thường."
          : hasRedirect
            ? "Link affiliate vẫn chuyển hướng bình thường."
            : botProtected
              ? "Link có phản hồi nhưng nền tảng đang chặn bot kiểm tra tự động."
              : `Link trả về HTTP ${status}.`,
      };
    } catch (error) {
      lastErrorMessage =
        error?.name === "AbortError"
          ? "Kiểm tra bị timeout."
          : "Không thể kết nối tới link affiliate.";
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return {
    alive: false,
    checked_at: checkedAt,
    final_url: input,
    status: 0,
    platform,
    note: lastErrorMessage || "Không thể kiểm tra link affiliate.",
  };
}

function buildVideoMetadataResponseSchema() {
  return {
    name: "video_metadata",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        title: {
          type: "string",
          description:
            "Tiêu đề ngắn gọn, đúng nội dung video, tối đa 120 ký tự.",
        },
        description: {
          type: "string",
          description: "Mô tả ngắn để hiển thị khi share, tối đa 200 ký tự.",
        },
      },
      required: ["title", "description"],
    },
  };
}

async function generateVideoMetadataSuggestion({
  originalUrl,
  videoUrl,
  imageUrl,
  overlayText,
  language = "vi",
  userId,
}) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY_NOT_CONFIGURED");
  }
  const targetLanguage = language === "en" ? "English" : "Vietnamese";
  const content = [
    {
      type: "input_text",
      text:
        "Bạn là trợ lý viết metadata cho link chia sẻ video affiliate. " +
        `Hãy tạo 1 tiêu đề và 1 mô tả bằng ${targetLanguage}. ` +
        "Không bịa thông tin nếu không thấy rõ. Ưu tiên nội dung nhìn thấy trong thumbnail/video và ngữ cảnh URL. " +
        "Tiêu đề phải tự nhiên, rõ nghĩa, bán hàng vừa phải và phù hợp để tạo alias slug. " +
        "Mô tả ngắn, súc tích, không spam hashtag, không dùng emoji quá mức. " +
        "Nếu thông tin chưa chắc chắn, hãy viết an toàn nhưng vẫn hữu ích.",
    },
    {
      type: "input_text",
      text:
        `URL gốc: ${String(originalUrl || "").trim() || "Không có"}\n` +
        `URL video: ${String(videoUrl || "").trim() || "Không có"}\n` +
        `Overlay text hiện tại: ${String(overlayText || "").trim() || "Không có"}`,
    },
  ];
  if (imageUrl) {
    content.push({
      type: "input_image",
      image_url: imageUrl,
      detail: "high",
    });
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_VIDEO_METADATA_MODEL,
      input: [
        {
          role: "user",
          content,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: buildVideoMetadataResponseSchema().name,
          strict: true,
          schema: buildVideoMetadataResponseSchema().schema,
        },
        verbosity: "low",
      },
      max_output_tokens: 220,
      safety_identifier: userId ? `rutgonlink-user-${userId}` : undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.error ||
      "OpenAI không trả về metadata hợp lệ.";
    throw new Error(message);
  }
  const parsed = JSON.parse(String(data.output_text || "{}"));
  return {
    title: normalizeShareTitleInput(parsed?.title, 120) || "",
    description: String(parsed?.description || "")
      .trim()
      .slice(0, 200),
    model: data.model || OPENAI_VIDEO_METADATA_MODEL,
  };
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
  return [
    ...new Set(value.map((item) => String(item || "").trim()).filter(Boolean)),
  ];
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
    const ordered = source.order
      .map((code) => byCode.get(code))
      .filter(Boolean);
    if (ordered.length) return ordered;
  }

  const limit = Math.max(1, Number(profile.link_count || 8));
  const base = (source.mode === "all" ? pool : pool.slice(0, limit)).filter(
    Boolean,
  );
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
    return await resolveUserFromTokenPayload(payload);
  } catch {
    return null;
  }
}

async function requireAuth(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await resolveUserFromTokenPayload(payload);
    if (!user) {
      res.clearCookie("token");
      return res
        .status(401)
        .json({ error: "Phiên đăng nhập không còn hợp lệ" });
    }
    req._tokenPayload = payload;
    req.currentUser = user;
    next();
  } catch {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

async function isAdminRequest(req) {
  const user = await resolveUser(req);
  return Boolean(user && (user.role === "admin" || isAdminEmail(user.email)));
}

function isAdminUserRecord(user) {
  return Boolean(user && (user.role === "admin" || isAdminEmail(user.email)));
}

function canUseArticleFunnelLab(user) {
  return isAdminUserRecord(user) || !!user?.can_use_lab;
}

function canManageArticleFunnelLab(user, labRow) {
  if (isAdminUserRecord(user)) return true;
  const ownerUserId = Number(labRow?.created_by_user_id || 0);
  return ownerUserId > 0 && ownerUserId === Number(user?.id || 0);
}

async function requireAdmin(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await resolveUserFromTokenPayload(payload);
    const isAdmin = user?.role === "admin" || isAdminEmail(user?.email);
    if (!user || !isAdmin) {
      return res.status(403).json({ error: "Không có quyền quản trị" });
    }
    req._tokenPayload = payload;
    req.currentUser = user;
    next();
  } catch {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

async function requireArticleFunnelLab(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await resolveUserFromTokenPayload(payload);
    if (!user || !canUseArticleFunnelLab(user)) {
      return res.status(403).json({ error: "Không có quyền dùng lab" });
    }
    req._tokenPayload = payload;
    req.currentUser = user;
    next();
  } catch {
    return res.status(401).json({ error: "Token không hợp lệ" });
  }
}

function isSupportRole(role) {
  return String(role || "")
    .trim()
    .toLowerCase() === "support";
}

function canAccessSupportInbox(user) {
  if (!user) return false;
  return (
    user.role === "admin" || isAdminEmail(user.email) || isSupportRole(user.role)
  );
}

async function requireSupportInbox(req, res, next) {
  const token = parseToken(req);
  if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await resolveUserFromTokenPayload(payload);
    if (!user || !canAccessSupportInbox(user)) {
      return res
        .status(403)
        .json({ error: "Không có quyền truy cập hộp thư hỗ trợ" });
    }
    req._tokenPayload = payload;
    req.currentUser = user;
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

function persistRedirectLogEntry(entry) {
  redirectLogWriteQueue = redirectLogWriteQueue
    .then(async () => {
      const database = await getDb();
      await database.createRedirectLogEntry(entry);
    })
    .catch((error) => {
      const message = String(error?.message || error || "").trim();
      if (/fetch failed/i.test(message)) {
        return;
      }
      console.error(`[redirect-log] ${message || "unknown error"}`);
    });
}

async function readRecentRedirectLogEntries(limit = 20) {
  await redirectLogWriteQueue;
  const database = await getDb();
  return database.listRedirectLogEntries(limit);
}

const TIKTOK_ANDROID_PACKAGE = "com.ss.android.ugc.trill";
const TIKTOK_APP_STORE_ID = "1235601864";
const SHOPEE_ANDROID_PACKAGE = "com.shopee.vn";
const SHOPEE_APP_STORE_ID = "959841449";
const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID || "1609970790226254";

function isTikTokOneLinkHostname(hostname = "") {
  const normalizedHostname = String(hostname || "").trim().toLowerCase();
  return (
    normalizedHostname === "snssdk1180.onelink.me" ||
    normalizedHostname.endsWith(".onelink.me")
  );
}

function isTikTokShortShareUrl(input = "") {
  try {
    const normalized = /^https?:\/\//i.test(String(input || "").trim())
      ? String(input || "").trim()
      : `https://${String(input || "").trim()}`;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === "vm.tiktok.com" ||
      hostname === "vt.tiktok.com" ||
      isTikTokOneLinkHostname(hostname)
    );
  } catch {
    return false;
  }
}

function isTikTokProductUrl(input = "") {
  try {
    const normalized = /^https?:\/\//i.test(String(input || "").trim())
      ? String(input || "").trim()
      : `https://${String(input || "").trim()}`;
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase();
    if (
      hostname !== "tiktok.com" &&
      !hostname.endsWith(".tiktok.com") &&
      !isTikTokOneLinkHostname(hostname)
    ) {
      return false;
    }
    return /\/view\/product\/\d+/i.test(url.pathname);
  } catch {
    return false;
  }
}

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
    const productMatch = path.match(/\/view\/product\/(\d+)/);
    const queryProductId =
      url.searchParams.get("product_id") ||
      url.searchParams.get("productId") ||
      url.searchParams.get("item_id") ||
      url.searchParams.get("itemId") ||
      "";
    const productId = productMatch?.[1] || queryProductId || "";
    if (productId) {
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
  let hostname = "";
  try {
    hostname = new URL(String(originalUrl || "").trim()).hostname.toLowerCase();
  } catch {}
  // ── Shopee product: -i.<shopId>.<itemId>
  const sp = originalUrl.match(/shopee\.vn\/.*?-i\.(\d+)\.(\d+)/i);
  if (sp) {
    const [, shopId, itemId] = sp;
    let hasTrackingQuery = false;
    try {
      hasTrackingQuery =
        new URL(originalUrl).searchParams.toString().length > 0;
    } catch {}
    // Universal Link – OS tự mở app, không cần JS trick
    const universalLink = `https://shopee.vn/universal-link/product/${shopId}/${itemId}`;
    const shopeeTarget = hasTrackingQuery ? originalUrl : universalLink;
    return {
      // Với link có query tracking affiliate, giữ nguyên original URL để
      // không làm rơi tham số hoa hồng khi redirect sang Shopee/App Links.
      deeplink: shopeeTarget,
      deeplink_ios: shopeeTarget,
      deeplink_android: shopeeTarget,
      platform_name: "shopee",
      fallback: originalUrl,
      ios_store: `https://apps.apple.com/vn/app/shopee-vn/id${SHOPEE_APP_STORE_ID}`,
      play_store: `https://play.google.com/store/apps/details?id=${SHOPEE_ANDROID_PACKAGE}`,
    };
  }

  // ── Shopee generic (shop page, search, v.v.)
  if (hostname === "shopee.vn" || hostname.endsWith(".shopee.vn")) {
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
  if (
    hostname === "tiktok.com" ||
    hostname.endsWith(".tiktok.com") ||
    hostname === "vm.tiktok.com" ||
    hostname === "vt.tiktok.com" ||
    isTikTokOneLinkHostname(hostname)
  ) {
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

function appendAliasSuffix(alias, suffix, maxLength = 40) {
  const baseAlias = sanitizeAliasInput(alias, maxLength);
  const suffixAlias = sanitizeAliasInput(suffix, Math.max(8, maxLength));
  if (!baseAlias) return suffixAlias.slice(0, maxLength);
  if (!suffixAlias) return baseAlias;
  const trimmedBase = baseAlias
    .slice(0, Math.max(1, maxLength - suffixAlias.length - 1))
    .replace(/-+$/g, "");
  return `${trimmedBase}-${suffixAlias}`
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

async function ensureAvailableAlias(
  database,
  requestedAlias,
  { allowAutoSuffix = false } = {},
) {
  let normalizedAlias = sanitizeAliasInput(requestedAlias, 40);
  if (!normalizedAlias) return null;
  if (normalizedAlias.length < 2) return normalizedAlias;
  const existing =
    (await database.getLinkByAlias(normalizedAlias)) ||
    (await database.getLinkByCode(normalizedAlias));
  if (!existing) return normalizedAlias;
  if (!allowAutoSuffix) return null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const candidate = appendAliasSuffix(
      normalizedAlias,
      nanoid(3).toLowerCase(),
      40,
    );
    if (!candidate || candidate.length < 2) continue;
    const duplicate =
      (await database.getLinkByAlias(candidate)) ||
      (await database.getLinkByCode(candidate));
    if (!duplicate) return candidate;
  }
  return null;
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
    !/\s/.test(compact) && /[-_]/.test(compact) && !compact.includes("://");
  return looksLikeSlug
    ? humanizeSlugTitle(compact, maxLength)
    : compact.slice(0, maxLength);
}

function normalizeCountryCode(input) {
  const value = String(input || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return null;
  if (value === "XX" || value === "T1") return null;
  return value;
}

function getCountryNameFromCode(code) {
  if (!code) return null;
  return regionNamesVi?.of(code) || regionNamesEn?.of(code) || code;
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
    ) || getCountryNameFromCode(countryCode);
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

function isShopeeUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    const hostname = url.hostname.toLowerCase();
    return hostname === "shopee.vn" || hostname.endsWith(".shopee.vn");
  } catch {
    return false;
  }
}

const VIDEO_POPUP_STAGE_KEYS = ["3s", "5s", "300s"];

function normalizeVideoPopupUrlInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(normalized);
    if (!/^https?:$/i.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function parseVideoOverlayConfig(input) {
  const raw = String(input || "").trim();
  const fallback = {
    text: raw,
    popup_urls: { "3s": "", "5s": "", "300s": "" },
    is_structured: false,
  };
  if (!raw || !raw.startsWith("{")) return fallback;

  try {
    const parsed = JSON.parse(raw);
    const stageSource =
      parsed?.stage_urls ||
      parsed?.popup_urls ||
      parsed?.popup_links ||
      parsed?.popup_stage_urls ||
      {};
    return {
      text: String(parsed?.text || parsed?.overlay_text || "").trim(),
      popup_urls: {
        "3s": normalizeVideoPopupUrlInput(stageSource["3s"]),
        "5s": normalizeVideoPopupUrlInput(stageSource["5s"]),
        "300s": normalizeVideoPopupUrlInput(stageSource["300s"]),
      },
      is_structured: true,
    };
  } catch {
    return fallback;
  }
}

function buildVideoOverlayConfigStorage(inputText, popupUrls = {}) {
  const text = String(inputText || "").trim();
  const normalizedPopupUrls = {
    "3s": normalizeVideoPopupUrlInput(popupUrls["3s"]),
    "5s": normalizeVideoPopupUrlInput(popupUrls["5s"]),
    "300s": normalizeVideoPopupUrlInput(popupUrls["300s"]),
  };
  const hasPopupUrls = VIDEO_POPUP_STAGE_KEYS.some(
    (stageKey) => !!normalizedPopupUrls[stageKey],
  );
  if (!hasPopupUrls) {
    return text || null;
  }
  return JSON.stringify({
    version: 1,
    text,
    stage_urls: normalizedPopupUrls,
  });
}

function attachVideoOverlayPublicFields(entity) {
  if (!entity || typeof entity !== "object") return entity;
  const overlayConfig = parseVideoOverlayConfig(entity.video_overlay_text);
  return {
    ...entity,
    video_overlay_text: overlayConfig.text || "",
    video_popup_url_3s: overlayConfig.popup_urls["3s"] || "",
    video_popup_url_5s: overlayConfig.popup_urls["5s"] || "",
    video_popup_url_300s: overlayConfig.popup_urls["300s"] || "",
  };
}

async function resolveShopeeShortUrl(input) {
  try {
    const url = new URL(String(input || "").trim());
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "s.shopee.vn") return input;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "user-agent":
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        },
      });
      return response.url || input;
    } finally {
      clearTimeout(timeoutId);
    }
  } catch {
    return input;
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

const UNIQUE_CLICK_WINDOW_MS = 30 * 60 * 1000;

function getAnalyticsVisitorKey(row = {}) {
  const linkId = Number(row?.link_id || row?.links?.id || 0) || 0;
  const ip = String(row?.ip || "").trim() || "no-ip";
  const ua = String(row?.user_agent || "").trim() || "no-ua";
  return `${linkId}:${ip}:${ua}`;
}

function accumulateAnalyticsMaps(
  target,
  row,
  { unique = false, dayKey = "", platform = null } = {},
) {
  if (dayKey) {
    target.timelineMap.set(dayKey, (target.timelineMap.get(dayKey) || 0) + 1);
  }

  const countryCode = normalizeCountryCode(row?.country_code);
  const countryName =
    normalizeAnalyticsText(row?.country_name, 120) ||
    getCountryNameFromCode(countryCode) ||
    "Không rõ";
  const cityName = normalizeAnalyticsText(row?.city, 120) || "Không rõ";
  if (countryCode) {
    target.trackedGeoClicks += 1;
    if (!target.countryMap.has(countryCode)) {
      target.countryMap.set(countryCode, {
        country_code: countryCode,
        country_name: countryName,
        clicks: 0,
        cities: new Map(),
      });
    }
    const countryEntry = target.countryMap.get(countryCode);
    countryEntry.clicks += 1;
    countryEntry.cities.set(
      cityName,
      (countryEntry.cities.get(cityName) || 0) + 1,
    );
  }

  const effectivePlatform =
    platform || getLinkAnalyticsPlatform(row?.links || row?.link || row);
  if (!target.platformMap.has(effectivePlatform.key)) {
    target.platformMap.set(effectivePlatform.key, {
      key: effectivePlatform.key,
      label: effectivePlatform.label,
      color: effectivePlatform.color,
      clicks: 0,
      unique,
    });
  }
  target.platformMap.get(effectivePlatform.key).clicks += 1;
}

function finalizeAnalyticsCountryList(countryMap = new Map()) {
  return [...countryMap.values()]
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
}

function finalizeAnalyticsTimeline(timelineMap = new Map()) {
  return [...timelineMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, clicks]) => ({ date, clicks }));
}

function finalizePlatformDistribution(
  platformMap = new Map(),
  totalClicks = 0,
) {
  return [...platformMap.values()]
    .sort((a, b) => b.clicks - a.clicks)
    .map((platform) => ({
      ...platform,
      percent: totalClicks
        ? Math.round((platform.clicks / totalClicks) * 1000) / 10
        : 0,
    }));
}

function buildStatsAnalytics(clickRows = []) {
  const todayKey = getAnalyticsDayKey(new Date());
  const rawState = {
    timelineMap: new Map(),
    countryMap: new Map(),
    platformMap: new Map(),
    platformTodayMap: new Map(),
    trackedGeoClicks: 0,
  };
  const uniqueState = {
    timelineMap: new Map(),
    countryMap: new Map(),
    platformMap: new Map(),
    platformTodayMap: new Map(),
    trackedGeoClicks: 0,
  };
  const lastSeenByVisitor = new Map();
  const orderedRows = Array.isArray(clickRows) ? clickRows : [];

  // `getClickAnalytics()` already returns rows sorted DESC by `clicked_at`.
  // Iterate from the tail so unique-window dedupe still runs in ASC order
  // without paying for another full sort in Node.
  for (let index = orderedRows.length - 1; index >= 0; index -= 1) {
    const row = orderedRows[index];
    const clickedAt = row?.clicked_at || "";
    const dayKey = clickedAt ? getAnalyticsDayKey(clickedAt) : "";
    const platform = getLinkAnalyticsPlatform(row?.link || row?.links || row);
    accumulateAnalyticsMaps(rawState, row, {
      unique: false,
      dayKey,
      platform,
    });
    if (dayKey === todayKey) {
      rawState.platformTodayMap.set(
        platform.key,
        (rawState.platformTodayMap.get(platform.key) || 0) + 1,
      );
    }

    const clickedAtMs = clickedAt ? Date.parse(clickedAt) : NaN;
    if (!Number.isFinite(clickedAtMs)) continue;
    const visitorKey = getAnalyticsVisitorKey(row);
    const lastSeenMs = lastSeenByVisitor.get(visitorKey) || 0;
    const isUnique =
      !lastSeenMs || clickedAtMs - lastSeenMs > UNIQUE_CLICK_WINDOW_MS;
    if (!isUnique) continue;
    lastSeenByVisitor.set(visitorKey, clickedAtMs);
    accumulateAnalyticsMaps(uniqueState, row, {
      unique: true,
      dayKey,
      platform,
    });
    if (dayKey === todayKey) {
      uniqueState.platformTodayMap.set(
        platform.key,
        (uniqueState.platformTodayMap.get(platform.key) || 0) + 1,
      );
    }
  }

  const rawClicks = orderedRows.length;
  const uniqueClicks = [...uniqueState.timelineMap.values()].reduce(
    (sum, value) => sum + value,
    0,
  );
  const timeline = finalizeAnalyticsTimeline(rawState.timelineMap);
  const uniqueTimeline = finalizeAnalyticsTimeline(uniqueState.timelineMap);
  const topCountries = finalizeAnalyticsCountryList(rawState.countryMap);
  const uniqueTopCountries = finalizeAnalyticsCountryList(
    uniqueState.countryMap,
  );
  const platformDistribution = finalizePlatformDistribution(
    rawState.platformMap,
    rawClicks,
  );
  const uniquePlatformDistribution = finalizePlatformDistribution(
    uniqueState.platformMap,
    uniqueClicks,
  );
  const platformTodayDistribution = platformDistribution.map((platform) => ({
    ...platform,
    clicks_today: Number(rawState.platformTodayMap.get(platform.key) || 0),
  }));
  const uniquePlatformTodayDistribution = uniquePlatformDistribution.map(
    (platform) => ({
      ...platform,
      clicks_today: Number(uniqueState.platformTodayMap.get(platform.key) || 0),
    }),
  );

  return {
    total_clicks: rawClicks,
    unique_clicks: uniqueClicks,
    timeline,
    unique_timeline: uniqueTimeline,
    geo: {
      tracked_clicks: rawState.trackedGeoClicks,
      unknown_clicks: Math.max(rawClicks - rawState.trackedGeoClicks, 0),
      countries: topCountries.map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: country.country_name_en,
        clicks: country.clicks,
      })),
      top_countries: topCountries.slice(0, 8),
      unique_tracked_clicks: uniqueState.trackedGeoClicks,
      unique_unknown_clicks: Math.max(
        uniqueClicks - uniqueState.trackedGeoClicks,
        0,
      ),
      unique_countries: uniqueTopCountries.map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: country.country_name_en,
        clicks: country.clicks,
      })),
      unique_top_countries: uniqueTopCountries.slice(0, 8),
    },
    platforms: {
      distribution: platformDistribution,
      top_platforms: platformDistribution.slice(0, 8),
      today_distribution: platformTodayDistribution,
      today_top_platforms: platformTodayDistribution.slice(0, 8),
      unique_distribution: uniquePlatformDistribution,
      unique_top_platforms: uniquePlatformDistribution.slice(0, 8),
      unique_today_distribution: uniquePlatformTodayDistribution,
      unique_today_top_platforms: uniquePlatformTodayDistribution.slice(0, 8),
    },
  };
}

function getArticleFunnelAnalyticsLinkId(row = {}) {
  const stageKey = String(row?.stage_key || "").trim();
  const stageWeight = stageKey === "20s" ? 2 : stageKey === "300s" ? 3 : 1;
  const articleFunnelId = Number(row?.article_funnel_id || 0);
  if (articleFunnelId > 0) {
    return articleFunnelId * 10 + stageWeight;
  }
  const slug = String(row?.route_slug || "").trim() || "lab";
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return Math.max(hash, 1) * 10 + stageWeight;
}

function mapArticleFunnelClickRowsToAnalyticsRows(rows = []) {
  const configCache = new Map();
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const cacheKey =
      String(row?.article_funnel_id || "").trim() ||
      String(row?.route_slug || "").trim();
    if (cacheKey && !configCache.has(cacheKey)) {
      configCache.set(
        cacheKey,
        normalizeArticleFunnelPreviewConfig(
          row?.article_funnels?.config_json || {},
        ),
      );
    }
    const normalizedStageKey = String(row?.stage_key || "").trim() || "3s";
    const stage =
      (configCache.get(cacheKey)?.stages || []).find(
        (item) => String(item?.stage_key || "").trim() === normalizedStageKey,
      ) || null;
    const originalUrl = String(
      stage?.target_url ||
        stage?.direct_web_url ||
        stage?.direct_app_url ||
        stage?.direct_ios_url ||
        stage?.direct_android_url ||
        "",
    ).trim();
    const linkId = getArticleFunnelAnalyticsLinkId(row);
    return {
      id: `${String(row?.route_slug || "lab").trim()}:${normalizedStageKey}:${String(
        row?.clicked_at || "",
      ).trim()}`,
      link_id: linkId,
      ip: row?.ip || "",
      user_agent: row?.user_agent || "",
      referrer: row?.referrer || "",
      country_code: row?.country_code || "",
      country_name: row?.country_name || "",
      city: row?.city || "",
      clicked_at: row?.clicked_at || "",
      link: {
        id: linkId,
        original_url: originalUrl,
        link_type: "direct",
      },
    };
  });
}

function buildRecentBucketsFromClickRows(clickRows = [], bucketMinutes = 15) {
  const bucketMs = Math.max(Number(bucketMinutes) || 15, 1) * 60 * 1000;
  const bucketMap = new Map();
  for (const row of Array.isArray(clickRows) ? clickRows : []) {
    const clickedAtMs = Date.parse(row?.clicked_at || "");
    if (!Number.isFinite(clickedAtMs)) continue;
    const bucketStart = Math.floor(clickedAtMs / bucketMs) * bucketMs;
    bucketMap.set(bucketStart, (bucketMap.get(bucketStart) || 0) + 1);
  }
  return [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(-96)
    .map(([bucketStartedAt, clicks]) => ({
      bucket_started_at: new Date(bucketStartedAt).toISOString(),
      clicks,
    }));
}

function buildStatsAnalyticsWithRecentBuckets(clickRows = []) {
  return {
    ...buildStatsAnalytics(clickRows),
    recent_buckets: buildRecentBucketsFromClickRows(clickRows),
  };
}

function mergeTimelineRows(baseRows = [], extraRows = []) {
  const timelineMap = new Map();
  for (const row of [...(baseRows || []), ...(extraRows || [])]) {
    const dayKey = String(row?.date || "").trim();
    if (!dayKey) continue;
    timelineMap.set(dayKey, (timelineMap.get(dayKey) || 0) + Number(row?.clicks || 0));
  }
  return finalizeAnalyticsTimeline(timelineMap);
}

function mergeRecentBucketRows(baseRows = [], extraRows = []) {
  const bucketMap = new Map();
  for (const row of [...(baseRows || []), ...(extraRows || [])]) {
    const bucketStartedAt = String(row?.bucket_started_at || "").trim();
    if (!bucketStartedAt) continue;
    bucketMap.set(
      bucketStartedAt,
      (bucketMap.get(bucketStartedAt) || 0) + Number(row?.clicks || 0),
    );
  }
  return [...bucketMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-96)
    .map(([bucket_started_at, clicks]) => ({ bucket_started_at, clicks }));
}

function mergeCountryRows(countryRows = [], topCountryRows = []) {
  const countryMap = new Map();
  for (const row of Array.isArray(countryRows) ? countryRows : []) {
    const countryCode = normalizeCountryCode(row?.country_code);
    if (!countryCode) continue;
    const entry = countryMap.get(countryCode) || {
      country_code: countryCode,
      country_name:
        normalizeAnalyticsText(row?.country_name, 120) ||
        getCountryNameFromCode(countryCode) ||
        "Không rõ",
      clicks: 0,
      cities: new Map(),
    };
    entry.clicks += Number(row?.clicks || 0);
    countryMap.set(countryCode, entry);
  }
  for (const row of Array.isArray(topCountryRows) ? topCountryRows : []) {
    const countryCode = normalizeCountryCode(row?.country_code);
    if (!countryCode) continue;
    const entry = countryMap.get(countryCode) || {
      country_code: countryCode,
      country_name:
        normalizeAnalyticsText(row?.country_name, 120) ||
        getCountryNameFromCode(countryCode) ||
        "Không rõ",
      clicks: Number(row?.clicks || 0),
      cities: new Map(),
    };
    if (!entry.clicks) {
      entry.clicks = Number(row?.clicks || 0);
    }
    const cityName = normalizeAnalyticsText(row?.city, 120) || "Không rõ";
    entry.cities.set(
      cityName,
      (entry.cities.get(cityName) || 0) + Number(row?.city_clicks || row?.clicks || 0),
    );
    countryMap.set(countryCode, entry);
  }
  return finalizeAnalyticsCountryList(countryMap);
}

function mergePlatformRows(baseRows = [], extraRows = [], totalClicks = 0) {
  const platformMap = new Map();
  for (const row of [...(baseRows || []), ...(extraRows || [])]) {
    const platform = getLinkAnalyticsPlatform({
      original_url: row?.original_url || "",
      link_type: row?.link_type || "",
    });
    const key = String(row?.key || platform.key || "generic").trim() || "generic";
    const existing = platformMap.get(key) || {
      key,
      label: row?.label || platform.label,
      color: row?.color || platform.color,
      clicks: 0,
    };
    existing.clicks += Number(row?.clicks || 0);
    if (Object.prototype.hasOwnProperty.call(row || {}, "clicks_today")) {
      existing.clicks_today =
        Number(existing.clicks_today || 0) + Number(row?.clicks_today || 0);
    }
    platformMap.set(key, existing);
  }
  return finalizePlatformDistribution(platformMap, totalClicks);
}

function mergeStatsAnalytics(baseAnalytics = null, extraAnalytics = null) {
  if (!baseAnalytics) return extraAnalytics || null;
  if (!extraAnalytics) return baseAnalytics;

  const totalClicks =
    Number(baseAnalytics?.total_clicks || 0) +
    Number(extraAnalytics?.total_clicks || 0);
  const uniqueClicks =
    Number(baseAnalytics?.unique_clicks || 0) +
    Number(extraAnalytics?.unique_clicks || 0);
  const timeline = mergeTimelineRows(
    baseAnalytics?.timeline,
    extraAnalytics?.timeline,
  );
  const uniqueTimeline = mergeTimelineRows(
    baseAnalytics?.unique_timeline,
    extraAnalytics?.unique_timeline,
  );
  const countries = mergeCountryRows(
    [
      ...(baseAnalytics?.geo?.countries || []),
      ...(extraAnalytics?.geo?.countries || []),
    ],
    [
      ...(baseAnalytics?.geo?.top_countries || []),
      ...(extraAnalytics?.geo?.top_countries || []),
    ],
  );
  const uniqueCountries = mergeCountryRows(
    [
      ...(baseAnalytics?.geo?.unique_countries || []),
      ...(extraAnalytics?.geo?.unique_countries || []),
    ],
    [
      ...(baseAnalytics?.geo?.unique_top_countries || []),
      ...(extraAnalytics?.geo?.unique_top_countries || []),
    ],
  );
  const platformDistribution = mergePlatformRows(
    baseAnalytics?.platforms?.distribution,
    extraAnalytics?.platforms?.distribution,
    totalClicks,
  );
  const platformTodayDistribution = mergePlatformRows(
    baseAnalytics?.platforms?.today_distribution,
    extraAnalytics?.platforms?.today_distribution,
    totalClicks,
  );
  const uniquePlatformDistribution = mergePlatformRows(
    baseAnalytics?.platforms?.unique_distribution,
    extraAnalytics?.platforms?.unique_distribution,
    uniqueClicks,
  );
  const uniquePlatformTodayDistribution = mergePlatformRows(
    baseAnalytics?.platforms?.unique_today_distribution,
    extraAnalytics?.platforms?.unique_today_distribution,
    uniqueClicks,
  );

  return {
    total_clicks: totalClicks,
    unique_clicks: uniqueClicks,
    timeline,
    unique_timeline: uniqueTimeline,
    recent_buckets: mergeRecentBucketRows(
      baseAnalytics?.recent_buckets,
      extraAnalytics?.recent_buckets,
    ),
    geo: {
      tracked_clicks:
        Number(baseAnalytics?.geo?.tracked_clicks || 0) +
        Number(extraAnalytics?.geo?.tracked_clicks || 0),
      unknown_clicks:
        Number(baseAnalytics?.geo?.unknown_clicks || 0) +
        Number(extraAnalytics?.geo?.unknown_clicks || 0),
      countries: countries.map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: country.country_name_en,
        clicks: country.clicks,
      })),
      top_countries: countries.slice(0, 8),
      unique_tracked_clicks:
        Number(baseAnalytics?.geo?.unique_tracked_clicks || 0) +
        Number(extraAnalytics?.geo?.unique_tracked_clicks || 0),
      unique_unknown_clicks:
        Number(baseAnalytics?.geo?.unique_unknown_clicks || 0) +
        Number(extraAnalytics?.geo?.unique_unknown_clicks || 0),
      unique_countries: uniqueCountries.map((country) => ({
        country_code: country.country_code,
        country_name: country.country_name,
        country_name_en: country.country_name_en,
        clicks: country.clicks,
      })),
      unique_top_countries: uniqueCountries.slice(0, 8),
    },
    platforms: {
      distribution: platformDistribution,
      top_platforms: platformDistribution.slice(0, 8),
      today_distribution: platformTodayDistribution,
      today_top_platforms: platformTodayDistribution.slice(0, 8),
      unique_distribution: uniquePlatformDistribution,
      unique_top_platforms: uniquePlatformDistribution.slice(0, 8),
      unique_today_distribution: uniquePlatformTodayDistribution,
      unique_today_top_platforms: uniquePlatformTodayDistribution.slice(0, 8),
    },
  };
}

function buildStatsCacheKey(userId, guestSessionId) {
  if (userId) return `user:${userId}`;
  if (guestSessionId) return `guest:${guestSessionId}`;
  return "guest:anonymous";
}

function formatServerTimingHeader(timings = {}) {
  return Object.entries(timings)
    .filter(([, duration]) => Number.isFinite(duration))
    .map(([label, duration]) => `${label};dur=${Math.max(0, duration)}`)
    .join(", ");
}

async function measureAsyncTiming(label, run, timings) {
  const startedAt = Date.now();
  try {
    return await run();
  } finally {
    timings[label] = Date.now() - startedAt;
  }
}

function normalizeDomainVerificationStatus(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();
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
  if (/chrome\//i.test(ua) && !/edg\//i.test(ua) && !/opr\//i.test(ua))
    return "Chrome";
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
  const geo = extractClickGeo(req);
  const deviceLabel = [browserName, osName, getDeviceTypeLabel(deviceType)]
    .filter(Boolean)
    .join(" • ");
  const deviceFingerprint = crypto
    .createHash("sha1")
    .update(
      [browserName.toLowerCase(), osName.toLowerCase(), deviceType].join("|"),
    )
    .digest("hex");
  return {
    deviceFingerprint,
    deviceLabel,
    browserName,
    osName,
    deviceType,
    ip: getRequestIp(req),
    userAgent,
    countryCode: geo.country_code || null,
    countryName: geo.country_name || null,
    city: geo.city || null,
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
  else if (
    ratio >= 0.8 ||
    remaining <= Math.min(5, Math.ceil(dailyLimit * 0.2))
  )
    level = "warn";
  const todayKey = getAnalyticsDayKey(new Date());

  return {
    active: hasAccount && level !== "normal",
    level,
    key:
      !hasAccount || level === "normal"
        ? ""
        : `quota:${effectivePlan}:${level}:${todayKey}`,
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
    if (row && Object.prototype.hasOwnProperty.call(row, "bucket_started_at")) {
      const bucketStartMs = new Date(row.bucket_started_at || 0).getTime();
      if (
        !Number.isFinite(bucketStartMs) ||
        bucketStartMs < oldestBucketStart ||
        bucketStartMs > currentBucketStart
      ) {
        continue;
      }
      countsByBucket.set(
        bucketStartMs,
        (countsByBucket.get(bucketStartMs) || 0) +
          Math.max(Number(row.clicks) || 0, 0),
      );
      continue;
    }
    const clickedAtMs = new Date(row?.clicked_at || 0).getTime();
    if (!Number.isFinite(clickedAtMs) || clickedAtMs < oldestBucketStart)
      continue;
    const bucketStart = Math.floor(clickedAtMs / bucketMs) * bucketMs;
    countsByBucket.set(bucketStart, (countsByBucket.get(bucketStart) || 0) + 1);
  }

  const currentClicks = countsByBucket.get(currentBucketStart) || 0;
  const previousBuckets = [1, 2, 3, 4].map(
    (index) => countsByBucket.get(currentBucketStart - index * bucketMs) || 0,
  );
  const baselineClicks =
    previousBuckets.reduce((total, value) => total + value, 0) /
    previousBuckets.length;
  const ratio =
    baselineClicks > 0 ? currentClicks / baselineClicks : currentClicks;
  const active =
    currentClicks >= 12 &&
    ((baselineClicks >= 3 && ratio >= 3) ||
      (baselineClicks < 3 && currentClicks >= 18));

  return {
    active,
    level: active ? "warn" : "normal",
    key: active
      ? `click-spike:${new Date(currentBucketStart).toISOString()}`
      : "",
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
  if (
    !Number.isFinite(occurredAtMs) ||
    Date.now() - occurredAtMs > 7 * 24 * 3600 * 1000
  ) {
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
    device_label:
      normalizeAnalyticsText(loginEvent.device_label, 120) || "Thiết bị mới",
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
    const verificationStatus =
      normalizeDomainVerificationStatus(domain.verification_status) ||
      "verified";
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
    const severityDiff =
      (severity[left.level] ?? 9) - (severity[right.level] ?? 9);
    if (severityDiff !== 0) return severityDiff;
    return String(left.hostname || "").localeCompare(
      String(right.hostname || ""),
    );
  });
}

function buildCloudinaryVideoThumbUrl(result) {
  return (
    result?.eager?.[0]?.secure_url ||
    result?.secure_url
      ?.replace("/upload/", "/upload/so_0,w_1200,h_630,c_fill,f_jpg/")
      ?.replace(/\.[^.]+$/, ".jpg") ||
    null
  );
}

function buildCloudinaryPlayableVideoUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return raw;
  }

  if (!/(\.|^)res\.cloudinary\.com$/i.test(parsed.hostname)) return raw;

  const marker = "/video/upload/";
  const markerIndex = parsed.pathname.indexOf(marker);
  if (markerIndex === -1) return raw;

  const prefix = parsed.pathname.slice(0, markerIndex + marker.length);
  const suffix = parsed.pathname.slice(markerIndex + marker.length);
  const parts = suffix.split("/").filter(Boolean);
  if (!parts.length) return raw;

  const versionIndex = parts.findIndex((part) => /^v\d+$/i.test(part));
  const transformParts =
    versionIndex === -1 ? [] : parts.slice(0, versionIndex);
  const hasPlayableTransform = transformParts.some(
    (part) => /(^|,)f_mp4(,|$)/i.test(part) || /(^|,)vc_h264(,|$)/i.test(part),
  );
  if (hasPlayableTransform) return raw;

  parsed.pathname = `${prefix}f_mp4,vc_h264/${suffix}`;
  return parsed.toString();
}

function createCloudinaryVideoUploadSignature() {
  const timestamp = Math.floor(Date.now() / 1000);
  const publicId = nanoid(12);
  const paramsToSign = {
    folder: CLOUDINARY_VIDEO_FOLDER,
    public_id: publicId,
    timestamp,
  };
  const signature = cloudinary.utils.api_sign_request(
    paramsToSign,
    process.env.CLOUDINARY_API_SECRET,
  );
  return {
    timestamp,
    publicId,
    signature,
  };
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

function buildStatsAlertPayload({
  planName,
  linksToday,
  hasAccount,
  clickRows,
  latestLoginEvent,
}) {
  const quota = buildQuotaAlert(planName, linksToday, hasAccount);
  const clickSpike = buildClickSpikeAlert(clickRows);
  const sessionItems = buildSessionAlertsFromLoginEvent(latestLoginEvent);
  const active = [];

  if (quota.active) {
    active.push({
      key: quota.key,
      title:
        quota.level === "critical"
          ? "Đã chạm giới hạn gói"
          : "Sắp chạm ngưỡng quota",
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
    createdAt:
      membership.updated_at ||
      membership.created_at ||
      new Date().toISOString(),
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

function buildAdminOverviewPayload({
  totals = {},
  today = {},
  analytics = {},
  users = [],
  links = [],
  payments = [],
  domains = [],
  currentTime = new Date(),
} = {}) {
  const dayKey = getAnalyticsDayKey(currentTime);
  const monthKey = dayKey.slice(0, 7);
  const analyticsUniqueClicksToday =
    (analytics.unique_timeline || []).find((item) => item.date === dayKey)
      ?.clicks || 0;
  const uniqueClicksToday = Number(
    (today.uniqueClicksToday ?? analyticsUniqueClicksToday) || 0,
  );
  const rawClicksToday =
    (analytics.timeline || []).find((item) => item.date === dayKey)?.clicks ||
    0;
  const pendingPayments = payments.filter(
    (item) => item?.status === "submitted",
  );
  const awaitingPayments = payments.filter(
    (item) => item?.status === "awaiting_payment",
  );
  const approvedToday = payments.filter(
    (item) =>
      item?.status === "approved" &&
      item?.reviewed_at &&
      getAnalyticsDayKey(item.reviewed_at) === dayKey,
  );
  const rejectedToday = payments.filter(
    (item) =>
      item?.status === "rejected" &&
      item?.reviewed_at &&
      getAnalyticsDayKey(item.reviewed_at) === dayKey,
  );
  const approvedThisMonth = payments.filter(
    (item) =>
      item?.status === "approved" &&
      item?.reviewed_at &&
      getAnalyticsDayKey(item.reviewed_at).slice(0, 7) === monthKey,
  );
  const domainAlerts = buildDomainAlerts(domains, currentTime.getTime());
  const activeDomains = domains.filter((item) => item?.is_active !== false);
  const failedDomains = activeDomains.filter(
    (item) =>
      normalizeDomainVerificationStatus(item?.verification_status) === "failed",
  );
  const pendingDomains = activeDomains.filter(
    (item) =>
      normalizeDomainVerificationStatus(item?.verification_status) ===
      "pending",
  );
  const expiringDomains = domainAlerts.filter(
    (item) => item?.type === "expiring",
  );

  const planCounts = new Map();
  for (const userItem of users) {
    const planKey =
      String(userItem?.plan || "free")
        .trim()
        .toLowerCase() || "free";
    planCounts.set(planKey, (planCounts.get(planKey) || 0) + 1);
  }
  const plans = [...planCounts.entries()]
    .map(([key, count]) => ({
      key,
      label: key === "admin" ? "Admin" : key.toUpperCase(),
      count,
    }))
    .sort((a, b) => b.count - a.count);

  const actions = [];
  if (pendingPayments.length) {
    actions.push({
      tone: "warn",
      title: `${pendingPayments.length} yêu cầu thanh toán chờ duyệt`,
      message: "Mở tab Thanh toán để duyệt hoặc từ chối các yêu cầu mới gửi.",
    });
  }
  if (failedDomains.length) {
    actions.push({
      tone: "err",
      title: `${failedDomains.length} domain verify lỗi`,
      message:
        "Kiểm tra cấu hình DNS hoặc trạng thái verify trong tab Hệ thống.",
    });
  }
  if (pendingDomains.length) {
    actions.push({
      tone: "info",
      title: `${pendingDomains.length} domain đang chờ verify`,
      message: "Theo dõi các domain pending để tránh ảnh hưởng luồng tạo link.",
    });
  }
  if (Number(today.usersToday || 0) > 0) {
    actions.push({
      tone: "ok",
      title: `${Number(today.usersToday || 0).toLocaleString("vi-VN")} user mới hôm nay`,
      message:
        "Tab Người dùng vừa có thêm thành viên mới cần theo dõi onboarding.",
    });
  }
  if (uniqueClicksToday > 0) {
    actions.push({
      tone: "ok",
      title: `${Number(uniqueClicksToday || 0).toLocaleString("vi-VN")} click unique hôm nay`,
      message:
        "Traffic hôm nay đang có tín hiệu, có thể rà tiếp ở tab Thống kê.",
    });
  }

  const trendDayKeys = [];
  for (let i = 29; i >= 0; i--) {
    const pointDate = new Date(currentTime);
    pointDate.setDate(pointDate.getDate() - i);
    trendDayKeys.push(getAnalyticsDayKey(pointDate));
  }
  const createSeriesMap = () => new Map(trendDayKeys.map((key) => [key, 0]));
  const userTrendMap = createSeriesMap();
  const clickTrendMap = createSeriesMap();
  const paymentTrendMap = createSeriesMap();

  for (const userItem of users) {
    const key = getAnalyticsDayKey(userItem?.created_at);
    if (!userTrendMap.has(key)) continue;
    userTrendMap.set(key, (userTrendMap.get(key) || 0) + 1);
  }
  for (const item of analytics.unique_timeline || []) {
    const key = String(item?.date || "");
    if (!clickTrendMap.has(key)) continue;
    clickTrendMap.set(key, Number(item?.clicks || 0));
  }
  for (const payment of payments) {
    const paymentDate =
      payment?.submitted_at ||
      (payment?.status && payment.status !== "awaiting_payment"
        ? payment?.reviewed_at || payment?.created_at
        : null);
    if (!paymentDate) continue;
    const key = getAnalyticsDayKey(paymentDate);
    if (!paymentTrendMap.has(key)) continue;
    paymentTrendMap.set(key, (paymentTrendMap.get(key) || 0) + 1);
  }

  return {
    cards: {
      total_users: Number(totals.totalUsers || 0),
      users_today: Number(today.usersToday || 0),
      total_links: Number(totals.totalLinks || 0),
      links_today: Number(today.linksToday || 0),
      unique_clicks_today: Number(uniqueClicksToday || 0),
      pending_payments: pendingPayments.length,
    },
    actions: actions.slice(0, 5),
    health: {
      active_domains: activeDomains.length,
      pending_domains: pendingDomains.length,
      failed_domains: failedDomains.length,
      expiring_domains: expiringDomains.length,
      awaiting_payments: awaitingPayments.length,
      approved_today: approvedToday.length,
      rejected_today: rejectedToday.length,
      approved_revenue_month: approvedThisMonth.reduce(
        (sum, item) => sum + Number(item?.amount || 0),
        0,
      ),
      raw_clicks_today: Number(today.clicksToday || 0),
      unique_clicks_today: Number(uniqueClicksToday || 0),
      total_unique_clicks: Number(
        (totals.uniqueTotalClicks ?? analytics.unique_clicks) || 0,
      ),
      total_raw_clicks: Number(totals.totalClicks || 0),
    },
    plans,
    top_links: [...links]
      .sort((a, b) => Number(b?.clicks || 0) - Number(a?.clicks || 0))
      .slice(0, 5)
      .map((item) => ({
        short_code: item?.short_code || item?.alias || "link",
        original_url: item?.original_url || "",
        clicks: Number(item?.clicks || 0),
        link_type: item?.link_type || "direct",
      })),
    trends: {
      day_keys: trendDayKeys,
      labels: trendDayKeys.map((key) => {
        const [year, month, day] = String(key).split("-");
        return `${day}/${month}`;
      }),
      users: trendDayKeys.map((key) => Number(userTrendMap.get(key) || 0)),
      clicks: trendDayKeys.map((key) => Number(clickTrendMap.get(key) || 0)),
      payments: trendDayKeys.map((key) =>
        Number(paymentTrendMap.get(key) || 0),
      ),
    },
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
    affiliate_shopee_url: user.affiliate_shopee_url || null,
    affiliate_tiktok_url: user.affiliate_tiktok_url || null,
    can_use_lab: isAdmin ? true : !!user.can_use_lab,
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
  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    getTwoFactorEncryptionKey(),
    iv,
  );
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
  const hmac = crypto
    .createHmac("sha1", secretBuffer)
    .update(counterBuffer)
    .digest();
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
  const currentCounter = Math.floor(
    Date.now() / 1000 / TWO_FACTOR_PERIOD_SECONDS,
  );
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
  const normalized = raw
    .replace(/[^\d+\s().-]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 32);
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
  return (
    BILLING_PLANS[
      String(plan || "")
        .trim()
        .toLowerCase()
    ] || null
  );
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
  return `BOCLINK ${planMeta?.label?.toUpperCase() || String(planCode || "").toUpperCase()} U${user?.id || "0"} ${code}`.slice(
    0,
    80,
  );
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

function normalizeSupportMessageBody(input) {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 2000);
}

function buildSupportUserSummary(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    plan: user.plan || "free",
    role: user.role || "user",
    created_at: user.created_at || null,
  };
}

function buildSupportThreadSummaryEntry(userId, user, messages = []) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const lastMessage = safeMessages.length
    ? safeMessages.reduce((latest, entry) => {
        if (!latest) return entry;
        return new Date(entry.created_at || 0).getTime() >
          new Date(latest.created_at || 0).getTime()
          ? entry
          : latest;
      }, null)
    : null;
  return {
    user_id: userId,
    user: buildSupportUserSummary(user) || {
      id: userId,
      email: "",
      name: null,
      plan: "free",
      role: "user",
      created_at: null,
    },
    total_messages: safeMessages.length,
    unread_for_admin: safeMessages.filter(
      (entry) => entry.sender_role === "user" && !entry.is_read_by_admin,
    ).length,
    unread_for_user: safeMessages.filter(
      (entry) => entry.sender_role === "admin" && !entry.is_read_by_user,
    ).length,
    last_message: lastMessage?.message || "",
    last_message_at: lastMessage?.created_at || null,
    last_sender_role: lastMessage?.sender_role || "",
  };
}

function buildSupportThreadSummaries(messages = [], users = []) {
  const grouped = new Map();
  for (const message of Array.isArray(messages) ? messages : []) {
    const userId = Number(message?.user_id || 0);
    if (!Number.isInteger(userId) || userId < 1) continue;
    if (!grouped.has(userId)) grouped.set(userId, []);
    grouped.get(userId).push(message);
  }
  const userMap = new Map(
    (Array.isArray(users) ? users : [])
      .filter((user) => Number.isInteger(Number(user?.id || 0)))
      .map((user) => [Number(user.id), user]),
  );
  return [...grouped.entries()]
    .map(([userId, threadMessages]) =>
      buildSupportThreadSummaryEntry(userId, userMap.get(userId), threadMessages),
    )
    .sort(
      (a, b) =>
        new Date(b.last_message_at || 0).getTime() -
        new Date(a.last_message_at || 0).getTime(),
    );
}

const supportUserStreamClients = new Map();
const supportAdminStreamClients = new Set();

function initSupportStream(res) {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  res.socket?.setTimeout?.(0);
  res.socket?.setNoDelay?.(true);
  res.socket?.setKeepAlive?.(true);
  res.write("retry: 3000\n\n");
}

function writeSupportStreamEvent(res, eventName, payload = {}) {
  try {
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function removeSupportStreamClient(collection, res, key = null) {
  if (collection instanceof Map) {
    const clients = collection.get(key);
    if (!clients) return;
    clients.delete(res);
    if (!clients.size) {
      collection.delete(key);
    }
    return;
  }
  collection.delete(res);
}

function registerSupportUserStreamClient(userId, res) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId < 1) {
    return () => {};
  }
  if (!supportUserStreamClients.has(normalizedUserId)) {
    supportUserStreamClients.set(normalizedUserId, new Set());
  }
  const clients = supportUserStreamClients.get(normalizedUserId);
  clients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    removeSupportStreamClient(
      supportUserStreamClients,
      res,
      normalizedUserId,
    );
  };
  res.on("close", cleanup);
  res.on("finish", cleanup);
  return cleanup;
}

function registerSupportAdminStreamClient(res) {
  supportAdminStreamClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping ${Date.now()}\n\n`);
    } catch {}
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    removeSupportStreamClient(supportAdminStreamClients, res);
  };
  res.on("close", cleanup);
  res.on("finish", cleanup);
  return cleanup;
}

function broadcastSupportUserStreamEvent(userId, eventName, payload = {}) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId < 1) return;
  const clients = supportUserStreamClients.get(normalizedUserId);
  if (!clients?.size) return;
  for (const client of [...clients]) {
    if (!writeSupportStreamEvent(client, eventName, payload)) {
      removeSupportStreamClient(
        supportUserStreamClients,
        client,
        normalizedUserId,
      );
    }
  }
}

function broadcastSupportAdminStreamEvent(eventName, payload = {}) {
  if (!supportAdminStreamClients.size) return;
  for (const client of [...supportAdminStreamClients]) {
    if (!writeSupportStreamEvent(client, eventName, payload)) {
      removeSupportStreamClient(supportAdminStreamClients, client);
    }
  }
}

async function broadcastSupportRealtimeUpdate(
  userId,
  {
    reason = "updated",
    thread = null,
    notifyUser = false,
    notifyAdmins = true,
  } = {},
) {
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId < 1) return;
  let nextThread = thread || null;
  if (!nextThread) {
    const database = await getDb();
    const [targetUser, messages] = await Promise.all([
      database.getUserById(normalizedUserId),
      database.listSupportMessagesByUser(normalizedUserId, 200),
    ]);
    nextThread = buildSupportThreadSummaryEntry(
      normalizedUserId,
      targetUser,
      messages,
    );
  }
  const payload = {
    reason,
    user_id: normalizedUserId,
    thread: nextThread,
    emitted_at: new Date().toISOString(),
  };
  if (notifyUser) {
    broadcastSupportUserStreamEvent(normalizedUserId, "support:update", payload);
  }
  if (notifyAdmins) {
    broadcastSupportAdminStreamEvent("support:update", payload);
  }
}

function normalizeWorkspaceRole(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();
  if (value === "owner" || value === "analyst") return value;
  return "editor";
}

function normalizeInvitableWorkspaceRole(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();
  return value === "analyst" ? "analyst" : "editor";
}

function normalizeWorkspaceStatus(input) {
  const value = String(input || "")
    .trim()
    .toLowerCase();
  if (value === "pending" || value === "paused") return value;
  return "active";
}

function getWorkspaceSeatLimitForUser(user) {
  if (!user) return 1;
  if (
    user.role === "admin" ||
    user.plan === "admin" ||
    user.plan === "business"
  )
    return 10;
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
  return (
    !!membership &&
    membership.status === "active" &&
    ["owner", "editor"].includes(membership.role)
  );
}

function canUseWorkspaceTemplates(membership) {
  return (
    !!membership &&
    membership.status === "active" &&
    membership.role === "editor"
  );
}

function canEditWorkspaceTemplate(membership, template, user) {
  return (
    !!membership &&
    membership.status === "active" &&
    ["owner", "editor"].includes(membership.role) &&
    Number(template?.created_by_user_id || 0) === Number(user?.id || 0)
  );
}

function formatWorkspaceDisplayName(value, fallback = "Workspace") {
  return (
    String(value || fallback)
      .trim()
      .slice(0, 120) || fallback
  );
}

function buildDefaultWorkspaceName(user) {
  const label = String(
    user?.name || user?.email?.split("@")[0] || "Workspace",
  ).trim();
  return formatWorkspaceDisplayName(`${label} Workspace`);
}

function buildWorkspaceMemberResponse(member) {
  const email = String(member?.email || "")
    .trim()
    .toLowerCase();
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

function buildWorkspaceTemplateResponse(
  template,
  memberMap = new Map(),
  publicBaseUrl = BASE_URL,
) {
  const creator = memberMap.get(Number(template?.created_by_user_id || 0));
  const sourceLink = template?.source_link_id
    ? memberMap.get(`link:${template.source_link_id}`)
    : null;
  const mediaLink = template?.media_link_id
    ? memberMap.get(`link:${template.media_link_id}`)
    : sourceLink;
  const sourceLinkIds = Array.isArray(template?.source_link_ids_json)
    ? template.source_link_ids_json
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];
  const groupedSourceLinks = sourceLinkIds
    .map((linkId) => {
      const link = memberMap.get(`link:${linkId}`);
      if (!link) return null;
      return {
        id: linkId,
        title:
          link.og_title || link.alias || link.short_code || `Link #${linkId}`,
        short_url: link.short_url || "",
        original_url: link.original_url || "",
      };
    })
    .filter(Boolean);
  return attachVideoOverlayPublicFields({
    id: template?.id,
    workspace_id: template?.workspace_id,
    created_by_user_id: template?.created_by_user_id || null,
    creator_name: creator?.display_name || creator?.email || "Member",
    source_link_id: template?.source_link_id || null,
    media_link_id: template?.media_link_id || template?.source_link_id || null,
    source_link_ids: sourceLinkIds,
    source_links: groupedSourceLinks,
    source_link_short_url: sourceLink?.short_url || null,
    source_link_original_url: sourceLink?.original_url || null,
    name: formatWorkspaceDisplayName(template?.name, "Template"),
    og_title: template?.og_title || "",
    og_desc: template?.og_desc || "",
    og_image: template?.og_image || mediaLink?.og_image || "",
    link_type: template?.link_type || "direct",
    video_url: template?.video_url || mediaLink?.video_url || "",
    video_overlay_text: template?.video_overlay_text || "",
    domain_hostname: template?.domain_hostname || null,
    created_at: template?.created_at || null,
    updated_at: template?.updated_at || null,
    preview_domain:
      template?.domain_hostname || new URL(publicBaseUrl).hostname,
  });
}

async function resolveWorkspaceContext(
  database,
  user,
  { ensureOwnerWorkspace = true } = {},
) {
  if (!database || !user?.id) return null;
  const selected = await resolveWorkspaceSelection(database, user, {
    ensureOwnerWorkspace,
  });
  if (!selected) return null;

  const workspace = await database.getWorkspaceById(selected.workspace.id);
  const members = (await database.listWorkspaceMembers(workspace.id)).map(
    buildWorkspaceMemberResponse,
  );
  const links = await database.getRecentLinks(user.id, null);
  const templatesRaw = await database.listWorkspaceTemplates(workspace.id);
  const buildLinkEntry = (link) => ({
    short_url: buildLinkShortUrl(link, BASE_URL),
    original_url: link.original_url || "",
    og_title: link.og_title || "",
    og_image: link.og_image || "",
    video_url: link.video_url || "",
    alias: link.alias || "",
    short_code: link.alias || link.short_code || "",
  });
  const linkMap = new Map(
    links.map((link) => [`link:${link.id}`, buildLinkEntry(link)]),
  );
  const templateLinkIds = [
    ...new Set(
      templatesRaw.flatMap((template) => {
        const ids = [
          Number(template?.source_link_id),
          Number(template?.media_link_id),
        ];
        if (Array.isArray(template?.source_link_ids_json)) {
          ids.push(
            ...template.source_link_ids_json.map((value) => Number(value)),
          );
        }
        return ids.filter((value) => Number.isInteger(value) && value > 0);
      }),
    ),
  ];
  const missingTemplateLinkIds = templateLinkIds.filter(
    (linkId) => !linkMap.has(`link:${linkId}`),
  );
  if (missingTemplateLinkIds.length) {
    const templateLinks = await Promise.all(
      missingTemplateLinkIds.map((linkId) => database.getLinkById(linkId)),
    );
    for (const link of templateLinks) {
      if (!link?.id) continue;
      linkMap.set(`link:${link.id}`, buildLinkEntry(link));
    }
  }
  const memberMap = new Map(
    members.map((member) => [Number(member.user_id || 0), member]),
  );
  for (const [key, value] of linkMap.entries()) {
    memberMap.set(key, value);
  }
  const templates = templatesRaw.map((template) =>
    buildWorkspaceTemplateResponse(template, memberMap, BASE_URL),
  );

  return {
    workspace,
    membership: selected.membership,
    members,
    templates,
    sourceLinks: links.map((link) => attachVideoOverlayPublicFields({
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

async function resolveWorkspaceSelection(
  database,
  user,
  { ensureOwnerWorkspace = true } = {},
) {
  if (!database || !user?.id) return null;
  const rawMemberships = await database.listWorkspaceMembershipsForIdentity(
    user.id,
    user.email,
  );
  const normalizedEmail = String(user.email || "")
    .trim()
    .toLowerCase();
  const normalizedMemberships = [];

  for (const rawMembership of rawMemberships) {
    const workspace = rawMembership?.workspaces || null;
    if (!workspace) continue;
    let member = buildWorkspaceMemberResponse(rawMembership);
    const shouldBindUser =
      !member.user_id && normalizedEmail && member.email === normalizedEmail;
    if (
      shouldBindUser ||
      member.display_name !== (user.name || member.display_name)
    ) {
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
      workspace = await database.createWorkspace(
        user.id,
        buildDefaultWorkspaceName(user),
      );
    } else if (!workspace.name) {
      workspace =
        (await database.updateWorkspace(workspace.id, {
          name: buildDefaultWorkspaceName(user),
        })) || workspace;
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
  return {
    workspace: selected.workspace,
    membership: selected.member,
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

function buildShopeeAndroidIntentUrl(originalUrl) {
  try {
    const url = new URL(String(originalUrl || "").trim());
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "shopee.vn" && !hostname.endsWith(".shopee.vn")) {
      return "";
    }

    let appPath = `${hostname}${url.pathname}`;
    const pathname = url.pathname || "";
    const productPathMatch = pathname.match(
      /^\/(?:universal-link\/)?product\/(\d+)\/(\d+)/i,
    );
    const legacyProductMatch = pathname.match(/-i\.(\d+)\.(\d+)/i);

    if (productPathMatch) {
      appPath = `shopee.vn/opaanlp/${productPathMatch[1]}/${productPathMatch[2]}`;
    } else if (legacyProductMatch) {
      appPath = `shopee.vn/opaanlp/${legacyProductMatch[1]}/${legacyProductMatch[2]}`;
    }

    const query = new URLSearchParams(url.searchParams);
    if (appPath.includes("/opaanlp/")) {
      query.set("__mobile__", "1");
    }

    const queryString = query.toString();
    return `intent://${appPath}${queryString ? `?${queryString}` : ""}#Intent;scheme=https;package=${SHOPEE_ANDROID_PACKAGE};end;`;
  } catch {
    return "";
  }
}

function buildShopeeIosInAppWebUrl(originalUrl) {
  try {
    const webUrl = String(originalUrl || "").trim();
    if (!webUrl) return "";

    const url = new URL(webUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname !== "shopee.vn" && !hostname.endsWith(".shopee.vn")) {
      return "";
    }

    const pathname = url.pathname || "";
    const productPathMatch = pathname.match(
      /^\/(?:universal-link\/)?product\/(\d+)\/(\d+)/i,
    );
    const legacyProductMatch = pathname.match(/-i\.(\d+)\.(\d+)/i);
    const opaanlpMatch = pathname.match(/^\/opaanlp\/(\d+)\/(\d+)/i);

    const shopId =
      productPathMatch?.[1] || legacyProductMatch?.[1] || opaanlpMatch?.[1] || "";
    const itemId =
      productPathMatch?.[2] || legacyProductMatch?.[2] || opaanlpMatch?.[2] || "";

    if (!shopId || !itemId) {
      return webUrl;
    }

    const query = new URLSearchParams(url.searchParams);
    query.set("__mobile__", "1");
    const queryString = query.toString();

    return `https://shopee.vn/opaanlp/${shopId}/${itemId}${queryString ? `?${queryString}` : ""}`;
  } catch {
    return "";
  }
}

function buildDirectLaunchConfig(targetUrl) {
  const normalizedTargetUrl = String(targetUrl || "").trim();
  const launchInfo = detectPlatformDeep(normalizedTargetUrl, "ios");
  const directWebUrl = launchInfo.fallback || normalizedTargetUrl || "";
  const isShopee = launchInfo.platform_name === "shopee";
  const isTikTok = launchInfo.platform_name === "tiktok";
  const directIosFbUrl =
    isShopee
      ? buildShopeeIosInAppWebUrl(directWebUrl) || directWebUrl
      : directWebUrl;
  const directAppUrl =
    isShopee
      ? buildShopeeAppLinkUrl(directWebUrl)
      : launchInfo.deeplink || directWebUrl;
  const directIosUrl =
    isShopee
      ? directWebUrl
      : launchInfo.deeplink_ios || directAppUrl || directWebUrl;
  const directAndroidUrl =
    isShopee
      ? directWebUrl
      : launchInfo.deeplink_android || directAppUrl || directWebUrl;

  return {
    target_url: normalizedTargetUrl,
    direct_platform: launchInfo.platform_name || "generic",
    direct_web_url: directWebUrl,
    direct_app_url: directAppUrl,
    direct_ios_url: directIosUrl,
    direct_ios_fb_url: directIosFbUrl,
    direct_ios_browser_url: directWebUrl,
    direct_android_url: directAndroidUrl,
    direct_android_intent_url:
      isShopee
        ? buildShopeeAndroidIntentUrl(directWebUrl)
        : "",
    direct_android_package:
      isShopee
        ? SHOPEE_ANDROID_PACKAGE
        : isTikTok
          ? TIKTOK_ANDROID_PACKAGE
          : "",
  };
}

function buildOverlayLaunchConfig(targetUrl) {
  const config = buildDirectLaunchConfig(targetUrl);
  if (config.direct_platform === "tiktok") {
    const isTikTokProductTarget = isTikTokProductUrl(config.direct_web_url);
    const preferredIosUrl =
      isTikTokProductTarget
        ? config.direct_web_url
        : config.direct_ios_url || config.direct_app_url || config.direct_web_url;
    return {
      ...config,
      direct_ios_fb_url: preferredIosUrl,
      direct_ios_browser_url: config.direct_web_url,
    };
  }
  return config;
}

function applyArticleFunnelStageDirectOverrides(
  stage,
  launchConfig,
  rawConfig,
) {
  const normalizedStageKey = normalizeArticleFunnelStageKey(stage?.stage_key || "");
  const config = launchConfig && typeof launchConfig === "object"
    ? { ...launchConfig }
    : {};
  const sourceConfig =
    rawConfig && typeof rawConfig === "object"
      ? rawConfig
      : {};
  const overlay =
    sourceConfig.overlay && typeof sourceConfig.overlay === "object"
      ? sourceConfig.overlay
      : {};

  if (
    normalizedStageKey === "20s" &&
    config.direct_platform === "tiktok"
  ) {
    const iosInAppOverride = String(
      sourceConfig.popup20sIosFbUrl ||
        sourceConfig.popup_20s_ios_fb_url ||
        overlay.popup_20s_ios_fb_url ||
        "",
    ).trim();
    if (iosInAppOverride) {
      config.direct_ios_fb_url = iosInAppOverride;
    }
  }

  if (
    normalizedStageKey === "3s" &&
    config.direct_platform === "shopee"
  ) {
    const iosInAppOverride = String(
      sourceConfig.popup3sIosFbUrl ||
        sourceConfig.popup_3s_ios_fb_url ||
        overlay.popup_3s_ios_fb_url ||
        "",
    ).trim();
    if (iosInAppOverride) {
      config.direct_ios_fb_url = iosInAppOverride;
    }
  }

  return config;
}

function decodeHtmlEntities(input = "") {
  return String(input || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ");
}

function collapseWhitespace(input = "") {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function stripHtmlTags(input = "") {
  return collapseWhitespace(
    decodeHtmlEntities(String(input || "").replace(/<[^>]+>/g, " ")),
  );
}

function normalizeImportSourceUrl(input = "") {
  const raw = String(input || "").trim();
  if (!raw) return "";
  try {
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(normalized);
    if (!/^https?:$/i.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function absolutizeImportedUrl(candidate = "", baseUrl = "") {
  const raw = decodeHtmlEntities(String(candidate || "").trim());
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return "";
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return "";
  }
}

function extractAttributeValue(fragment = "", attributeName = "") {
  if (!fragment || !attributeName) return "";
  const pattern = new RegExp(
    `${attributeName}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s"'=<>` + "`" + `]+))`,
    "i",
  );
  const match = String(fragment || "").match(pattern);
  return decodeHtmlEntities(
    (match && (match[2] || match[3] || match[4] || "")) || "",
  ).trim();
}

function extractMetaContents(html = "", keys = []) {
  const normalizedKeys = new Set(
    (Array.isArray(keys) ? keys : []).map((key) =>
      String(key || "").trim().toLowerCase(),
    ),
  );
  if (!normalizedKeys.size) return [];
  const matches = [];
  const metaRegex = /<meta\b[^>]*>/gi;
  for (const tag of String(html || "").match(metaRegex) || []) {
    const property = extractAttributeValue(tag, "property").toLowerCase();
    const name = extractAttributeValue(tag, "name").toLowerCase();
    if (!normalizedKeys.has(property) && !normalizedKeys.has(name)) continue;
    const content = extractAttributeValue(tag, "content");
    if (content) matches.push(content);
  }
  return matches;
}

function dedupeUrls(values = []) {
  const seen = new Set();
  const items = [];
  for (const value of Array.isArray(values) ? values : []) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    items.push(normalized);
  }
  return items;
}

function pickImportedAttributeValue(fragment = "", attributeNames = []) {
  for (const attributeName of Array.isArray(attributeNames) ? attributeNames : []) {
    const candidate = extractAttributeValue(fragment, attributeName);
    const normalized = String(candidate || "").trim();
    if (!normalized || normalized.startsWith("data:") || normalized.startsWith("blob:")) {
      continue;
    }
    return normalized;
  }
  return "";
}

function extractLikelyArticleContentHtml(html = "") {
  const safeHtml = String(html || "");
  const patterns = [
    /<div[^>]+class="[^"]*entry-content[^"]*wp-block-post-content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*wp-block-template-part[^"]*"|<\/main>)/i,
    /<div[^>]+class="[^"]*wp-block-post-content[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*wp-block-template-part[^"]*"|<\/main>)/i,
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
  ];
  for (const pattern of patterns) {
    const match = safeHtml.match(pattern);
    const snippet = String(match?.[1] || "").trim();
    if (snippet) return snippet;
  }
  return "";
}

function extractArticleParagraphs(html = "") {
  const paragraphs = [];
  const paragraphRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  for (const match of String(html || "").matchAll(paragraphRegex)) {
    const text = collapseWhitespace(stripHtmlTags(match[1] || ""));
    if (text) paragraphs.push(text);
  }
  return paragraphs;
}

function isWeakImportDescription(input = "") {
  const normalized = collapseWhitespace(String(input || "").trim()).toLowerCase();
  if (!normalized) return true;
  if (normalized.length < 24) return true;
  return /^(c[aậ]p nh[aậ]t|update|tin m[oớ]i)$/i.test(normalized);
}

function detectImportedSensitiveMediaType(
  html = "",
  block = "",
  blockIndex = 0,
  fallbackType = "image",
) {
  const safeHtml = String(html || "");
  const safeBlock = String(block || "");
  const normalizedType = String(fallbackType || "image").trim().toLowerCase();
  if (!safeBlock) return normalizedType;
  const start = Math.max(0, Number(blockIndex) - 420);
  const end = Math.min(
    safeHtml.length,
    Number(blockIndex) + safeBlock.length + 420,
  );
  const nearby = safeHtml.slice(start, end).toLowerCase();
  const sensitiveHints =
    normalizedType === "video"
      ? [
          "sensitive-video-wrapper",
          'data-sensitive-kind="video"',
          "video nhạy cảm",
          "video nhay cam",
        ]
      : [
          "sensitive-image-wrapper",
          'data-sensitive-kind="image"',
          "hình ảnh nhạy cảm",
          "hinh anh nhay cam",
          "ảnh nhạy cảm",
          "anh nhay cam",
        ];
  const sharedHints = [
    "reveal-button",
    "data-reveal-sensitive",
    "reveal-btn",
    "sensitive-wrap",
  ];
  if (
    sensitiveHints.some((hint) => nearby.includes(hint)) ||
    sharedHints.some((hint) => nearby.includes(hint))
  ) {
    return normalizedType === "video" ? "sensitive-video" : "sensitive-image";
  }
  return normalizedType;
}

function extractOrderedArticleMedia(html = "", baseUrl = "") {
  const items = [];
  const pushItem = (type, src, caption = "") => {
    const absoluteSrc = absolutizeImportedUrl(src, baseUrl);
    if (!absoluteSrc) return;
    items.push({
      type,
      src: absoluteSrc,
      caption: stripHtmlTags(caption),
    });
  };

  const videoBlockRegex = /<video\b[\s\S]*?<\/video>/gi;
  for (const match of String(html || "").matchAll(videoBlockRegex)) {
    const block = String(match?.[0] || "");
    const directSrc = pickImportedAttributeValue(block, ["src", "data-src"]);
    const sourceSrc = extractAttributeValue(block, "poster");
    const nestedSourceMatch = block.match(/<source\b[^>]*>/i);
    const nestedSrc = nestedSourceMatch
      ? pickImportedAttributeValue(nestedSourceMatch[0], ["src", "data-src"])
      : "";
    pushItem(
      detectImportedSensitiveMediaType(
        html,
        block,
        Number(match?.index || 0),
        "video",
      ),
      directSrc || nestedSrc,
      sourceSrc,
    );
  }

  const imgRegex = /<img\b[^>]*>/gi;
  for (const match of String(html || "").matchAll(imgRegex)) {
    const tag = String(match?.[0] || "");
    const width = Number.parseInt(extractAttributeValue(tag, "width"), 10) || 0;
    const height = Number.parseInt(extractAttributeValue(tag, "height"), 10) || 0;
    const rawClass = String(extractAttributeValue(tag, "class") || "").toLowerCase();
    const rawAlt = String(extractAttributeValue(tag, "alt") || "").toLowerCase();
    const src = pickImportedAttributeValue(tag, ["data-src", "data-original", "src"]);
    const normalizedSrc = String(src || "").toLowerCase();
    if (
      (width > 0 && width < 120) ||
      (height > 0 && height < 120) ||
      /(?:logo|avatar|emoji|gravatar|icon|site-icon|favicon)/.test(
        `${rawClass} ${rawAlt} ${normalizedSrc}`,
      )
    ) {
      continue;
    }
    const alt = extractAttributeValue(tag, "alt");
    pushItem(
      detectImportedSensitiveMediaType(
        html,
        tag,
        Number(match?.index || 0),
        "image",
      ),
      src,
      alt,
    );
  }

  return dedupeUrls(
    items
      .map((item) => JSON.stringify(item))
      .map((serialized) => serialized),
  ).map((serialized) => JSON.parse(serialized));
}

function extractArticleFunnelImportPayload(html = "", baseUrl = "") {
  const safeHtml = String(html || "");
  const contentHtml = extractLikelyArticleContentHtml(safeHtml) || safeHtml;
  const titleMatch = safeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title =
    collapseWhitespace(
      decodeHtmlEntities(
        extractMetaContents(safeHtml, ["og:title", "twitter:title"])[0] ||
          (titleMatch ? titleMatch[1] : ""),
      ),
    ) || "Article preview";
  const rawDescription =
    collapseWhitespace(
      decodeHtmlEntities(
        extractMetaContents(safeHtml, [
          "description",
          "og:description",
          "twitter:description",
        ])[0] || "",
      ),
    ) || "";
  const contentParagraphs = extractArticleParagraphs(contentHtml);
  const description = isWeakImportDescription(rawDescription)
    ? String(contentParagraphs[0] || rawDescription || "").trim()
    : rawDescription;

  const metaImages = extractMetaContents(safeHtml, [
    "og:image",
    "twitter:image",
    "og:image:url",
  ]).map((value) => absolutizeImportedUrl(value, baseUrl));
  const metaVideos = extractMetaContents(safeHtml, [
    "og:video",
    "og:video:url",
    "twitter:player:stream",
  ]).map((value) => absolutizeImportedUrl(value, baseUrl));
  const orderedMedia = extractOrderedArticleMedia(contentHtml, baseUrl);
  const fallbackOrderedMedia =
    contentHtml === safeHtml ? [] : extractOrderedArticleMedia(safeHtml, baseUrl);
  const videos = dedupeUrls([
    ...orderedMedia.filter((item) => item.type === "video").map((item) => item.src),
    ...fallbackOrderedMedia.filter((item) => item.type === "video").map((item) => item.src),
    ...metaVideos,
  ]);
  const images = dedupeUrls([
    ...orderedMedia.filter((item) => item.type === "image").map((item) => item.src),
    ...fallbackOrderedMedia.filter((item) => item.type === "image").map((item) => item.src),
    ...metaImages,
  ]);

  const blocks = [];
  const seen = new Set();
  for (const media of orderedMedia) {
    const key = `${media.type}:${media.src}`;
    if (!media.src || seen.has(key)) continue;
    seen.add(key);
    blocks.push({
      type: media.type,
      src: media.src,
      caption: media.caption || "",
      text: "",
    });
    if (blocks.length >= 8) break;
  }
  if (!blocks.length) {
    videos.slice(0, 2).forEach((src) =>
      blocks.push({ type: "video", src, caption: "", text: "" }),
    );
    images.slice(0, 6 - blocks.length).forEach((src) =>
      blocks.push({ type: "image", src, caption: "", text: "" }),
    );
  }

  return {
    reference_source_url: baseUrl,
    title,
    description,
    blocks,
    image_count: images.length,
    video_count: videos.length,
  };
}

const ARTICLE_FUNNEL_PREVIEW_TOKEN_TTL_MS = 7 * 24 * 3600 * 1000;
const ARTICLE_FUNNEL_POPUP_TEST_TOKEN_TTL_MS = 24 * 3600 * 1000;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input) {
  const normalized = String(input || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + "=".repeat(padLength), "base64");
}

function signArticleFunnelPreviewBuffer(buffer) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(buffer)
    .digest();
}

function signArticleFunnelPopupTestBuffer(buffer) {
  return crypto
    .createHmac("sha256", JWT_SECRET)
    .update(buffer)
    .digest();
}

function encodeArticleFunnelPreviewToken(payload) {
  const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const compressed = zlib.deflateRawSync(jsonBuffer);
  const signature = signArticleFunnelPreviewBuffer(compressed);
  return `${base64UrlEncode(compressed)}.${base64UrlEncode(signature)}`;
}

function decodeArticleFunnelPreviewToken(token) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) {
    throw new Error("INVALID_PREVIEW_TOKEN");
  }
  const compressed = base64UrlDecode(payloadPart);
  const signature = base64UrlDecode(signaturePart);
  const expectedSignature = signArticleFunnelPreviewBuffer(compressed);
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(signature, expectedSignature)
  ) {
    throw new Error("INVALID_PREVIEW_SIGNATURE");
  }
  const inflated = zlib.inflateRawSync(compressed);
  const payload = JSON.parse(inflated.toString("utf8"));
  if (!payload || typeof payload !== "object") {
    throw new Error("INVALID_PREVIEW_PAYLOAD");
  }
  if (Number(payload.exp || 0) < Date.now()) {
    throw new Error("PREVIEW_TOKEN_EXPIRED");
  }
  return payload;
}

function encodeArticleFunnelPopupTestToken(payload) {
  const jsonBuffer = Buffer.from(JSON.stringify(payload), "utf8");
  const signature = signArticleFunnelPopupTestBuffer(jsonBuffer);
  return `${base64UrlEncode(jsonBuffer)}.${base64UrlEncode(signature)}`;
}

function decodeArticleFunnelPopupTestToken(token) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) {
    throw new Error("INVALID_POPUP_TEST_TOKEN");
  }
  const jsonBuffer = base64UrlDecode(payloadPart);
  const signature = base64UrlDecode(signaturePart);
  const expectedSignature = signArticleFunnelPopupTestBuffer(jsonBuffer);
  if (
    signature.length !== expectedSignature.length ||
    !crypto.timingSafeEqual(signature, expectedSignature)
  ) {
    throw new Error("INVALID_POPUP_TEST_SIGNATURE");
  }
  const payload = JSON.parse(jsonBuffer.toString("utf8"));
  if (!payload || typeof payload !== "object") {
    throw new Error("INVALID_POPUP_TEST_PAYLOAD");
  }
  if (Number(payload.exp || 0) < Date.now()) {
    throw new Error("POPUP_TEST_TOKEN_EXPIRED");
  }
  return payload;
}

function normalizeArticleFunnelBlocks(blocks) {
  const allowedTypes = new Set([
    "image",
    "video",
    "sensitive-image",
    "sensitive-video",
    "paragraph",
  ]);
  if (!Array.isArray(blocks)) return [];
  return blocks
    .map((block) => ({
      type: allowedTypes.has(String(block?.type || ""))
        ? String(block.type)
        : "image",
      text: String(block?.text || ""),
      src: String(block?.src || "").trim(),
      caption: String(block?.caption || "").trim(),
    }))
    .filter((block) => block.type === "paragraph" || block.src);
}

function normalizeArticleFunnelPreviewSlug(input = "") {
  return String(input || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/[\/_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 90) || "article-preview";
}

function normalizeArticleFunnelPreviewConfig(input, resolvedStages = null) {
  const config = input && typeof input === "object" ? input : {};
  const overlay = config.overlay && typeof config.overlay === "object"
    ? config.overlay
    : {};
  const shareImage = String(config.share_image || config.shareImage || "").trim();
  const overlayImage = String(
    overlay.image || overlay.popup_3s_image || config.overlayImage || "",
  ).trim();
  const overlay20sImage = String(
    overlay.popup_20s_image ||
      overlay.popup_5s_image ||
      config.overlay20sImage ||
      "",
  ).trim();
  const overlay300sImage = String(overlay.popup_300s_image || "").trim();
  const getOverlayImageForStage = (stageKey) => {
    if (stageKey === "20s") {
      return overlay20sImage || overlayImage || shareImage;
    }
    if (stageKey === "300s") {
      return overlay300sImage || overlayImage || shareImage;
    }
    return overlayImage || shareImage;
  };
  const inputStages = Array.isArray(config.stages) ? config.stages : [];
  const normalizedStages =
    resolvedStages ||
    (inputStages.length
      ? inputStages.map((stage, index) => {
          const rawStageKey = String(stage?.stage_key || "").trim();
          const fallbackStageKey =
            index === 0 ? "3s" : index === 1 ? "20s" : "300s";
          const stageKey =
            rawStageKey === "5s" ? "20s" : rawStageKey || fallbackStageKey;
          const fallbackDelayMs =
            stageKey === "3s" ? 3000 : stageKey === "20s" ? 15000 : 300000;
          const parsedDelayMs = Number(stage?.delay_ms || 0) || 0;
          const delayMs =
            stageKey === "20s" && (rawStageKey === "5s" || parsedDelayMs === 5000)
              ? 15000
              : parsedDelayMs || fallbackDelayMs;
          return {
            ...stage,
            stage_key: stageKey,
            delay_ms: delayMs,
            overlay_image: String(stage?.overlay_image || "").trim() || getOverlayImageForStage(stageKey),
          };
        })
      : [
          {
            stage_key: "3s",
            delay_ms: 3000,
            overlay_image: getOverlayImageForStage("3s"),
            ...buildOverlayLaunchConfig(
              overlay.popup_3s_url || config.baseUrl || "",
            ),
          },
          ...((overlay.popup_20s_url || overlay.popup_5s_url)
            ? [{
                stage_key: "20s",
                delay_ms: 15000,
                overlay_image: getOverlayImageForStage("20s"),
                ...buildOverlayLaunchConfig(
                  overlay.popup_20s_url || overlay.popup_5s_url || "",
                ),
              }]
            : []),
          ...(overlay.popup_300s_url
            ? [{
                stage_key: "300s",
                delay_ms: 300000,
                overlay_image: getOverlayImageForStage("300s"),
                ...buildOverlayLaunchConfig(
                  overlay.popup_300s_url || "",
                ),
              }]
            : []),
        ]);

  return {
    source_domain: String(config.sourceDomain || config.source_domain || "").trim(),
    slug: String(config.slug || "").trim(),
    reference_source_url: String(
      config.reference_source_url || config.referenceSourceUrl || config.original_url || "",
    ).trim(),
    title: String(config.title || "").trim() || "Article preview",
    description: String(config.description || config.desc || "").trim(),
    share_image: shareImage,
    overlay_image: overlayImage,
    group_label: String(config.group_label || config.groupLabel || "Group facebook").trim(),
    group_url: String(config.group_url || config.groupUrl || "").trim(),
    backup_label: String(config.backup_label || config.backupLabel || "Page phu").trim(),
    backup_url: String(config.backup_url || config.backupUrl || "").trim(),
    blocks: normalizeArticleFunnelBlocks(config.blocks),
    stages: normalizedStages.map((stage) => {
      const normalizedStageKey =
        String(stage.stage_key || "").trim() === "5s"
          ? "20s"
          : String(stage.stage_key || "").trim();
      const normalizedStage = {
        stage_key: normalizedStageKey,
        delay_ms:
          String(stage.stage_key || "").trim() === "5s" &&
          Number(stage.delay_ms || 0) === 5000
            ? 15000
            : Number(stage.delay_ms || 0) || 0,
        target_url: String(stage.target_url || "").trim(),
        overlay_image:
          String(stage.overlay_image || "").trim() ||
          getOverlayImageForStage(normalizedStageKey),
        direct_platform: String(stage.direct_platform || "generic").trim(),
        direct_web_url: String(stage.direct_web_url || "").trim(),
        direct_app_url: String(stage.direct_app_url || "").trim(),
        direct_ios_url: String(stage.direct_ios_url || "").trim(),
        direct_ios_fb_url: String(stage.direct_ios_fb_url || "").trim(),
        direct_ios_browser_url: String(
          stage.direct_ios_browser_url || "",
        ).trim(),
        direct_android_url: String(stage.direct_android_url || "").trim(),
        direct_android_intent_url: String(
          stage.direct_android_intent_url || "",
        ).trim(),
        direct_android_package: String(
          stage.direct_android_package || "",
        ).trim(),
      };
      return applyArticleFunnelStageDirectOverrides(
        { stage_key: normalizedStageKey },
        normalizedStage,
        config,
      );
    }),
  };
}

async function resolveArticleFunnelConfig(rawConfig) {
  const baseConfig = normalizeArticleFunnelPreviewConfig(rawConfig);
  const resolvedStages = await Promise.all(
    (baseConfig.stages || []).map(async (stage) => {
      const candidateUrl =
        stage.target_url || stage.direct_web_url || stage.direct_app_url || "";
      let finalUrl = candidateUrl;
      try {
        const normalizedUrl =
          normalizeAffiliatePresetUrl(
            candidateUrl,
            inferAffiliatePlatformFromUrl(candidateUrl),
          ) ||
          normalizeAffiliatePresetUrl(candidateUrl) ||
          candidateUrl;
        if (inferAffiliatePlatformFromUrl(normalizedUrl) === "tiktok" &&
            isTikTokShortShareUrl(normalizedUrl)) {
          finalUrl = String(normalizedUrl || candidateUrl).trim();
        } else {
          const health = await fetchAffiliateHealth(normalizedUrl);
          finalUrl = String(
            health?.final_url || normalizedUrl || candidateUrl,
          ).trim();
        }
      } catch {}
      return {
        stage_key: stage.stage_key,
        delay_ms: stage.delay_ms,
        ...applyArticleFunnelStageDirectOverrides(
          stage,
          buildOverlayLaunchConfig(finalUrl),
          rawConfig,
        ),
      };
    }),
  );
  return normalizeArticleFunnelPreviewConfig(rawConfig, resolvedStages);
}

function hasArticleFunnelStage(configInput, stageKey = "20s") {
  const normalizedStageKey = normalizeArticleFunnelStageKey(stageKey);
  const config =
    configInput && typeof configInput === "object"
      ? normalizeArticleFunnelPreviewConfig(configInput)
      : normalizeArticleFunnelPreviewConfig({});
  return (config.stages || []).some(
    (stage) =>
      normalizeArticleFunnelStageKey(stage?.stage_key || "") ===
      normalizedStageKey,
  );
}

function buildArticleFunnelPublicUrl(
  routeSlug,
  domainHostname,
  fallbackBaseUrl = BASE_URL,
) {
  const baseUrl = domainHostname ? `https://${domainHostname}` : fallbackBaseUrl;
  return buildShortUrl(baseUrl, encodeURIComponent(routeSlug || ""));
}

function buildArticleFunnelLaunchBasePath(routeSlug) {
  const normalizedSlug = encodeURIComponent(String(routeSlug || "").trim());
  return normalizedSlug ? `/${normalizedSlug}/launch` : "/launch";
}

function buildArticleFunnelBridgeBasePath(routeSlug) {
  const normalizedSlug = encodeURIComponent(String(routeSlug || "").trim());
  return normalizedSlug ? `/${normalizedSlug}/bridge` : "/bridge";
}

function buildArticleFunnelPopupTestUrl(
  routeSlug,
  domainHostname,
  fallbackBaseUrl = BASE_URL,
  stageKey = "20s",
  expiresAt = Date.now() + ARTICLE_FUNNEL_POPUP_TEST_TOKEN_TTL_MS,
) {
  const normalizedRouteSlug = String(routeSlug || "").trim();
  const normalizedStageKey = normalizeArticleFunnelStageKey(stageKey);
  if (!normalizedRouteSlug || !normalizedStageKey) return "";
  const publicUrl = buildArticleFunnelPublicUrl(
    normalizedRouteSlug,
    domainHostname,
    fallbackBaseUrl,
  );
  const token = encodeArticleFunnelPopupTestToken({
    v: 1,
    exp: expiresAt,
    route_slug: normalizedRouteSlug,
    stage_key: normalizedStageKey,
  });
  try {
    const url = new URL(publicUrl);
    url.searchParams.set("popup_test", normalizedStageKey);
    url.searchParams.set("popup_test_token", token);
    return url.toString();
  } catch {
    return publicUrl;
  }
}

function isArticleFunnelPopupTestRequestAllowed(
  req,
  routeSlug,
  stageKey = "20s",
) {
  const normalizedRouteSlug = String(routeSlug || "").trim();
  const requestedStageKey = normalizeArticleFunnelStageKey(
    req?.query?.popup_test || "",
  );
  const expectedStageKey = normalizeArticleFunnelStageKey(stageKey);
  const token = String(req?.query?.popup_test_token || "").trim();
  if (
    !normalizedRouteSlug ||
    !expectedStageKey ||
    requestedStageKey !== expectedStageKey ||
    !token
  ) {
    return false;
  }
  try {
    const payload = decodeArticleFunnelPopupTestToken(token);
    return (
      normalizeArticleFunnelStageKey(payload?.stage_key || "") ===
        expectedStageKey &&
      String(payload?.route_slug || "").trim() === normalizedRouteSlug
    );
  } catch {
    return false;
  }
}

function normalizeArticleFunnelStageKey(stageKey = "") {
  return String(stageKey || "").trim() === "5s"
    ? "20s"
    : String(stageKey || "").trim();
}

function decorateArticleFunnelStagesForClient(stages, tracking = {}) {
  const routeSlug = String(tracking?.routeSlug || "").trim();
  return (Array.isArray(stages) ? stages : []).map((stage) => {
    const normalizedStageKey = normalizeArticleFunnelStageKey(stage?.stage_key || "");
    const directPlatform = String(stage?.direct_platform || "").trim().toLowerCase();
    const nextStage = {
      ...(stage && typeof stage === "object" ? stage : {}),
      stage_key: normalizedStageKey,
    };

    if (
      routeSlug &&
      normalizedStageKey === "20s" &&
      directPlatform === "tiktok"
    ) {
      nextStage.track_click_api = "/api/article-funnel/track-click";
      nextStage.tracking_route_slug = routeSlug;
    }

    return nextStage;
  });
}

function shouldUseArticleFunnelInlineLaunch(stage) {
  const normalizedStageKey = normalizeArticleFunnelStageKey(
    stage?.stage_key || "",
  );
  const directPlatform = String(stage?.direct_platform || "")
    .trim()
    .toLowerCase();
  return (
    (normalizedStageKey === "3s" && directPlatform === "shopee") ||
    (normalizedStageKey === "20s" && directPlatform === "tiktok")
  );
}

function getRequestHostname(req) {
  return normalizeDomainHost(
    req.headers["x-forwarded-host"] ||
      req.headers["host"] ||
      req.hostname ||
      "",
  );
}

function canServePublishedArticleFunnelOnHost(
  articleFunnel,
  requestHostname,
  fallbackBaseUrl = BASE_URL,
) {
  const targetHostname = normalizeDomainHost(articleFunnel?.domain_hostname);
  if (targetHostname) {
    return !requestHostname || requestHostname === targetHostname;
  }
  const fallbackHostname = normalizeDomainHost(fallbackBaseUrl);
  return !requestHostname || !fallbackHostname || requestHostname === fallbackHostname;
}

function isReservedPublishedArticleSlug(slug) {
  const value = String(slug || "").trim();
  return !value || value.includes(".") || /^(api|uploads|admin|go|_lab)$/i.test(value);
}

async function findShortLinkSlugConflict(database, slug) {
  const normalizedSlug = String(slug || "").trim();
  if (!normalizedSlug) return null;
  return (
    (await database.getLinkByAlias(normalizedSlug)) ||
    (await database.getLinkByCode(normalizedSlug)) ||
    null
  );
}

async function recordArticleFunnelStageClick({
  database,
  req,
  tracking,
  stageKey,
}) {
  const routeSlug = String(tracking?.routeSlug || "").trim();
  if (!database || !routeSlug) {
    return { counted: false, skipped: true };
  }
  return database.recordArticleFunnelClick(
    routeSlug,
    normalizeArticleFunnelStageKey(stageKey),
    getRequestIp(req),
    req.headers["user-agent"] || "",
    req.headers["referer"] || "",
    extractClickGeo(req),
  );
}

function buildArticleFunnelRedirectMeta(tracking, stageKey) {
  const routeSlug = String(tracking?.routeSlug || "").trim();
  if (!routeSlug) return {};
  return {
    articleFunnelId: Number(tracking?.articleFunnelId || 0) || null,
    articleFunnelSlug: routeSlug,
    articleFunnelStageKey: normalizeArticleFunnelStageKey(stageKey),
  };
}

function shouldUseArticleFunnelPopup20sDirectBridgeFlow(
  stage,
  info,
  launchOptions = null,
) {
  const normalizedStageKey = normalizeArticleFunnelStageKey(
    stage?.stage_key || "",
  );
  const directPlatform = String(
    info?.platform_name || stage?.direct_platform || "",
  )
    .trim()
    .toLowerCase();
  return (
    Boolean(launchOptions?.preferPopup20sDirectBridgeFlow) &&
    normalizedStageKey === "20s" &&
    directPlatform === "tiktok"
  );
}

function buildArticleFunnelPopup20sDirectBridgeInfo(stage, targetUrl, info) {
  const normalizedTargetUrl = String(
    stage?.direct_web_url ||
      targetUrl ||
      stage?.target_url ||
      stage?.direct_app_url ||
      "",
  ).trim();
  const browserUrl = String(
    stage?.direct_ios_browser_url || normalizedTargetUrl || info?.fallback || "",
  ).trim();
  const iosInAppUrl = String(
    stage?.direct_ios_fb_url || browserUrl,
  ).trim();

  return {
    ...(info && typeof info === "object" ? info : {}),
    deeplink: iosInAppUrl || browserUrl,
    deeplink_ios: iosInAppUrl || browserUrl,
    deeplink_android: browserUrl,
    fallback: browserUrl,
    popup20s_browser_url: browserUrl,
    popup20s_ios_inapp_url: iosInAppUrl || browserUrl,
    universal_link: String(info?.universal_link || browserUrl).trim(),
    platform_name:
      String(
        info?.platform_name ||
          stage?.direct_platform ||
          "tiktok",
      )
        .trim()
        .toLowerCase() || "tiktok",
  };
}

async function handleArticleFunnelStageLaunch({
  req,
  res,
  config,
  stageKey,
  canonicalUrl,
  tracking = null,
  launchOptions = null,
}) {
  const normalizedStageKey = normalizeArticleFunnelStageKey(stageKey);
  const stage = (config.stages || []).find(
    (item) => String(item?.stage_key || "").trim() === normalizedStageKey,
  );
  if (!stage) {
    return res.status(404).send("Khong tim thay popup stage");
  }

  const targetUrl = String(
    stage.target_url || stage.direct_web_url || stage.direct_app_url || "",
  ).trim();
  if (!targetUrl) {
    return res.status(400).send("Stage target khong hop le");
  }

  const ua = req.headers["user-agent"] || "";
  const referer = req.headers["referer"] || "";
  const platform = getMobilePlatform(ua);
  const uaKind = getRedirectUaKind(ua);
  const info = detectPlatformDeep(targetUrl, platform);
  const articleFunnelLogMeta = buildArticleFunnelRedirectMeta(
    tracking,
    normalizedStageKey,
  );
  const isFacebookInApp = isFacebookInAppBrowser(ua);
  const isZaloInApp = /ZaloApp/i.test(ua);
  const isIosInApp = platform === "ios" && (isFacebookInApp || isZaloInApp);
  const launchLink = {
    original_url: targetUrl,
    og_title: config.title || "Article preview",
    og_desc: config.title || "Dang mo ung dung dich de tiep tuc xem noi dung.",
    og_image: config.share_image || config.overlay_image || "",
  };

  if (tracking?.routeSlug) {
    try {
      const database = await getDb();
      await recordArticleFunnelStageClick({
        database,
        req,
        tracking,
        stageKey: normalizedStageKey,
      });
    } catch (error) {
      console.warn(
        "[article-funnel/click-track]",
        String(error?.message || error || "").trim() || "unknown error",
      );
    }
  }

  if (isIosInApp && info.platform_name !== "tiktok") {
    const iosInAppTarget = String(
      stage.direct_ios_fb_url ||
        stage.direct_web_url ||
        stage.direct_ios_url ||
        targetUrl,
    ).trim();
    setRedirectDebugHeaders(res, {
      mode: "article-funnel-launch-ios-inapp-direct",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: "article-funnel-launch-ios-inapp-direct",
      platform: info.platform_name,
      uaKind,
      status: 302,
      target: iosInAppTarget,
      referer,
      ...articleFunnelLogMeta,
    });
    return res.redirect(302, iosInAppTarget);
  }

  if (isIosInApp && info.platform_name === "tiktok") {
    const usePopup20sDirectBridgeFlow =
      shouldUseArticleFunnelPopup20sDirectBridgeFlow(
        stage,
        info,
        launchOptions,
      );
    const bridgeInfo = usePopup20sDirectBridgeFlow
      ? buildArticleFunnelPopup20sDirectBridgeInfo(stage, targetUrl, info)
      : (() => {
          const preferredTikTokIosTarget = String(
            stage.direct_ios_fb_url ||
              stage.direct_ios_url ||
              info.deeplink_ios ||
              info.deeplink ||
              targetUrl,
          ).trim();
          const preferredTikTokAppTarget =
            isTikTokShortShareUrl(preferredTikTokIosTarget)
              ? preferredTikTokIosTarget
              : String(
                  stage.direct_app_url || info.deeplink || targetUrl,
                ).trim();
          return {
            ...info,
            deeplink: preferredTikTokAppTarget,
            deeplink_ios: preferredTikTokIosTarget,
            deeplink_android: String(
              stage.direct_android_url ||
                info.deeplink_android ||
                info.deeplink ||
                targetUrl,
            ).trim(),
            fallback: String(
              stage.direct_web_url || info.fallback || targetUrl,
            ).trim(),
          };
        })();
    const bridgeMode = usePopup20sDirectBridgeFlow
      ? "article-funnel-launch-tiktok-popup20s-direct-bridge"
      : "article-funnel-launch-tiktok-direct-bridge";
    setRedirectDebugHeaders(res, {
      mode: bridgeMode,
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: bridgeMode,
      platform: info.platform_name,
      uaKind,
      status: 200,
      target:
        bridgeInfo.popup20s_ios_inapp_url ||
        bridgeInfo.deeplink_ios ||
        bridgeInfo.deeplink ||
        targetUrl,
      referer,
      ...articleFunnelLogMeta,
    });
    res.set({
      "Cache-Control": "no-cache,no-store,must-revalidate",
      Pragma: "no-cache",
      "Content-Type": "text/html;charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
    });
    return res.send(
      usePopup20sDirectBridgeFlow
        ? buildArticleFunnelPopup20sTikTokBridgePage(
            launchLink,
            canonicalUrl,
            bridgeInfo,
          )
        : buildDirectBridgePage(launchLink, canonicalUrl, bridgeInfo),
    );
  }

  if (
    platform !== "desktop" &&
    info.platform_name === "shopee" &&
    isFacebookInApp
  ) {
    setRedirectDebugHeaders(res, {
      mode: "article-funnel-launch-shopee-facebook-bridge",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: "article-funnel-launch-shopee-facebook-bridge",
      platform: info.platform_name,
      uaKind,
      status: 200,
      target: targetUrl,
      referer,
      ...articleFunnelLogMeta,
    });
    res.set({
      "Cache-Control": "no-cache,no-store,must-revalidate",
      Pragma: "no-cache",
      "Content-Type": "text/html;charset=utf-8",
      "X-Frame-Options": "SAMEORIGIN",
    });
    return res.send(buildDirectBridgePage(launchLink, canonicalUrl, info));
  }

  if (platform === "desktop") {
    setRedirectDebugHeaders(res, {
      mode: "article-funnel-launch-desktop-redirect",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: "article-funnel-launch-desktop-redirect",
      platform: info.platform_name,
      uaKind,
      status: 302,
      target: targetUrl,
      referer,
      ...articleFunnelLogMeta,
    });
    return res.redirect(302, targetUrl);
  }

  if (info.platform_name === "shopee") {
    const shopeeTarget = info.deeplink || targetUrl;
    setRedirectDebugHeaders(res, {
      mode: "article-funnel-launch-shopee-direct-redirect",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: "article-funnel-launch-shopee-direct-redirect",
      platform: info.platform_name,
      uaKind,
      status: 301,
      target: shopeeTarget,
      referer,
      ...articleFunnelLogMeta,
    });
    return res.redirect(301, shopeeTarget);
  }

  if (info.deeplink) {
    setRedirectDebugHeaders(res, {
      mode: "article-funnel-launch-deeplink-bridge",
      platform: info.platform_name,
    });
    logRedirectDecision({
      requestId: req.requestId,
      linkId: 0,
      code: `article-funnel:${normalizedStageKey}`,
      mode: "article-funnel-launch-deeplink-bridge",
      platform: info.platform_name,
      uaKind,
      status: 200,
      target: info.deeplink || targetUrl,
      referer,
      ...articleFunnelLogMeta,
    });
    res.set({
      "Cache-Control": "no-cache,no-store,must-revalidate",
      Pragma: "no-cache",
    });
    return res.send(buildDirectBridgePage(launchLink, canonicalUrl, info));
  }

  setRedirectDebugHeaders(res, {
    mode: "article-funnel-launch-mobile-direct",
    platform: info.platform_name,
  });
  logRedirectDecision({
    requestId: req.requestId,
    linkId: 0,
    code: `article-funnel:${normalizedStageKey}`,
    mode: "article-funnel-launch-mobile-direct",
    platform: info.platform_name,
    uaKind,
    status: 302,
    target: targetUrl,
    referer,
    ...articleFunnelLogMeta,
  });
  return res.redirect(302, targetUrl);
}

function buildArticleFunnelPreviewPage(
  config,
  canonicalUrl,
  launchBasePath = "",
  trackingContext = null,
  bridgeBasePath = "",
) {
  const title = esc(config.title || "Article preview");
  const description = esc(String(config.description || "").trim());
  const shareImage = String(config.share_image || "").trim();
  const groupLabel = esc(config.group_label || "Group facebook");
  const groupUrl = esc(config.group_url || "");
  const backupLabel = esc(config.backup_label || "Page phu");
  const backupUrl = esc(config.backup_url || "");
  const ogImageTag = shareImage
    ? `<meta property="og:image" content="${esc(shareImage)}" />
<meta name="twitter:image" content="${esc(shareImage)}" />`
    : "";
  const blocks = JSON.stringify(config.blocks || []);
  const stages = JSON.stringify(
    (config.stages || []).map((stage) => ({
      ...stage,
      use_inline_launch: shouldUseArticleFunnelInlineLaunch(stage),
    })),
  );
  const defaultOverlayImage = JSON.stringify(config.overlay_image || shareImage || "");
  const launchBasePathJson = JSON.stringify(String(launchBasePath || "").trim());
  const bridgeBasePathJson = JSON.stringify(String(bridgeBasePath || "").trim());
  const trackingRouteSlugJson = JSON.stringify(
    String(
      trackingContext?.routeSlug || trackingContext?.route_slug || "",
    ).trim() || null,
  );
  const showPopupTestButtonJson = JSON.stringify(
    Boolean(
      trackingContext?.showPopupTestButton ||
        trackingContext?.show_popup_test_button,
    ),
  );

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${title}</title>
<meta name="description" content="${description || title}" />
<meta name="robots" content="noindex, nofollow" />
<link rel="canonical" href="${esc(canonicalUrl)}" />
<meta property="og:type" content="article" />
<meta property="og:title" content="${title}" />
<meta property="og:description" content="${description || title}" />
<meta property="og:url" content="${esc(canonicalUrl)}" />
<meta property="og:site_name" content="BocLink Article Preview" />
${ogImageTag}
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${title}" />
<meta name="twitter:description" content="${description || title}" />
<style>
  :root{color-scheme:light;--page-gutter:clamp(18px,5vw,120px);--content-width:650px}
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;background:#fff;color:#000;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
  a{color:inherit}
  .article{min-height:100vh;padding:48px var(--page-gutter) 60px;background:#fff}
  .article-inner{width:min(100%,1440px);margin:0 auto}
  .article-column{width:min(100%,var(--content-width));margin:0 auto}
  .article-title{margin:0;font-size:clamp(42px,7vw,58px);line-height:1.2;letter-spacing:-.045em;font-weight:400;text-wrap:balance}
  .article-description{margin:34px 0 0;font-size:18px;line-height:1.6;color:#000;white-space:pre-wrap}
  .article-blocks{margin-top:24px;display:grid;gap:24px}
  .article-paragraph{margin:0;font-size:18px;line-height:1.6;color:#000;white-space:pre-wrap}
  .article-media{margin:0}
  .article-media img,.article-media video{display:block;width:100%;height:auto;background:#111}
  .article-caption{padding:10px 0 0;color:rgba(0,0,0,.66);font-size:13px;line-height:1.5}
  .sensitive-wrap{position:relative;overflow:hidden;background:#101010}
  .sensitive-wrap[data-sensitive-kind="video"]{background:#000;aspect-ratio:var(--sensitive-ratio,auto)}
  .sensitive-wrap img,.sensitive-wrap video{filter:blur(10px);transform:scale(1);transform-origin:center;transition:filter .5s ease,transform .5s ease}
  .sensitive-wrap[data-sensitive-kind="video"] video{width:100%;min-height:220px;object-fit:contain;background:#000}
  .sensitive-wrap.revealed img,.sensitive-wrap.revealed video{filter:none;transform:scale(1)}
  .sensitive-wrap::after{display:none}
  .reveal-btn{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);min-width:min(60%,294px);max-width:calc(100% - 32px);padding:15px 30px;border:0;border-radius:8px;background:rgba(0,0,0,.8);box-shadow:0 4px 6px rgba(0,0,0,.1);color:#fff;font:inherit;font-weight:700;line-height:1.08;text-align:center;cursor:pointer;z-index:2}
  .reveal-btn:hover{background:rgba(0,0,0,1)}
  .sensitive-wrap[data-sensitive-kind="video"] .reveal-btn{width:min(calc(100% - 40px),340px);min-width:0;padding:14px 24px 13px;border-radius:10px;font-size:clamp(17px,1.55vw,20px);font-weight:700;letter-spacing:-.02em}
  .follow-box{margin-top:72px;padding-top:28px;border-top:1px solid rgba(0,0,0,.22);display:grid;gap:18px}
  .follow-row{font-size:18px;line-height:1.6;color:#000;word-break:break-word}
  .follow-row.is-centered{text-align:center}
  .follow-row strong{font-weight:700}
  .follow-row a{text-decoration:underline;text-underline-offset:3px}
  .overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;padding:18px;background:rgba(0,0,0,.6);z-index:30}
  .overlay.show{display:flex}
  .overlay-stack{position:relative;width:min(100%,352px);min-height:320px}
  .overlay-card{position:absolute;inset:auto 0 0 0;width:min(100%,328px);margin:0 auto;border-radius:22px;overflow:hidden;background:#fff;box-shadow:0 32px 70px rgba(0,0,0,.44)}
  .overlay-image-hit{display:block;cursor:pointer}
  .overlay-card img{display:block;width:100%;height:auto}
  .overlay-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:999px;background:rgba(15,23,42,.82);color:#fff;font:inherit;font-weight:800;cursor:pointer;z-index:2}
  .popup-test-fab{position:fixed;right:18px;bottom:18px;z-index:20;display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:12px 16px;border:0;border-radius:999px;background:rgba(15,23,42,.92);box-shadow:0 18px 42px rgba(15,23,42,.28);color:#fff;font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;cursor:pointer}
  .popup-test-fab[hidden]{display:none}
  .popup-test-fab:hover{background:#0f172a}
  @media (max-width: 900px){
    .article{padding-top:28px}
    .article-description{margin-top:26px}
    .follow-box{margin-top:56px}
  }
  @media (max-width: 640px){
    .article{padding-inline:18px}
    .reveal-btn{width:calc(100% - 32px);min-width:0}
    .popup-test-fab{right:14px;bottom:14px;padding:11px 14px;font-size:13px}
  }
</style>
</head>
<body>
  <div class="article">
    <div class="article-inner">
      <div class="article-column">
        <h1 class="article-title">${title}</h1>
        ${description ? `<p class="article-description">${description}</p>` : ""}
        <div class="article-blocks" id="previewBlocks"></div>
        <div class="follow-box">
          <div class="follow-row"><strong>${groupLabel}</strong>: <a href="${groupUrl}" target="_blank" rel="noopener">${groupUrl}</a></div>
          <div class="follow-row"><strong>${backupLabel}</strong>: <a href="${backupUrl}" target="_blank" rel="noopener">${backupUrl}</a></div>
        </div>
      </div>
    </div>
  </div>
  <div class="overlay" id="overlay"><div class="overlay-stack" id="overlayStack"></div></div>
  <button type="button" class="popup-test-fab" id="popupTest20sBtn" hidden>Mở popup 20s</button>
<script>
(function(){
  var blocks = ${blocks};
  var stages = ${stages};
  var defaultOverlayImage = ${defaultOverlayImage};
  var launchBasePath = ${launchBasePathJson};
  var bridgeBasePath = ${bridgeBasePathJson};
  var trackingRouteSlug = ${trackingRouteSlugJson};
  var canShowPopupTestButton = ${showPopupTestButtonJson};
  var pendingStages = [];
  var overlayEl = document.getElementById('overlay');
  var overlayStackEl = document.getElementById('overlayStack');
  var previewBlocksEl = document.getElementById('previewBlocks');
  var popupTest20sBtn = document.getElementById('popupTest20sBtn');

  function getUserAgent() {
    return navigator.userAgent || '';
  }

  function isIOSDevice() {
    return /iphone|ipad|ipod/i.test(getUserAgent());
  }

  function isAndroidDevice() {
    return /android/i.test(getUserAgent());
  }

  function isSupportedMobileDevice() {
    return isIOSDevice() || isAndroidDevice();
  }

  function isFacebookInAppBrowser() {
    return /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(getUserAgent());
  }

  function isInAppBrowser() {
    return isFacebookInAppBrowser() || /ZaloApp/i.test(getUserAgent());
  }

  function getPopupDismissScopeKey() {
    return String(launchBasePath || location.pathname || 'lab')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'lab';
  }

  function getPopupDismissCookieName(stageKey) {
    return 'popup_closed_' +
      getPopupDismissScopeKey() +
      '_' +
      encodeURIComponent(String(stageKey || ''));
  }

  function setPopupDismissCookie(stageKey) {
    var minutes =
      String(stageKey || '') === '300s'
        ? 180
        : String(stageKey || '') === '20s'
          ? 60
          : 30;
    var expiresAt = new Date();
    expiresAt.setTime(expiresAt.getTime() + minutes * 60 * 1000);
    document.cookie =
      getPopupDismissCookieName(stageKey) +
      '=yes; expires=' +
      expiresAt.toUTCString() +
      '; path=/';
  }

  function hasPopupDismissCookie(stageKey) {
    var key = getPopupDismissCookieName(stageKey) + '=';
    return document.cookie
      .split(';')
      .map(function(part) { return part.trim(); })
      .some(function(part) { return part.indexOf(key) === 0; });
  }

  function escHtml(value){
    return String(value||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function renderBlocks(){
    previewBlocksEl.innerHTML = blocks.map(function(block){
      if (block.type === 'paragraph') {
        return '<p class="article-paragraph">'+escHtml(block.text||'')+'</p>';
      }
      if (block.type === 'video') {
        return '<figure class="article-media"><video controls preload="metadata" src="'+escHtml(block.src||'')+'"></video>'+(block.caption?'<figcaption class="article-caption">'+escHtml(block.caption)+'</figcaption>':'')+'</figure>';
      }
      if (block.type === 'sensitive-video') {
        return '<figure class="article-media"><div class="sensitive-wrap" data-sensitive-wrap data-sensitive-kind="video"><video preload="auto" playsinline muted src="'+escHtml(block.src||'')+'"></video><button class="reveal-btn" type="button" data-reveal-sensitive>Video nhạy cảm, muốn xem thì nhấn vào?</button></div>'+(block.caption?'<figcaption class="article-caption">'+escHtml(block.caption)+'</figcaption>':'')+'</figure>';
      }
      if (block.type === 'sensitive-image') {
        return '<figure class="article-media"><div class="sensitive-wrap" data-sensitive-wrap data-sensitive-kind="image"><img src="'+escHtml(block.src||'')+'" alt="" /><button class="reveal-btn" type="button" data-reveal-sensitive>Hình ảnh nhạy cảm, muốn xem thì nhấn vào?</button></div>'+(block.caption?'<figcaption class="article-caption">'+escHtml(block.caption)+'</figcaption>':'')+'</figure>';
      }
      return '<figure class="article-media"><img src="'+escHtml(block.src||'')+'" alt="" />'+(block.caption?'<figcaption class="article-caption">'+escHtml(block.caption)+'</figcaption>':'')+'</figure>';
    }).join('');
  }

  function syncSensitiveWraps(){
    Array.from(previewBlocksEl.querySelectorAll('[data-sensitive-wrap]')).forEach(function(wrap){
      var media = wrap.querySelector('img,video');
      if (!media) return;
      if (media.tagName === 'VIDEO') {
        primeSensitiveVideo(media);
      }
      var revealed = !wrap.querySelector('[data-reveal-sensitive]');
      if (revealed) {
        wrap.classList.add('revealed');
        media.style.filter = 'none';
        media.style.transform = 'scale(1)';
        return;
      }
      wrap.classList.remove('revealed');
      media.style.filter = 'blur(10px)';
      media.style.transform = 'scale(1)';
    });
  }

  function syncSensitiveVideoFrame(wrap){
    if (!wrap || String(wrap.getAttribute('data-sensitive-kind') || '') !== 'video') return;
    var media = wrap.querySelector('video');
    if (!media) return;
    if (media.videoWidth && media.videoHeight) {
      wrap.style.setProperty('--sensitive-ratio', media.videoWidth + ' / ' + media.videoHeight);
    }
  }

  function primeSensitiveVideo(video){
    if (!video || video.dataset.framePrimed === 'true') return;
    video.dataset.framePrimed = 'true';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    var wrap = video.closest('[data-sensitive-wrap]');
    var syncWrap = function(){
      syncSensitiveVideoFrame(wrap);
    };
    var primeFrame = function(){
      syncWrap();
      if (!video.duration || video.duration <= 0) return;
      if (video.currentTime > 0.01) return;
      try {
        video.currentTime = Math.min(0.08, Math.max(video.duration - 0.02, 0.01));
      } catch (_) {}
    };
    video.addEventListener('loadedmetadata', syncWrap);
    video.addEventListener('loadeddata', primeFrame);
    video.addEventListener('seeked', function(){
      syncWrap();
      video.pause();
    });
    if (video.readyState >= 1) syncWrap();
    if (video.readyState >= 2) {
      primeFrame();
    }
  }

  function revealSensitiveWrap(wrap){
    if(!wrap) return;
    wrap.classList.add('revealed');
    var media = wrap.querySelector('img,video');
    if (media) {
      media.style.filter = 'none';
      media.style.transform = 'scale(1)';
      if (String(wrap.getAttribute('data-sensitive-kind') || '') === 'video' && media.tagName === 'VIDEO') {
        media.setAttribute('controls', '');
        var playPromise = media.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(function(){});
        }
      }
    }
    var button = wrap.querySelector('[data-reveal-sensitive]');
    if (button) {
      button.remove();
    }
  }

  function getStackStyle(index,total){
    var depthFromTop = total-index-1;
    var offset = depthFromTop*16;
    var scale = 1-depthFromTop*0.035;
    var opacity = Math.max(0.48,1-depthFromTop*0.14);
    return 'transform: translateY('+offset+'px) scale('+scale+'); opacity:'+opacity+'; z-index:'+(index+1)+';';
  }

  function getLaunchUrl(stage){
    var stageKey = encodeURIComponent(String(stage && stage.stage_key || ''));
    return (launchBasePath || location.pathname) + '/' + stageKey;
  }

  function shouldUseDedicatedBridgeRoute(stage) {
    return false;
  }

  function getBridgeUrl(stage){
    var stageKey = encodeURIComponent(String(stage && stage.stage_key || ''));
    return (bridgeBasePath || '') ? (bridgeBasePath + '/' + stageKey) : '';
  }

  function getStageOpenUrl(stage) {
    return shouldUseDedicatedBridgeRoute(stage)
      ? (getBridgeUrl(stage) || getLaunchUrl(stage))
      : getLaunchUrl(stage);
  }

  function buildStageTrackPayload(stage) {
    if (!stage || !trackingRouteSlug) return null;
    var stageKey = String(stage.stage_key || '').trim();
    if (!stageKey) return null;
    return {
      route_slug: trackingRouteSlug,
      stage_key: stageKey
    };
  }

  function trackStageClickInBackground(stage) {
    var payload = buildStageTrackPayload(stage);
    if (!payload) return false;
    try {
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon && typeof Blob === 'function') {
        try {
          var beaconBody = new Blob([body], { type: 'application/json' });
          if (navigator.sendBeacon('/api/article-funnel/track-click', beaconBody)) {
            return true;
          }
        } catch (_) {}
      }
      if (window.fetch) {
        fetch('/api/article-funnel/track-click', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'same-origin'
        }).catch(function(){});
        return true;
      }
    } catch (_) {}
    return false;
  }

  function getStageByKey(stageKey){
    return stages.find(function(stage){
      return String(stage && stage.stage_key || '') === String(stageKey || '');
    }) || null;
  }

  function shouldUseLaunchRouteDirectly() {
    return isIOSDevice() && isInAppBrowser();
  }

  function shouldUseNativeLaunchRoute(stage) {
    if (!stage) return false;
    return shouldUseDedicatedBridgeRoute(stage) &&
      isIOSDevice() &&
      isInAppBrowser();
  }

  function shouldUseNativeAnchorLaunch(stage) {
    if (!stage) return false;
    return isIOSDevice() && isInAppBrowser() && stage.direct_platform === 'shopee';
  }

  function getNativeAnchorHref(stage) {
    if (!stage) return '';
    if (stage.use_inline_launch) {
      if (
        String(stage.direct_platform || '').toLowerCase() === 'tiktok' &&
        String(stage.stage_key || '') === '20s'
      ) {
        if (isIOSDevice()) {
          return isInAppBrowser()
            ? (stage.direct_ios_fb_url || stage.direct_ios_browser_url || stage.direct_web_url || stage.target_url || '')
            : (stage.direct_ios_browser_url || stage.direct_web_url || stage.target_url || '');
        }
        return stage.direct_web_url || stage.direct_android_url || stage.target_url || '';
      }
      return stage.direct_web_url || stage.target_url || '';
    }
    return getStageOpenUrl(stage) || stage.direct_web_url || '#';
  }

  function getNativeAnchorTarget(stage) {
    return '_self';
  }

  function getNativeAnchorRel(stage) {
    return 'noreferrer';
  }

  function getNativePopupDirectAppLaunchUrl(stage) {
    if (!stage) return '';
    var launchCandidates = [
      stage.direct_ios_url,
      stage.direct_app_url,
    ];
    for (var index = 0; index < launchCandidates.length; index += 1) {
      var directAppLaunchUrl = String(launchCandidates[index] || '').trim();
      if (directAppLaunchUrl && !/^https?:\\/\\//i.test(directAppLaunchUrl)) {
        return directAppLaunchUrl;
      }
    }
    return '';
  }

  function navigateWindowLocation(targetUrl, options) {
    if (!targetUrl) return false;
    var settings = options && typeof options === 'object' ? options : {};
    var preferTopLevel = Boolean(settings.preferTopLevel);
    var replace = Boolean(settings.replace);
    var navWindow =
      preferTopLevel && window.top && window.top !== window
        ? window.top
        : window;
    try {
      if (replace) {
        navWindow.location.replace(targetUrl);
      } else {
        navWindow.location.href = targetUrl;
      }
      return true;
    } catch (_) {
      if (!replace) {
        return openViaAnchor(
          targetUrl,
          settings.targetName || '_self',
          settings.relValue,
        );
      }
      return false;
    }
  }

  function openViaAnchor(targetUrl, targetName, relValue) {
    if (!targetUrl) return false;
    try {
      var anchor = document.createElement('a');
      anchor.href = targetUrl;
      anchor.rel = relValue || 'noreferrer noopener';
      anchor.target = targetName || '_self';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(function() {
        try { anchor.remove(); } catch (_) {}
      }, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildAndroidIntentUrl(targetUrl, packageName, fallbackUrl) {
    if (!targetUrl || !packageName) return '';
    try {
      var parsed = new URL(targetUrl);
      var noScheme = targetUrl.replace(/^https?:\\/\\//i, '');
      var fallback = fallbackUrl || targetUrl;
      return 'intent://' + noScheme +
        '#Intent;scheme=' + parsed.protocol.replace(':', '') +
        ';package=' + packageName +
        ';S.browser_fallback_url=' + encodeURIComponent(fallback) +
        ';end';
    } catch (_) {
      return '';
    }
  }

  function scheduleLaunchFallback(fallbackUrl, delayMs, options) {
    if (!fallbackUrl) return;
    var didLeave = false;
    var finished = false;
    var blurTimer = null;
    var fallbackDelay = delayMs || 1600;
    var settings = options && typeof options === 'object' ? options : {};
    var preferTopLevel = Boolean(settings.preferTopLevel);

    function markLeft() {
      didLeave = true;
    }

    function clearBlurTimer() {
      if (!blurTimer) return;
      clearTimeout(blurTimer);
      blurTimer = null;
    }

    function cleanup() {
      if (finished) return;
      finished = true;
      clearBlurTimer();
      window.removeEventListener('pagehide', markLeft, true);
      window.removeEventListener('blur', onBlur, true);
      window.removeEventListener('focus', onFocus, true);
      document.removeEventListener('visibilitychange', onVisibilityChange, true);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        clearBlurTimer();
        markLeft();
      }
    }

    function onBlur() {
      clearBlurTimer();
      blurTimer = setTimeout(function() {
        blurTimer = null;
        if (document.hidden || !document.hasFocus()) {
          markLeft();
        }
      }, Math.max(600, Math.min(1200, fallbackDelay - 250)));
    }

    function onFocus() {
      clearBlurTimer();
    }

    window.addEventListener('pagehide', markLeft, true);
    window.addEventListener('blur', onBlur, true);
    window.addEventListener('focus', onFocus, true);
    document.addEventListener('visibilitychange', onVisibilityChange, true);

    setTimeout(function() {
      cleanup();
      if (!didLeave && !document.hidden) {
        if (!navigateWindowLocation(fallbackUrl, {
          preferTopLevel: preferTopLevel,
          replace: true,
        })) {
          window.location.replace(fallbackUrl);
        }
      }
    }, fallbackDelay);
  }

  function launchDirectTarget(stage) {
    if (!stage) return false;
    var isIOS = isIOSDevice();
    var isAndroid = isAndroidDevice();
    var isFacebookInApp = isFacebookInAppBrowser();
    var isInApp = isInAppBrowser();
    var targetUrl = stage.direct_web_url || stage.target_url || stage.direct_app_url || '';

    if (stage.direct_platform === 'shopee') {
      if (isAndroid) {
        var shopeeIntentUrl =
          stage.direct_android_intent_url ||
          buildAndroidIntentUrl(
            stage.direct_android_url || stage.direct_web_url,
            stage.direct_android_package || 'com.shopee.vn',
            stage.direct_web_url
          );
        if (shopeeIntentUrl) {
          openViaAnchor(shopeeIntentUrl);
        } else if (stage.direct_app_url) {
          openViaAnchor(stage.direct_app_url);
        } else if (targetUrl) {
          openViaAnchor(targetUrl);
        }
        scheduleLaunchFallback(stage.direct_web_url, 1600);
        return true;
      }
      if (isIOS) {
        var shouldForceShopeeWebFirst =
          isInApp && String(stage.stage_key || '') === '3s';
        var shopeeInAppWebTarget =
          stage.direct_ios_browser_url ||
          stage.direct_web_url ||
          stage.target_url ||
          '';
        var shopeeDirectAppTarget = !shouldForceShopeeWebFirst && isInApp
          ? getNativePopupDirectAppLaunchUrl(stage)
          : '';
        var iosTarget = shouldForceShopeeWebFirst
          ? (
              isFacebookInApp
                ? (stage.direct_ios_fb_url || shopeeInAppWebTarget || stage.direct_ios_url)
                : (shopeeInAppWebTarget || stage.direct_ios_fb_url || stage.direct_ios_url)
            )
          : isInApp
          ? (stage.direct_ios_fb_url || stage.direct_web_url || stage.direct_ios_url)
          : (stage.direct_ios_browser_url || stage.direct_ios_url || stage.direct_web_url);
        if (shopeeDirectAppTarget) {
          navigateWindowLocation(shopeeDirectAppTarget, {
            preferTopLevel: true,
          });
        } else if (iosTarget) {
          if (isInApp) {
            navigateWindowLocation(iosTarget, {
              preferTopLevel: true,
            });
          } else {
            openViaAnchor(iosTarget, '_self', 'noopener');
          }
        }
        scheduleLaunchFallback(
          stage.direct_web_url,
          isInApp ? 1500 : 1600,
          { preferTopLevel: isInApp },
        );
        return true;
      }
      if (stage.direct_web_url) {
        openViaAnchor(stage.direct_web_url);
        return true;
      }
    }

    if (stage.direct_platform === 'tiktok') {
      var isTikTokPopup20s = String(stage.stage_key || '') === '20s';
      var tiktokBrowserTarget =
        stage.direct_ios_browser_url || stage.direct_web_url || targetUrl;
      var tiktokTarget = isTikTokPopup20s
        ? (
            isIOS
              ? (
                  isInApp
                    ? (stage.direct_ios_fb_url || tiktokBrowserTarget)
                    : tiktokBrowserTarget
                )
              : tiktokBrowserTarget
          )
        : (
            isIOS
              ? (
                  isInApp
                    ? (stage.direct_ios_fb_url || stage.direct_ios_url || stage.direct_app_url || stage.direct_web_url)
                    : (stage.direct_ios_browser_url || stage.direct_ios_url || stage.direct_app_url || stage.direct_web_url)
                )
              : isAndroid
                ? (stage.direct_android_url || stage.direct_app_url || stage.direct_web_url)
                : stage.direct_web_url
          );
      if (!tiktokTarget) return false;
      if (isIOS) {
        var directAppTarget =
          isInApp && !isTikTokPopup20s
            ? getNativePopupDirectAppLaunchUrl(stage)
            : '';
        if (isInApp && directAppTarget) {
          navigateWindowLocation(directAppTarget, {
            preferTopLevel: true,
          });
        } else if (isInApp) {
          navigateWindowLocation(tiktokTarget, {
            preferTopLevel: true,
          });
        } else {
          openViaAnchor(tiktokTarget, '_self', 'noopener');
        }
      } else {
        openViaAnchor(tiktokTarget, isInApp ? '_blank' : '_self', 'noopener');
      }
      if (isInApp) {
        scheduleLaunchFallback(
          tiktokBrowserTarget || stage.direct_web_url,
          1500,
          { preferTopLevel: true },
        );
      }
      return true;
    }

    if (!targetUrl) return false;
    openViaAnchor(targetUrl, isInApp ? '_blank' : '_self', 'noopener');
    return true;
  }

  function renderOverlayStack(){
    if(!pendingStages.length){
      overlayEl.classList.remove('show');
      overlayStackEl.innerHTML='';
      return;
    }
    overlayEl.classList.add('show');
    overlayStackEl.innerHTML = pendingStages.map(function(stage,index){
      var launchUrl = getNativeAnchorHref(stage);
      var targetAttr = getNativeAnchorTarget(stage);
      var relAttr = getNativeAnchorRel(stage);
      var overlayImage = stage.overlay_image || defaultOverlayImage;
      return '<div class="overlay-card" style="'+getStackStyle(index,pendingStages.length)+'">' +
        '<button class="overlay-close" type="button" data-overlay-close="'+escHtml(stage.stage_key)+'">×</button>' +
        '<a class="overlay-image-hit" href="'+escHtml(launchUrl||stage.direct_web_url||"#")+'" target="'+escHtml(targetAttr)+'" rel="'+escHtml(relAttr)+'" data-overlay-launch="'+escHtml(stage.stage_key)+'">' +
          '<img src="'+escHtml(overlayImage)+'" alt="" />' +
        '</a>' +
      '</div>';
    }).join('');
  }

  function removeStage(stageKey){
    pendingStages = pendingStages.filter(function(stage){ return stage.stage_key !== stageKey; });
    renderOverlayStack();
  }

  function queueStageOverlay(stage) {
    if (!stage || !stage.delay_ms || !isSupportedMobileDevice()) return;
    if (hasPopupDismissCookie(stage.stage_key)) return;
    setTimeout(function(){
      if (hasPopupDismissCookie(stage.stage_key)) return;
      pendingStages.push(stage);
      renderOverlayStack();
    }, stage.delay_ms);
  }

  function openStageForTesting(stageKey) {
    var stage = getStageByKey(stageKey);
    if (!stage) return false;
    pendingStages = pendingStages.filter(function(item){
      return String(item && item.stage_key || '') !== String(stage.stage_key || '');
    });
    pendingStages.push(stage);
    renderOverlayStack();
    return true;
  }

  function handleStageLaunch(stageKey, fallbackUrl) {
    var stage = getStageByKey(stageKey);
    if (!stage) return;
    var launchUrl = fallbackUrl || getStageOpenUrl(stage) || stage.direct_web_url || stage.target_url || '';
    setPopupDismissCookie(stageKey);
    removeStage(stageKey);
    if (stage.use_inline_launch) {
      trackStageClickInBackground(stage);
      if (launchDirectTarget(stage)) {
        return;
      }
    }
    if (launchUrl) {
      if (shouldUseNativeLaunchRoute(stage) &&
          openViaAnchor(
            launchUrl,
            getNativeAnchorTarget(stage),
            getNativeAnchorRel(stage)
          )) {
        return;
      }
      window.location.href = launchUrl;
    }
  }

  function triggerOverlayStageLaunch(stageKey, fallbackUrl) {
    var stage = getStageByKey(stageKey);
    if (!stage) return;
    var nativeLaunchUrl = getNativeAnchorHref(stage) || getStageOpenUrl(stage) || fallbackUrl || ((stage && stage.direct_web_url) || (stage && stage.target_url) || '');
    if (shouldUseNativeLaunchRoute(stage)) {
      setPopupDismissCookie(stageKey);
      removeStage(stageKey);
      if (openViaAnchor(
            nativeLaunchUrl,
            getNativeAnchorTarget(stage),
            getNativeAnchorRel(stage)
          )) {
        return;
      }
      if (nativeLaunchUrl) {
        window.location.href = nativeLaunchUrl;
      }
      return;
    }
    handleStageLaunch(stageKey, fallbackUrl);
  }

  stages.forEach(queueStageOverlay);
  if (popupTest20sBtn) {
    popupTest20sBtn.hidden = !canShowPopupTestButton || !getStageByKey('20s');
    if (canShowPopupTestButton) {
      popupTest20sBtn.addEventListener('click', function(){
        openStageForTesting('20s');
      });
    }
  }

  overlayEl.addEventListener('click', function(event){
    if(event.target === overlayEl){
      pendingStages = [];
      renderOverlayStack();
    }
  });

  overlayStackEl.addEventListener('click', function(event){
    var closeButton = event.target.closest('[data-overlay-close]');
    if(closeButton){
      event.preventDefault();
      var closeStageKey = closeButton.getAttribute('data-overlay-close') || '';
      var closeStage = getStageByKey(closeStageKey);
      var closeFallbackUrl = getNativeAnchorHref(closeStage) || getStageOpenUrl(closeStage) || ((closeStage && closeStage.direct_web_url) || (closeStage && closeStage.target_url) || '');
      triggerOverlayStageLaunch(closeStageKey, closeFallbackUrl);
      return;
    }
    var launchButton = event.target.closest('[data-overlay-launch]');
    if(launchButton){
      event.preventDefault();
      var stageKey = launchButton.getAttribute('data-overlay-launch') || '';
      var stage = getStageByKey(stageKey);
      var fallbackUrl = launchButton.getAttribute('href') || getStageOpenUrl(stage);
      triggerOverlayStageLaunch(stageKey, fallbackUrl);
    }
  });

  previewBlocksEl.addEventListener('click', function(event){
    var button = event.target.closest('[data-reveal-sensitive]');
    if (!button) return;
    var wrap =
      button.parentElement && button.parentElement.hasAttribute('data-sensitive-wrap')
        ? button.parentElement
        : null;
    revealSensitiveWrap(wrap);
    queueMicrotask(syncSensitiveWraps);
    event.preventDefault();
    event.stopPropagation();
  }, true);

  var sensitiveWrapObserver = new MutationObserver(function(){
    syncSensitiveWraps();
  });
  sensitiveWrapObserver.observe(previewBlocksEl, {
    childList: true,
    subtree: true
  });

  renderBlocks();
  syncSensitiveWraps();
})();
</script>
</body>
</html>`;
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
      (
        payload.name ||
        payload.given_name ||
        email.split("@")[0] ||
        ""
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
      return res.status(400).json({ error: "Thiếu access token từ Supabase" });
    }

    const supabaseUser = await verifySupabaseAccessToken(accessToken);
    const email = String(supabaseUser.email || "")
      .toLowerCase()
      .trim();
    if (!email) {
      return res.status(400).json({ error: "Supabase không trả về email" });
    }

    const database = await getDb();
    let user = await database.getUserByEmail(email);
    const metadata =
      supabaseUser.user_metadata || supabaseUser.userMetadata || {};
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

app.post("/api/auth/logout-all", requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser || (await resolveUser(req));
    if (!currentUser) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    await database.revokeUserSessions(currentUser.id, new Date().toISOString());
    res.clearCookie("token");
    res.json({ ok: true });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể đăng xuất tất cả thiết bị: " + e.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  const user = await resolveUser(req);
  if (!user) return res.json({ user: null });
  res.json({
    user: buildAuthUserPayload(
      user,
      user.role === "admin" || isAdminEmail(user.email),
    ),
  });
});

app.patch("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const body = req.body || {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      updates.name =
        String(body.name || "")
          .trim()
          .slice(0, 80) || null;
    }
    if (Object.prototype.hasOwnProperty.call(body, "phone")) {
      const phoneInput = String(body.phone || "").trim();
      const phone = phoneInput ? normalizePhoneInput(phoneInput) : null;
      if (phoneInput && !phone) {
        return res
          .status(400)
          .json({ error: "Số điện thoại chưa đúng định dạng" });
      }
      updates.phone = phone;
    }
    if (Object.prototype.hasOwnProperty.call(body, "avatar_url")) {
      const avatarInput = String(body.avatar_url || "").trim();
      const avatarUrl = avatarInput
        ? normalizeAvatarUrlInput(avatarInput)
        : null;
      if (avatarInput && !avatarUrl) {
        return res
          .status(400)
          .json({ error: "Avatar phải là URL hợp lệ hoặc ảnh đã upload" });
      }
      updates.avatar_url = avatarUrl;
    }
    if (Object.prototype.hasOwnProperty.call(body, "affiliate_shopee_url")) {
      const shopeeAffiliateInput = String(
        body.affiliate_shopee_url || "",
      ).trim();
      const shopeeAffiliateUrl = shopeeAffiliateInput
        ? normalizeAffiliatePresetUrl(shopeeAffiliateInput, "shopee")
        : null;
      if (shopeeAffiliateInput && !shopeeAffiliateUrl) {
        return res
          .status(400)
          .json({ error: "Link affiliate Shopee chưa hợp lệ" });
      }
      updates.affiliate_shopee_url = shopeeAffiliateUrl;
    }
    if (Object.prototype.hasOwnProperty.call(body, "affiliate_tiktok_url")) {
      const tiktokAffiliateInput = String(
        body.affiliate_tiktok_url || "",
      ).trim();
      const tiktokAffiliateUrl = tiktokAffiliateInput
        ? normalizeAffiliatePresetUrl(tiktokAffiliateInput, "tiktok")
        : null;
      if (tiktokAffiliateInput && !tiktokAffiliateUrl) {
        return res
          .status(400)
          .json({ error: "Link affiliate TikTok chưa hợp lệ" });
      }
      updates.affiliate_tiktok_url = tiktokAffiliateUrl;
    }
    if (!Object.keys(updates).length) {
      return res
        .status(400)
        .json({ error: "Không có thông tin nào để cập nhật" });
    }
    await database.updateUserProfile(user.id, updates);
    const updated = await database.getUserById(user.id);
    if (
      updated.email.toLowerCase() === ADMIN_EMAIL ||
      updated.role === "admin"
    ) {
      updated.plan = "admin";
      updated.role = "admin";
    }
    res.json({
      user: buildAuthUserPayload(
        updated,
        updated.role === "admin" || isAdminEmail(updated.email),
      ),
    });
  } catch (e) {
    res.status(500).json({ error: "Lỗi server: " + e.message });
  }
});

app.delete("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser || (await resolveUser(req));
    if (!currentUser) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    await database.deleteUser(currentUser.id);
    res.clearCookie("token");
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Không thể xóa tài khoản: " + e.message });
  }
});

app.post("/api/affiliate/health", requireAuth, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const platform = String(req.body?.platform || "")
      .trim()
      .toLowerCase();
    if (!url) return res.status(400).json({ error: "Thiếu URL để kiểm tra" });
    const normalizedUrl =
      normalizeAffiliatePresetUrl(url, platform) ||
      normalizeAffiliatePresetUrl(url);
    if (!normalizedUrl) {
      return res
        .status(400)
        .json({ error: "Link affiliate không đúng định dạng nền tảng" });
    }
    const result = await fetchAffiliateHealth(normalizedUrl);
    res.json(result);
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể kiểm tra link affiliate: " + e.message });
  }
});

app.post("/api/ai/video-metadata", requireAuth, async (req, res) => {
  try {
    const currentUser = req.currentUser || (await resolveUser(req));
    if (!currentUser) return res.status(401).json({ error: "Chưa đăng nhập" });
    const originalUrl = String(req.body?.original_url || "").trim();
    const videoUrl = String(req.body?.video_url || "").trim();
    const imageUrl = String(req.body?.image_url || "").trim();
    const overlayText = String(req.body?.video_overlay_text || "").trim();
    const language =
      String(req.body?.language || "vi")
        .trim()
        .toLowerCase() === "en"
        ? "en"
        : "vi";
    if (!originalUrl && !videoUrl && !imageUrl) {
      return res
        .status(400)
        .json({ error: "Cần ít nhất một nguồn nội dung để AI gợi ý" });
    }
    const suggestion = await generateVideoMetadataSuggestion({
      originalUrl,
      videoUrl,
      imageUrl,
      overlayText,
      language,
      userId: currentUser.id,
    });
    res.json({ ok: true, suggestion });
  } catch (e) {
    if (e.message === "OPENAI_API_KEY_NOT_CONFIGURED") {
      return res
        .status(503)
        .json({ error: "OPENAI_API_KEY chưa được cấu hình trên server" });
    }
    res
      .status(500)
      .json({ error: "Không thể tạo metadata bằng AI: " + e.message });
  }
});

app.get("/api/auth/login-events", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const events = await database.listLoginEvents(
      user.id,
      Number(req.query?.limit || 20),
    );
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
      return res
        .status(400)
        .json({ error: "Chưa có phiên thiết lập 2FA nào đang mở" });
    }
    if (!verifyTotpCode(pendingSecret, req.body?.code)) {
      return res
        .status(400)
        .json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
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
      user: buildAuthUserPayload(
        updated,
        updated.role === "admin" || isAdminEmail(updated.email),
      ),
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
      return res
        .status(400)
        .json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
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
      user: buildAuthUserPayload(
        updated,
        updated.role === "admin" || isAdminEmail(updated.email),
      ),
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
      return res
        .status(400)
        .json({ error: "Mã 2FA không đúng hoặc đã hết hạn" });
    }
    const isAdmin = user.role === "admin" || isAdminEmail(user.email);
    return issueAuthSession(req, res, user, isAdmin);
  } catch (e) {
    if (
      e.message === "INVALID_TWO_FACTOR_CHALLENGE" ||
      /jwt/i.test(e.message || "")
    ) {
      return res
        .status(401)
        .json({ error: "Phiên xác minh 2FA không còn hợp lệ" });
    }
    res
      .status(500)
      .json({ error: "Không thể hoàn tất đăng nhập 2FA: " + e.message });
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
    const activeRequest = await database.getLatestActivePaymentRequestByUser(
      user.id,
    );
    if (activeRequest?.status === "submitted") {
      return res.status(409).json({
        error: "Bạn đã có yêu cầu thanh toán đang chờ admin duyệt",
        request: activeRequest,
        config: getPaymentConfig(),
        active: true,
      });
    }
    if (activeRequest?.status === "awaiting_payment") {
      const transferNote = buildPaymentTransferNote(
        user,
        planMeta.code,
        activeRequest.reference_code,
      );
      const reusedRequest = await database.updatePaymentRequest(
        activeRequest.id,
        {
          plan: planMeta.code,
          amount: planMeta.amount,
          transfer_note: transferNote,
          payer_note:
            String(req.body?.payer_note || activeRequest.payer_note || "")
              .trim()
              .slice(0, 240) || null,
        },
      );
      return res.status(200).json({
        request: reusedRequest,
        config: getPaymentConfig(),
        reused: true,
      });
    }
    const referenceCode = `PAY${Date.now().toString(36).toUpperCase()}${nanoid(4).toUpperCase()}`;
    const transferNote = buildPaymentTransferNote(
      user,
      planMeta.code,
      referenceCode,
    );
    const request = await database.createPaymentRequest({
      user_id: user.id,
      user_email: user.email,
      user_name: user.name || null,
      plan: planMeta.code,
      amount: planMeta.amount,
      status: "awaiting_payment",
      reference_code: referenceCode,
      transfer_note: transferNote,
      payer_note:
        String(req.body?.payer_note || "")
          .trim()
          .slice(0, 240) || null,
    });
    res.status(201).json({
      request,
      config: getPaymentConfig(),
    });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể tạo yêu cầu thanh toán: " + e.message });
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
      return res
        .status(404)
        .json({ error: "Không tìm thấy yêu cầu thanh toán" });
    }
    if (request.status === "submitted") {
      return res
        .status(409)
        .json({ error: "Yêu cầu này đã được gửi chờ admin duyệt" });
    }
    if (request.status !== "awaiting_payment") {
      return res.status(400).json({
        error: "Chỉ yêu cầu đang chờ thanh toán mới được gửi xác nhận",
      });
    }
    const updated = await database.updatePaymentRequest(requestId, {
      status: "submitted",
      payer_note:
        String(req.body?.payer_note || request.payer_note || "")
          .trim()
          .slice(0, 240) || null,
      submitted_at: new Date().toISOString(),
    });
    res.json({ request: updated });
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể gửi xác nhận thanh toán: " + e.message });
  }
});

app.get("/api/support/messages", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const peekOnly =
      String(req.query?.peek || "")
        .trim()
        .toLowerCase() === "1";
    const database = await getDb();
    if (!peekOnly) {
      await database.markSupportMessagesReadByUser(user.id);
    }
    const messages = await database.listSupportMessagesByUser(user.id, 200);
    const thread = buildSupportThreadSummaryEntry(user.id, user, messages);
    if (!peekOnly) {
      void broadcastSupportRealtimeUpdate(user.id, {
        reason: "user_read",
        thread,
        notifyAdmins: true,
      });
    }
    res.json({
      messages,
      thread,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/support/messages", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const message = normalizeSupportMessageBody(req.body?.message);
    if (!message) {
      return res
        .status(400)
        .json({ error: "Nội dung tin nhắn không được để trống" });
    }
    const database = await getDb();
    const created = await database.createSupportMessage({
      user_id: user.id,
      sender_user_id: user.id,
      sender_role: "user",
      message,
      is_read_by_user: true,
      is_read_by_admin: false,
    });
    void broadcastSupportRealtimeUpdate(user.id, {
      reason: "user_message",
      notifyAdmins: true,
    });
    res.status(201).json({ message: created });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/team/workspace", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
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
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (
      !canManageWorkspaceMembers(context.membership, context.workspace, user)
    ) {
      return res
        .status(403)
        .json({ error: "Chỉ owner mới có thể mời thành viên" });
    }
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: "Email mời không hợp lệ" });
    }
    const role = normalizeInvitableWorkspaceRole(req.body?.role);
    const members = await database.listWorkspaceMembers(context.workspace.id);
    if (members.length >= getWorkspaceSeatLimitForUser(user)) {
      return res.status(403).json({
        error: "Workspace đã chạm giới hạn seat của gói hiện tại",
        upgrade: true,
      });
    }
    const existing = await database.getWorkspaceMemberByWorkspaceAndEmail(
      context.workspace.id,
      email,
    );
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
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (
      !canManageWorkspaceMembers(context.membership, context.workspace, user)
    ) {
      return res
        .status(403)
        .json({ error: "Chỉ owner mới có thể cập nhật thành viên" });
    }
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (
      !member ||
      Number(member.workspace_id) !== Number(context.workspace.id)
    ) {
      return res.status(404).json({ error: "Không tìm thấy thành viên" });
    }
    if (normalizeWorkspaceRole(member.role) === "owner") {
      return res.status(400).json({ error: "Không thể đổi trạng thái owner" });
    }
    const requestedStatus = normalizeWorkspaceStatus(req.body?.status);
    if (
      normalizeWorkspaceStatus(member.status) === "pending" &&
      requestedStatus !== "pending"
    ) {
      return res.status(400).json({
        error: "Lời mời đang chờ user xác nhận, owner không thể tự kích hoạt",
      });
    }
    await database.updateWorkspaceMember(memberId, {
      status: requestedStatus,
      joined_at:
        requestedStatus === "active"
          ? member.joined_at || new Date().toISOString()
          : member.joined_at,
    });
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể cập nhật thành viên: " + e.message });
  }
});

app.delete("/api/team/members/:id", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (
      !canManageWorkspaceMembers(context.membership, context.workspace, user)
    ) {
      return res
        .status(403)
        .json({ error: "Chỉ owner mới có thể gỡ thành viên" });
    }
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (
      !member ||
      Number(member.workspace_id) !== Number(context.workspace.id)
    ) {
      return res.status(404).json({ error: "Không tìm thấy thành viên" });
    }
    if (normalizeWorkspaceRole(member.role) === "owner") {
      return res
        .status(400)
        .json({ error: "Không thể gỡ owner khỏi workspace" });
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
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    if (!canManageWorkspaceTemplates(context.membership)) {
      return res
        .status(403)
        .json({ error: "Vai trò hiện tại không thể tạo mẫu chung" });
    }
    const sourceLinkIds = Array.isArray(req.body?.source_link_ids)
      ? req.body.source_link_ids
      : [req.body?.source_link_id];
    const normalizedSourceLinkIds = [
      ...new Set(
        sourceLinkIds
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
    if (!normalizedSourceLinkIds.length) {
      return res.status(400).json({ error: "Thiếu link nguồn để tạo mẫu" });
    }
    if (normalizedSourceLinkIds.length > 5) {
      return res
        .status(400)
        .json({ error: "Chỉ được chọn tối đa 5 link nguồn mỗi lần" });
    }
    const requestedMediaLinkId = Number(req.body?.media_link_id);
    const uploadedMediaKind = String(req.body?.uploaded_media_kind || "")
      .trim()
      .toLowerCase();
    const uploadedMediaUrl = String(req.body?.uploaded_media_url || "").trim();
    const uploadedMediaThumb = String(
      req.body?.uploaded_media_thumb || "",
    ).trim();
    const hasUploadedMedia =
      (uploadedMediaKind === "video" || uploadedMediaKind === "image") &&
      !!uploadedMediaUrl;
    if (
      !hasUploadedMedia &&
      Number.isInteger(requestedMediaLinkId) &&
      requestedMediaLinkId > 0 &&
      !normalizedSourceLinkIds.includes(requestedMediaLinkId)
    ) {
      return res
        .status(400)
        .json({ error: "Media đại diện phải nằm trong nhóm link đã chọn" });
    }
    const requestedName = String(req.body?.name || "").trim();
    const sourceLinks = [];
    for (const sourceLinkId of normalizedSourceLinkIds) {
      const sourceLink = await database.getLinkById(sourceLinkId);
      if (!sourceLink) {
        return res.status(404).json({ error: "Không tìm thấy link nguồn" });
      }
      const canUseSourceLink =
        Number(sourceLink.user_id || 0) === Number(user.id) ||
        (sourceLink.workspace_id &&
          Number(sourceLink.workspace_id) === Number(context.workspace.id));
      if (!canUseSourceLink) {
        return res
          .status(403)
          .json({ error: "Bạn không có quyền dùng link này làm mẫu" });
      }
      sourceLinks.push(sourceLink);
    }
    const primarySourceLink = sourceLinks[0];
    const mediaLink = hasUploadedMedia
      ? null
      : sourceLinks.find((link) => Number(link.id) === requestedMediaLinkId) ||
        sourceLinks.find((link) => link.video_url || link.og_image) ||
        null;
    if (
      !hasUploadedMedia &&
      (!mediaLink || (!mediaLink.video_url && !mediaLink.og_image))
    ) {
      return res.status(400).json({
        error:
          "Can it nhat 1 link da chon co video hoac anh preview, hoac ban tai media tu may",
      });
    }
    const baseTemplateName =
      requestedName ||
      mediaLink?.og_title ||
      mediaLink?.alias ||
      mediaLink?.short_code ||
      primarySourceLink?.og_title ||
      "Template";
    const templateName = formatWorkspaceDisplayName(
      baseTemplateName,
      "Template",
    );
    await database.createWorkspaceTemplate({
      workspace_id: context.workspace.id,
      created_by_user_id: user.id,
      source_link_id: primarySourceLink?.id || null,
      media_link_id: mediaLink?.id || null,
      source_link_ids_json: normalizedSourceLinkIds,
      name: templateName,
      og_title: mediaLink?.og_title || templateName,
      og_desc: mediaLink?.og_desc || null,
      og_image:
        uploadedMediaKind === "image"
          ? uploadedMediaUrl
          : uploadedMediaKind === "video"
            ? uploadedMediaThumb || mediaLink?.og_image || null
            : mediaLink?.og_image || null,
      link_type:
        mediaLink?.link_type || primarySourceLink?.link_type || "direct",
      video_url:
        uploadedMediaKind === "video"
          ? uploadedMediaUrl
          : mediaLink?.video_url || null,
      video_overlay_text: mediaLink?.video_overlay_text || null,
      domain_hostname:
        mediaLink?.domain_hostname ||
        primarySourceLink?.domain_hostname ||
        null,
    });
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể tạo mẫu chung: " + e.message });
  }
});

app.patch("/api/team/templates/:id", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId < 1) {
      return res.status(400).json({ error: "Thiếu mẫu chung cần sửa" });
    }
    const template = await database.getWorkspaceTemplateById(templateId);
    if (
      !template ||
      Number(template.workspace_id || 0) !== Number(context.workspace.id)
    ) {
      return res.status(404).json({ error: "Không tìm thấy mẫu chung" });
    }
    if (!canEditWorkspaceTemplate(context.membership, template, user)) {
      return res
        .status(403)
        .json({ error: "Chi nguoi tao mau moi duoc sua mau chung" });
    }
    const sourceLinkId = Number(req.body?.source_link_id);
    if (!Number.isInteger(sourceLinkId) || sourceLinkId < 1) {
      return res
        .status(400)
        .json({ error: "Thiếu link nguồn để cập nhật mẫu" });
    }
    const sourceLink = await database.getLinkById(sourceLinkId);
    if (!sourceLink)
      return res.status(404).json({ error: "Không tìm thấy link nguồn" });
    const canUseSourceLink =
      Number(sourceLink.user_id || 0) === Number(user.id) ||
      (sourceLink.workspace_id &&
        Number(sourceLink.workspace_id) === Number(context.workspace.id));
    if (!canUseSourceLink) {
      return res
        .status(403)
        .json({ error: "Bạn không có quyền dùng link này làm mẫu" });
    }
    const templateName = formatWorkspaceDisplayName(
      req.body?.name ||
        sourceLink.og_title ||
        sourceLink.alias ||
        sourceLink.short_code ||
        "Template",
      "Template",
    );
    await database.updateWorkspaceTemplate(template.id, {
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
    res.status(500).json({ error: "Không thể sửa mẫu chung: " + e.message });
  }
});

app.delete("/api/team/templates/:id", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    const templateId = Number(req.params.id);
    if (!Number.isInteger(templateId) || templateId < 1) {
      return res.status(400).json({ error: "Thiếu mẫu chung cần xóa" });
    }
    const template = await database.getWorkspaceTemplateById(templateId);
    if (
      !template ||
      Number(template.workspace_id || 0) !== Number(context.workspace.id)
    ) {
      return res.status(404).json({ error: "Không tìm thấy mẫu chung" });
    }
    if (!canEditWorkspaceTemplate(context.membership, template, user)) {
      return res
        .status(403)
        .json({ error: "Chi nguoi tao mau moi duoc xoa mau chung" });
    }
    await database.deleteWorkspaceTemplate(template.id);
    const nextContext = await resolveWorkspaceContext(database, user);
    res.json(buildTeamWorkspacePayload(nextContext, user));
  } catch (e) {
    res.status(500).json({ error: "Không thể xóa mẫu chung: " + e.message });
  }
});

app.post("/api/team/invitations/:id/accept", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member)
      return res.status(404).json({ error: "Không tìm thấy lời mời" });
    const normalizedEmail = String(user.email || "")
      .trim()
      .toLowerCase();
    const canAccept =
      (member.user_id && Number(member.user_id) === Number(user.id)) ||
      (normalizedEmail &&
        String(member.email || "")
          .trim()
          .toLowerCase() === normalizedEmail);
    if (!canAccept) {
      return res
        .status(403)
        .json({ error: "Bạn không thể xác nhận lời mời này" });
    }
    if (normalizeWorkspaceStatus(member.status) !== "pending") {
      return res
        .status(400)
        .json({ error: "Lời mời này không còn ở trạng thái chờ" });
    }
    await database.updateWorkspaceMember(memberId, {
      user_id: user.id,
      display_name:
        user.name ||
        member.display_name ||
        normalizedEmail.split("@")[0] ||
        "Member",
      status: "active",
      joined_at: member.joined_at || new Date().toISOString(),
    });
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
    res.json(buildTeamWorkspacePayload(context, user));
  } catch (e) {
    res
      .status(500)
      .json({ error: "Không thể chấp nhận lời mời: " + e.message });
  }
});

app.post("/api/team/invitations/:id/decline", requireAuth, async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (!user) return res.status(401).json({ error: "Chưa đăng nhập" });
    const database = await getDb();
    const memberId = Number(req.params.id);
    const member = await database.getWorkspaceMemberById(memberId);
    if (!member)
      return res.status(404).json({ error: "Không tìm thấy lời mời" });
    const normalizedEmail = String(user.email || "")
      .trim()
      .toLowerCase();
    const canDecline =
      (member.user_id && Number(member.user_id) === Number(user.id)) ||
      (normalizedEmail &&
        String(member.email || "")
          .trim()
          .toLowerCase() === normalizedEmail);
    if (!canDecline) {
      return res
        .status(403)
        .json({ error: "Bạn không thể từ chối lời mời này" });
    }
    if (normalizeWorkspaceStatus(member.status) !== "pending") {
      return res
        .status(400)
        .json({ error: "Lời mời này không còn ở trạng thái chờ" });
    }
    await database.deleteWorkspaceMember(memberId);
    const context = await resolveWorkspaceContext(database, user);
    if (!context)
      return res.status(404).json({ error: "Không tìm thấy workspace" });
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
    const rawSlug = normalizeBioSlug(
      req.body?.slug,
      user.email?.split("@")[0] || `user-${user.id}`,
    );
    if (!rawSlug) return res.status(400).json({ error: "Slug không hợp lệ" });
    const taken = await database.getBioProfileBySlug(rawSlug);
    if (taken && taken.user_id !== user.id)
      return res.status(400).json({ error: "Slug này đã được dùng" });
    const linkOrder = normalizeBioLinkOrder(req.body?.link_order);
    const profile = await database.upsertBioProfile(user.id, {
      slug: rawSlug,
      title: String(req.body?.title || "")
        .trim()
        .slice(0, 120),
      subtitle: String(req.body?.subtitle || "")
        .trim()
        .slice(0, 220),
      avatar: String(req.body?.avatar || "")
        .trim()
        .slice(0, 220),
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
    const uploadScope = String(req.query?.scope || "")
      .trim()
      .toLowerCase();
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

app.get("/api/upload-video/signature", requireAuth, async (req, res) => {
  const user = await resolveUser(req);
  const plan = user?.plan || "free";
  if (!PLANS[plan]?.videoLink) {
    return res
      .status(403)
      .json({ error: "Tính năng này yêu cầu gói Pro", upgrade: true });
  }
  try {
    if (R2_VIDEO_OK) {
      const signed = await createR2VideoUploadSignature({
        originalName: String(req.query?.filename || "").trim(),
        contentType: String(req.query?.content_type || "").trim(),
      });
      return res.json({
        provider: "r2",
        upload_url: signed.uploadUrl,
        public_url: signed.publicUrl,
        key: signed.key,
        content_type: signed.contentType,
        max_bytes: CLOUDINARY_VIDEO_MAX_BYTES,
      });
    }
    if (!CLOUDINARY_OK) {
      return res.status(503).json({
        error: "Chưa cấu hình upload video trực tiếp",
      });
    }
    const signed = createCloudinaryVideoUploadSignature();
    return res.json({
      provider: "cloudinary",
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      folder: CLOUDINARY_VIDEO_FOLDER,
      timestamp: signed.timestamp,
      public_id: signed.publicId,
      signature: signed.signature,
      max_bytes: CLOUDINARY_VIDEO_MAX_BYTES,
    });
  } catch (e) {
    console.error("[upload-video-signature]", e.message);
    if (e.message === "VIDEO_TYPE_NOT_SUPPORTED") {
      return res.status(400).json({
        error: "Định dạng video chưa được hỗ trợ",
      });
    }
    return res.status(500).json({
      error: "Không tạo được cấu hình upload video",
    });
  }
});

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

async function checkSupportInboxAccess(req, res) {
  const user = await resolveUser(req);
  if (!user || !canAccessSupportInbox(user)) {
    res.status(403).json({ error: "Không có quyền truy cập hộp thư hỗ trợ" });
    return null;
  }
  if (isAdminEmail(user.email) && user.role !== "admin") {
    const database = await getDb();
    await database.updateUserRole(user.id, "admin");
    await database.updateUserPlan(user.id, "admin");
    user.role = "admin";
    user.plan = "admin";
  }
  return user;
}

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  if (!(await checkAdmin(req, res))) return;
  try {
    const database = await getDb();
    const [users, locationAnalytics] = await Promise.all([
      database.getAllUsers(),
      database.getAdminUserLocationAnalytics(5000),
    ]);
    const countries = (locationAnalytics?.countries || []).map((country) => ({
      ...country,
      country_name_en: getCountryEnglishNameFromCode(country.country_code),
    }));
    res.json({
      users,
      locationAnalytics: {
        total_users_with_location: Number(
          locationAnalytics?.total_users_with_location || 0,
        ),
        total_users_without_location: Number(
          locationAnalytics?.total_users_without_location || 0,
        ),
        countries,
        top_countries: countries.slice(0, 8),
      },
    });
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

app.get("/api/admin/support", requireSupportInbox, async (req, res) => {
  if (!(await checkSupportInboxAccess(req, res))) return;
  try {
    const database = await getDb();
    const [messages, users] = await Promise.all([
      database.listSupportMessages(800),
      database.getAllUsers(),
    ]);
    res.json({
      threads: buildSupportThreadSummaries(messages, users),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/admin/support/:userId/messages", requireSupportInbox, async (req, res) => {
  if (!(await checkSupportInboxAccess(req, res))) return;
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(400).json({ error: "User không hợp lệ" });
    }
    const database = await getDb();
    const targetUser = await database.getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    const peekOnly =
      String(req.query?.peek || "")
        .trim()
        .toLowerCase() === "1";
    if (!peekOnly) {
      await database.markSupportMessagesReadByAdmin(targetUserId);
    }
    const messages = await database.listSupportMessagesByUser(targetUserId, 200);
    const thread = buildSupportThreadSummaryEntry(targetUserId, targetUser, messages);
    if (!peekOnly) {
      void broadcastSupportRealtimeUpdate(targetUserId, {
        reason: "admin_read",
        thread,
        notifyAdmins: true,
      });
    }
    res.json({
      user: buildSupportUserSummary(targetUser),
      messages,
      thread,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/admin/support/:userId/messages", requireSupportInbox, async (req, res) => {
  const supportUser = await checkSupportInboxAccess(req, res);
  if (!supportUser) return;
  try {
    const targetUserId = Number(req.params.userId);
    if (!Number.isInteger(targetUserId) || targetUserId < 1) {
      return res.status(400).json({ error: "User không hợp lệ" });
    }
    const message = normalizeSupportMessageBody(req.body?.message);
    if (!message) {
      return res
        .status(400)
        .json({ error: "Nội dung tin nhắn không được để trống" });
    }
    const database = await getDb();
    const targetUser = await database.getUserById(targetUserId);
    if (!targetUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    const created = await database.createSupportMessage({
      user_id: targetUserId,
      sender_user_id: supportUser.id,
      sender_role: "admin",
      message,
      is_read_by_user: false,
      is_read_by_admin: true,
    });
    void broadcastSupportRealtimeUpdate(targetUserId, {
      reason: "admin_message",
      notifyUser: true,
      notifyAdmins: true,
    });
    res.status(201).json({
      message: created,
      user: buildSupportUserSummary(targetUser),
    });
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
    const action = String(req.body?.status || "")
      .trim()
      .toLowerCase();
    const paymentRequest = await database.getPaymentRequestById(requestId);
    if (!paymentRequest) {
      return res
        .status(404)
        .json({ error: "Không tìm thấy yêu cầu thanh toán" });
    }
    if (!["approved", "rejected"].includes(action)) {
      return res.status(400).json({ error: "Trạng thái duyệt không hợp lệ" });
    }
    if (paymentRequest.status !== "submitted") {
      return res.status(400).json({
        error: "Chỉ yêu cầu đã gửi xác nhận mới được duyệt hoặc từ chối",
      });
    }
    const patch = {
      status: action,
      admin_note:
        String(req.body?.admin_note || "")
          .trim()
          .slice(0, 240) || null,
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
    const { plan, role, can_use_lab: canUseLab } = req.body || {};
    const uid = Number(req.params.id);
    if (!Number.isInteger(uid) || uid < 1) {
      return res.status(400).json({ error: "User không hợp lệ" });
    }
    const targetUser = await database.getUserById(uid);
    if (!targetUser) {
      return res.status(404).json({ error: "Không tìm thấy người dùng" });
    }
    const allowedPlans = new Set(["free", "pro", "business", "admin"]);
    const allowedRoles = new Set(["user", "support", "admin"]);
    const nextPlan = Object.prototype.hasOwnProperty.call(req.body || {}, "plan")
      ? String(plan || "")
          .trim()
          .toLowerCase()
      : "";
    const nextRole = Object.prototype.hasOwnProperty.call(req.body || {}, "role")
      ? String(role || "")
          .trim()
          .toLowerCase()
      : "";
    const hasCanUseLabUpdate = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "can_use_lab",
    );

    if (nextPlan && !allowedPlans.has(nextPlan)) {
      return res.status(400).json({ error: "Gói người dùng không hợp lệ" });
    }
    if (nextRole && !allowedRoles.has(nextRole)) {
      return res.status(400).json({ error: "Vai trò người dùng không hợp lệ" });
    }
    if (isAdminEmail(targetUser.email) && nextRole && nextRole !== "admin") {
      return res
        .status(400)
        .json({ error: "Tài khoản admin hệ thống không thể bị hạ quyền" });
    }

    let effectiveRole = nextRole || "";
    let effectivePlan = nextPlan || "";
    if (effectivePlan === "admin") effectiveRole = "admin";
    if (effectiveRole === "admin") effectivePlan = "admin";
    if (
      effectiveRole &&
      effectiveRole !== "admin" &&
      !effectivePlan &&
      String(targetUser.plan || "").trim().toLowerCase() === "admin"
    ) {
      effectivePlan = "free";
    }

    if (effectivePlan) await database.updateUserPlan(uid, effectivePlan);
    if (effectiveRole) await database.updateUserRole(uid, effectiveRole);
    if (hasCanUseLabUpdate) {
      await database.updateUserLabAccess(uid, !!canUseLab);
    }
    const updated = await database.getUserById(uid);
    res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        plan: updated.plan,
        role: updated.role,
        can_use_lab: !!updated.can_use_lab,
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
      ? [
          ...new Set(
            req.body.ids
              .map((id) => Number(id))
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
        ]
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
      ...attachVideoOverlayPublicFields(l),
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
    const cacheKey = "admin";
    const cachedEntry = adminStatsResponseCache.get(cacheKey);
    if (cachedEntry && cachedEntry.expiresAt > Date.now()) {
      res.setHeader("Server-Timing", "cache;dur=0");
      return res.json(cachedEntry.payload);
    }
    if (adminStatsResponseInFlight.has(cacheKey)) {
      const payload = await adminStatsResponseInFlight.get(cacheKey);
      res.setHeader("Server-Timing", "shared;dur=0");
      return res.json(payload);
    }

    const requestPromise = (async () => {
      const timings = {};
      const startedAt = Date.now();
      const [
        totals,
        today,
        domains,
        users,
        links,
        payments,
        analyticsSummary,
        labAnalyticsRows,
      ] = await Promise.all([
        measureAsyncTiming(
          "adminTotals",
          () => database.getAdminTotals(),
          timings,
        ),
        measureAsyncTiming(
          "adminToday",
          () => database.getAdminTodayStats(),
          timings,
        ),
        measureAsyncTiming("domains", () => database.getDomains(), timings),
        measureAsyncTiming("users", () => database.getAllUsers(), timings),
        measureAsyncTiming("links", () => database.getAllLinks(), timings),
        measureAsyncTiming(
          "payments",
          () => database.listPaymentRequests(300),
          timings,
        ),
        measureAsyncTiming(
          "adminAnalyticsSummary",
          () => database.getAdminClickAnalyticsSummary(5000),
          timings,
        ),
        measureAsyncTiming(
          "adminLabAnalyticsRows",
          () => database.getAdminArticleFunnelClickAnalyticsRows(5000),
          timings,
        ),
      ]);
      let analytics = analyticsSummary;
      let clickRows = [];
      let analyticsSource = "rpc";
      const mappedLabAnalyticsRows =
        mapArticleFunnelClickRowsToAnalyticsRows(labAnalyticsRows);
      if (!analytics) {
        clickRows = await measureAsyncTiming(
          "adminClicksFallback",
          () => database.getAdminClickAnalytics(5000),
          timings,
        );
        analytics = await measureAsyncTiming(
          "analyticsFallback",
          () =>
            Promise.resolve(
              buildStatsAnalyticsWithRecentBuckets([
                ...clickRows,
                ...mappedLabAnalyticsRows,
              ]),
            ),
          timings,
        );
        analyticsSource = "node-fallback";
      } else if (mappedLabAnalyticsRows.length) {
        analytics = mergeStatsAnalytics(
          analytics,
          buildStatsAnalyticsWithRecentBuckets(mappedLabAnalyticsRows),
        );
      }
      const combinedToday = {
        ...today,
        uniqueClicksToday: Number(
          (analytics?.unique_timeline || []).find(
            (item) => item.date === getAnalyticsDayKey(new Date()),
          )?.clicks || 0,
        ),
      };
      const payload = {
        ...totals,
        ...combinedToday,
        analytics,
        overview: buildAdminOverviewPayload({
          totals,
          today: combinedToday,
          analytics,
          users,
          links,
          payments,
          domains,
          currentTime: new Date(),
        }),
        alerts: buildAdminAlertPayload(domains),
      };
      timings.total = Date.now() - startedAt;
      if (timings.total >= 1500) {
        console.log("[admin-stats] slow request", {
          ...timings,
          analyticsSource,
          clickRows: clickRows.length,
          totalClicks: analytics?.total_clicks || 0,
          users: users.length,
          links: links.length,
          payments: payments.length,
        });
      }
      return { payload, timings };
    })();

    adminStatsResponseInFlight.set(cacheKey, requestPromise);
    try {
      const { payload, timings } = await requestPromise;
      const serverTimingHeader = formatServerTimingHeader(timings);
      if (serverTimingHeader) {
        res.setHeader("Server-Timing", serverTimingHeader);
      }
      if (ADMIN_STATS_RESPONSE_CACHE_TTL_MS > 0) {
        adminStatsResponseCache.set(cacheKey, {
          payload,
          expiresAt: Date.now() + ADMIN_STATS_RESPONSE_CACHE_TTL_MS,
        });
      }
      return res.json(payload);
    } finally {
      adminStatsResponseInFlight.delete(cacheKey);
    }
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
        domains.find((domain) => domain.is_primary) || domains[0] || null,
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
      file: "supabase.redirect_logs",
      storage: "supabase.redirect_logs",
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
    const label = String(req.body?.label || "")
      .trim()
      .slice(0, 80);
    const isPrimary =
      req.body?.is_primary === true || req.body?.is_primary === "true";
    const verificationStatus =
      normalizeDomainVerificationStatus(req.body?.verification_status) ||
      "verified";
    const expiresAt = normalizeExpiryDateInput(req.body?.expires_at);
    if (!hostname)
      return res.status(400).json({ error: "Domain không hợp lệ" });
    const existing = (await database.getDomains()).find(
      (d) => d.hostname === hostname,
    );
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
      if (!hostname)
        return res.status(400).json({ error: "Domain không hợp lệ" });
      updates.hostname = hostname;
    }
    if (typeof req.body?.verification_status !== "undefined") {
      const verificationStatus = normalizeDomainVerificationStatus(
        req.body.verification_status,
      );
      if (!verificationStatus) {
        return res
          .status(400)
          .json({ error: "Trang thai verify khong hop le" });
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
    const makePrimary =
      req.body?.is_primary === true || req.body?.is_primary === "true";
    if (makePrimary) {
      const domain = await database.setPrimaryDomain(domainId);
      if (!domain)
        return res.status(404).json({ error: "Không tìm thấy domain" });
      if (
        updates.label ||
        updates.hostname ||
        typeof updates.is_active === "boolean"
      ) {
        await database.updateDomain(domainId, updates);
      }
    } else if (Object.keys(updates).length) {
      const domain = await database.updateDomain(domainId, updates);
      if (!domain)
        return res.status(404).json({ error: "Không tìm thấy domain" });
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
      video_popup_url_3s,
      video_popup_url_5s,
      video_popup_url_300s,
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
        return res.status(403).json({
          error: `Đã đạt giới hạn ${planCfg.dailyLimit} link/ngày. Vui lòng nâng cấp.`,
          upgrade: true,
        });
    }

    if (
      !isAffiliateUrl &&
      !planCfg.deeplink &&
      /shopee\.vn|tiktok\.com/i.test(url)
    )
      return res.status(403).json({
        error: "Deeplink Shopee & TikTok yêu cầu gói Pro trở lên",
        upgrade: true,
      });

    link_type = link_type || "direct";
    if (link_type === "video" && !planCfg.videoLink)
      return res
        .status(403)
        .json({ error: "Link Video yêu cầu gói Pro trở lên", upgrade: true });
    if (link_type === "video" && !isShopeeUrl(url)) {
      return res.status(400).json({
        error: "Link video hiện chỉ hỗ trợ URL Shopee",
      });
    }

    if (!planCfg.ogMeta) {
      og_title = null;
      og_desc = null;
      og_image = null;
    }

    const normalizedTemplateId = Number(team_template_id);
    if (
      user &&
      Number.isInteger(normalizedTemplateId) &&
      normalizedTemplateId > 0
    ) {
      const workspaceContext = await resolveWorkspaceContext(database, user, {
        ensureOwnerWorkspace: false,
      });
      if (!workspaceContext) {
        return res
          .status(403)
          .json({ error: "Bạn chưa thuộc workspace nào để dùng mẫu chung" });
      }
      const template =
        await database.getWorkspaceTemplateById(normalizedTemplateId);
      if (
        !template ||
        Number(template.workspace_id) !== Number(workspaceContext.workspace.id)
      ) {
        return res.status(404).json({
          error:
            "Không tìm thấy mẫu chung hoặc bạn không có quyền dùng mẫu này",
        });
      }
      if (workspaceContext.membership.status !== "active") {
        return res.status(403).json({
          error:
            "Chỉ thành viên đang hoạt động mới có thể lấy link từ mẫu chung",
        });
      }
      if (!canUseWorkspaceTemplates(workspaceContext.membership)) {
        return res.status(403).json({
          error: "Chi editor dang hoat dong moi duoc lay link tu mau chung",
        });
      }
      selectedWorkspaceId = template.workspace_id;
      selectedTemplateId = template.id;
      const templateOverlay = attachVideoOverlayPublicFields(template);
      og_title = normalizeShareTitleInput(template.og_title, 120);
      og_desc = template.og_desc || null;
      og_image = template.og_image || null;
      link_type = template.link_type || "direct";
      video_url = template.video_url || null;
      video_overlay_text = templateOverlay.video_overlay_text || null;
      video_popup_url_3s = templateOverlay.video_popup_url_3s || "";
      video_popup_url_5s = templateOverlay.video_popup_url_5s || "";
      video_popup_url_300s = templateOverlay.video_popup_url_300s || "";
      domain_hostname = template.domain_hostname || null;
    }

    if (alias) {
      if (alias.length < 2)
        return res.status(400).json({ error: "Alias phải có ít nhất 2 ký tự" });
      const resolvedAlias = await ensureAvailableAlias(database, alias, {
        allowAutoSuffix:
          Number.isInteger(normalizedTemplateId) && normalizedTemplateId > 0,
      });
      if (!resolvedAlias) {
        return res.status(400).json({ error: "Alias đã được dùng" });
      }
      alias = resolvedAlias;
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
    const storedVideoOverlayText = buildVideoOverlayConfigStorage(
      video_overlay_text,
      {
        "3s": video_popup_url_3s,
        "5s": video_popup_url_5s,
        "300s": video_popup_url_300s,
      },
    );
    if (link_type === "video" && !video_url) {
      return res.status(400).json({
        error: "Link video cần URL video hoặc upload video trước khi tạo",
      });
    }

    let selectedDomainHostname = null;
    if (link_type === "video") {
      selectedDomainHostname = await resolveVideoLinkDomainHostname(database);
      if (!selectedDomainHostname) {
        return res.status(400).json({
          error: `Domain video ${VIDEO_LINK_DOMAIN} chưa được bật hoặc chưa có trong danh sách domain hoạt động`,
        });
      }
    } else if (domain_hostname) {
      selectedDomainHostname = await resolveActiveDomainHostname(
        database,
        domain_hostname,
      );
      if (!selectedDomainHostname) {
        return res
          .status(400)
          .json({ error: "Domain tạo link không còn hoạt động" });
      }
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
      storedVideoOverlayText,
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
    const publicOverlayFields = parseVideoOverlayConfig(storedVideoOverlayText);
    return res.json({
      short_url: buildShortUrl(shortBaseUrl, code),
      short_code: code,
      original_url: url,
      clicks: 0,
      link_type,
      domain_hostname: selectedDomainHostname,
      video_overlay_text: publicOverlayFields.text || "",
      video_popup_url_3s: publicOverlayFields.popup_urls["3s"] || "",
      video_popup_url_5s: publicOverlayFields.popup_urls["5s"] || "",
      video_popup_url_300s: publicOverlayFields.popup_urls["300s"] || "",
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
        ...attachVideoOverlayPublicFields(link),
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
      video_popup_url_3s,
      video_popup_url_5s,
      video_popup_url_300s,
    } = req.body;
    const nextLinkType =
      String(link_type || link.link_type || "direct").trim() || "direct";
    let nextVideoUrl =
      typeof video_url === "string" ? video_url.trim() : video_url;
    if (nextVideoUrl) {
      try {
        new URL(nextVideoUrl);
      } catch {
        nextVideoUrl = null;
      }
    } else {
      nextVideoUrl = null;
    }
    if (nextLinkType === "video" && !nextVideoUrl) {
      return res.status(400).json({
        error: "Link video cần URL video hoặc upload video trước khi lưu",
      });
    }
    if (nextLinkType === "video" && !isShopeeUrl(link.original_url)) {
      return res.status(400).json({
        error: "Link video hiện chỉ hỗ trợ URL Shopee",
      });
    }
    const existingOverlayConfig = parseVideoOverlayConfig(link.video_overlay_text);
    const updateFields = {
      og_title: normalizeShareTitleInput(og_title, 120),
      og_desc,
      og_image,
      link_type: nextLinkType,
      video_url: nextVideoUrl,
      video_overlay_text: buildVideoOverlayConfigStorage(
        typeof video_overlay_text === "undefined"
          ? existingOverlayConfig.text
          : video_overlay_text,
        {
          "3s":
            typeof video_popup_url_3s === "undefined"
              ? existingOverlayConfig.popup_urls["3s"]
              : video_popup_url_3s,
          "5s":
            typeof video_popup_url_5s === "undefined"
              ? existingOverlayConfig.popup_urls["5s"]
              : video_popup_url_5s,
          "300s":
            typeof video_popup_url_300s === "undefined"
              ? existingOverlayConfig.popup_urls["300s"]
              : video_popup_url_300s,
        },
      ),
    };
    if (nextLinkType === "video") {
      const nextVideoDomainHostname =
        await resolveVideoLinkDomainHostname(database);
      if (!nextVideoDomainHostname) {
        return res.status(400).json({
          error: `Domain video ${VIDEO_LINK_DOMAIN} chưa được bật hoặc chưa có trong danh sách domain hoạt động`,
        });
      }
      updateFields.domain_hostname = nextVideoDomainHostname;
    } else if (typeof domain_hostname !== "undefined") {
      let nextDomainHostname = null;
      if (String(domain_hostname || "").trim()) {
        nextDomainHostname = await resolveActiveDomainHostname(
          database,
          domain_hostname,
        );
        if (!nextDomainHostname) {
          return res
            .status(400)
            .json({ error: "Domain tạo link không còn hoạt động" });
        }
      }
      updateFields.domain_hostname = nextDomainHostname;
    }
    await database.updateLink(Number(req.params.id), updateFields);
    const updated = await database.getLinkById(Number(req.params.id));
    res.json({
      link: {
        ...attachVideoOverlayPublicFields(updated),
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
    const [publicBaseUrl, user] = await Promise.all([
      getPublicBaseUrl(),
      resolveUser(req),
    ]);
    const userId = user?.id || null;
    const guestSessionId = user ? null : req.guestSessionId;
    const cacheKey = buildStatsCacheKey(userId, guestSessionId);
    const cachedEntry = statsResponseCache.get(cacheKey);
    if (
      cachedEntry &&
      cachedEntry.expiresAt > Date.now() &&
      cachedEntry.publicBaseUrl === publicBaseUrl &&
      cachedEntry.plan === (user?.plan || "guest")
    ) {
      return res.json(cachedEntry.payload);
    }
    if (statsResponseInFlight.has(cacheKey)) {
      const payload = await statsResponseInFlight.get(cacheKey);
      return res.json(payload);
    }

    const requestPromise = (async () => {
      const timings = {};
      const startedAt = Date.now();
      const [
        totals,
        today,
        analyticsSummary,
        labAnalyticsRows,
        latestLoginEvent,
        workspaceSelection,
        recentLinks,
      ] = await Promise.all([
        measureAsyncTiming(
          "totals",
          () => database.getTotals(userId, guestSessionId),
          timings,
        ),
        measureAsyncTiming(
          "today",
          () => database.getTodayStats(userId, guestSessionId),
          timings,
        ),
        measureAsyncTiming(
          "analyticsSummary",
          () =>
            database.getClickAnalyticsSummary(userId, guestSessionId, {
              days: USER_STATS_RECENT_DAYS,
            }),
          timings,
        ),
        userId
          ? measureAsyncTiming(
              "labAnalyticsRows",
              () =>
                database.getArticleFunnelClickAnalyticsRows(userId, {
                  days: USER_STATS_RECENT_DAYS,
                  limit: 5000,
                }),
              timings,
            )
          : Promise.resolve([]),
        user
          ? measureAsyncTiming(
              "latestLogin",
              () => database.getLatestLoginEvent(user.id),
              timings,
            )
          : Promise.resolve(null),
        user
          ? measureAsyncTiming(
              "workspace",
              () =>
                resolveWorkspaceSelection(database, user, {
                  ensureOwnerWorkspace: false,
                }),
              timings,
            )
          : Promise.resolve(null),
        measureAsyncTiming(
          "recentLinks",
          () => database.getRecentLinks(userId, guestSessionId),
          timings,
        ),
      ]);
      let analytics = analyticsSummary;
      let clickRows = [];
      let analyticsSource = "rpc";
      const mappedLabAnalyticsRows =
        mapArticleFunnelClickRowsToAnalyticsRows(labAnalyticsRows);
      if (!analytics) {
        clickRows = await measureAsyncTiming(
          "clicksFallback",
          () =>
            database.getClickAnalytics(userId, guestSessionId, {
              limit: 5000,
              days: USER_STATS_RECENT_DAYS,
            }),
          timings,
        );
        analytics = await measureAsyncTiming(
          "analyticsFallback",
          () =>
            Promise.resolve(
              buildStatsAnalyticsWithRecentBuckets([
                ...clickRows,
                ...mappedLabAnalyticsRows,
              ]),
            ),
          timings,
        );
        analyticsSource = "node-fallback";
      } else if (mappedLabAnalyticsRows.length) {
        analytics = mergeStatsAnalytics(
          analytics,
          buildStatsAnalyticsWithRecentBuckets(mappedLabAnalyticsRows),
        );
      }
      const todayKey = getAnalyticsDayKey(new Date());
      const uniqueClicksToday =
        (analytics.unique_timeline || []).find((item) => item.date === todayKey)
          ?.clicks || 0;
      const alerts = buildStatsAlertPayload({
        planName: user?.plan || "guest",
        linksToday: today.linksToday || 0,
        hasAccount: !!user,
        clickRows:
          analyticsSource === "rpc"
            ? analytics?.recent_buckets || []
            : clickRows,
        latestLoginEvent,
      });
      const workspaceInviteAlert =
        buildWorkspaceInvitationAlert(workspaceSelection);
      if (workspaceInviteAlert) {
        alerts.active = Array.isArray(alerts.active) ? alerts.active : [];
        alerts.active.push(workspaceInviteAlert);
      }
      const recent = recentLinks.map((l) => ({
        ...attachVideoOverlayPublicFields(l),
        short_url: buildLinkShortUrl(l, publicBaseUrl),
      }));
      const payload = {
        ...totals,
        ...today,
        totalClicks: Number(analytics.unique_clicks || 0),
        uniqueTotalClicks: Number(analytics.unique_clicks || 0),
        rawTotalClicks: Number(analytics.total_clicks || 0),
        clicksToday: Number(uniqueClicksToday || 0),
        uniqueClicksToday: Number(uniqueClicksToday || 0),
        rawClicksToday: Number(today.clicksToday || 0),
        recentWindowDays: USER_STATS_RECENT_DAYS,
        recent,
        analytics,
        alerts,
        plan: user?.plan || "guest",
      };
      timings.total = Date.now() - startedAt;
      if (timings.total >= 1500) {
        console.log("[stats] slow request", {
          ...timings,
          analyticsSource,
          clickRows: clickRows.length,
          recentBuckets: Array.isArray(analytics?.recent_buckets)
            ? analytics.recent_buckets.length
            : 0,
          totalClicks: analytics?.total_clicks || 0,
          recentLinks: recentLinks.length,
          hasUser: !!user,
        });
      }
      if (STATS_RESPONSE_CACHE_TTL_MS > 0) {
        statsResponseCache.set(cacheKey, {
          payload,
          expiresAt: Date.now() + STATS_RESPONSE_CACHE_TTL_MS,
          publicBaseUrl,
          plan: user?.plan || "guest",
        });
      }
      return { payload, timings };
    })();
    statsResponseInFlight.set(cacheKey, requestPromise);
    try {
      const { payload, timings } = await requestPromise;
      const serverTimingHeader = formatServerTimingHeader(timings);
      if (serverTimingHeader) {
        res.setHeader("Server-Timing", serverTimingHeader);
      }
      return res.json(payload);
    } finally {
      statsResponseInFlight.delete(cacheKey);
    }
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
    const resolvedOriginalUrl =
      linkType === "video"
        ? await resolveShopeeShortUrl(link.original_url)
        : link.original_url;
    const launchLink =
      resolvedOriginalUrl === link.original_url
        ? link
        : { ...link, original_url: resolvedOriginalUrl };
    const info = detectPlatformDeep(launchLink.original_url, platform);
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
        target: info.fallback || launchLink.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
        "Content-Type": "text/html;charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
      });
      return res.send(
        buildShopeeFacebookBridgePage(launchLink, publicBaseUrl, info),
      );
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
        target: launchLink.original_url,
        referer,
      });
      return res.redirect(302, launchLink.original_url);
    }

    if (info.platform_name === "shopee") {
      const shopeeTarget = info.deeplink || launchLink.original_url;
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
      const shortUrl = buildLinkShortUrl(launchLink, publicBaseUrl);
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
        target: info.deeplink || launchLink.original_url,
        referer,
      });
      res.set({
        "Cache-Control": "no-cache,no-store,must-revalidate",
        Pragma: "no-cache",
      });
      return res.send(buildDirectBridgePage(launchLink, shortUrl, info));
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
      target: launchLink.original_url,
      referer,
    });
    return res.redirect(302, launchLink.original_url);
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
      const resolvedVideoOriginalUrl = await resolveShopeeShortUrl(
        link.original_url,
      );
      const videoLink =
        resolvedVideoOriginalUrl === link.original_url
          ? link
          : { ...link, original_url: resolvedVideoOriginalUrl };
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
        target: videoLink.original_url,
        referer,
      });
      return res.send(buildVideoPage(videoLink));
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
      ? [
          ...new Set(
            req.body.ids
              .map((id) => Number(id))
              .filter((id) => Number.isInteger(id) && id > 0),
          ),
        ]
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

function shouldRedirectUnknownBrowserPath(req) {
  if (req.method !== "GET") return false;
  const pathname = String(req.path || "").trim() || "/";
  if (pathname === "/" || pathname === "/landing") return false;
  if (!pathname.includes("/", 1)) return false;
  if (pathname.includes(".")) return false;
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/go/") ||
    pathname.startsWith("/u/") ||
    pathname.startsWith("/_og/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/user/")
  ) {
    return false;
  }
  return String(req.headers.accept || "").includes("text/html");
}

app.use((req, res, next) => {
  if (!shouldRedirectUnknownBrowserPath(req)) {
    return next();
  }
  return res.redirect(302, "/");
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
  const avatar =
    profile.avatar?.trim() || (owner?.name || "R").charAt(0).toUpperCase();
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
  const desc = esc(link.og_desc || "Đang mở Shopee để tiếp tục xem nội dung.");
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

    if (platform === 'tiktok') {
      if (iosUrl && iosUrl !== webUrl) {
        try { window.location.href = iosUrl; } catch (_) {}
      }
      setTimeout(function() {
        if (!document.hidden) {
          window.location.replace(webUrl);
        }
      }, 1500);
      return;
    }

    var target = canonical;
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

function buildArticleFunnelPopup20sTikTokBridgePage(link, canonicalUrl, info) {
  const title = link.og_title?.trim() || "BocLink";
  const desc =
    link.og_desc?.trim() || "Dang mo ung dung goc de tiep tuc xem noi dung.";
  const image = link.og_image || "";
  const browserUrl = String(
    info?.popup20s_browser_url || info?.fallback || link.original_url || "",
  ).trim();
  const iosInAppUrl = String(
    info?.popup20s_ios_inapp_url || browserUrl,
  ).trim();
  const fallbackUrl = browserUrl || String(link.original_url || "").trim();

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
  var browserUrl = "${escJs(browserUrl)}";
  var iosInAppUrl = "${escJs(iosInAppUrl)}";
  var fallbackUrl = "${escJs(fallbackUrl)}";
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isFacebook = /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
  var isZalo = /ZaloApp/i.test(ua);
  var isInApp = isFacebook || isZalo;

  function openSameWindow(targetUrl) {
    if (!targetUrl) return false;
    try {
      window.location.href = targetUrl;
      return true;
    } catch (_) {
      return false;
    }
  }

  if (isIOS && isInApp) {
    openSameWindow(iosInAppUrl || browserUrl || fallbackUrl);
    setTimeout(function() {
      if (!document.hidden && fallbackUrl) {
        window.location.replace(fallbackUrl);
      }
    }, 1500);
    return;
  }

  if (browserUrl) {
    openSameWindow(browserUrl);
    return;
  }

  if (fallbackUrl) {
    window.location.replace(fallbackUrl);
  }
})();
</script>
</body>
</html>`;
}

function buildArticleFunnelTikTokInAppBridgePage(
  link,
  canonicalUrl,
  targetUrl,
  iosTargetUrl = "",
) {
  const title = link.og_title?.trim() || "BocLink";
  const desc =
    link.og_desc?.trim() || "Dang mo ung dung goc de tiep tuc xem noi dung.";
  const image = link.og_image || "";
  const dest = String(targetUrl || link.original_url || "").trim();
  const iosDest = String(iosTargetUrl || "").trim() || dest;

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
  var webUrl = "${escJs(dest)}";
  var iosUrl = "${escJs(iosDest)}";
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isFacebook = /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
  var isZalo = /ZaloApp/i.test(ua);
  var isInApp = isFacebook || isZalo;
  var escapedKey = 'rgl_lab_tiktok_inapp_' + location.pathname;

  function setFlag(key) {
    try { localStorage.setItem(key, Date.now().toString()); } catch(_) {}
  }
  function hasFlag(key) {
    try {
      var val = localStorage.getItem(key);
      if (!val) return false;
      return (Date.now() - parseInt(val, 10)) < 30000;
    } catch(_) { return false; }
  }
  function clearFlag(key) {
    try { localStorage.removeItem(key); } catch(_) {}
  }

  function openViaAnchor(targetUrl) {
    if (!targetUrl) return;
    var anchor = document.createElement('a');
    anchor.href = targetUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
  }

  if (isIOS && isInApp) {
    if (hasFlag(escapedKey)) {
      clearFlag(escapedKey);
      window.location.replace(webUrl);
      return;
    }
    setFlag(escapedKey);
    if (iosUrl && iosUrl !== webUrl) {
      try { window.location.href = iosUrl; } catch (_) {}
    } else {
      openViaAnchor(webUrl);
    }
    setTimeout(function() {
      if (!document.hidden) {
        window.location.replace(webUrl);
      }
    }, 1500);
    return;
  }

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
      return res.status(400).json({
        error: "Không có file hoặc định dạng không hợp lệ (mp4, webm, mov)",
      });

    try {
      if (R2_VIDEO_OK && req.file.buffer) {
        const result = await uploadVideoBufferToR2(req.file.buffer, {
          originalName: req.file.originalname,
          contentType: req.file.mimetype,
        });
        return res.json(result);
      }
      if (CLOUDINARY_OK && req.file.buffer) {
        const result = await uploadToCloudinary(
          req.file.buffer,
          req.file.originalname,
          "video",
        );
        return res.json({
          url: buildCloudinaryPlayableVideoUrl(result.secure_url),
          thumb: buildCloudinaryVideoThumbUrl(result),
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
      if (e.message === "VIDEO_TYPE_NOT_SUPPORTED") {
        return res.status(400).json({
          error: "Định dạng video chưa được hỗ trợ",
        });
      }
      return res
        .status(500)
        .json({ error: "Upload video thất bại: " + e.message });
    }
  },
);

function buildVideoPage(link) {
  const launchUrl = buildVideoLaunchUrl(link);
  const overlayConfig = parseVideoOverlayConfig(link.video_overlay_text);
  const overlayTextRaw = overlayConfig.text || "";
  const overlayText = esc(
    overlayTextRaw &&
      overlayTextRaw !== "Bấm vào đây để ủng hộ và xem sản phẩm →"
      ? overlayTextRaw
      : "Bấm vào đây để ủng hộ và quay lại để xem tiếp",
  );
  const buildStageLaunchConfig = (targetUrl) => {
    return buildOverlayLaunchConfig(targetUrl || link.original_url || "");
  };
  const overlayStages = [
    {
      id: "overlay-3s",
      stage_key: "3s",
      label: "Mốc 3s",
      delayMs: 3000,
      enabled: true,
      ...buildStageLaunchConfig(
        overlayConfig.popup_urls["3s"] || link.original_url || "",
      ),
    },
    {
      id: "overlay-5s",
      stage_key: "5s",
      label: "Mốc 5s",
      delayMs: 5000,
      enabled: true,
      ...buildStageLaunchConfig(
        overlayConfig.popup_urls["5s"] || link.original_url || "",
      ),
    },
    {
      id: "overlay-300s",
      stage_key: "300s",
      label: "Mốc 300s",
      delayMs: 300000,
      enabled: true,
      ...buildStageLaunchConfig(
        overlayConfig.popup_urls["300s"] || link.original_url || "",
      ),
    },
  ];
  const ogTitle = esc(link.og_title || "Xem video");
  const ogDesc = esc(
    link.og_desc || "Nội dung đang sẵn sàng. Bấm vào màn hình để tiếp tục.",
  );
  const ogImage = esc(link.og_image || "");
  const popupPreviewHtml = ogImage
    ? `<img class="popup-preview-image" src="${ogImage}" alt="${ogTitle}" />`
    : `<div class="popup-preview-fallback">
        <div class="popup-preview-badge">MỞ APP</div>
        <div class="popup-preview-copy">${overlayText}</div>
      </div>`;
  const rawVideoUrl = String(link.video_url || "").trim();
  const videoUrl = buildCloudinaryPlayableVideoUrl(rawVideoUrl);

  let videoHtml = "";
  const ytMatch = rawVideoUrl.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
  );
  const ytEmbed = rawVideoUrl.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/);
  if (ytMatch || ytEmbed) {
    const vid = ytMatch ? ytMatch[1] : ytEmbed[1];
    videoHtml = `<iframe id="videoEl"
      src="https://www.youtube.com/embed/${vid}?autoplay=1&mute=1&enablejsapi=1&rel=0&modestbranding=1&playsinline=1"
      frameborder="0" allow="autoplay;encrypted-media;gyroscope;fullscreen"
      style="position:absolute;top:0;left:0;width:100%;height:100%;border:0"></iframe>`;
  } else if (videoUrl) {
    videoHtml = `<video id="videoEl" src="${esc(videoUrl)}"
      ${ogImage ? `poster="${ogImage}"` : ""}
      autoplay muted playsinline webkit-playsinline preload="auto" disableRemotePlayback controls
      style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:contain;background:#111827;border-radius:18px"
      onloadedmetadata="fitVideo(this)" onloadeddata="fitVideo(this)"></video>`;
  } else {
    videoHtml = `<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.4);font-size:16px">Không có video</div>`;
  }

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>${ogTitle}</title>
${ogImage ? `<meta property="og:image" content="${ogImage}"/>` : ""}
<meta property="og:title" content="${ogTitle}"/>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
html,body{width:100%;min-height:100%;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111827;background:#efefef}
body{overflow-x:hidden}
.shell{width:min(100%,860px);margin:0 auto;padding:0 0 40px}
.site-bar{padding:18px 24px 10px;background:#fff;font-size:1.12rem;font-weight:700;letter-spacing:-.02em;color:#111827}
.card{position:relative;background:#fff;min-height:100vh}
.content-panel{padding:0 24px 24px}
.content-panel h1{margin:0 0 28px;font-size:2.16rem;line-height:1.2;letter-spacing:-.045em;color:#000;font-weight:700}
.content-panel .lead{margin:0 0 16px;font-size:1rem;line-height:1.6;color:#374151}
.article-copy{font-size:1rem;line-height:1.7;color:#1f2937}
.article-copy p + p{margin-top:12px}
.media-panel{position:relative;width:100%;overflow:hidden;background:#fff;padding:0 24px 22px}
.vbox{position:relative;width:100%;aspect-ratio:16/9;min-height:220px;display:flex;align-items:center;justify-content:center;background:#000}
.video-shell{position:relative;width:100%;background:#000}
@media (min-width:768px){.shell{max-width:760px}.site-bar{padding:18px 32px 12px}.content-panel{padding:0 32px 26px}.content-panel h1{font-size:2.45rem}.media-panel{padding:0 32px 26px}}
.cd-wrap{position:fixed;top:14px;right:14px;z-index:30;display:none !important;align-items:center;justify-content:center}
.countdown-chip{min-width:112px;padding:10px 12px;border-radius:14px;background:rgba(17,24,39,.88);border:1px solid rgba(255,255,255,.18);box-shadow:0 10px 30px rgba(0,0,0,.28)}
.countdown-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.countdown-label{font-size:11px;font-weight:700;letter-spacing:.02em;color:rgba(243,244,246,.84)}
.cd-num{font-size:17px;font-weight:900;color:#fff}
.countdown-bar{position:relative;width:100%;height:5px;margin-top:7px;border-radius:999px;background:rgba(255,255,255,.15);overflow:hidden}
.cd-prog{position:absolute;left:0;top:0;height:100%;width:0%;border-radius:999px;background:#1d9bf0;transition:width .12s linear}
.overlay{position:fixed;inset:0;z-index:31;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.85);opacity:0;pointer-events:none;transition:opacity .24s}
.overlay.show{opacity:1;pointer-events:all}
.overlay.launching{opacity:0;pointer-events:none}
.overlay-hint{position:relative;width:min(90vw,300px);border-radius:10px;overflow:visible;box-shadow:0 18px 42px rgba(0,0,0,.35)}
.overlay-hint::before,.overlay-hint::after{content:"";position:absolute;inset:0;border-radius:10px;background:#111827;opacity:0;pointer-events:none;z-index:-1;transition:opacity .2s ease,transform .2s ease}
.overlay[data-stack-depth="2"] .overlay-hint::before,.overlay[data-stack-depth="3"] .overlay-hint::before{opacity:1;transform:translateY(10px) scale(.97)}
.overlay[data-stack-depth="3"] .overlay-hint::after{opacity:1;transform:translateY(20px) scale(.94)}
.popup-close-btn{position:absolute;top:1px;right:1px;z-index:4;background:#1d9bf0;color:#fff;border:none;border-radius:50%;width:50px;height:50px;font-size:25px;cursor:pointer;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 10px 24px rgba(29,155,240,.36);opacity:0;pointer-events:none}
.x-btn.show{opacity:1;pointer-events:all}
.popup-preview-image,.popup-preview-fallback{width:100%;display:block;border-radius:10px}
.popup-preview-image{height:auto;background:#d1d5db}
.popup-preview-fallback{aspect-ratio:3/4;background:linear-gradient(180deg,#111827 0%,#1f2937 100%);padding:22px 18px;display:flex;flex-direction:column;justify-content:flex-end;gap:12px}
.popup-preview-badge,.overlay-stage-label,.overlay-stack-badge{display:none !important}
.popup-preview-copy{font-size:1.08rem;line-height:1.35;color:#fff;font-weight:800;text-shadow:0 2px 8px rgba(0,0,0,.28)}
.pf{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:29;font-size:52px;opacity:0;pointer-events:none;transition:opacity .15s}
.pf.show{opacity:1}
</style>
</head>
<body>
<main class="shell">
  <div class="site-bar">DRAMA</div>
  <section class="card">
    <div class="content-panel">
      <h1>${ogTitle}</h1>
      <p class="lead">${ogDesc}</p>
    </div>
    <div class="media-panel">
      <div class="video-shell">
      <div class="vbox" id="vbox">
        ${videoHtml}
        <div class="pf" id="pf">⏸</div>
        <div class="cd-wrap" id="cdWrap">
          <div class="countdown-chip">
            <div class="countdown-top">
              <span class="countdown-label">Mở tiếp sau</span>
              <span class="cd-num" id="cdNum">3</span>
            </div>
            <div class="countdown-bar">
              <span class="cd-prog" id="cdProg"></span>
            </div>
          </div>
        </div>
        <div class="overlay" id="overlay" onclick="goApp()">
          <div class="overlay-hint">
            <button class="popup-close-btn x-btn" id="xBtn" type="button" onclick="goApp()">X</button>
            <div class="overlay-stage-label" id="overlayStageLabel">Mốc 3s</div>
            ${popupPreviewHtml}
            <div class="overlay-stack-badge" id="overlayStackBadge" hidden>+1 popup đang chờ</div>
          </div>
        </div>
      </div>
      </div>
    </div>
    <div class="content-panel">
      <div class="article-copy">
        <p>${ogDesc}</p>
      </div>
    </div>
  </section>
</main>
<script>
(function(){
  var LAUNCH_URL = ${JSON.stringify(launchUrl)};
  var OVERLAY_STAGES = ${JSON.stringify(overlayStages)}.filter(function(stage){ return !!stage.enabled; });

  var videoEl = document.getElementById('videoEl');
  var overlay = document.getElementById('overlay');
  var xBtn    = document.getElementById('xBtn');
  var cdWrap  = document.getElementById('cdWrap');
  var cdProg  = document.getElementById('cdProg');
  var cdNum   = document.getElementById('cdNum');
  var overlayStageLabel = document.getElementById('overlayStageLabel');
  var overlayStackBadge = document.getElementById('overlayStackBadge');
  var pf      = document.getElementById('pf');
  var shown   = false;
  var launching = false;
  var countdownRaf = 0;
  var activeStageIndex = -1;
  var dismissedStageIds = [];
  var timerOriginMs = Date.now();

  function flashPauseIndicator() {
    if (!pf) return;
    pf.classList.add('show');
    setTimeout(function(){pf.classList.remove('show');},600);
  }

  function getElapsedMs() {
    return Date.now() - timerOriginMs;
  }

  function isStageDismissed(index) {
    var stage = OVERLAY_STAGES[index];
    if (!stage) return true;
    return dismissedStageIds.indexOf(stage.id) >= 0;
  }

  function saveDismissedStage(index) {
    var stage = OVERLAY_STAGES[index];
    if (!stage || isStageDismissed(index)) return;
    dismissedStageIds.push(stage.id);
  }

  function hasRemainingStages() {
    return dismissedStageIds.length < OVERLAY_STAGES.length;
  }

  function getPendingStageIndexes(elapsedMs) {
    return OVERLAY_STAGES.reduce(function(result, stage, index){
      if (!isStageDismissed(index) && elapsedMs >= Number(stage.delayMs || 0)) {
        result.push(index);
      }
      return result;
    }, []);
  }

  function getNextStageIndex(elapsedMs) {
    for (var index = 0; index < OVERLAY_STAGES.length; index += 1) {
      if (!isStageDismissed(index) && elapsedMs < Number(OVERLAY_STAGES[index].delayMs || 0)) {
        return index;
      }
    }
    return -1;
  }

  function stopCountdownLoop() {
    if (!countdownRaf) return;
    cancelAnimationFrame(countdownRaf);
    countdownRaf = 0;
  }

  function hideOverlayUi() {
    overlay.classList.remove('show');
    overlay.classList.remove('launching');
    overlay.dataset.stackDepth = '0';
    xBtn.classList.remove('show');
    if (overlayStageLabel) {
      overlayStageLabel.textContent =
        (OVERLAY_STAGES[0] && OVERLAY_STAGES[0].label) || '';
    }
    if (overlayStackBadge) {
      overlayStackBadge.hidden = true;
      overlayStackBadge.textContent = '';
    }
    shown = false;
    activeStageIndex = -1;
  }

  function primeVideoPlayback() {
    if (!(videoEl && videoEl.tagName === 'VIDEO')) return;
    try {
      videoEl.muted = true;
      videoEl.defaultMuted = true;
      videoEl.playsInline = true;
      videoEl.setAttribute('muted', '');
      videoEl.setAttribute('playsinline', '');
      videoEl.setAttribute('webkit-playsinline', '');
      videoEl.setAttribute('preload', 'auto');
      var playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === 'function') {
        playPromise.catch(function(){});
      }
    } catch(_){}
  }

  window.fitVideo = function(v) {
    if (!v.videoWidth) return;
    var sw=window.innerWidth, sh=window.innerHeight;
    var isDesktop = sw >= 768;
    var isPortrait = v.videoHeight >= v.videoWidth;
    var maxW;
    var maxH;
    if (isDesktop) {
      maxW = Math.min(sw - 40, isPortrait ? 520 : 960);
      maxH = Math.min(sh - 40, isPortrait ? 820 : 720);
    } else {
      maxW = Math.min(sw - 24, isPortrait ? sw * 0.9 : sw * 0.94);
      maxH = Math.min(sh - 32, isPortrait ? sh * 0.76 : sh * 0.62);
    }
    var scale = Math.min(maxW/v.videoWidth, maxH/v.videoHeight);
    var w = v.videoWidth*scale, h = v.videoHeight*scale;
    var box = document.getElementById('vbox');
    box.style.width = w+'px'; box.style.height = h+'px';
    v.style.width='100%'; v.style.height='100%';
  };
  window.addEventListener('resize', function(){
    if(videoEl && videoEl.tagName==='VIDEO') fitVideo(videoEl);
  });
  if (videoEl && videoEl.tagName === 'VIDEO') {
    videoEl.addEventListener('loadeddata', function(){
      fitVideo(videoEl);
      primeVideoPlayback();
    });
    videoEl.addEventListener('canplay', primeVideoPlayback);
    setTimeout(primeVideoPlayback, 0);
    setTimeout(primeVideoPlayback, 240);
    document.addEventListener('touchstart', function onFirstTouch(){
      primeVideoPlayback();
      document.removeEventListener('touchstart', onFirstTouch, true);
    }, true);
  }

  function renderCountdown(elapsedMs) {
    var nextStageIndex = getNextStageIndex(elapsedMs);
    if (nextStageIndex < 0) {
      cdWrap.style.display = 'none';
      return;
    }
    var nextStage = OVERLAY_STAGES[nextStageIndex];
    var nextDelay = Number(nextStage.delayMs || 0);
    var left = Math.max(0, nextDelay - elapsedMs);
    if (!shown) {
      resumePlayback();
    }
    cdWrap.style.display = 'flex';
    cdProg.style.width = (100 * (1 - left / nextDelay)) + '%';
    cdNum.textContent = String(Math.max(1, Math.ceil(left / 1000)));
  }

  function renderOverlay(pendingIndexes){
    if (!pendingIndexes.length) return;
    var topIndex = pendingIndexes[pendingIndexes.length - 1];
    var stackDepth = Math.min(3, pendingIndexes.length);
    var shouldFlash = !shown || activeStageIndex !== topIndex;
    shown = true;
    activeStageIndex = topIndex;
    overlay.dataset.stackDepth = String(stackDepth);
    overlay.classList.add('show');
    overlay.classList.remove('launching');
    xBtn.classList.add('show');
    cdWrap.style.display='none';
    if (overlayStageLabel) {
      overlayStageLabel.textContent = OVERLAY_STAGES[topIndex].label || 'Mở app';
    }
    if (overlayStackBadge) {
      if (pendingIndexes.length > 1) {
        overlayStackBadge.hidden = false;
        overlayStackBadge.textContent = '+' + String(pendingIndexes.length - 1) + ' popup đang chờ';
      } else {
        overlayStackBadge.hidden = true;
        overlayStackBadge.textContent = '';
      }
    }
    if (shouldFlash) {
      flashPauseIndicator();
    }
    pausePlayback();
  }

  function pausePlayback(){
    try{
      if(videoEl&&videoEl.tagName==='VIDEO') videoEl.pause();
      else if(videoEl&&videoEl.tagName==='IFRAME')
        videoEl.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}','*');
    }catch(_){}
  }

  function resumePlayback(){
    try{
      if(videoEl&&videoEl.tagName==='VIDEO') videoEl.play();
      else if(videoEl&&videoEl.tagName==='IFRAME')
        videoEl.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}','*');
    }catch(_){}
  }

  function openViaAnchor(targetUrl, targetName, relValue) {
    if (!targetUrl) return false;
    try {
      var anchor = document.createElement('a');
      anchor.href = targetUrl;
      anchor.rel = relValue || 'noreferrer noopener';
      anchor.target = targetName || '_self';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      setTimeout(function() {
        try { anchor.remove(); } catch (_) {}
      }, 0);
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildAndroidIntentUrl(targetUrl, packageName, fallbackUrl) {
    if (!targetUrl || !packageName) return '';
    try {
      var parsed = new URL(targetUrl);
      var noScheme = targetUrl.replace(/^https?:\\/\\//i, '');
      var fallback = fallbackUrl || targetUrl;
      return 'intent://' + noScheme +
        '#Intent;scheme=' + parsed.protocol.replace(':', '') +
        ';package=' + packageName +
        ';S.browser_fallback_url=' + encodeURIComponent(fallback) +
        ';end';
    } catch (_) {
      return '';
    }
  }

  function launchDirectTarget(stage) {
    if (!stage) return false;
    var ua = navigator.userAgent || '';
    var isIOS = /iphone|ipad|ipod/i.test(ua);
    var isAndroid = /android/i.test(ua);
    var isFacebook = /FBAN|FBAV|FB_IAB|FBIOS|FB4A/i.test(ua);
    var isZalo = /ZaloApp/i.test(ua);
    var isInApp = isFacebook || isZalo;

    if (stage.direct_platform === 'shopee') {
      if (isAndroid) {
        var shopeeIntentUrl =
          stage.direct_android_intent_url ||
          buildAndroidIntentUrl(
            stage.direct_android_url || stage.direct_web_url,
            stage.direct_android_package || 'com.shopee.vn',
            stage.direct_web_url
          );
        if (shopeeIntentUrl) {
          openViaAnchor(shopeeIntentUrl);
        } else if (stage.direct_app_url) {
          openViaAnchor(stage.direct_app_url);
        }
        setTimeout(function() {
          if (!document.hidden && stage.direct_web_url) {
            window.location.replace(stage.direct_web_url);
          }
        }, 1600);
        return true;
      }
      if (isIOS) {
        var iosTarget = isInApp
          ? (stage.direct_ios_fb_url || stage.direct_web_url || stage.direct_ios_url)
          : (stage.direct_ios_browser_url || stage.direct_ios_url || stage.direct_web_url);
        if (iosTarget) {
          openViaAnchor(iosTarget, '_blank', 'noopener');
        }
        setTimeout(function() {
          if (!document.hidden && stage.direct_web_url) {
            window.location.replace(stage.direct_web_url);
          }
        }, isInApp ? 1500 : 1600);
        return true;
      }
      if (stage.direct_web_url) {
        openViaAnchor(stage.direct_web_url);
        return true;
      }
    }

    if (stage.direct_platform === 'tiktok') {
      var isTikTokPopup20s = String(stage.stage_key || '') === '20s';
      var tiktokBrowserTarget =
        stage.direct_ios_browser_url || stage.direct_web_url || '';
      var tiktokTarget = isTikTokPopup20s
        ? (
            isIOS
              ? (
                  isInApp
                    ? (stage.direct_ios_fb_url || tiktokBrowserTarget)
                    : tiktokBrowserTarget
                )
              : tiktokBrowserTarget
          )
        : (
            isIOS
              ? (stage.direct_ios_url || stage.direct_app_url || stage.direct_web_url)
              : isAndroid
                ? (stage.direct_android_url || stage.direct_app_url || stage.direct_web_url)
                : stage.direct_web_url
          );
      if (!tiktokTarget) return false;
      openViaAnchor(tiktokTarget);
      if (isInApp) {
        setTimeout(function() {
          var fallbackUrl = tiktokBrowserTarget || stage.direct_web_url;
          if (!document.hidden && fallbackUrl) {
            window.location.replace(fallbackUrl);
          }
        }, 1500);
      }
      return true;
    }

    return false;
  }

  function syncUi(){
    var elapsed = getElapsedMs();
    var pendingIndexes = getPendingStageIndexes(elapsed);
    if (pendingIndexes.length) {
      renderOverlay(pendingIndexes);
      return;
    }
    if (shown && !launching) {
      hideOverlayUi();
    }
    renderCountdown(elapsed);
  }

  function tick(){
    syncUi();
    if (!hasRemainingStages()) {
      if (!shown) {
        stopCountdownLoop();
        cdWrap.style.display = 'none';
      }
      return;
    }
    countdownRaf = requestAnimationFrame(tick);
  }

  function startTimerLoop(){
    stopCountdownLoop();
    countdownRaf = requestAnimationFrame(tick);
  }

  function finalizeLaunchUi(){
    launching = false;
    overlay.classList.remove('launching');
    syncUi();
    if (!countdownRaf && hasRemainingStages()) {
      startTimerLoop();
    }
  }

  function goApp(){
    if(launching || activeStageIndex < 0) return;
    var activeStage = OVERLAY_STAGES[activeStageIndex] || null;
    saveDismissedStage(activeStageIndex);
    launching = true;
    overlay.classList.remove('show');
    overlay.classList.add('launching');
    xBtn.classList.remove('show');
    shown = false;
    activeStageIndex = -1;
    setTimeout(function(){
      if (launching && !document.hidden) {
        finalizeLaunchUi();
      }
    }, 1200);
    if (launchDirectTarget(activeStage)) {
      return;
    }
    resumePlayback();
    window.location.href = (activeStage && activeStage.direct_web_url) || LAUNCH_URL;
  }
  window.goApp=goApp;

  document.getElementById('vbox').addEventListener('click', function(e){
    if(hasRemainingStages() || launching) return;
    if(e.target === overlay || e.target === xBtn) return;
    if(overlay.contains(e.target) || xBtn.contains(e.target)) return;
    if(videoEl && videoEl.tagName === 'VIDEO') return;
  });

  window.addEventListener('focus', function(){
    if(!document.hidden&&launching){
      finalizeLaunchUi();
    }
  });

  document.addEventListener('visibilitychange',function(){
    if(!document.hidden&&launching){
      finalizeLaunchUi();
    }
  });

  syncUi();
  if (hasRemainingStages()) startTimerLoop();
})();
</script>
</body>
</html>`;
}

module.exports = app;
module.exports.__testUtils = {
  buildTikTokAppScheme,
  detectPlatformDeep,
  buildDirectLaunchConfig,
  buildOverlayLaunchConfig,
  applyArticleFunnelStageDirectOverrides,
  buildArticleFunnelPopup20sDirectBridgeInfo,
  buildArticleFunnelPopup20sTikTokBridgePage,
  decorateArticleFunnelStagesForClient,
  buildArticleFunnelPreviewPage,
  buildArticleFunnelPopupTestUrl,
  isArticleFunnelPopupTestRequestAllowed,
  normalizeArticleFunnelPreviewConfig,
  normalizeArticleFunnelStageKey,
  resolveArticleFunnelConfig,
  shouldUseArticleFunnelInlineLaunch,
  extractArticleFunnelImportPayload,
  recordArticleFunnelStageClick,
};
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () =>
    console.log(`🚀 http://localhost:${PORT}  admin: ${ADMIN_EMAIL}`),
  );
}
