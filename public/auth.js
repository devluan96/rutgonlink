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

  const getSafeNextTarget = () => {
    const url = new URL(window.location.href);
    const rawNext = url.searchParams.get("next") || "/";
    try {
      const target = new URL(rawNext, window.location.origin);
      if (target.origin !== window.location.origin) return "/";
      if (/^\/(?:user\/)?(login|register)\/?$/.test(target.pathname)) return "/";
      const path = `${target.pathname}${target.search}${target.hash}`;
      return path || "/";
    } catch {
      return "/";
    }
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
    setBusy(true);
    setError("");
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
      location.replace(getSafeNextTarget());
    } catch {
      setError("Lỗi kết nối");
    } finally {
      setBusy(false);
    }
  };

  const getRedirectUrl = () => {
    const url = new URL(window.location.href);
    const redirect = new URL(url.pathname, window.location.origin);
    const next = url.searchParams.get("next");
    if (next) {
      redirect.searchParams.set("next", next);
    }
    return `${redirect.pathname}${redirect.search}${redirect.hash}`;
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
    location.replace(getSafeNextTarget());
  };

  const handleOAuthCallback = async (supabase) => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error_description") || url.searchParams.get("error");
    if (oauthError) {
      setError(oauthError);
      const clean = new URL(window.location.href);
      const next = clean.searchParams.get("next");
      const nextUrl = new URL(clean.pathname, window.location.origin);
      if (next) {
        nextUrl.searchParams.set("next", next);
      }
      window.history.replaceState(
        {},
        document.title,
        `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
      );
      return false;
    }
    if (!code) return false;

    setBusy(true);
    setError("");
    try {
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
      setBusy(false);
      const clean = new URL(window.location.href);
      const next = clean.searchParams.get("next");
      const nextUrl = new URL(clean.pathname, window.location.origin);
      if (next) {
        nextUrl.searchParams.set("next", next);
      }
      window.history.replaceState(
        {},
        document.title,
        `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
      );
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
      setBusy(true);
      setError("");
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
        setError(error?.message || "Không thể mở Google");
      }
    });
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
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

  void initSupabaseOAuth();
})();
