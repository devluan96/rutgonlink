(() => {
  const getCurrentReturnPath = () =>
    `${location.pathname}${location.search}${location.hash}`;

  const buildAuthUrl = (mode = "login", next = getCurrentReturnPath()) => {
    const path = mode === "register" ? "/register" : "/login";
    const url = new URL(path, location.origin);
    if (next) {
      url.searchParams.set("next", next);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const getUserInitials = (user) => {
    const rawName = String(user?.name || user?.email || "User").trim();
    const parts = rawName
      .replace(/@.+$/, "")
      .split(/[\s._-]+/)
      .filter(Boolean);
    const initials = parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("");
    return (initials || rawName[0] || "U").toUpperCase();
  };

  const getUserDisplayName = (user) => {
    const rawName = String(user?.name || "").trim();
    if (rawName) return rawName;
    const email = String(user?.email || "").trim();
    if (email) return email.split("@")[0];
    return "User";
  };

  const isAffiliateShortenUrl = (value) => {
    try {
      const raw = String(value || "").trim();
      if (!raw) return false;
      const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
      const hostname = new URL(normalized).hostname.toLowerCase();
      return (
        hostname === "shp.ee" ||
        hostname === "shopee.vn" ||
        hostname.endsWith(".shopee.vn") ||
        hostname === "tiktok.com" ||
        hostname.endsWith(".tiktok.com") ||
        hostname === "vm.tiktok.com" ||
        hostname === "vt.tiktok.com"
      );
    } catch {
      return false;
    }
  };

  window.RGLShared = Object.freeze({
    buildAuthUrl,
    getCurrentReturnPath,
    getUserDisplayName,
    getUserInitials,
    isAffiliateShortenUrl,
  });
})();
