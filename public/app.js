      // ══════════════════════════════════════════════════
      //  STATE
      // ══════════════════════════════════════════════════
      const sharedClient = window.RGLShared || {};
      const getCurrentReturnPath =
        sharedClient.getCurrentReturnPath ||
        (() => `${location.pathname}${location.search}${location.hash}`);
      const buildAuthUrl =
        sharedClient.buildAuthUrl ||
        ((mode = "login") =>
          mode === "register" ? "/register" : "/login");
      const isAffiliateShortenUrl =
        sharedClient.isAffiliateShortenUrl || (() => false);
      const getUserDisplayName =
        sharedClient.getUserDisplayName ||
        ((currentUser) =>
          currentUser?.name || currentUser?.email?.split("@")[0] || "User");
      const getUserInitials =
        sharedClient.getUserInitials ||
        ((currentUser) =>
          (currentUser?.name || currentUser?.email || "U")
            .charAt(0)
            .toUpperCase());

      function stripVietnameseMarks(value) {
        return String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/đ/g, "d")
          .replace(/Đ/g, "D");
      }

      function slugifyAliasValue(value, maxLength = 40) {
        const compact = stripVietnameseMarks(value)
          .toLowerCase()
          .replace(/['"`’]/g, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        return compact.slice(0, maxLength).replace(/-+$/g, "");
      }

      function humanizeSlugTitle(value) {
        const normalized = String(value || "")
          .trim()
          .replace(/[-_]+/g, " ")
          .replace(/\s+/g, " ");
        if (!normalized) return "";
        return normalized.charAt(0).toUpperCase() + normalized.slice(1);
      }

      function looksLikeSlugTitle(value) {
        const raw = String(value || "").trim();
        return !!raw && !/\s/.test(raw) && /[-_]/.test(raw) && !raw.includes("://");
      }

      let user = null; // { id, email, name, plan }
      let links = [];
      let chart = null;
      let chartDays = 7;
      let statsAnalytics = null;
      let linkSearchQuery = "";
      let linkTypeFilter = "all";
      let currentFilteredLinks = [];
      let selectedLinkIds = new Set();
      let availableDomains = [];
      let availableDomainsPromise = null;
      let createDomainSelection = "";
      let qrRenderedText = "";
      let qrStyler = null;
      let bioConfig = null;
      let appTheme = localStorage.getItem("rutgonlink-theme") || "dark";
      const integrationStorageKey = "rutgonlink-integrations";
      const teamStorageKey = "rutgonlink-teamspace";
      let teamState = null;
      let landingNavOpen = false;
      let landingQuickUrl = "";
      let landingTypedTimer = null;
      let landingTypedStartTimer = null;
      let userMenuSection = "";
      let notificationItems = [];
      let unreadNotificationCount = 0;
      let notificationStatsSnapshot = null;
      let adminNotificationSnapshot = null;
      let notificationPollTimer = null;
      let confirmModalResolver = null;
      const notificationSeenStorageKey = "rutgonlink-notification-seen";
      let seenNotificationKeys = {};
      const KNOWN_APP_PAGES = new Set([
        "dashboard",
        "links",
        "create",
        "qr",
        "bio",
        "integrations",
        "team",
        "pricing",
        "stats",
        "admin",
      ]);

      function normalizeAppPage(page) {
        const raw = String(page || "").trim().replace(/^#/, "").replace(/^\/+/, "");
        return KNOWN_APP_PAGES.has(raw) ? raw : "dashboard";
      }

      function buildAppPath(page = "dashboard") {
        return `/${normalizeAppPage(page)}`;
      }

      function getAppPageFromLocation() {
        const pathname = location.pathname.replace(/\/+$/, "");
        const hashPage = String(location.hash || "").replace(/^#/, "").trim();
        if (pathname === "/index.html") {
          return normalizeAppPage(hashPage || "dashboard");
        }
        if (pathname === "/app") {
          return normalizeAppPage(hashPage || "dashboard");
        }
        if (pathname.startsWith("/app/")) {
          return normalizeAppPage(pathname.slice("/app/".length));
        }
        if (pathname === "") {
          return normalizeAppPage(hashPage || "dashboard");
        }
        if (pathname.startsWith("/")) {
          const directPage = pathname.slice(1);
          if (KNOWN_APP_PAGES.has(directPage)) {
            return directPage;
          }
        }
        return normalizeAppPage(hashPage || "dashboard");
      }

      function canonicalizeAppLocation() {
        const page = getAppPageFromLocation();
        const cleanUrl = `${buildAppPath(page)}${location.search}`;
        if (`${location.pathname}${location.search}` !== cleanUrl || location.hash) {
          window.history.replaceState({}, document.title, cleanUrl);
        }
        return page;
      }

      canonicalizeAppLocation();

      function normalizeDomainChoice(value) {
        return String(value || "")
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/\/.*$/, "")
          .replace(/\.+$/, "");
      }

      function syncAvailableDomains(domains = []) {
        const normalized = [];
        const seen = new Set();
        (Array.isArray(domains) ? domains : []).forEach((domain) => {
          const hostname = normalizeDomainChoice(domain?.hostname);
          if (!hostname || seen.has(hostname)) return;
          seen.add(hostname);
          normalized.push({
            ...domain,
            hostname,
            label: String(domain?.label || "").trim(),
            is_primary: domain?.is_primary === true,
            is_active: domain?.is_active !== false,
          });
        });
        availableDomains = normalized;
        const current = normalizeDomainChoice(createDomainSelection);
        if (current && availableDomains.some((domain) => domain.hostname === current)) {
          createDomainSelection = current;
          return availableDomains;
        }
        createDomainSelection = getDefaultCreateDomainHost();
        return availableDomains;
      }

      async function loadAvailableDomains({ force = false } = {}) {
        if (availableDomainsPromise && !force) return availableDomainsPromise;
        availableDomainsPromise = (async () => {
          try {
            const response = await fetch("/api/domains");
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
              throw new Error(data.error || "Không thể tải domain");
            }
            return syncAvailableDomains(data.domains || []);
          } catch (error) {
            console.error("loadAvailableDomains", error);
            if (!availableDomains.length) {
              syncAvailableDomains([]);
            }
            return availableDomains;
          }
        })();
        return availableDomainsPromise;
      }

      function getDefaultCreateDomainHost() {
        return normalizeDomainChoice(
          availableDomains.find((domain) => domain.is_primary)?.hostname ||
            availableDomains[0]?.hostname ||
            "",
        );
      }

      function getCreateDomainPreviewHost() {
        return (
          normalizeDomainChoice(createDomainSelection) ||
          getDefaultCreateDomainHost() ||
          window.location.host
        );
      }

      function formatDomainChoiceLabel(domain) {
        const hostname = normalizeDomainChoice(domain?.hostname);
        const label = String(domain?.label || "").trim();
        if (!hostname) return "";
        if (!label) return hostname;
        return `${hostname} - ${label}`;
      }

      function buildCreateDomainFieldMarkup(containerId) {
        if (!availableDomains.length) {
          return `
      <div>
        <label class="fl" style="margin-bottom:4px">Domain tạo link</label>
        <div class="domain-fallback">${window.location.host}</div>
        <div class="domain-picker-meta" id="${containerId}_domainmeta"></div>
      </div>`;
        }
        const selectedHost =
          normalizeDomainChoice(createDomainSelection) || getDefaultCreateDomainHost();
        return `
      <div>
        <label class="fl" style="margin-bottom:4px">Domain tạo link</label>
        <select class="fi" id="${containerId}_domain" onchange="onCreateDomainChange('${containerId}', this.value)">
          ${availableDomains
            .map(
              (domain) =>
                `<option value="${esc(domain.hostname)}"${domain.hostname === selectedHost ? " selected" : ""}>${esc(formatDomainChoiceLabel(domain))}</option>`,
            )
            .join("")}
        </select>
        <div class="domain-picker-meta" id="${containerId}_domainmeta"></div>
      </div>`;
      }

      function updateCreateDomainDisplay(cid) {
        const domainInput = document.getElementById(`${cid}_domain`);
        const prefixEl = document.getElementById(`${cid}_domainprefix`);
        const metaEl = document.getElementById(`${cid}_domainmeta`);
        const ogDomainEl = document.getElementById(`${cid}_ogdom`);
        const nextHost = normalizeDomainChoice(
          domainInput?.value || createDomainSelection || getDefaultCreateDomainHost(),
        );

        if (domainInput) {
          const hasOption = [...domainInput.options].some(
            (option) => normalizeDomainChoice(option.value) === nextHost,
          );
          if (hasOption && domainInput.value !== nextHost) {
            domainInput.value = nextHost;
          }
        }

        createDomainSelection = nextHost;
        const previewHost = getCreateDomainPreviewHost();
        const selectedDomain = availableDomains.find(
          (domain) => domain.hostname === normalizeDomainChoice(previewHost),
        );
        if (prefixEl) prefixEl.textContent = `${previewHost}/`;
        if (ogDomainEl) ogDomainEl.textContent = previewHost.toUpperCase();
        if (metaEl) {
          if (selectedDomain) {
            const metaBits = [];
            if (selectedDomain.label) metaBits.push(selectedDomain.label);
            if (selectedDomain.is_primary) metaBits.push("Primary");
            metaEl.textContent = metaBits.length
              ? `${previewHost} • ${metaBits.join(" • ")}`
              : `Link rút gọn sẽ dùng domain ${previewHost}`;
          } else {
            metaEl.textContent = `Link rút gọn sẽ dùng domain ${previewHost}`;
          }
        }
      }

      function onCreateDomainChange(cid, value) {
        createDomainSelection = normalizeDomainChoice(value);
        updateCreateDomainDisplay(cid);
        document.getElementById(`${cid}_res`)?.classList.remove("show");
      }

      function syncAvailableDomainsFromAdmin(domains = []) {
        syncAvailableDomains(
          (Array.isArray(domains) ? domains : []).filter(
            (domain) => domain?.is_active !== false,
          ),
        );
        availableDomainsPromise = Promise.resolve(availableDomains);
      }

      function finishShellBoot() {
        document.body?.classList.remove("app-shell-booting");
        if (document.body) {
          document.body.dataset.appReady = "true";
        }
        document.getElementById("appBootSplash")?.setAttribute("hidden", "");
      }

      function redirectToAuth(mode = "login", message = "") {
        if (message) toast(message, "warn");
        location.assign(buildAuthUrl(mode));
      }

      function isAdminUser() {
        return user?.plan === "admin" || user?.role === "admin";
      }

      function guardAdminRoute() {
        if (isAdminUser()) return "admin";
        if (!user) {
          redirectToAuth("login", "Cần đăng nhập để vào trang quản trị.");
          return null;
        }
        toast("Bạn không có quyền truy cập trang quản trị.", "warn");
        return "dashboard";
      }

      function normalizeBioSlug(input, fallback = "") {
        const raw = String(input || fallback || "")
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^-+|-+$/g, "");
        return raw || fallback || "user";
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

      function parseBioSourceState(source) {
        const raw = String(source || "").trim();
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
        return { mode: raw === "all" ? "all" : "recent", order: [] };
      }

      function getDefaultBioConfig() {
        const name = getUserDisplayName(user) || "DevLuan";
        return {
          slug: normalizeBioSlug(name, "user"),
          title: `${name} • Bio`,
          subtitle:
            "Trang tiểu sử gọn nhẹ để gom link quan trọng, giống kiểu BocLink.",
          avatar: (name || "D").charAt(0).toUpperCase(),
          accent: "#3b82f6",
          linkCount: "12",
          linkSource: "recent",
          linkOrder: [],
          isPublished: true,
        };
      }

      function loadBioConfig() {
        try {
          const raw = localStorage.getItem("rutgonlink-bio-config");
          if (raw) {
            const parsed = JSON.parse(raw);
            bioConfig = {
              ...getDefaultBioConfig(),
              ...parsed,
              linkOrder: normalizeBioLinkOrder(
                parsed.linkOrder || parsed.link_order || [],
              ),
            };
          } else {
            bioConfig = getDefaultBioConfig();
          }
        } catch {
          bioConfig = getDefaultBioConfig();
        }
        return bioConfig;
      }

      async function saveBioConfig() {
        const next = {
          slug: document.getElementById("bioSlugInput")?.value.trim() || "",
          title: document.getElementById("bioTitleInput")?.value.trim() || "",
          subtitle: document.getElementById("bioSubtitleInput")?.value.trim() || "",
          avatar: document.getElementById("bioAvatarInput")?.value.trim() || "",
          accent: document.getElementById("bioAccentInput")?.value || "#3b82f6",
          linkCount: document.getElementById("bioLinkCountInput")?.value || "12",
          linkSource: document.getElementById("bioLinkSourceInput")?.value || "recent",
          linkOrder: normalizeBioLinkOrder(bioConfig?.linkOrder),
        };
        bioConfig = { ...getDefaultBioConfig(), ...next };
        localStorage.setItem("rutgonlink-bio-config", JSON.stringify(bioConfig));
        if (user?.id) {
          const r = await fetch("/api/bio/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              slug:
                bioConfig.slug ||
                normalizeBioSlug(
                  bioConfig.title,
                  user.email?.split("@")[0] || `user-${user.id}`,
                ),
              title: bioConfig.title,
              subtitle: bioConfig.subtitle,
              avatar: bioConfig.avatar,
              accent: bioConfig.accent,
              link_count: bioConfig.linkCount,
              link_source: bioConfig.linkSource,
              link_order: bioConfig.linkOrder || [],
              is_published: bioConfig.isPublished !== false,
            }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) {
            if (r.status === 401) {
              redirectToAuth(
                "login",
                "Cần đăng nhập để lưu Bio public.",
              );
              return;
            }
            if (r.status === 403 && d.upgrade) {
              toast(d.error || "Tính năng này yêu cầu gói Pro", "warn");
              return;
            }
            toast(d.error || "Không thể lưu Bio public", "err");
            return;
          }
        }
        renderBioPage();
        toast("✅ Đã lưu cấu hình Bio", "ok");
      }

      function loadThemePreference() {
        applyTheme(localStorage.getItem("rutgonlink-theme") || appTheme || "dark");
      }

      function applyTheme(theme) {
        appTheme = theme === "light" ? "light" : "dark";
        localStorage.setItem("rutgonlink-theme", appTheme);
        document.documentElement.dataset.theme = appTheme;
        const icons = [document.getElementById("themeToggleIcon"), document.getElementById("authThemeIcon")];
        icons.forEach((icon) => {
          if (!icon) return;
          icon.innerHTML =
            appTheme === "light"
              ? '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z"></path>'
              : '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="M4.93 4.93l1.41 1.41"></path><path d="M17.66 17.66l1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="M4.93 19.07l1.41-1.41"></path><path d="M17.66 6.34l1.41-1.41"></path>';
        });
      }

      function toggleTheme() {
        applyTheme(appTheme === "light" ? "dark" : "light");
      }

      function toggleLandingNav(force) {
        const nav = document.getElementById("landingNav");
        const shouldOpen =
          typeof force === "boolean" ? force : !landingNavOpen;
        landingNavOpen = shouldOpen;
        if (nav) nav.classList.toggle("open", landingNavOpen);
        if (!landingNavOpen) {
          document.querySelectorAll(".auth-nav-group.open").forEach((group) => {
            group.classList.remove("open");
          });
        }
      }

      function toggleLandingGroup(button) {
        const group = button?.closest?.(".auth-nav-group");
        if (!group) return;
        const isOpen = group.classList.contains("open");
        document.querySelectorAll(".auth-nav-group.open").forEach((item) => {
          if (item !== group) item.classList.remove("open");
        });
        group.classList.toggle("open", !isOpen);
      }

      function initLandingTypedText() {
        const textEl = document.querySelector(
          '#authScreen[data-route="landing"] .auth-typed',
        );
        if (!textEl) return;
        if (typeof textEl.__typedRollCleanup === "function") {
          textEl.__typedRollCleanup();
          textEl.__typedRollCleanup = null;
        }
        const values = (textEl.dataset.typedList || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);
        if (!values.length) return;
        if (landingTypedTimer) {
          clearInterval(landingTypedTimer);
          landingTypedTimer = null;
        }
        if (landingTypedStartTimer) {
          clearTimeout(landingTypedStartTimer);
          landingTypedStartTimer = null;
        }
        const reduceMotion = window.matchMedia(
          "(prefers-reduced-motion: reduce)",
        ).matches;

        if (reduceMotion || values.length === 1) {
          textEl.textContent = values[0];
          return;
        }

        textEl.textContent = "";
        const viewport = document.createElement("span");
        viewport.className = "typed-roller-viewport";
        viewport.setAttribute("aria-hidden", "true");

        const track = document.createElement("span");
        track.className = "typed-roller-track";
        viewport.appendChild(track);
        textEl.appendChild(viewport);

        const renderValues = [...values, values[0]];
        const items = renderValues.map((value) => {
          const item = document.createElement("span");
          item.className = "typed-roller-item";
          item.textContent = value;
          track.appendChild(item);
          return item;
        });

        const cycleDuration = 560;
        const dwellDuration = 1800;
        let currentIndex = 0;
        let rowHeight = 0;
        let cycleTimeout = null;

        const measure = () => {
          const measured = items.slice(0, values.length).map((item) => {
            item.style.height = "auto";
            return item.getBoundingClientRect().height;
          });
          rowHeight = Math.max(...measured, 1);
          viewport.style.height = `${rowHeight}px`;
          items.forEach((item) => {
            item.style.height = `${rowHeight}px`;
          });
          track.style.transform = "translateY(0px)";
        };

        const scheduleNext = (delay) => {
          if (cycleTimeout) clearTimeout(cycleTimeout);
          cycleTimeout = setTimeout(advance, delay);
          landingTypedTimer = cycleTimeout;
        };

        const resetToStart = () => {
          track.style.transition = "none";
          currentIndex = 0;
          track.style.transform = "translateY(0px)";
          void track.offsetHeight;
          track.style.transition =
            "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";
        };

        const advance = () => {
          if (!document.body.contains(textEl)) return;
          currentIndex += 1;
          track.style.transform = `translateY(${-currentIndex * rowHeight}px)`;
          const wrapped = currentIndex >= values.length;
          if (wrapped) {
            window.setTimeout(() => {
              if (!document.body.contains(textEl)) return;
              resetToStart();
            }, cycleDuration + 30);
          }
          scheduleNext(wrapped ? dwellDuration + cycleDuration : dwellDuration);
        };

        const handleResize = () => {
          if (!document.body.contains(textEl)) return;
          const previousIndex = currentIndex;
          measure();
          currentIndex = previousIndex;
          track.style.transform = `translateY(${-currentIndex * rowHeight}px)`;
        };

        textEl.__typedRollCleanup = () => {
          window.removeEventListener("resize", handleResize);
          if (cycleTimeout) {
            clearTimeout(cycleTimeout);
            cycleTimeout = null;
          }
          if (landingTypedStartTimer) {
            clearTimeout(landingTypedStartTimer);
            landingTypedStartTimer = null;
          }
          if (landingTypedTimer) {
            clearTimeout(landingTypedTimer);
            landingTypedTimer = null;
          }
        };

        window.addEventListener("resize", handleResize);
        track.style.transition =
          "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";
        landingTypedStartTimer = setTimeout(() => {
          measure();
          scheduleNext(dwellDuration);
        }, 420);
      }

      function renderLandingShortenResult(shortUrl) {
        const box = document.getElementById("output-result");
        const qrHost = document.getElementById("qr-result");
        const textHost = document.getElementById("text-result");
        if (!box || !qrHost || !textHost) return;
        box.hidden = false;
        qrHost.innerHTML = `
          <svg viewBox="0 0 76 76" width="76" height="76" aria-hidden="true" focusable="false">
            <rect width="76" height="76" rx="12" fill="#ffffff"></rect>
            <rect x="7" y="7" width="18" height="18" rx="4" fill="#2563eb"></rect>
            <rect x="12" y="12" width="8" height="8" rx="2" fill="#ffffff"></rect>
            <rect x="51" y="7" width="18" height="18" rx="4" fill="#7c3aed"></rect>
            <rect x="56" y="12" width="8" height="8" rx="2" fill="#ffffff"></rect>
            <rect x="7" y="51" width="18" height="18" rx="4" fill="#7c3aed"></rect>
            <rect x="12" y="56" width="8" height="8" rx="2" fill="#ffffff"></rect>
            <rect x="31" y="10" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="36" y="10" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="41" y="10" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="31" y="20" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="36" y="20" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="41" y="20" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="31" y="30" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="36" y="30" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="41" y="30" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="31" y="40" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="36" y="40" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="41" y="40" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="31" y="50" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="36" y="50" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="41" y="50" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="31" y="60" width="4" height="4" rx="1" fill="#7c3aed"></rect>
            <rect x="36" y="60" width="4" height="4" rx="1" fill="#2563eb"></rect>
            <rect x="41" y="60" width="4" height="4" rx="1" fill="#7c3aed"></rect>
          </svg>`;
        const p = textHost.querySelector("p");
        if (p) {
          p.textContent =
            "Liên kết đã được rút gọn thành công. Muốn thêm tùy chọn tùy chỉnh?";
        }
      }

      function getAuthRouteMode() {
        const pathname = location.pathname.replace(/\/+$/, "") || "/";
        if (pathname === "/login" || pathname === "/user/login") return "login";
        if (pathname === "/register" || pathname === "/user/register") {
          return "register";
        }
        return "landing";
      }

      function setAuthRouteMode(mode) {
        const screen = document.getElementById("authScreen");
        if (!screen) return;
        screen.dataset.route = mode;
        const title = document.getElementById("authCardTitle");
        if (title) {
          title.textContent =
            mode === "login"
              ? "Đăng nhập"
              : mode === "register"
                ? "Đăng ký"
                : "Đăng nhập / Đăng ký";
        }
        if (mode === "login" || mode === "register") {
          const tabs = document.querySelectorAll(".auth-tab");
          const activeTab = tabs[mode === "register" ? 1 : 0];
          if (activeTab) {
            switchAuthTab(mode, activeTab);
          } else {
            switchAuthTab(mode);
          }
        }
      }

      function prefillCreateUrl(url) {
        const input = document.getElementById("createFormArea_url");
        if (!input) return false;
        input.value = String(url || "").trim();
        input.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }

      function startLandingShorten() {
        const input = document.getElementById("landingQuickUrl");
        const url = input?.value.trim() || "";
        landingQuickUrl = url;
        if (!url) {
          toast("Dán URL dài trước", "warn");
          input?.focus();
          return;
        }
        renderLandingShortenResult("https://boclink.click/short");
        document
          .getElementById("output-result")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      function closeLandingNav() {
        landingNavOpen = false;
        document.getElementById("landingNav")?.classList.remove("open");
        document.querySelectorAll(".auth-nav-group.open").forEach((group) => {
          group.classList.remove("open");
        });
      }

      function getIntegrationState() {
        try {
          return JSON.parse(localStorage.getItem(integrationStorageKey) || "{}");
        } catch {
          return {};
        }
      }

      function setIntegrationState(key, value) {
        const next = { ...getIntegrationState(), [key]: !!value };
        localStorage.setItem(integrationStorageKey, JSON.stringify(next));
        updateIntegrationUI();
        return next[key];
      }

      function integrationSnippetFor(key) {
        const base = window.location.origin;
        const snippets = {
          zapier: `POST ${base}/api/webhooks/zapier`,
          wordpress: `[rutgonlink_link url="${base}/abc123"]`,
          shortcuts: `POST ${base}/api/shorten`,
          webhook: `POST ${base}/api/webhooks/link-created`,
          developer: `Authorization: Bearer YOUR_API_KEY`,
        };
        return snippets[key] || key;
      }

      function updateIntegrationUI() {
        const state = getIntegrationState();
        const mappings = [
          ["zapier", "intZapierState"],
          ["wordpress", "intWpState"],
          ["shortcuts", "intShortcutState"],
          ["webhook", "intWebhookState"],
          ["developer", "intDevState"],
        ];
        mappings.forEach(([key, id]) => {
          const el = document.getElementById(id);
          if (!el) return;
          const enabled = !!state[key];
          el.textContent = enabled ? "Đã kết nối" : key === "developer" ? "Chưa kích hoạt" : "Chưa kết nối";
          el.className = "integration-status" + (key === "developer" && !enabled ? " warning" : "");
        });
      }

      function toggleIntegration(key) {
        const next = setIntegrationState(key, !getIntegrationState()[key]);
        toast(next ? `✅ Đã bật ${key}` : `↩️ Đã tắt ${key}`, "ok");
      }

      async function copyIntegrationSnippet(key) {
        const snippet = integrationSnippetFor(key);
        try {
          await navigator.clipboard.writeText(snippet);
        } catch {}
        toast(`📋 Đã sao chép mẫu ${key}`, "ok");
      }

      async function syncBioProfileFromServer() {
        if (!user?.id) return;
        try {
          const r = await fetch("/api/bio/me");
          const d = await r.json();
          if (!r.ok || !d.profile) return;
          bioConfig = {
            ...getDefaultBioConfig(),
            ...bioConfig,
            ...d.profile,
            linkCount: String(d.profile.link_count || bioConfig?.linkCount || "5"),
            linkSource: d.profile.link_source || bioConfig?.linkSource || "recent",
            slug: d.profile.slug || bioConfig?.slug || getDefaultBioConfig().slug,
            linkOrder: normalizeBioLinkOrder(
              d.profile.link_order || bioConfig?.linkOrder || [],
            ),
          };
          localStorage.setItem("rutgonlink-bio-config", JSON.stringify(bioConfig));
          if (document.getElementById("page-bio")?.classList.contains("active")) {
            renderBioPage();
          }
        } catch {}
      }

      function getBioLinkKey(link) {
        return String(link?.short_code || link?.alias || link?.id || "").trim();
      }

      function getBioPoolLinks() {
        return (links || []).filter((link) => getBioLinkKey(link));
      }

      function getBioSourceMode() {
        return bioConfig?.linkSource === "all" ? "all" : "recent";
      }

      function getBioSourceLinks() {
        const pool = getBioPoolLinks();
        if (getBioSourceMode() === "all") return pool;
        const limit = Math.max(1, Number(bioConfig?.linkCount || "12"));
        return pool.slice(0, limit);
      }

      function getBioOrderedLinks() {
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        if (!order.length) return [];
        const pool = getBioPoolLinks();
        const map = new Map();
        pool.forEach((link) => {
          const key = getBioLinkKey(link);
          if (key) map.set(key, link);
          if (link.alias) map.set(String(link.alias), link);
        });
        return order.map((code) => map.get(code)).filter(Boolean);
      }

      function getBioPreviewLinks() {
        const ordered = getBioOrderedLinks();
        return ordered.length ? ordered : getBioSourceLinks();
      }

      function setBioOrder(nextOrder) {
        const normalized = normalizeBioLinkOrder(nextOrder);
        bioConfig = {
          ...(bioConfig || getDefaultBioConfig()),
          linkOrder: normalized,
        };
        localStorage.setItem("rutgonlink-bio-config", JSON.stringify(bioConfig));
        renderBioManager();
        updateBioPreview();
      }

      function fillBioOrderFromSource(mode = getBioSourceMode()) {
        const pool = getBioPoolLinks();
        const next = (mode === "all" ? pool : pool.slice(0, Math.max(1, Number(bioConfig?.linkCount || "12"))))
          .map((link) => getBioLinkKey(link))
          .filter(Boolean);
        bioConfig = {
          ...(bioConfig || getDefaultBioConfig()),
          linkSource: mode === "all" ? "all" : "recent",
        };
        setBioOrder(next);
      }

      function clearBioOrder() {
        bioConfig = {
          ...(bioConfig || getDefaultBioConfig()),
          linkOrder: [],
        };
        localStorage.setItem("rutgonlink-bio-config", JSON.stringify(bioConfig));
        renderBioManager();
        updateBioPreview();
      }

      function addBioLinkToOrder(code) {
        const key = String(code || "").trim();
        if (!key) return;
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        if (!order.includes(key)) order.push(key);
        setBioOrder(order);
      }

      function removeBioLinkFromOrder(code) {
        const key = String(code || "").trim();
        if (!key) return;
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder).filter((item) => item !== key);
        setBioOrder(order);
      }

      function moveBioLink(fromIndex, toIndex) {
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= order.length ||
          toIndex >= order.length ||
          fromIndex === toIndex
        ) {
          return;
        }
        const next = [...order];
        const [item] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, item);
        setBioOrder(next);
      }

      function shiftBioLink(code, delta) {
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        const index = order.indexOf(String(code || "").trim());
        if (index < 0) return;
        const target = index + delta;
        if (target < 0 || target >= order.length) return;
        moveBioLink(index, target);
      }

      let bioDragCode = "";

      function onBioDragStart(event, code) {
        bioDragCode = String(code || "").trim();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", bioDragCode);
      }

      function onBioDragOver(event) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }

      function onBioDrop(event, targetCode) {
        event.preventDefault();
        const sourceCode =
          event.dataTransfer.getData("text/plain") || bioDragCode || "";
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        const fromIndex = order.indexOf(String(sourceCode).trim());
        const toIndex = order.indexOf(String(targetCode).trim());
        if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
        moveBioLink(fromIndex, toIndex);
        bioDragCode = "";
      }

      function renderBioManager() {
        const orderWrap = document.getElementById("bioOrderList");
        const poolWrap = document.getElementById("bioPoolList");
        if (!orderWrap || !poolWrap) return;
        const order = normalizeBioLinkOrder(bioConfig?.linkOrder);
        const selected = order
          .map((code) => getBioPoolLinks().find((link) => getBioLinkKey(link) === code))
          .filter(Boolean);
        const selectedSet = new Set(order);
        const pool = getBioPoolLinks().filter((link) => !selectedSet.has(getBioLinkKey(link)));

        orderWrap.innerHTML = selected.length
          ? selected
              .map((link, index) => {
                const key = getBioLinkKey(link);
                const short = (link.short_url || "").replace(/^https?:\/\//, "");
                const label = link.og_title || link.original_url || short;
                return `
                  <div class="bio-order-item" draggable="true"
                    ondragstart='onBioDragStart(event,${JSON.stringify(key)})'
                    ondragover='onBioDragOver(event)'
                    ondrop='onBioDrop(event,${JSON.stringify(key)})'>
                    <button class="bio-handle" type="button" title="Kéo để sắp xếp">↕</button>
                    <div class="bio-order-copy">
                      <strong>${esc(label)}</strong>
                      <span>${esc(short || link.original_url || "")}</span>
                    </div>
                    <div class="bio-order-tools">
                      <button type="button" class="bio-mini-btn" onclick='shiftBioLink(${JSON.stringify(key)}, -1)'>↑</button>
                      <button type="button" class="bio-mini-btn" onclick='shiftBioLink(${JSON.stringify(key)}, 1)'>↓</button>
                      <button type="button" class="bio-mini-btn danger" onclick='removeBioLinkFromOrder(${JSON.stringify(key)})'>×</button>
                    </div>
                  </div>`;
              })
              .join("")
          : `
            <div class="bio-order-empty">
              <b>Chưa có link public nào được ghim.</b>
              <span>Bấm <strong>Dùng link gần đây</strong> hoặc thêm từng link từ danh sách bên dưới.</span>
            </div>`;

        poolWrap.innerHTML = pool.length
          ? pool
              .map((link) => {
                const key = getBioLinkKey(link);
                const short = (link.short_url || "").replace(/^https?:\/\//, "");
                return `
                  <button class="bio-pool-item" type="button" onclick='addBioLinkToOrder(${JSON.stringify(key)})'>
                    <span class="bio-pool-title">${esc(link.og_title || short || link.original_url || "")}</span>
                    <span class="bio-pool-sub">${esc(short || link.original_url || "")}</span>
                    <span class="bio-pool-add">+</span>
                  </button>`;
              })
              .join("")
          : '<div class="bio-order-empty" style="margin-top:0">Không còn link nào để thêm.</div>';
      }

      // ══════════════════════════════════════════════════
      //  AUTH
      // ══════════════════════════════════════════════════
      function showAuthScreen(mode = "landing") {
        closeLandingNav();
        setAuthRouteMode(mode);
        document.getElementById("authScreen").style.display = "flex";
        document.getElementById("appScreen").classList.remove("show");
        stopRealtimeNotificationLoop();
        closeNotificationDropdown();
        finishShellBoot();
        if (mode === "landing") {
          initLandingTypedText();
        } else {
          if (landingTypedStartTimer) {
            clearTimeout(landingTypedStartTimer);
            landingTypedStartTimer = null;
          }
          if (landingTypedTimer) {
          clearInterval(landingTypedTimer);
          landingTypedTimer = null;
          }
        }
      }
      function showApp() {
        closeLandingNav();
        document.getElementById("authScreen").style.display = "none";
        document.getElementById("appScreen").classList.add("show");
        finishShellBoot();
        loadThemePreference();
        updateTopbar();
        loadBioConfig();
        renderForms();
        updateIntegrationUI();
        void syncBioProfileFromServer();
        syncRouteFromLocation();
        loadData();
        startRealtimeNotificationLoop();
      }
      function showAuth(mode = "landing") {
        closeLandingNav();
        setAuthRouteMode(mode);
        document.getElementById("appScreen").classList.remove("show");
        document.getElementById("authScreen").style.display = "flex";
        stopRealtimeNotificationLoop();
        closeNotificationDropdown();
        finishShellBoot();
        if (mode === "landing") {
          initLandingTypedText();
        } else {
          if (landingTypedStartTimer) {
            clearTimeout(landingTypedStartTimer);
            landingTypedStartTimer = null;
          }
          if (landingTypedTimer) {
            clearInterval(landingTypedTimer);
            landingTypedTimer = null;
          }
        }
      }

      function continueAsGuest() {
        user = null;
        closeLandingNav();
        document.getElementById("authScreen").style.display = "none";
        document.getElementById("appScreen").classList.add("show");
        finishShellBoot();
        loadThemePreference();
        updateTopbar();
        loadBioConfig();
        renderForms();
        updateIntegrationUI();
        syncRouteFromLocation();
        loadData();
        startRealtimeNotificationLoop();
        if (landingQuickUrl) {
          prefillCreateUrl(landingQuickUrl);
          landingQuickUrl = "";
        }
      }

      function switchAuthTab(tab, el) {
        document
          .querySelectorAll(".auth-tab")
          .forEach((t) => t.classList.remove("active"));
        if (el) {
          el.classList.add("active");
        } else {
          const idx = tab === "register" ? 1 : 0;
          document.querySelectorAll(".auth-tab")[idx]?.classList.add("active");
        }
        document.getElementById("loginForm").style.display =
          tab === "login" ? "" : "none";
        document.getElementById("registerForm").style.display =
          tab === "register" ? "" : "none";
        document.getElementById("authErr").classList.remove("show");
      }

      async function doLogin() {
        const email = document.getElementById("loginEmail").value.trim();
        const pass = document.getElementById("loginPass").value;
        const errEl = document.getElementById("authErr");
        errEl.classList.remove("show");
        if (!email || !pass) {
          errEl.textContent = "Vui lòng nhập đầy đủ";
          errEl.classList.add("show");
          return;
        }
        try {
          const r = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: pass }),
          });
          const d = await r.json();
          if (!r.ok) {
            errEl.textContent = d.error || "Lỗi đăng nhập";
            errEl.classList.add("show");
            return;
          }
          user = d.user;
          showApp();
          toast("✅ Đăng nhập thành công!", "ok");
        } catch {
          errEl.textContent = "Lỗi kết nối";
          errEl.classList.add("show");
        }
      }

      async function doRegister() {
        const name = document.getElementById("regName").value.trim();
        const email = document.getElementById("regEmail").value.trim();
        const pass = document.getElementById("regPass").value;
        const errEl = document.getElementById("authErr");
        errEl.classList.remove("show");
        if (!email || !pass) {
          errEl.textContent = "Vui lòng nhập đầy đủ";
          errEl.classList.add("show");
          return;
        }
        try {
          const r = await fetch("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password: pass, name }),
          });
          const d = await r.json();
          if (!r.ok) {
            errEl.textContent = d.error || "Lỗi đăng ký";
            errEl.classList.add("show");
            return;
          }
          user = d.user;
          showApp();
          toast("🎉 Đăng ký thành công!", "ok");
        } catch {
          errEl.textContent = "Lỗi kết nối";
          errEl.classList.add("show");
        }
      }

      async function doLogout() {
        await fetch("/api/auth/logout", { method: "POST" });
        user = null;
        document.getElementById("userDropdown").classList.remove("show");
        document
          .getElementById("userDropdown")
          .setAttribute("aria-hidden", "true");
        stopRealtimeNotificationLoop();
        showAuthScreen();
      }

      function getNotificationIconSvg(kind = "info") {
        if (kind === "ok") {
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M20 7 9 18l-5-5" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
        }
        if (kind === "warn") {
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 4 3 19h18L12 4Z" stroke-linejoin="round"></path><path d="M12 9v4" stroke-linecap="round"></path><circle cx="12" cy="16.5" r="1"></circle></svg>';
        }
        if (kind === "err") {
          return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="9"></circle><path d="M9 9l6 6M15 9l-6 6" stroke-linecap="round"></path></svg>';
        }
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M12 7h.01M11 11h2v6h-2z" stroke-linecap="round" stroke-linejoin="round"></path><circle cx="12" cy="12" r="9"></circle></svg>';
      }

      function formatNotificationTime(value) {
        const time = new Date(value || Date.now()).getTime();
        if (!Number.isFinite(time)) return "Vừa xong";
        const diffMs = Date.now() - time;
        const diffMin = Math.max(Math.floor(diffMs / 60000), 0);
        if (diffMin < 1) return "Vừa xong";
        if (diffMin < 60) return `${diffMin} phút trước`;
        const diffHour = Math.floor(diffMin / 60);
        if (diffHour < 24) return `${diffHour} giờ trước`;
        const diffDay = Math.floor(diffHour / 24);
        return `${diffDay} ngày trước`;
      }

      function renderNotificationCenter() {
        const badge = document.getElementById("notificationBadge");
        const listEl = document.getElementById("notificationList");
        const statusEl = document.getElementById("notificationStatus");
        if (badge) {
          badge.hidden = unreadNotificationCount < 1;
          badge.textContent = unreadNotificationCount > 9 ? "9+" : unreadNotificationCount;
        }
        if (statusEl) {
          statusEl.textContent = unreadNotificationCount
            ? `${unreadNotificationCount} thông báo chưa đọc`
            : notificationItems.length
              ? "Mọi thông báo đã được xem"
              : "Chưa có thông báo mới";
        }
        if (!listEl) return;
        if (!notificationItems.length) {
          listEl.innerHTML =
            '<div class="notification-empty">Chuông sẽ hiện các thay đổi mới về click, link, domain và quản trị.</div>';
          return;
        }
        listEl.innerHTML = notificationItems
          .map((item, index) => `<button class="notification-item ${item.read ? "" : "unread"}" type="button" onclick="openNotification(${index})">
  <span class="notification-icon ${item.kind || "info"}">${getNotificationIconSvg(item.kind)}</span>
  <span class="notification-copy">
    <span class="notification-label">${item.read ? "" : '<span class="notification-dot"></span>'}${esc(item.title || "Thông báo")}</span>
    <span class="notification-msg">${esc(item.message || "")}</span>
    <span class="notification-time">${esc(formatNotificationTime(item.createdAt))}</span>
  </span>
</button>`)
          .join("");
      }

      function addNotification(entry = {}) {
        const key = String(entry.key || `${Date.now()}-${Math.random()}`);
        if (notificationItems.some((item) => item.key === key)) return;
        const item = {
          key,
          title: entry.title || "Thông báo mới",
          message: entry.message || "",
          kind: entry.kind || "info",
          createdAt: entry.createdAt || new Date().toISOString(),
          page: entry.page || "",
          url: entry.url || "",
          read: false,
        };
        notificationItems = [item, ...notificationItems].slice(0, 16);
        if (!document.getElementById("notificationDropdown")?.classList.contains("show")) {
          unreadNotificationCount += 1;
        }
        renderNotificationCenter();
      }

      function closeNotificationDropdown() {
        const dropdown = document.getElementById("notificationDropdown");
        const bell = document.getElementById("notificationBellBtn");
        dropdown?.classList.remove("show");
        dropdown?.setAttribute("aria-hidden", "true");
        bell?.classList.remove("is-open");
      }

      function markAllNotificationsRead() {
        notificationItems = notificationItems.map((item) => ({ ...item, read: true }));
        unreadNotificationCount = 0;
        renderNotificationCenter();
      }

      function toggleNotificationDropdown() {
        closeUserPopup();
        const dropdown = document.getElementById("notificationDropdown");
        const bell = document.getElementById("notificationBellBtn");
        if (!dropdown) return;
        const willOpen = !dropdown.classList.contains("show");
        dropdown.classList.toggle("show", willOpen);
        dropdown.setAttribute("aria-hidden", willOpen ? "false" : "true");
        bell?.classList.toggle("is-open", willOpen);
        if (willOpen) {
          markAllNotificationsRead();
        }
      }

      function openNotification(index) {
        const item = notificationItems[index];
        if (!item) return;
        notificationItems = notificationItems.map((entry, entryIndex) =>
          entryIndex === index ? { ...entry, read: true } : entry,
        );
        unreadNotificationCount = notificationItems.filter((entry) => !entry.read).length;
        renderNotificationCenter();
        closeNotificationDropdown();
        if (item.url) {
          window.open(item.url, "_blank", "noopener");
          return;
        }
        if (item.page) {
          const navEl = document.querySelector(`.sitem[onclick*="navigate('${item.page}'"]`);
          navigate(item.page, navEl);
        }
      }

      function loadSeenNotificationKeys() {
        try {
          const parsed = JSON.parse(localStorage.getItem(notificationSeenStorageKey) || "{}");
          const next = {};
          const cutoff = Date.now() - 45 * 24 * 3600 * 1000;
          Object.entries(parsed || {}).forEach(([key, value]) => {
            const timestamp = Number(value || 0);
            if (key && Number.isFinite(timestamp) && timestamp >= cutoff) {
              next[key] = timestamp;
            }
          });
          seenNotificationKeys = next;
        } catch {
          seenNotificationKeys = {};
        }
      }

      function persistSeenNotificationKeys() {
        try {
          localStorage.setItem(
            notificationSeenStorageKey,
            JSON.stringify(seenNotificationKeys),
          );
        } catch {}
      }

      function hasSeenNotificationKey(key) {
        return !!(key && seenNotificationKeys[key]);
      }

      function markNotificationKeySeen(key) {
        if (!key) return;
        seenNotificationKeys[key] = Date.now();
        persistSeenNotificationKeys();
      }

      function maybeAddPersistentNotification(entry = {}) {
        if (!entry.key || hasSeenNotificationKey(entry.key)) return;
        markNotificationKeySeen(entry.key);
        addNotification(entry);
      }

      function enqueueStatsAlerts(payload = {}) {
        const activeAlerts = Array.isArray(payload?.alerts?.active) ? payload.alerts.active : [];
        activeAlerts.forEach((item) => {
          maybeAddPersistentNotification({
            key: item.key,
            title: item.title || "Canh bao",
            message: item.message || "",
            kind: item.kind || "info",
            page: item.page || "stats",
            createdAt: item.createdAt || new Date().toISOString(),
          });
        });
      }

      function enqueueAdminAlerts(payload = {}) {
        const activeAlerts = Array.isArray(payload?.alerts?.active) ? payload.alerts.active : [];
        activeAlerts.forEach((item) => {
          maybeAddPersistentNotification({
            key: item.key,
            title: item.title || "Canh bao admin",
            message: item.message || "",
            kind: item.kind || "warn",
            page: item.page || "admin",
            createdAt: item.createdAt || new Date().toISOString(),
          });
        });
      }

      function buildStatsNotificationSnapshot(payload = {}) {
        const recent = Array.isArray(payload.recent) ? payload.recent : [];
        return {
          totalClicks: Number(payload.totalClicks || 0),
          totalLinks: Number(payload.totalLinks || 0),
          recentFirstId: recent[0]?.id ? Number(recent[0].id) : null,
          recentFirstShort: (recent[0]?.short_url || "").replace(/^https?:\/\//, ""),
        };
      }

      function rememberStatsNotificationSnapshot(payload = {}) {
        notificationStatsSnapshot = buildStatsNotificationSnapshot(payload);
      }

      function buildAdminNotificationSnapshot(statsPayload = {}, redirectPayload = {}) {
        const newestEvent = Array.isArray(redirectPayload.events) ? redirectPayload.events[0] : null;
        return {
          totalUsers: Number(statsPayload.totalUsers || 0),
          latestRedirectKey: newestEvent
            ? `${newestEvent.timestamp || ""}:${newestEvent.requestId || ""}:${newestEvent.status || ""}`
            : "",
        };
      }

      function rememberAdminNotificationSnapshot(statsPayload = {}, redirectPayload = {}) {
        adminNotificationSnapshot = buildAdminNotificationSnapshot(
          statsPayload,
          redirectPayload,
        );
      }

      async function pollRealtimeNotifications() {
        if (!document.getElementById("appScreen")?.classList.contains("show")) return;
        try {
          const statsResponse = await fetch("/api/stats");
          const statsPayload = await statsResponse.json().catch(() => null);
          if (statsResponse.ok && statsPayload) {
            enqueueStatsAlerts(statsPayload);
            const previous = notificationStatsSnapshot;
            const next = buildStatsNotificationSnapshot(statsPayload);
            if (previous) {
              const clicksDiff = next.totalClicks - previous.totalClicks;
              if (clicksDiff > 0) {
                addNotification({
                  key: `clicks-${next.totalClicks}`,
                  title: `Có ${clicksDiff.toLocaleString()} lượt nhấp mới`,
                  message: "Tab thống kê vừa có dữ liệu mới cần xem.",
                  kind: "ok",
                  page: "stats",
                });
              }
              const linksDiff = next.totalLinks - previous.totalLinks;
              if (linksDiff > 0) {
                addNotification({
                  key: `links-${next.totalLinks}`,
                  title: `Có ${linksDiff.toLocaleString()} liên kết mới`,
                  message: next.recentFirstShort
                    ? `Liên kết mới nhất: ${next.recentFirstShort}`
                    : "Danh sách liên kết vừa được cập nhật.",
                  kind: "info",
                  page: "links",
                });
              }
            }
            notificationStatsSnapshot = next;
          }

          if (isAdminUser()) {
            const [adminStatsResponse, redirectResponse] = await Promise.all([
              fetch("/api/admin/stats"),
              fetch("/api/admin/redirects?limit=3"),
            ]);
            const adminStatsPayload = await adminStatsResponse.json().catch(() => null);
            const redirectPayload = await redirectResponse.json().catch(() => null);
            if (adminStatsResponse.ok && adminStatsPayload) {
              enqueueAdminAlerts(adminStatsPayload);
            }
            if (adminStatsResponse.ok && redirectResponse.ok && adminStatsPayload && redirectPayload) {
              const previousAdmin = adminNotificationSnapshot;
              const nextAdmin = buildAdminNotificationSnapshot(
                adminStatsPayload,
                redirectPayload,
              );
              if (previousAdmin) {
                const userDiff = nextAdmin.totalUsers - previousAdmin.totalUsers;
                if (userDiff > 0) {
                  addNotification({
                    key: `admin-users-${nextAdmin.totalUsers}`,
                    title: `Có ${userDiff.toLocaleString()} người dùng mới`,
                    message: "Tab quản trị người dùng vừa có thêm thành viên.",
                    kind: "info",
                    page: "admin",
                  });
                }
                const newestEvent = Array.isArray(redirectPayload.events)
                  ? redirectPayload.events[0]
                  : null;
                if (
                  newestEvent &&
                  nextAdmin.latestRedirectKey &&
                  nextAdmin.latestRedirectKey !== previousAdmin.latestRedirectKey &&
                  Number(newestEvent.status || 0) >= 400
                ) {
                  addNotification({
                    key: `redirect-alert-${nextAdmin.latestRedirectKey}`,
                    title: "Redirect cần chú ý",
                    message: `${newestEvent.code || "—"} trả về ${newestEvent.status || "—"} • ${newestEvent.mode || "redirect"}`,
                    kind: "warn",
                    page: "admin",
                  });
                }
              }
              adminNotificationSnapshot = nextAdmin;
            }
          } else {
            adminNotificationSnapshot = null;
          }
        } catch {}
      }

      function stopRealtimeNotificationLoop() {
        if (notificationPollTimer) {
          clearInterval(notificationPollTimer);
          notificationPollTimer = null;
        }
      }

      function startRealtimeNotificationLoop() {
        stopRealtimeNotificationLoop();
        loadSeenNotificationKeys();
        renderNotificationCenter();
        void pollRealtimeNotifications();
        notificationPollTimer = setInterval(() => {
          if (document.hidden) return;
          void pollRealtimeNotifications();
        }, 30000);
      }

      function updateTopbar() {
        const plan = user?.plan || "guest";
        const role = user?.role || "user";
        const name = getUserDisplayName(user) || "Khách";
        const email = user?.email || "Chưa đăng nhập";
        const createdAt = user?.created_at
          ? new Date(user.created_at).toLocaleDateString("vi-VN")
          : "—";
        const badge = document.getElementById("tbPlanBadge");
        badge.textContent = plan === "guest" ? "GUEST" : plan.toUpperCase();
        badge.className = "tb-plan-badge " + (plan === "guest" ? "free" : plan);
        document.getElementById("tbAvatar").textContent = getUserInitials(user);
        document.getElementById("tbUname").textContent = name;
        document.getElementById("popupAvatar").textContent = getUserInitials(user);
        document.getElementById("popupName").textContent = name;
        document.getElementById("popupEmail").textContent = email;
        document.getElementById("popupFullName").textContent = user?.name || name;
        document.getElementById("popupUserId").textContent = user?.id || "—";
        document.getElementById("popupCreatedAt").textContent = createdAt;
        document.getElementById("popupPlan").textContent =
          plan === "guest" ? "GUEST" : plan.toUpperCase();
        document.getElementById("popupRole").textContent = role || "user";
        document.getElementById("popupSessionStatus").textContent = user
          ? "Đang đăng nhập"
          : "Khách / chưa xác thực";
        const billingCurrentPlan = document.getElementById("billingCurrentPlan");
        if (billingCurrentPlan)
          billingCurrentPlan.textContent =
            plan === "guest" ? "FREE" : plan.toUpperCase();
        const billingCurrentRole = document.getElementById("billingCurrentRole");
        if (billingCurrentRole) billingCurrentRole.textContent = role || "user";
        const billingStatus = document.getElementById("billingStatus");
        if (billingStatus)
          billingStatus.textContent =
            plan === "pro" || plan === "business" || plan === "admin"
              ? "Đã kích hoạt"
              : "Dùng thử";
        const billingPromo = document.getElementById("billingPromo");
        if (billingPromo)
          billingPromo.textContent =
            plan === "pro" || plan === "business" || plan === "admin"
              ? "Tài khoản của bạn đang mở đầy đủ tính năng cao cấp."
              : "Gói Pro mở khóa deeplink, custom OG preview và upload ảnh.";
        const billingNote = document.getElementById("billingNote");
        if (billingNote)
          billingNote.textContent =
            plan === "pro" || plan === "business" || plan === "admin"
              ? "Bạn có thể xem lại thông tin gói, role và trạng thái ngay trong popup."
              : "Billing nằm trong popup tài khoản để sidebar gọn hơn.";
        document.getElementById("profileNameInput").value = user?.name || "";
        document.getElementById("profileNameInput").disabled = !user;
        document.getElementById("saveProfileBtn").style.display = user
          ? ""
          : "none";
        document.getElementById("profileHint").textContent = user
          ? "Tên này sẽ hiển thị trong giao diện và danh sách quản trị."
          : "Đăng nhập để chỉnh sửa hồ sơ cá nhân.";
        document.getElementById("ddLogout").style.display = user ? "" : "none";
        document.getElementById("ddLogin").style.display = user ? "none" : "";
        document.getElementById("popupAdminBtn").style.display =
          plan === "admin" || role === "admin" ? "" : "none";

        const isAdmin = plan === "admin" || role === "admin";
        const adminNav = document.getElementById("adminNavItem");
        if (adminNav) adminNav.style.display = isAdmin ? "" : "none";
        const sf = document.getElementById("sidebarFooter");
        sf.style.display =
          plan === "pro" || plan === "business" || isAdmin ? "none" : "";

        renderNotificationCenter();
        updatePricingUI();
      }

      function clearUserMenuSection() {
        userMenuSection = "";
        document
          .querySelectorAll("#userDropdown .user-tab")
          .forEach((tab) => tab.classList.remove("active"));
        document
          .querySelectorAll("#userDropdown .user-panel")
          .forEach((panel) => panel.classList.remove("active"));
        document.getElementById("userDropdown")?.querySelector(".user-panels")?.classList.remove("has-active");
      }

      function toggleDropdown() {
        closeNotificationDropdown();
        const dropdown = document.getElementById("userDropdown");
        if (!dropdown) return;
        const willOpen = !dropdown.classList.contains("show");
        dropdown.classList.toggle("show", willOpen);
        dropdown.setAttribute("aria-hidden", willOpen ? "false" : "true");
        if (!willOpen) {
          clearUserMenuSection();
        }
      }
      function closeUserPopup() {
        const dropdown = document.getElementById("userDropdown");
        dropdown?.classList.remove("show");
        dropdown?.setAttribute("aria-hidden", "true");
        clearUserMenuSection();
      }
      function switchUserTab(tab, el) {
        const current = userMenuSection;
        clearUserMenuSection();
        if (current === tab) return;
        userMenuSection = tab;
        el?.classList.add("active");
        document.getElementById("userDropdown")?.querySelector(".user-panels")?.classList.add("has-active");
        document
          .getElementById(
            "userPanel" + tab.charAt(0).toUpperCase() + tab.slice(1),
          )
          ?.classList.add("active");
      }

      function openPublicProfile() {
        closeUserPopup();
        const bioNav = document.querySelector(".sitem[onclick*=\"navigate('bio'\"]");
        navigate("bio", bioNav);
      }

      function openHelpCenter() {
        closeUserPopup();
        window.open("/landing", "_blank", "noopener");
      }

      async function saveProfile() {
        const btn = document.getElementById("saveProfileBtn");
        const name = document.getElementById("profileNameInput").value.trim();
        btn.disabled = true;
        btn.textContent = "Đang lưu...";
        try {
          const r = await fetch("/api/auth/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể lưu hồ sơ", "err");
            return;
          }
          user = d.user;
          updateTopbar();
          addNotification({
            key: `profile-${Date.now()}`,
            title: "Hồ sơ đã được cập nhật",
            message: "Tên hiển thị mới đã được lưu thành công.",
            kind: "ok",
          });
          toast("✅ Đã cập nhật hồ sơ", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        } finally {
          btn.disabled = false;
          btn.textContent = "Lưu hồ sơ";
        }
      }
      document.addEventListener("click", (e) => {
        const userToggle = document.getElementById("tbUser");
        const userDropdown = document.getElementById("userDropdown");
        const notificationToggle = document.getElementById("notificationBellBtn");
        const notificationDropdown = document.getElementById("notificationDropdown");
        if (
          userToggle &&
          userDropdown &&
          !userToggle.contains(e.target) &&
          !userDropdown.contains(e.target)
        ) {
          closeUserPopup();
        }
        if (
          notificationToggle &&
          notificationDropdown &&
          !notificationToggle.contains(e.target) &&
          !notificationDropdown.contains(e.target)
        ) {
          closeNotificationDropdown();
        }
      });

      function showConfirmDialog(options = {}) {
        const modal = document.getElementById("confirmModal");
        const titleEl = document.getElementById("confirmTitle");
        const messageEl = document.getElementById("confirmMessage");
        const noteEl = document.getElementById("confirmNote");
        const actionBtn = document.getElementById("confirmActionBtn");
        if (!modal || !titleEl || !messageEl || !actionBtn) {
          return Promise.resolve(window.confirm(options.message || "Xác nhận thao tác?"));
        }
        titleEl.textContent = options.title || "Xác nhận hành động";
        messageEl.textContent =
          options.message || "Bạn có chắc muốn tiếp tục thao tác này không?";
        if (noteEl) {
          if (options.note) {
            noteEl.hidden = false;
            noteEl.textContent = options.note;
          } else {
            noteEl.hidden = true;
            noteEl.textContent = "";
          }
        }
        actionBtn.textContent = options.confirmLabel || "Xác nhận";
        actionBtn.className =
          options.tone === "danger" ? "user-btn danger" : "btn-save";
        modal.classList.remove("hidden");
        return new Promise((resolve) => {
          confirmModalResolver = resolve;
        });
      }

      function closeConfirmModal(result = false) {
        document.getElementById("confirmModal")?.classList.add("hidden");
        if (confirmModalResolver) {
          const resolver = confirmModalResolver;
          confirmModalResolver = null;
          resolver(!!result);
        }
      }

      // ══════════════════════════════════════════════════
      //  NAVIGATION
      // ══════════════════════════════════════════════════
      function syncRouteFromLocation() {
        let finalPage = canonicalizeAppLocation();
        if (finalPage === "admin") {
          const allowed = guardAdminRoute();
          if (!allowed) return;
          finalPage = allowed;
        }
        const el = document.querySelector(`.sitem[onclick*="navigate('${finalPage}'"]`);
        navigate(finalPage, el);
      }

      function navigate(page, el) {
        if (page === "admin") {
          const allowed = guardAdminRoute();
          if (!allowed) return;
          page = allowed;
        }
        closeUserPopup();
        closeNotificationDropdown();
        document
          .querySelectorAll(".page")
          .forEach((p) => p.classList.remove("active"));
        document
          .querySelectorAll(".sitem")
          .forEach((s) => s.classList.remove("active"));
        document.getElementById("page-" + page)?.classList.add("active");
        if (el) el.classList.add("active");
        if (page === "links") applyLinkFilters();
        if (page === "qr") renderQrPage();
        if (page === "bio") renderBioPage();
        if (page === "integrations") renderIntegrationsPage();
        if (page === "team") renderTeamPage();
        if (page === "admin") {
          syncAdminSectionUI();
          loadAdminData();
        }
        if (page === "stats") renderStatsPage();
        const sidebar = document.getElementById("sidebar");
        sidebar?.classList.remove("mob-open");
        document.getElementById("sidebarBackdrop")?.classList.remove("show");
        const nextUrl = `${buildAppPath(page)}${location.search}`;
        if (`${location.pathname}${location.search}` !== nextUrl || location.hash) {
          history.replaceState(null, "", nextUrl);
        }
      }

      function toggleSidebar() {
        const sb = document.getElementById("sidebar");
        if (!sb) return;
        if (window.innerWidth <= 768) {
          sb.classList.toggle("mob-open");
          document
            .getElementById("sidebarBackdrop")
            ?.classList.toggle("show", sb.classList.contains("mob-open"));
        } else {
          sb.classList.toggle("collapsed");
        }
      }

      // ══════════════════════════════════════════════════
      //  SHORTEN FORM
      // ══════════════════════════════════════════════════
      function renderForms() {
        renderForm("createFormArea");
      }

      function renderQrPage() {
        const input = document.getElementById("qrUrlInput");
        const wrap = document.getElementById("qrPreviewWrap");
        const hint = document.getElementById("qrPreviewHint");
        if (!input || !wrap) return;
        if (!input.value.trim() && links.length) {
          input.value = links[0].short_url || links[0].original_url || "";
        }
        if (!input.value.trim()) {
          wrap.innerHTML =
            '<div class="qr-placeholder">Nhập URL rồi bấm <strong>Tạo QR</strong></div>';
          if (hint) hint.textContent = "Chưa tạo mã QR nào";
          return;
        }
        generateQr();
      }

      function renderBioPage() {
        const cfg = loadBioConfig();
        const slugInput = document.getElementById("bioSlugInput");
        const titleInput = document.getElementById("bioTitleInput");
        const subtitleInput = document.getElementById("bioSubtitleInput");
        const avatarInput = document.getElementById("bioAvatarInput");
        const accentInput = document.getElementById("bioAccentInput");
        const countInput = document.getElementById("bioLinkCountInput");
        const sourceInput = document.getElementById("bioLinkSourceInput");
        if (!slugInput || !titleInput) return;

        slugInput.value = cfg.slug || getDefaultBioConfig().slug;
        titleInput.value = cfg.title || "";
        subtitleInput.value = cfg.subtitle || "";
        avatarInput.value = cfg.avatar || "";
        accentInput.value = cfg.accent || "#3b82f6";
        countInput.value = cfg.linkCount || "12";
        sourceInput.value = cfg.linkSource || "recent";
        renderBioManager();
        updateBioPreview();
      }

      function renderForm(containerId) {
        const c = document.getElementById(containerId);
        if (!c) return;
        const plan = user?.plan || "free";
        const isAdmin = plan === "admin" || user?.role === "admin";
        const canOg = plan === "pro" || plan === "business" || isAdmin;
        const canUp = plan === "pro" || plan === "business" || isAdmin;

        c.innerHTML = `
  <div class="sf-card">
    <div class="tool-kicker">Link builder</div>
    <div class="tool-head create-form-head">
      <div>
        <h3>Tạo link thông minh</h3>
        <p>Dán URL, chọn kiểu link và chỉnh preview trước khi chia sẻ.</p>
      </div>
      <span class="create-form-badge">${isAdmin ? "Admin" : plan === "business" ? "Business" : plan === "pro" ? "Pro" : "Free"}</span>
    </div>

    <!-- ① URL + nút rút gọn -->
    <div class="url-bar" style="margin-bottom:12px">
      <input type="url" id="${containerId}_url" class="url-bar-input"
        placeholder="Dán link Shopee, TikTok hoặc bất kỳ URL nào..."
        autocomplete="off" spellcheck="false"/>
      <button class="btn-go" id="${containerId}_btn" onclick="doShorten('${containerId}')">
        ⚡ Rút gọn
      </button>
    </div>

    <!-- Detect badge -->
    <div class="det" id="${containerId}_det" style="margin-bottom:10px"></div>

    <!-- ② Alias + Domain -->
    <div class="create-form-grid create-form-grid--alias-domain">
      <div>
        <label class="fl" style="margin-bottom:4px">Alias tùy chỉnh</label>
        <div class="pfx">
          <span id="${containerId}_domainprefix" style="font-size:12px;color:var(--text3);white-space:nowrap">${getCreateDomainPreviewHost()}/</span>
          <input type="text" id="${containerId}_alias" placeholder="ten-link" maxlength="40" autocomplete="off" spellcheck="false" oninput="onAliasInput('${containerId}')"/>
        </div>
      </div>
      ${buildCreateDomainFieldMarkup(containerId)}
    </div>

    <!-- ③ Kiểu link -->
    <div style="margin-bottom:12px">
      <label class="fl" style="margin-bottom:4px">Kiểu link</label>
      <select class="fi" id="${containerId}_ltype" onchange="onLinkTypeChange('${containerId}')">
        <option value="direct">🔗 Trực tiếp</option>
        <option value="deeplink">📱 Deeplink App</option>
        <option value="video">🎬 Video Overlay</option>
      </select>
    </div>

    <!-- ④ VIDEO SECTION (hiện khi chọn Video Overlay) -->
    <div class="video-sec" id="${containerId}_videosec" style="margin-bottom:12px">

      <!-- Hàng 1: Video upload + URL video -->
      <div style="display:grid;grid-template-columns:140px 1fr;gap:10px;margin-bottom:10px;align-items:start">
        <!-- Upload box nhỏ gọn -->
        <div>
          <label class="fl" style="margin-bottom:4px">Video</label>
          <div id="${containerId}_vuploadarea"
            style="border:2px dashed var(--border2);border-radius:8px;padding:10px 6px;text-align:center;
                   cursor:pointer;position:relative;transition:.2s;background:var(--bg4);min-height:72px;
                   display:flex;flex-direction:column;align-items:center;justify-content:center">
            <input type="file" id="${containerId}_vfile" accept="video/mp4,video/webm,video/quicktime"
              style="position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100%"
              onchange="handleVideoUpload(event,'${containerId}')"/>
            <div style="font-size:20px">🎬</div>
            <p style="font-size:10px;color:var(--text3);margin-top:2px">Upload video</p>
          </div>
          <video id="${containerId}_vpreview"
            style="width:100%;max-height:72px;border-radius:6px;display:none;object-fit:cover;background:#000;margin-top:4px"
            muted></video>
        </div>
        <!-- URL + CTA text -->
        <div style="display:flex;flex-direction:column;gap:7px">
          <div>
            <label class="fl" style="margin-bottom:3px">URL video (YouTube / MP4)</label>
            <div style="display:flex;gap:5px">
              <input type="url" class="fi" id="${containerId}_videourl"
                placeholder="https://youtube.com/watch?v=..."
                style="font-size:12px;flex:1"
                oninput="onVideoUrlInput('${containerId}')"/>
              <button type="button" onclick="extractThumbFromUrl('${containerId}')"
                style="padding:0 10px;background:var(--bg4);border:1px solid var(--border);border-radius:7px;
                       color:var(--text2);font-size:11px;cursor:pointer;white-space:nowrap"
                title="Lấy thumbnail tự động">🖼️ Thumb</button>
            </div>
          </div>
          <div>
            <label class="fl" style="margin-bottom:3px">Nội dung CTA (hiện sau 5s)</label>
            <input type="text" class="fi" id="${containerId}_videotext"
              placeholder="🛒 Bấm để xem sản phẩm →" maxlength="80" style="font-size:12px"/>
          </div>
        </div>
      </div>

      <div style="margin-top:8px;padding:6px 10px;background:rgba(59,130,246,.07);border-radius:6px;
                  font-size:11px;color:var(--text2)">
        💡 Video autoplay → 5s → lớp phủ toàn màn hình → user bấm bất kỳ đâu → mở App Shopee/TikTok.<br/>
        ✏️ Tiêu đề, mô tả và ảnh preview nhập ở phần <strong>Preview khi share</strong> bên dưới.
      </div>
    </div>

    <!-- ⑤ META SECTION (collapsible) -->
    <div style="border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:12px">
      <!-- Header toggle -->
      <div onclick="toggleMeta('${containerId}')"
        style="display:flex;align-items:center;gap:8px;padding:10px 12px;cursor:pointer;background:var(--bg3);
               user-select:none;transition:.15s" onmouseover="this.style.background='var(--bg4)'" onmouseout="this.style.background='var(--bg3)'">
        <span style="font-size:13px">🖼️</span>
        <span style="font-size:13px;font-weight:700;flex:1">Preview khi share (Facebook · Zalo · TikTok)</span>
        ${!canOg ? '<span style="font-size:10px;font-weight:700;background:rgba(245,158,11,.15);color:#fcd34d;padding:2px 7px;border-radius:10px">🔒 Pro</span>' : '<span style="font-size:10px;font-weight:700;background:rgba(34,197,94,.1);color:var(--green);padding:2px 7px;border-radius:10px">✓ Active</span>'}
        <span id="${containerId}_arrow" style="font-size:11px;color:var(--text3);transition:.2s">▼</span>
      </div>

      <!-- Body -->
      <div id="${containerId}_metabody" style="display:none;padding:14px;background:var(--bg2)">
        ${
          !canOg
            ? `
          <div style="text-align:center;padding:12px;color:var(--text3);font-size:13px">
            🔒 Yêu cầu gói <strong style="color:var(--brand)">Pro</strong>.
            <span style="color:var(--brand);cursor:pointer;text-decoration:underline" onclick="navigate('pricing')">Nâng cấp →</span>
          </div>`
            : `
          <!-- 2 cột: ảnh | tiêu đề + mô tả + preview -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <!-- Cột trái: ảnh -->
            <div>
              <label class="fl" style="margin-bottom:4px">Ảnh preview (1200×630px)</label>
              ${
                canUp
                  ? `
              <div id="${containerId}_uarea"
                style="border:2px dashed var(--border2);border-radius:8px;padding:14px;text-align:center;
                       cursor:pointer;position:relative;margin-bottom:8px;transition:.2s;background:var(--bg3)"
                onclick="document.getElementById('${containerId}_fileinput').click()">
                <input type="file" id="${containerId}_fileinput"
                  accept="image/jpg,image/jpeg,image/png,image/webp" style="display:none"
                  onchange="handleFileUpload(event,'${containerId}')"/>
                <div style="font-size:20px;margin-bottom:3px">📷</div>
                <p style="font-size:11px;color:var(--text2)">Bấm để chọn ảnh<br/><span style="color:var(--text3)">JPG · PNG · WebP · 10MB</span></p>
              </div>
              <img id="${containerId}_preview" src="" alt=""
                style="width:100%;border-radius:7px;display:none;object-fit:cover;max-height:100px;margin-bottom:8px"/>
              <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                <div style="flex:1;height:1px;background:var(--border)"></div>
                <span style="font-size:10px;color:var(--text3)">hoặc URL</span>
                <div style="flex:1;height:1px;background:var(--border)"></div>
              </div>`
                  : ""
              }
              <input type="url" class="fi" id="${containerId}_ogimg"
                placeholder="https://..." oninput="updateOgPreview('${containerId}')"
                style="font-size:12px"/>
            </div>

            <!-- Cột phải: tiêu đề + mô tả + preview card -->
            <div style="display:flex;flex-direction:column;gap:8px">
              <div>
                <label class="fl" style="margin-bottom:4px">Tiêu đề</label>
                <input type="text" class="fi" id="${containerId}_ogtitle"
                  placeholder="Tiêu đề hiện khi share..." maxlength="120"
                  oninput="onOgTitleInput('${containerId}')" onblur="normalizeOgTitleInput('${containerId}')" style="font-size:12px"/>
              </div>
              <div>
                <label class="fl" style="margin-bottom:4px">Mô tả</label>
                <input type="text" class="fi" id="${containerId}_ogdesc"
                  placeholder="Mô tả ngắn..." maxlength="200"
                  oninput="updateOgPreview('${containerId}')" style="font-size:12px"/>
              </div>
              <!-- Preview card mini -->
              <div style="border:1px solid var(--border);border-radius:7px;overflow:hidden;margin-top:auto">
                <div id="${containerId}_ogph"
                  style="height:60px;background:linear-gradient(135deg,rgba(59,130,246,.06),rgba(139,92,246,.06));
                         display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--text3)">
                  🖼️ Preview ảnh
                </div>
                <img id="${containerId}_ogprevimg" src="" alt=""
                  style="width:100%;height:60px;object-fit:cover;display:none"/>
                <div style="padding:7px 9px;background:var(--bg3)">
                  <div id="${containerId}_ogdom" style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px">${getCreateDomainPreviewHost().toUpperCase()}</div>
                  <div id="${containerId}_ogptitle" style="font-size:12px;font-weight:700;color:var(--text);line-height:1.3">Tiêu đề sẽ hiện ở đây</div>
                  <div id="${containerId}_ogpdesc" style="font-size:10px;color:var(--text2);margin-top:2px">Mô tả sẽ hiện ở đây</div>
                </div>
              </div>
            </div>
          </div>`
        }
      </div>
    </div>

    <!-- Error -->
    <div class="ferr" id="${containerId}_err"></div>

    <!-- Result -->
    <div class="res-card" id="${containerId}_res">
      <div class="res-lbl">✅ Link rút gọn của bạn</div>
      <div class="res-row">
        <a class="res-url" id="${containerId}_resurl" href="#" target="_blank"></a>
        <button class="btn-cp" id="${containerId}_cpbtn" onclick="copyResult('${containerId}')">Sao chép</button>
      </div>
      <div class="res-meta" id="${containerId}_resmeta"></div>
      <div class="res-dl" id="${containerId}_resdl" style="display:none"></div>
    </div>
  </div>`;

        // Attach URL input events
        const urlIn = document.getElementById(`${containerId}_url`);
        if (urlIn) {
          urlIn.addEventListener("input", () => onUrlInput(containerId));
          urlIn.addEventListener("keydown", (e) => {
            if (e.key === "Enter") doShorten(containerId);
          });
        }
        updateCreateDomainDisplay(containerId);
      }

      function onUrlInput(cid) {
        const url = document.getElementById(`${cid}_url`)?.value.trim() || "";
        const det = document.getElementById(`${cid}_det`);
        if (!det) return;
        if (/shopee\.vn/i.test(url)) {
          det.className = "det shopee show";
          det.innerHTML =
            "🛒 Đã phát hiện link Shopee – Deeplink mở thẳng App!";
        } else if (/tiktok\.com/i.test(url)) {
          det.className = "det tiktok show";
          det.innerHTML =
            "🎵 Đã phát hiện link TikTok – Deeplink mở thẳng App!";
        } else {
          det.className = "det";
        }

        updateCreateDomainDisplay(cid);
        document.getElementById(`${cid}_res`)?.classList.remove("show");
        document.getElementById(`${cid}_err`)?.classList.remove("show");
      }

      function renderIntegrationsPage() {
        updateIntegrationUI();
      }

      function getTeamSeatLimit() {
        if (isAdminUser() || user?.plan === "business") return 10;
        if (user?.plan === "pro") return 5;
        if (user) return 3;
        return 1;
      }

      function getRoleFocus(role) {
        if (role === "owner") return "Chốt rule, domain và ưu tiên";
        if (role === "analyst") return "Đọc stats, rà hành vi và phản hồi";
        return "Tạo, sửa và tối ưu link / QR / bio";
      }

      function getRoleLabel(role) {
        if (role === "owner") return "Owner";
        if (role === "analyst") return "Analyst";
        return "Editor";
      }

      function getStatusLabel(status) {
        if (status === "pending") return "Đang chờ";
        if (status === "paused") return "Tạm dừng";
        return "Hoạt động";
      }

      function getDefaultTeamState() {
        const displayName = user ? getUserDisplayName(user) : "Workspace cá nhân";
        const members = user
          ? [
              {
                id: `owner-${user.id}`,
                name: displayName,
                email: user.email || "",
                role: "owner",
                status: "active",
                focus: getRoleFocus("owner"),
                lastSeen: "vừa xong",
              },
            ]
          : [];
        return {
          workspaceName: user ? `${displayName} Workspace` : "Workspace cá nhân",
          members,
        };
      }

      function normalizeTeamMember(member, fallbackId) {
        return {
          id: member?.id || fallbackId || `member-${Date.now()}`,
          name: String(member?.name || member?.email || "Teammate").trim(),
          email: String(member?.email || "").trim(),
          role: member?.role === "owner" || member?.role === "analyst" ? member.role : "editor",
          status:
            member?.status === "pending" || member?.status === "paused"
              ? member.status
              : "active",
          focus: String(member?.focus || getRoleFocus(member?.role)).trim(),
          lastSeen: String(member?.lastSeen || "mới cập nhật").trim(),
        };
      }

      function syncTeamOwner(state) {
        const nextState = {
          workspaceName: String(state?.workspaceName || "").trim(),
          members: Array.isArray(state?.members)
            ? state.members.map((member, index) =>
                normalizeTeamMember(member, `member-${index + 1}`),
              )
            : [],
        };

        if (!user) {
          if (!nextState.workspaceName) {
            nextState.workspaceName = "Workspace cá nhân";
          }
          return nextState;
        }

        const ownerId = `owner-${user.id}`;
        const ownerEmail = String(user.email || "").trim().toLowerCase();
        const existingIndex = nextState.members.findIndex(
          (member) =>
            member.id === ownerId ||
            (ownerEmail && member.email.toLowerCase() === ownerEmail),
        );
        const ownerMember = {
          id: ownerId,
          name: getUserDisplayName(user),
          email: user.email || "",
          role: "owner",
          status: "active",
          focus: getRoleFocus("owner"),
          lastSeen: "vừa xong",
        };

        if (existingIndex >= 0) {
          nextState.members.splice(existingIndex, 1);
        }
        nextState.members.unshift(ownerMember);
        nextState.workspaceName =
          nextState.workspaceName || `${getUserDisplayName(user)} Workspace`;
        return nextState;
      }

      function loadTeamState() {
        try {
          const raw = localStorage.getItem(teamStorageKey);
          teamState = syncTeamOwner(raw ? JSON.parse(raw) : getDefaultTeamState());
        } catch {
          teamState = syncTeamOwner(getDefaultTeamState());
        }
        localStorage.setItem(
          teamStorageKey,
          JSON.stringify({
            workspaceName: teamState.workspaceName,
            members: teamState.members,
          }),
        );
        return teamState;
      }

      function saveTeamState() {
        if (!teamState) {
          loadTeamState();
        }
        localStorage.setItem(
          teamStorageKey,
          JSON.stringify({
            workspaceName: teamState.workspaceName,
            members: teamState.members,
          }),
        );
      }

      function renderTeamMembers(members) {
        const body = document.getElementById("teamMemberBody");
        if (!body) return;

        if (!user) {
          body.innerHTML = `<tr><td colspan="6" class="tbl-empty">Đăng nhập để mời cộng tác viên. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Đăng nhập</a> hoặc <a href="${buildAuthUrl("register")}" style="color:var(--brand);font-weight:700">Đăng ký</a>.</td></tr>`;
          return;
        }

        if (!members.length) {
          body.innerHTML =
            '<tr><td colspan="6" class="tbl-empty">Chưa có thành viên nào trong workspace.</td></tr>';
          return;
        }

        body.innerHTML = members
          .map((member) => {
            const canRemove = member.role !== "owner";
            const nextLabel =
              member.role === "owner"
                ? "Owner"
                : member.status === "pending"
                  ? "Kích hoạt"
                  : member.status === "paused"
                    ? "Mở lại"
                    : "Tạm dừng";
            return `<tr>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px">
          <strong>${esc(member.name)}</strong>
          <span style="color:var(--text3);font-size:12px">${esc(member.email || "Chưa có email")}</span>
        </div>
      </td>
      <td><span class="badge-role ${member.role === "owner" ? "admin" : "user"}">${getRoleLabel(member.role)}</span></td>
      <td>${esc(getStatusLabel(member.status))}</td>
      <td style="max-width:240px;color:var(--text2)">${esc(member.focus)}</td>
      <td style="color:var(--text3);font-size:12px">${esc(member.lastSeen)}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="btn-cp" onclick="cycleTeamMemberStatus('${member.id}')">${nextLabel}</button>
        ${
          canRemove
            ? `<button class="btn-del" onclick="removeTeamMember('${member.id}')">Xóa</button>`
            : ""
        }
      </td>
    </tr>`;
          })
          .join("");
      }

      function renderTeamPage() {
        const state = loadTeamState();
        const members = state.members || [];
        const seatLimit = getTeamSeatLimit();
        const activeCount = members.filter((member) => member.status === "active").length;
        const pendingCount = members.filter((member) => member.status === "pending").length;
        const seatCount = document.getElementById("teamSeatCount");
        const seatHint = document.getElementById("teamSeatHint");
        const activeEl = document.getElementById("teamActiveCount");
        const pendingEl = document.getElementById("teamPendingCount");
        const workspaceName = document.getElementById("teamWorkspaceName");
        const workspaceStatus = document.getElementById("teamWorkspaceStatus");
        const ownerLabel = document.getElementById("teamOwnerLabel");
        const inviteHint = document.getElementById("teamInviteHint");
        const inviteBtn = document.getElementById("teamInviteBtn");
        const domainLabel = document.getElementById("teamDomainLabel");

        if (seatCount) seatCount.textContent = `${members.length}/${seatLimit}`;
        if (seatHint) {
          seatHint.textContent = user
            ? `${user.plan === "business" ? "Business" : user.plan === "pro" ? "Pro" : "Free"} workspace`
            : "Workspace cá nhân";
        }
        if (activeEl) activeEl.textContent = activeCount;
        if (pendingEl) pendingEl.textContent = pendingCount;
        if (workspaceName) workspaceName.textContent = state.workspaceName || "Workspace";
        if (workspaceStatus) {
          workspaceStatus.textContent = user
            ? `Seat đang dùng ${members.length}/${seatLimit} · Chủ workspace ${getUserDisplayName(user)}`
            : "Đăng nhập để mở team workspace thật sự.";
        }
        if (ownerLabel) {
          ownerLabel.textContent = user
            ? `Owner: ${getUserDisplayName(user)}`
            : "Owner: chưa đăng nhập";
        }
        if (inviteHint) {
          inviteHint.textContent = user
            ? "Mời editor/analyst trước, rồi dùng Team tab như một hub điều phối nhỏ."
            : "Đăng nhập để mời cộng tác viên và lưu team workspace.";
        }
        if (inviteBtn) {
          inviteBtn.textContent = user ? "Mời thành viên" : "Đăng nhập để mời";
        }
        if (domainLabel) {
          domainLabel.textContent = location.host || "boclink.click";
        }
        renderTeamMembers(members);
      }

      function inviteTeamMember() {
        if (!user) {
          redirectToAuth("register", "Đăng nhập để mời cộng tác viên.");
          return;
        }
        const emailInput = document.getElementById("teamInviteEmail");
        const roleInput = document.getElementById("teamInviteRole");
        const email = emailInput?.value.trim().toLowerCase() || "";
        const role = roleInput?.value || "editor";

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast("Nhập email hợp lệ trước khi mời.", "warn");
          emailInput?.focus();
          return;
        }

        teamState = loadTeamState();
        if ((teamState.members || []).some((member) => member.email.toLowerCase() === email)) {
          toast("Email này đã có trong workspace.", "warn");
          return;
        }

        teamState.members.push(
          normalizeTeamMember(
            {
              id: `invite-${Date.now()}`,
              name: email.split("@")[0],
              email,
              role,
              status: "pending",
              focus: getRoleFocus(role),
              lastSeen: "Chưa tham gia",
            },
            `invite-${Date.now()}`,
          ),
        );
        saveTeamState();
        renderTeamPage();
        if (emailInput) emailInput.value = "";
        toast("✅ Đã thêm lời mời vào workspace.", "ok");
      }

      function cycleTeamMemberStatus(memberId) {
        teamState = loadTeamState();
        const member = (teamState.members || []).find((item) => item.id === memberId);
        if (!member || member.role === "owner") return;
        member.status =
          member.status === "pending"
            ? "active"
            : member.status === "active"
              ? "paused"
              : "active";
        member.lastSeen =
          member.status === "active" ? "vừa cập nhật" : "đã tạm dừng";
        saveTeamState();
        renderTeamPage();
      }

      function removeTeamMember(memberId) {
        teamState = loadTeamState();
        const member = (teamState.members || []).find((item) => item.id === memberId);
        if (!member || member.role === "owner") return;
        showConfirmDialog({
          title: "Gỡ thành viên workspace",
          message: `Xóa ${member.email || member.name} khỏi workspace?`,
          confirmLabel: "Gỡ thành viên",
          tone: "danger",
        }).then((confirmed) => {
          if (!confirmed) return;
          teamState.members = teamState.members.filter((item) => item.id !== memberId);
          saveTeamState();
          renderTeamPage();
          toast("🗑️ Đã gỡ thành viên khỏi workspace.", "ok");
        });
      }

      function toggleMeta(cid) {
        const body = document.getElementById(`${cid}_metabody`);
        const arrow = document.getElementById(`${cid}_arrow`);
        if (!body) return;
        const isOpen =
          body.style.display !== "none" && body.style.display !== "";
        body.style.display = isOpen ? "none" : "block";
        if (arrow) arrow.style.transform = isOpen ? "" : "rotate(180deg)";
      }

      function onAliasInput(cid) {
        const input = document.getElementById(`${cid}_alias`);
        if (!input) return;
        const nextValue = slugifyAliasValue(input.value, 40);
        if (input.value !== nextValue) {
          input.value = nextValue;
        }
      }

      function onOgTitleInput(cid) {
        updateOgPreview(cid);
      }

      function normalizeOgTitleInput(cid) {
        const input = document.getElementById(`${cid}_ogtitle`);
        if (!input) return;
        const rawValue = input.value.trim();
        if (!rawValue) {
          input.value = "";
          updateOgPreview(cid);
          return;
        }
        if (looksLikeSlugTitle(rawValue)) {
          input.value = humanizeSlugTitle(rawValue).slice(0, 120);
        }
        updateOgPreview(cid);
      }

      function updateOgPreview(cid) {
        const t = document.getElementById(`${cid}_ogtitle`)?.value.trim() || "";
        const d = document.getElementById(`${cid}_ogdesc`)?.value.trim() || "";
        const i = document.getElementById(`${cid}_ogimg`)?.value.trim() || "";
        const pt = document.getElementById(`${cid}_ogptitle`);
        const pd = document.getElementById(`${cid}_ogpdesc`);
        const pi = document.getElementById(`${cid}_ogprevimg`);
        const ph = document.getElementById(`${cid}_ogph`);
        if (pt) pt.textContent = t || "Tiêu đề sẽ hiện ở đây";
        if (pd) pd.textContent = d || "Mô tả sẽ hiện ở đây";
        if (pi && ph) {
          if (i) {
            pi.src = i;
            pi.style.display = "block";
            ph.style.display = "none";
            pi.onerror = () => {
              pi.style.display = "none";
              ph.style.display = "flex";
            };
          } else {
            pi.style.display = "none";
            ph.style.display = "flex";
          }
        }
      }

      async function handleVideoUpload(event, cid) {
        const file = event.target.files[0];
        if (!file) return;
        // Show local preview immediately + extract thumb via canvas
        const preview = document.getElementById(cid + "_vpreview");
        if (preview) {
          preview.src = URL.createObjectURL(file);
          preview.style.display = "block";
          // Auto-extract thumbnail via canvas after video loads
          preview.onloadeddata = () =>
            extractThumbFromVideoElement(preview, cid);
        }
        // Upload to server
        const area = document.getElementById(cid + "_vuploadarea");
        if (area) area.style.borderColor = "var(--brand)";
        const fd = new FormData();
        fd.append("video", file);
        try {
          const r = await fetch("/api/upload-video", {
            method: "POST",
            body: fd,
          });
          const d = await r.json();
          if (!r.ok) {
            if (r.status === 401) {
              redirectToAuth("login", "Cần đăng nhập để upload video.");
              return;
            }
            if (r.status === 403 && d.upgrade) {
              toast(d.error || "Tính năng này yêu cầu gói Pro", "warn");
              return;
            }
            toast(d.error || "Upload video thất bại", "err");
            if (area) area.style.borderColor = "var(--border2)";
            return;
          }
          // Set video URL (Cloudinary URL is absolute, local is relative)
          const urlInput = document.getElementById(cid + "_videourl");
          if (urlInput)
            urlInput.value = d.url.startsWith("/")
              ? window.location.origin + d.url
              : d.url;
          // Auto-fill thumbnail from Cloudinary
          if (d.thumb) {
            const imgInput = document.getElementById(cid + "_ogimg");
            if (imgInput && !imgInput.value) {
              imgInput.value = d.thumb;
              updateVideoThumbPreview(cid);
            }
            toast("✅ Upload xong! Thumbnail đã tự động lấy từ video.", "ok");
          } else {
            toast("✅ Upload video thành công!", "ok");
          }
          if (area) area.style.borderColor = "var(--green)";
        } catch {
          toast("Lỗi upload video", "err");
          if (area) area.style.borderColor = "var(--border2)";
        }
      }

      // Extract thumbnail from <video> element via canvas
      function extractThumbFromVideoElement(videoEl, cid) {
        try {
          videoEl.currentTime = 1;
          videoEl.onseeked = () => {
            try {
              const canvas = document.createElement("canvas");
              canvas.width = 1200;
              canvas.height = 630;
              canvas.getContext("2d").drawImage(videoEl, 0, 0, 1200, 630);
              const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
              const imgInput = document.getElementById(cid + "_ogimg");
              if (imgInput && !imgInput.value) {
                imgInput.value = dataUrl;
                updateVideoThumbPreview(cid);
              }
            } catch (_) {}
          };
        } catch (_) {}
      }

      // Called when user types YouTube/video URL manually
      function onVideoUrlInput(cid) {
        const url =
          document.getElementById(cid + "_videourl")?.value.trim() || "";
        // Auto-extract YouTube thumb
        const ytMatch = url.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
        );
        if (ytMatch) {
          const imgInput = document.getElementById(cid + "_ogimg");
          if (imgInput && !imgInput.value) {
            const thumb = `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;
            imgInput.value = thumb;
            updateVideoThumbPreview(cid);
          }
        }
      }

      // Nút "🖼️ Thumb" – extract thumb theo URL hiện tại
      async function extractThumbFromUrl(cid) {
        const url =
          document.getElementById(cid + "_videourl")?.value.trim() || "";
        if (!url) {
          toast("Nhập URL video trước", "warn");
          return;
        }
        // YouTube
        const ytMatch = url.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
        );
        if (ytMatch) {
          const thumb = `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;
          const imgInput = document.getElementById(cid + "_ogimg");
          if (imgInput) {
            imgInput.value = thumb;
            updateVideoThumbPreview(cid);
          }
          toast("✅ Đã lấy thumbnail YouTube!", "ok");
          return;
        }
        // Direct video – canvas extract
        try {
          toast("⏳ Đang cắt thumbnail...", "ok");
          const vid = document.createElement("video");
          vid.src = url;
          vid.crossOrigin = "anonymous";
          vid.muted = true;
          vid.currentTime = 1;
          await new Promise((res, rej) => {
            vid.onseeked = res;
            vid.onerror = rej;
            setTimeout(rej, 8000);
            vid.load();
          });
          const canvas = document.createElement("canvas");
          canvas.width = 1200;
          canvas.height = 630;
          canvas.getContext("2d").drawImage(vid, 0, 0, 1200, 630);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          const imgInput = document.getElementById(cid + "_ogimg");
          if (imgInput) {
            imgInput.value = dataUrl;
            updateVideoThumbPreview(cid);
          }
          toast("✅ Đã cắt thumbnail từ video!", "ok");
        } catch (e) {
          toast("Không lấy được thumbnail: " + (e?.message || "lỗi"), "err");
        }
      }

      // Update thumb preview – now only in meta section (single source of truth)
      function updateVideoThumbPreview(cid) {
        const url = document.getElementById(cid + "_ogimg")?.value.trim() || "";
        // Open meta section if it has content so user can see the preview
        if (url) {
          const metaBody = document.getElementById(cid + "_metabody");
          if (metaBody && metaBody.style.display === "none") {
            metaBody.style.display = "block";
            const arrow = document.getElementById(cid + "_arrow");
            if (arrow) arrow.style.transform = "rotate(180deg)";
          }
        }
        // Sync to OG preview card
        updateOgPreview(cid);
      }
      async function handleFileUpload(event, cid) {
        const file = event.target.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append("image", file);
        try {
          const r = await fetch("/api/upload-image", {
            method: "POST",
            body: fd,
          });
          const d = await r.json();
          if (!r.ok) {
            if (r.status === 401) {
              redirectToAuth("login", "Cần đăng nhập để upload ảnh.");
              return;
            }
            if (r.status === 403 && d.upgrade) {
              toast(d.error || "Tính năng này yêu cầu gói Pro", "warn");
              return;
            }
            toast(d.error || "Upload thất bại", "err");
            return;
          }
          // Show preview
          const preview = document.getElementById(`${cid}_preview`);
          if (preview) {
            preview.src = d.url;
            preview.style.display = "block";
          }
          // Set image URL
          const imgInput = document.getElementById(`${cid}_ogimg`);
          if (imgInput)
            imgInput.value = d.url.startsWith("/")
              ? window.location.origin + d.url
              : d.url;
          updateOgPreview(cid);
          toast("✅ Upload ảnh thành công!", "ok");
        } catch {
          toast("Lỗi upload", "err");
        }
      }

      function onLinkTypeChange(cid) {
        const val = document.getElementById(cid + "_ltype")?.value;
        const vidSec = document.getElementById(cid + "_videosec");
        const plan = user?.plan || "free";
        const isAdm = plan === "admin" || user?.role === "admin";
        const canOg = plan === "pro" || plan === "business" || isAdm;

        // Kiểm tra quyền Video
        if (val === "video" && plan === "free" && !isAdm) {
          toast("🔒 Link Video yêu cầu gói Pro", "warn");
          const el = document.getElementById(cid + "_ltype");
          if (el) el.value = "direct";
          if (vidSec) vidSec.className = "video-sec";
          return;
        }

        // Hiện/ẩn video section
        if (vidSec)
          vidSec.className = "video-sec" + (val === "video" ? " show" : "");

        // Với deeplink và video: tự động mở meta section nếu có quyền
        if ((val === "deeplink" || val === "video") && canOg) {
          const metaBody = document.getElementById(cid + "_metabody");
          const arrow = document.getElementById(cid + "_arrow");
          if (metaBody && metaBody.style.display === "none") {
            metaBody.style.display = "block";
            if (arrow) arrow.style.transform = "rotate(180deg)";
          }
        }
      }
      function showAffiliateShortenPrompt(cid, message, mode = "guest") {
        const errEl = document.getElementById(`${cid}_err`);
        const resEl = document.getElementById(`${cid}_res`);
        if (!errEl) return;
        if (resEl) resEl.classList.remove("show");
        const safeMessage = esc(
          message || "Link affiliate cần xác nhận trước khi rút gọn",
        );
        if (mode === "confirm") {
          errEl.innerHTML =
            `${safeMessage} ` +
            `<span class="upgrade-link" onclick="navigate('pricing')">Xem gói Pro →</span>`;
          errEl.classList.add("show");
          return;
        }
        if (mode === "upgrade") {
          errEl.innerHTML =
            `${safeMessage} ` +
            `<span class="upgrade-link" onclick="doShorten('${cid}', true)">Tôi hiểu, tiếp tục</span>`;
        } else {
          errEl.innerHTML =
            `${safeMessage} ` +
            `<span class="upgrade-link" onclick="location.href='${buildAuthUrl("login")}'">Đăng nhập</span> ` +
            `<span class="upgrade-link" onclick="location.href='${buildAuthUrl("register")}'">Đăng ký</span>`;
        }
        errEl.classList.add("show");
      }

      async function doShorten(cid, confirmAffiliate = false) {
        const url = document.getElementById(`${cid}_url`)?.value.trim();
        const aliasInput = document.getElementById(`${cid}_alias`);
        const alias = slugifyAliasValue(aliasInput?.value || "", 40);
        if (aliasInput && aliasInput.value !== alias) aliasInput.value = alias;
        const titleInput = document.getElementById(`${cid}_ogtitle`);
        const normalizedOgTitle = looksLikeSlugTitle(titleInput?.value || "")
          ? humanizeSlugTitle(titleInput?.value || "").slice(0, 120)
          : String(titleInput?.value || "").trim();
        if (titleInput && titleInput.value.trim() !== normalizedOgTitle) {
          titleInput.value = normalizedOgTitle;
        }
        const og_title = normalizedOgTitle || "";
        const og_desc =
          document.getElementById(`${cid}_ogdesc`)?.value.trim() || "";
        const og_image =
          document.getElementById(`${cid}_ogimg`)?.value.trim() || "";
        const link_type =
          document.getElementById(`${cid}_ltype`)?.value || "direct";
        const domain_hostname = normalizeDomainChoice(
          document.getElementById(`${cid}_domain`)?.value || createDomainSelection || "",
        );
        const video_url =
          document.getElementById(`${cid}_videourl`)?.value.trim() || "";
        const video_overlay_text =
          document.getElementById(`${cid}_videotext`)?.value.trim() || "";
        const btn = document.getElementById(`${cid}_btn`);
        const errEl = document.getElementById(`${cid}_err`);
        const affiliateUrl = isAffiliateShortenUrl(url);
        const loggedInUser = !!user;
        const plan = user?.plan || "free";
        const hasAffiliateAccess =
          plan === "pro" ||
          plan === "business" ||
          plan === "admin" ||
          user?.role === "admin";

        updateOgPreview(cid);

        errEl.classList.remove("show");
        if (!url) {
          errEl.textContent = "Vui lòng nhập URL cần rút gọn";
          errEl.classList.add("show");
          return;
        }

        if (affiliateUrl && !loggedInUser) {
          showAffiliateShortenPrompt(
            cid,
            "Link affiliate cáº§n Ä‘Äƒng nháº­p hoáº·c Ä‘Äƒng kÃ½ Ä‘á»ƒ rÃºt gá»n",
            "guest",
          );
          return;
        }

        if (affiliateUrl && loggedInUser && !hasAffiliateAccess) {
          showAffiliateShortenPrompt(
            cid,
            "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn",
            "upgrade",
          );
          return;
        }

        if (affiliateUrl && hasAffiliateAccess) {
          confirmAffiliate = true;
        }

        if (affiliateUrl && !confirmAffiliate) {
          if (!loggedInUser) {
            showAffiliateShortenPrompt(
              cid,
              "Link affiliate cần đăng nhập hoặc đăng ký để rút gọn",
              "guest",
            );
          } else {
            showAffiliateShortenPrompt(
              cid,
              "Link affiliate cần xác nhận trước khi rút gọn",
              "confirm",
            );
          }
          return;
        }

        btn.disabled = true;
        btn.innerHTML = "⏳";
        try {
          const r = await fetch("/api/shorten", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              url,
              alias,
              og_title,
              og_desc,
              og_image,
              domain_hostname,
              link_type,
              video_url,
              video_overlay_text,
              confirm_affiliate: confirmAffiliate && affiliateUrl,
            }),
          });
          const data = await r.json();
          if (!r.ok) {
            if (r.status === 401 && data.authRequired) {
              showAffiliateShortenPrompt(
                cid,
                data.error || "Link affiliate cần đăng nhập hoặc đăng ký để rút gọn",
                "guest",
              );
              return;
            }
            if (r.status === 403 && data.affiliateUpgradeRequired) {
              showAffiliateShortenPrompt(
                cid,
                data.error || "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn",
                "upgrade",
              );
              return;
            }
            if (r.status === 428 && data.confirmationRequired) {
              showAffiliateShortenPrompt(
                cid,
                data.error || "Link affiliate cần xác nhận trước khi rút gọn",
                "confirm",
              );
              return;
            }
            errEl.innerHTML =
              data.error +
              (data.upgrade
                ? ` <span class="upgrade-link" onclick="navigate('pricing')">Xem gói Pro →</span>`
                : "");
            errEl.classList.add("show");
            return;
          }
          // Show result
          document.getElementById(`${cid}_resurl`).textContent = data.short_url;
          document.getElementById(`${cid}_resurl`).href = data.short_url;
          document.getElementById(`${cid}_resmeta`).textContent =
            "→ " + data.original_url;
          const dlEl = document.getElementById(`${cid}_resdl`);
          if (link_type === "video") {
            dlEl.style.display = "flex";
            dlEl.textContent = "🎬 Link video với overlay deeplink";
          } else if (/shopee\.vn/i.test(data.original_url)) {
            dlEl.style.display = "flex";
            dlEl.textContent = "📲 Mobile → mở thẳng Shopee App";
          } else if (/tiktok\.com/i.test(data.original_url)) {
            dlEl.style.display = "flex";
            dlEl.textContent = "📲 Mobile → mở thẳng TikTok App";
          } else dlEl.style.display = "none";
          document.getElementById(`${cid}_res`).classList.add("show");
          toast("✅ Tạo link thành công!", "ok");
          loadData();
        } catch {
          errEl.textContent = "Lỗi kết nối";
          errEl.classList.add("show");
        } finally {
          btn.disabled = false;
          btn.innerHTML =
            '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Rút gọn';
        }
      }

      async function copyResult(cid) {
        const url = document.getElementById(`${cid}_resurl`)?.textContent;
        if (!url) return;
        try {
          await navigator.clipboard.writeText(url);
        } catch {
          const t = document.createElement("textarea");
          t.value = url;
          document.body.appendChild(t);
          t.select();
          document.execCommand("copy");
          document.body.removeChild(t);
        }
        const btn = document.getElementById(`${cid}_cpbtn`);
        btn.textContent = "✓ Đã sao chép";
        btn.classList.add("ok");
        setTimeout(() => {
          btn.textContent = "Sao chép";
          btn.classList.remove("ok");
        }, 2000);
        toast("📋 Đã sao chép!", "ok");
      }

      // ══════════════════════════════════════════════════
      //  DATA
      // ══════════════════════════════════════════════════
      async function loadData() {
        try {
          const r = await fetch("/api/stats");
          const d = await r.json();
          statsAnalytics = d.analytics || null;
          links = d.recent || [];
          selectedLinkIds = new Set(
            [...selectedLinkIds].filter((id) =>
              links.some((link) => Number(link.id) === Number(id)),
            ),
          );
          document.getElementById("dClicks").textContent = (
            d.totalClicks || 0
          ).toLocaleString();
          document.getElementById("dLinks").textContent = (
            d.totalLinks || 0
          ).toLocaleString();
          if (document.getElementById("dClicksToday"))
            document.getElementById("dClicksToday").textContent = (
              d.clicksToday || 0
            ).toLocaleString();
          if (document.getElementById("dLinksToday"))
            document.getElementById("dLinksToday").textContent = (
              d.linksToday || 0
            ).toLocaleString();
          // Stats page
          if (document.getElementById("stTotalClicks"))
            document.getElementById("stTotalClicks").textContent = (
              d.totalClicks || 0
            ).toLocaleString();
          if (document.getElementById("stClicksToday"))
            document.getElementById("stClicksToday").textContent = (
              d.clicksToday || 0
            ).toLocaleString();
          if (document.getElementById("stTotalLinks"))
            document.getElementById("stTotalLinks").textContent = (
              d.totalLinks || 0
            ).toLocaleString();
          if (document.getElementById("stLinksToday"))
            document.getElementById("stLinksToday").textContent = (
              d.linksToday || 0
            ).toLocaleString();
          document.getElementById("navCount").textContent = d.totalLinks || 0;
          document.getElementById("linkCountLabel").textContent =
            d.totalLinks || 0;
          document.getElementById("dShopee").textContent = links.filter((l) =>
            /shopee\.vn/i.test(l.original_url),
          ).length;
          document.getElementById("dTiktok").textContent = links.filter((l) =>
            /tiktok\.com/i.test(l.original_url),
          ).length;
          renderActivity(links, "dashActivity");
          renderActivity(links, "createActivity");
          renderChart();
          if (document.getElementById("page-qr")?.classList.contains("active"))
            renderQrPage();
          if (document.getElementById("page-bio")?.classList.contains("active"))
            renderBioPage();
          if (
            document.getElementById("page-integrations")?.classList.contains("active")
          )
            renderIntegrationsPage();
          if (document.getElementById("page-team")?.classList.contains("active"))
            renderTeamPage();
          if (document.getElementById("page-links")?.classList.contains("active"))
            applyLinkFilters();
          enqueueStatsAlerts(d);
          rememberStatsNotificationSnapshot(d);
        } catch {}
      }

      function renderActivity(arr, id) {
        const el = document.getElementById(id);
        if (!el) return;
        if (!arr.length) {
          el.innerHTML = '<div class="act-empty">Chưa có hoạt động nào</div>';
          return;
        }
        const icons = { shopee: "🛒", tiktok: "🎵", generic: "🔗" };
        el.innerHTML = arr
          .slice(0, 8)
          .map((l) => {
            const p = pt(l.original_url);
            return `<div class="ai">
      <div class="ai-ic ${p}">${icons[p]}</div>
      <div class="ai-info">
        <div class="ai-short">${(l.short_url || "").replace(/^https?:\/\//, "")}</div>
        <div class="ai-orig">${l.original_url || ""}</div>
      </div>
      <div class="ai-clicks">👁 ${l.clicks || 0}</div>
    </div>`;
          })
          .join("");
      }

      function renderTable(arr) {
        const tb = document.getElementById("tblBody");
        currentFilteredLinks = Array.isArray(arr) ? arr.slice() : [];
        if (!arr.length) {
          tb.innerHTML =
            '<tr><td colspan="8" class="tbl-empty">Chưa có link. <span style="color:var(--brand);cursor:pointer" onclick="navigate(\'create\')">Tạo ngay →</span></td></tr>';
          syncLinkBulkToolbar(currentFilteredLinks);
          return;
        }
        const lbl = {
          shopee: "🛒 Shopee",
          tiktok: "🎵 TikTok",
          generic: "🔗 Generic",
        };
        tb.innerHTML = arr
          .map((l) => {
            const p = pt(l.original_url);
            const short = (l.short_url || "").replace(/^https?:\/\//, "");
            const date = (l.created_at || "").substring(0, 10);
            const linkId = Number(l.id);
            const isSelected = selectedLinkIds.has(linkId);
            return `<tr data-link-id="${linkId}" class="${isSelected ? "is-selected" : ""}">
      <td class="td-check">
        <label class="tbl-check">
          <input type="checkbox" ${isSelected ? "checked" : ""} onchange="toggleLinkSelection(${linkId}, this.checked)"/>
          <span></span>
        </label>
      </td>
      <td><a class="td-link" href="${l.short_url || "#"}" target="_blank">${short}</a></td>
      <td class="td-orig" title="${l.original_url || ""}">${l.original_url || ""}</td>
      <td><span class="pill ${p}">${lbl[p]}</span></td>
      <td>${l.og_title ? `<span style="font-size:11px;color:var(--green)">✅ ${esc(l.og_title).substring(0, 20)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="font-weight:700;color:var(--text)">${l.clicks || 0}</td>
      <td style="color:var(--text3)">${date}</td>
      <td style="display:flex;gap:5px">
        <button class="btn-cp" onclick="copyClip('${l.short_url || ""}')">📋</button>
        <button class="btn-cp" onclick="openEditModal(${l.id})" style="color:var(--brand)" title="Chỉnh sửa">✏️</button>
        <button class="btn-cp" onclick="deleteMyLink(${l.id},'${(l.short_url || "").replace(/^https?:\/\//, "")}')" style="color:var(--red);border-color:rgba(239,68,68,.2)" title="Xóa">🗑️</button>
      </td>
    </tr>`;
          })
          .join("");
        syncLinkBulkToolbar(currentFilteredLinks);
      }

      function syncLinkBulkToolbar(arr = currentFilteredLinks) {
        const visibleLinks = Array.isArray(arr) ? arr : [];
        currentFilteredLinks = visibleLinks.slice();
        const visibleIds = visibleLinks
          .map((link) => Number(link.id))
          .filter((id) => Number.isFinite(id));
        const visibleSelectedCount = visibleIds.filter((id) =>
          selectedLinkIds.has(id),
        ).length;
        const totalSelectedCount = selectedLinkIds.size;
        const bar = document.getElementById("linkBulkBar");
        const status = document.getElementById("linkBulkStatus");
        const clearBtn = document.getElementById("linkClearSelectionBtn");
        const deleteBtn = document.getElementById("linkBulkDeleteBtn");
        const selectAll = document.getElementById("tblSelectAll");

        if (bar) {
          bar.classList.toggle("active", totalSelectedCount > 0);
        }
        if (status) {
          if (totalSelectedCount > 0) {
            status.textContent =
              visibleSelectedCount === totalSelectedCount
                ? `Đã chọn ${totalSelectedCount} link`
                : `Đã chọn ${totalSelectedCount} link, ${visibleSelectedCount} link đang hiện trong bộ lọc`;
          } else {
            status.textContent = `Đang hiển thị ${visibleLinks.length} link`;
          }
        }
        if (clearBtn) clearBtn.disabled = totalSelectedCount === 0;
        if (deleteBtn) deleteBtn.disabled = totalSelectedCount === 0;
        if (selectAll) {
          selectAll.checked =
            visibleIds.length > 0 && visibleSelectedCount === visibleIds.length;
          selectAll.indeterminate =
            visibleSelectedCount > 0 && visibleSelectedCount < visibleIds.length;
        }
      }

      function toggleLinkSelection(linkId, checked) {
        const normalizedId = Number(linkId);
        if (!Number.isFinite(normalizedId)) return;
        if (checked) {
          selectedLinkIds.add(normalizedId);
        } else {
          selectedLinkIds.delete(normalizedId);
        }
        const row = document.querySelector(`tr[data-link-id="${normalizedId}"]`);
        if (row) row.classList.toggle("is-selected", checked);
        syncLinkBulkToolbar();
      }

      function toggleSelectAllVisibleLinks(checked) {
        currentFilteredLinks.forEach((link) => {
          const normalizedId = Number(link.id);
          if (!Number.isFinite(normalizedId)) return;
          if (checked) {
            selectedLinkIds.add(normalizedId);
          } else {
            selectedLinkIds.delete(normalizedId);
          }
        });
        renderTable(currentFilteredLinks);
      }

      function clearSelectedLinks() {
        if (!selectedLinkIds.size) return;
        selectedLinkIds = new Set();
        renderTable(currentFilteredLinks);
      }

      async function bulkDeleteSelectedLinks() {
        const ids = [...selectedLinkIds];
        if (!ids.length) {
          toast("Chưa chọn link nào để xóa", "warn");
          return;
        }
        const confirmed = await showConfirmDialog({
          title: "Xóa nhiều liên kết",
          message: `Xóa ${ids.length} link đã chọn?`,
          note: "Hành động này không thể hoàn tác.",
          confirmLabel: "Xóa đã chọn",
          tone: "danger",
        });
        if (!confirmed) {
          return;
        }
        try {
          const response = await fetch("/api/links/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            toast(data.error || "Xóa hàng loạt thất bại", "err");
            return;
          }
          selectedLinkIds = new Set();
          const deletedCount = Number(data.deleted_count || 0);
          const skippedCount = Number(data.skipped_count || 0);
          toast(
            skippedCount
              ? `Đã xóa ${deletedCount} link, bỏ qua ${skippedCount} link`
              : `Đã xóa ${deletedCount} link`,
            "ok",
          );
          loadData();
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      function filterTable(q) {
        linkSearchQuery = (q || "").toLowerCase();
        applyLinkFilters();
      }

      async function copyClip(url) {
        try {
          await navigator.clipboard.writeText(url);
        } catch {}
        toast("📋 Đã sao chép: " + url.replace(/^https?:\/\//, ""), "ok");
      }

      function generateQr() {
        const input = document.getElementById("qrUrlInput");
        const wrap = document.getElementById("qrPreviewWrap");
        const hint = document.getElementById("qrPreviewHint");
        if (!input || !wrap) return;
        const value = input.value.trim();
        if (!value) {
          toast("Nhập URL trước", "warn");
          return;
        }
        const size = parseInt(
          document.getElementById("qrSizeSelect")?.value || "320",
          10,
        );
        const color =
          document.getElementById("qrColorSelect")?.value || "#3b82f6";
        wrap.innerHTML = "";
        if (window.QRCodeStyling) {
          qrStyler = new QRCodeStyling({
            width: size,
            height: size,
            type: "svg",
            data: value,
            image: "/favicon.svg",
            dotsOptions: { color, type: "rounded" },
            cornersSquareOptions: { color, type: "extra-rounded" },
            cornersDotOptions: { color, type: "dot" },
            backgroundOptions: { color: "#ffffff" },
            imageOptions: { crossOrigin: "anonymous", margin: 8 },
            qrOptions: { errorCorrectionLevel: "Q" },
          });
          qrStyler.append(wrap);
        } else {
          wrap.innerHTML = `<img alt="QR" src="https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&color=${color.replace("#", "")}&bgcolor=ffffff" />`;
        }
        qrRenderedText = value;
        if (hint) hint.textContent = `Đang tạo cho ${value.replace(/^https?:\/\//, "")}`;
      }

      async function copyQrUrl() {
        const input = document.getElementById("qrUrlInput");
        const url = input?.value.trim();
        if (!url) {
          toast("Không có URL để sao chép", "warn");
          return;
        }
        try {
          await navigator.clipboard.writeText(url);
          toast("📋 Đã sao chép URL QR", "ok");
        } catch {
          toast("Không thể sao chép", "err");
        }
      }

      function downloadQr(extension = "png") {
        if (qrStyler && typeof qrStyler.download === "function") {
          qrStyler.download({ name: "boclink-qr", extension });
          return;
        }
        const img = document.querySelector("#qrPreviewWrap img");
        const url = img?.src;
        if (!url) {
          toast("Tạo QR trước khi tải", "warn");
          return;
        }
        const a = document.createElement("a");
        a.href = url;
        a.download = "boclink-qr.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }

      function updateBioPreview() {
        const slug = document.getElementById("bioSlugInput")?.value.trim() || "";
        const title = document.getElementById("bioTitleInput")?.value.trim() || "";
        const subtitle =
          document.getElementById("bioSubtitleInput")?.value.trim() || "";
        const avatar = document.getElementById("bioAvatarInput")?.value.trim() || "";
        const accent = document.getElementById("bioAccentInput")?.value || "#3b82f6";
        const previewTitle = document.getElementById("bioTitlePreview");
        const previewSubtitle = document.getElementById("bioSubtitlePreview");
        const previewAvatar = document.getElementById("bioAvatar");
        const cover = document.getElementById("bioCover");
        const linksWrap = document.getElementById("bioLinksPreview");
        const statLinks = document.getElementById("bioStatLinks");
        const statAccent = document.getElementById("bioStatAccent");
        const publicUrl = document.getElementById("bioPublicUrl");
        if (!previewTitle || !previewSubtitle || !previewAvatar || !cover || !linksWrap) return;

        previewTitle.textContent = title || "Bio của tôi";
        previewSubtitle.textContent =
          subtitle || "Mô tả ngắn sẽ xuất hiện ở đây.";
        cover.style.background = `linear-gradient(135deg, ${accent}, var(--purple))`;
        previewAvatar.style.background = `linear-gradient(135deg, ${accent}, var(--purple))`;
        previewAvatar.style.backgroundImage = "";
        previewAvatar.style.backgroundSize = "";
        previewAvatar.style.backgroundPosition = "";
        if (avatar && /^https?:\/\//i.test(avatar)) {
          previewAvatar.textContent = "";
          previewAvatar.style.backgroundImage = `url("${avatar}")`;
          previewAvatar.style.backgroundSize = "cover";
          previewAvatar.style.backgroundPosition = "center";
        } else {
          previewAvatar.textContent =
            avatar || (previewTitle.textContent || "B").charAt(0).toUpperCase();
        }
        if (statAccent) statAccent.textContent = accent;
        if (publicUrl) {
          const finalSlug = normalizeBioSlug(slug, getDefaultBioConfig().slug);
          publicUrl.innerHTML = user?.id
            ? `Public route: <a href="/u/${finalSlug}" target="_blank" rel="noreferrer" style="color:var(--brand);font-weight:700">/u/${finalSlug}</a>`
            : `Đăng nhập để xuất bản public route. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Đăng nhập</a> hoặc <a href="${buildAuthUrl("register")}" style="color:var(--brand);font-weight:700">Đăng ký</a>. Preview slug: <strong style="color:var(--brand)">/u/${finalSlug}</strong>`;
        }

        const visibleLinks = getBioPreviewLinks();
        if (statLinks) statLinks.textContent = `${visibleLinks.length} links`;
        if (!visibleLinks.length) {
          linksWrap.innerHTML =
            '<div class="act-empty">Chưa có link để hiển thị trong bio.</div>';
          renderBioManager();
          return;
        }
        linksWrap.innerHTML = visibleLinks
          .map((l) => {
            const url = (l.short_url || l.original_url || "").replace(/^https?:\/\//, "");
            const orig = l.original_url || "";
            return `<a class="bio-link" href="${l.short_url || "#"}" target="_blank" rel="noreferrer">
              <span>
                ${esc(url)}
                <small>${esc(orig)}</small>
              </span>
              <span>↗</span>
            </a>`;
          })
          .join("");
        renderBioManager();
      }

      function matchesLinkFilter(link, filter) {
        const p = pt(link.original_url);
        if (filter === "all") return true;
        if (filter === "video") return (link.link_type || "") === "video";
        return p === filter;
      }

      function setLinkFilter(filter, el) {
        linkTypeFilter = filter;
        document
          .querySelectorAll(".chip[data-filter]")
          .forEach((chip) => chip.classList.remove("active"));
        el.classList.add("active");
        applyLinkFilters();
      }

      function applyLinkFilters() {
        const filtered = links.filter(
          (l) =>
            matchesLinkFilter(l, linkTypeFilter) &&
            (!linkSearchQuery ||
              (l.short_url || "").toLowerCase().includes(linkSearchQuery) ||
              (l.original_url || "").toLowerCase().includes(linkSearchQuery) ||
              (l.og_title || "").toLowerCase().includes(linkSearchQuery)),
        );
        const countEl = document.getElementById("linkCountLabel");
        if (countEl) countEl.textContent = filtered.length;
        renderTable(filtered);
      }

      // ══════════════════════════════════════════════════
      //  CHART
      // ══════════════════════════════════════════════════
      function setChartDays(n, btn) {
        chartDays = n;
        document
          .querySelectorAll(".cf")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderChart();
      }

      function renderChart() {
        const ctx = document.getElementById("clickChart");
        if (!ctx) return;
        const labels = [],
          vals = [];
        const now = new Date();
        for (let i = chartDays - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          labels.push(
            d.toLocaleDateString("vi", { day: "2-digit", month: "2-digit" }),
          );
          vals.push(0);
        }
        links.forEach((l) => {
          if (!l.created_at) return;
          const diff = Math.floor((now - new Date(l.created_at)) / 86400000);
          const idx = chartDays - 1 - diff;
          if (idx >= 0 && idx < chartDays) vals[idx] += l.clicks || 0;
        });
        if (chart) chart.destroy();
        chart = new Chart(ctx, {
          type: "line",
          data: {
            labels,
            datasets: [
              {
                data: vals,
                borderColor: "#3b82f6",
                backgroundColor: "rgba(59,130,246,.08)",
                fill: true,
                tension: 0.4,
                pointBackgroundColor: "#3b82f6",
                pointRadius: 3,
                pointHoverRadius: 5,
                borderWidth: 2,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: "#1e2535",
                borderColor: "#2a3347",
                borderWidth: 1,
                titleColor: "#e2e8f0",
                bodyColor: "#94a3b8",
                padding: 10,
              },
            },
            scales: {
              x: {
                grid: { color: "rgba(255,255,255,.03)" },
                ticks: { color: "#4b5563", font: { size: 11 } },
              },
              y: {
                grid: { color: "rgba(255,255,255,.03)" },
                ticks: { color: "#4b5563", font: { size: 11 }, stepSize: 1 },
                beginAtZero: true,
              },
            },
          },
        });
      }

      // ══════════════════════════════════════════════════
      //  PRICING UI
      // ══════════════════════════════════════════════════
      function updatePricingUI() {
        const plan = user?.plan || "guest";
        ["free", "pro", "business"].forEach((p) => {
          const card = document.getElementById(
            `plan${p.charAt(0).toUpperCase() + p.slice(1)}Card`,
          );
          const btn = document.getElementById(
            `plan${p.charAt(0).toUpperCase() + p.slice(1)}Btn`,
          );
          if (!card || !btn) return;
          const isCurrent =
            (p === "free" && (plan === "free" || plan === "guest")) ||
            plan === p;
          if (isCurrent) {
            let b = card.querySelector(".current-plan-badge");
            if (!b) {
              b = document.createElement("div");
              b.className = "current-plan-badge";
              card.insertBefore(b, card.firstChild);
            }
            b.textContent = "✓ Gói hiện tại";
            btn.textContent = "Gói hiện tại";
            btn.disabled = true;
          }
        });
      }

      function contactUpgrade(plan) {
        toast(
          `📩 Liên hệ Zalo 0969.361.607 để nâng cấp gói ${plan.toUpperCase()}`,
          "warn",
        );
      }

      // ══════════════════════════════════════════════════
      //  SEARCH (topbar)
      // ══════════════════════════════════════════════════
      function onSearch(q) {
        if (
          q &&
          !document.getElementById("page-links").classList.contains("active")
        ) {
          navigate(
            "links",
            document.querySelector("[onclick*=\"navigate('links'\"]"),
          );
        }
        filterTable(q);
      }

      // Ctrl+K
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
          e.preventDefault();
          document.getElementById("tbSearch").focus();
        }
      });

      // ══════════════════════════════════════════════════
      //  UTILS
      // ══════════════════════════════════════════════════
      function pt(url) {
        if (!url) return "generic";
        if (/shopee\.vn/i.test(url)) return "shopee";
        if (/tiktok\.com/i.test(url)) return "tiktok";
        return "generic";
      }
      function esc(s) {
        return (s || "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      }
      function toast(msg, type = "ok") {
        const t = document.getElementById("toast");
        t.textContent = msg;
        t.className = "toast show " + type;
        setTimeout(() => (t.className = "toast"), 2600);
      }

      // Ctrl+K
      document.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === "k") {
          e.preventDefault();
          document.getElementById("tbSearch").focus();
        }
      });
      document
        .getElementById("tbSearch")
        .addEventListener("input", function () {
          const q = this.value.trim();
          if (
            q &&
            !document.getElementById("page-links").classList.contains("active")
          )
            navigate(
              "links",
              document.querySelector("[onclick*=\"navigate('links'\"]"),
            );
          filterTable(q);
        });

      // ══════════════════════════════════════════════════
      //  STATS PAGE
      // ══════════════════════════════════════════════════
      let statsChartInst = null;
      let platformChartInst = null;

      function getStatsDayKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
      }

      function formatStatsDayLabel(dayKey) {
        const [year, month, day] = String(dayKey || "").split("-");
        if (!year || !month || !day) return dayKey || "";
        return `${day}/${month}`;
      }

      function getFallbackPlatformDistribution() {
        const rows = [
          {
            key: "shopee",
            label: "Shopee",
            color: "#ee4d2d",
            clicks: links.filter((l) => /shopee\.vn/i.test(l.original_url)).length,
          },
          {
            key: "tiktok",
            label: "TikTok",
            color: "#69c9d0",
            clicks: links.filter((l) => /tiktok\.com/i.test(l.original_url)).length,
          },
          {
            key: "video",
            label: "Video Overlay",
            color: "#f59e0b",
            clicks: links.filter((l) => (l.link_type || "") === "video").length,
          },
        ];
        const genericCount = Math.max(
          links.length - rows.reduce((sum, row) => sum + row.clicks, 0),
          0,
        );
        rows.push({
          key: "generic",
          label: "Khác",
          color: "#6366f1",
          clicks: genericCount,
        });
        const total = rows.reduce((sum, row) => sum + row.clicks, 0);
        return rows
          .filter((row) => row.clicks > 0)
          .map((row) => ({
            ...row,
            percent: total ? Math.round((row.clicks / total) * 1000) / 10 : 0,
          }))
          .sort((a, b) => b.clicks - a.clicks);
      }

      function getStatsTimelineSeries() {
        const labels = [];
        const vals = [];
        const timelineMap = new Map(
          (statsAnalytics?.timeline || []).map((item) => [
            String(item.date || ""),
            Number(item.clicks || 0),
          ]),
        );
        const hasTimeline = [...timelineMap.values()].some((value) => value > 0);
        const now = new Date();
        for (let i = chartDays - 1; i >= 0; i--) {
          const d = new Date(now);
          d.setDate(d.getDate() - i);
          const dayKey = getStatsDayKey(d);
          labels.push(formatStatsDayLabel(dayKey));
          vals.push(hasTimeline ? timelineMap.get(dayKey) || 0 : 0);
        }
        if (!hasTimeline) {
          links.forEach((l) => {
            if (!l.created_at) return;
            const diff = Math.floor((now - new Date(l.created_at)) / 86400000);
            const idx = chartDays - 1 - diff;
            if (idx >= 0 && idx < chartDays) vals[idx] += l.clicks || 0;
          });
        }
        return { labels, vals };
      }

      function renderStatsCountryMap() {
        const mapEl = document.getElementById("statsCountryMap");
        const summaryEl = document.getElementById("statsGeoSummary");
        if (!mapEl) return;
        const geo = statsAnalytics?.geo || {};
        const countries = Array.isArray(geo.countries)
          ? geo.countries.filter((item) => item.country_name_en && item.clicks > 0)
          : [];
        const trackedClicks = Number(geo.tracked_clicks || 0);
        const totalClicks = Number(statsAnalytics?.total_clicks || 0);

        if (summaryEl) {
          summaryEl.textContent = trackedClicks
            ? `${trackedClicks}/${totalClicks || trackedClicks} click có quốc gia`
            : "Chưa có dữ liệu địa lý";
        }

        if (!countries.length) {
          if (window.Plotly?.purge) window.Plotly.purge(mapEl);
          mapEl.innerHTML =
            '<div class="stats-map-empty">Chưa có dữ liệu quốc gia để hiển thị.<br/>Các click mới có header địa lý từ proxy/CDN sẽ tự hiện ở đây.</div>';
          return;
        }

        if (!window.Plotly) {
          mapEl.innerHTML =
            '<div class="stats-map-empty">Không tải được thư viện bản đồ để vẽ quốc gia.</div>';
          return;
        }

        mapEl.innerHTML = "";
        window.Plotly.react(
          mapEl,
          [
            {
              type: "choropleth",
              locationmode: "country names",
              locations: countries.map((item) => item.country_name_en),
              z: countries.map((item) => Number(item.clicks || 0)),
              text: countries.map(
                (item) => `${item.country_name}: ${(item.clicks || 0).toLocaleString()} click`,
              ),
              hovertemplate: "%{text}<extra></extra>",
              showscale: false,
              colorscale: [
                [0, "rgba(148,163,184,0.18)"],
                [0.35, "rgba(96,165,250,0.55)"],
                [1, "rgba(37,99,235,0.95)"],
              ],
              marker: {
                line: {
                  color: "rgba(255,255,255,0.22)",
                  width: 0.4,
                },
              },
            },
          ],
          {
            paper_bgcolor: "transparent",
            plot_bgcolor: "transparent",
            margin: { l: 0, r: 0, t: 0, b: 0 },
            geo: {
              scope: "world",
              projection: { type: "equirectangular" },
              showframe: false,
              showcoastlines: false,
              showcountries: true,
              countrycolor: "rgba(148,163,184,0.22)",
              bgcolor: "transparent",
              lakecolor: "transparent",
            },
          },
          {
            displayModeBar: false,
            responsive: true,
          },
        );
      }

      function renderStatsCountryTable() {
        const tb = document.getElementById("statsCountryBody");
        if (!tb) return;
        const rows = Array.isArray(statsAnalytics?.geo?.top_countries)
          ? statsAnalytics.geo.top_countries
          : [];
        if (!rows.length) {
          tb.innerHTML =
            '<tr><td colspan="3" class="tbl-empty">Chưa có click nào có dữ liệu quốc gia.</td></tr>';
          return;
        }
        tb.innerHTML = rows
          .map(
            (country, index) => `<tr>
      <td><span class="stats-rank">${index + 1}</span>${esc(country.country_name || country.country_code || "Không rõ")}</td>
      <td>${esc(country.city || "Không rõ")}</td>
      <td style="font-weight:700;color:var(--text)">${Number(country.clicks || 0).toLocaleString()}</td>
    </tr>`,
          )
          .join("");
      }

      function renderStatsPlatformChart() {
        const ctx = document.getElementById("platformChart");
        const summaryEl = document.getElementById("statsPlatformSummary");
        if (!ctx) return;
        const distribution =
          statsAnalytics?.platforms?.distribution?.length
            ? statsAnalytics.platforms.distribution
            : getFallbackPlatformDistribution();
        const usingFallback = !statsAnalytics?.platforms?.distribution?.length;
        if (summaryEl) {
          const totalClicks = Number(statsAnalytics?.total_clicks || 0);
          summaryEl.textContent = usingFallback
            ? "Chưa có click, đang tạm dùng phân bố link"
            : `${totalClicks.toLocaleString()} click đã được phân loại`;
        }
        if (platformChartInst) platformChartInst.destroy();
        platformChartInst = new Chart(ctx, {
          type: "bar",
          data: {
            labels: distribution.map((item) => item.label),
            datasets: [
              {
                data: distribution.map((item) => item.clicks),
                backgroundColor: distribution.map((item) => item.color),
                borderRadius: 10,
                borderSkipped: false,
              },
            ],
          },
          options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: "#1e2535",
                borderColor: "#2a3347",
                borderWidth: 1,
                titleColor: "#e2e8f0",
                bodyColor: "#94a3b8",
                callbacks: {
                  label: (context) => `${context.raw || 0} click`,
                },
              },
            },
            scales: {
              x: {
                grid: { color: "rgba(255,255,255,.03)" },
                ticks: {
                  color: "#4b5563",
                  font: { size: 11 },
                  precision: 0,
                },
                beginAtZero: true,
              },
              y: {
                grid: { display: false },
                ticks: { color: "#94a3b8", font: { size: 12, weight: "600" } },
              },
            },
          },
        });
      }

      function renderStatsPlatformTable() {
        const tb = document.getElementById("statsPlatformBody");
        if (!tb) return;
        const rows =
          statsAnalytics?.platforms?.top_platforms?.length
            ? statsAnalytics.platforms.top_platforms
            : getFallbackPlatformDistribution();
        if (!rows.length) {
          tb.innerHTML =
            '<tr><td colspan="3" class="tbl-empty">Chưa có dữ liệu nền tảng.</td></tr>';
          return;
        }
        tb.innerHTML = rows
          .map(
            (platform, index) => `<tr>
      <td>
        <span class="stats-rank">${index + 1}</span>
        <span class="stats-pill">
          <span class="stats-pill-dot" style="background:${esc(platform.color || "#3b82f6")}"></span>
          ${esc(platform.label || "Khác")}
        </span>
      </td>
      <td>${Number(platform.percent || 0).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</td>
      <td style="font-weight:700;color:var(--text)">${Number(platform.clicks || 0).toLocaleString()}</td>
    </tr>`,
          )
          .join("");
      }

      function renderStatsPage() {
        // Numbers already filled by loadData()
        // Render chart on statsChart canvas
        const ctx = document.getElementById("statsChart");
        if (ctx) {
          const { labels, vals } = getStatsTimelineSeries();
          if (statsChartInst) statsChartInst.destroy();
          statsChartInst = new Chart(ctx, {
            type: "line",
            data: {
              labels,
              datasets: [
                {
                  data: vals,
                  borderColor: "#3b82f6",
                  backgroundColor: "rgba(59,130,246,.08)",
                  fill: true,
                  tension: 0.4,
                  pointBackgroundColor: "#3b82f6",
                  pointRadius: 3,
                  pointHoverRadius: 5,
                  borderWidth: 2,
                },
              ],
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: {
                x: {
                  grid: { color: "rgba(255,255,255,.03)" },
                  ticks: { color: "#4b5563", font: { size: 11 } },
                },
                y: {
                  grid: { color: "rgba(255,255,255,.03)" },
                  ticks: { color: "#4b5563", font: { size: 11 }, stepSize: 1 },
                  beginAtZero: true,
                },
              },
            },
          });
        }
        renderStatsCountryMap();
        renderStatsCountryTable();
        renderStatsPlatformChart();
        renderStatsPlatformTable();
      }

      // ══════════════════════════════════════════════════
      //  DELETE OWN LINK
      // ══════════════════════════════════════════════════
      async function deleteMyLink(id, shortDisplay) {
        const confirmed = await showConfirmDialog({
          title: "Xóa liên kết",
          message: `Xóa link "${shortDisplay}"?`,
          note: "Hành động này không thể hoàn tác.",
          confirmLabel: "Xóa link",
          tone: "danger",
        });
        if (!confirmed)
          return;
        try {
          const r = await fetch("/api/links/" + id, { method: "DELETE" });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Xóa thất bại", "err");
            return;
          }
          selectedLinkIds.delete(Number(id));
          toast("🗑️ Đã xóa link", "ok");
          loadData();
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      // ══════════════════════════════════════════════════
      //  ADMIN DATA
      // ══════════════════════════════════════════════════
      let adminLinks = [];
      let adminUsers = [];
      let adminDomains = [];
      let adminRedirects = [];
      let adminSection = "overview";
      let adminUserSearchQuery = "";
      let adminUserPlanFilter = "all";
      let adminUserPage = 1;
      let adminRedirectPage = 1;
      let adminSelectedUserIds = new Set();
      const ADMIN_PAGE_SIZE = 20;

      function syncAdminSectionUI() {
        const availableSections = new Set([
          "overview",
          "users",
          "system",
          "logs",
        ]);
        if (!availableSections.has(adminSection)) {
          adminSection = "overview";
        }
        document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
          const isActive = btn.dataset.adminSection === adminSection;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        document.querySelectorAll(".admin-panel").forEach((panel) => {
          const isActive = panel.dataset.adminPanel === adminSection;
          panel.classList.toggle("active", isActive);
          panel.hidden = !isActive;
        });
      }

      function setAdminSection(section) {
        adminSection = section || "overview";
        syncAdminSectionUI();
      }

      function paginateAdminRows(rows, page = 1, pageSize = ADMIN_PAGE_SIZE) {
        const total = Array.isArray(rows) ? rows.length : 0;
        const pages = Math.max(Math.ceil(total / pageSize), 1);
        const safePage = Math.min(Math.max(Number(page) || 1, 1), pages);
        const start = total ? (safePage - 1) * pageSize : 0;
        const end = Math.min(start + pageSize, total);
        return {
          rows: (rows || []).slice(start, end),
          total,
          page: safePage,
          pages,
          start: total ? start + 1 : 0,
          end,
        };
      }

      function renderAdminPagination(targetId, meta, setPageFn) {
        const el = document.getElementById(targetId);
        if (!el) return;
        const total = Number(meta?.total || 0);
        if (!total) {
          el.innerHTML =
            '<div class="pagination-status">Không có dữ liệu để phân trang.</div>';
          return;
        }
        el.innerHTML = `<div class="pagination-status">Hiển thị ${meta.start}-${meta.end} / ${meta.total}</div>
<div class="pagination-actions">
  <button class="pagination-btn" type="button" onclick="${setPageFn}(${meta.page - 1})" ${meta.page <= 1 ? "disabled" : ""}>Trang trước</button>
  <div class="pagination-status">Trang ${meta.page}/${meta.pages}</div>
  <button class="pagination-btn" type="button" onclick="${setPageFn}(${meta.page + 1})" ${meta.page >= meta.pages ? "disabled" : ""}>Trang sau</button>
</div>`;
      }

      function getFilteredAdminUsers() {
        return adminUsers.filter((u) => {
          const matchesQuery =
            !adminUserSearchQuery ||
            (u.email || "").toLowerCase().includes(adminUserSearchQuery) ||
            (u.name || "").toLowerCase().includes(adminUserSearchQuery);
          const matchesPlan =
            adminUserPlanFilter === "all" || (u.plan || "free") === adminUserPlanFilter;
          return matchesQuery && matchesPlan;
        });
      }

      function setAdminUserPage(page) {
        adminUserPage = page;
        renderAdminUsers();
      }

      function setAdminRedirectPage(page) {
        adminRedirectPage = page;
        renderAdminRedirects(adminRedirects);
      }

      function setAdminUserPlanFilter(value) {
        adminUserPlanFilter = String(value || "all").trim() || "all";
        adminUserPage = 1;
        renderAdminUsers();
      }

      function syncAdminUserSelectionUI(filteredUsers, pageRows) {
        const summaryEl = document.getElementById("adminUserBulkSummary");
        const pageCheckbox = document.getElementById("adminUserSelectPage");
        const selectedCount = adminSelectedUserIds.size;
        if (summaryEl) {
          summaryEl.textContent = selectedCount
            ? `Đã chọn ${selectedCount} người dùng • bộ lọc hiện có ${filteredUsers.length} kết quả`
            : filteredUsers.length
              ? `Bộ lọc hiện có ${filteredUsers.length} người dùng`
              : "Chưa có người dùng phù hợp bộ lọc hiện tại.";
        }
        if (pageCheckbox) {
          const pageIds = pageRows
            .map((userItem) => Number(userItem.id))
            .filter((id) => Number.isFinite(id));
          const selectedOnPage = pageIds.filter((id) => adminSelectedUserIds.has(id)).length;
          pageCheckbox.checked = !!pageIds.length && selectedOnPage === pageIds.length;
          pageCheckbox.indeterminate =
            selectedOnPage > 0 && selectedOnPage < pageIds.length;
        }
      }

      async function loadAdminData() {
        if (!isAdminUser()) {
          return;
        }
        try {
          const [sr, dr, ur, rr] = await Promise.all([
            fetch("/api/admin/stats"),
            fetch("/api/admin/domains"),
            fetch("/api/admin/users"),
            fetch("/api/admin/redirects?limit=500"),
          ]);
          let statsPayload = null;
          let redirectPayload = null;
          if (sr.ok) {
            statsPayload = await sr.json();
            document.getElementById("adTotalUsers").textContent =
              statsPayload.totalUsers || 0;
            document.getElementById("adTotalLinks").textContent =
              statsPayload.totalLinks || 0;
            document.getElementById("adTotalClicks").textContent =
              statsPayload.totalClicks || 0;
            enqueueAdminAlerts(statsPayload);
          }
          if (dr.ok) {
            const d = await dr.json();
            adminDomains = d.domains || [];
            renderAdminDomains(adminDomains);
            syncAvailableDomainsFromAdmin(adminDomains);
          }
          if (ur.ok) {
            const u = await ur.json();
            adminUsers = u.users || [];
            adminSelectedUserIds = new Set(
              [...adminSelectedUserIds].filter((id) =>
                adminUsers.some((userItem) => Number(userItem.id) === Number(id)),
              ),
            );
            renderAdminUsers();
          }
          if (rr.ok) {
            redirectPayload = await rr.json();
            adminRedirects = redirectPayload.events || [];
            renderAdminRedirects(
              adminRedirects,
              redirectPayload.file || "logs/redirect.log",
            );
          }
          if (statsPayload || redirectPayload) {
            rememberAdminNotificationSnapshot(
              statsPayload || {},
              redirectPayload || { events: adminRedirects },
            );
          }
        } catch (e) {
          console.error("loadAdminData", e);
        }
      }

      function formatAdminDateTime(value) {
        if (!value) return "—";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString("vi-VN", {
          hour12: false,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
      }

      function renderAdminRedirects(arr, fileLabel = "logs/redirect.log") {
        const tb = document.getElementById("adRedirectBody");
        const countEl = document.getElementById("adRedirectCount");
        const fileEl = document.getElementById("adRedirectLogFile");
        if (countEl) countEl.textContent = arr.length;
        if (fileEl) fileEl.textContent = fileLabel;
        if (!tb) return;
        const pagination = paginateAdminRows(arr, adminRedirectPage);
        adminRedirectPage = pagination.page;
        if (!pagination.total) {
          tb.innerHTML =
            '<tr><td colspan="7" class="tbl-empty">Chưa có redirect log nào.</td></tr>';
          renderAdminPagination("adRedirectPagination", pagination, "setAdminRedirectPage");
          return;
        }
        tb.innerHTML = pagination.rows
          .map((event) => {
            const status = event.status ?? "—";
            const code = event.code || "—";
            const mode = event.mode || "—";
            const uaKind = event.uaKind || "—";
            const target = event.target || "—";
            const requestId = event.requestId || "—";
            const refererHost = event.refererHost || "—";
            return `<tr>
      <td style="white-space:nowrap;color:var(--text2);font-size:12px">${esc(formatAdminDateTime(event.timestamp))}</td>
      <td><span class="pill generic">${esc(mode)}</span></td>
      <td style="font-weight:700;color:var(--text)">${esc(code)}</td>
      <td style="font-size:12px;color:var(--text2)">${esc(uaKind)}</td>
      <td style="font-weight:700">${esc(String(status))}</td>
      <td class="td-orig" title="${esc(target)}">${esc(target)}</td>
      <td style="min-width:180px">
        <div style="display:flex;flex-direction:column;gap:4px">
          <code style="font-size:11px;color:var(--text2)">${esc(requestId)}</code>
          <span style="font-size:11px;color:var(--text3)">ref: ${esc(refererHost)}</span>
        </div>
      </td>
    </tr>`;
          })
          .join("");
        renderAdminPagination(
          "adRedirectPagination",
          pagination,
          "setAdminRedirectPage",
        );
      }

      async function loadAdminRedirects(showToast = false) {
        if (!isAdminUser()) return;
        const btn = document.getElementById("adminRedirectReloadBtn");
        if (btn) {
          btn.disabled = true;
          btn.textContent = "Đang tải...";
        }
        try {
          const response = await fetch("/api/admin/redirects?limit=500");
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            toast(data.error || "Không thể tải redirect log", "err");
            return;
          }
          adminRedirects = data.events || [];
          adminRedirectPage = 1;
          rememberAdminNotificationSnapshot(
            { totalUsers: adminNotificationSnapshot?.totalUsers || 0 },
            data,
          );
          renderAdminRedirects(adminRedirects, data.file || "logs/redirect.log");
          if (showToast) {
            toast("✅ Đã tải lại redirect log", "ok");
          }
        } catch {
          toast("Lỗi kết nối khi tải redirect log", "err");
        } finally {
          if (btn) {
            btn.disabled = false;
            btn.textContent = "Tải lại";
          }
        }
      }

      function renderAdminDomains(arr) {
        const tb = document.getElementById("adDomainBody");
        if (!tb) return;
        document.getElementById("adDomainCount").textContent = arr.length;
        if (!arr.length) {
          tb.innerHTML =
            '<tr><td colspan="8" class="tbl-empty">Chưa có domain</td></tr>';
          return;
        }
        tb.innerHTML = arr
          .map((d) => {
            const isPrimary = !!d.is_primary;
            const isActive = d.is_active !== false;
            const verificationStatus = String(d.verification_status || "verified").toLowerCase();
            const expiresAt = String(d.expires_at || "").slice(0, 10);
            return `<tr>
      <td style="font-weight:700;color:var(--text)">${esc(d.hostname || "")}</td>
      <td>${esc(d.label || "—")}</td>
      <td>${isPrimary ? '<span class="pill generic">Primary</span>' : '<span style="color:var(--text3)">—</span>'}</td>
      <td>${isActive ? '<span class="pill tiktok">Active</span>' : '<span class="pill generic">Paused</span>'}</td>
      <td>
        <select class="plan-select" id="domainVerify_${d.id}">
          ${["verified", "pending", "failed"].map((status) => `<option value="${status}"${verificationStatus === status ? " selected" : ""}>${status}</option>`).join("")}
        </select>
      </td>
      <td><input class="plan-select" type="date" id="domainExpiry_${d.id}" value="${esc(expiresAt)}" /></td>
      <td style="color:var(--text3);font-size:11px">${(d.created_at || "").substring(0, 10)}</td>
      <td style="display:flex;gap:5px;flex-wrap:wrap">
        <button class="btn-cp" onclick="updateDomainHealth(${d.id},'${esc(d.hostname || "")}')">Lưu</button>
        <button class="btn-cp" onclick="setPrimaryDomain(${d.id},'${esc(d.hostname || "")}')" ${isPrimary ? "disabled" : ""}>Primary</button>
        <button class="btn-cp" onclick="toggleDomainActive(${d.id},${isActive ? "false" : "true"},'${esc(d.hostname || "")}')">${isActive ? "Pause" : "Activate"}</button>
        <button class="btn-del" onclick="deleteAdminDomain(${d.id},'${esc(d.hostname || "")}')">Xóa</button>
      </td>
    </tr>`;
          })
          .join("");
      }

      function renderAdminUsers() {
        const tb = document.getElementById("adUserBody");
        if (!tb) return;
        const filteredUsers = getFilteredAdminUsers();
        const pagination = paginateAdminRows(filteredUsers, adminUserPage);
        const pageRows = pagination.rows;
        adminUserPage = pagination.page;
        document.getElementById("adUserCount").textContent = filteredUsers.length;
        if (!filteredUsers.length) {
          tb.innerHTML =
            '<tr><td colspan="8" class="tbl-empty">Không có người dùng phù hợp bộ lọc.</td></tr>';
          syncAdminUserSelectionUI(filteredUsers, []);
          renderAdminPagination("adUserPagination", pagination, "setAdminUserPage");
          return;
        }
        tb.innerHTML = pageRows
          .map(
            (u) => {
              const userId = Number(u.id);
              const isSelected = adminSelectedUserIds.has(userId);
              return `<tr class="${isSelected ? "admin-row-selected" : ""}">
    <td class="td-check">
      <label class="tbl-check">
        <input type="checkbox" ${isSelected ? "checked" : ""} onchange="toggleAdminUserSelection(${userId}, this.checked)" />
        <span></span>
      </label>
    </td>
    <td style="color:var(--text3)">${u.id}</td>
    <td style="font-weight:600">${esc(u.email)}</td>
    <td>${esc(u.name || "—")}</td>
    <td>
      <select class="plan-select" data-current-plan="${esc(u.plan || "free")}" onchange="adminSetPlan(${u.id},this)">
        ${["free", "pro", "business", "admin"].map((p) => `<option value="${p}"${u.plan === p ? " selected" : ""}>${p}</option>`).join("")}
      </select>
    </td>
    <td><span class="badge-role ${u.role || "user"}">${u.role || "user"}</span></td>
    <td style="color:var(--text3);font-size:11px">${(u.created_at || "").substring(0, 10)}</td>
    <td><button class="btn-del" onclick="adminDeleteUser(${u.id},'${esc(u.email)}')">Xóa</button></td>
  </tr>`;
            },
          )
          .join("");
        syncAdminUserSelectionUI(filteredUsers, pageRows);
        renderAdminPagination("adUserPagination", pagination, "setAdminUserPage");
      }

      function filterAdminUsers(q) {
        adminUserSearchQuery = String(q || "").trim().toLowerCase();
        adminUserPage = 1;
        renderAdminUsers();
      }

      function filterAdminDomains(q) {
        q = q.toLowerCase();
        renderAdminDomains(
          adminDomains.filter(
            (d) =>
              (d.hostname || "").toLowerCase().includes(q) ||
              (d.label || "").toLowerCase().includes(q) ||
              (d.verification_status || "").toLowerCase().includes(q),
          ),
        );
      }

      function toggleAdminUserSelection(userId, checked) {
        if (checked) adminSelectedUserIds.add(Number(userId));
        else adminSelectedUserIds.delete(Number(userId));
        renderAdminUsers();
      }

      function toggleAllAdminUsersOnPage(checked) {
        const pageRows = paginateAdminRows(getFilteredAdminUsers(), adminUserPage).rows;
        pageRows.forEach((userItem) => {
          if (checked) adminSelectedUserIds.add(Number(userItem.id));
          else adminSelectedUserIds.delete(Number(userItem.id));
        });
        renderAdminUsers();
      }

      function selectAllAdminUsersFiltered() {
        getFilteredAdminUsers().forEach((userItem) => {
          adminSelectedUserIds.add(Number(userItem.id));
        });
        renderAdminUsers();
      }

      function clearAdminUserSelection() {
        adminSelectedUserIds = new Set();
        renderAdminUsers();
      }

      async function addAdminDomain() {
        const hostInput = document.getElementById("adminDomainHost");
        const labelInput = document.getElementById("adminDomainLabel");
        const primaryInput = document.getElementById("adminDomainPrimary");
        const verifyInput = document.getElementById("adminDomainVerify");
        const expiryInput = document.getElementById("adminDomainExpiry");
        const btn = document.getElementById("adminDomainAddBtn");
        const hostname = hostInput.value.trim();
        const label = labelInput.value.trim();
        const verificationStatus = String(verifyInput?.value || "verified").trim() || "verified";
        const expiresAt = String(expiryInput?.value || "").trim();
        if (!hostname) {
          toast("Nhập hostname trước khi thêm domain", "warn");
          return;
        }
        const confirmed = await showConfirmDialog({
          title: "Thêm domain mới",
          message: `Thêm domain "${hostname}" vào hệ thống?`,
          note: label
            ? `Nhãn hiển thị: ${label}${primaryInput.checked ? " • sẽ đặt làm domain chính." : ""}${expiresAt ? ` • hết hạn: ${expiresAt}` : ""}`
            : primaryInput.checked
              ? "Domain này sẽ được đặt làm domain chính."
              : expiresAt
                ? `Hết hạn: ${expiresAt}`
                : "",
          confirmLabel: "Thêm domain",
        });
        if (!confirmed) return;
        btn.disabled = true;
        btn.textContent = "Đang thêm...";
        try {
          const r = await fetch("/api/admin/domains", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              hostname,
              label,
              is_primary: primaryInput.checked,
              verification_status: verificationStatus,
              expires_at: expiresAt,
            }),
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể thêm domain", "err");
            return;
          }
          adminDomains = d.domains || [];
          renderAdminDomains(adminDomains);
          syncAvailableDomainsFromAdmin(adminDomains);
          hostInput.value = "";
          labelInput.value = "";
          primaryInput.checked = false;
          if (verifyInput) verifyInput.value = "verified";
          if (expiryInput) expiryInput.value = "";
          addNotification({
            key: `domain-add-${hostname}-${Date.now()}`,
            title: "Đã thêm domain",
            message: `${hostname} đã được thêm vào hệ thống.`,
            kind: "ok",
            page: "admin",
          });
          toast("✅ Đã thêm domain", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        } finally {
          btn.disabled = false;
          btn.textContent = "Thêm domain";
        }
      }

      async function updateDomainHealth(domainId, hostname = "") {
        const verifyInput = document.getElementById(`domainVerify_${domainId}`);
        const expiryInput = document.getElementById(`domainExpiry_${domainId}`);
        const verificationStatus = String(verifyInput?.value || "verified").trim() || "verified";
        const expiresAt = String(expiryInput?.value || "").trim();
        const confirmed = await showConfirmDialog({
          title: "Cập nhật sức khỏe domain",
          message: `Lưu trạng thái verify cho "${hostname || "domain này"}"?`,
          note: `${verificationStatus}${expiresAt ? ` • hết hạn ${expiresAt}` : ""}`,
          confirmLabel: "Lưu cập nhật",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/domains/" + domainId, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              verification_status: verificationStatus,
              expires_at: expiresAt,
            }),
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể cập nhật domain", "err");
            return;
          }
          adminDomains = d.domains || [];
          renderAdminDomains(adminDomains);
          addNotification({
            key: `domain-health-${domainId}-${Date.now()}`,
            title: "Đã cập nhật domain",
            message: `${hostname || "Domain"} đã được cập nhật verify/expiry.`,
            kind: "ok",
            page: "admin",
          });
          toast("Cập nhật domain thành công", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      async function setPrimaryDomain(domainId, hostname = "") {
        const confirmed = await showConfirmDialog({
          title: "Đổi domain chính",
          message: `Đặt "${hostname || "domain này"}" làm domain chính?`,
          note: "Tất cả link mới sẽ ưu tiên dùng domain chính đang được chọn.",
          confirmLabel: "Đặt primary",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/domains/" + domainId, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_primary: true }),
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể đổi primary", "err");
            return;
          }
          adminDomains = d.domains || [];
          renderAdminDomains(adminDomains);
          syncAvailableDomainsFromAdmin(adminDomains);
          loadData();
          addNotification({
            key: `domain-primary-${domainId}-${Date.now()}`,
            title: "Domain chính đã thay đổi",
            message: `${hostname || "Domain đã chọn"} đang là domain mặc định mới.`,
            kind: "ok",
            page: "admin",
          });
          toast("✅ Đã đặt domain chính", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      async function toggleDomainActive(domainId, isActive, hostname = "") {
        const nextActive = isActive === true || isActive === "true";
        const willEnable = nextActive;
        const confirmed = await showConfirmDialog({
          title: willEnable ? "Kích hoạt domain" : "Tạm dừng domain",
          message: `${willEnable ? "Kích hoạt" : "Tạm dừng"} "${hostname || "domain này"}"?`,
          note: willEnable
            ? "Domain sẽ xuất hiện trở lại trong danh sách chọn khi tạo link."
            : "Link cũ vẫn hoạt động, nhưng domain sẽ không còn được chọn cho link mới.",
          confirmLabel: willEnable ? "Kích hoạt" : "Tạm dừng",
          tone: willEnable ? "default" : "danger",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/domains/" + domainId, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: nextActive }),
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể cập nhật domain", "err");
            return;
          }
          adminDomains = d.domains || [];
          renderAdminDomains(adminDomains);
          syncAvailableDomainsFromAdmin(adminDomains);
          loadData();
          addNotification({
            key: `domain-toggle-${domainId}-${Date.now()}`,
            title: willEnable ? "Domain đã được kích hoạt" : "Domain đã được tạm dừng",
            message: hostname || "Cập nhật trạng thái domain thành công.",
            kind: willEnable ? "ok" : "warn",
            page: "admin",
          });
          toast("✅ Đã cập nhật domain", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      async function deleteAdminDomain(domainId, hostname) {
        const confirmed = await showConfirmDialog({
          title: "Xóa domain",
          message: `Xóa domain "${hostname}" khỏi hệ thống?`,
          note: "Thao tác này không xóa link cũ nhưng sẽ bỏ domain khỏi danh sách sử dụng tiếp theo.",
          confirmLabel: "Xóa domain",
          tone: "danger",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/domains/" + domainId, {
            method: "DELETE",
          });
          const d = await r.json();
          if (!r.ok) {
            toast(d.error || "Không thể xóa domain", "err");
            return;
          }
          adminDomains = d.domains || [];
          renderAdminDomains(adminDomains);
          syncAvailableDomainsFromAdmin(adminDomains);
          loadData();
          addNotification({
            key: `domain-delete-${domainId}-${Date.now()}`,
            title: "Đã xóa domain",
            message: `${hostname} đã bị gỡ khỏi hệ thống.`,
            kind: "warn",
            page: "admin",
          });
          toast("🗑️ Đã xóa domain", "ok");
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      async function adminSetPlan(userId, selectEl) {
        const nextPlan = selectEl?.value;
        const currentPlan = selectEl?.dataset?.currentPlan || "free";
        if (!nextPlan || nextPlan === currentPlan) return;
        const targetUser = adminUsers.find((u) => Number(u.id) === Number(userId));
        const confirmed = await showConfirmDialog({
          title: "Cập nhật gói người dùng",
          message: `Chuyển ${targetUser?.email || "người dùng này"} sang gói "${nextPlan}"?`,
          note: "Thay đổi sẽ có hiệu lực ngay sau khi lưu.",
          confirmLabel: "Cập nhật gói",
        });
        if (!confirmed) {
          if (selectEl) selectEl.value = currentPlan;
          return;
        }
        try {
          const r = await fetch("/api/admin/users/" + userId, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan: nextPlan }),
          });
          if (r.ok) {
            if (selectEl) selectEl.dataset.currentPlan = nextPlan;
            adminUsers = adminUsers.map((userItem) =>
              Number(userItem.id) === Number(userId)
                ? { ...userItem, plan: nextPlan }
                : userItem,
            );
            renderAdminUsers();
            addNotification({
              key: `plan-${userId}-${nextPlan}-${Date.now()}`,
              title: "Gói người dùng đã cập nhật",
              message: `${targetUser?.email || "Người dùng"} đã chuyển sang ${nextPlan}.`,
              kind: "ok",
              page: "admin",
            });
            toast(`✅ Đã cập nhật gói → ${nextPlan}`, "ok");
          } else {
            const d = await r.json();
            if (selectEl) selectEl.value = currentPlan;
            toast(d.error || "Lỗi", "err");
          }
        } catch {
          if (selectEl) selectEl.value = currentPlan;
          toast("Lỗi kết nối", "err");
        }
      }

      async function adminDeleteUser(userId, email) {
        const confirmed = await showConfirmDialog({
          title: "Xóa người dùng",
          message: `Xóa người dùng "${email}"?`,
          note: "Tất cả link của tài khoản này cũng sẽ bị xóa theo.",
          confirmLabel: "Xóa người dùng",
          tone: "danger",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/users/" + userId, {
            method: "DELETE",
          });
          if (r.ok) {
            adminSelectedUserIds.delete(Number(userId));
            addNotification({
              key: `user-delete-${userId}-${Date.now()}`,
              title: "Đã xóa người dùng",
              message: `${email} đã bị xóa khỏi hệ thống.`,
              kind: "warn",
              page: "admin",
            });
            toast("🗑️ Đã xóa người dùng", "ok");
            loadAdminData();
          } else {
            const d = await r.json();
            toast(d.error || "Lỗi", "err");
          }
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      async function deleteSelectedAdminUsers() {
        const ids = [...adminSelectedUserIds].filter((id) => Number.isInteger(id));
        if (!ids.length) {
          toast("Chưa chọn người dùng nào để xóa", "warn");
          return;
        }
        const confirmed = await showConfirmDialog({
          title: "Xóa nhiều người dùng",
          message: `Xóa ${ids.length} người dùng đã chọn?`,
          note: "Toàn bộ link thuộc các tài khoản này cũng sẽ bị xóa.",
          confirmLabel: "Xóa đã chọn",
          tone: "danger",
        });
        if (!confirmed) return;
        try {
          const r = await fetch("/api/admin/users/bulk-delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids }),
          });
          if (r.ok) {
            adminSelectedUserIds = new Set();
            addNotification({
              key: `bulk-user-delete-${ids.length}-${Date.now()}`,
              title: "Đã xóa nhiều người dùng",
              message: `${ids.length} tài khoản đã bị xóa khỏi hệ thống.`,
              kind: "warn",
              page: "admin",
            });
            toast("🗑️ Đã xóa các người dùng đã chọn", "ok");
            loadAdminData();
          } else {
            const d = await r.json();
            toast(d.error || "Lỗi", "err");
          }
        } catch {
          toast("Lỗi kết nối", "err");
        }
      }

      // ══════════════════════════════════════════════════
      //  EDIT MODAL
      // ══════════════════════════════════════════════════
      function openEditModal(linkId) {
        const link =
          links.find((l) => l.id == linkId) ||
          adminLinks.find((l) => l.id == linkId);
        if (!link) {
          toast("Không tìm thấy link", "err");
          return;
        }
        document.getElementById("editLinkId").value = link.id;
        document.getElementById("editShortUrl").textContent = (
          link.short_url || ""
        ).replace(/^https?:\/\//, "");
        document.getElementById("editOrigUrl").textContent = (
          link.original_url || ""
        ).substring(0, 60);
        document.getElementById("editLinkType").value =
          link.link_type || "direct";
        document.getElementById("editOgTitle").value = link.og_title || "";
        document.getElementById("editOgDesc").value = link.og_desc || "";
        document.getElementById("editOgImage").value = link.og_image || "";
        document.getElementById("editVideoUrl").value = link.video_url || "";
        document.getElementById("editVideoText").value =
          link.video_overlay_text || "";
        onEditLinkTypeChange();
        updateEditThumbPreview();
        document.getElementById("editErr").classList.remove("show");
        document.getElementById("editModal").classList.remove("hidden");
      }

      function closeEditModal() {
        document.getElementById("editModal").classList.add("hidden");
      }

      function onEditLinkTypeChange() {
        const t = document.getElementById("editLinkType").value;
        document.getElementById("editVideoFields").style.display =
          t === "video" ? "block" : "none";
      }

      function updateEditThumbPreview() {
        const img = document.getElementById("editThumbPreview");
        const imgUrl = document.getElementById("editOgImage").value.trim();
        if (imgUrl) {
          img.src = imgUrl;
          img.style.display = "block";
          img.onerror = () => {
            img.style.display = "none";
          };
        } else {
          img.style.display = "none";
        }
      }

      async function autoExtractThumb() {
        const videoUrl = document.getElementById("editVideoUrl").value.trim();
        if (!videoUrl) {
          toast("Nhập URL video trước", "warn");
          return;
        }
        const ytMatch = videoUrl.match(
          /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/,
        );
        if (ytMatch) {
          const thumb = `https://img.youtube.com/vi/${ytMatch[1]}/maxresdefault.jpg`;
          document.getElementById("editOgImage").value = thumb;
          updateEditThumbPreview();
          toast("✅ Đã lấy thumbnail YouTube!", "ok");
          return;
        }
        try {
          const vidEl = document.createElement("video");
          vidEl.src = videoUrl;
          vidEl.crossOrigin = "anonymous";
          vidEl.muted = true;
          vidEl.currentTime = 1;
          vidEl.style.display = "none";
          document.body.appendChild(vidEl);
          toast("⏳ Đang lấy thumbnail...", "ok");
          await new Promise((resolve, reject) => {
            vidEl.addEventListener("seeked", () => {
              try {
                const canvas = document.createElement("canvas");
                canvas.width = 1200;
                canvas.height = 630;
                canvas.getContext("2d").drawImage(vidEl, 0, 0, 1200, 630);
                document.getElementById("editOgImage").value = canvas.toDataURL(
                  "image/jpeg",
                  0.85,
                );
                updateEditThumbPreview();
                toast("✅ Đã cắt thumbnail từ video!", "ok");
                resolve();
              } catch (e) {
                reject(e);
              }
            });
            vidEl.addEventListener("error", reject);
            setTimeout(() => reject(new Error("timeout")), 8000);
            vidEl.load();
          });
          document.body.removeChild(vidEl);
        } catch (e) {
          toast("Không thể lấy thumbnail: " + e.message, "err");
        }
      }

      async function saveEditLink() {
        const id = document.getElementById("editLinkId").value;
        const btn = document.getElementById("editSaveBtn");
        const errEl = document.getElementById("editErr");
        errEl.classList.remove("show");
        btn.disabled = true;
        btn.textContent = "⏳ Đang lưu...";
        try {
          const r = await fetch("/api/links/" + id, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              og_title: document.getElementById("editOgTitle").value.trim(),
              og_desc: document.getElementById("editOgDesc").value.trim(),
              og_image: document.getElementById("editOgImage").value.trim(),
              link_type: document.getElementById("editLinkType").value,
              video_url: document.getElementById("editVideoUrl").value.trim(),
              video_overlay_text: document
                .getElementById("editVideoText")
                .value.trim(),
            }),
          });
          const d = await r.json();
          if (!r.ok) {
            errEl.textContent = d.error || "Lỗi lưu";
            errEl.classList.add("show");
            return;
          }
          toast("✅ Đã lưu thay đổi!", "ok");
          closeEditModal();
          loadData();
          if (adminLinks.length) loadAdminData();
        } catch {
          errEl.textContent = "Lỗi kết nối";
          errEl.classList.add("show");
        } finally {
          btn.disabled = false;
          btn.textContent = "💾 Lưu thay đổi";
        }
      }

      // ══════════════════════════════════════════════════
      //  INIT
      // ══════════════════════════════════════════════════
      window.addEventListener("popstate", () => {
        if (!document.getElementById("appScreen").classList.contains("show")) {
          return;
        }
        syncRouteFromLocation();
      });

      window.addEventListener("hashchange", () => {
        if (!document.getElementById("appScreen").classList.contains("show")) {
          return;
        }
        syncRouteFromLocation();
      });

      (async () => {
        try {
          loadThemePreference();
          updateIntegrationUI();
          await loadAvailableDomains();
          const authMode = getAuthRouteMode();
          const r = await fetch("/api/auth/me");
          const d = await r.json();
          if (d.user) {
            user = d.user;
            showApp();
          } else {
            showAuthScreen(authMode);
          }
        } catch {
          showAuthScreen(getAuthRouteMode());
        }
      })();
    
