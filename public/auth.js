(() => {
  const root = document.getElementById("authPage");
  if (!root) return;

  const mode = root.dataset.authMode === "register" ? "register" : "login";
  const supabaseUrl = (root.dataset.supabaseUrl || "").trim();
  const supabaseAnonKey = (root.dataset.supabaseAnonKey || "").trim();
  const form = document.getElementById("authForm");
  const errEl = document.getElementById("authErr");
  const oauthButton = document.getElementById("oauthButton");
  const oauthButtonLabel = document.getElementById("oauthButtonLabel");
  const oauthHint = document.getElementById("oauthHint");
  const submitBtn = form?.querySelector(".auth-submit");
  const endpoint = mode === "register" ? "/api/auth/register" : "/api/auth/login";

  let supabaseClientPromise = null;
  let authRedirecting = false;
  let pendingTwoFactor = null;

  const ensureLoadingOverlay = () => {
    let overlay = document.getElementById("authLoadingOverlay");
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "authLoadingOverlay";
    overlay.className = "auth-loading-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="auth-loading-card" role="status" aria-live="polite">
        <div class="auth-loading-logo-shell" aria-hidden="true">
          <img class="auth-loading-logo" src="/favicon.svg?v=2" alt="" />
        </div>
        <div class="auth-loading-copy">
          <small class="auth-loading-kicker" id="authLoadingKicker">BocLink</small>
          <strong id="authLoadingTitle">Đang khởi động trung tâm quản trị</strong>
          <span id="authLoadingSubtitle">Đang đồng bộ phiên đăng nhập và nạp dữ liệu cần thiết.</span>
        </div>
        <div class="auth-loading-progress" aria-hidden="true">
          <div class="auth-loading-progress-track">
            <div class="auth-loading-progress-bar"></div>
          </div>
          <div class="auth-loading-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  };

  const setAuthLoading = (visible, options = {}) => {
    const overlay = ensureLoadingOverlay();
    const kickerEl = document.getElementById("authLoadingKicker");
    const titleEl = document.getElementById("authLoadingTitle");
    const subtitleEl = document.getElementById("authLoadingSubtitle");
    if (kickerEl) kickerEl.textContent = options.kicker || "BocLink";
    if (titleEl) {
      titleEl.textContent =
        options.title ||
        (mode === "register"
          ? "Đang tạo workspace đầu tiên"
          : "Đang khởi động trung tâm quản trị");
    }
    if (subtitleEl) {
      subtitleEl.textContent =
        options.subtitle ||
        "Đang đồng bộ phiên đăng nhập, khôi phục trang tiếp theo và nạp dữ liệu cần thiết.";
    }
    overlay.hidden = !visible;
    document.body.classList.toggle("auth-loading-active", visible);
  };

  const setError = (message) => {
    if (!errEl) return;
    if (!message) {
      errEl.textContent = "";
      errEl.classList.remove("show");
      return;
    }
    errEl.textContent = message;
    errEl.classList.add("show");
  };

  const showOauthHint = (message) => {
    if (!oauthHint) return;
    oauthHint.hidden = false;
    oauthHint.textContent = message;
  };

  const hideOauthHint = () => {
    if (!oauthHint) return;
    oauthHint.hidden = true;
    oauthHint.textContent = "";
  };

  const setBusy = (busy) => {
    if (submitBtn) submitBtn.disabled = busy;
    if (oauthButton) oauthButton.disabled = busy;
    form?.querySelectorAll("input").forEach((input) => {
      input.disabled = busy;
    });
  };

  const ensureTwoFactorUi = () => {
    if (mode !== "login" || !form || !submitBtn) return null;
    let wrap = document.getElementById("authTwoFactorWrap");
    let back = document.getElementById("authTwoFactorBack");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "authTwoFactorWrap";
      wrap.className = "auth-2fa-wrap";
      wrap.hidden = true;
      wrap.innerHTML = `
        <div class="auth-field">
          <label class="auth-label" for="authTwoFactorCode">Mã xác minh 2 lớp</label>
          <input
            type="text"
            id="authTwoFactorCode"
            class="auth-input"
            inputmode="numeric"
            maxlength="6"
            placeholder="Nhập mã 6 số"
            autocomplete="one-time-code"
          />
        </div>
        <div class="auth-2fa-copy" id="authTwoFactorCopy"></div>`;
      submitBtn.before(wrap);
      back = document.createElement("button");
      back.type = "button";
      back.id = "authTwoFactorBack";
      back.className = "auth-link-button";
      back.hidden = true;
      back.textContent = "Dùng tài khoản khác";
      submitBtn.after(back);
      back.addEventListener("click", () => {
        pendingTwoFactor = null;
        updateTwoFactorUi();
      });
    }
    return {
      wrap,
      input: document.getElementById("authTwoFactorCode"),
      copy: document.getElementById("authTwoFactorCopy"),
      back,
    };
  };

  const updateTwoFactorUi = () => {
    if (mode !== "login" || !form) return;
    const ui = ensureTwoFactorUi();
    if (!ui) return;
    const emailField = document.getElementById("loginEmail")?.closest(".auth-field");
    const passwordField = document.getElementById("loginPass")?.closest(".auth-field");
    const oauthSection = document.querySelector(".auth-oauth");
    const divider = document.querySelector(".auth-divider");
    const authFoot = document.querySelector(".auth-foot");
    const authCardTop = document.querySelector(".auth-card-top");
    const active = !!pendingTwoFactor;
    if (emailField) emailField.hidden = active;
    if (passwordField) passwordField.hidden = active;
    if (oauthSection) oauthSection.hidden = active;
    if (divider) divider.hidden = active;
    if (authFoot) authFoot.hidden = active;
    ui.wrap.hidden = !active;
    ui.back.hidden = !active;
    if (authCardTop) {
      const titleEl = authCardTop.querySelector("h2");
      const copyEl = authCardTop.querySelector("p");
      if (titleEl) {
        titleEl.textContent = active ? "Xác thực 2 lớp" : "Đăng nhập";
      }
      if (copyEl) {
        copyEl.textContent = active
          ? `Nhập mã OTP đang hiển thị trong ứng dụng xác thực cho ${pendingTwoFactor?.email || "tài khoản của bạn"}.`
          : "Vào lại bảng điều khiển để tiếp tục theo dõi link, QR và bio.";
      }
    }
    if (submitBtn) {
      submitBtn.textContent = active ? "Xác minh và đăng nhập" : "Đăng nhập";
    }
    if (ui.copy) {
      ui.copy.textContent = active
        ? "Bạn vừa hoàn tất bước đăng nhập đầu tiên. Chỉ còn mã 6 số từ ứng dụng OTP."
        : "";
    }
    if (!active && ui.input) {
      ui.input.value = "";
    }
  };

  const beginTwoFactorStep = (payload) => {
    pendingTwoFactor = {
      token: payload.challenge_token,
      email: payload.user?.email || "",
    };
    setError("");
    setBusy(false);
    setAuthLoading(false);
    updateTwoFactorUi();
    document.getElementById("authTwoFactorCode")?.focus();
  };

  const getSafeNextTarget = () => {
    const url = new URL(window.location.href);
    const rawNext = url.searchParams.get("next") || "/dashboard";
    try {
      const target = new URL(rawNext, window.location.origin);
      if (target.origin !== window.location.origin) return "/dashboard";
      if (
        target.pathname === "/" ||
        /^\/(?:user\/)?(login|register)\/?$/.test(target.pathname)
      ) {
        return "/dashboard";
      }
      target.searchParams.delete("next");
      target.searchParams.delete("code");
      target.searchParams.delete("error");
      target.searchParams.delete("error_description");
      target.searchParams.delete("state");
      const path = `${target.pathname}${target.search}${target.hash}`;
      return path || "/dashboard";
    } catch {
      return "/dashboard";
    }
  };

  const resolvePostLoginTarget = (user) => {
    const target = getSafeNextTarget();
    const isAdmin = user?.role === "admin" || user?.plan === "admin";
    if (target === "/admin" || target.startsWith("/admin?") || target.startsWith("/admin#")) {
      return isAdmin ? target : "/dashboard";
    }
    return target;
  };

  const syncPointer = (event) => {
    const rect = root.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    root.style.setProperty("--auth-mx", x.toFixed(3));
    root.style.setProperty("--auth-my", y.toFixed(3));
  };

  const resetPointer = () => {
    root.style.setProperty("--auth-mx", "0");
    root.style.setProperty("--auth-my", "0");
  };

  const readFormPayload = () => {
    const payload = {
      email: document.getElementById(mode === "register" ? "regEmail" : "loginEmail")
        ?.value.trim(),
      password: document.getElementById(mode === "register" ? "regPass" : "loginPass")
        ?.value,
    };
    if (mode === "register") {
      payload.name = document.getElementById("regName")?.value.trim() || "";
    }
    return payload;
  };

  const submitAuth = async (payload) => {
    authRedirecting = false;
    setBusy(true);
    setError("");
    setAuthLoading(true, {
      title:
        mode === "register"
          ? "Đang tạo workspace đầu tiên"
          : "Đang khởi động trung tâm quản trị",
      subtitle:
        mode === "register"
          ? "Đang tạo tài khoản, đồng bộ phiên đăng nhập và chuẩn bị bảng điều khiển của bạn."
          : "Đang xác thực đăng nhập, khôi phục phiên gần nhất và tải dữ liệu cần thiết.",
    });
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || (mode === "register" ? "Lỗi đăng ký" : "Lỗi đăng nhập"));
        return;
      }
      if (data.twoFactorRequired) {
        beginTwoFactorStep(data);
        return;
      }
      authRedirecting = true;
      location.replace(resolvePostLoginTarget(data.user));
    } catch {
      setError("Lỗi kết nối");
    } finally {
      if (!authRedirecting) {
        setBusy(false);
        setAuthLoading(false);
      }
    }
  };

  const getRedirectUrl = () => {
    const url = new URL(window.location.href);
    const redirect = new URL(url.pathname, window.location.origin);
    const next = url.searchParams.get("next");
    if (next) {
      redirect.searchParams.set("next", next);
    }
    return redirect.toString();
  };

  const getCleanOAuthReturnPath = () => {
    const clean = new URL(window.location.href);
    clean.searchParams.delete("code");
    clean.searchParams.delete("error");
    clean.searchParams.delete("error_description");
    clean.searchParams.delete("state");
    const next = clean.searchParams.get("next");
    const nextUrl = new URL(clean.pathname, window.location.origin);
    if (next) {
      nextUrl.searchParams.set("next", next);
    }
    return `${nextUrl.pathname}${nextUrl.search}`;
  };

  const loadSupabaseClient = async () => {
    if (!supabaseUrl || !supabaseAnonKey) return null;
    if (!supabaseClientPromise) {
      supabaseClientPromise = import(
        "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm"
      )
        .then(({ createClient }) => createClient(supabaseUrl, supabaseAnonKey))
        .catch((error) => {
          supabaseClientPromise = null;
          throw error;
        });
    }
    return supabaseClientPromise;
  };

  const postSupabaseSession = async (accessToken) => {
    const response = await fetch("/api/auth/supabase", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_token: accessToken }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Đăng nhập bằng Supabase thất bại");
    }
    if (data.twoFactorRequired) {
      beginTwoFactorStep(data);
      return;
    }
    authRedirecting = true;
    location.replace(resolvePostLoginTarget(data.user));
  };

  const submitTwoFactorCode = async () => {
    const code = document.getElementById("authTwoFactorCode")?.value.trim() || "";
    if (!pendingTwoFactor?.token) {
      setError("Phiên xác minh 2FA không còn hợp lệ. Vui lòng đăng nhập lại.");
      pendingTwoFactor = null;
      updateTwoFactorUi();
      return;
    }
    if (!/^\d{6}$/.test(code)) {
      setError("Nhập mã OTP gồm 6 chữ số.");
      return;
    }
    authRedirecting = false;
    setBusy(true);
    setError("");
    setAuthLoading(true, {
      title: "Đang xác minh 2 lớp",
      subtitle: "BocLink đang kiểm tra mã OTP trước khi mở lại bảng điều khiển của bạn.",
    });
    try {
      const response = await fetch("/api/auth/2fa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: pendingTwoFactor.token,
          code,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "Mã xác minh chưa đúng");
        return;
      }
      authRedirecting = true;
      location.replace(resolvePostLoginTarget(data.user));
    } catch {
      setError("Lỗi kết nối");
    } finally {
      if (!authRedirecting) {
        setBusy(false);
        setAuthLoading(false);
      }
    }
  };

  const handleOAuthCallback = async (supabase) => {
    const url = new URL(window.location.href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
    const code = url.searchParams.get("code");
    const hashAccessToken = hashParams.get("access_token");
    const oauthError =
      url.searchParams.get("error_description") ||
      url.searchParams.get("error") ||
      hashParams.get("error_description") ||
      hashParams.get("error");
    if (oauthError) {
      setError(oauthError);
      window.history.replaceState({}, document.title, getCleanOAuthReturnPath());
      return false;
    }
    if (!code && !hashAccessToken) return false;

    authRedirecting = false;
    setBusy(true);
    setError("");
    setAuthLoading(true, {
      title: "Đang hoàn tất đăng nhập Google",
      subtitle: "Đang xác minh phiên Supabase và nối bạn vào workspace hiện tại.",
    });
    try {
      if (hashAccessToken) {
        await postSupabaseSession(hashAccessToken);
        return true;
      }
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        throw error;
      }
      const accessToken = data?.session?.access_token;
      if (!accessToken) {
        throw new Error("Không nhận được session từ Supabase");
      }
      await postSupabaseSession(accessToken);
      return true;
    } catch (error) {
      setError(error?.message || "Đăng nhập Google thất bại");
      return false;
    } finally {
      if (!authRedirecting) {
        setBusy(false);
        setAuthLoading(false);
      }
      window.history.replaceState({}, document.title, getCleanOAuthReturnPath());
    }
  };

  const initSupabaseOAuth = async () => {
    if (!oauthButton || !oauthButtonLabel || !oauthHint) return;

    if (!supabaseUrl || !supabaseAnonKey) {
      oauthButton.disabled = true;
      oauthButtonLabel.textContent = "Google / Gmail chưa cấu hình";
      showOauthHint("Thêm SUPABASE_ANON_KEY vào .env để bật đăng nhập Google qua Supabase.");
      return;
    }

    let supabase;
    try {
      supabase = await loadSupabaseClient();
    } catch {
      oauthButton.disabled = true;
      oauthButtonLabel.textContent = "Google / Gmail chưa sẵn sàng";
      showOauthHint("Không tải được SDK Supabase từ CDN.");
      return;
    }

    if (!supabase) {
      oauthButton.disabled = true;
      oauthButtonLabel.textContent = "Google / Gmail chưa sẵn sàng";
      showOauthHint("Đăng nhập Google qua Supabase chưa được bật.");
      return;
    }

    hideOauthHint();
    await handleOAuthCallback(supabase);

    oauthButton.addEventListener("click", async () => {
      authRedirecting = false;
      setBusy(true);
      setError("");
      setAuthLoading(true, {
        title: "Đang kết nối Google",
        subtitle: "Trình duyệt sắp chuyển sang Google để bạn xác nhận đăng nhập.",
      });
      try {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: getRedirectUrl(),
          },
        });
        if (error) {
          throw error;
        }
      } catch (error) {
        setBusy(false);
        setAuthLoading(false);
        setError(error?.message || "Không thể mở Google");
      }
    });
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    if (pendingTwoFactor) {
      await submitTwoFactorCode();
      return;
    }
    const payload = readFormPayload();
    if (!payload.email || !payload.password) {
      setError("Vui lòng nhập đầy đủ");
      return;
    }
    if (mode === "register" && !payload.name) {
      setError("Vui lòng nhập họ tên");
      return;
    }
    await submitAuth(payload);
  });

  root.addEventListener("pointermove", syncPointer);
  root.addEventListener("pointerleave", resetPointer);
  root.addEventListener("blur", resetPointer, true);

  ensureLoadingOverlay();
  updateTwoFactorUi();
  void initSupabaseOAuth();
})();
