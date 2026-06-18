import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
import puppeteer from "puppeteer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 3210);
const baseUrl = `http://127.0.0.1:${port}`;
const FACEBOOK_BOT_UA =
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)";
const FACEBOOK_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/470.0.0.0.0;FBBV/123456789;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBSS/3;FBID/phone;FBLC/vi_VN;FBOP/5;FBRV/0]";
const FACEBOOK_ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0.0;]";
const MOBILE_IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

function startServer() {
  const child = spawn(process.execPath, [path.join(rootDir, "api", "index.js")], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(port),
      BASE_URL: baseUrl,
      NODE_ENV: process.env.NODE_ENV || "test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  child.stdout.on("data", (chunk) => logs.push(chunk.toString("utf8")));
  child.stderr.on("data", (chunk) => logs.push(chunk.toString("utf8")));

  return {
    child,
    getLogs: () => logs.join(""),
  };
}

async function waitForServer(url, timeoutMs = 30000) {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { redirect: "follow" });
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected status ${response.status} for ${url}`);
    } catch (error) {
      lastError = error;
    }

    await delay(250);
  }

  throw new Error(
    `Server did not become ready in time: ${lastError?.message || "unknown error"}`,
  );
}

function isWhiteColor(value) {
  return /rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/.test(value);
}

function uniqueEmail(prefix = "codex") {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return `${prefix}-${suffix}@example.com`;
}

async function postJson(pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function fetchText(url, { ua = "", redirect = "manual" } = {}) {
  const response = await fetch(url, {
    headers: ua ? { "user-agent": ua } : {},
    redirect,
  });
  const text = await response.text();
  return { response, text };
}

let dbPromise;

async function getTestDb() {
  if (!dbPromise) {
    dbPromise = import(pathToFileURL(path.join(rootDir, "api", "db.js")).href).then(
      (mod) => (mod.init || mod.default?.init)(),
    );
  }
  return dbPromise;
}

async function updateUserPlanForTest(userId, plan) {
  const db = await getTestDb();
  await db.updateUserPlan(userId, plan);
}

async function grantAdminForTest(userId) {
  const db = await getTestDb();
  await db.updateUserRole(userId, "admin");
  await db.updateUserPlan(userId, "admin");
}

async function registerAuthedPage(browser) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
  const email = uniqueEmail();
  const password = "P@ssw0rd123";
  try {
    await page.goto(`${baseUrl}/register`, {
      waitUntil: "domcontentloaded",
    });
    await page.type("#regName", "Codex Smoke");
    await page.type("#regEmail", email);
    await page.type("#regPass", password);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded" }),
      page.click("#authForm .auth-submit"),
    ]);
    const me = await page.evaluate(async () => {
      const response = await fetch("/api/auth/me");
      return { status: response.status, data: await response.json() };
    });
    assert.equal(me.status, 200);
    assert.equal(me.data?.user?.email, email);
    return { page, email, password, userId: me.data?.user?.id };
  } catch (error) {
    await page.close().catch(() => {});
    throw error;
  }
}

async function shortenAsAuthedUser(page, payload) {
  return page.evaluate(async (body) => {
    const response = await fetch("/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  }, payload);
}

async function runPageCheck(browser, pathname, checks, options = {}) {
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1440, height: 1200, deviceScaleFactor: 1 });
    await page.goto(`${baseUrl}${pathname}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(options.waitForSelector || "#authPage");
    await checks(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function main() {
  const { child: server, getLogs } = startServer();
  let browser;

  try {
    await waitForServer(`${baseUrl}/register`);

    browser = await puppeteer.launch({
      headless: true,
      defaultViewport: { width: 1440, height: 1200 },
    });

    await runPageCheck(browser, "/register", async (page) => {
      const mode = await page.$eval("#authPage", (el) => el.dataset.authMode);
      assert.equal(mode, "register");

      const metricCount = await page.$$eval(".auth-metric", (els) => els.length);
      assert.equal(metricCount, 3);

      const sceneLink = await page.$eval(".auth-scene-link strong", (el) =>
        el.textContent.trim(),
      );
      assert.equal(sceneLink, "https://boclink.click/start");

      const iconColor = await page.$eval(".auth-scene-link-icon", (el) =>
        getComputedStyle(el).color,
      );
      assert.ok(
        isWhiteColor(iconColor),
        `Expected register scene icon to be white, got ${iconColor}`,
      );

      const oauthLabel = await page.$eval("#oauthButtonLabel", (el) =>
        el.textContent.trim(),
      );
      assert.equal(oauthLabel, "Tiếp tục bằng Google / Gmail");
    });

    await runPageCheck(browser, "/login", async (page) => {
      const mode = await page.$eval("#authPage", (el) => el.dataset.authMode);
      assert.equal(mode, "login");

      const metricCount = await page.$$eval(".auth-metric", (els) => els.length);
      assert.equal(metricCount, 3);

      const sceneLink = await page.$eval(".auth-scene-link strong", (el) =>
        el.textContent.trim(),
      );
      assert.equal(sceneLink, "https://boclink.click/short");

      const iconColor = await page.$eval(".auth-scene-link-icon", (el) =>
        getComputedStyle(el).color,
      );
      assert.ok(
        isWhiteColor(iconColor),
        `Expected login scene icon to be white, got ${iconColor}`,
      );

      const oauthLabel = await page.$eval("#oauthButtonLabel", (el) =>
        el.textContent.trim(),
      );
      assert.equal(oauthLabel, "Tiếp tục bằng Google / Gmail");
    });

    await runPageCheck(browser, "/user/login/?next=%2Fdashboard", async (page) => {
      const current = new URL(page.url());
      assert.equal(current.pathname, "/login");
      assert.equal(current.searchParams.get("next"), "/dashboard");
    });

    await runPageCheck(browser, "/user/register/?next=%2Fcreate", async (page) => {
      const current = new URL(page.url());
      assert.equal(current.pathname, "/register");
      assert.equal(current.searchParams.get("next"), "/create");
    });

    await runPageCheck(
      browser,
      "/",
      async (page) => {
        const brand = await page.$eval(".brand-title", (el) =>
          el.textContent.trim(),
        );
        assert.equal(brand, "RutGonLink");

        const heroTitle = await page.$eval(".hero-title", (el) =>
          el.textContent.replace(/\s+/g, " ").trim(),
        );
        assert.match(heroTitle, /Trực quan/);
        assert.match(heroTitle, /Năng động/);

        const tileCount = await page.$$eval(".feature-tile", (els) => els.length);
        assert.equal(tileCount, 6);

        const homeCtaHref = await page.$eval(
          ".hero-actions a.btn-brand-outline",
          (el) => el.getAttribute("href"),
        );
        assert.equal(homeCtaHref, "/register");
      },
      { waitForSelector: ".hero" },
    );

    await runPageCheck(
      browser,
      "/",
      async (page) => {
        const formAction = await page.$eval(".hero-form", (el) =>
          el.getAttribute("action"),
        );
        assert.equal(formAction, "/api/shorten");

        const resultHidden = await page.$eval("#landingShortenResult", (el) =>
          el.hidden,
        );
        assert.equal(resultHidden, true);

        const loginHref = await page.$eval("#landingShortenLogin", (el) =>
          el.getAttribute("href"),
        );
        const registerHref = await page.$eval("#landingShortenRegister", (el) =>
          el.getAttribute("href"),
        );
        assert.match(loginHref, /\/login\?next=/);
        assert.match(registerHref, /\/register\?next=/);
      },
      { waitForSelector: ".hero-form" },
    );

    await runPageCheck(
      browser,
      "/landing",
      async (page) => {
        const current = new URL(page.url());
        assert.equal(current.pathname, "/");
      },
      { waitForSelector: ".hero-form" },
    );

    const guestLandingPage = await browser.newPage();
    try {
      await guestLandingPage.setViewport({
        width: 1440,
        height: 1200,
        deviceScaleFactor: 1,
      });
      await guestLandingPage.goto(`${baseUrl}/`, {
        waitUntil: "domcontentloaded",
      });
      await guestLandingPage.type('.hero-form input[name="url"]', "https://s.shopee.vn/4Axe4JRRDO");
      await Promise.all([
        guestLandingPage.waitForFunction(
          () => !document.getElementById("landingShortenGate").hidden,
        ),
        guestLandingPage.click(".hero-form button[type=\"submit\"]"),
      ]);

      const guestConfirmHidden = await guestLandingPage.$eval(
        "#landingShortenConfirm",
        (el) => el.hidden,
      );
      assert.equal(guestConfirmHidden, true);

      const guestLoginHidden = await guestLandingPage.$eval(
        "#landingShortenLogin",
        (el) => el.hidden,
      );
      const guestRegisterHidden = await guestLandingPage.$eval(
        "#landingShortenRegister",
        (el) => el.hidden,
      );
      assert.equal(guestLoginHidden, false);
      assert.equal(guestRegisterHidden, false);

      const guestLoginHref = await guestLandingPage.$eval(
        "#landingShortenLogin",
        (el) => el.getAttribute("href"),
      );
      const guestRegisterHref = await guestLandingPage.$eval(
        "#landingShortenRegister",
        (el) => el.getAttribute("href"),
      );
      assert.match(guestLoginHref, /\/login\?next=/);
      assert.match(guestRegisterHref, /\/register\?next=/);
    } finally {
      await guestLandingPage.close().catch(() => {});
    }

    const guestAppPage = await browser.newPage();
    try {
      await guestAppPage.setViewport({
        width: 1440,
        height: 1200,
        deviceScaleFactor: 1,
      });
      await guestAppPage.goto(`${baseUrl}/dashboard`, {
        waitUntil: "domcontentloaded",
      });
      await guestAppPage.waitForFunction(() => typeof window.navigate === "function");
      await guestAppPage.evaluate(() => continueAsGuest());
      await guestAppPage.waitForFunction(() =>
        document.getElementById("appScreen")?.classList.contains("show"),
      );
      await guestAppPage.evaluate(() => navigate("create"));
      await guestAppPage.waitForSelector("#createFormArea_url");
      await guestAppPage.type(
        "#createFormArea_url",
        "https://s.shopee.vn/4Axe4JRRDO",
      );
      await Promise.all([
        guestAppPage.waitForFunction(
          () => document.getElementById("createFormArea_err")?.classList.contains("show"),
        ),
        guestAppPage.click("#createFormArea_btn"),
      ]);

      const guestAppPrompt = await guestAppPage.$eval(
        "#createFormArea_err",
        (el) => el.textContent,
      );
      assert.match(guestAppPrompt, /Đăng nhập/);
      assert.match(guestAppPrompt, /Đăng ký/);
    } finally {
      await guestAppPage.close().catch(() => {});
    }

    const guestAffiliate = await postJson("/api/shorten", {
      url: "https://s.shopee.vn/4Axe4JRRDO",
    });
    assert.equal(guestAffiliate.response.status, 401);
    assert.equal(guestAffiliate.data.authRequired, true);

    const normalShorten = await postJson("/api/shorten", {
      url: "https://example.com/article",
    });
    assert.equal(normalShorten.response.status, 200);
    assert.ok(normalShorten.data.short_url);

    const { page: authedPage, userId } = await registerAuthedPage(browser);
    try {
      await authedPage.goto(`${baseUrl}/`, {
        waitUntil: "domcontentloaded",
      });
      await authedPage.waitForSelector('.hero-form input[name="url"]');
      await authedPage.waitForFunction(
        () => document.getElementById("landingAuthUser")?.hidden === false,
      );

      const guestHidden = await authedPage.$eval(
        "#landingAuthGuest",
        (el) => el.hidden,
      );
      const userHidden = await authedPage.$eval(
        "#landingAuthUser",
        (el) => el.hidden,
      );
      assert.equal(guestHidden, true);
      assert.equal(userHidden, false);

      const avatarText = await authedPage.$eval(
        "#landingAuthAvatar",
        (el) => el.textContent.trim(),
      );
      assert.ok(avatarText.length > 0);

      const dashboardHref = await authedPage.$eval(
        "#landingDashboardBtn",
        (el) => el.getAttribute("href"),
      );
      assert.equal(dashboardHref, "/dashboard");

      await authedPage.$eval('input[name="url"]', (el, value) => {
        el.value = value;
      }, "https://s.shopee.vn/4Axe4JRRDO");
      await authedPage.$eval('input[name="url"]', (el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });

      await Promise.all([
        authedPage.waitForFunction(
          () => !document.getElementById("landingShortenGate").hidden,
        ),
        authedPage.click(".hero-form button[type=\"submit\"]"),
      ]);

      const confirmHidden = await authedPage.$eval(
        "#landingShortenConfirm",
        (el) => el.hidden,
      );
      assert.equal(confirmHidden, false);
      const confirmLabel = await authedPage.$eval(
        "#landingShortenConfirm",
        (el) => el.textContent.trim(),
      );
      assert.equal(confirmLabel, "Xem gói Pro");

      const loginHidden = await authedPage.$eval(
        "#landingShortenLogin",
        (el) => el.hidden,
      );
      const registerHidden = await authedPage.$eval(
        "#landingShortenRegister",
        (el) => el.hidden,
      );
      assert.equal(loginHidden, true);
      assert.equal(registerHidden, true);

      const authedGuestShorten = await shortenAsAuthedUser(authedPage, {
        url: "https://s.shopee.vn/4Axe4JRRDO",
      });
      assert.equal(authedGuestShorten.status, 403);
      assert.equal(authedGuestShorten.data.affiliateUpgradeRequired, true);

      await authedPage.goto(`${baseUrl}/dashboard`, {
        waitUntil: "domcontentloaded",
      });
      await authedPage.waitForFunction(
        () => {
          const logout = document.getElementById("ddLogout");
          return logout && getComputedStyle(logout).display !== "none";
        },
      );
      await authedPage.evaluate(() => navigate("team"));
      await authedPage.waitForFunction(
        () => document.getElementById("page-team")?.classList.contains("active"),
      );
      const teamWorkspaceName = await authedPage.$eval(
        "#teamWorkspaceName",
        (el) => el.textContent.trim(),
      );
      assert.match(teamWorkspaceName, /Workspace/);
      const teamSeatCount = await authedPage.$eval(
        "#teamSeatCount",
        (el) => el.textContent.trim(),
      );
      assert.match(teamSeatCount, /^\d+\/\d+$/);
      await authedPage.evaluate(() => navigate("create"));
      await authedPage.waitForSelector("#createFormArea_url");
      await authedPage.$eval("#createFormArea_url", (el, value) => {
        el.value = value;
      }, "https://s.shopee.vn/4Axe4JRRDO");
      await authedPage.$eval("#createFormArea_url", (el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });

      await Promise.all([
        authedPage.waitForFunction(
          () => document.getElementById("createFormArea_err")?.classList.contains("show"),
        ),
        authedPage.click("#createFormArea_btn"),
      ]);

      const authedAppPrompt = await authedPage.$eval(
        "#createFormArea_err",
        (el) => el.textContent,
      );
      assert.match(authedAppPrompt, /Pro/);

      await updateUserPlanForTest(userId, "pro");

      await authedPage.goto(`${baseUrl}/`, {
        waitUntil: "domcontentloaded",
      });
      await authedPage.waitForSelector('.hero-form input[name="url"]');
      await authedPage.$eval('input[name="url"]', (el, value) => {
        el.value = value;
      }, "https://s.shopee.vn/4Axe4JRRDO");
      await authedPage.$eval('input[name="url"]', (el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await Promise.all([
        authedPage.waitForFunction(
          () =>
            !document.getElementById("landingShortenResult").hidden &&
            document.getElementById("landingShortenStatus").textContent.includes(
              "Đã rút gọn",
            ),
        ),
        authedPage.click(".hero-form button[type=\"submit\"]"),
      ]);

      const landingGateHiddenAfterUpgrade = await authedPage.$eval(
        "#landingShortenGate",
        (el) => el.hidden,
      );
      assert.equal(landingGateHiddenAfterUpgrade, true);

      const authedProShorten = await shortenAsAuthedUser(authedPage, {
        url: "https://s.shopee.vn/4Axe4JRRDO",
      });
      assert.equal(authedProShorten.status, 200);
      assert.ok(authedProShorten.data.short_url);

      const shopeeShortUrl = authedProShorten.data.short_url;
      const shopeeOriginalUrl = authedProShorten.data.original_url;
      const shopeeShortCode = authedProShorten.data.short_code;
      const db = await getTestDb();
      const clickCountBeforeBot = (await db.getLinkByCode(shopeeShortCode)).clicks;

      const shopeeBotPage = await fetchText(shopeeShortUrl, {
        ua: FACEBOOK_BOT_UA,
      });
      assert.equal(shopeeBotPage.response.status, 200);
      assert.equal(
        shopeeBotPage.response.headers.get("x-rgl-redirect-mode"),
        "social-bot-og",
      );
      assert.equal(
        shopeeBotPage.response.headers.get("x-rgl-redirect-platform"),
        "bot",
      );
      assert.ok(shopeeBotPage.response.headers.get("x-request-id"));
      assert.match(
        shopeeBotPage.text,
        /al:ios:app_store_id" content="959841449"/,
      );
      assert.match(
        shopeeBotPage.text,
        /al:android:package" content="com\.shopee\.vn"/,
      );

      const clickCountAfterBot = (await db.getLinkByCode(shopeeShortCode)).clicks;
      assert.equal(clickCountAfterBot, clickCountBeforeBot);

      const facebookIosPage = await fetchText(shopeeShortUrl, {
        ua: FACEBOOK_IOS_UA,
      });
      assert.equal(facebookIosPage.response.status, 200);
      assert.equal(
        facebookIosPage.response.headers.get("x-rgl-redirect-mode"),
        "shopee-facebook-app-links",
      );
      assert.equal(
        facebookIosPage.response.headers.get("x-rgl-redirect-platform"),
        "shopee",
      );
      assert.ok(facebookIosPage.response.headers.get("x-request-id"));
      assert.match(
        facebookIosPage.text,
        /al:ios:app_store_id" content="959841449"/,
      );
      assert.match(
        facebookIosPage.text,
        /al:android:package" content="com\.shopee\.vn"/,
      );
      assert.match(
        facebookIosPage.text,
        new RegExp(
          `al:web:url" content="${shopeeOriginalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
      assert.ok(
        !facebookIosPage.text.includes("window.location"),
        "Facebook iOS Shopee page should not force an immediate JS redirect",
      );

      const facebookAndroidPage = await fetchText(shopeeShortUrl, {
        ua: FACEBOOK_ANDROID_UA,
      });
      assert.equal(facebookAndroidPage.response.status, 200);
      assert.equal(
        facebookAndroidPage.response.headers.get("x-rgl-redirect-mode"),
        "shopee-facebook-app-links",
      );
      assert.equal(
        facebookAndroidPage.response.headers.get("x-rgl-redirect-platform"),
        "shopee",
      );
      assert.ok(facebookAndroidPage.response.headers.get("x-request-id"));
      assert.match(
        facebookAndroidPage.text,
        /al:ios:app_store_id" content="959841449"/,
      );
      assert.match(
        facebookAndroidPage.text,
        /al:android:package" content="com\.shopee\.vn"/,
      );
      assert.match(
        facebookAndroidPage.text,
        new RegExp(
          `al:web:url" content="${shopeeOriginalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
        ),
      );
      assert.ok(
        !facebookAndroidPage.text.includes("window.location"),
        "Facebook Android Shopee page should not force an immediate JS redirect",
      );

      const mobileShopeeRedirect = await fetchText(shopeeShortUrl, {
        ua: MOBILE_IOS_UA,
      });
      assert.equal(mobileShopeeRedirect.response.status, 301);
      assert.equal(
        mobileShopeeRedirect.response.headers.get("x-rgl-redirect-mode"),
        "shopee-middle-redirect",
      );
      assert.equal(
        mobileShopeeRedirect.response.headers.get("x-rgl-redirect-platform"),
        "shopee",
      );
      assert.ok(mobileShopeeRedirect.response.headers.get("x-request-id"));
      assert.match(
        mobileShopeeRedirect.response.headers.get("location") || "",
        /^https:\/\/new-express\.xyz\/go\?u=/,
      );

      const desktopShopeeRedirect = await fetchText(shopeeShortUrl, {
        ua: DESKTOP_UA,
      });
      assert.equal(desktopShopeeRedirect.response.status, 302);
      assert.equal(
        desktopShopeeRedirect.response.headers.get("x-rgl-redirect-mode"),
        "desktop-redirect",
      );
      assert.equal(
        desktopShopeeRedirect.response.headers.get("x-rgl-redirect-platform"),
        "shopee",
      );
      assert.ok(desktopShopeeRedirect.response.headers.get("x-request-id"));
      assert.equal(
        desktopShopeeRedirect.response.headers.get("location"),
        shopeeOriginalUrl,
      );

      const redirectLogs = getLogs();
      assert.match(redirectLogs, /"mode":"social-bot-og"/);
      assert.match(redirectLogs, /"mode":"shopee-facebook-app-links"/);
      assert.match(redirectLogs, /"mode":"shopee-middle-redirect"/);
      assert.match(redirectLogs, /"mode":"desktop-redirect"/);

      await grantAdminForTest(userId);
      await authedPage.goto(`${baseUrl}/admin`, {
        waitUntil: "domcontentloaded",
      });
      await authedPage.waitForSelector("#adRedirectBody");
      await authedPage.waitForFunction(
        () => !document.querySelector("#adRedirectBody .tbl-empty"),
      );
      const adminRedirectCount = await authedPage.$eval(
        "#adRedirectCount",
        (el) => Number(el.textContent.trim()),
      );
      assert.ok(adminRedirectCount > 0);
      const adminRedirectFile = await authedPage.$eval(
        "#adRedirectLogFile",
        (el) => el.textContent.trim(),
      );
      assert.equal(adminRedirectFile, "logs/redirect.log");
      const adminRedirectText = await authedPage.$eval(
        "#adRedirectBody",
        (el) => el.textContent,
      );
      assert.match(adminRedirectText, /shopee-facebook-app-links/);
      assert.match(adminRedirectText, /desktop-redirect/);

      await authedPage.goto(`${baseUrl}/create`, {
        waitUntil: "domcontentloaded",
      });
      await authedPage.waitForSelector("#createFormArea_url");
      await authedPage.$eval("#createFormArea_url", (el, value) => {
        el.value = value;
      }, "https://s.shopee.vn/4Axe4JRRDO");
      await authedPage.$eval("#createFormArea_url", (el) => {
        el.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await Promise.all([
        authedPage.waitForFunction(
          () => document.getElementById("createFormArea_res")?.classList.contains("show"),
        ),
        authedPage.click("#createFormArea_btn"),
      ]);

      const createdUrl = await authedPage.$eval(
        "#createFormArea_resurl",
        (el) => el.textContent.trim(),
      );
      assert.match(createdUrl, /^https?:\/\//);
    } finally {
      await authedPage.close().catch(() => {});
    }

    console.log("Puppeteer smoke tests passed.");
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : error);
    const logs = getLogs().trim();
    if (logs) {
      console.error("\n--- server logs ---");
      console.error(logs);
    }
    process.exitCode = 1;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    server.kill("SIGTERM");
    await delay(500);
    if (!server.killed) {
      server.kill("SIGKILL");
    }
  }
}

await main();
