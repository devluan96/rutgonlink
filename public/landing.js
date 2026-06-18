(() => {
  const shared = window.RGLShared || {};
  const buildAuthUrl =
    shared.buildAuthUrl ||
    ((mode = "login") => (mode === "register" ? "/register" : "/login"));
  const getUserDisplayName =
    shared.getUserDisplayName ||
    ((user) => user?.name || user?.email?.split("@")[0] || "User");
  const getUserInitials =
    shared.getUserInitials ||
    ((user) => (user?.name || user?.email || "U").charAt(0).toUpperCase());
  const isAffiliateShortenUrl =
    shared.isAffiliateShortenUrl || (() => false);

  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  const themeStorageKey = "rutgonlink-theme";
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const themeToggle = document.getElementById("landingThemeToggle");
  const themeIcon = document.getElementById("landingThemeIcon");

  const applyTheme = (theme) => {
    const nextTheme = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = nextTheme;
    try {
      localStorage.setItem(themeStorageKey, nextTheme);
    } catch {}
    if (themeMeta) {
      themeMeta.setAttribute(
        "content",
        nextTheme === "dark" ? "#0f172a" : "#3b82f6",
      );
    }
    if (themeIcon) {
      themeIcon.innerHTML =
        nextTheme === "light"
          ? '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"></path>'
          : '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>';
    }
    if (themeToggle) {
      const label =
        nextTheme === "light"
          ? "Chuyển sang chế độ tối"
          : "Chuyển sang chế độ sáng";
      themeToggle.setAttribute("aria-label", label);
      themeToggle.setAttribute("title", label);
    }
  };

  applyTheme(document.documentElement.dataset.theme || "light");

  themeToggle?.addEventListener("click", () => {
    applyTheme(
      document.documentElement.dataset.theme === "dark" ? "light" : "dark",
    );
  });

  const landingShortenForm = document.querySelector(".hero-form");
  const landingShortenInput = landingShortenForm?.querySelector(
    'input[name="url"]',
  );
  const landingShortenResult = document.getElementById("landingShortenResult");
  const landingShortenUrl = document.getElementById("landingShortenUrl");
  const landingShortenCopy = document.getElementById("landingShortenCopy");
  const landingShortenStatus = document.getElementById("landingShortenStatus");
  const landingShortenGate = document.getElementById("landingShortenGate");
  const landingShortenConfirm = document.getElementById(
    "landingShortenConfirm",
  );
  const landingShortenLogin = document.getElementById("landingShortenLogin");
  const landingShortenRegister = document.getElementById(
    "landingShortenRegister",
  );
  const landingLoginBtn = document.getElementById("landingLoginBtn");
  const landingRegisterBtn = document.getElementById("landingRegisterBtn");
  const landingAuthGuest = document.getElementById("landingAuthGuest");
  const landingAuthUserShell = document.getElementById("landingAuthUser");
  const landingAuthAvatar = document.getElementById("landingAuthAvatar");
  const landingAuthName = document.getElementById("landingAuthName");
  let landingAuthState = null;
  let landingAuthLoaded = false;
  let landingAuthPromise = null;
  let landingShortenBusy = false;

  const setLandingAuthLinks = () => {
    if (landingLoginBtn) landingLoginBtn.href = buildAuthUrl("login");
    if (landingRegisterBtn) landingRegisterBtn.href = buildAuthUrl("register");
    if (landingShortenLogin) landingShortenLogin.href = buildAuthUrl("login");
    if (landingShortenRegister) {
      landingShortenRegister.href = buildAuthUrl("register");
    }
  };

  const renderLandingAuthNav = (authUser) => {
    const signedIn = !!authUser;
    if (landingAuthGuest) landingAuthGuest.hidden = signedIn;
    if (landingAuthUserShell) landingAuthUserShell.hidden = !signedIn;
    if (signedIn) {
      if (landingAuthAvatar) {
        landingAuthAvatar.textContent = getUserInitials(authUser);
      }
      if (landingAuthName) {
        landingAuthName.textContent = getUserDisplayName(authUser);
      }
    }
  };

  const loadLandingAuthState = async () => {
    if (landingAuthLoaded) return landingAuthState;
    if (!landingAuthPromise) {
      landingAuthPromise = fetch("/api/auth/me")
        .then((response) => response.json().catch(() => ({})))
        .then((data) => {
          landingAuthState = data?.user || null;
          landingAuthLoaded = true;
          return landingAuthState;
        })
        .catch(() => {
          landingAuthState = null;
          landingAuthLoaded = true;
          return null;
        });
    }
    return landingAuthPromise;
  };

  const showLandingShortenGate = (message, mode = "guest") => {
    if (!landingShortenResult || !landingShortenUrl || !landingShortenStatus) {
      return;
    }
    landingShortenResult.hidden = false;
    landingShortenUrl.textContent =
      message || "Link affiliate cần xác nhận trước khi rút gọn.";
    landingShortenUrl.href = mode === "guest" ? buildAuthUrl("login") : "#";
    landingShortenUrl.removeAttribute("target");
    landingShortenUrl.removeAttribute("rel");
    if (landingShortenCopy) landingShortenCopy.hidden = true;
    if (landingShortenGate) landingShortenGate.hidden = false;
    if (landingShortenConfirm) {
      landingShortenConfirm.hidden = mode === "guest";
      landingShortenConfirm.textContent =
        mode === "upgrade" ? "Xem gói Pro" : "Tôi hiểu, tiếp tục";
      landingShortenConfirm.dataset.mode = mode;
    }
    if (landingShortenLogin) {
      landingShortenLogin.hidden = mode !== "guest";
      landingShortenLogin.href = buildAuthUrl("login");
    }
    if (landingShortenRegister) {
      landingShortenRegister.hidden = mode !== "guest";
      landingShortenRegister.href = buildAuthUrl("register");
    }
    landingShortenStatus.textContent =
      mode === "upgrade"
        ? "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn."
        : mode === "confirm"
        ? "Bạn đã đăng nhập. Hãy xác nhận để tiếp tục rút gọn link affiliate."
        : "Để rút gọn link affiliate, bạn cần đăng nhập hoặc đăng ký.";
  };

  const hideLandingShortenGate = () => {
    if (landingShortenGate) landingShortenGate.hidden = true;
    if (landingShortenConfirm) landingShortenConfirm.hidden = true;
    if (landingShortenCopy) landingShortenCopy.hidden = false;
  };

  const showLandingShortenResult = (shortUrl, originalUrl) => {
    if (!landingShortenResult || !landingShortenUrl) return;
    landingShortenResult.hidden = false;
    hideLandingShortenGate();
    landingShortenUrl.textContent = shortUrl;
    landingShortenUrl.href = shortUrl;
    landingShortenUrl.target = "_blank";
    landingShortenUrl.rel = "noreferrer";
    if (landingShortenStatus) {
      landingShortenStatus.textContent =
        originalUrl && originalUrl !== shortUrl
          ? `Đã rút gọn từ ${originalUrl}`
          : "Đã tạo link ngắn thành công.";
    }
  };

  landingShortenCopy?.addEventListener("click", async () => {
    const url = landingShortenUrl?.href;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      if (landingShortenStatus) {
        landingShortenStatus.textContent = "Đã sao chép link ngắn.";
      }
    } catch {
      if (landingShortenStatus) {
        landingShortenStatus.textContent =
          "Không thể sao chép tự động, bạn có thể chọn link phía trên.";
      }
    }
  });

  const submitLandingShorten = async ({ confirmAffiliate = false } = {}) => {
    if (landingShortenBusy) return;
    const url = landingShortenInput?.value.trim() || "";
    if (!url) {
      if (landingShortenStatus) {
        landingShortenStatus.textContent = "Dán URL dài trước khi rút gọn.";
      }
      landingShortenInput?.focus();
      return;
    }

    const isAffiliate = isAffiliateShortenUrl(url);
    const authUser = isAffiliate ? await loadLandingAuthState() : null;
    const userPlan = authUser?.plan || "free";
    const hasAffiliateAccess =
      userPlan === "pro" ||
      userPlan === "business" ||
      userPlan === "admin" ||
      authUser?.role === "admin";
    if (isAffiliate && !authUser) {
      showLandingShortenGate(
        "Link affiliate cần đăng nhập hoặc đăng ký trước khi rút gọn.",
        "guest",
      );
      return;
    }
    if (isAffiliate && authUser && !hasAffiliateAccess) {
      showLandingShortenGate(
        "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn.",
        "upgrade",
      );
      return;
    }
    if (isAffiliate && authUser && !confirmAffiliate && !hasAffiliateAccess) {
      showLandingShortenGate(
        "Link affiliate cần xác nhận trước khi rút gọn.",
        "confirm",
      );
      return;
    }

    landingShortenBusy = true;
    const submitBtn = landingShortenForm?.querySelector('button[type="submit"]');
    const originalLabel = submitBtn?.textContent || "Rút gọn";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Đang xử lý...";
    }
    if (landingShortenStatus) {
      landingShortenStatus.textContent = "Đang tạo link ngắn...";
    }

    try {
      const response = await fetch("/api/shorten", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          confirm_affiliate: confirmAffiliate && isAffiliate,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && data.authRequired) {
          showLandingShortenGate(data.error, "guest");
          return;
        }
        if (response.status === 403 && data.affiliateUpgradeRequired) {
          showLandingShortenGate(data.error, "upgrade");
          return;
        }
        if (response.status === 428 && data.confirmationRequired) {
          showLandingShortenGate(data.error, "confirm");
          return;
        }
        if (landingShortenStatus) {
          landingShortenStatus.textContent =
            data.error || "Không thể rút gọn link.";
        }
        return;
      }
      showLandingShortenResult(data.short_url || "", url);
    } catch {
      if (landingShortenStatus) {
        landingShortenStatus.textContent =
          "Lỗi kết nối, vui lòng thử lại.";
      }
    } finally {
      landingShortenBusy = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    }
  };

  landingShortenConfirm?.addEventListener("click", async () => {
    if (landingShortenConfirm?.dataset.mode === "upgrade") {
      location.href = "/pricing";
      return;
    }
    await submitLandingShorten({ confirmAffiliate: true });
  });

  landingShortenForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitLandingShorten();
  });

  const startTypingLoop = (target, words, options = {}) => {
    if (!target || !Array.isArray(words) || !words.length) return;
    if (reduceMotion || words.length === 1) {
      if ("value" in target) {
        target.value = words[0];
      } else {
        target.textContent = words[0];
      }
      return;
    }

    const {
      startDelay = 400,
      typeDelay = 90,
      deleteDelay = 54,
      holdDelay = 1200,
      resetDelay = 900,
    } = options;

    let wordIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer = null;

    const tick = () => {
      const word = words[wordIndex];
      const isField = "value" in target;

      if (!deleting) {
        charIndex += 1;
        if (isField) {
          target.value = word.slice(0, charIndex);
        } else {
          target.textContent = word.slice(0, charIndex);
        }
        if (charIndex === word.length) {
          deleting = true;
          timer = setTimeout(tick, holdDelay);
          return;
        }
      } else {
        charIndex -= 1;
        if (isField) {
          target.value = word.slice(0, charIndex);
        } else {
          target.textContent = word.slice(0, charIndex);
        }
        if (charIndex === 0) {
          deleting = false;
          wordIndex = (wordIndex + 1) % words.length;
          timer = setTimeout(tick, resetDelay);
          return;
        }
      }

      timer = setTimeout(tick, deleting ? deleteDelay : typeDelay);
    };

    if ("value" in target) {
      target.value = "";
    } else {
      target.textContent = "";
    }
    timer = setTimeout(tick, startDelay);
    return () => {
      if (timer) clearTimeout(timer);
    };
  };

  const typedTarget = document.getElementById("typed-word");
  const urlTarget = document.getElementById("hero-url-suffix");
  const boclinkUrlTarget = document.getElementById("boclink-url-suffix");
  const insightUrlTarget = document.getElementById("insight-url-input");

  startTypingLoop(typedTarget, ["Liên kết.", "Mã QR.", "Trang tiểu sử."], {
    startDelay: 250,
    holdDelay: 1250,
    resetDelay: 1000,
  });

  startTypingLoop(urlTarget, ["short", "profile", "bio"], {
    startDelay: 480,
    holdDelay: 900,
    resetDelay: 700,
    typeDelay: 78,
    deleteDelay: 42,
  });

  startTypingLoop(boclinkUrlTarget, ["profile", "store", "bio"], {
    startDelay: 350,
    holdDelay: 1100,
    resetDelay: 800,
    typeDelay: 82,
    deleteDelay: 44,
  });

  startTypingLoop(
    insightUrlTarget,
    [
      "https://boclink.click/page",
      "https://boclink.click/store",
      "https://boclink.click/bio",
    ],
    {
      startDelay: 420,
      holdDelay: 1200,
      resetDelay: 800,
      typeDelay: 52,
      deleteDelay: 24,
    },
  );

  if (typedTarget && reduceMotion) {
    typedTarget.textContent = "Liên kết.";
  }
  if (urlTarget && reduceMotion) {
    urlTarget.textContent = "short";
  }
  if (boclinkUrlTarget && reduceMotion) {
    boclinkUrlTarget.textContent = "profile";
  }
  if (insightUrlTarget && reduceMotion) {
    insightUrlTarget.value = "https://boclink.click/page";
  }

  const insightSection = document.querySelector(".insight-section");
  const appsSection = document.querySelector(".apps-section");
  const teamSection = document.querySelector(".team-section");
  const boclinkSection = document.querySelector(".boclink-section");
  const iconStripSection = document.querySelector(".icon-strip");
  if (boclinkSection && iconStripSection) {
    iconStripSection.insertAdjacentElement("beforebegin", boclinkSection);
  }
  if (insightSection && iconStripSection) {
    iconStripSection.insertAdjacentElement("afterend", insightSection);
  }
  if (appsSection && insightSection) {
    insightSection.insertAdjacentElement("afterend", appsSection);
  }
  if (teamSection && appsSection) {
    appsSection.insertAdjacentElement("afterend", teamSection);
  }

  const shell = document.getElementById("visual-shell");
  const stage = document.getElementById("visual-stage");

  if (shell && stage && !reduceMotion) {
    const reset = () => {
      stage.style.transform =
        "perspective(1900px) rotateY(-8deg) rotateX(3deg) rotateZ(-1deg)";
    };

    shell.addEventListener("mousemove", (event) => {
      const rect = shell.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      const ry = -8 - x * 4;
      const rx = 3 - y * 3;
      stage.style.transform = `perspective(1900px) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(-1deg) scale(1.03)`;
    });

    shell.addEventListener("mouseleave", reset);
    reset();
  }

  setLandingAuthLinks();
  renderLandingAuthNav(null);
  void loadLandingAuthState().then((authUser) => {
    renderLandingAuthNav(authUser);
  });
})();
