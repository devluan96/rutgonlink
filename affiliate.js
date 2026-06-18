const AFFILIATE_HOSTS = [
  "shp.ee",
  "shopee.vn",
  "tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
];

function isAffiliateHost(hostname) {
  return (
    hostname === "shp.ee" ||
    hostname === "shopee.vn" ||
    hostname.endsWith(".shopee.vn") ||
    hostname === "tiktok.com" ||
    hostname.endsWith(".tiktok.com") ||
    hostname === "vm.tiktok.com" ||
    hostname === "vt.tiktok.com"
  );
}

function isAffiliateShortenUrl(input) {
  try {
    const raw = String(input || "").trim();
    if (!raw) return false;
    const normalized = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const hostname = new URL(normalized).hostname.toLowerCase();
    return isAffiliateHost(hostname);
  } catch {
    return false;
  }
}

module.exports = {
  AFFILIATE_HOSTS,
  isAffiliateHost,
  isAffiliateShortenUrl,
};
