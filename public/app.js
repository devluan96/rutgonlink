// ══════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════
const sharedClient = window.RGLShared || {};
const getCurrentReturnPath =
  sharedClient.getCurrentReturnPath ||
  (() => `${location.pathname}${location.search}${location.hash}`);
const buildAuthUrl =
  sharedClient.buildAuthUrl ||
  ((mode = "login") => (mode === "register" ? "/register" : "/login"));
const isAffiliateShortenUrl =
  sharedClient.isAffiliateShortenUrl || (() => false);
const getUserDisplayName =
  sharedClient.getUserDisplayName ||
  ((currentUser) =>
    currentUser?.name || currentUser?.email?.split("@")[0] || "User");
const getUserInitials =
  sharedClient.getUserInitials ||
  ((currentUser) =>
    (currentUser?.name || currentUser?.email || "U").charAt(0).toUpperCase());
const getUserAvatarUrl = (currentUser) =>
  String(currentUser?.avatar_url || "").trim() || "";
const AUTO_ALIAS_MAX_LENGTH = 90;
const RECENT_STATS_WINDOW_DAYS = 7;

function stripVietnameseMarks(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function slugifyAliasValue(value, maxLength = AUTO_ALIAS_MAX_LENGTH) {
  const compact = stripVietnameseMarks(value)
    .toLowerCase()
    .replace(/['"`’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return compact.slice(0, maxLength).replace(/-+$/g, "");
}

function extractAliasFromShortUrl(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return "";
  try {
    const parsed = new URL(rawValue);
    return parsed.pathname.replace(/^\/+|\/+$/g, "");
  } catch {
    return rawValue.replace(/^\/+|\/+$/g, "");
  }
}

function appendAliasSuffixPreview(alias, suffix, maxLength = 40) {
  const baseAlias = slugifyAliasValue(alias, maxLength);
  const suffixAlias = slugifyAliasValue(suffix, maxLength);
  if (!baseAlias) return suffixAlias.slice(0, maxLength);
  if (!suffixAlias) return baseAlias;
  const trimmedBase = baseAlias
    .slice(0, Math.max(1, maxLength - suffixAlias.length - 1))
    .replace(/-+$/g, "");
  return `${trimmedBase}-${suffixAlias}`.slice(0, maxLength).replace(/-+$/g, "");
}

function buildTeamTemplateAlias(template, sourceLink) {
  const sourceAlias = slugifyAliasValue(
    extractAliasFromShortUrl(sourceLink?.short_url) ||
      sourceLink?.title ||
      template?.name ||
      "link",
    40,
  );
  const userAliasWord = slugifyAliasValue(
    user?.name || user?.email?.split("@")[0] || "user",
    10,
  );
  const suffixWord = `${userAliasWord || "user"}${Date.now().toString(36).slice(-4)}`;
  return appendAliasSuffixPreview(sourceAlias || "link", suffixWord, 40);
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
let chartDays = RECENT_STATS_WINDOW_DAYS;
let adminOverviewChartInst = null;
let adminOverviewRangeDays = 7;
let adminOverviewTrendPayload = null;
let statsAnalytics = null;
let linkSearchQuery = "";
let linkTypeFilter = "all";
const createSubtabStorageKey = "rutgonlink-create-subtab";
const linksSubtabStorageKey = "rutgonlink-links-subtab";
let createSubtab =
  localStorage.getItem(createSubtabStorageKey) === "lab" ? "lab" : "standard";
let linksSubtab =
  localStorage.getItem(linksSubtabStorageKey) === "lab" ? "lab" : "standard";
let currentFilteredLinks = [];
let selectedLinkIds = new Set();
let expandedOriginalLinkIds = new Set();
let availableDomains = [];
let availableDomainsPromise = null;
let createDomainSelection = "";
let qrRenderedText = "";
let qrStyler = null;
let bioConfig = null;
let appTheme = localStorage.getItem("rutgonlink-theme") || "dark";
const appLanguageStorageKey = "rutgonlink-lang";
let appLanguage =
  localStorage.getItem(appLanguageStorageKey) === "en" ? "en" : "vi";
const integrationStorageKey = "rutgonlink-integrations";
const teamStorageKey = "rutgonlink-teamspace";
let teamState = null;
let teamWorkspaceData = null;
let pendingTeamTemplateDraft = null;
let editingTeamTemplateId = null;
let teamTemplateModalState = null;
let selectedTeamTemplateSourceIds = [];
let selectedTeamTemplateMediaLinkId = null;
let isTeamTemplateSourceDropdownOpen = false;
let uploadedTeamTemplateMedia = null;
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
const STATS_PAYLOAD_CACHE_TTL_MS = 2000;
let statsPayloadPromise = null;
let statsPayloadCache = null;
let statsPayloadCacheAt = 0;
const labEmbedCacheBust = Date.now().toString(36);
const labSharedSettingsStorageKey = "rutgonlink-lab-shared-settings-v1";
let confirmModalResolver = null;
let accountLoginEvents = [];
let accountLoginEventsLoading = false;
let accountTwoFactorSetup = null;
let accountTwoFactorMode = "";
let accountTwoFactorQr = null;
let activeAccountSection = "profile";
let accountAffiliateHealth = {
  shopee: null,
  tiktok: null,
};
let activeAffiliatePresetTargetFieldId = "";
const notificationSeenStorageKey = "rutgonlink-notification-seen";
let seenNotificationKeys = {};
const themeMeta = document.querySelector('meta[name="theme-color"]');
const rootStyles = () => getComputedStyle(document.documentElement);
const themeColor = (name, fallback) =>
  rootStyles().getPropertyValue(name).trim() || fallback;
const landingIntroCopy = {
  vi: {
    "brandSubline": "Rút gọn link, QR, bio public và analytics",
    "heroKicker": "Bước tiếp theo",
    "heroTitle": "Tạo link ở một chỗ, xem dữ liệu ở một chỗ",
    heroDesc:
      "Dùng cùng một luồng như trong app: tạo link, tinh chỉnh preview và theo dõi hiệu quả mà không phải đổi giữa quá nhiều màn hình khác nhau.",
    "heroPrimary": "Bắt đầu miễn phí",
    "heroSecondary": "Đăng nhập",
    "heroQuick": "Thử rút gọn nhanh",
    "stepsTitle": "Lộ trình ngắn",
    "stepsBadge": "3 bước",
    "step1Title": "Tạo link",
    "step1Desc": "Dán URL và chọn kiểu link phù hợp.",
    "step2Title": "Tối ưu preview",
    "step2Desc": "Chỉnh OG, alias hoặc video overlay nếu cần.",
    "step3Title": "Theo dõi hiệu quả",
    "step3Desc": "Kiểm tra click và hiệu suất ngay trong dashboard.",
    "quickPlaceholder": "Dán URL dài",
    "quickSubmit": "Rút gọn",
    resultMessage:
      "Liên kết đã được rút gọn thành công. Muốn thêm tùy chọn tùy chỉnh?",
    "resultCta": "Bắt đầu",
    "searchPlaceholder": "Tìm link... (Ctrl+K)",
  },
  "en": {
    "brandSubline": "Short links, QR, public bio and analytics",
    "heroKicker": "Next step",
    "heroTitle": "Create links in one place, track results in one place",
    heroDesc:
      "Use the same flow as the app: create links, tune previews, and review performance without jumping across too many separate screens.",
    "heroPrimary": "Start free",
    "heroSecondary": "Log in",
    "heroQuick": "Try quick shorten",
    "stepsTitle": "Quick path",
    "stepsBadge": "3 steps",
    "step1Title": "Create a link",
    "step1Desc": "Paste a URL and choose the right link type.",
    "step2Title": "Optimize preview",
    "step2Desc": "Adjust OG, alias, or video overlay when needed.",
    "step3Title": "Track performance",
    "step3Desc": "Review clicks and performance right in the dashboard.",
    "quickPlaceholder": "Paste a long URL",
    "quickSubmit": "Shorten",
    resultMessage:
      "Your link has been shortened. Want more control and customization?",
    "resultCta": "Get started",
    "searchPlaceholder": "Search links... (Ctrl+K)",
  },
};
const appUiTextTranslations = {
  "en": {
    "Thông báo realtime": "Realtime notifications",
    "Chưa có thông báo mới": "No new notifications",
    "Đã xem hết": "Mark all read",
    "Chuông sẽ hiện các thay đổi mới về click, link, domain và quản trị.":
      "The bell shows new changes for clicks, links, domains, and admin activity.",
    "Khách": "Guest",
    "Chưa đăng nhập": "Not signed in",
    "Hồ sơ công khai": "Public profile",
    "Thanh toán": "Billing",
    "Bảo mật": "Security",
    "Cài đặt": "Settings",
    "Gói hiện tại": "Current plan",
    "Vai trò": "Role",
    "Trạng thái": "Status",
    "Dùng thử": "Trial",
    "Thanh toán / nâng cấp": "Pay / upgrade",
    "Xem bảng giá": "View pricing",
    "Gói Pro": "Pro plan",
    "Gói Business": "Business plan",
    "Chưa có yêu cầu thanh toán nào gần đây.": "No recent payment requests.",
    "Kiểm tra nhanh trạng thái tài khoản và phiên đang dùng.":
      "Quickly review your account status and active session.",
    "Họ và tên": "Full name",
    "ID người dùng": "User ID",
    "Ngày tham gia": "Joined",
    "Phiên hiện tại": "Current session",
    "Đang hoạt động": "Active",
    "Hồ sơ & tài khoản": "Profile & account",
    "Giao diện": "Appearance",
    "Bảo mật nâng cao": "Advanced security",
    "Trung tâm trợ giúp": "Help center",
    "Quản trị": "Admin",
    "Đăng nhập": "Log in",
    "Đăng xuất": "Log out",
    "Tổng quan": "Overview",
    "Bảng điều khiển": "Dashboard",
    "Thống kê": "Analytics",
    "Quản lý liên kết": "Link management",
    "Liên kết": "Links",
    "Tạo liên kết": "Create link",
    "Mã QR": "QR",
    "Trang tiểu sử": "Bio page",
    "Làm việc nhóm": "Team workspace",
    "Tài khoản": "Account",
    "✨ Nâng cấp Pro": "✨ Upgrade to Pro",
    "Xem gói Pro →": "View Pro plan →",
    "Tổng quan nhanh, hành động tiếp theo và tín hiệu chính":
      "Quick overview, next actions, and key signals",
    "Tổng lượt nhấp": "Total clicks",
    "Click unique": "Unique clicks",
    "Click unique 7 ngày": "7-day unique clicks",
    "Tất cả thời gian": "All time",
    "7 ngày gần nhất": "Last 7 days",
    "Click hôm nay": "Clicks today",
    "Click unique hôm nay": "Unique clicks today",
    "Trong ngày": "Today",
    "Link đã tạo": "Created links",
    "Tổng số liên kết": "Total links",
    "Link hôm nay": "Links today",
    "Tạo trong ngày": "Created today",
    "Shopee deeplink": "Shopee deeplink",
    "Click Shopee": "Shopee clicks",
    "Link Shopee": "Shopee links",
    "TikTok deeplink": "TikTok deeplink",
    "Click TikTok": "TikTok clicks",
    "Link TikTok": "TikTok links",
    "Bước tiếp theo": "Next step",
    "Tạo link ở một chỗ, xem dữ liệu ở một chỗ":
      "Create links in one place, see data in one place",
    "Dashboard chỉ giữ phần tổng quan và điều hướng nhanh. Phần tạo link, OG preview và video overlay đã được dồn về trang Tạo liên kết để giảm rối khi sử dụng.":
      "The dashboard now focuses on overview and quick navigation. Link creation, OG preview, and video overlay have been moved into Create Link to keep the workflow cleaner.",
    "+ Tạo link mới": "+ Create new link",
    "Xem danh sách link": "View link list",
    "Mở thống kê chi tiết": "Open detailed analytics",
    "Lộ trình ngắn": "Quick path",
    "3 bước": "3 steps",
    "Tạo link": "Create link",
    "Dán URL và chọn kiểu link phù hợp.":
      "Paste a URL and choose the right link type.",
    "Tối ưu preview": "Optimize preview",
    "Chỉnh OG, alias hoặc video overlay nếu cần.":
      "Adjust OG, alias, or video overlay when needed.",
    "Theo dõi hiệu quả": "Track performance",
    "Kiểm tra click trong tab Thống kê hoặc Liên kết.":
      "Review clicks in Analytics or Links.",
    "Lượt nhấp theo thời gian": "Clicks over time",
    "Hoạt động gần đây": "Recent activity",
    "Điều hướng nhanh": "Quick navigation",
    "So sánh gói và nâng cấp từ menu tài khoản.":
      "Compare plans and upgrade from the account menu.",
    "Rút gọn với deeplink tự động & custom preview":
      "Shorten links with automatic deeplinks and custom preview",
    "Link mới tạo": "Latest link",
    "Link vừa rút gọn xong để copy nhanh hoặc mở ngay.":
      "The link you just shortened, ready to copy or open right away.",
    "Vừa tạo": "Just created",
    "Link mới nhất để copy, mở QR hoặc ghim vào bio.":
      "Your latest link for quick copy, QR, or pinning to bio.",
    "Tạo mới, deeplink, OG preview và video overlay.":
      "Create new links, deeplinks, OG previews, and video overlays.",
    "Tìm, lọc và quản lý link đã tạo.":
      "Search, filter, and manage created links.",
    "Tạo link thông minh": "Smart link builder",
    "Dán URL, chọn kiểu link và chỉnh preview trước khi chia sẻ.":
      "Paste a URL, choose a link type, and tune the preview before sharing.",
    "Dán link Shopee, TikTok hoặc bất kỳ URL nào...":
      "Paste a Shopee, TikTok, or any URL...",
    "🔗 Trực tiếp": "🔗 Direct",
    "Trực tiếp": "Direct",
    "Tạo mã QR nhanh": "Create QR fast",
    "Dùng cho poster, sticker, social post hoặc landing page.":
      "Great for posters, stickers, social posts, or landing pages.",
    "Kích thước": "Size",
    "Màu QR": "QR color",
    "Màu brand": "Brand color",
    "Đen": "Black",
    "Tím": "Purple",
    "Xanh lá": "Green",
    "Tạo / cập nhật": "Create / update",
    "Sao chép URL": "Copy URL",
    "Sao chép": "Copy",
    "Rút gọn": "Shorten",
    "Domain tạo link": "Link domain",
    "Alias tùy chỉnh": "Custom alias",
    "Kiểu link": "Link type",
    "Deeplink App": "App deeplink",
    "Video Overlay": "Video Overlay",
    "URL video (YouTube / MP4)": "Video URL (YouTube / MP4)",
    "Nội dung CTA (hiện sau 5s)": "CTA copy (shows after 5s)",
    "🛒 Bấm để xem sản phẩm →": "🛒 Tap to view product →",
    "Preview khi share (Facebook · Zalo · TikTok)":
      "Share preview (Facebook · Zalo · TikTok)",
    "Ảnh preview (1200×630px)": "Preview image (1200×630px)",
    "Ảnh preview (OG Image)": "Preview image (OG image)",
    "BocLink có QR riêng cho link, chiến dịch và bio profile. Ở đây bạn có thể tạo nhanh từ bất kỳ URL nào.":
      "BocLink supports dedicated QR codes for links, campaigns, and bio profiles. You can create one here from any URL.",
    "Xem trước QR": "QR preview",
    "Chưa tạo mã QR nào": "No QR code yet",
    "Nhập URL rồi bấm": "Enter a URL and click",
    "Builder link-in-bio đơn giản với preview theo phong cách 3D":
      "Simple link-in-bio builder with a 3D-style preview",
    "Tạo trang tiểu sử": "Create a bio page",
    "Thiết lập hồ sơ, mô tả và danh sách link nổi bật.":
      "Set up your profile, description, and featured links.",
    "Slug public": "Public slug",
    "Tiêu đề": "Title",
    "Mô tả ngắn": "Short description",
    "Avatar / chữ cái": "Avatar / initials",
    "Màu nhấn": "Accent color",
    "Số link tối đa": "Max links",
    "Nguồn dự phòng": "Fallback source",
    "Link gần đây": "Recent links",
    "Tất cả link": "All links",
    "Danh sách link public": "Public link list",
    "Kéo thả để sắp xếp. Khi đã ghim link, public page sẽ ưu tiên đúng thứ tự này.":
      "Drag to reorder. Once pinned, the public page will preserve this exact order.",
    "Dùng link gần đây": "Use recent links",
    "Dùng tất cả": "Use all",
    "Xóa thứ tự": "Clear order",
    "Có thể ghim tối đa 20 link. Dùng nút ↑ ↓ trên mobile nếu không tiện kéo.":
      "You can pin up to 20 links. Use the ↑ ↓ buttons on mobile if drag-and-drop feels awkward.",
    "Link có sẵn": "Available links",
    "Lưu cục bộ": "Save locally",
    "Làm mới preview": "Refresh preview",
    "Xem trước tiểu sử": "Bio preview",
    "Preview sẽ tự cập nhật theo dữ liệu bên trái và thứ tự link public":
      "The preview updates automatically from the fields on the left and your public link order.",
    "Làm việc nhóm": "Team workspace",
    "Gom người, quy trình và quick action cho workspace vào cùng một chỗ.":
      "Bring people, workflow, and quick actions into one workspace.",
    "Thành viên": "Members",
    "Workspace cá nhân": "Personal workspace",
    "Những người có thể thao tác ngay": "People who can act right away",
    "Lời mời": "Invitations",
    "Đang chờ xác nhận": "Awaiting confirmation",
    "Workspace": "Workspace",
    "Owner + editor + analyst trong một luồng.":
      "Owner + editor + analyst in one shared flow.",
    "Thành viên workspace": "Workspace members",
    "Email có thể mời": "Invite email",
    "Mời thành viên": "Invite member",
    "Người dùng": "Users",
    "Hoạt động gần nhất": "Last activity",
    "Mẫu link chung": "Shared templates",
    "Mẫu chung chỉ lưu nội dung share, kiểu link, video overlay và domain. Khi bấm":
      "Shared templates only store shared copy, link type, video overlay, and domain. When you click",
    "Mẫu chung chỉ khóa nội dung share, kiểu link, video overlay và domain. Khi bấm Lấy link cho tôi, editor sẽ mở popup để dán link gốc của riêng mình rồi tạo link ngay, không cần qua tab khác.":
      "Shared templates lock the shared copy, link type, video overlay, and domain. When editors click Get link for me, a popup opens so they can paste their own original URL and create the link right away without leaving this tab.",
    "Lấy link cho tôi": "Get link for me",
    "editor sẽ mở popup để dán link gốc của riêng mình rồi tạo link ngay, không cần qua tab khác.":
      "editors get a popup to paste their own original URL and create the link right away without switching tabs.",
    "Tên mẫu chung": "Shared template name",
    "Tạo mẫu chung": "Create shared template",
    "Tạo link cá nhân": "Create personal link",
    "Tải video/ảnh từ máy": "Upload video/image from device",
    "Mẫu chung chỉ khóa nội dung share, kiểu link, video overlay và domain. Editor lấy theo từng link để sửa URL gốc của riêng mình, không ảnh hưởng tới mẫu chung.":
      "Shared templates only lock shared copy, link type, video overlay, and domain. Editors use each link separately to edit their own original URL without affecting the shared template.",
    "Đăng nhập để mời cộng tác viên.": "Log in to invite collaborators.",
    "Đăng nhập để dùng mẫu liên kết chung.": "Log in to use shared link templates.",
    "Chỉ owner quản lý": "Owner only",
    "Chỉ editor được lấy": "Editors only",
    "Lời mời workspace": "Workspace invitation",
    "Chọn tối đa 5 link nguồn": "Select up to 5 source links",
    "Chọn tối đa 5 link để gom vào cùng 1 mẫu chia sẻ.": "Select up to 5 links to bundle into one shared template.",
    "Media sẽ tự lấy từ link đã tick nếu có preview, hoặc bạn có thể tải file riêng từ máy.":
      "Media will be taken automatically from selected links if a preview exists, or you can upload a separate file from your device.",
    "Sửa mẫu chung": "Edit shared template",
    "Lưu mẫu": "Save template",
    "Hủy sửa": "Cancel editing",
    "Đồng ý tham gia": "Accept invitation",
    "Quy trình giao việc": "Workflow split",
    "Chia nhỏ công việc theo role để không dồn mọi thứ vào một người.":
      "Split work by role so everything does not land on one person.",
    "Đề xuất": "Suggested",
    "Domain & phê duyệt": "Domain & approvals",
    "Xem liên kết": "View links",
    "Mô phỏng bio": "Preview bio",
    "Nhẹ & nhanh": "Light & fast",
    "Rà link": "Review links",
    "Xem stats": "View stats",
    "Tất cả link đã tạo": "All created links",
    "Danh sách liên kết": "Link list",
    "Tất cả": "All",
    "Khác": "Other",
    "OG Meta": "OG meta",
    "Clicks": "Clicks",
    "Bỏ chọn": "Clear selection",
    "Xóa đã chọn": "Delete selected",
    "Link rút gọn": "Short link",
    "Link gốc": "Original link",
    "Nền tảng": "Platform",
    "Ngày tạo": "Created",
    "Bảo mật tài khoản": "Account security",
    "Hồ sơ cá nhân": "Personal profile",
    "Cập nhật tên hiển thị, số điện thoại và avatar dùng trong dashboard.":
      "Update your display name, phone number, and avatar used across the dashboard.",
    "Mở bio public": "Open public bio",
    "Tên hiển thị": "Display name",
    "Tên hiển thị của bạn": "Your display name",
    "Số điện thoại": "Phone number",
    "Ví dụ: 09xx xxx xxx": "Example: 09xx xxx xxx",
    "Email đăng nhập": "Login email",
    "URL avatar": "Avatar URL",
    "Upload ảnh": "Upload image",
    "Lưu hồ sơ": "Save profile",
    "Hoàn tác": "Revert",
    "Avatar có thể dùng ảnh đã upload hoặc URL tuyệt đối.":
      "Your avatar can use an uploaded image or an absolute URL.",
    "Bảo mật & 2FA": "Security & 2FA",
    "Bật xác thực 2 lớp bằng ứng dụng OTP để bảo vệ đăng nhập.":
      "Enable two-factor authentication with an OTP app to protect sign-in.",
    "Chưa bật": "Not enabled",
    "Bật 2FA để yêu cầu thêm lớp xác minh khi đăng nhập từ trình duyệt hoặc thiết bị mới.":
      "Enable 2FA to require an extra verification step when signing in from a browser or a new device.",
    "Bật 2FA": "Enable 2FA",
    "Hủy thiết lập": "Cancel setup",
    "Mã xác minh 6 số": "6-digit verification code",
    "Đang kiểm tra": "Checking",
    "Chưa tải dữ liệu bảo mật.": "Security data has not loaded yet.",
    "Khóa thiết lập thủ công": "Manual setup key",
    "Quét mã bằng Google Authenticator, 1Password, Authy hoặc app OTP tương tự.":
      "Scan the code with Google Authenticator, 1Password, Authy, or a similar OTP app.",
    "Quản trị hệ thống": "System admin",
    "🛡️ Quản trị hệ thống": "🛡️ System admin",
    "Quản lý người dùng, liên kết, domain và nhật ký vận hành toàn hệ thống.":
      "Manage users, links, domains, and system-wide operations logs.",
    "Hệ thống": "System",
    "Nhật ký": "Logs",
    "Tổng người dùng": "Total users",
    "Người dùng mới hôm nay": "New users today",
    "Tổng link": "Total links",
    "Link mới hôm nay": "New links today",
    "Click unique hôm nay": "Unique clicks today",
    "Thanh toán chờ duyệt": "Payments awaiting review",
    "Xu hướng vận hành": "Operational trend",
    "User mới, click unique và yêu cầu thanh toán theo ngày":
      "New users, unique clicks, and payment requests by day",
    "7 ngày": "7 days",
    "Lượt nhấp 7 ngày gần nhất": "Clicks over the last 7 days",
    "Lượt click 7 ngày gần nhất": "Clicks over the last 7 days",
    "30 ngày": "30 days",
    "Tất cả gói": "All plans",
    "Tìm email...": "Search email...",
    "Chưa chọn người dùng nào.": "No users selected.",
    "Chọn trang này": "Select this page",
    "Chọn theo bộ lọc": "Select by filter",
    "Tên": "Name",
    "Gói hiện tại": "Current plan",
    "Yêu cầu thanh toán": "Payment requests",
    "Điều hướng quản trị": "Admin navigation",
    "Tìm theo mã thanh toán...": "Search by payment code...",
    "Tải lại": "Reload",
    "Mã": "Code",
    "Gói": "Plan",
    "Số tiền": "Amount",
    "Chuyển lúc": "Paid at",
    "Ghi chú": "Note",
    "Thao tác": "Actions",
    "Duyệt": "Approve",
    "Từ chối": "Reject",
    "Đang tải...": "Loading...",
    "Đang tải yêu cầu thanh toán...": "Loading payment requests...",
    "Đang tải team workspace...": "Loading team workspace...",
    "Đang tải mẫu link chung...": "Loading shared templates...",
    "Bộ lọc hiện có 6 người dùng": "The current filter contains 6 users",
    "Nhãn hiển thị": "Display label",
    "Domain chính": "Primary domain",
    "Hết hạn": "Expires",
    "Đặt làm domain chính": "Set as primary domain",
    "Thêm domain": "Add domain",
    "Nhãn": "Label",
    "Chính": "Primary",
    "Nguồn log:": "Log source:",
    "Thời gian": "Time",
    "Tạo QR cho link ngắn, chiến dịch hoặc trang tiểu sử":
      "Create QR codes for short links, campaigns, or bio pages",
    "Dán URL hoặc link rút gọn...": "Paste a URL or short link...",
    "Tìm kiếm...": "Search...",
    "Tìm link... (Ctrl+K)": "Search links... (Ctrl+K)",
    "Theo dõi gói hiện tại và lựa chọn nâng cấp phù hợp":
      "Track your current plan and choose the right upgrade.",
    "Dùng thử không cần đăng ký": "Try it without signing up",
    "Upload ảnh banner": "Upload banner image",
    "Thống kê nâng cao": "Advanced analytics",
    "Gói hiện tại": "Current plan",
    "Phổ biến nhất": "Most popular",
    "Đầy đủ tính năng cho affiliate marketer":
      "Full feature set for affiliate marketers",
    "Không giới hạn cho team & agency": "Unlimited for teams and agencies",
    "Không giới hạn link": "Unlimited links",
    "Tất cả tính năng Pro": "All Pro features",
    "Custom domain (sắp có)": "Custom domain (coming soon)",
    "Liên hệ →": "Contact →",
    "Liên hệ nâng cấp qua Zalo:": "Upgrade contact via Zalo:",
    "Phân tích lưu lượng chi tiết": "Detailed traffic analytics",
    "Đã tạo": "Created",
    "Phân bố nền tảng": "Platform distribution",
    "Đang tổng hợp dữ liệu click": "Aggregating click data",
    "Quốc gia": "Country",
    "Chưa có dữ liệu địa lý": "No geographic data yet",
    "Quốc gia hàng đầu": "Top countries",
    "Thành phố": "City",
    "Đang tổng hợp quốc gia...": "Aggregating countries...",
    "Nền tảng": "Platform",
    "Nền tảng hàng đầu": "Top platforms",
    "Tỷ trọng": "Share",
    "Đang tổng hợp nền tảng...": "Aggregating platforms...",
    "Quản lý hồ sơ cá nhân, lịch sử đăng nhập và xác thực 2 lớp":
      "Manage your personal profile, login history, and two-factor authentication",
    "Tài khoản cá nhân": "Personal account",
    "2FA chưa bật": "2FA not enabled",
    "Xác minh": "Verify",
    "Thiết bị đã đăng nhập": "Signed-in devices",
    "Xem các lần đăng nhập gần đây theo trình duyệt, hệ điều hành và IP.":
      "Review recent sign-ins by browser, operating system, and IP address.",
    "Làm mới": "Refresh",
    "Đang tải lịch sử đăng nhập...": "Loading login history...",
    "Chưa có lịch sử đăng nhập nào để hiển thị.":
      "No login history to display yet.",
    "Tên miền hệ thống": "System domains",
    "Tìm domain...": "Search domain...",
    "Redirect gần đây": "Recent redirects",
    "Thanh toán nâng cấp": "Upgrade payment",
    "Gói chọn": "Selected plan",
    "Số tiền": "Amount",
    "Nội dung CK": "Transfer note",
    "Đang tạo...": "Generating...",
    "Ngân hàng": "Bank",
    "Chưa cấu hình": "Not configured",
    "Số tài khoản": "Account number",
    "Chủ tài khoản": "Account holder",
    "Ghi chú thêm cho admin, ví dụ số điện thoại hoặc thời gian chuyển khoản":
      "Optional note for admin, for example phone number or transfer time",
    'Sau khi chuyển khoản xong, bấm "Đã thanh toán" để đẩy yêu cầu sang tab Quản trị > Thanh toán.':
      'After the transfer, click "Paid" to send the request to Admin > Payments.',
    "Có thể quét QR hoặc nhập tay thông tin chuyển khoản nếu QR chưa được cấu hình.":
      "You can scan the QR or manually enter the transfer details if the QR is not configured.",
    "Đóng": "Close",
    "Đã thanh toán": "Paid",
    "Xác nhận hành động": "Confirm action",
    "Bạn có chắc muốn tiếp tục thao tác này không?":
      "Are you sure you want to continue?",
    "Hủy": "Cancel",
    "Mở menu": "Open menu",
    "Đổi giao diện": "Toggle theme",
    "Mở thông báo": "Open notifications",
    "Chọn ngôn ngữ": "Choose language",
    "👥 Người dùng (": "👥 Users (",
    "💳 Yêu cầu thanh toán (": "💳 Payment requests (",
    "🌐 Tên miền hệ thống (": "🌐 System domains (",
    "🧭 Redirect gần đây (": "🧭 Recent redirects (",
    "Danh sách liên kết (": "Link list (",
    "Mẫu link chung (": "Shared templates (",
  },
};
const appUiTextPatterns = {
  "en": [
    {
      "regex": /^Danh sách liên kết \((\d+)\)$/,
      "replace": (_match, count) => `Link list (${count})`,
    },
    {
      "regex": /^Mẫu link chung \((\d+)\)$/,
      "replace": (_match, count) => `Shared templates (${count})`,
    },
    {
      "regex": /^👥 Người dùng \((\d+)\)$/,
      "replace": (_match, count) => `👥 Users (${count})`,
    },
    {
      "regex": /^💳 Yêu cầu thanh toán \((\d+)\)$/,
      "replace": (_match, count) => `💳 Payment requests (${count})`,
    },
    {
      "regex": /^Đang hiển thị (\d+) link$/,
      "replace": (_match, count) => `Showing ${count} links`,
    },
    {
      "regex": /^Bộ lọc hiện có (\d+) người dùng$/,
      "replace": (_match, count) => `The current filter contains ${count} users`,
    },
    {
      "regex": /^Hiển thị (\d+)-(\d+) \/ (\d+)$/,
      "replace": (_match, from, to, total) => `Showing ${from}-${to} / ${total}`,
    },
    {
      "regex": /^Tổng raw click: (.+)$/,
      "replace": (_match, value) => `Total raw clicks: ${value}`,
    },
    {
      "regex": /^Đang chờ chuyển khoản: (.+)$/,
      "replace": (_match, value) => `Awaiting transfer: ${value}`,
    },
    {
      "regex": /^User mới: (.+)$/,
      "replace": (_match, value) => `New users: ${value}`,
    },
    {
      "regex": /^Click unique: (.+)$/,
      "replace": (_match, value) => `Unique clicks: ${value}`,
    },
    {
      "regex": /^Thanh toán: (.+)$/,
      "replace": (_match, value) => `Payments: ${value}`,
    },
    {
      "regex": /^Đang tạo cho (.+)$/,
      "replace": (_match, value) => `Generating for ${value}`,
    },
    {
      "regex": /^(\d+) thiết bị đã được ghi nhận trên tài khoản này\.$/,
      "replace": (_match, count) =>
        `${count} devices have been recorded for this account.`,
    },
    {
      "regex": /^Seat đang dùng (\d+)\/(\d+) · Quyền của bạn (.+)$/,
      "replace": (_match, used, total, role) =>
        `Seats in use ${used}/${total} · Your role ${role}`,
    },
    {
      "regex": /^Đã chọn (\d+)\/5 link\. Media sẽ tự lấy từ link đầu tiên có preview, hoặc file upload\.$/,
      "replace": (_match, count) =>
        `Selected ${count}/5 links. Media will be taken from the first link with a preview, or from an uploaded file.`,
    },
    {
      "regex": /^Đang dùng media tải từ máy: (.+)$/,
      "replace": (_match, label) => `Using uploaded media from device: ${label}`,
    },
    {
      "regex": /^Media sẽ lấy từ link đã chọn: (.+)$/,
      "replace": (_match, label) => `Media will be taken from the selected link: ${label}`,
    },
  ],
};
const translatedTextNodes = new WeakMap();
const translatedAttributeNodes = new WeakMap();
let uiTranslationObserver = null;
const KNOWN_APP_PAGES = new Set([
  "dashboard",
  "links",
  "create",
  "qr",
  "bio",
  "team",
  "pricing",
  "stats",
  "account",
  "payment",
  "admin",
]);

function normalizeAppPage(page) {
  const raw = String(page || "")
    .trim()
    .replace(/^#/, "")
    .replace(/^\/+/, "");
  return KNOWN_APP_PAGES.has(raw) ? raw : "dashboard";
}

function buildAppPath(page = "dashboard") {
  return `/${normalizeAppPage(page)}`;
}

function getAppShellSearch(search = location.search) {
  const params = new URLSearchParams(String(search || ""));
  params.delete("next");
  params.delete("code");
  params.delete("error");
  params.delete("error_description");
  params.delete("state");
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function getAppPageFromLocation() {
  const pathname = location.pathname.replace(/\/+$/, "");
  const hashPage = String(location.hash || "")
    .replace(/^#/, "")
    .trim();
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

function isDirectAppPath(pathname = location.pathname) {
  const normalized =
    String(pathname || "")
      .trim()
      .replace(/\/+$/, "") || "/";
  if (normalized === "/") return false;
  if (normalized === "/app") return true;
  if (normalized.startsWith("/app/")) {
    return KNOWN_APP_PAGES.has(normalized.slice("/app/".length));
  }
  return KNOWN_APP_PAGES.has(normalized.replace(/^\/+/, ""));
}

function isAuthPath(pathname = location.pathname) {
  const normalized =
    String(pathname || "")
      .trim()
      .replace(/\/+$/, "") || "/";
  return (
    normalized === "/login" ||
    normalized === "/register" ||
    normalized === "/user/login" ||
    normalized === "/user/register"
  );
}

function shouldUseAppShell(pathname = location.pathname) {
  const normalized =
    String(pathname || "")
      .trim()
      .replace(/\/+$/, "") || "/";
  if (normalized === "/index.html") return true;
  if (normalized === "/app" || normalized.startsWith("/app/")) return true;
  if (isAuthPath(normalized)) return true;
  return isDirectAppPath(normalized);
}

function canonicalizeAppLocation() {
  if (!shouldUseAppShell(location.pathname)) {
    return null;
  }
  const page = getAppPageFromLocation();
  const cleanUrl = `${buildAppPath(page)}${getAppShellSearch(location.search)}`;
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
  if (
    current &&
    availableDomains.some((domain) => domain.hostname === current)
  ) {
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
    normalizeDomainChoice(createDomainSelection) ||
    getDefaultCreateDomainHost();
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

function isSupportAgentUser() {
  return isAdminUser() || String(user?.role || "").trim().toLowerCase() === "support";
}

function guardAdminRoute() {
  if (isAdminUser()) return "admin";
  if (isSupportAgentUser()) {
    adminSection = "support";
    return "admin";
  }
  if (!user) {
    redirectToAuth("login", "Cần đăng nhập để vào trang quản trị.");
    return null;
  }
  toast("Bạn không có quyền truy cập khu vực hỗ trợ.", "warn");
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
  return [
    ...new Set(value.map((item) => String(item || "").trim()).filter(Boolean)),
  ];
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
    linkSource:
      document.getElementById("bioLinkSourceInput")?.value || "recent",
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
        redirectToAuth("login", "Cần đăng nhập để lưu Bio public.");
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
  if (themeMeta) {
    themeMeta.setAttribute(
      "content",
      appTheme === "light"
        ? themeColor("--theme-color-light", "#f4f7fb")
        : themeColor("--theme-color-dark", "#0d1117"),
    );
  }
  const icons = [
    document.getElementById("themeToggleIcon"),
    document.getElementById("authThemeIcon"),
  ];
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

function syncLanguageSwitches() {
  document.querySelectorAll("[data-lang-option]").forEach((button) => {
    const isActive = button.dataset.langOption === appLanguage;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  });
}

function syncLandingIntroLanguage() {
  const copy = landingIntroCopy[appLanguage] || landingIntroCopy.vi;
  const textMap = {
    landingBrandSubline: copy.brandSubline,
    landingHeroKicker: copy.heroKicker,
    landingHeroTitle: copy.heroTitle,
    landingHeroDesc: copy.heroDesc,
    landingHeroPrimary: copy.heroPrimary,
    landingHeroSecondary: copy.heroSecondary,
    landingHeroQuick: copy.heroQuick,
    landingStepsTitle: copy.stepsTitle,
    landingStepsBadge: copy.stepsBadge,
    landingStep1Title: copy.step1Title,
    landingStep1Desc: copy.step1Desc,
    landingStep2Title: copy.step2Title,
    landingStep2Desc: copy.step2Desc,
    landingStep3Title: copy.step3Title,
    landingStep3Desc: copy.step3Desc,
    landingQuickSubmit: copy.quickSubmit,
    landingResultMessage: copy.resultMessage,
    landingResultCta: copy.resultCta,
  };
  Object.entries(textMap).forEach(([id, value]) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  });
  const quickInput = document.getElementById("landingQuickUrl");
  if (quickInput) quickInput.placeholder = copy.quickPlaceholder;
  syncTopbarSearchPlaceholder(copy.searchPlaceholder);
  const langSwitch = document.getElementById("tbLangSwitch");
  if (langSwitch) {
    langSwitch.setAttribute(
      "aria-label",
      appLanguage === "en" ? "Choose language" : "Chọn ngôn ngữ",
    );
  }
}

function applyAppLanguage(lang = appLanguage) {
  appLanguage = lang === "en" ? "en" : "vi";
  localStorage.setItem(appLanguageStorageKey, appLanguage);
  document.documentElement.lang = appLanguage;
  syncLanguageSwitches();
  syncLandingIntroLanguage();
  translateUiTree(document.body);
  ensureUiTranslationObserver();
}

function setAppLanguage(lang) {
  applyAppLanguage(lang);
}

function translateUiCoreValue(original) {
  const source = String(original || "");
  if (!source || appLanguage !== "en") return source;
  const directMap = appUiTextTranslations.en || {};
  if (Object.prototype.hasOwnProperty.call(directMap, source)) {
    return directMap[source];
  }
  for (const rule of appUiTextPatterns.en || []) {
    if (!rule?.regex || typeof rule.replace !== "function") continue;
    const match = source.match(rule.regex);
    if (match) {
      return rule.replace(...match);
    }
  }
  return source;
}

function translateUiTextValue(original) {
  const source = String(original || "");
  if (!source.trim()) return source;
  const leading = source.match(/^\s*/)?.[0] || "";
  const trailing = source.match(/\s*$/)?.[0] || "";
  const core = source.trim();
  const translated = translateUiCoreValue(core);
  return translated === core ? source : `${leading}${translated}${trailing}`;
}

function translateTextNode(node) {
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const parentTag = node.parentElement?.tagName;
  if (
    !node.nodeValue?.trim() ||
    parentTag === "SCRIPT" ||
    parentTag === "STYLE" ||
    parentTag === "NOSCRIPT"
  ) {
    return;
  }
  if (!translatedTextNodes.has(node)) {
    translatedTextNodes.set(node, node.nodeValue);
  }
  const original = translatedTextNodes.get(node) || node.nodeValue;
  const nextValue =
    appLanguage === "en" ? translateUiTextValue(original) : original;
  if (node.nodeValue !== nextValue) {
    node.nodeValue = nextValue;
  }
}

function translateElementAttributes(element) {
  if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
  const attrs = ["placeholder", "title", "aria-label"];
  let originalMap = translatedAttributeNodes.get(element);
  if (!originalMap) {
    originalMap = {};
    translatedAttributeNodes.set(element, originalMap);
  }
  attrs.forEach((attr) => {
    if (!element.hasAttribute(attr)) return;
    if (!(attr in originalMap)) {
      originalMap[attr] = element.getAttribute(attr) || "";
    }
    const original = originalMap[attr];
    const nextValue =
      appLanguage === "en" ? translateUiCoreValue(original) : original;
    if (element.getAttribute(attr) !== nextValue) {
      element.setAttribute(attr, nextValue);
    }
  });
}

function translateUiTree(root = document.body) {
  if (!root) return;
  if (root.nodeType === Node.TEXT_NODE) {
    translateTextNode(root);
    return;
  }
  if (root.nodeType === Node.ELEMENT_NODE) {
    translateElementAttributes(root);
  }
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
  );
  let current = walker.currentNode;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      translateTextNode(current);
    } else if (current.nodeType === Node.ELEMENT_NODE) {
      translateElementAttributes(current);
    }
    current = walker.nextNode();
  }
}

function ensureUiTranslationObserver() {
  if (uiTranslationObserver || typeof MutationObserver === "undefined") return;
  uiTranslationObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "characterData") {
        translateTextNode(mutation.target);
        return;
      }
      if (mutation.type === "attributes") {
        translateElementAttributes(mutation.target);
      }
      mutation.addedNodes.forEach((node) => {
        translateUiTree(node);
      });
    });
  });
  uiTranslationObserver.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["placeholder", "title", "aria-label"],
  });
}

function toggleLandingNav(force) {
  const nav = document.getElementById("landingNav");
  const shouldOpen = typeof force === "boolean" ? force : !landingNavOpen;
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
    track.style.transition = "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";
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
  track.style.transition = "transform 560ms cubic-bezier(0.22, 1, 0.36, 1)";
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
  if (isDirectAppPath(pathname)) {
    return "login";
  }
  return "landing";
}

function redirectToLoginPage(pathname = location.pathname) {
  const targetPath = String(pathname || "/dashboard").trim() || "/dashboard";
  const query = location.search || "";
  const next = `${targetPath}${query}` || "/dashboard";
  window.location.replace(`/login?next=${encodeURIComponent(next)}`);
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
  syncLandingIntroLanguage();
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
    el.textContent = enabled
      ? "Đã kết nối"
      : key === "developer"
        ? "Chưa kích hoạt"
        : "Chưa kết nối";
    el.className =
      "integration-status" +
      (key === "developer" && !enabled ? " warning" : "");
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
  const next = (
    mode === "all"
      ? pool
      : pool.slice(0, Math.max(1, Number(bioConfig?.linkCount || "12")))
  )
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
  const order = normalizeBioLinkOrder(bioConfig?.linkOrder).filter(
    (item) => item !== key,
  );
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
    .map((code) =>
      getBioPoolLinks().find((link) => getBioLinkKey(link) === code),
    )
    .filter(Boolean);
  const selectedSet = new Set(order);
  const pool = getBioPoolLinks().filter(
    (link) => !selectedSet.has(getBioLinkKey(link)),
  );

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
  if (mode === "landing") {
    window.location.replace("/");
    return;
  }
  closeLandingNav();
  setAuthRouteMode(mode);
  document.getElementById("authScreen").style.display = "flex";
  document.getElementById("appScreen").classList.remove("show");
  stopRealtimeNotificationLoop();
  closeNotificationDropdown();
  finishShellBoot();
  applyAppLanguage(appLanguage);
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
  applyAppLanguage(appLanguage);
  updateTopbar();
  loadBioConfig();
  renderForms();
  syncLabTabAvailability();
  updateIntegrationUI();
  void syncBioProfileFromServer();
  syncRouteFromLocation();
  loadData();
  startRealtimeNotificationLoop({ immediate: false });
}
function showAuth(mode = "landing") {
  if (mode === "landing") {
    window.location.replace("/");
    return;
  }
  closeLandingNav();
  setAuthRouteMode(mode);
  document.getElementById("appScreen").classList.remove("show");
  document.getElementById("authScreen").style.display = "flex";
  stopRealtimeNotificationLoop();
  closeNotificationDropdown();
  finishShellBoot();
  applyAppLanguage(appLanguage);
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
  applyAppLanguage(appLanguage);
  updateTopbar();
  loadBioConfig();
  renderForms();
  syncLabTabAvailability();
  updateIntegrationUI();
  syncRouteFromLocation();
  loadData();
  startRealtimeNotificationLoop({ immediate: false });
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
  accountLoginEvents = [];
  accountTwoFactorSetup = null;
  accountTwoFactorMode = "";
  document.getElementById("userDropdown").classList.remove("show");
  document.getElementById("userDropdown").setAttribute("aria-hidden", "true");
  stopRealtimeNotificationLoop();
  stopSupportSyncLoops();
  window.location.replace("/");
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
    const shouldShowBadge = unreadNotificationCount > 0;
    badge.hidden = !shouldShowBadge;
    badge.style.display = shouldShowBadge ? "inline-flex" : "none";
    badge.textContent = shouldShowBadge
      ? unreadNotificationCount > 9
        ? "9+"
        : unreadNotificationCount
      : "";
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
    .map(
      (
        item,
        index,
      ) => `<button class="notification-item ${item.read ? "" : "unread"}" type="button" onclick="openNotification(${index})">
  <span class="notification-icon ${item.kind || "info"}">${getNotificationIconSvg(item.kind)}</span>
  <span class="notification-copy">
    <span class="notification-label">${item.read ? "" : '<span class="notification-dot"></span>'}${esc(item.title || "Thông báo")}</span>
    <span class="notification-msg">${esc(item.message || "")}</span>
    <span class="notification-time">${esc(formatNotificationTime(item.createdAt))}</span>
  </span>
</button>`,
    )
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
  if (
    !document.getElementById("notificationDropdown")?.classList.contains("show")
  ) {
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
  notificationItems = notificationItems.map((item) => ({
    ...item,
    read: true,
  }));
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
  unreadNotificationCount = notificationItems.filter(
    (entry) => !entry.read,
  ).length;
  renderNotificationCenter();
  closeNotificationDropdown();
  if (item.url) {
    window.open(item.url, "_blank", "noopener");
    return;
  }
  if (item.page) {
    const navEl = document.querySelector(
      `.sitem[onclick*="navigate('${item.page}'"]`,
    );
    navigate(item.page, navEl);
  }
}

function loadSeenNotificationKeys() {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(notificationSeenStorageKey) || "{}",
    );
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
  const activeAlerts = Array.isArray(payload?.alerts?.active)
    ? payload.alerts.active
    : [];
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
  const activeAlerts = Array.isArray(payload?.alerts?.active)
    ? payload.alerts.active
    : [];
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

function buildAdminNotificationSnapshot(
  statsPayload = {},
  redirectPayload = {},
) {
  const newestEvent = Array.isArray(redirectPayload.events)
    ? redirectPayload.events[0]
    : null;
  return {
    totalUsers: Number(statsPayload.totalUsers || 0),
    latestRedirectKey: newestEvent
      ? `${newestEvent.timestamp || ""}:${newestEvent.requestId || ""}:${newestEvent.status || ""}`
      : "",
  };
}

function rememberAdminNotificationSnapshot(
  statsPayload = {},
  redirectPayload = {},
) {
  adminNotificationSnapshot = buildAdminNotificationSnapshot(
    statsPayload,
    redirectPayload,
  );
}

async function pollRealtimeNotifications() {
  if (!document.getElementById("appScreen")?.classList.contains("show")) return;
  try {
    const statsPayload = await getStatsPayload({ preferCache: true });
    if (statsPayload) {
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
      await loadData(statsPayload);
      if (document.getElementById("page-admin")?.classList.contains("active")) {
        void loadAdminData();
      }
      if (
        document.getElementById("page-account")?.classList.contains("active")
      ) {
        void loadAccountLoginEvents(true);
      }
      notificationStatsSnapshot = next;
    }

    if (isAdminUser()) {
      const [adminStatsResponse, redirectResponse] = await Promise.all([
        fetch("/api/admin/stats"),
        fetch("/api/admin/redirects?limit=3"),
      ]);
      const adminStatsPayload = await adminStatsResponse
        .json()
        .catch(() => null);
      const redirectPayload = await redirectResponse.json().catch(() => null);
      if (adminStatsResponse.ok && adminStatsPayload) {
        enqueueAdminAlerts(adminStatsPayload);
      }
      if (
        adminStatsResponse.ok &&
        redirectResponse.ok &&
        adminStatsPayload &&
        redirectPayload
      ) {
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

function startRealtimeNotificationLoop({ immediate = true } = {}) {
  stopRealtimeNotificationLoop();
  loadSeenNotificationKeys();
  renderNotificationCenter();
  if (immediate) {
    void pollRealtimeNotifications();
  }
  notificationPollTimer = setInterval(() => {
    if (document.hidden) return;
    void pollRealtimeNotifications();
  }, 30000);
}

function setAvatarNode(target, currentUser, fallbackText) {
  const el =
    typeof target === "string" ? document.getElementById(target) : target;
  if (!el) return;
  const avatarUrl = getUserAvatarUrl(currentUser);
  if (avatarUrl) {
    el.classList.add("has-image");
    el.innerHTML = `<img src="${esc(avatarUrl)}" alt="${esc(getUserDisplayName(currentUser) || fallbackText || "Avatar")}" />`;
    return;
  }
  el.classList.remove("has-image");
  el.textContent = fallbackText || getUserInitials(currentUser);
}

function formatAccountDateTime(value) {
  if (!value) return "Không rõ";
  try {
    return new Date(value).toLocaleString("vi-VN");
  } catch {
    return "Không rõ";
  }
}

function updateTopbar() {
  const plan = user?.plan || "guest";
  const role = user?.role || "user";
  const name = getUserDisplayName(user) || "Khách";
  const email = user?.email || "Chưa đăng nhập";
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("vi-VN")
    : "—";
  syncLanguageSwitches();
  setAvatarNode("tbAvatar", user, getUserInitials(user));
  document.getElementById("tbUname").textContent = name;
  setAvatarNode("popupAvatar", user, getUserInitials(user));
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
  document.getElementById("saveProfileBtn").style.display = user ? "" : "none";
  document.getElementById("profileHint").textContent = user
    ? "Tên này sẽ hiển thị trong giao diện và danh sách quản trị."
    : "Đăng nhập để chỉnh sửa hồ sơ cá nhân.";
  document.getElementById("ddLogout").style.display = user ? "" : "none";
  document.getElementById("ddLogin").style.display = user ? "none" : "";
  const accountShortcut = document.getElementById("userTabAccount");
  if (accountShortcut) {
    accountShortcut.querySelector("span:last-child").textContent = user
      ? "Hồ sơ cá nhân"
      : "Đăng nhập để quản lý";
  }
  const canOpenSupportInbox =
    plan === "admin" || role === "admin" || role === "support";
  document.getElementById("popupAdminBtn").style.display =
    canOpenSupportInbox ? "" : "none";
  document.getElementById("popupAdminBtn").textContent =
    role === "support" ? "Hộp thư hỗ trợ" : "Quản trị";

  const isAdmin = plan === "admin" || role === "admin";
  const adminNav = document.getElementById("adminNavItem");
  if (adminNav) {
    adminNav.style.display = canOpenSupportInbox ? "" : "none";
    const label = adminNav.querySelector(".slabel");
    if (label) label.textContent = role === "support" ? "Hỗ trợ" : "Quản trị";
  }
  const sf = document.getElementById("sidebarFooter");
  sf.style.display =
    plan === "pro" || plan === "business" || isAdmin ? "none" : "";

  renderNotificationCenter();
  updatePricingUI();
  if (document.getElementById("page-account")?.classList.contains("active")) {
    renderAccountPage();
  }
  if (document.getElementById("page-payment")?.classList.contains("active")) {
    renderPaymentPage();
  }
}

function clearUserMenuSection() {
  userMenuSection = "";
  document
    .querySelectorAll("#userDropdown .user-tab")
    .forEach((tab) => tab.classList.remove("active"));
  document
    .querySelectorAll("#userDropdown .user-panel")
    .forEach((panel) => panel.classList.remove("active"));
  document
    .getElementById("userDropdown")
    ?.querySelector(".user-panels")
    ?.classList.remove("has-active");
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
  document
    .getElementById("userDropdown")
    ?.querySelector(".user-panels")
    ?.classList.add("has-active");
  document
    .getElementById("userPanel" + tab.charAt(0).toUpperCase() + tab.slice(1))
    ?.classList.add("active");
}

function openAccountPage() {
  openAccountSection("profile");
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
    if (d.twoFactorRequired) {
      const code = window.prompt("Tài khoản này đã bật 2FA. Nhập mã OTP 6 số:");
      if (!code) return;
      const verifyResponse = await fetch("/api/auth/2fa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: d.challenge_token,
          code,
        }),
      });
      const verifyData = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) {
        errEl.textContent = verifyData.error || "Mã 2FA chưa đúng";
        errEl.classList.add("show");
        return;
      }
      user = verifyData.user;
      showApp();
      toast("✅ Đăng nhập thành công!", "ok");
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
function renderAccountProfilePreview() {
  if (!user) return;
  const draftUser = {
    ...user,
    name:
      document.getElementById("accountNameInput")?.value.trim() ||
      user.name ||
      "",
    avatar_url:
      document.getElementById("accountAvatarInput")?.value.trim() || "",
  };
  setAvatarNode("accountHeroAvatar", draftUser, getUserInitials(draftUser));
  setAvatarNode(
    "accountProfileAvatarPreview",
    draftUser,
    getUserInitials(draftUser),
  );
  document.getElementById("accountPreviewName").textContent =
    getUserDisplayName(draftUser);
  document.getElementById("accountPreviewEmail").textContent =
    draftUser.email || "Chưa có email";
}

function resetAccountProfileForm() {
  if (!user) return;
  document.getElementById("accountNameInput").value = user.name || "";
  document.getElementById("accountPhoneInput").value = user.phone || "";
  document.getElementById("accountEmailInput").value = user.email || "";
  document.getElementById("accountAvatarInput").value = user.avatar_url || "";
  renderAccountProfilePreview();
}

async function saveAccountProfile() {
  if (!user?.id) {
    redirectToAuth("login", "Cần đăng nhập để lưu hồ sơ.");
    return;
  }
  const btn = document.getElementById("accountSaveProfileBtn");
  const hint = document.getElementById("accountProfileHint");
  const payload = {
    name: document.getElementById("accountNameInput")?.value.trim() || "",
    phone: document.getElementById("accountPhoneInput")?.value.trim() || "",
    avatar_url:
      document.getElementById("accountAvatarInput")?.value.trim() || "",
  };
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang lưu...";
  }
  try {
    const response = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể lưu hồ sơ");
    }
    user = data.user;
    updateTopbar();
    renderForms();
    resetAccountProfileForm();
    if (hint) {
      hint.className = "account-note ok";
      hint.textContent = "Đã cập nhật hồ sơ tài khoản.";
    }
    toast("✅ Đã cập nhật hồ sơ", "ok");
  } catch (error) {
    if (hint) {
      hint.className = "account-note err";
      hint.textContent =
        (error && error.message) || "Không thể lưu hồ sơ lúc này.";
    }
    toast(error.message || "Không thể lưu hồ sơ", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Lưu hồ sơ";
    }
  }
}

function renderAccountTwoFactorQr(uri = "") {
  const wrap = document.getElementById("account2faQr");
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!uri) return;
  if (window.QRCodeStyling) {
    if (!accountTwoFactorQr) {
      accountTwoFactorQr = new QRCodeStyling({
        width: 180,
        height: 180,
        type: "canvas",
        data: uri,
        margin: 6,
        dotsOptions: { color: "#2563eb", type: "rounded" },
        cornersSquareOptions: { color: "#111827", type: "extra-rounded" },
        backgroundOptions: { color: "transparent" },
      });
    } else {
      accountTwoFactorQr.update({ data: uri });
    }
    accountTwoFactorQr.append(wrap);
    return;
  }
  wrap.innerHTML =
    '<div class="account-note" style="margin:0;padding:18px;text-align:center">QR chưa sẵn sàng. Hãy dùng khóa thủ công bên cạnh.</div>';
}

function renderAccountTwoFactorState() {
  if (!user) return;
  const chip = document.getElementById("account2faStatusChip");
  const summary = document.getElementById("account2faSummary");
  const setupWrap = document.getElementById("account2faSetupWrap");
  const verifyRow = document.getElementById("account2faVerifyRow");
  const primaryBtn = document.getElementById("account2faPrimaryBtn");
  const secondaryBtn = document.getElementById("account2faSecondaryBtn");
  const submitBtn = document.getElementById("account2faSubmitBtn");
  const codeLabel = document.getElementById("account2faCodeLabel");
  const hero2fa = document.getElementById("accountHero2fa");
  const secretInput = document.getElementById("account2faSecretInput");
  if (hero2fa) {
    hero2fa.textContent = user.two_factor_enabled
      ? "2FA đã bật"
      : "2FA chưa bật";
    hero2fa.className = user.two_factor_enabled
      ? "account-status-chip ok"
      : "account-status-chip warn";
  }
  if (secretInput) {
    secretInput.value = accountTwoFactorSetup?.manual_entry_key || "";
  }
  renderAccountTwoFactorQr(accountTwoFactorSetup?.otpauth_url || "");

  if (user.two_factor_enabled) {
    chip.textContent = "Đã bảo vệ";
    chip.className = "account-status-chip ok";
    summary.textContent =
      "Tài khoản đang bật xác thực 2 lớp. Mỗi lần đăng nhập mới sẽ cần thêm mã 6 số từ app OTP.";
    setupWrap.hidden = true;
    secondaryBtn.hidden = true;
    primaryBtn.textContent = "Tắt 2FA";
    verifyRow.hidden = accountTwoFactorMode !== "disable";
    codeLabel.textContent = "Nhập mã 6 số hiện tại để tắt 2FA";
    submitBtn.textContent = "Tắt 2FA";
    return;
  }

  chip.className = "account-status-chip warn";
  if (accountTwoFactorSetup) {
    chip.textContent = "Chờ xác minh";
    summary.textContent =
      "Thiết lập đã sẵn sàng. Quét mã QR hoặc nhập khóa thủ công, sau đó điền mã đầu tiên để bật 2FA.";
    setupWrap.hidden = false;
    verifyRow.hidden = false;
    primaryBtn.textContent = "Tạo lại mã";
    secondaryBtn.hidden = false;
    codeLabel.textContent = "Mã xác minh 6 số";
    submitBtn.textContent = "Bật 2FA";
    return;
  }

  chip.textContent = "Chưa bật";
  summary.textContent =
    "Bật 2FA để yêu cầu thêm lớp xác minh khi đăng nhập từ trình duyệt hoặc thiết bị mới.";
  setupWrap.hidden = true;
  verifyRow.hidden = true;
  primaryBtn.textContent = "Bật 2FA";
  secondaryBtn.hidden = true;
}

function renderAccountDevices() {
  const hint = document.getElementById("accountDevicesHint");
  const list = document.getElementById("accountDevicesList");
  if (!hint || !list) return;
  if (accountLoginEventsLoading) {
    hint.textContent = "Đang tải lịch sử đăng nhập...";
    list.innerHTML =
      '<div class="account-device-empty">Đang tổng hợp thiết bị và phiên đăng nhập gần đây...</div>';
    return;
  }
  if (!accountLoginEvents.length) {
    hint.textContent = "Chưa có lịch sử đăng nhập nào được ghi nhận.";
    list.innerHTML =
      '<div class="account-device-empty">Thiết bị mới sẽ xuất hiện tại đây sau khi bạn đăng nhập.</div>';
    return;
  }
  hint.textContent = `${accountLoginEvents.length} thiết bị đã được ghi nhận trên tài khoản này.`;
  list.innerHTML = accountLoginEvents
    .map(
      (event) => `
            <article class="account-device-card">
              <div class="account-device-top">
                <div>
                  <div class="account-device-title">${esc(event.device_label || "Thiết bị không rõ")}</div>
                  <div class="account-device-sub">${esc(event.browser_name || "Trình duyệt lạ")} • ${esc(event.os_name || "Hệ điều hành lạ")} • ${esc(event.device_type || "desktop")}</div>
                </div>
                ${event.is_new_device ? '<span class="account-device-badge">Thiết bị mới</span>' : ""}
              </div>
              <div class="account-device-meta">
                <span><small>IP</small><b>${esc(event.ip || "Không rõ")}</b></span>
                <span><small>Lần dùng gần nhất</small><b>${esc(formatAccountDateTime(event.occurred_at))}</b></span>
                <span><small>User-Agent</small><b>${esc((event.user_agent || "Không rõ").slice(0, 44))}</b></span>
              </div>
            </article>`,
    )
    .join("");
}

function syncMobileCardTableLabels(target) {
  const table =
    target instanceof HTMLElement
      ? target.closest("table")
      : document.getElementById(String(target || ""))?.closest("table") ||
        document.querySelector(String(target || ""));
  if (!table) return;
  const headers = Array.from(table.querySelectorAll("thead th")).map((th) =>
    String(th.textContent || "").trim(),
  );
  Array.from(table.tBodies || []).forEach((tbody) => {
    Array.from(tbody.rows || []).forEach((row) => {
      Array.from(row.cells || []).forEach((cell, index) => {
        if (cell.classList.contains("tbl-empty") || Number(cell.colSpan || 1) > 1) {
          cell.removeAttribute("data-label");
          return;
        }
        const fallback =
          cell.classList.contains("td-check") ||
          cell.classList.contains("td-actions")
            ? "Thao tác"
            : `Cột ${index + 1}`;
        cell.dataset.label = headers[index] || fallback;
      });
    });
  });
}

function renderAccountBillingHistory() {
  const body = document.getElementById("accountBillingHistoryBody");
  if (!body) return;
  if (!Array.isArray(billingRequests) || !billingRequests.length) {
    body.innerHTML =
      '<tr><td colspan="5" class="tbl-empty">Chưa có lịch sử thanh toán.</td></tr>';
    syncMobileCardTableLabels(body);
    return;
  }
  body.innerHTML = billingRequests
    .map(
      (request) => `
        <tr>
          <td>${esc(request.reference_code || `REQ-${request.id || "0"}`)}</td>
          <td>${esc(String(request.plan || "").toUpperCase() || "—")}</td>
          <td><span class="payment-status ${esc(request.status || "awaiting_payment")}">${esc(request.status || "awaiting_payment")}</span></td>
          <td>${esc(formatCurrencyVnd(request.amount || 0))}</td>
          <td>${esc(formatAdminDateTime(request.submitted_at || request.created_at))}</td>
        </tr>`,
    )
    .join("");
  syncMobileCardTableLabels(body);
}

function renderAccountAffiliateSettings(options = {}) {
  const preserveInputValues = !!options.preserveInputValues;
  const shopeeInput = document.getElementById("accountAffiliateShopeeInput");
  const tiktokInput = document.getElementById("accountAffiliateTikTokInput");
  const currentShopeeValue = shopeeInput?.value || "";
  const currentTikTokValue = tiktokInput?.value || "";
  if (shopeeInput) {
    shopeeInput.value = preserveInputValues
      ? currentShopeeValue
      : getUserAffiliatePresetUrl("shopee");
  }
  if (tiktokInput) {
    tiktokInput.value = preserveInputValues
      ? currentTikTokValue
      : getUserAffiliatePresetUrl("tiktok");
  }
  [
    ["shopee", "accountAffiliateShopeeStatus"],
    ["tiktok", "accountAffiliateTikTokStatus"],
  ].forEach(([platform, targetId]) => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const health = getAffiliatePresetHealthLabel(platform);
    target.textContent = health.label;
    target.className = `account-inline-status${health.tone ? ` ${health.tone}` : ""}`;
  });
}

async function loadAccountLoginEvents(force = false) {
  if (!user?.id) return;
  if (accountLoginEventsLoading) return;
  if (accountLoginEvents.length && !force) {
    renderAccountDevices();
    return;
  }
  accountLoginEventsLoading = true;
  renderAccountDevices();
  try {
    const response = await fetch("/api/auth/login-events?limit=20");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tải lịch sử đăng nhập");
    }
    accountLoginEvents = Array.isArray(data.events) ? data.events : [];
  } catch (error) {
    toast(error.message || "Không thể tải lịch sử đăng nhập", "err");
  } finally {
    accountLoginEventsLoading = false;
    renderAccountDevices();
  }
}

function renderAccountPage() {
  if (!user) {
    redirectToAuth("login", "Cần đăng nhập để quản lý tài khoản.");
    return;
  }
  document.getElementById("accountHeroName").textContent =
    getUserDisplayName(user);
  document.getElementById("accountHeroEmail").textContent =
    user.email || "Chưa có email";
  const accountHeroPlanBadge = document.getElementById("accountHeroPlan");
  if (accountHeroPlanBadge) {
    const badgeKey =
      String(user.role || "").toLowerCase() === "admin"
        ? "admin"
        : String(user.plan || "free").toLowerCase();
    accountHeroPlanBadge.textContent =
      badgeKey === "admin" ? "ADMIN" : badgeKey.toUpperCase();
    accountHeroPlanBadge.className = `account-avatar-badge is-${badgeKey}`;
  }
  resetAccountProfileForm();
  renderAccountBillingHistory();
  renderAccountAffiliateSettings();
  renderAccountTwoFactorState();
  if (!accountLoginEvents.length) {
    void loadAccountLoginEvents();
  } else {
    renderAccountDevices();
  }
}

function renderPaymentPage() {
  if (!user) {
    redirectToAuth("login", "Can dang nhap de xem thanh toan.");
    return;
  }
  setAvatarNode("paymentPageAvatar", user, "₫");
  const paymentPageEmail = document.getElementById("paymentPageEmail");
  const paymentPagePlanChip = document.getElementById("paymentPagePlanChip");
  const paymentPageRole = document.getElementById("paymentPageRole");
  if (paymentPageEmail) {
    paymentPageEmail.textContent = user.email || "Chua co email";
  }
  if (paymentPagePlanChip) {
    paymentPagePlanChip.textContent = String(user.plan || "free").toUpperCase();
  }
  if (paymentPageRole) {
    paymentPageRole.textContent = String(user.role || "user").toUpperCase();
  }
  renderAccountBillingHistory();
  if (!billingRequests.length) {
    void loadBillingData();
  }
}

function formatSupportTimelineTime(value) {
  if (!value) return "—";
  return formatAdminDateTime(value);
}

function renderSupportMessageText(value) {
  return esc(String(value || "")).replace(/\n/g, "<br>");
}

function renderSupportTimeline(
  targetId,
  messages,
  {
    viewerRole = "user",
    ownLabel = "Bạn",
    otherLabel = "Đội hỗ trợ",
    emptyText = "Chưa có tin nhắn nào.",
  } = {},
) {
  const wrap = document.getElementById(targetId);
  if (!wrap) return;
  const safeMessages = Array.isArray(messages) ? messages : [];
  if (!safeMessages.length) {
    wrap.innerHTML = `<div class="support-empty">${esc(emptyText)}</div>`;
    return;
  }
  wrap.innerHTML = safeMessages
    .map((message) => {
      const senderRole = String(message.sender_role || "user");
      const isOwn = senderRole === viewerRole;
      return `<div class="support-bubble ${isOwn ? "own" : ""}">
        <div class="support-bubble-meta">
          <strong>${esc(isOwn ? ownLabel : otherLabel)}</strong>
          <span>${esc(formatSupportTimelineTime(message.created_at))}</span>
        </div>
        <div class="support-bubble-body">${renderSupportMessageText(message.message)}</div>
      </div>`;
    })
    .join("");
  wrap.scrollTop = wrap.scrollHeight;
}

function playSupportReplySound() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;
  try {
    const ctx = new AudioCtx();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(740, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(
      1040,
      ctx.currentTime + 0.12,
    );
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.24);
    oscillator.onended = () => {
      try {
        ctx.close();
      } catch {}
    };
  } catch {}
}

function triggerSupportReplyAlert() {
  const now = Date.now();
  if (now - supportReplySoundAt < 1200) return;
  supportReplySoundAt = now;
  playSupportReplySound();
}

function renderSupportConversation() {
  const launcher = document.getElementById("supportWidgetLauncher");
  const widget = document.getElementById("supportWidget");
  const statusEl = document.getElementById("supportWidgetStatus");
  const badgeEl = document.getElementById("supportFabBadge");
  const dotEl = document.getElementById("supportFabDot");
  const noteEl = document.getElementById("supportComposerNote");
  const btn = document.getElementById("supportSendBtn");
  const canShowSupport = !!user;
  const adminPageActive = !!document
    .getElementById("page-admin")
    ?.classList.contains("active");
  const canOpenSupportPopup = canShowSupport && !isSupportAgentUser();
  const showLauncher =
    canShowSupport && !(window.innerWidth <= 768 && adminPageActive);

  if (launcher) launcher.hidden = !showLauncher;
  if (widget) {
    widget.hidden = !canOpenSupportPopup;
    widget.classList.toggle("show", canOpenSupportPopup && supportWidgetOpen);
    widget.setAttribute(
      "aria-hidden",
      canOpenSupportPopup && supportWidgetOpen ? "false" : "true",
    );
  }
  if (!showLauncher) {
    supportWidgetOpen = false;
  }
  if (!canShowSupport) {
    supportWidgetOpen = false;
    return;
  }
  if (!canOpenSupportPopup) {
    supportWidgetOpen = false;
    if (statusEl) {
      statusEl.textContent =
        "Nhân viên hỗ trợ có thể bấm icon này để mở nhanh tab Tin nhắn.";
    }
    if (badgeEl) {
      badgeEl.hidden = true;
      badgeEl.textContent = "0";
    }
    if (dotEl) dotEl.hidden = true;
    launcher?.classList.remove("has-unread");
    return;
  }

  renderSupportTimeline("supportConversationList", supportMessages, {
    viewerRole: "user",
    ownLabel: "Bạn",
    otherLabel: "Đội hỗ trợ",
    emptyText:
      "Chưa có cuộc trò chuyện nào. Hãy gửi tin nhắn đầu tiên cho đội hỗ trợ.",
  });

  if (statusEl) {
    if (supportLoading) {
      statusEl.textContent = "Đang tải hội thoại...";
    } else if (!supportLoaded) {
      statusEl.textContent = "Bấm để mở popup chat trực tiếp với đội hỗ trợ.";
    } else if (supportThread?.unread_for_user) {
      statusEl.textContent = `${supportThread.unread_for_user} phản hồi mới từ đội hỗ trợ.`;
    } else if (supportThread?.total_messages) {
      statusEl.textContent = "Hội thoại đã sẵn sàng, bạn có thể nhắn ngay.";
    } else {
      statusEl.textContent = "Chưa có hội thoại, hãy gửi tin nhắn đầu tiên.";
    }
  }

  if (badgeEl) {
    const unreadCount = supportWidgetOpen
      ? 0
      : Number(supportThread?.unread_for_user || 0);
    badgeEl.hidden = unreadCount < 1;
    badgeEl.textContent = String(unreadCount);
    launcher?.classList.toggle("has-unread", unreadCount > 0);
    if (dotEl) dotEl.hidden = unreadCount < 1;
  }

  if (noteEl) {
    noteEl.textContent =
      supportNotice ||
      (supportThread?.last_message_at
        ? `Tin nhắn gần nhất: ${formatSupportTimelineTime(supportThread.last_message_at)}`
        : "Đội hỗ trợ sẽ thấy tin nhắn này trong tab Tin nhắn.");
  }

  if (btn) {
    btn.disabled = !user || supportSending;
    btn.textContent = supportSending ? "Đang gửi..." : "Gửi hỗ trợ";
  }
}

async function loadSupportMessages(options = {}) {
  if (!user?.id || supportSyncInFlight) return;
  const peekOnly = !!options.peek;
  const silent = !!options.silent;
  const hadLoaded = supportLoaded;
  const previousMessageKey = String(
    supportMessages.at(-1)?.id ||
      supportMessages.at(-1)?.created_at ||
      supportThread?.last_message_at ||
      "",
  );
  supportSyncInFlight = true;
  if (!silent) {
    supportLoading = true;
    supportNotice = peekOnly
      ? "Đang cập nhật tin nhắn mới..."
      : "Đang đồng bộ hội thoại...";
    renderSupportConversation();
  }
  try {
    const response = await fetch(
      peekOnly ? "/api/support/messages?peek=1" : "/api/support/messages",
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tải hội thoại hỗ trợ");
    }
    supportMessages = Array.isArray(data.messages) ? data.messages : [];
    supportThread = data.thread || null;
    supportLoaded = true;
    const nextMessage = supportMessages.at(-1) || null;
    const nextMessageKey = String(
      nextMessage?.id || nextMessage?.created_at || supportThread?.last_message_at || "",
    );
    const lastSenderRole = String(
      supportThread?.last_sender_role || nextMessage?.sender_role || "",
    ).toLowerCase();
    if (
      hadLoaded &&
      nextMessageKey &&
      nextMessageKey !== previousMessageKey &&
      lastSenderRole === "admin"
    ) {
      triggerSupportReplyAlert();
    }
    if (!silent) {
      supportNotice = "";
    }
  } catch (error) {
    if (!silent || !supportLoaded) {
      supportNotice = error.message || "Không thể tải hội thoại hỗ trợ";
    }
  } finally {
    supportSyncInFlight = false;
    if (!silent) {
      supportLoading = false;
    }
    renderSupportConversation();
  }
}

async function sendSupportMessage() {
  if (!user?.id || supportSending) return;
  const input = document.getElementById("supportMessageInput");
  const message = String(input?.value || "").trim();
  if (!message) {
    toast("Nhập nội dung trước khi gửi cho đội hỗ trợ", "warn");
    input?.focus();
    return;
  }
  supportSending = true;
  supportNotice = "Đang gửi tin nhắn tới đội hỗ trợ...";
  renderSupportConversation();
  try {
    const response = await fetch("/api/support/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể gửi tin nhắn");
    }
    const created = data.message || null;
    if (created) {
      supportMessages = [...supportMessages, created];
      supportLoaded = true;
      supportThread = {
        ...(supportThread || { user_id: user.id, unread_for_user: 0 }),
        total_messages: Number(supportThread?.total_messages || 0) + 1,
        unread_for_admin: Number(supportThread?.unread_for_admin || 0) + 1,
        unread_for_user: 0,
        last_message: created.message || message,
        last_message_at: created.created_at || new Date().toISOString(),
        last_sender_role: "user",
      };
    }
    if (input) input.value = "";
    supportNotice = "Tin nhắn đã được chuyển tới đội hỗ trợ.";
    toast("Đã gửi tin nhắn tới đội hỗ trợ", "ok");
    void loadSupportMessages({ silent: true });
  } catch (error) {
    supportNotice = error.message || "Không thể gửi tin nhắn";
    toast(supportNotice, "err");
  } finally {
    supportSending = false;
    renderSupportConversation();
  }
}

function openSupportWidget() {
  if (!user) return;
  if (isSupportAgentUser()) {
    navigate("admin", document.getElementById("adminNavItem"));
    setAdminSection("support");
    void refreshAdminSupport();
    return;
  }
  supportWidgetOpen = true;
  renderSupportConversation();
  startSupportSyncLoops();
  if (!supportLoaded && !supportLoading) {
    void loadSupportMessages();
  }
}

function closeSupportWidget() {
  supportWidgetOpen = false;
  renderSupportConversation();
  startSupportSyncLoops();
}

function toggleSupportWidget() {
  if (supportWidgetOpen) {
    closeSupportWidget();
    return;
  }
  openSupportWidget();
}

async function pollSupportMessages() {
  if (!user?.id || isSupportAgentUser() || supportSending) return;
  await loadSupportMessages({
    peek: !supportWidgetOpen,
    silent: true,
  });
}

async function pollAdminSupportMessages() {
  if (!user?.id || !isSupportAgentUser() || adminSupportSending) return;
  const adminPageActive = !!document
    .getElementById("page-admin")
    ?.classList.contains("active");
  await refreshAdminSupport({
    silent: true,
    includeConversation: adminPageActive && adminSection === "support",
  });
}

function stopSupportSyncLoops() {
  if (supportEventSource) {
    supportEventSource.close();
    supportEventSource = null;
    supportEventSourceMode = "";
  }
  if (adminSupportEventSource) {
    adminSupportEventSource.close();
    adminSupportEventSource = null;
  }
  if (supportPollTimer) {
    clearInterval(supportPollTimer);
    supportPollTimer = null;
  }
  if (adminSupportPollTimer) {
    clearInterval(adminSupportPollTimer);
    adminSupportPollTimer = null;
  }
}

function syncTopbarSearchPlaceholder(placeholder) {
  const topbarSearch = document.getElementById("tbSearch");
  if (!topbarSearch) return;
  const basePlaceholder =
    placeholder ||
    (appLanguage === "en"
      ? "Search links... (Ctrl+K)"
      : "Tìm link... (Ctrl+K)");
  topbarSearch.placeholder =
    window.innerWidth <= 768
      ? basePlaceholder.replace(/\s*\([^)]*\)\s*$/, "")
      : basePlaceholder;
}

function startSupportPollingFallback() {
  if (supportPollTimer) return;
  void pollSupportMessages();
  supportPollTimer = setInterval(() => {
    if (document.hidden || !user?.id || isSupportAgentUser()) return;
    void pollSupportMessages();
  }, SUPPORT_POLL_INTERVAL_MS);
}

function startAdminSupportPollingFallback() {
  if (adminSupportPollTimer) return;
  void pollAdminSupportMessages();
  adminSupportPollTimer = setInterval(() => {
    if (document.hidden || !user?.id || !isSupportAgentUser()) return;
    void pollAdminSupportMessages();
  }, SUPPORT_POLL_INTERVAL_MS);
}

function isAdminSupportPageActive() {
  return (
    !!user?.id &&
    isSupportAgentUser() &&
    adminSection === "support" &&
    !!document.getElementById("page-admin")?.classList.contains("active")
  );
}

function shouldUseUserSupportRealtime() {
  return !!user?.id && !isSupportAgentUser() && supportWidgetOpen && !document.hidden;
}

function shouldUseAdminSupportRealtime() {
  return isAdminSupportPageActive() && !document.hidden;
}

function connectUserSupportStream() {
  if (!window.EventSource) {
    startSupportPollingFallback();
    return;
  }
  if (supportEventSourceMode === "user" && supportEventSource) {
    return;
  }
  supportEventSource?.close();
  supportEventSource = new EventSource("/api/support/stream");
  supportEventSourceMode = "user";
  supportEventSource.onopen = () => {
    if (supportPollTimer) {
      clearInterval(supportPollTimer);
      supportPollTimer = null;
    }
  };
  supportEventSource.addEventListener("ready", () => {
    if (!supportLoaded && !supportSyncInFlight) {
      void loadSupportMessages({ peek: !supportWidgetOpen, silent: true });
    }
  });
  supportEventSource.addEventListener("support:update", () => {
    void loadSupportMessages({
      peek: !supportWidgetOpen,
      silent: true,
    });
  });
  supportEventSource.onerror = () => {
    if (!user?.id || isSupportAgentUser()) return;
    startSupportPollingFallback();
  };
}

function connectAdminSupportStream() {
  if (!window.EventSource) {
    startAdminSupportPollingFallback();
    return;
  }
  if (adminSupportEventSource) {
    return;
  }
  adminSupportEventSource = new EventSource("/api/admin/support/stream");
  adminSupportEventSource.onopen = () => {
    if (adminSupportPollTimer) {
      clearInterval(adminSupportPollTimer);
      adminSupportPollTimer = null;
    }
  };
  adminSupportEventSource.addEventListener("ready", () => {
    void refreshAdminSupport({
      silent: true,
      includeConversation: false,
    });
  });
  adminSupportEventSource.addEventListener("support:update", () => {
    const adminPageActive = !!document
      .getElementById("page-admin")
      ?.classList.contains("active");
    void refreshAdminSupport({
      silent: true,
      includeConversation: adminPageActive && adminSection === "support",
    });
  });
  adminSupportEventSource.onerror = () => {
    if (!user?.id || !isSupportAgentUser()) return;
    startAdminSupportPollingFallback();
  };
}

function startSupportSyncLoops() {
  stopSupportSyncLoops();
  if (shouldUseAdminSupportRealtime()) {
    connectAdminSupportStream();
    return;
  }
  if (shouldUseUserSupportRealtime()) {
    connectUserSupportStream();
  }
}

document.addEventListener("visibilitychange", () => {
  startSupportSyncLoops();
});

async function saveAccountAffiliateSettings() {
  if (!user?.id) {
    redirectToAuth("login", "Cần đăng nhập để lưu preset affiliate.");
    return;
  }
  const btn = document.getElementById("accountSaveSettingsBtn");
  const hint = document.getElementById("accountAffiliateHint");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang lưu...";
  }
  try {
    const response = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        affiliate_shopee_url:
          document.getElementById("accountAffiliateShopeeInput")?.value.trim() ||
          "",
        affiliate_tiktok_url:
          document.getElementById("accountAffiliateTikTokInput")?.value.trim() ||
          "",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể lưu preset affiliate");
    }
    user = data.user;
    accountAffiliateHealth.shopee = null;
    accountAffiliateHealth.tiktok = null;
    updateTopbar();
    renderForms();
    renderAccountAffiliateSettings({ preserveInputValues: true });
    toast("✅ Đã lưu preset affiliate", "ok");
    if (hint) {
      hint.className = "account-note ok";
      hint.textContent =
        "Đã lưu preset affiliate thành công. Tab Tạo liên kết sẽ dùng giá trị mới.";
    }
  } catch (error) {
    if (hint) {
      hint.className = "account-note err";
      hint.textContent =
        (error && error.message) || "Không thể lưu preset affiliate lúc này.";
    }
    toast(error.message || "Không thể lưu preset affiliate", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Lưu preset affiliate";
    }
  }
}

async function checkAffiliatePreset(platform, containerId = "") {
  if (!user?.id) {
    redirectToAuth("login", "Cần đăng nhập để kiểm tra link affiliate.");
    return;
  }
  const normalized = String(platform || "").trim().toLowerCase();
  const inputId =
    normalized === "shopee"
      ? "accountAffiliateShopeeInput"
      : "accountAffiliateTikTokInput";
  const url =
    document.getElementById(inputId)?.value.trim() ||
    getUserAffiliatePresetUrl(normalized);
  if (!url) {
    toast("Nhập hoặc lưu link affiliate trước", "warn");
    return;
  }
  accountAffiliateHealth[normalized] = {
    alive: false,
    pending: true,
    note: "\u0110ang ki\u1ec3m tra",
  };
  renderAccountAffiliateSettings({ preserveInputValues: true });
  syncAffiliatePresetActionState(containerId, normalized);
  try {
    const response = await fetch("/api/affiliate/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ url, platform: normalized }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể kiểm tra link affiliate");
    }
    accountAffiliateHealth[normalized] = data;
    renderAccountAffiliateSettings({ preserveInputValues: true });
    syncAffiliatePresetActionState(containerId, normalized);
    toast(
      data.alive
        ? "✅ Link affiliate vẫn hoạt động"
        : data.note || "Link affiliate đang có lỗi",
      data.alive ? "ok" : "warn",
    );
  } catch (error) {
    if (error && typeof error === "object") {
      error.message = normalizeAffiliateHealthErrorMessage(error);
    }
    accountAffiliateHealth[normalized] = {
      alive: false,
      note: error.message || "Không thể kiểm tra",
    };
    renderAccountAffiliateSettings({ preserveInputValues: true });
    syncAffiliatePresetActionState(containerId, normalized);
    toast(error.message || "Không thể kiểm tra link affiliate", "err");
  }
}

function setActiveAffiliatePresetTarget(fieldId = "") {
  activeAffiliatePresetTargetFieldId = String(fieldId || "").trim();
}

function buildAffiliatePresetTargetFieldIds(cid) {
  return [
    `${cid}_url`,
    `${cid}_video_popup_url_5s`,
    `${cid}_video_popup_url_300s`,
  ];
}

function bindAffiliatePresetTargets(cid) {
  buildAffiliatePresetTargetFieldIds(cid).forEach((fieldId) => {
    const input = document.getElementById(fieldId);
    if (!input) return;
    const activate = () => setActiveAffiliatePresetTarget(fieldId);
    input.addEventListener("focus", activate);
    input.addEventListener("pointerdown", activate);
  });
}

function resolveAffiliatePresetTargetField(cid) {
  const preferredInput = activeAffiliatePresetTargetFieldId
    ? document.getElementById(activeAffiliatePresetTargetFieldId)
    : null;
  if (preferredInput) return preferredInput;

  const urlInput = document.getElementById(`${cid}_url`);
  const linkType = document.getElementById(`${cid}_ltype`)?.value || "direct";
  if (linkType !== "video" || !urlInput?.value.trim()) {
    return urlInput;
  }

  const stageInputs = buildAffiliatePresetTargetFieldIds(cid)
    .slice(1)
    .map((fieldId) => document.getElementById(fieldId))
    .filter(Boolean);

  return (
    stageInputs.find((input) => !input.value.trim()) ||
    stageInputs[0] ||
    urlInput
  );
}

function useAffiliatePreset(cid, platform) {
  const presetUrl = getUserAffiliatePresetUrl(platform);
  if (!presetUrl) {
    toast("Chưa có preset affiliate cho nền tảng này", "warn");
    return;
  }
  const input = resolveAffiliatePresetTargetField(cid);
  if (!input) return;
  input.value = presetUrl;
  setActiveAffiliatePresetTarget(input.id);
  if (input.id === `${cid}_url`) {
    onUrlInput(cid);
    syncAutoAliasPreview(cid);
  } else {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  }
  const platformLabel = platform === "shopee" ? "Shopee" : "TikTok";
  const targetLabel =
    input.id === `${cid}_url`
      ? "link gốc / popup 3s"
      : input.id.endsWith("_5s")
        ? "popup 5s"
        : "popup 300s";
  toast(`✅ Đã nạp link ${platformLabel} vào ${targetLabel}`, "ok");
}

async function logoutAllDevices() {
  const confirmed = await showConfirmDialog({
    title: "Đăng xuất tất cả thiết bị",
    message:
      "Tất cả phiên đăng nhập đang còn hiệu lực sẽ bị thu hồi. Bạn sẽ cần đăng nhập lại ngay sau thao tác này.",
    actionLabel: "Đăng xuất tất cả",
    tone: "danger",
  });
  if (!confirmed) return;
  const btn = document.getElementById("accountLogoutAllBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang xử lý...";
  }
  try {
    const response = await fetch("/api/auth/logout-all", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể đăng xuất tất cả thiết bị");
    }
    user = null;
    billingConfig = null;
    billingRequests = [];
    paymentRequestDraft = null;
    closeUserPopup();
    showAuth();
    toast("✅ Đã thu hồi toàn bộ phiên đăng nhập", "ok");
  } catch (error) {
    toast(error.message || "Không thể đăng xuất tất cả thiết bị", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Đăng xuất tất cả";
    }
  }
}

async function deleteAccount() {
  const confirmed = await showConfirmDialog({
    title: "Xóa tài khoản",
    message:
      "Hành động này sẽ xóa tài khoản hiện tại và không thể hoàn tác. Bạn có chắc chắn muốn tiếp tục?",
    actionLabel: "Xóa tài khoản",
    tone: "danger",
  });
  if (!confirmed) return;
  const btn = document.getElementById("accountDeleteBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Đang xóa...";
  }
  try {
    const response = await fetch("/api/auth/me", { method: "DELETE" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể xóa tài khoản");
    }
    user = null;
    billingConfig = null;
    billingRequests = [];
    paymentRequestDraft = null;
    accountLoginEvents = [];
    closeUserPopup();
    showAuth();
    toast("✅ Tài khoản đã được xóa", "ok");
  } catch (error) {
    toast(error.message || "Không thể xóa tài khoản", "err");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Xóa tài khoản";
    }
  }
}

function scrollAccountToSecurity() {
  document.getElementById("accountSecuritySection")?.scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

async function startTwoFactorSetup() {
  if (!user) return;
  if (user.two_factor_enabled) {
    accountTwoFactorMode = "disable";
    renderAccountTwoFactorState();
    document.getElementById("account2faCodeInput")?.focus();
    return;
  }
  const response = await fetch("/api/auth/2fa/setup", { method: "POST" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    toast(data.error || "Không thể khởi tạo 2FA", "err");
    return;
  }
  accountTwoFactorSetup = data.setup || null;
  accountTwoFactorMode = "setup";
  renderAccountTwoFactorState();
  document.getElementById("account2faCodeInput").value = "";
  document.getElementById("account2faCodeInput")?.focus();
}

function cancelTwoFactorSetup() {
  accountTwoFactorSetup = null;
  accountTwoFactorMode = "";
  document.getElementById("account2faCodeInput").value = "";
  renderAccountTwoFactorState();
}

async function copyAccountSetupSecret() {
  const value = document.getElementById("account2faSecretInput")?.value || "";
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
  } catch {}
  toast("📋 Đã sao chép khóa 2FA", "ok");
}

async function submitTwoFactorAction() {
  const code =
    document.getElementById("account2faCodeInput")?.value.trim() || "";
  if (!code) {
    toast("Nhập mã 2FA 6 số trước", "warn");
    return;
  }
  const endpoint =
    accountTwoFactorMode === "disable"
      ? "/api/auth/2fa/disable"
      : "/api/auth/2fa/enable";
  const button = document.getElementById("account2faSubmitBtn");
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "Đang xác minh...";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Xác minh 2FA thất bại");
    }
    user = data.user;
    accountTwoFactorSetup = null;
    accountTwoFactorMode = "";
    document.getElementById("account2faCodeInput").value = "";
    updateTopbar();
    renderAccountTwoFactorState();
    toast(
      user.two_factor_enabled ? "✅ 2FA đã được bật" : "↩️ 2FA đã được tắt",
      "ok",
    );
  } catch (error) {
    toast(error.message || "Xác minh 2FA thất bại", "err");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function formatCurrencyVnd(amount) {
  return `${Number(amount || 0).toLocaleString("vi-VN")}đ`;
}

function openNotificationCenterFromPopup() {
  closeUserPopup();
  const dropdown = document.getElementById("notificationDropdown");
  const bell = document.getElementById("notificationBellBtn");
  dropdown?.classList.add("show");
  dropdown?.setAttribute("aria-hidden", "false");
  bell?.classList.add("is-open");
}

function openAccountSecurityFromPopup() {
  openAccountSection("security");
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
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      errEl.textContent = d.error || "Lỗi đăng nhập";
      errEl.classList.add("show");
      return;
    }
    if (d.twoFactorRequired) {
      const code = window.prompt("Tài khoản này đã bật 2FA. Nhập mã OTP 6 số:");
      if (!code) return;
      const verifyResponse = await fetch("/api/auth/2fa/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challenge_token: d.challenge_token,
          code,
        }),
      });
      const verifyData = await verifyResponse.json().catch(() => ({}));
      if (!verifyResponse.ok) {
        errEl.textContent = verifyData.error || "Mã 2FA chưa đúng";
        errEl.classList.add("show");
        return;
      }
      user = verifyData.user;
      showApp();
      toast("✅ Đăng nhập thành công!", "ok");
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

async function saveProfile() {
  const input = document.getElementById("profileNameInput");
  const btn = document.getElementById("saveProfileBtn");
  if (!input || !btn) return;
  const name = input.value.trim();
  btn.disabled = true;
  btn.textContent = "Đang lưu...";
  try {
    const r = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) {
      toast(d.error || "Không thể lưu hồ sơ", "err");
      return;
    }
    user = d.user;
    updateTopbar();
    toast("✅ Đã cập nhật hồ sơ", "ok");
  } catch {
    toast("Lỗi kết nối", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Lưu hồ sơ";
  }
}

async function loadBillingData() {
  if (!user?.id) {
    billingConfig = null;
    billingRequests = [];
    return;
  }
  try {
    const response = await fetch("/api/billing/config");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return;
    billingConfig = data.config || null;
    billingRequests = Array.isArray(data.requests) ? data.requests : [];
    renderPaymentPlanPills();
    renderAccountBillingHistory();
    updateTopbar();
  } catch {}
}

function renderPaymentPlanPills() {
  const wrap = document.getElementById("paymentPlanPills");
  if (!wrap) return;
  const plans = billingConfig?.plans || [
    { code: "pro", label: "Pro", amount: 99000 },
    { code: "business", label: "Business", amount: 299000 },
  ];
  wrap.innerHTML = plans
    .map(
      (plan) =>
        `<button type="button" class="payment-pill ${paymentSelectedPlan === plan.code ? "active" : ""}" onclick="openPaymentCenter('${plan.code}')">${esc(plan.label)} • ${esc(formatCurrencyVnd(plan.amount))}</button>`,
    )
    .join("");
}

function buildVietQrImageUrl() {
  const bankId = String(billingConfig?.bank_id || "").trim();
  const bankAccount = String(billingConfig?.bank_account || "").trim();
  if (!bankId || !bankAccount || !paymentRequestDraft) return "";
  const params = new URLSearchParams();
  const amount = Number(paymentRequestDraft.amount || 0);
  if (amount > 0) {
    params.set("amount", String(amount));
  }
  if (paymentRequestDraft.transfer_note) {
    params.set("addInfo", paymentRequestDraft.transfer_note);
  }
  if (billingConfig?.account_holder) {
    params.set("accountName", billingConfig.account_holder);
  }
  const query = params.toString();
  return `https://img.vietqr.io/image/${encodeURIComponent(bankId)}-${encodeURIComponent(bankAccount)}-compact2.png${query ? `?${query}` : ""}`;
}

function renderPaymentQr() {
  const box = document.getElementById("paymentQrBox");
  if (!box) return;
  box.innerHTML = "";
  const qrImageUrl = billingConfig?.qr_image_url || buildVietQrImageUrl();
  if (qrImageUrl) {
    box.innerHTML = `<img src="${esc(qrImageUrl)}" alt="QR thanh toán" />`;
    return;
  }
  if (!window.QRCodeStyling || !paymentRequestDraft) {
    box.innerHTML =
      '<div class="payment-qr-empty">QR thanh toán chưa được cấu hình.</div>';
    return;
  }
  const payload = [
    billingConfig?.bank_name || "BocLink Payment",
    billingConfig?.bank_account || "",
    paymentRequestDraft.transfer_note || "",
    formatCurrencyVnd(paymentRequestDraft.amount),
  ]
    .filter(Boolean)
    .join("\n");
  if (!paymentQrStyler) {
    paymentQrStyler = new QRCodeStyling({
      width: 240,
      height: 240,
      type: "canvas",
      data: payload,
      margin: 8,
      dotsOptions: { color: "#2563eb", type: "rounded" },
      cornersSquareOptions: { color: "#111827", type: "extra-rounded" },
      backgroundOptions: { color: "#ffffff" },
    });
  } else {
    paymentQrStyler.update({ data: payload });
  }
  paymentQrStyler.append(box);
}

function renderPaymentModal() {
  const modal = document.getElementById("paymentModal");
  if (!modal || !paymentRequestDraft) return;
  document.getElementById("paymentModalTitle").textContent =
    `Thanh toán gói ${String(paymentRequestDraft.plan || "").toUpperCase()}`;
  document.getElementById("paymentPlanLabel").textContent = String(
    paymentRequestDraft.plan || "",
  ).toUpperCase();
  document.getElementById("paymentAmountLabel").textContent = formatCurrencyVnd(
    paymentRequestDraft.amount,
  );
  document.getElementById("paymentTransferNote").textContent =
    paymentRequestDraft.transfer_note ||
    paymentRequestDraft.reference_code ||
    "Đang tạo...";
  document.getElementById("paymentBankName").textContent =
    billingConfig?.bank_name || "Chưa cấu hình";
  document.getElementById("paymentBankAccount").textContent =
    billingConfig?.bank_account || "—";
  document.getElementById("paymentAccountHolder").textContent =
    billingConfig?.account_holder || "—";
  document.getElementById("paymentQrHint").textContent = billingConfig?.contact
    ? `Cần hỗ trợ xác nhận nhanh? Liên hệ ${billingConfig.contact}.`
    : "Có thể quét QR hoặc nhập tay thông tin chuyển khoản nếu QR chưa được cấu hình.";
  const submitBtn = document.getElementById("paymentSubmitBtn");
  if (submitBtn) {
    const alreadySubmitted =
      String(paymentRequestDraft.status || "") === "submitted";
    submitBtn.disabled = alreadySubmitted;
    submitBtn.textContent = alreadySubmitted
      ? "Đang chờ duyệt"
      : "Đã thanh toán";
  }
  renderPaymentPlanPills();
  renderPaymentQr();
  modal.classList.remove("hidden");
}

function closePaymentModal() {
  document.getElementById("paymentModal")?.classList.add("hidden");
  const payerNote = document.getElementById("paymentPayerNote");
  if (payerNote) payerNote.value = "";
}

async function createPaymentDraft(planCode = "pro") {
  const response = await fetch("/api/billing/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: planCode }),
  });
  const data = await response.json().catch(() => ({}));
  billingConfig = data.config || billingConfig;
  if (data.request) {
    paymentRequestDraft = data.request;
    paymentSelectedPlan = paymentRequestDraft?.plan || planCode;
  }
  if (!response.ok) {
    throw new Error(data.error || "Không thể tạo yêu cầu thanh toán");
  }
  paymentRequestDraft = data.request || null;
  paymentSelectedPlan = paymentRequestDraft?.plan || planCode;
}

async function openPaymentCenter(planCode = "pro") {
  if (!user?.id) {
    redirectToAuth("login", "Cần đăng nhập để tạo yêu cầu thanh toán.");
    return;
  }
  paymentSelectedPlan =
    String(planCode || "pro")
      .trim()
      .toLowerCase() || "pro";
  try {
    await createPaymentDraft(paymentSelectedPlan);
    renderPaymentModal();
  } catch (error) {
    if (paymentRequestDraft?.id) renderPaymentModal();
    toast(error.message || "Không thể mở thanh toán", "err");
  }
}

async function submitPaymentRequest() {
  if (!paymentRequestDraft?.id) return;
  const btn = document.getElementById("paymentSubmitBtn");
  const payerNote =
    document.getElementById("paymentPayerNote")?.value.trim() || "";
  btn.disabled = true;
  btn.textContent = "Đang gửi...";
  try {
    const response = await fetch(
      `/api/billing/requests/${paymentRequestDraft.id}/submit`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payer_note: payerNote }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể gửi xác nhận thanh toán");
    }
    paymentRequestDraft = data.request;
    await loadBillingData();
    closePaymentModal();
    updateTopbar();
    addNotification({
      key: `payment-${paymentRequestDraft.id}-${Date.now()}`,
      title: "Đã gửi xác nhận thanh toán",
      message: `Yêu cầu ${paymentRequestDraft.reference_code} đã được chuyển sang admin để kiểm tra.`,
      kind: "info",
      page: "admin",
    });
    toast("✅ Đã gửi xác nhận thanh toán", "ok");
  } catch (error) {
    toast(error.message || "Không thể gửi xác nhận thanh toán", "err");
  } finally {
    btn.disabled = false;
    btn.textContent = "Đã thanh toán";
  }
}

async function contactUpgrade(plan) {
  await openPaymentCenter(plan);
}

function setAdminPaymentPage(page) {
  adminPaymentPage = page;
  renderAdminPayments();
}

function renderAdminPayments() {
  const body = document.getElementById("adPaymentBody");
  const countEl = document.getElementById("adPaymentCount");
  if (!body) return;
  const filteredPayments = getFilteredAdminPayments();
  if (countEl) countEl.textContent = filteredPayments.length;
  const pagination = paginateAdminRows(filteredPayments, adminPaymentPage);
  adminPaymentPage = pagination.page;
  if (!pagination.total) {
    body.innerHTML =
      '<tr><td colspan="8" class="tbl-empty">Chưa có yêu cầu thanh toán nào.</td></tr>';
    syncMobileCardTableLabels(body);
    renderAdminPagination(
      "adPaymentPagination",
      pagination,
      "setAdminPaymentPage",
    );
    return;
  }
  body.innerHTML = pagination.rows
    .map((request) => {
      const canReview = String(request.status || "") === "submitted";
      return `<tr>
            <td><code>${esc(request.reference_code || "—")}</code></td>
            <td>
              <div style="display:grid;gap:4px">
                <strong>${esc(request.user_email || "—")}</strong>
                <span style="font-size:11px;color:var(--text3)">${esc(request.user_name || "Không rõ tên")}</span>
              </div>
            </td>
            <td>${esc(String(request.plan || "").toUpperCase())}</td>
            <td>${esc(formatCurrencyVnd(request.amount))}</td>
            <td><span class="payment-status ${esc(request.status || "awaiting_payment")}">${esc(request.status || "awaiting_payment")}</span></td>
            <td>${esc(formatAdminDateTime(request.submitted_at || request.created_at))}</td>
            <td class="td-orig" title="${esc(request.payer_note || request.admin_note || "")}">${esc(request.payer_note || request.transfer_note || "—")}</td>
            <td class="td-actions" style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn-cp" type="button" onclick="reviewAdminPayment(${request.id},'approved')" ${canReview ? "" : "disabled"}>Duyệt</button>
              <button class="btn-del" type="button" onclick="reviewAdminPayment(${request.id},'rejected')" ${canReview ? "" : "disabled"}>Từ chối</button>
            </td>
          </tr>`;
    })
    .join("");
  syncMobileCardTableLabels(body);
  renderAdminPagination(
    "adPaymentPagination",
    pagination,
    "setAdminPaymentPage",
  );
}

async function reviewAdminPayment(requestId, status) {
  const request = adminPayments.find(
    (entry) => Number(entry.id) === Number(requestId),
  );
  if (!request || String(request.status || "") !== "submitted") {
    toast("Chỉ yêu cầu đã gửi xác nhận mới được duyệt hoặc từ chối", "warn");
    return;
  }
  const label =
    status === "approved" ? "duyệt thanh toán" : "từ chối thanh toán";
  const confirmed = await showConfirmDialog({
    title: "Xác nhận thanh toán",
    message: `Bạn có chắc muốn ${label} yêu cầu #${requestId}?`,
    note:
      status === "approved"
        ? "Nếu duyệt, hệ thống sẽ mở gói tương ứng cho user."
        : "Yêu cầu sẽ chuyển sang trạng thái rejected.",
    confirmLabel: status === "approved" ? "Duyệt" : "Từ chối",
    tone: status === "approved" ? "primary" : "danger",
  });
  if (!confirmed) return;
  try {
    const response = await fetch(`/api/admin/payments/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể cập nhật thanh toán");
    }
    adminPayments = data.requests || [];
    renderAdminPayments();
    toast(
      status === "approved"
        ? "✅ Đã duyệt thanh toán"
        : "↩️ Đã từ chối thanh toán",
      "ok",
    );
  } catch (error) {
    toast(error.message || "Không thể cập nhật thanh toán", "err");
  }
}

function syncAdminSectionUI() {
  const availableSections = isAdminUser()
    ? new Set(["overview", "users", "payments", "support", "system", "logs"])
    : isSupportAgentUser()
      ? new Set(["support"])
      : new Set();
  if (!availableSections.has(adminSection)) {
    adminSection = availableSections.has("overview") ? "overview" : "support";
  }
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    const isAllowed = availableSections.has(btn.dataset.adminSection);
    const isActive = isAllowed && btn.dataset.adminSection === adminSection;
    btn.hidden = !isAllowed;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".admin-panel").forEach((panel) => {
    const isAllowed = availableSections.has(panel.dataset.adminPanel);
    const isActive = isAllowed && panel.dataset.adminPanel === adminSection;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function setAdminSection(section) {
  adminSection = section || "overview";
  syncAdminSectionUI();
  startSupportSyncLoops();
}

function renderAdminOverview(payload = {}) {
  const overview = payload?.overview || {};
  const cards = overview.cards || {};
  const health = overview.health || {};
  const actions = Array.isArray(overview.actions) ? overview.actions : [];

  const setText = (id, value) => {
    const node = document.getElementById(id);
    if (node) node.textContent = value;
  };

  setText("adTotalUsers", Number(cards.total_users || 0).toLocaleString());
  setText("adUsersToday", Number(cards.users_today || 0).toLocaleString());
  setText("adTotalLinks", Number(cards.total_links || 0).toLocaleString());
  setText("adLinksToday", Number(cards.links_today || 0).toLocaleString());
  setText(
    "adUniqueClicksToday",
    Number(cards.unique_clicks_today || 0).toLocaleString(),
  );
  setText(
    "adPendingPayments",
    Number(cards.pending_payments || 0).toLocaleString(),
  );
  setText(
    "adTotalClicksSub",
    `Tổng raw click: ${Number(health.total_raw_clicks || payload.totalClicks || 0).toLocaleString()}`,
  );
  setText(
    "adAwaitingPaymentsSub",
    `Đang chờ chuyển khoản: ${Number(health.awaiting_payments || 0).toLocaleString()}`,
  );

  setText(
    "adHealthActiveDomains",
    Number(health.active_domains || 0).toLocaleString(),
  );
  setText(
    "adHealthPendingDomains",
    Number(health.pending_domains || 0).toLocaleString(),
  );
  setText(
    "adHealthFailedDomains",
    Number(health.failed_domains || 0).toLocaleString(),
  );
  setText(
    "adHealthExpiringDomains",
    Number(health.expiring_domains || 0).toLocaleString(),
  );
  setText(
    "adHealthApprovedToday",
    Number(health.approved_today || 0).toLocaleString(),
  );
  setText(
    "adHealthApprovedRevenueMonth",
    formatCurrencyVnd(Number(health.approved_revenue_month || 0)),
  );
  setText(
    "adHealthClicksToday",
    `${Number(health.raw_clicks_today || 0).toLocaleString()} / ${Number(
      health.unique_clicks_today || 0,
    ).toLocaleString()}`,
  );

  const actionWrap = document.getElementById("adminOverviewActionList");
  if (actionWrap) {
    actionWrap.innerHTML = actions.length
      ? actions
          .map(
            (
              item,
            ) => `<div class="admin-overview-item ${esc(item.tone || "info")}">
              <strong>${esc(item.title || "Cần theo dõi")}</strong>
              <span>${esc(item.message || "")}</span>
            </div>`,
          )
          .join("")
      : '<div class="admin-overview-empty">Chưa có cảnh báo nào cần xử lý ngay.</div>';
  }

  const planWrap = document.getElementById("adminOverviewPlanList");
  if (planWrap) {
    planWrap.innerHTML = plans.length
      ? plans
          .map(
            (item) => `<div class="admin-plan-chip">
              <strong>${esc(item.label || item.key || "Plan")}</strong>
              <span>${Number(item.count || 0).toLocaleString()} user</span>
            </div>`,
          )
          .join("")
      : '<div class="admin-overview-empty">Chưa có dữ liệu gói người dùng.</div>';
  }

  const topLinksWrap = document.getElementById("adminOverviewTopLinks");
  if (topLinksWrap) {
    topLinksWrap.innerHTML = topLinks.length
      ? topLinks
          .map(
            (item) => `<div class="admin-top-link-item">
              <div class="admin-top-link-meta">
                <strong class="admin-top-link-code">${esc(item.short_code || "link")}</strong>
                <span class="admin-top-link-type">${esc(item.link_type || "direct")}</span>
              </div>
              <span class="admin-top-link-url">${esc(item.original_url || "—")}</span>
              <strong>${Number(item.clicks || 0).toLocaleString()} click</strong>
            </div>`,
          )
          .join("")
      : '<div class="admin-overview-empty">Chưa có link nào đủ dữ liệu click.</div>';
  }
  adminOverviewTrendPayload = overview.trends || null;
  renderAdminOverviewTrend();
}

function setAdminOverviewRange(days) {
  adminOverviewRangeDays = Number(days) === 30 ? 30 : 7;
  renderAdminOverviewTrend();
}

function renderAdminOverviewTrend() {
  const canvas = document.getElementById("adminOverviewChart");
  if (!canvas) return;

  const trend = adminOverviewTrendPayload || {};
  const labels = Array.isArray(trend.labels) ? trend.labels : [];
  const users = Array.isArray(trend.users) ? trend.users : [];
  const clicks = Array.isArray(trend.clicks) ? trend.clicks : [];
  const payments = Array.isArray(trend.payments) ? trend.payments : [];
  const visibleDays = adminOverviewRangeDays === 30 ? 30 : 7;
  const startAt = Math.max(labels.length - visibleDays, 0);
  const visibleLabels = labels.slice(startAt);
  const userSeries = users.slice(startAt);
  const clickSeries = clicks.slice(startAt);
  const paymentSeries = payments.slice(startAt);

  document
    .getElementById("adminOverviewRange7")
    ?.classList.toggle("active", adminOverviewRangeDays === 7);
  document
    .getElementById("adminOverviewRange30")
    ?.classList.toggle("active", adminOverviewRangeDays === 30);

  const meta = document.getElementById("adminOverviewChartMeta");
  if (meta) {
    const sum = (arr) =>
      arr.reduce((total, value) => total + Number(value || 0), 0);
    meta.innerHTML = [
      `User mới: ${sum(userSeries).toLocaleString("vi-VN")}`,
      `Click unique: ${sum(clickSeries).toLocaleString("vi-VN")}`,
      `Thanh toán: ${sum(paymentSeries).toLocaleString("vi-VN")}`,
    ]
      .map((text) => `<span>${esc(text)}</span>`)
      .join("");
  }

  if (adminOverviewChartInst) adminOverviewChartInst.destroy();
  adminOverviewChartInst = new Chart(canvas, {
    type: "line",
    data: {
      labels: visibleLabels,
      datasets: [
        {
          label: "User mới",
          data: userSeries,
          borderColor: "#8b5cf6",
          backgroundColor: "rgba(139, 92, 246, 0.14)",
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: "Click unique",
          data: clickSeries,
          borderColor: "#22c55e",
          backgroundColor: "rgba(34, 197, 94, 0.14)",
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
        {
          label: "Thanh toán",
          data: paymentSeries,
          borderColor: "#f59e0b",
          backgroundColor: "rgba(245, 158, 11, 0.14)",
          tension: 0.35,
          fill: false,
          pointRadius: 3,
          pointHoverRadius: 4,
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "index",
        intersect: false,
      },
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            color: "#94a3b8",
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: "circle",
          },
        },
        tooltip: {
          backgroundColor: "#1e2535",
          borderColor: "#2a3347",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: "#94a3b8",
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,.03)" },
          ticks: {
            color: "#64748b",
            font: { size: 11 },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: "rgba(255,255,255,.03)" },
          ticks: {
            color: "#94a3b8",
            font: { size: 11 },
            precision: 0,
          },
        },
      },
    },
  });
}

async function loadAdminData() {
  if (!isSupportAgentUser()) {
    return;
  }
  void refreshAdminSupport();
  if (!isAdminUser()) {
    adminSection = "support";
    syncAdminSectionUI();
    return;
  }
  try {
    const [sr, dr, ur, rr, pr] = await Promise.all([
      fetch("/api/admin/stats"),
      fetch("/api/admin/domains"),
      fetch("/api/admin/users"),
      fetch("/api/admin/redirects?limit=500"),
      fetch("/api/admin/payments"),
    ]);
    let statsPayload = null;
    let redirectPayload = null;
    if (sr.ok) {
      statsPayload = await sr.json();
      renderAdminOverview(statsPayload);
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
      adminUserLocationAnalytics = u.locationAnalytics || null;
      adminSelectedUserIds = new Set(
        [...adminSelectedUserIds].filter((id) =>
          adminUsers.some((userItem) => Number(userItem.id) === Number(id)),
        ),
      );
      renderAdminUserLocationAnalytics();
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
    if (pr.ok) {
      const paymentsPayload = await pr.json();
      adminPayments = paymentsPayload.requests || [];
      renderAdminPayments();
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

async function showApp() {
  closeLandingNav();
  document.getElementById("authScreen").style.display = "none";
  document.getElementById("appScreen").classList.add("show");
  finishShellBoot();
  loadThemePreference();
  await loadBillingData();
  updateTopbar();
  renderSupportConversation();
  loadBioConfig();
  renderForms();
  updateIntegrationUI();
  void syncBioProfileFromServer();
  syncRouteFromLocation();
  loadData();
  startRealtimeNotificationLoop({ immediate: false });
  startSupportSyncLoops();
}

function updateTopbar() {
  const plan = user?.plan || "guest";
  const role = user?.role || "user";
  const name = getUserDisplayName(user) || "Khách";
  const email = user?.email || "Chưa đăng nhập";
  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString("vi-VN")
    : "—";
  syncLanguageSwitches();
  setAvatarNode("tbAvatar", user, getUserInitials(user));
  document.getElementById("tbUname").textContent = name;
  setAvatarNode("popupAvatar", user, getUserInitials(user));
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
  if (billingCurrentPlan) {
    billingCurrentPlan.textContent =
      plan === "guest" ? "FREE" : plan.toUpperCase();
  }
  const billingCurrentRole = document.getElementById("billingCurrentRole");
  if (billingCurrentRole) billingCurrentRole.textContent = role || "user";
  const billingStatus = document.getElementById("billingStatus");
  if (billingStatus) {
    billingStatus.textContent =
      plan === "pro" || plan === "business" || plan === "admin"
        ? "Đã kích hoạt"
        : "Dùng thử";
  }
  const billingPromo = document.getElementById("billingPromo");
  if (billingPromo) {
    billingPromo.textContent =
      plan === "pro" || plan === "business" || plan === "admin"
        ? "Tài khoản của bạn đang mở đầy đủ tính năng cao cấp."
        : "Gói Pro mở khóa deeplink, custom OG preview và upload ảnh.";
  }
  const billingNote = document.getElementById("billingNote");
  if (billingNote) {
    billingNote.textContent =
      plan === "pro" || plan === "business" || plan === "admin"
        ? "Bạn có thể mở modal thanh toán để gia hạn hoặc đổi sang gói khác ngay trong popup."
        : "Mở modal thanh toán để quét QR, chuyển khoản và gửi xác nhận cho admin duyệt.";
  }
  const latestRequest = Array.isArray(billingRequests)
    ? billingRequests[0]
    : null;
  const billingRequestStatus = document.getElementById("billingRequestStatus");
  if (billingRequestStatus) {
    billingRequestStatus.textContent = latestRequest
      ? `Yêu cầu gần nhất: ${String(latestRequest.plan || "").toUpperCase()} • ${latestRequest.status || "awaiting_payment"} • ${formatAdminDateTime(latestRequest.submitted_at || latestRequest.created_at)}`
      : "Chưa có yêu cầu thanh toán nào gần đây.";
  }
  const profileHint = document.getElementById("profileHint");
  if (profileHint) {
    profileHint.textContent = user
      ? "Đề xuất nhóm cài đặt đầy đủ: Hồ sơ, Giao diện, Thông báo, Bảo mật, Thanh toán, Tích hợp."
      : "Đăng nhập để mở các cài đặt tài khoản và nâng cấp gói.";
  }
  const settingsThemeHint = document.getElementById("settingsThemeHint");
  if (settingsThemeHint) {
    settingsThemeHint.textContent =
      appTheme === "light"
        ? "Hiện đang dùng giao diện sáng. Bấm để chuyển sang tối."
        : "Hiện đang dùng giao diện tối. Bấm để chuyển sang sáng.";
  }
  document.getElementById("ddLogout").style.display = user ? "" : "none";
  document.getElementById("ddLogin").style.display = user ? "none" : "";
  const accountShortcut = document.getElementById("userTabAccount");
  if (accountShortcut) {
    accountShortcut.querySelector("span:last-child").textContent = user
      ? "Hồ sơ cá nhân"
      : "Đăng nhập để quản lý";
  }
  const canOpenSupportInbox =
    plan === "admin" || role === "admin" || role === "support";
  document.getElementById("popupAdminBtn").style.display =
    canOpenSupportInbox ? "" : "none";
  document.getElementById("popupAdminBtn").textContent =
    role === "support" ? "Hộp thư hỗ trợ" : "Quản trị";
  const isAdmin = plan === "admin" || role === "admin";
  const adminNav = document.getElementById("adminNavItem");
  if (adminNav) {
    adminNav.style.display = canOpenSupportInbox ? "" : "none";
    const label = adminNav.querySelector(".slabel");
    if (label) label.textContent = role === "support" ? "Hỗ trợ" : "Quản trị";
  }
  const sf = document.getElementById("sidebarFooter");
  if (sf) {
    sf.style.display =
      plan === "pro" || plan === "business" || isAdmin ? "none" : "";
  }
  renderSupportConversation();
  renderNotificationCenter();
  updatePricingUI();
  if (document.getElementById("page-account")?.classList.contains("active")) {
    renderAccountPage();
  }
}

document.addEventListener("click", (e) => {
  const userToggle = document.getElementById("tbUser");
  const userDropdown = document.getElementById("userDropdown");
  const notificationToggle = document.getElementById("notificationBellBtn");
  const notificationDropdown = document.getElementById("notificationDropdown");
  const supportLauncher = document.getElementById("supportWidgetLauncher");
  const supportWidget = document.getElementById("supportWidget");
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
  if (
    supportWidgetOpen &&
    supportLauncher &&
    supportWidget &&
    !supportLauncher.contains(e.target) &&
    !supportWidget.contains(e.target)
  ) {
    closeSupportWidget();
  }
});

window.addEventListener("resize", () => {
  syncTopbarSearchPlaceholder();
});

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event.data || {};
  if (data.type !== "article-funnel-lab:height") return;
  const embedId = String(data.embedId || "").trim();
  const frameId =
    embedId === "create"
      ? "createLabIframe"
      : embedId === "links"
        ? "linksLabIframe"
        : "";
  if (!frameId) return;
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const nextHeight = Math.max(Number(data.height || 0), frameId === "createLabIframe" ? 980 : 760);
  frame.style.height = `${nextHeight}px`;
});

function showConfirmDialog(options = {}) {
  const modal = document.getElementById("confirmModal");
  const titleEl = document.getElementById("confirmTitle");
  const messageEl = document.getElementById("confirmMessage");
  const noteEl = document.getElementById("confirmNote");
  const actionBtn = document.getElementById("confirmActionBtn");
  if (!modal || !titleEl || !messageEl || !actionBtn) {
    return Promise.resolve(
      window.confirm(options.message || "Xác nhận thao tác?"),
    );
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
  const el = document.querySelector(
    `.sitem[onclick*="navigate('${finalPage}'"]`,
  );
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
  if (page === "create") syncCreateSubtabUI();
  if (page === "links") syncLinksSubtabUI();
  if (page === "qr") renderQrPage();
  if (page === "bio") renderBioPage();
  if (page === "team") renderTeamPage();
  if (page === "account") renderAccountPage();
  if (page === "payment") renderPaymentPage();
  if (page === "admin") {
    syncAdminSectionUI();
    loadAdminData();
  }
  if (page === "stats") renderStatsPage();
  const sidebar = document.getElementById("sidebar");
  sidebar?.classList.remove("mob-open");
  document.getElementById("sidebarBackdrop")?.classList.remove("show");
  const nextUrl = `${buildAppPath(page)}${getAppShellSearch(location.search)}`;
  if (`${location.pathname}${location.search}` !== nextUrl || location.hash) {
    history.replaceState(null, "", nextUrl);
  }
  renderSupportConversation();
  startSupportSyncLoops();
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
function resolveAccountSectionId(section = "profile") {
  const normalized = String(section || "profile").trim().toLowerCase();
  if (normalized === "billing") return "accountBillingSection";
  if (normalized === "security") return "accountSecuritySection";
  if (normalized === "settings") return "accountSettingsSection";
  if (normalized === "danger") return "accountDangerSection";
  if (normalized === "devices") return "accountDevicesSection";
  return "accountProfileSection";
}

function scrollToAccountSection(section = "profile") {
  activeAccountSection = String(section || "profile").trim().toLowerCase();
  const target = document.getElementById(
    resolveAccountSectionId(activeAccountSection),
  );
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openPaymentPage() {
  closeUserPopup();
  navigate("payment");
}

function openAccountSection(section = "profile") {
  activeAccountSection = String(section || "profile").trim().toLowerCase();
  if (activeAccountSection === "billing") {
    openPaymentPage();
    return;
  }
  closeUserPopup();
  navigate("account");
  setTimeout(() => scrollToAccountSection(activeAccountSection), 60);
}

function getUserAffiliatePresetUrl(platform = "") {
  const normalized = String(platform || "").trim().toLowerCase();
  if (normalized === "shopee") {
    return String(user?.affiliate_shopee_url || "").trim();
  }
  if (normalized === "tiktok") {
    return String(user?.affiliate_tiktok_url || "").trim();
  }
  return "";
}

function getAffiliatePresetHealthLabel(platform = "") {
  const key = String(platform || "").trim().toLowerCase();
  const health = accountAffiliateHealth[key];
  if (health?.pending) return { label: "\u0110ang ki\u1ec3m tra", tone: "warn" };
  if (!health) return { label: "Chưa kiểm tra", tone: "" };
  if (health.alive) return { label: "Đang hoạt động", tone: "ok" };
  return { label: health.note || "Có lỗi", tone: "err" };
}

function canUseAffiliatePreset(platform = "") {
  const key = String(platform || "").trim().toLowerCase();
  const health = accountAffiliateHealth[key];
  return !!(health && !health.pending && health.alive);
}

function syncAffiliatePresetActionState(containerId = "", platform = "") {
  const normalized = String(platform || "").trim().toLowerCase();
  if (!containerId || !normalized) return;
  const health = getAffiliatePresetHealthLabel(normalized);
  const statusEl = document.getElementById(
    `${containerId}_presetStatus_${normalized}`,
  );
  const useBtn = document.getElementById(
    `${containerId}_presetUse_${normalized}`,
  );
  const checkBtn = document.getElementById(
    `${containerId}_presetCheck_${normalized}`,
  );
  if (statusEl) {
    statusEl.textContent = health.label;
    statusEl.className = `affiliate-preset-status${health.tone ? ` ${health.tone}` : ""}`;
  }
  if (useBtn) {
    useBtn.disabled = !canUseAffiliatePreset(normalized);
  }
  if (checkBtn) {
    const pending = !!accountAffiliateHealth[normalized]?.pending;
    checkBtn.disabled = pending;
    checkBtn.textContent = pending ? "Đang check..." : "Check";
  }
}

function normalizeAffiliateHealthErrorMessage(error) {
  const rawMessage = String(error?.message || "").trim();
  if (!rawMessage) return "Kh\u00f4ng th\u1ec3 ki\u1ec3m tra link affiliate l\u00fac n\u00e0y.";
  if (/failed to fetch/i.test(rawMessage)) {
    return "Kh\u00f4ng k\u1ebft n\u1ed1i \u0111\u01b0\u1ee3c t\u1edbi API ki\u1ec3m tra affiliate.";
  }
  return rawMessage;
}

function buildAffiliatePresetMarkup(containerId) {
  const presets = [
    {
      key: "shopee",
      label: "Shopee",
      url: getUserAffiliatePresetUrl("shopee"),
    },
    {
      key: "tiktok",
      label: "TikTok",
      url: getUserAffiliatePresetUrl("tiktok"),
    },
  ];
  const availablePresets = presets.filter((preset) => !!preset.url);
  if (!availablePresets.length) {
    return `
      <div class="affiliate-preset-shell empty">
        <div class="affiliate-preset-empty">
          Chưa có link affiliate mặc định. Vào <span class="upgrade-link" onclick="openAccountSection('settings')">Tài khoản → Cài đặt</span> để lưu sẵn Shopee hoặc TikTok.
        </div>
      </div>`;
  }
  return `
    <div class="affiliate-preset-shell">
      <div class="affiliate-preset-head">
        <div>
          <strong>Link affiliate đã lưu</strong>
          <span>Chọn nhanh để đổ vào form, không cần dán lại mỗi lần.</span>
        </div>
        <button class="btn-cp" type="button" onclick="openAccountSection('settings')">Chỉnh preset</button>
      </div>
      <div class="affiliate-preset-grid">
        ${availablePresets
          .map((preset) => {
            const health = getAffiliatePresetHealthLabel(preset.key);
            const pending = !!accountAffiliateHealth[preset.key]?.pending;
            const usable = canUseAffiliatePreset(preset.key);
            return `
              <div class="affiliate-preset-card">
                <div class="affiliate-preset-copy">
                  <b>${esc(preset.label)}</b>
                  <span title="${esc(preset.url)}">${esc(preset.url)}</span>
                </div>
                <div class="affiliate-preset-actions">
                  <span class="affiliate-preset-status ${health.tone}" id="${containerId}_presetStatus_${preset.key}">${esc(health.label)}</span>
                  <button class="btn-cp" type="button" id="${containerId}_presetUse_${preset.key}" onclick="useAffiliatePreset('${containerId}','${preset.key}')" ${usable ? "" : "disabled"}>Dùng link</button>
                  <button class="btn-cp" type="button" id="${containerId}_presetCheck_${preset.key}" onclick="checkAffiliatePreset('${preset.key}','${containerId}')" ${pending ? "disabled" : ""}>${pending ? "Đang check..." : "Check"}</button>
                </div>
              </div>`;
          })
          .join("")}
      </div>
    </div>`;
}

function buildAutoAliasFromInputs(title, url) {
  const titleAlias = slugifyAliasValue(
    String(title || "").trim(),
    AUTO_ALIAS_MAX_LENGTH,
  );
  if (titleAlias) return titleAlias;
  const fallbackAlias = extractAliasFromShortUrl(url);
  return slugifyAliasValue(fallbackAlias || "link-moi", AUTO_ALIAS_MAX_LENGTH);
}

function syncAutoAliasPreview(cid) {
  const alias = buildAutoAliasFromInputs(
    document.getElementById(`${cid}_ogtitle`)?.value.trim() || "",
    document.getElementById(`${cid}_url`)?.value.trim() || "",
  );
  const preview = document.getElementById(`${cid}_aliaspreview`);
  if (preview) {
    preview.textContent = alias || "alias-tu-dong-tu-tieu-de";
  }
  return alias;
}

function setCreateAiHint(cid, message = "", tone = "") {
  const hint = document.getElementById(`${cid}_aihint`);
  if (!hint) return;
  hint.textContent = message || "";
  hint.className = `create-ai-hint${message ? " show" : ""}${tone ? ` ${tone}` : ""}`;
}

function renderForms() {
  renderForm("createFormArea");
  applyPendingTeamTemplateDraft("createFormArea");
}

function canUseLabTabs() {
  return isAdminUser();
}

function normalizeLabSharedSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  return {
    shareImage: String(source.shareImage || "").trim(),
    overlayImage: String(source.overlayImage || "").trim(),
    overlay20sImage: String(source.overlay20sImage || "").trim(),
    overlay300sImage: String(source.overlay300sImage || "").trim(),
    popup300sUrl: String(source.popup300sUrl || "").trim(),
    groupLabel: String(source.groupLabel || "").trim(),
    groupUrl: String(source.groupUrl || "").trim(),
    backupLabel: String(source.backupLabel || "").trim(),
    backupUrl: String(source.backupUrl || "").trim(),
  };
}

function getLabSharedSettings() {
  try {
    const raw = localStorage.getItem(labSharedSettingsStorageKey);
    if (!raw) return normalizeLabSharedSettings();
    return normalizeLabSharedSettings(JSON.parse(raw));
  } catch {
    return normalizeLabSharedSettings();
  }
}

function setLabSharedSettings(value) {
  const normalized = normalizeLabSharedSettings(value);
  localStorage.setItem(labSharedSettingsStorageKey, JSON.stringify(normalized));
  return normalized;
}

function getLabSharedSettingsFormValueMap() {
  return {
    shareImage: document.getElementById("labSharedShareImageInput"),
    overlayImage: document.getElementById("labSharedOverlayImageInput"),
    overlay20sImage: document.getElementById("labSharedOverlay20ImageInput"),
    overlay300sImage: document.getElementById("labSharedOverlay300ImageInput"),
    popup300sUrl: document.getElementById("labSharedPopup300UrlInput"),
    groupLabel: document.getElementById("labSharedGroupLabelInput"),
    groupUrl: document.getElementById("labSharedGroupUrlInput"),
    backupLabel: document.getElementById("labSharedBackupLabelInput"),
    backupUrl: document.getElementById("labSharedBackupUrlInput"),
  };
}

const labSharedImageFieldConfig = {
  overlayImage: {
    inputId: "labSharedOverlayImageInput",
    fileInputId: "labSharedOverlayImageFileInput",
    statusId: "labSharedOverlayImageStatus",
    buttonId: "labSharedOverlayImagePickerBtn",
    pendingMessage: "Đang upload ảnh popup 3 giây...",
    successMessage: "Đã tải ảnh popup 3 giây lên",
  },
  overlay20sImage: {
    inputId: "labSharedOverlay20ImageInput",
    fileInputId: "labSharedOverlay20ImageFileInput",
    statusId: "labSharedOverlay20ImageStatus",
    buttonId: "labSharedOverlay20ImagePickerBtn",
    pendingMessage: "Đang upload ảnh popup 20 giây...",
    successMessage: "Đã tải ảnh popup 20 giây lên",
  },
  overlay300sImage: {
    inputId: "labSharedOverlay300ImageInput",
    fileInputId: "labSharedOverlay300ImageFileInput",
    statusId: "labSharedOverlay300ImageStatus",
    buttonId: "labSharedOverlay300ImagePickerBtn",
    pendingMessage: "Đang upload ảnh popup 300 giây...",
    successMessage: "Đã tải ảnh popup 300 giây lên",
  },
};

function setLabSharedImageStatus(assetKey, message, tone = "") {
  const config = labSharedImageFieldConfig[assetKey];
  const status = config ? document.getElementById(config.statusId) : null;
  if (!status) return;
  status.textContent = message || "";
  if (tone) {
    status.dataset.tone = tone;
  } else {
    delete status.dataset.tone;
  }
}

function setLabSharedImageBusy(assetKey, busy) {
  const config = labSharedImageFieldConfig[assetKey];
  if (!config) return;
  const pickerButton = document.getElementById(config.buttonId);
  const fileInput = document.getElementById(config.fileInputId);
  if (pickerButton) pickerButton.disabled = !!busy;
  if (fileInput) fileInput.disabled = !!busy;
}

function triggerLabSharedImagePicker(assetKey) {
  const config = labSharedImageFieldConfig[assetKey];
  if (!config) return;
  const fileInput = document.getElementById(config.fileInputId);
  if (fileInput && !fileInput.disabled) {
    fileInput.click();
  }
}

async function handleLabSharedImagePicked(assetKey, input) {
  const config = labSharedImageFieldConfig[assetKey];
  const file = input?.files?.[0];
  if (!config || !file) return;
  try {
    setLabSharedImageBusy(assetKey, true);
    setLabSharedImageStatus(assetKey, config.pendingMessage, "warn");
    const fd = new FormData();
    fd.append("image", file);
    const response = await fetch("/api/upload-image", {
      method: "POST",
      body: fd,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload?.url) {
      throw new Error(payload?.error || "Upload ảnh thất bại");
    }
    const absoluteUrl = String(payload.url || "").startsWith("/")
      ? window.location.origin + payload.url
      : String(payload.url || "");
    const targetInput = document.getElementById(config.inputId);
    if (targetInput) {
      targetInput.value = absoluteUrl;
    }
    setLabSharedImageStatus(assetKey, "Upload ảnh xong", "ok");
    toast(config.successMessage);
  } catch (error) {
    const message = error?.message || "Upload ảnh thất bại";
    setLabSharedImageStatus(assetKey, message, "err");
    toast(message);
  } finally {
    if (input) input.value = "";
    setLabSharedImageBusy(assetKey, false);
  }
}

function buildLabEmbedSrcdoc(frameId, forceRefresh = false) {
  const frame = document.getElementById(frameId);
  const rawTemplate = window.__ARTICLE_FUNNEL_LAB_TEMPLATE_HTML__;
  const template = typeof rawTemplate === "string"
    ? rawTemplate.trim()
    : String(rawTemplate?.value || "").trim();
  if (!frame || !template) return "";
  const view = String(frame.dataset.labView || "").trim().toLowerCase() || "editor";
  const embedId = String(frame.dataset.labEmbedId || "").trim() || frameId;
  const embedConfigScript = `<script>window.__ARTICLE_FUNNEL_LAB_EMBED__ = ${JSON.stringify({
    embed: true,
    view,
    embedId,
    refreshToken: forceRefresh ? Date.now().toString(36) : labEmbedCacheBust,
  })};<\/script>`;
  const baseTag = `<base href="${window.location.origin}/">`;
  return template.replace("<head>", `<head>${baseTag}${embedConfigScript}`);
}

function ensureLabEmbedLoaded(frameId) {
  const frame = document.getElementById(frameId);
  if (!frame || frame.dataset.loaded === "true") return;
  const nextSrcdoc = buildLabEmbedSrcdoc(frameId);
  if (!nextSrcdoc) return;
  frame.srcdoc = nextSrcdoc;
  frame.dataset.loaded = "true";
}

function refreshLabEmbed(frameId) {
  const frame = document.getElementById(frameId);
  if (!frame) return;
  const nextSrcdoc = buildLabEmbedSrcdoc(frameId, true);
  if (!nextSrcdoc) return;
  frame.srcdoc = nextSrcdoc;
  frame.dataset.loaded = "true";
}

function postLabSharedSettingsToFrame(frameId, settings) {
  const frame = document.getElementById(frameId);
  if (!frame) return;
  ensureLabEmbedLoaded(frameId);
  const payload = normalizeLabSharedSettings(settings);
  const sendSettings = () => {
    try {
      frame.contentWindow?.postMessage(
        { type: "article-funnel-lab:apply-shared-settings", settings: payload },
        window.location.origin,
      );
    } catch (_) {}
  };
  if (frame.contentWindow) {
    sendSettings();
    setTimeout(sendSettings, 180);
    return;
  }
  frame.addEventListener("load", sendSettings, { once: true });
}

function openLabSharedSettingsModal(frameId = "createLabIframe") {
  const modal = document.getElementById("labSharedSettingsModal");
  if (!modal) return;
  modal.dataset.frameId = frameId;
  const settings = getLabSharedSettings();
  const fields = getLabSharedSettingsFormValueMap();
  Object.entries(fields).forEach(([key, input]) => {
    if (input) {
      input.value = settings[key] || "";
    }
  });
  Object.keys(labSharedImageFieldConfig).forEach((assetKey) => {
    const statusDefaults = {
      overlayImage: "Có thể dán URL hoặc chọn ảnh từ máy.",
      overlay20sImage: "Để trống nếu muốn dùng lại ảnh popup 3 giây.",
      overlay300sImage: "Để trống nếu muốn dùng lại ảnh popup 3 giây.",
    };
    setLabSharedImageStatus(assetKey, statusDefaults[assetKey] || "");
  });
  modal.classList.remove("hidden");
  requestAnimationFrame(() => {
    document.getElementById("labSharedShareImageInput")?.focus();
  });
}

function closeLabSharedSettingsModal() {
  document.getElementById("labSharedSettingsModal")?.classList.add("hidden");
}

function saveLabSharedSettingsModal() {
  const modal = document.getElementById("labSharedSettingsModal");
  if (!modal) return;
  const fields = getLabSharedSettingsFormValueMap();
  const nextSettings = normalizeLabSharedSettings(
    Object.fromEntries(
      Object.entries(fields).map(([key, input]) => [key, input?.value || ""]),
    ),
  );
  const savedSettings = setLabSharedSettings(nextSettings);
  const frameId = modal.dataset.frameId || "createLabIframe";
  postLabSharedSettingsToFrame(frameId, savedSettings);
  closeLabSharedSettingsModal();
  toast("Đã lưu cài đặt mặc định cho lab mới");
}

function syncCreateSubtabUI() {
  const allowLab = canUseLabTabs();
  const activeTab = allowLab && createSubtab === "lab" ? "lab" : "standard";
  if (activeTab !== createSubtab) {
    createSubtab = activeTab;
    localStorage.setItem(createSubtabStorageKey, createSubtab);
  }
  document.querySelectorAll("[data-create-subtab]").forEach((button) => {
    const isActive = button.dataset.createSubtab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll("[data-create-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.createPanel !== activeTab;
  });
  if (activeTab === "lab") {
    ensureLabEmbedLoaded("createLabIframe");
  }
}

function syncLinksSubtabUI() {
  const allowLab = canUseLabTabs();
  const activeTab = allowLab && linksSubtab === "lab" ? "lab" : "standard";
  if (activeTab !== linksSubtab) {
    linksSubtab = activeTab;
    localStorage.setItem(linksSubtabStorageKey, linksSubtab);
  }
  document.querySelectorAll("[data-links-subtab]").forEach((button) => {
    const isActive = button.dataset.linksSubtab === activeTab;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll("[data-links-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.linksPanel !== activeTab;
  });
  if (activeTab === "lab") {
    ensureLabEmbedLoaded("linksLabIframe");
  }
}

function syncLabTabAvailability() {
  const allowLab = canUseLabTabs();
  document.querySelectorAll("[data-lab-tab-only]").forEach((node) => {
    node.hidden = !allowLab;
  });
  if (!allowLab) {
    createSubtab = "standard";
    linksSubtab = "standard";
    localStorage.setItem(createSubtabStorageKey, createSubtab);
    localStorage.setItem(linksSubtabStorageKey, linksSubtab);
  }
  syncCreateSubtabUI();
  syncLinksSubtabUI();
}

function setCreateSubtab(tab, el) {
  createSubtab = tab === "lab" && canUseLabTabs() ? "lab" : "standard";
  localStorage.setItem(createSubtabStorageKey, createSubtab);
  syncCreateSubtabUI();
  if (el) el.blur();
}

function setLinksSubtab(tab, el) {
  linksSubtab = tab === "lab" && canUseLabTabs() ? "lab" : "standard";
  localStorage.setItem(linksSubtabStorageKey, linksSubtab);
  syncLinksSubtabUI();
  if (el) el.blur();
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
  const shouldRenderInlineResult = containerId !== "createFormArea";
  const resultCardMarkup = `
    <div class="res-card" id="${containerId}_res">
      <div class="res-row">
        <div class="res-main">
          <a class="res-url" id="${containerId}_resurl" href="#" target="_blank"></a>
          <div class="res-meta" id="${containerId}_resmeta"></div>
          <div class="res-dl" id="${containerId}_resdl" style="display:none"></div>
        </div>
        <div class="res-side">
          <div class="res-lbl">✅ Link rút gọn của bạn</div>
          <button class="btn-cp" id="${containerId}_cpbtn" onclick="copyResult('${containerId}')">Sao chép</button>
        </div>
      </div>
    </div>`;

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
    <div id="${containerId}_templateNotice" style="display:none"></div>
    ${buildAffiliatePresetMarkup(containerId)}

        <!-- ① URL + nút rút gọn -->
        <div class="url-bar" style="margin-bottom:12px">
          <input type="url" id="${containerId}_url" class="url-bar-input"
            placeholder="Dán link Shopee, TikTok hoặc bất kỳ URL nào..."
            autocomplete="off" spellcheck="false"/>
          <button class="btn-go" id="${containerId}_btn" onclick="doShorten('${containerId}')">
            ⚡ Rút gọn
          </button>
        </div>
        <div class="url-inline-hint" id="${containerId}_urlhint"></div>

        <!-- Detect badge -->
        <div class="det" id="${containerId}_det" style="margin-bottom:10px"></div>

        <!-- ② Alias tự động + Domain -->
        <div class="create-form-grid create-form-grid--alias-domain">
          <div>
            <label class="fl" style="margin-bottom:4px">Alias tự động từ tiêu đề</label>
            <div class="auto-alias-box">
              <span id="${containerId}_domainprefix" style="font-size:12px;color:var(--text3);white-space:nowrap">${getCreateDomainPreviewHost()}/</span>
              <span class="auto-alias-preview" id="${containerId}_aliaspreview">alias-tu-dong-tu-tieu-de</span>
            </div>
            <div class="auto-alias-note">Không cần nhập alias. Hệ thống sẽ tự tạo từ tiêu đề và nâng giới hạn lên 90 ký tự.</div>
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
              <div id="${containerId}_videoUploadStatus" style="display:none;margin-top:4px;font-size:11px;color:var(--text3)"></div>
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
                <label class="fl" style="margin-bottom:3px">Nội dung CTA popup</label>
                <input type="text" class="fi" id="${containerId}_videotext"
                  placeholder="🛒 Bấm để xem sản phẩm →" maxlength="80" style="font-size:12px"/>
              </div>
              <div>
                <label class="fl" style="margin-bottom:3px">Link popup riêng theo từng mốc (tùy chọn)</label>
                <div style="display:grid;gap:7px">
                  <input type="hidden" id="${containerId}_video_popup_url_3s"/>
                  <div style="padding:9px 12px;border:1px dashed var(--border2);border-radius:8px;background:var(--bg4);font-size:12px;color:var(--text2)">
                    Popup <strong style="color:var(--text)">3s</strong> mặc định mở <strong style="color:var(--text)">link gốc ở trên</strong>.
                  </div>
                  <input type="url" class="fi" id="${containerId}_video_popup_url_5s"
                    placeholder="Popup 5s mở link nào (để trống = dùng link gốc ở trên)" style="font-size:12px"/>
                  <input type="url" class="fi" id="${containerId}_video_popup_url_300s"
                    placeholder="Popup 300s mở link nào (để trống = dùng link gốc ở trên)" style="font-size:12px"/>
                </div>
                <div id="${containerId}_videoLinkRolesHint" style="margin-top:8px;padding:8px 10px;border-radius:8px;background:rgba(59,130,246,.08);font-size:11px;color:var(--text2)"></div>
              </div>
              <div class="create-ai-actions">
                <button type="button" class="btn-cp" onclick="triggerVideoMetadataAi('${containerId}', true)">AI gợi ý title & desc</button>
                <span class="create-ai-note">Khi có video hoặc thumbnail, AI sẽ gợi ý tiêu đề và mô tả theo nội dung.</span>
              </div>
            </div>
          </div>

          <div style="margin-top:8px;padding:6px 10px;background:rgba(59,130,246,.07);border-radius:6px;
                      font-size:11px;color:var(--text2)">
            💡 Video autoplay → popup 3s → popup 5s chồng lớp → popup 300s → user bấm popup trên cùng để mở App Shopee/TikTok.<br/>
            ✏️ Tiêu đề, mô tả và ảnh preview nhập ở phần <strong>Preview khi share</strong> bên dưới.
          </div>
          <div class="create-ai-hint" id="${containerId}_aihint"></div>
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
              <div id="${containerId}_imgUploadStatus" style="display:none;margin-bottom:8px;font-size:11px;color:var(--text3)"></div>
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
        ${shouldRenderInlineResult ? resultCardMarkup : ""}
  </div>`;

  if (!shouldRenderInlineResult) {
    const resultMount = document.getElementById("createLatestResultMount");
    if (resultMount) resultMount.innerHTML = resultCardMarkup;
  }

  bindAffiliatePresetTargets(containerId);
  ["shopee", "tiktok"].forEach((platform) =>
    syncAffiliatePresetActionState(containerId, platform),
  );
  [
    `${containerId}_video_popup_url_3s`,
    `${containerId}_video_popup_url_5s`,
    `${containerId}_video_popup_url_300s`,
  ].forEach((fieldId) => {
    const input = document.getElementById(fieldId);
    if (!input) return;
    input.addEventListener("input", () => syncVideoOverlayRoleHint(containerId));
  });
  syncVideoOverlayRoleHint(containerId);

  // Attach URL input events
  const urlIn = document.getElementById(`${containerId}_url`);
  if (urlIn) {
    urlIn.addEventListener("input", () => onUrlInput(containerId));
    urlIn.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doShorten(containerId);
    });
  }
  syncVideoOptionAvailability(containerId);
  updateCreateDomainDisplay(containerId);
  syncAutoAliasPreview(containerId);
}

function setCreateUrlHint(cid, message) {
  const hint = document.getElementById(`${cid}_urlhint`);
  if (!hint) return;
  hint.textContent = message || "";
  hint.classList.toggle("show", !!message);
}

function syncVideoOverlayRoleHint(cid) {
  const hint = document.getElementById(`${cid}_videoLinkRolesHint`);
  if (!hint) return;
  const linkType = document.getElementById(`${cid}_ltype`)?.value || "direct";
  if (linkType !== "video") {
    hint.style.display = "none";
    hint.textContent = "";
    return;
  }
  const baseUrl = document.getElementById(`${cid}_url`)?.value.trim() || "";
  const stages = [
    {
      key: "5s",
      label: "5s",
      value:
        document.getElementById(`${cid}_video_popup_url_5s`)?.value.trim() || "",
    },
    {
      key: "300s",
      label: "300s",
      value:
        document.getElementById(`${cid}_video_popup_url_300s`)?.value.trim() || "",
    },
  ];
  const overrideStages = stages.filter((stage) => !!stage.value).map((stage) => stage.label);
  const fallbackStages = stages.filter((stage) => !stage.value).map((stage) => stage.label);

  let message =
    "Link ở ô trên là link gốc của short link video và cũng là link popup 3s mặc định.";
  if (!baseUrl) {
    message += " Các ô dưới chỉ là link popup riêng cho mốc 5s và 300s khi bạn cần override.";
  } else if (!overrideStages.length) {
    message += " Hiện tại popup 3s / 5s / 300s đều đang dùng chính link gốc này.";
  } else if (overrideStages.length === stages.length) {
    message +=
      " Popup 5s và 300s đang dùng link riêng bên dưới; popup 3s vẫn dùng link gốc ở trên.";
  } else {
    message += ` Popup ${overrideStages.join(" / ")} dùng link riêng; mốc ${fallbackStages.join(" / ")} vẫn dùng link gốc ở trên cùng với popup 3s.`;
  }

  hint.style.display = "block";
  hint.textContent = message;
}

function syncVideoOptionAvailability(cid) {
  const url = document.getElementById(`${cid}_url`)?.value.trim() || "";
  const select = document.getElementById(`${cid}_ltype`);
  const videoOption = select?.querySelector('option[value="video"]');
  const videoSection = document.getElementById(`${cid}_videosec`);
  if (!select || !videoOption) return;

  const shouldShowVideoOption = !url || isShopeeUrlCandidate(url);
  videoOption.hidden = !shouldShowVideoOption;
  videoOption.disabled = !shouldShowVideoOption;

  if (!shouldShowVideoOption && select.value === "video") {
    select.value = "direct";
    if (videoSection) videoSection.className = "video-sec";
    setCreateUrlHint(cid, "Kiểu link Video Overlay chỉ hỗ trợ link Shopee");
  } else if (shouldShowVideoOption) {
    setCreateUrlHint(cid, "");
  }
  syncVideoOverlayRoleHint(cid);
}

function onUrlInput(cid) {
  const url = document.getElementById(`${cid}_url`)?.value.trim() || "";
  const det = document.getElementById(`${cid}_det`);
  if (det) {
    if (/shopee\.vn/i.test(url)) {
      det.className = "det shopee show";
      det.innerHTML = "🛒 Đã phát hiện link Shopee – Deeplink mở thẳng App!";
    } else if (/tiktok\.com/i.test(url)) {
      det.className = "det tiktok show";
      det.innerHTML = "🎵 Đã phát hiện link TikTok – Deeplink mở thẳng App!";
    } else {
      det.className = "det";
    }
  }

  syncVideoOptionAvailability(cid);
  updateCreateDomainDisplay(cid);
  syncAutoAliasPreview(cid);
  document.getElementById(`${cid}_res`)?.classList.remove("show");
  document.getElementById(`${cid}_err`)?.classList.remove("show");
  syncVideoOverlayRoleHint(cid);
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
    role:
      member?.role === "owner" || member?.role === "analyst"
        ? member.role
        : "editor",
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
  const ownerEmail = String(user.email || "")
    .trim()
    .toLowerCase();
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
  const activeCount = members.filter(
    (member) => member.status === "active",
  ).length;
  const pendingCount = members.filter(
    (member) => member.status === "pending",
  ).length;
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
  if (workspaceName)
    workspaceName.textContent = state.workspaceName || "Workspace";
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
  if (
    (teamState.members || []).some(
      (member) => member.email.toLowerCase() === email,
    )
  ) {
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
  member.lastSeen = member.status === "active" ? "vừa cập nhật" : "đã tạm dừng";
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
    teamState.members = teamState.members.filter(
      (item) => item.id !== memberId,
    );
    saveTeamState();
    renderTeamPage();
    toast("🗑️ Đã gỡ thành viên khỏi workspace.", "ok");
  });
}

function setTeamWorkspaceData(payload) {
  if (!payload || typeof payload !== "object") {
    teamWorkspaceData = null;
    return null;
  }
  teamWorkspaceData = {
    workspace: payload.workspace || null,
    membership: payload.membership || null,
    members: Array.isArray(payload.members) ? payload.members : [],
    templates: Array.isArray(payload.templates) ? payload.templates : [],
    source_links: Array.isArray(payload.source_links)
      ? payload.source_links
      : [],
    invitation_pending: payload.invitation_pending === true,
  };
  return teamWorkspaceData;
}

function getTeamSeatLimit() {
  const explicitLimit = Number(teamWorkspaceData?.workspace?.seat_limit || 0);
  if (Number.isInteger(explicitLimit) && explicitLimit > 0)
    return explicitLimit;
  if (isAdminUser() || user?.plan === "business") return 10;
  if (user?.plan === "pro") return 5;
  if (user) return 3;
  return 1;
}

function getTeamMembership() {
  return teamWorkspaceData?.membership || null;
}

function hasPendingTeamInvitation() {
  return (
    teamWorkspaceData?.invitation_pending === true ||
    (getTeamMembership()?.status === "pending" &&
      getTeamMembership()?.role !== "owner")
  );
}

function canInviteTeamMembers() {
  const membership = getTeamMembership();
  return membership?.status === "active" && membership?.role === "owner";
}

function canCreateSharedTemplates() {
  const membership = getTeamMembership();
  return (
    membership?.status === "active" &&
    (membership?.role === "owner" || membership?.role === "editor")
  );
}

function canUseSharedTemplates() {
  const membership = getTeamMembership();
  return membership?.status === "active" && membership?.role === "editor";
}

function getSelectedTeamTemplateSourceLinks(sourceLinks = []) {
  return sourceLinks.filter((link) =>
    selectedTeamTemplateSourceIds.includes(Number(link.id)),
  );
}

function closeTeamTemplateSourceDropdown() {
  isTeamTemplateSourceDropdownOpen = false;
  const trigger = document.getElementById("teamTemplateSourceTrigger");
  const dropdown = document.getElementById("teamTemplateSourceDropdown");
  if (trigger) trigger.classList.remove("open");
  if (dropdown) dropdown.classList.add("hidden");
}

function toggleTeamTemplateSourceDropdown(forceOpen = null) {
  const trigger = document.getElementById("teamTemplateSourceTrigger");
  const dropdown = document.getElementById("teamTemplateSourceDropdown");
  if (!trigger || !dropdown || trigger.disabled) return;
  const nextOpen =
    typeof forceOpen === "boolean" ? forceOpen : !isTeamTemplateSourceDropdownOpen;
  isTeamTemplateSourceDropdownOpen = nextOpen;
  trigger.classList.toggle("open", nextOpen);
  dropdown.classList.toggle("hidden", !nextOpen);
}

function formatTeamDateTime(value, fallback = "Chưa cập nhật") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleString("vi-VN");
}

function formatTeamTemplateType(type) {
  if (type === "deeplink") return "Deeplink App";
  if (type === "video") return "Video Overlay";
  return "Trực tiếp";
}

function normalizeTeamTemplateSectionCopy() {
  const card = document.getElementById("teamTemplatesCard");
  const count = document.getElementById("teamTemplateCount");
  if (!card || !count) return;
  const titleEl = card.querySelector(".tbl-head h3");
  if (titleEl) {
    titleEl.innerHTML = `Mẫu link chung (<span id="teamTemplateCount">${count.textContent || "0"}</span>)`;
  }
  const fieldLabels = card.querySelectorAll(".fg .fl");
  if (fieldLabels[0]) fieldLabels[0].textContent = "Chọn link nguồn của bạn";
  if (fieldLabels[1]) fieldLabels[1].textContent = "Tên mẫu chung";
  const nameInput = document.getElementById("teamTemplateName");
  if (nameInput) {
    nameInput.placeholder = "Ví dụ: Template TikTok campaign A";
  }
  const createBtn = document.getElementById("teamTemplateCreateBtn");
  if (createBtn) createBtn.textContent = "Tạo mẫu chung";
  const actionButtons = card.querySelectorAll(".user-actions .user-btn");
  if (actionButtons[1]) actionButtons[1].textContent = "Tạo link cá nhân";
  const noteEl = card.querySelector(".user-note");
  if (noteEl) {
    noteEl.innerHTML =
      "Mẫu chung chỉ khóa nội dung share, kiểu link, video overlay và domain. Khi bấm <strong>Lấy link cho tôi</strong>, editor sẽ mở popup để dán link gốc của riêng mình rồi tạo link ngay, không cần qua tab khác.";
  }
  const headers = card.querySelectorAll("thead th");
  const sourceLabel = document.getElementById("teamTemplateSourceLabel");
  const mediaLabel = document.getElementById("teamTemplateMediaLabel");
  const nameLabel = document.getElementById("teamTemplateNameLabel");
  const uploadBtn = document.getElementById("teamTemplateUploadBtn");
  const personalBtn = document.getElementById("teamTemplateCreatePersonalBtn");
  const formNote = document.getElementById("teamTemplateFormNote");
  if (sourceLabel) sourceLabel.textContent = "Chọn link nguồn của bạn";
  if (mediaLabel) mediaLabel.textContent = "Chọn video hoặc ảnh đại diện";
  if (nameLabel) nameLabel.textContent = "Tên mẫu chung";
  if (nameInput) nameInput.placeholder = "Ví dụ: Template TikTok campaign A";
  if (createBtn) createBtn.textContent = "Tạo mẫu chung";
  if (uploadBtn) uploadBtn.textContent = "Tải video/ảnh từ máy";
  if (personalBtn) personalBtn.textContent = "Tạo link cá nhân";
  if (formNote) {
    formNote.innerHTML =
      "Mẫu chung chỉ khóa nội dung share, kiểu link, video overlay và domain. Khi bấm <strong>Lấy link cho tôi</strong>, editor sẽ mở popup để dán link gốc của riêng mình rồi tạo link ngay, không cần qua tab khác.";
  }
  const headerLabels = [
    "Mẫu",
    "Người tạo",
    "Kiểu",
    "Domain",
    "Cập nhật",
    "Thao tác",
  ];
  headers.forEach((header, index) => {
    if (headerLabels[index]) header.textContent = headerLabels[index];
  });
  const emptyCell = document.querySelector("#teamTemplateBody .tbl-empty");
  if (
    emptyCell &&
    /Đang|⏳|mẫu link chung/i.test(emptyCell.textContent || "")
  ) {
    emptyCell.textContent = "Đang tải mẫu link chung...";
  }
}

function findTeamTemplateById(templateId) {
  const normalizedId = Number(templateId);
  return (teamWorkspaceData?.templates || []).find(
    (template) => Number(template.id) === normalizedId,
  );
}

async function loadTeamWorkspace({ silent = false } = {}) {
  if (!user) {
    teamWorkspaceData = null;
    return null;
  }
  try {
    const response = await fetch("/api/team/workspace");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401) {
        teamWorkspaceData = null;
        return null;
      }
      throw new Error(data.error || "Không thể tải team workspace");
    }
    return setTeamWorkspaceData(data);
  } catch (error) {
    console.error("loadTeamWorkspace", error);
    if (!silent) {
      toast(error.message || "Không thể tải team workspace", "warn");
    }
    return teamWorkspaceData;
  }
}

function renderTeamMembers(members) {
  const body = document.getElementById("teamMemberBody");
  if (!body) return;

  if (!user) {
    body.innerHTML = `<tr><td colspan="6" class="tbl-empty">Đăng nhập để mời cộng tác viên. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Đăng nhập</a> hoặc <a href="${buildAuthUrl("register")}" style="color:var(--brand);font-weight:700">Đăng ký</a>.</td></tr>`;
    return;
  }

  if (!Array.isArray(members) || !members.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="tbl-empty">Chưa có thành viên nào trong workspace.</td></tr>';
    return;
  }

  const canManageMembers = canInviteTeamMembers();
  body.innerHTML = members
    .map((member) => {
      const isOwner = member.role === "owner";
      const isPending = member.status === "pending";
      const nextStatus =
        member.status === "pending"
          ? "active"
          : member.status === "active"
            ? "paused"
            : "active";
      const nextLabel =
        member.status === "pending"
          ? "Kích hoạt"
          : member.status === "active"
            ? "Tạm dừng"
            : "Mở lại";
      return `<tr>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px">
          <strong>${esc(member.display_name || member.email || "Member")}</strong>
          <span style="color:var(--text3);font-size:12px">${esc(member.email || "Chưa có email")}</span>
        </div>
      </td>
      <td><span class="badge-role ${isOwner ? "admin" : "user"}">${getRoleLabel(member.role)}</span></td>
      <td>${esc(getStatusLabel(member.status))}</td>
      <td style="max-width:240px;color:var(--text2)">${esc(getRoleFocus(member.role))}</td>
      <td style="color:var(--text3);font-size:12px">${esc(formatTeamDateTime(member.joined_at || member.updated_at || member.created_at, "Chưa tham gia"))}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${
          isOwner
            ? '<button class="btn-cp" disabled>Owner</button>'
            : `<button class="btn-cp" ${canManageMembers && !isPending ? "" : "disabled"} onclick="cycleTeamMemberStatus(${Number(member.id)}, '${nextStatus}')">${isPending ? "Chờ user xác nhận" : nextLabel}</button>
               <button class="btn-del" ${canManageMembers ? "" : "disabled"} onclick="removeTeamMember(${Number(member.id)})">Xóa</button>`
        }
      </td>
    </tr>`;
    })
    .join("");
}

function renderTeamTemplates(templates) {
  const body = document.getElementById("teamTemplateBody");
  if (!body) return;

  if (!user) {
    body.innerHTML = `<tr><td colspan="1" class="tbl-empty">Dang nhap de dung mau lien ket chung. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Dang nhap</a></td></tr>`;
    return;
  }

  if (!Array.isArray(templates) || !templates.length) {
    body.innerHTML =
      '<tr><td colspan="1" class="tbl-empty">Chua co mau chung nao. Hay chon mot lien ket cua ban roi bam tao mau chung.</td></tr>';
    return;
  }

  body.innerHTML = templates
    .map((template) => {
      const title = template.name || template.og_title || "Template";
      const playableVideoUrl = buildCloudinaryPlayableVideoUrl(template.video_url || "");
      const mediaMarkup = playableVideoUrl
        ? `<div class="team-template-media"><video src="${esc(playableVideoUrl)}" controls preload="metadata" playsinline muted></video></div>`
        : template.og_image
          ? `<div class="team-template-media"><img src="${esc(template.og_image)}" alt="${esc(title)}" /></div>`
          : `<div class="team-template-media"></div>`;
      const downloadVideoButton = playableVideoUrl
        ? `<a class="btn-cp" href="${esc(playableVideoUrl)}" target="_blank" rel="noopener noreferrer" download>Tai video</a>`
        : "";
      const hasVideoBadge = playableVideoUrl
        ? `<span class="team-template-flag">Video</span>`
        : "";
      const groupedLinks = Array.isArray(template.source_links) && template.source_links.length
        ? template.source_links
        : [
            {
              title: template.og_title || template.name || "Link",
              short_url: template.source_link_short_url || "",
              original_url: template.source_link_original_url || "",
            },
          ];
      const sourcePlatform = groupedLinks[0]?.original_url ? pt(groupedLinks[0].original_url) : "generic";
      const platformLabel = sourcePlatform === "shopee" ? "Shopee" : sourcePlatform === "tiktok" ? "TikTok" : "Generic";
      const canEditTemplate = Number(template.created_by_user_id || 0) === Number(user?.id || 0);
      const templateActionButtons = canEditTemplate
        ? `<button class="btn-cp" onclick="openTeamTemplateModal('edit', ${Number(template.id)})" title="Sua mau">Sua</button>
           <button class="btn-cp" onclick="deleteTeamTemplate(${Number(template.id)})" title="Xoa mau" style="color:var(--red);border-color:rgba(239,68,68,.2)">Xoa</button>`
        : "";
      const groupedLinkMarkup = groupedLinks
        .map(
          (link, index) => `<div class="team-template-link-row">
                <span class="team-template-link-label">Link ${index + 1}</span>
                <span class="team-template-meta">${esc(link.title || `Link ${index + 1}`)}</span>
                <span class="team-template-link-value" title="${esc(link.short_url || link.original_url || "Chua co link rut gon")}">${esc(link.short_url || link.original_url || "Chua co link rut gon")}</span>
              </div>`,
        )
        .join("");
      return `<tr>
      <td colspan="1">
        <div class="team-template-card-shell">
          <div class="team-template-card">
            ${mediaMarkup}
            <div class="team-template-card-copy">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <strong>${esc(title)}</strong>
                ${hasVideoBadge}
                <span class="team-template-flag">${platformLabel}</span>
              </div>
              <div class="team-template-link-list">${groupedLinkMarkup}</div>
            </div>
          </div>
          <div class="team-template-card-right">
            <div class="team-template-meta-grid">
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Nguoi tao</span>
                <span class="team-template-meta">${esc(template.creator_name || "Member")}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Kieu</span>
                <span class="team-template-meta">${esc(formatTeamTemplateType(template.link_type))}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Domain</span>
                <span class="team-template-meta">${esc(template.domain_hostname || template.preview_domain || location.host)}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Cap nhat</span>
                <span class="team-template-meta muted">${esc(formatTeamDateTime(template.updated_at || template.created_at))}</span>
              </div>
            </div>
            <div class="team-template-actions">
              <button class="btn-cp" onclick="openTeamTemplateModal('use', ${Number(template.id)})">Lay link cho toi</button>
              ${downloadVideoButton ? `<div class="team-template-actions-row">${downloadVideoButton}</div>` : ""}
              ${templateActionButtons ? `<div class="team-template-actions-row">${templateActionButtons}</div>` : ""}
            </div>
          </div>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function renderTeamWorkspaceSummary() {
  const workspace = teamWorkspaceData?.workspace || null;
  const membership = teamWorkspaceData?.membership || null;
  const members = Array.isArray(teamWorkspaceData?.members)
    ? teamWorkspaceData.members
    : [];
  const sourceLinks = Array.isArray(teamWorkspaceData?.source_links)
    ? teamWorkspaceData.source_links
    : [];
  const templates = Array.isArray(teamWorkspaceData?.templates)
    ? teamWorkspaceData.templates
    : [];
  const seatLimit = getTeamSeatLimit();
  const activeCount = members.filter(
    (member) => member.status === "active",
  ).length;
  const pendingCount = members.filter(
    (member) => member.status === "pending",
  ).length;
  const ownerMember = members.find((member) => member.role === "owner");
  const canManageMembers = canInviteTeamMembers();
  const canCreateTemplates = canCreateSharedTemplates();
  const pendingInvitation = hasPendingTeamInvitation();

  const seatCount = document.getElementById("teamSeatCount");
  const seatHint = document.getElementById("teamSeatHint");
  const activeEl = document.getElementById("teamActiveCount");
  const pendingEl = document.getElementById("teamPendingCount");
  const workspaceName = document.getElementById("teamWorkspaceName");
  const workspaceStatus = document.getElementById("teamWorkspaceStatus");
  const ownerLabel = document.getElementById("teamOwnerLabel");
  const inviteHint = document.getElementById("teamInviteHint");
  const inviteBtn = document.getElementById("teamInviteBtn");
  const inviteEmail = document.getElementById("teamInviteEmail");
  const inviteRole = document.getElementById("teamInviteRole");
  const domainLabel = document.getElementById("teamDomainLabel");
  const templateCount = document.getElementById("teamTemplateCount");
  const templateHint = document.getElementById("teamTemplateHint");
  const templateSourcePicker = document.getElementById("teamTemplateSourcePicker");
  const templateSourceStatus = document.getElementById("teamTemplateSourceStatus");
  const templateSource = null;
  const templateMediaLink = document.getElementById("teamTemplateMediaLink");
  const templateMediaHint = document.getElementById("teamTemplateMediaHint");
  const templateUploadStatus = document.getElementById("teamTemplateUploadStatus");
  const templateName = document.getElementById("teamTemplateName");
  const templateCreateBtn = document.getElementById("teamTemplateCreateBtn");
  const invitationBanner = document.getElementById("teamInvitationBanner");
  const membersCard = document.getElementById("teamMembersCard");
  const templatesCard = document.getElementById("teamTemplatesCard");

  if (seatCount) {
    seatCount.textContent = pendingInvitation
      ? "Chờ"
      : `${members.length}/${seatLimit}`;
  }
  if (seatHint) {
    seatHint.textContent = pendingInvitation
      ? "Lời mời workspace"
      : workspace
        ? `${membership?.role === "owner" ? "Owner" : getRoleLabel(membership?.role)} · ${user?.plan || "free"} workspace`
        : "Workspace cá nhân";
  }
  if (activeEl) activeEl.textContent = pendingInvitation ? 0 : activeCount;
  if (pendingEl) pendingEl.textContent = pendingInvitation ? 1 : pendingCount;
  if (workspaceName) {
    workspaceName.textContent =
      workspace?.name ||
      (user ? `${getUserDisplayName(user)} Workspace` : "Workspace");
  }
  if (workspaceStatus) {
    workspaceStatus.textContent = pendingInvitation
      ? `Bạn đang có lời mời với quyền ${getRoleLabel(membership?.role)}`
      : workspace
        ? `Seat đang dùng ${members.length}/${seatLimit} · Quyền của bạn ${getRoleLabel(membership?.role)}`
        : "Đăng nhập để mở workspace và cộng tác theo team.";
  }
  if (ownerLabel) {
    ownerLabel.textContent = ownerMember
      ? `Owner: ${ownerMember.display_name || ownerMember.email}`
      : "Owner: chưa xác định";
  }
  if (inviteHint) {
    inviteHint.textContent = !user
      ? "Đăng nhập để mời cộng tác viên và tạo workspace thật trên server."
      : pendingInvitation
        ? "Lời mời này vẫn đang chờ bạn xác nhận. Đồng ý thì mới vào workspace và thấy dữ liệu chung."
        : canManageMembers
          ? "Owner có thể mời thêm người. Mỗi người vẫn giữ aff link riêng, chỉ dùng chung nội dung mẫu."
          : "Chỉ owner mới có thể mời thành viên. Bạn vẫn có thể lấy mẫu chung nếu đang hoạt động.";
  }
  if (inviteBtn) {
    inviteBtn.textContent = user ? "Mời thành viên" : "Đăng nhập để mời";
    inviteBtn.disabled = !canManageMembers;
  }
  if (inviteEmail) inviteEmail.disabled = !canManageMembers;
  if (inviteRole) inviteRole.disabled = !canManageMembers;
  if (domainLabel) {
    domainLabel.textContent =
      templates[0]?.domain_hostname ||
      sourceLinks[0]?.domain_hostname ||
      location.host ||
      "boclink.click";
  }
  if (templateCount) templateCount.textContent = String(templates.length);
  if (templateHint) {
    templateHint.textContent = canCreateTemplates
      ? "Chọn link của riêng bạn để chụp snapshot metadata chung cho team"
      : "Template chỉ khóa phần nội dung chung, URL đích vẫn do từng user tự dán";
  }
  if (templateSource) {
    const currentValue = String(templateSource.value || "");
    const currentValues = new Set(
      [...templateSource.selectedOptions]
        .map((option) => String(option.value || "").trim())
        .filter(Boolean),
    );
    const options = sourceLinks
      .map((link) => {
        const primary =
          link.og_title || link.alias || link.short_code || `Link #${link.id}`;
        const secondary = link.original_url || "";
        const videoBadge = link.video_url ? "[Video] " : "";
        return `<option value="${Number(link.id)}">${videoBadge}${esc(primary)}${secondary ? ` · ${esc(secondary.slice(0, 72))}` : ""}</option>`;
      })
      .join("");
    templateSource.innerHTML = `<option value="">Chọn link của bạn để chụp snapshot nội dung</option>${options}`;
    if (
      currentValue &&
      [...templateSource.options].some(
        (option) => option.value === currentValue,
      )
    ) {
      templateSource.value = currentValue;
    }
    templateSource.disabled = !canCreateTemplates || !sourceLinks.length;
    templateSource.multiple = true;
    templateSource.size = Math.min(Math.max(sourceLinks.length, 3), 5);
    [...templateSource.options].forEach((option) => {
      if (!option.value) {
        option.disabled = true;
        option.selected = false;
        return;
      }
      option.selected = currentValues.has(String(option.value));
    });
  }
  if (templateName) templateName.disabled = !canCreateTemplates;
  selectedTeamTemplateSourceIds = selectedTeamTemplateSourceIds.filter((id) =>
    sourceLinks.some((link) => Number(link.id) === Number(id)),
  );
  const selectedSourceLinks = sourceLinks.filter((link) =>
    selectedTeamTemplateSourceIds.includes(Number(link.id)),
  );
  const mediaEligibleLinks = selectedSourceLinks.filter(
    (link) => !!(link.video_url || link.og_image),
  );
  if (
    selectedTeamTemplateMediaLinkId &&
    !mediaEligibleLinks.some(
      (link) => Number(link.id) === Number(selectedTeamTemplateMediaLinkId),
    )
  ) {
    selectedTeamTemplateMediaLinkId = null;
  }
  if (!selectedTeamTemplateMediaLinkId && mediaEligibleLinks.length) {
    selectedTeamTemplateMediaLinkId = Number(mediaEligibleLinks[0].id);
  }
  if (templateSourcePicker) {
    if (!sourceLinks.length) {
      templateSourcePicker.innerHTML =
        '<div class="tbl-empty" style="padding:12px 4px">Chua co link nguon nao de tao mau chung.</div>';
    } else {
      templateSourcePicker.innerHTML = sourceLinks
        .map((link) => {
          const primary =
            link.og_title || link.alias || link.short_code || `Link #${link.id}`;
          const secondary = link.original_url || "";
          const selected = selectedTeamTemplateSourceIds.includes(Number(link.id));
          const disabled = !selected && selectedTeamTemplateSourceIds.length >= 5;
          return `<label class="team-template-source-item ${selected ? "active" : ""} ${disabled || !canCreateTemplates ? "disabled" : ""}">
            <input type="checkbox" ${selected ? "checked" : ""} ${disabled || !canCreateTemplates ? "disabled" : ""} onchange="toggleTeamTemplateSourceSelection(${Number(link.id)})" />
            <span class="team-template-source-copy">
              <span class="team-template-source-primary">${link.video_url ? "[Video] " : ""}${esc(primary)}</span>
              <span class="team-template-source-secondary" title="${esc(secondary || "Khong co link goc")}">${esc(secondary || "Khong co link goc")}</span>
            </span>
          </label>`;
        })
        .join("");
    }
  }
  if (templateSourceStatus) {
    templateSourceStatus.textContent = sourceLinks.length
      ? `Da chon ${selectedTeamTemplateSourceIds.length}/5 link. 1 media co the di kem nhieu link da tick.`
      : "Chon toi da 5 link de gom vao cung 1 mau chia se.";
  }
  if (templateMediaLink) {
    const mediaOptions = mediaEligibleLinks
      .map((link) => {
        const primary =
          link.og_title || link.alias || link.short_code || `Link #${link.id}`;
        const mediaType = link.video_url ? "Video" : "Anh";
        return `<option value="${Number(link.id)}" ${
          Number(selectedTeamTemplateMediaLinkId || 0) === Number(link.id)
            ? "selected"
            : ""
        }>${mediaType} · ${esc(primary)}</option>`;
      })
      .join("");
    templateMediaLink.innerHTML = `<option value="">Chon media bat buoc cho mau nay</option>${mediaOptions}`;
    templateMediaLink.disabled = !canCreateTemplates || !mediaEligibleLinks.length;
  }
  if (templateMediaHint) {
    templateMediaHint.textContent = mediaEligibleLinks.length
      ? `Dang co ${mediaEligibleLinks.length} link co media hop le. Ban phai chon 1 media dai dien truoc khi tao mau.`
      : "Hay tick it nhat 1 link co video hoac anh preview de lam media dai dien bat buoc.";
  }
  if (templateUploadStatus) {
    templateUploadStatus.textContent = uploadedTeamTemplateMedia?.url
      ? `Dang dung media tai tu may: ${uploadedTeamTemplateMedia.name || "media moi"}`
      : "Ban co the chon media tu link da tick hoac tai media rieng tu may.";
  }
  if (templateCreateBtn) {
    templateCreateBtn.disabled = !canCreateTemplates || !sourceLinks.length;
  }
  syncTeamTemplateComposer();
  if (membersCard) {
    membersCard.style.display = pendingInvitation ? "none" : "";
  }
  if (templatesCard) {
    templatesCard.style.display = pendingInvitation ? "none" : "";
  }
  if (invitationBanner) {
    if (!pendingInvitation || !workspace || !membership) {
      invitationBanner.style.display = "none";
      invitationBanner.innerHTML = "";
    } else {
      invitationBanner.style.display = "block";
      invitationBanner.innerHTML = `
              <div class="tbl-card">
                <div class="card-p" style="display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
                  <div style="display:flex;flex-direction:column;gap:6px;min-width:260px">
                    <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand)">Lời mời workspace</div>
                    <div style="font-size:22px;font-weight:800;color:var(--text)">${esc(workspace.name || "Workspace")}</div>
                    <div style="font-size:13px;color:var(--text2)">Owner: ${esc(ownerMember?.display_name || ownerMember?.email || "Workspace owner")}</div>
                    <div style="font-size:13px;color:var(--text2)">Vai trò được mời: ${esc(getRoleLabel(membership.role))}</div>
                    <div style="font-size:13px;color:var(--text3)">Bạn chưa vào workspace này. Hãy đồng ý hoặc từ chối lời mời trước khi xem thành viên, mẫu link và dữ liệu chung.</div>
                  </div>
                  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <button class="user-btn secondary" type="button" onclick="declineTeamInvitation()">Từ chối</button>
                    <button class="user-btn primary" type="button" onclick="acceptTeamInvitation()">Đồng ý tham gia</button>
                  </div>
                </div>
              </div>`;
    }
  }
}

async function renderTeamPage() {
  normalizeTeamTemplateSectionCopy();
  renderTeamMembers([]);
  renderTeamTemplates([]);
  renderTeamWorkspaceSummary();
  const body = document.getElementById("teamMemberBody");
  const templateBody = document.getElementById("teamTemplateBody");
  if (user && body) {
    body.innerHTML =
      '<tr><td colspan="6" class="tbl-empty">⏳ Đang tải team workspace...</td></tr>';
  }
  if (user && templateBody) {
    templateBody.innerHTML =
      '<tr><td colspan="6" class="tbl-empty">⏳ Đang tải mẫu link chung...</td></tr>';
  }
  await loadTeamWorkspace({ silent: true });
  renderTeamWorkspaceSummary();
  renderTeamMembers(teamWorkspaceData?.members || []);
  renderTeamTemplates(teamWorkspaceData?.templates || []);
}

async function inviteTeamMember() {
  if (!user) {
    redirectToAuth("register", "Đăng nhập để mời cộng tác viên.");
    return;
  }
  if (!canInviteTeamMembers()) {
    toast("Chỉ owner đang hoạt động mới có thể mời thành viên.", "warn");
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

  try {
    const response = await fetch("/api/team/members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể mời thành viên");
    }
    setTeamWorkspaceData(data);
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    if (emailInput) emailInput.value = "";
    toast("✅ Đã thêm lời mời vào workspace.", "ok");
  } catch (error) {
    toast(error.message || "Không thể mời thành viên", "warn");
  }
}

async function acceptTeamInvitation() {
  const membership = getTeamMembership();
  if (!user || !membership?.id || !hasPendingTeamInvitation()) {
    return;
  }
  try {
    const response = await fetch(
      `/api/team/invitations/${Number(membership.id)}/accept`,
      {
        method: "POST",
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể chấp nhận lời mời");
    }
    setTeamWorkspaceData(data);
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    toast("✅ Bạn đã tham gia workspace.", "ok");
  } catch (error) {
    toast(error.message || "Không thể chấp nhận lời mời", "warn");
  }
}

function declineTeamInvitation() {
  const membership = getTeamMembership();
  if (!user || !membership?.id || !hasPendingTeamInvitation()) {
    return;
  }
  showConfirmDialog({
    title: "Từ chối lời mời workspace",
    message: "Bạn có chắc muốn từ chối lời mời này không?",
    confirmLabel: "Từ chối lời mời",
    tone: "danger",
  }).then(async (confirmed) => {
    if (!confirmed) return;
    try {
      const response = await fetch(
        `/api/team/invitations/${Number(membership.id)}/decline`,
        {
          method: "POST",
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Không thể từ chối lời mời");
      }
      setTeamWorkspaceData(data);
      renderTeamWorkspaceSummary();
      renderTeamMembers(teamWorkspaceData?.members || []);
      renderTeamTemplates(teamWorkspaceData?.templates || []);
      toast("Đã từ chối lời mời workspace.", "ok");
    } catch (error) {
      toast(error.message || "Không thể từ chối lời mời", "warn");
    }
  });
}

async function cycleTeamMemberStatus(memberId, nextStatus) {
  if (!canInviteTeamMembers()) {
    toast("Chỉ owner mới có thể đổi trạng thái thành viên.", "warn");
    return;
  }
  try {
    const response = await fetch(`/api/team/members/${Number(memberId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: nextStatus || "active" }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể cập nhật thành viên");
    }
    setTeamWorkspaceData(data);
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    toast("✅ Đã cập nhật trạng thái thành viên.", "ok");
  } catch (error) {
    toast(error.message || "Không thể cập nhật thành viên", "warn");
  }
}

function removeTeamMember(memberId) {
  const member = (teamWorkspaceData?.members || []).find(
    (item) => Number(item.id) === Number(memberId),
  );
  if (!member || member.role === "owner") return;
  if (!canInviteTeamMembers()) {
    toast("Chỉ owner mới có thể gỡ thành viên.", "warn");
    return;
  }
  showConfirmDialog({
    title: "Gỡ thành viên workspace",
    message: `Xóa ${member.email || member.display_name} khỏi workspace?`,
    confirmLabel: "Gỡ thành viên",
    tone: "danger",
  }).then(async (confirmed) => {
    if (!confirmed) return;
    try {
      const response = await fetch(`/api/team/members/${Number(memberId)}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Không thể gỡ thành viên");
      }
      setTeamWorkspaceData(data);
      renderTeamWorkspaceSummary();
      renderTeamMembers(teamWorkspaceData?.members || []);
      renderTeamTemplates(teamWorkspaceData?.templates || []);
      toast("🗑️ Đã gỡ thành viên khỏi workspace.", "ok");
    } catch (error) {
      toast(error.message || "Không thể gỡ thành viên", "warn");
    }
  });
}

function toggleTeamTemplateSourceSelection(linkId) {
  const normalizedId = Number(linkId);
  if (!Number.isInteger(normalizedId) || normalizedId < 1) return;
  const selected = new Set(selectedTeamTemplateSourceIds.map((id) => Number(id)));
  if (selected.has(normalizedId)) {
    selected.delete(normalizedId);
  } else {
    if (selected.size >= 5) {
      toast("Chi duoc chon toi da 5 link cho moi lan tao mau.", "warn");
      return;
    }
    selected.add(normalizedId);
  }
  selectedTeamTemplateSourceIds = [...selected];
  renderTeamWorkspaceSummary();
}

function setTeamTemplateMediaLink(linkId) {
  const normalizedId = Number(linkId);
  selectedTeamTemplateMediaLinkId =
    Number.isInteger(normalizedId) && normalizedId > 0 ? normalizedId : null;
  renderTeamWorkspaceSummary();
}

function triggerTeamTemplateMediaUpload() {
  document.getElementById("teamTemplateMediaFile")?.click();
}

async function handleTeamTemplateMediaUpload(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const statusEl = document.getElementById("teamTemplateUploadStatus");
  try {
    if (statusEl) statusEl.textContent = `Đang tải media: ${file.name}`;
    let uploadData = null;
    if (String(file.type || "").startsWith("video/")) {
      uploadData = await uploadVideoDirect(file);
      uploadedTeamTemplateMedia = {
        kind: "video",
        url: uploadData?.url || "",
        image: uploadData?.thumb || "",
        name: file.name,
      };
    } else if (String(file.type || "").startsWith("image/")) {
      const fd = new FormData();
      fd.append("image", file);
      const response = await fetch("/api/upload-image", {
        method: "POST",
        body: fd,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Upload anh that bai");
      }
      uploadedTeamTemplateMedia = {
        kind: "image",
        url: String(data.url || ""),
        image: String(data.url || ""),
        name: file.name,
      };
    } else {
      throw new Error("Chi ho tro anh hoac video");
    }
    selectedTeamTemplateMediaLinkId = null;
    if (statusEl) {
      statusEl.textContent = `Đã tải media từ máy: ${file.name}`;
    }
    renderTeamWorkspaceSummary();
  } catch (error) {
    if (error?.status === 401) {
      redirectToAuth("login", "Cần đăng nhập để upload video.");
      return;
    }
    if (error?.status === 403 && error?.payload?.upgrade) {
      toast(error.payload.error || "Tính năng này yêu cầu gói Pro", "warn");
      return;
    }
    uploadedTeamTemplateMedia = null;
    if (statusEl) {
      statusEl.textContent = error.message || "Không thể tải media";
    }
    toast(error.message || "Không thể tải media", "warn");
  } finally {
    if (input) input.value = "";
  }
}

async function createTeamTemplate() {
  if (!user) {
    redirectToAuth("register", "Đăng nhập để tạo mẫu chung.");
    return;
  }
  if (!canCreateSharedTemplates()) {
    toast("Vai trò hiện tại chưa thể tạo mẫu chung.", "warn");
    return;
  }
  const sourceInput = document.getElementById("teamTemplateSourcePicker");
  const nameInput = document.getElementById("teamTemplateName");
  const mediaInput = document.getElementById("teamTemplateMediaLink");
  const selectedSourceLinkIds = [...selectedTeamTemplateSourceIds];
  const mediaLinkId = Number(selectedTeamTemplateMediaLinkId || mediaInput?.value || 0);
  const name = String(nameInput?.value || "").trim();
  if (!selectedSourceLinkIds.length) {
    toast("Chọn một link nguồn của bạn trước khi tạo mẫu.", "warn");
    sourceInput?.focus();
    return;
  }
  if (selectedSourceLinkIds.length > 5) {
    toast("Chi duoc chon toi da 5 link cho moi lan tao mau.", "warn");
    sourceInput?.focus();
    return;
  }
  if ((!Number.isInteger(mediaLinkId) || mediaLinkId < 1) && !uploadedTeamTemplateMedia?.url) {
    toast("Ban phai chon video hoac anh dai dien cho mau chung.", "warn");
    mediaInput?.focus();
    return;
  }
  try {
    const response = await fetch("/api/team/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_link_ids: selectedSourceLinkIds,
        media_link_id: Number.isInteger(mediaLinkId) && mediaLinkId > 0 ? mediaLinkId : null,
        uploaded_media_kind: uploadedTeamTemplateMedia?.kind || null,
        uploaded_media_url: uploadedTeamTemplateMedia?.url || null,
        uploaded_media_thumb: uploadedTeamTemplateMedia?.image || null,
        name,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tạo mẫu chung");
    }
    setTeamWorkspaceData(data);
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    if (nameInput) nameInput.value = "";
    selectedTeamTemplateSourceIds = [];
    selectedTeamTemplateMediaLinkId = null;
    uploadedTeamTemplateMedia = null;
    editingTeamTemplateId = null;
    renderTeamWorkspaceSummary();
    syncTeamTemplateComposer();
    toast("Da tao mau chung cho workspace.", "ok");
  } catch (error) {
    toast(error.message || "Không thể tạo mẫu chung", "warn");
  }
}

function syncTeamTemplateComposer() {
  const sourceInput = document.getElementById("teamTemplateSourceLink");
  const nameInput = document.getElementById("teamTemplateName");
  const createBtn = document.getElementById("teamTemplateCreateBtn");
  const linkBtn = document.querySelector(
    "#teamTemplatesCard .user-actions .user-btn.secondary",
  );
  const isEditing = Number(editingTeamTemplateId || 0) > 0;
  if (createBtn) {
    createBtn.textContent = isEditing ? "Lưu mẫu" : "Tạo mẫu chung";
  }
  if (linkBtn) {
    linkBtn.textContent = isEditing ? "Hủy sửa" : "Tạo link cá nhân";
    linkBtn.onclick = () => {
      if (isEditing) {
        cancelEditTeamTemplate();
        return;
      }
      clearTeamTemplateDraft(true);
      navigate("create");
    };
  }
  const uploadBtn = document.getElementById("teamTemplateUploadBtn");
  const personalBtn = document.getElementById("teamTemplateCreatePersonalBtn");
  if (createBtn) {
    createBtn.textContent = isEditing ? "Lưu mẫu" : "Tạo mẫu chung";
  }
  if (uploadBtn) {
    uploadBtn.textContent = "Tải video/ảnh từ máy";
  }
  if (personalBtn) {
    personalBtn.textContent = isEditing ? "Hủy sửa" : "Tạo link cá nhân";
    personalBtn.onclick = () => {
      if (isEditing) {
        cancelEditTeamTemplate();
        return;
      }
      clearTeamTemplateDraft(true);
      navigate("create");
    };
  }
  if (isEditing && sourceInput && !sourceInput.value) sourceInput.focus();
  if (isEditing && nameInput && !nameInput.value) nameInput.focus();
}

function cancelEditTeamTemplate(silent = false) {
  editingTeamTemplateId = null;
  const nameInput = document.getElementById("teamTemplateName");
  selectedTeamTemplateSourceIds = [];
  selectedTeamTemplateMediaLinkId = null;
  uploadedTeamTemplateMedia = null;
  if (nameInput) nameInput.value = "";
  renderTeamWorkspaceSummary();
  syncTeamTemplateComposer();
  if (!silent) {
    toast("Đã hủy chế độ sửa mẫu chung.", "ok");
  }
}

function editTeamTemplate(templateId) {
  const template = findTeamTemplateById(templateId);
  if (!template) {
    toast("Không tìm thấy mẫu chung cần sửa.", "warn");
    return;
  }
  editingTeamTemplateId = Number(template.id || 0);
  const sourceInput = document.getElementById("teamTemplateSourceLink");
  const nameInput = document.getElementById("teamTemplateName");
  selectedTeamTemplateSourceIds = Array.isArray(template.source_link_ids)
    ? template.source_link_ids
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    : Number(template.source_link_id || 0) > 0
      ? [Number(template.source_link_id)]
      : [];
  selectedTeamTemplateMediaLinkId =
    Number(template.media_link_id || 0) > 0 ? Number(template.media_link_id) : null;
  uploadedTeamTemplateMedia =
    !selectedTeamTemplateMediaLinkId && (template.video_url || template.og_image)
      ? {
          kind: template.video_url ? "video" : "image",
          url: String(template.video_url || template.og_image || ""),
          image: String(template.og_image || ""),
          name: "Media hiện tại",
        }
      : null;
  if (sourceInput) sourceInput.value = String(template.source_link_id || "");
  if (nameInput) nameInput.value = String(template.name || "");
  renderTeamWorkspaceSummary();
  syncTeamTemplateComposer();
  toast(
    "Đã nạp mẫu chung lên form. Bạn có thể nhập liên kết nguồn hoặc sửa alidas để tạo link mới.",
    "ok",
  );
}

async function deleteTeamTemplate(templateId) {
  const template = findTeamTemplateById(templateId);
  if (!template) {
    toast("Không tìm thấy mẫu chung cần xóa.", "warn");
    return;
  }
  const confirmed = await showConfirmDialog({
    title: "Xóa mẫu chung",
    message: `Xóa mẫu chung "${template.name || "Template"}"?`,
    confirmLabel: "Xóa mẫu",
    tone: "danger",
  });
  if (!confirmed) return;
  try {
    const response = await fetch(`/api/team/templates/${Number(templateId)}`, {
      method: "DELETE",
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể xóa mẫu chung");
    }
    setTeamWorkspaceData(data);
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    if (Number(editingTeamTemplateId || 0) === Number(templateId)) {
      cancelEditTeamTemplate(true);
    }
    toast("Đã xóa mẫu chung.", "ok");
  } catch (error) {
    toast(error.message || "Không thể xóa mẫu chung", "warn");
  }
}

function openTeamTemplateModal(mode, templateId, sourceLinkId = null) {
  const template = findTeamTemplateById(templateId);
  if (!template) {
    toast("Không tìm thấy mẫu chung.", "warn");
    return;
  }
  if (mode === "edit" && Number(template.created_by_user_id || 0) !== Number(user?.id || 0)) {
    toast("Chi nguoi tao mau moi duoc sua mau chung nay.", "warn");
    return;
  }
  const modal = document.getElementById("teamTemplateModal");
  const titleEl = document.getElementById("teamTemplateModalTitle");
  const actionBtn = document.getElementById("teamTemplateModalActionBtn");
  const noteEl = document.getElementById("teamTemplateModalNote");
  const editFields = document.getElementById("teamTemplateEditFields");
  const useFields = document.getElementById("teamTemplateUseFields");
  const sourceSummaryEl = document.getElementById("teamTemplateModalSourceSummary");
  const sourceSelect = document.getElementById("teamTemplateModalSourceLink");
  const nameInput = document.getElementById("teamTemplateModalName");
  const originalUrlInput = document.getElementById("teamTemplateModalOriginalUrl");
  if (!modal || !titleEl || !actionBtn) return;
  const groupedLinks = Array.isArray(template.source_links) ? template.source_links : [];
  const selectedSource =
    groupedLinks.find((link) => Number(link.id) === Number(sourceLinkId)) ||
    groupedLinks[0] || {
      id: template.source_link_id,
      title: template.og_title || template.name || "Link",
      short_url: template.source_link_short_url || "",
      original_url: template.source_link_original_url || "",
    };

  const sourceOptions = (teamWorkspaceData?.source_links || [])
    .map((link) => {
      const primary =
        link.og_title || link.alias || link.short_code || `Link #${link.id}`;
      const secondary = link.original_url || "";
      const videoBadge = link.video_url ? "[Video] " : "";
      return `<option value="${Number(link.id)}">${videoBadge}${esc(primary)}${secondary ? ` · ${esc(secondary.slice(0, 72))}` : ""}</option>`;
    })
    .join("");

  if (sourceSelect) {
    sourceSelect.innerHTML = `<option value="">Chọn link nguồn</option>${sourceOptions}`;
    sourceSelect.value = String(template.source_link_id || "");
  }
  if (nameInput) nameInput.value = String(template.name || "");
  if (originalUrlInput) {
    originalUrlInput.value = "";
    originalUrlInput.placeholder = selectedSource?.title
      ? `Dán link gốc của bạn cho: ${selectedSource.title}`
      : "Dán link gốc Shopee hoặc TikTok của bạn";
  }

  const isEdit = mode === "edit";
  teamTemplateModalState = {
    mode,
    templateId: Number(template.id || 0),
    sourceLinkId: Number(selectedSource?.id || 0) || null,
    alias: buildTeamTemplateAlias(template, selectedSource),
  };
  if (editFields) editFields.classList.toggle("hidden", !isEdit);
  if (useFields) useFields.classList.toggle("hidden", isEdit);
  if (sourceSummaryEl) {
    if (isEdit) {
      sourceSummaryEl.classList.add("hidden");
      sourceSummaryEl.innerHTML = "";
    } else {
      sourceSummaryEl.classList.remove("hidden");
      sourceSummaryEl.innerHTML = `
        <strong>${esc(template.name || "Mẫu chung")}</strong>
        <span>Link bạn đang lấy: ${esc(selectedSource?.title || "Link nguồn")}</span>
        <span>Alias dự kiến: ${esc(teamTemplateModalState.alias || "link-moi")}</span>
        <span>Tiêu đề share, kiểu link, video overlay và domain sẽ lấy theo mẫu chung. Bạn chỉ cần dán link gốc của riêng mình.</span>`;
    }
  }
  titleEl.textContent = isEdit ? "Sửa mẫu chung" : "Lấy link cho tôi";
  actionBtn.textContent = isEdit ? "Lưu mẫu" : "Tạo link";
  if (noteEl) {
    noteEl.textContent = isEdit
      ? "Bạn có thể đổi link nguồn và tên mẫu. Nội dung share, video và domain sẽ lấy theo link nguồn mới."
      : "Popup này sẽ tạo link ngay trong tab team. Sau khi tạo xong, hệ thống sẽ làm mới dữ liệu và tự sao chép link rút gọn cho bạn.";
  }
  modal.classList.remove("hidden");
  if (!isEdit && originalUrlInput) {
    setTimeout(() => originalUrlInput.focus(), 0);
  }
}

async function closeTeamTemplateModal(confirmed) {
  const modal = document.getElementById("teamTemplateModal");
  const state = teamTemplateModalState;
  const actionBtn = document.getElementById("teamTemplateModalActionBtn");
  if (!confirmed || !state) {
    if (modal) modal.classList.add("hidden");
    teamTemplateModalState = null;
    return;
  }

  if (state.mode === "edit") {
    if (modal) modal.classList.add("hidden");
    teamTemplateModalState = null;
    const sourceLinkId = Number(
      document.getElementById("teamTemplateModalSourceLink")?.value || 0,
    );
    const name = String(
      document.getElementById("teamTemplateModalName")?.value || "",
    ).trim();
    if (!Number.isInteger(sourceLinkId) || sourceLinkId < 1) {
      toast("Chọn link nguồn trước khi lưu mẫu.", "warn");
      return;
    }
    try {
      const response = await fetch(`/api/team/templates/${state.templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_link_id: sourceLinkId,
          name,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "Không thể cập nhật mẫu chung");
      }
      setTeamWorkspaceData(data);
      renderTeamWorkspaceSummary();
      renderTeamMembers(teamWorkspaceData?.members || []);
      renderTeamTemplates(teamWorkspaceData?.templates || []);
      toast("Đã cập nhật mẫu chung.", "ok");
    } catch (error) {
      toast(error.message || "Không thể cập nhật mẫu chung", "warn");
    }
    return;
  }

  const originalUrl = String(
    document.getElementById("teamTemplateModalOriginalUrl")?.value || "",
  ).trim();
  if (!originalUrl) {
    toast("Dán link gốc của bạn trước khi tạo link.", "warn");
    document.getElementById("teamTemplateModalOriginalUrl")?.focus();
    return;
  }
  const defaultActionLabel = "Tạo link";
  if (actionBtn) {
    actionBtn.disabled = true;
    actionBtn.textContent = "Đang tạo...";
  }
  try {
    const response = await fetch("/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: originalUrl,
        alias: state.alias || "",
        team_template_id: state.templateId,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tạo link từ mẫu chung");
    }
    if (modal) modal.classList.add("hidden");
    teamTemplateModalState = null;
    let copied = false;
    try {
      await navigator.clipboard.writeText(data.short_url);
      copied = true;
    } catch {}
    await loadData();
    if (document.getElementById("page-team")?.classList.contains("active")) {
      await loadTeamWorkspace({ silent: true });
      renderTeamWorkspaceSummary();
      renderTeamMembers(teamWorkspaceData?.members || []);
      renderTeamTemplates(teamWorkspaceData?.templates || []);
    }
    toast(
      copied
        ? "Đã tạo link từ mẫu chung và sao chép link rút gọn."
        : "Đã tạo link từ mẫu chung thành công.",
      "ok",
    );
  } catch (error) {
    toast(error.message || "Không thể tạo link từ mẫu chung", "warn");
  } finally {
    if (actionBtn) {
      actionBtn.disabled = false;
      actionBtn.textContent = defaultActionLabel;
    }
  }
}

function clearTeamTemplateDraft(silent = false) {
  pendingTeamTemplateDraft = null;
  selectedTeamTemplateSourceIds = [];
  selectedTeamTemplateMediaLinkId = null;
  uploadedTeamTemplateMedia = null;
  renderTeamWorkspaceSummary();
  if (document.getElementById("page-create")?.classList.contains("active")) {
    renderForms();
  }
  if (!silent) {
    toast("Đã bỏ chế độ tạo link từ mẫu chung.", "ok");
  }
}

function useTeamTemplate(templateId) {
  if (!user) {
    redirectToAuth("register", "Đăng nhập để lấy link từ mẫu chung.");
    return;
  }
  const membership = getTeamMembership();
  if (membership?.status !== "active") {
    toast("Bạn cần ở trạng thái hoạt động để lấy link từ mẫu chung.", "warn");
    return;
  }
  const template = findTeamTemplateById(templateId);
  if (!template) {
    toast("Không tìm thấy mẫu link chung.", "warn");
    return;
  }
  pendingTeamTemplateDraft = {
    id: template.id,
    name: template.name,
    creator_name: template.creator_name,
    og_title: template.og_title || "",
    og_desc: template.og_desc || "",
    og_image: template.og_image || "",
    link_type: template.link_type || "direct",
    video_url: template.video_url || "",
    video_overlay_text: template.video_overlay_text || "",
    video_popup_url_3s: template.video_popup_url_3s || "",
    video_popup_url_5s: template.video_popup_url_5s || "",
    video_popup_url_300s: template.video_popup_url_300s || "",
    domain_hostname: template.domain_hostname || "",
  };
  navigate("create");
  toast(
    "Đã nạp mẫu chung. Bạn chỉ cần dán URL affiliate của riêng mình.",
    "ok",
  );
}

function applyPendingTeamTemplateDraft(containerId) {
  const noticeEl = document.getElementById(`${containerId}_templateNotice`);
  const draft = pendingTeamTemplateDraft;
  const fieldIds = [
    `${containerId}_ltype`,
    `${containerId}_domain`,
    `${containerId}_ogtitle`,
    `${containerId}_ogdesc`,
    `${containerId}_ogimg`,
    `${containerId}_videourl`,
    `${containerId}_videotext`,
    `${containerId}_video_popup_url_3s`,
    `${containerId}_video_popup_url_5s`,
    `${containerId}_video_popup_url_300s`,
    `${containerId}_fileinput`,
    `${containerId}_vfile`,
  ];
  fieldIds.forEach((fieldId) => {
    const element = document.getElementById(fieldId);
    if (element) element.disabled = false;
  });
  const uploadArea = document.getElementById(`${containerId}_uarea`);
  const videoUploadArea = document.getElementById(`${containerId}_vuploadarea`);
  if (uploadArea) uploadArea.style.pointerEvents = "";
  if (videoUploadArea) videoUploadArea.style.pointerEvents = "";
  if (noticeEl) {
    noticeEl.style.display = "none";
    noticeEl.innerHTML = "";
  }
  if (!draft) {
    onLinkTypeChange(containerId);
    updateCreateDomainDisplay(containerId);
    updateOgPreview(containerId);
    syncAutoAliasPreview(containerId);
    return;
  }

  const urlInput = document.getElementById(`${containerId}_url`);
  const typeInput = document.getElementById(`${containerId}_ltype`);
  const domainInput = document.getElementById(`${containerId}_domain`);
  const ogTitleInput = document.getElementById(`${containerId}_ogtitle`);
  const ogDescInput = document.getElementById(`${containerId}_ogdesc`);
  const ogImageInput = document.getElementById(`${containerId}_ogimg`);
  const videoUrlInput = document.getElementById(`${containerId}_videourl`);
  const videoTextInput = document.getElementById(`${containerId}_videotext`);
  const videoPopup3sInput = document.getElementById(
    `${containerId}_video_popup_url_3s`,
  );
  const videoPopup5sInput = document.getElementById(
    `${containerId}_video_popup_url_5s`,
  );
  const videoPopup300sInput = document.getElementById(
    `${containerId}_video_popup_url_300s`,
  );
  const metaBody = document.getElementById(`${containerId}_metabody`);
  if (urlInput) {
    urlInput.value = draft.original_url || "";
    urlInput.placeholder = draft.original_url
      ? "Link goc da duoc ap dung tu popup mau chung"
      : "Dan link affiliate/dich cua rieng ban vao day...";
  }
  if (typeInput) typeInput.value = draft.link_type || "direct";
  const normalizedHost = normalizeDomainChoice(draft.domain_hostname);
  if (normalizedHost) {
    createDomainSelection = normalizedHost;
  }
  if (domainInput && normalizedHost) {
    const hasOption = [...domainInput.options].some(
      (option) => normalizeDomainChoice(option.value) === normalizedHost,
    );
    if (!hasOption) {
      const option = document.createElement("option");
      option.value = normalizedHost;
      option.textContent = normalizedHost;
      domainInput.appendChild(option);
    }
    domainInput.value = normalizedHost;
  }
  if (ogTitleInput) ogTitleInput.value = draft.og_title || "";
  if (ogDescInput) ogDescInput.value = draft.og_desc || "";
  if (ogImageInput) ogImageInput.value = draft.og_image || "";
  if (videoUrlInput) videoUrlInput.value = draft.video_url || "";
  if (videoTextInput) videoTextInput.value = draft.video_overlay_text || "";
  if (videoPopup3sInput)
    videoPopup3sInput.value = draft.video_popup_url_3s || "";
  if (videoPopup5sInput)
    videoPopup5sInput.value = draft.video_popup_url_5s || "";
  if (videoPopup300sInput)
    videoPopup300sInput.value = draft.video_popup_url_300s || "";

  fieldIds.forEach((fieldId) => {
    const element = document.getElementById(fieldId);
    if (element) element.disabled = true;
  });
  if (uploadArea) uploadArea.style.pointerEvents = "none";
  if (videoUploadArea) videoUploadArea.style.pointerEvents = "none";
  if (metaBody) metaBody.style.display = "block";
  if (metaArrow) metaArrow.style.transform = "rotate(180deg)";
  if (noticeEl) {
    noticeEl.style.display = "block";
    noticeEl.innerHTML = `
            <div style="margin:0 0 12px;padding:12px 14px;border:1px solid rgba(59,130,246,.22);border-radius:12px;background:rgba(59,130,246,.08);display:flex;gap:12px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
              <div style="display:flex;flex-direction:column;gap:4px;min-width:220px">
                <strong style="font-size:13px;color:var(--text)">Đang tạo link từ mẫu chung: ${esc(draft.name || "Template")}</strong>
                <span style="font-size:12px;color:var(--text2)">Người tạo mẫu: ${esc(draft.creator_name || "Team member")}</span>
                <span style="font-size:12px;color:var(--text3)">Nội dung share, kiểu link và domain đã khóa theo mẫu. Bạn chỉ cần dán URL đích của riêng mình.</span>
              </div>
              <button class="user-btn secondary" type="button" onclick="clearTeamTemplateDraft()">Bỏ mẫu</button>
            </div>`;
  }
  onLinkTypeChange(containerId);
  updateCreateDomainDisplay(containerId);
  updateOgPreview(containerId);
  syncAutoAliasPreview(containerId);
}

function toggleMeta(cid) {
  const body = document.getElementById(`${cid}_metabody`);
  const arrow = document.getElementById(`${cid}_arrow`);
  if (!body) return;
  const isOpen = body.style.display !== "none" && body.style.display !== "";
  body.style.display = isOpen ? "none" : "block";
  if (arrow) arrow.style.transform = isOpen ? "" : "rotate(180deg)";
}

function onOgTitleInput(cid) {
  updateOgPreview(cid);
  syncAutoAliasPreview(cid);
}

function normalizeOgTitleInput(cid) {
  const input = document.getElementById(`${cid}_ogtitle`);
  if (!input) return;
  const rawValue = input.value.trim();
  if (!rawValue) {
    input.value = "";
    updateOgPreview(cid);
    syncAutoAliasPreview(cid);
    return;
  }
  if (looksLikeSlugTitle(rawValue)) {
    input.value = humanizeSlugTitle(rawValue).slice(0, 120);
  }
  updateOgPreview(cid);
  syncAutoAliasPreview(cid);
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

let toastTimer = null;

function isShopeeUrlCandidate(value) {
  try {
    const rawValue = String(value || "").trim();
    if (!rawValue) return false;
    const normalizedValue = /^https?:\/\//i.test(rawValue)
      ? rawValue
      : `https://${rawValue}`;
    const url = new URL(normalizedValue);
    const hostname = url.hostname.toLowerCase();
    return hostname === "shopee.vn" || hostname.endsWith(".shopee.vn");
  } catch {
    return false;
  }
}

function setInlineUploadStatus(targetId, message = "", tone = "", progress = null) {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!message) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  const palette = {
    ok: "var(--green)",
    err: "var(--red)",
    warn: "var(--brand)",
  };
  el.style.display = "block";
  el.style.color = palette[tone] || "var(--text3)";
  el.textContent =
    progress === null
      ? message
      : `${message} ${Math.max(0, Math.min(100, Number(progress) || 0))}%`;
}

function uploadFormDataWithProgress(
  url,
  formData,
  { onProgress, withCredentials = false } = {},
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url, true);
    xhr.withCredentials = withCredentials;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.round((event.loaded / event.total) * 100), event);
    };
    xhr.onerror = () => reject(new Error("Lỗi kết nối"));
    xhr.onload = () => {
      let payload = {};
      try {
        payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        payload = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
        return;
      }
      const error = new Error(
        payload.error ||
          payload?.error?.message ||
          `Upload thất bại (${xhr.status})`,
      );
      error.status = xhr.status;
      error.payload = payload;
      reject(error);
    };
    xhr.send(formData);
  });
}

async function uploadImageFileToField(file, options = {}) {
  const {
    inputId = "",
    previewId = "",
    statusId = "",
    areaId = "",
    onAfterSet = null,
  } = options;
  const fd = new FormData();
  fd.append("image", file);
  const area = areaId ? document.getElementById(areaId) : null;
  if (area) area.style.borderColor = "var(--brand)";
  setInlineUploadStatus(statusId, "Đang upload ảnh...", "warn", 0);
  const data = await uploadFormDataWithProgress("/api/upload-image", fd, {
    onProgress: (progress) =>
      setInlineUploadStatus(statusId, "Đang upload ảnh...", "warn", progress),
  });
  const absoluteUrl = data.url.startsWith("/")
    ? window.location.origin + data.url
    : data.url;
  const input = inputId ? document.getElementById(inputId) : null;
  if (input) input.value = absoluteUrl;
  const preview = previewId ? document.getElementById(previewId) : null;
  if (preview) {
    preview.src = absoluteUrl;
    preview.style.display = "block";
  }
  if (typeof onAfterSet === "function") onAfterSet(absoluteUrl, data);
  if (area) area.style.borderColor = "var(--green)";
  setInlineUploadStatus(statusId, "Upload ảnh xong", "ok", 100);
  return { ...data, url: absoluteUrl };
}

async function persistGeneratedThumb(dataUrl, inputId, onAfterSet) {
  if (!dataUrl) return null;
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const file = new File([blob], `video-thumb-${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
  const fd = new FormData();
  fd.append("image", file);
  const uploadRes = await fetch("/api/upload-image", {
    method: "POST",
    body: fd,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) {
    throw new Error(uploadData.error || "Upload thumbnail thất bại");
  }
  const input = document.getElementById(inputId);
  if (input) {
    input.value = uploadData.url.startsWith("/")
      ? window.location.origin + uploadData.url
      : uploadData.url;
  }
  if (typeof onAfterSet === "function") onAfterSet();
  return uploadData.url;
}

async function handleVideoUploadLegacy(event, cid) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  const preview = document.getElementById(cid + "_vpreview");
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    preview.onloadeddata = () => extractThumbFromVideoElement(preview, cid);
  }
  const area = document.getElementById(cid + "_vuploadarea");
  if (area) area.style.borderColor = "var(--brand)";
  setInlineUploadStatus(`${cid}_videoUploadStatus`, "Đang upload video...", "warn", 0);
  const fd = new FormData();
  fd.append("video", file);
  try {
    const d = await uploadFormDataWithProgress("/api/upload-video", fd, {
      onProgress: (progress) =>
        setInlineUploadStatus(
          `${cid}_videoUploadStatus`,
          "Đang upload video...",
          "warn",
          progress,
        ),
    });
    const urlInput = document.getElementById(cid + "_videourl");
    if (urlInput)
      urlInput.value = d.url.startsWith("/")
        ? window.location.origin + d.url
        : d.url;
    if (d.thumb) {
      const imgInput = document.getElementById(cid + "_ogimg");
      if (
        imgInput &&
        (!imgInput.value || String(imgInput.value).startsWith("data:image/"))
      ) {
        imgInput.value = d.thumb;
        updateVideoThumbPreview(cid);
      }
      toast("✅ Upload xong! Thumbnail đã tự động lấy từ video.", "ok");
    } else {
      toast("✅ Upload video thành công!", "ok");
    }
    if (area) area.style.borderColor = "var(--green)";
    setInlineUploadStatus(`${cid}_videoUploadStatus`, "Upload video xong", "ok", 100);
    void triggerVideoMetadataAi(cid, true);
  } catch (error) {
    if (error?.status === 401) {
      redirectToAuth("login", "Cần đăng nhập để upload video.");
      return;
    }
    if (error?.status === 403 && error?.payload?.upgrade) {
      toast(error.payload.error || "Tính năng này yêu cầu gói Pro", "warn");
      return;
    }
    setInlineUploadStatus(
      `${cid}_videoUploadStatus`,
      error?.message || "Upload video thất bại",
      "err",
    );
    toast(error?.message || "Lỗi upload video", "err");
    if (area) area.style.borderColor = "var(--border2)";
  } finally {
    if (input) input.value = "";
  }
}

function buildCloudinaryVideoThumb(uploadData) {
  return (
    uploadData?.eager?.[0]?.secure_url ||
    uploadData?.secure_url
      ?.replace("/upload/", "/upload/so_0,w_1200,h_630,c_fill,f_jpg/")
      ?.replace(/\.[^.]+$/, ".jpg") ||
    null
  );
}

function buildCloudinaryPlayableVideoUrl(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
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

async function fetchVideoUploadSignature(file) {
  const query = new URLSearchParams();
  if (file?.name) query.set("filename", file.name);
  if (file?.type) query.set("content_type", file.type);
  const response = await fetch(
    `/api/upload-video/signature${query.toString() ? `?${query.toString()}` : ""}`,
  );
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(
      data.error || "Khong lay duoc cau hinh upload video",
    );
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function uploadBinaryWithProgress(
  url,
  file,
  { method = "PUT", headers = {}, onProgress } = {},
) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url, true);
    Object.entries(headers || {}).forEach(([key, value]) => {
      if (value) xhr.setRequestHeader(key, value);
    });
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || typeof onProgress !== "function") return;
      onProgress(Math.round((event.loaded / event.total) * 100), event);
    };
    xhr.onerror = () => reject(new Error("Lỗi kết nối"));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve({
          status: xhr.status,
          body: xhr.responseText,
        });
        return;
      }
      const error = new Error(`Upload thất bại (${xhr.status})`);
      error.status = xhr.status;
      reject(error);
    };
    xhr.send(file);
  });
}

async function uploadVideoDirect(file, onProgress) {
  const signatureData = await fetchVideoUploadSignature(file);
  if (
    signatureData.max_bytes &&
    Number.isFinite(signatureData.max_bytes) &&
    file.size > signatureData.max_bytes
  ) {
    throw new Error(
      `Video vuot gioi han ${Math.round(signatureData.max_bytes / (1024 * 1024))}MB`,
    );
  }

  if (signatureData.provider === "r2") {
    await uploadBinaryWithProgress(signatureData.upload_url, file, {
      method: "PUT",
      headers: {
        "Content-Type": signatureData.content_type || file.type || "video/mp4",
      },
      onProgress,
    });
    return {
      url: signatureData.public_url,
      thumb: null,
      source: "r2-direct",
      key: signatureData.key,
    };
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("api_key", signatureData.api_key);
  formData.append("timestamp", String(signatureData.timestamp));
  formData.append("signature", signatureData.signature);
  formData.append("folder", signatureData.folder);
  formData.append("public_id", signatureData.public_id);

  const data = await uploadFormDataWithProgress(
    `https://api.cloudinary.com/v1_1/${signatureData.cloud_name}/video/upload`,
    formData,
    { onProgress },
  );
  return {
    url: buildCloudinaryPlayableVideoUrl(data.secure_url),
    thumb: buildCloudinaryVideoThumb(data),
    source: "cloudinary-direct",
    duration: data.duration,
  };
}

async function handleVideoUpload(event, cid) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;

  const preview = document.getElementById(cid + "_vpreview");
  if (preview) {
    preview.src = URL.createObjectURL(file);
    preview.style.display = "block";
    preview.onloadeddata = () => extractThumbFromVideoElement(preview, cid);
  }

  const area = document.getElementById(cid + "_vuploadarea");
  if (area) area.style.borderColor = "var(--brand)";
  setInlineUploadStatus(`${cid}_videoUploadStatus`, "Đang upload video...", "warn", 0);

  try {
    let uploadData;
    try {
      uploadData = await uploadVideoDirect(file, (progress) =>
        setInlineUploadStatus(
          `${cid}_videoUploadStatus`,
          "Đang upload video...",
          "warn",
          progress,
        ),
      );
    } catch (directError) {
      const canFallback =
        directError?.status === 503 ||
        /(Cloudinary|R2|upload trực tiếp|upload video trực tiếp)/i.test(
          String(directError?.message || ""),
        );
      if (!canFallback) throw directError;

      await handleVideoUploadLegacy(event, cid);
      return;
    }

    const urlInput = document.getElementById(cid + "_videourl");
    if (urlInput) {
      urlInput.value = uploadData.url.startsWith("/")
        ? window.location.origin + uploadData.url
        : uploadData.url;
    }

    if (uploadData.thumb) {
      const imgInput = document.getElementById(cid + "_ogimg");
      if (
        imgInput &&
        (!imgInput.value || String(imgInput.value).startsWith("data:image/"))
      ) {
        imgInput.value = uploadData.thumb;
        updateVideoThumbPreview(cid);
      }
      toast("Upload xong! Thumbnail da tu dong lay tu video.", "ok");
    } else {
      toast("Upload video thanh cong!", "ok");
    }

    if (area) area.style.borderColor = "var(--green)";
    setInlineUploadStatus(`${cid}_videoUploadStatus`, "Upload video xong", "ok", 100);
    void triggerVideoMetadataAi(cid, true);
  } catch (error) {
    if (error?.status === 401) {
      redirectToAuth("login", "Cần đăng nhập để upload video.");
      return;
    }
    if (error?.status === 403 && error?.payload?.upgrade) {
      toast(error.payload.error || "Tính năng này yêu cầu gói Pro", "warn");
      return;
    }
    setInlineUploadStatus(
      `${cid}_videoUploadStatus`,
      error?.message || "Lỗi upload video",
      "err",
    );
    toast(error?.message || "Lỗi upload video", "err");
    if (area) area.style.borderColor = "var(--border2)";
  } finally {
    if (input) input.value = "";
  }
}

// Extract thumbnail from <video> element via canvas
function extractThumbFromVideoElement(videoEl, cid) {
  try {
    videoEl.currentTime = 1;
    videoEl.onseeked = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 1200;
        canvas.height = 630;
        canvas.getContext("2d").drawImage(videoEl, 0, 0, 1200, 630);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const imgInput = document.getElementById(cid + "_ogimg");
        if (imgInput && !imgInput.value) {
          await persistGeneratedThumb(dataUrl, cid + "_ogimg", () =>
            updateVideoThumbPreview(cid),
          );
        }
      } catch (error) {
        console.warn("[video-thumb]", error?.message || error);
      }
    };
  } catch (_) {}
}

async function triggerVideoMetadataAi(cid, force = false) {
  if (!user?.id) return;
  const originalUrl =
    document.getElementById(`${cid}_url`)?.value.trim() || "";
  const videoUrl =
    document.getElementById(`${cid}_videourl`)?.value.trim() || "";
  const imageUrl = document.getElementById(`${cid}_ogimg`)?.value.trim() || "";
  const titleInput = document.getElementById(`${cid}_ogtitle`);
  const descInput = document.getElementById(`${cid}_ogdesc`);
  if (!videoUrl && !imageUrl) {
    if (force) {
      setCreateAiHint(
        cid,
        "Cần có URL video hoặc thumbnail để AI phân tích.",
        "warn",
      );
    }
    return;
  }
  if (!force && titleInput?.value.trim() && descInput?.value.trim()) {
    return;
  }
  setCreateAiHint(cid, "Đang nhờ AI gợi ý tiêu đề và mô tả...", "warn");
  try {
    const response = await fetch("/api/ai/video-metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        original_url: originalUrl,
        video_url: videoUrl,
        image_url: imageUrl,
        video_overlay_text:
          document.getElementById(`${cid}_videotext`)?.value.trim() || "",
        language: appLanguage || "vi",
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "AI chưa thể gợi ý metadata lúc này");
    }
    if (titleInput && data?.suggestion?.title) {
      titleInput.value = String(data.suggestion.title || "")
        .trim()
        .slice(0, 120);
    }
    if (descInput && data?.suggestion?.description) {
      descInput.value = String(data.suggestion.description || "")
        .trim()
        .slice(0, 200);
    }
    updateOgPreview(cid);
    syncAutoAliasPreview(cid);
    setCreateAiHint(
      cid,
      `AI đã gợi ý xong metadata${data?.suggestion?.model ? ` bằng ${data.suggestion.model}` : ""}. Bạn vẫn có thể sửa tay trước khi tạo link.`,
      "ok",
    );
  } catch (error) {
    setCreateAiHint(
      cid,
      error.message || "AI chưa thể gợi ý metadata lúc này.",
      "err",
    );
  }
}

// Called when user types YouTube/video URL manually
function onVideoUrlInput(cid) {
  const url = document.getElementById(cid + "_videourl")?.value.trim() || "";
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
  if (/^https?:\/\//i.test(url)) {
    void triggerVideoMetadataAi(cid, false);
  }
}

// Nút "🖼️ Thumb" – extract thumb theo URL hiện tại
async function extractThumbFromUrl(cid) {
  const url = document.getElementById(cid + "_videourl")?.value.trim() || "";
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
    void triggerVideoMetadataAi(cid, true);
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
    await persistGeneratedThumb(dataUrl, cid + "_ogimg", () =>
      updateVideoThumbPreview(cid),
    );
    toast("✅ Đã cắt thumbnail từ video!", "ok");
    void triggerVideoMetadataAi(cid, true);
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
  syncAutoAliasPreview(cid);
}
async function handleFileUpload(event, cid) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  try {
    const data = await uploadImageFileToField(file, {
      inputId: `${cid}_ogimg`,
      previewId: `${cid}_preview`,
      statusId: `${cid}_imgUploadStatus`,
      areaId: `${cid}_uarea`,
      onAfterSet: () => updateOgPreview(cid),
    });
    toast(data?.url ? "✅ Upload ảnh thành công!" : "✅ Upload ảnh xong!", "ok");
  } catch (error) {
    if (error?.status === 401) {
      redirectToAuth("login", "Cần đăng nhập để upload ảnh.");
      return;
    }
    if (error?.status === 403 && error?.payload?.upgrade) {
      toast(error.payload.error || "Tính năng này yêu cầu gói Pro", "warn");
      return;
    }
    setInlineUploadStatus(
      `${cid}_imgUploadStatus`,
      error?.message || "Upload ảnh thất bại",
      "err",
    );
    toast(error?.message || "Lỗi upload", "err");
  } finally {
    if (input) input.value = "";
  }
}

function onLinkTypeChange(cid) {
  const val = document.getElementById(cid + "_ltype")?.value;
  const vidSec = document.getElementById(cid + "_videosec");
  const url = document.getElementById(cid + "_url")?.value.trim() || "";
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

  if (val === "video" && url && !isShopeeUrlCandidate(url)) {
    setCreateUrlHint(cid, "Kiểu link Video Overlay chỉ hỗ trợ link Shopee");
    const el = document.getElementById(cid + "_ltype");
    if (el) el.value = "direct";
    if (vidSec) vidSec.className = "video-sec";
    return;
  }

  setCreateUrlHint(cid, "");

  // Hiện/ẩn video section
  if (vidSec) vidSec.className = "video-sec" + (val === "video" ? " show" : "");
  syncVideoOverlayRoleHint(cid);

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
  const titleInput = document.getElementById(`${cid}_ogtitle`);
  const normalizedOgTitle = looksLikeSlugTitle(titleInput?.value || "")
    ? humanizeSlugTitle(titleInput?.value || "").slice(0, 120)
    : String(titleInput?.value || "").trim();
  if (titleInput && titleInput.value.trim() !== normalizedOgTitle) {
    titleInput.value = normalizedOgTitle;
  }
  const alias = buildAutoAliasFromInputs(normalizedOgTitle, url);
  syncAutoAliasPreview(cid);
  const og_title = normalizedOgTitle || "";
  const og_desc = document.getElementById(`${cid}_ogdesc`)?.value.trim() || "";
  const og_image = document.getElementById(`${cid}_ogimg`)?.value.trim() || "";
  const link_type = document.getElementById(`${cid}_ltype`)?.value || "direct";
  const domain_hostname = normalizeDomainChoice(
    document.getElementById(`${cid}_domain`)?.value ||
      createDomainSelection ||
      "",
  );
  const video_url =
    document.getElementById(`${cid}_videourl`)?.value.trim() || "";
  const video_overlay_text =
    document.getElementById(`${cid}_videotext`)?.value.trim() || "";
  const video_popup_url_3s =
    document.getElementById(`${cid}_video_popup_url_3s`)?.value.trim() || "";
  const video_popup_url_5s =
    document.getElementById(`${cid}_video_popup_url_5s`)?.value.trim() || "";
  const video_popup_url_300s =
    document.getElementById(`${cid}_video_popup_url_300s`)?.value.trim() || "";
  const btn = document.getElementById(`${cid}_btn`);
  const errEl = document.getElementById(`${cid}_err`);
  const teamTemplateId = Number(pendingTeamTemplateDraft?.id || 0) || null;
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

  if (link_type === "video" && !video_url) {
    errEl.textContent =
      "Link video cần URL video hoặc upload video trước khi tạo";
    errEl.classList.add("show");
    return;
  }
  if (link_type === "video" && !isShopeeUrlCandidate(url)) {
    errEl.textContent = "Link video hiện chỉ hỗ trợ URL Shopee";
    errEl.classList.add("show");
    return;
  }
  if (affiliateUrl && !loggedInUser) {
    showAffiliateShortenPrompt(
      cid,
      "Link affiliate cần đăng nhập hoặc đăng kí để rút gọn",
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
          video_popup_url_3s,
          video_popup_url_5s,
          video_popup_url_300s,
          team_template_id: teamTemplateId,
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
          data.error ||
            "Link affiliate Shopee/TikTok yêu cầu gói Pro để rút gọn",
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
    if (teamTemplateId) {
      pendingTeamTemplateDraft = null;
      applyPendingTeamTemplateDraft(cid);
    }
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
function getDashboardPlatformMetrics() {
  const uniqueRows = Array.isArray(
    statsAnalytics?.platforms?.unique_distribution,
  )
    ? statsAnalytics.platforms.unique_distribution
    : [];
  const uniqueTodayRows = Array.isArray(
    statsAnalytics?.platforms?.unique_today_distribution,
  )
    ? statsAnalytics.platforms.unique_today_distribution
    : [];
  const rawRows = Array.isArray(statsAnalytics?.platforms?.distribution)
    ? statsAnalytics.platforms.distribution
    : [];
  const rawTodayRows = Array.isArray(statsAnalytics?.platforms?.today_distribution)
    ? statsAnalytics.platforms.today_distribution
    : [];
  const readMetric = (key) => ({
    unique: Number(
      uniqueRows.find((item) => String(item?.key || "") === key)?.clicks || 0,
    ),
    uniqueToday: Number(
      uniqueTodayRows.find((item) => String(item?.key || "") === key)
        ?.clicks_today || 0,
    ),
    raw: Number(
      rawRows.find((item) => String(item?.key || "") === key)?.clicks || 0,
    ),
    rawToday: Number(
      rawTodayRows.find((item) => String(item?.key || "") === key)?.clicks_today ||
        0,
    ),
  });
  return {
    shopee: readMetric("shopee"),
    tiktok: readMetric("tiktok"),
  };
}

function rememberStatsPayloadCache(payload) {
  if (!payload || typeof payload !== "object") return;
  statsPayloadCache = payload;
  statsPayloadCacheAt = Date.now();
}

async function getStatsPayload({ preferCache = false } = {}) {
  const now = Date.now();
  if (
    preferCache &&
    statsPayloadCache &&
    now - statsPayloadCacheAt <= STATS_PAYLOAD_CACHE_TTL_MS
  ) {
    return statsPayloadCache;
  }
  if (statsPayloadPromise) {
    return statsPayloadPromise;
  }
  statsPayloadPromise = (async () => {
    const response = await fetch("/api/stats");
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.error || "Không thể tải thống kê");
    }
    rememberStatsPayloadCache(payload || {});
    return payload || {};
  })();
  try {
    return await statsPayloadPromise;
  } finally {
    statsPayloadPromise = null;
  }
}

async function loadData(prefetched = null) {
  try {
    const d = prefetched || (await getStatsPayload());
    rememberStatsPayloadCache(d);
    statsAnalytics = d.analytics || null;
    links = d.recent || [];
    const recentWindowDays = Math.max(
      Number(d.recentWindowDays) || RECENT_STATS_WINDOW_DAYS,
      1,
    );
    const recentWindowLabel = `${recentWindowDays} ngày`;
    const displayTotalClicks = Number(
      d.uniqueTotalClicks ?? d.totalClicks ?? 0,
    );
    const displayClicksToday = Number(
      d.uniqueClicksToday ?? d.clicksToday ?? 0,
    );
    selectedLinkIds = new Set(
      [...selectedLinkIds].filter((id) =>
        links.some((link) => Number(link.id) === Number(id)),
      ),
    );
    const dashboardClicksLabel = document.getElementById("dClicksLabel");
    if (dashboardClicksLabel) {
      dashboardClicksLabel.textContent = `Click unique ${recentWindowLabel}`;
    }
    document.getElementById("dClicks").textContent =
      displayTotalClicks.toLocaleString();
    document.getElementById("dLinks").textContent = (
      d.totalLinks || 0
    ).toLocaleString();
    if (document.getElementById("dClicksToday"))
      document.getElementById("dClicksToday").textContent =
        displayClicksToday.toLocaleString();
    if (document.getElementById("dLinksToday"))
      document.getElementById("dLinksToday").textContent = (
        d.linksToday || 0
      ).toLocaleString();
    // Stats page
    if (document.getElementById("stTotalClicks"))
      document.getElementById("stTotalClicks").textContent =
        displayTotalClicks.toLocaleString();
    if (document.getElementById("stClicksToday"))
      document.getElementById("stClicksToday").textContent =
        displayClicksToday.toLocaleString();
    if (document.getElementById("stTotalLinks"))
      document.getElementById("stTotalLinks").textContent = (
        d.totalLinks || 0
      ).toLocaleString();
    if (document.getElementById("stLinksToday"))
      document.getElementById("stLinksToday").textContent = (
        d.linksToday || 0
      ).toLocaleString();
    document.getElementById("navCount").textContent = d.totalLinks || 0;
    document.getElementById("linkCountLabel").textContent = d.totalLinks || 0;
    const dashboardPlatformMetrics = getDashboardPlatformMetrics();
    document.getElementById("dClicksSub").textContent = `Raw clicks ${recentWindowLabel}: ${Number(
      d.rawTotalClicks ?? statsAnalytics?.total_clicks ?? 0,
    ).toLocaleString()}`;
    document.getElementById("dShopee").textContent = Number(
      dashboardPlatformMetrics.shopee.unique,
    ).toLocaleString();
    document.getElementById("dShopeeSub").textContent = `Hôm nay: ${Number(
      dashboardPlatformMetrics.shopee.uniqueToday,
    ).toLocaleString()} · Raw clicks: ${Number(
      dashboardPlatformMetrics.shopee.raw,
    ).toLocaleString()}`;
    document.getElementById("dTiktok").textContent = Number(
      dashboardPlatformMetrics.tiktok.unique,
    ).toLocaleString();
    document.getElementById("dTiktokSub").textContent = `Hôm nay: ${Number(
      dashboardPlatformMetrics.tiktok.uniqueToday,
    ).toLocaleString()} · Raw clicks: ${Number(
      dashboardPlatformMetrics.tiktok.raw,
    ).toLocaleString()}`;
    renderActivity(links, "dashActivity");
    renderActivity(links, "createActivity");
    renderChart();
    if (document.getElementById("page-qr")?.classList.contains("active"))
      renderQrPage();
    if (document.getElementById("page-bio")?.classList.contains("active"))
      renderBioPage();
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
      const shortUrl = (l.short_url || "").replace(/^https?:\/\//, "");
      const originalUrl = l.original_url || "";
      return `<div class="ai">
      <div class="ai-ic ${p}">${icons[p]}</div>
      <div class="ai-info">
        <div class="ai-short" title="${esc(shortUrl)}">${esc(shortUrl)}</div>
        <div class="ai-orig" title="${esc(originalUrl)}">${esc(originalUrl)}</div>
      </div>
      <div class="ai-clicks">👁 ${l.clicks || 0}</div>
    </div>`;
    })
    .join("");
}

function shouldUseOriginalLinkClamp(link = null, platform = "") {
  const normalizedPlatform = String(platform || "").trim().toLowerCase();
  const originalUrl = String(link?.original_url || "").trim();
  return normalizedPlatform === "tiktok" && originalUrl.length > 120;
}

function renderOriginalLinkCell(link = null, platform = "", linkId = 0) {
  const originalUrl = String(link?.original_url || "").trim();
  if (!originalUrl) {
    return '<span style="color:var(--text3)">—</span>';
  }
  if (!shouldUseOriginalLinkClamp(link, platform)) {
    return esc(originalUrl);
  }
  const normalizedId = Number(linkId);
  const isExpanded = expandedOriginalLinkIds.has(normalizedId);
  return `<div class="td-orig-wrap ${isExpanded ? "is-expanded" : "is-clamped"}">
    <span class="td-orig-text">${esc(originalUrl)}</span>
    <button class="td-orig-toggle" type="button" onclick="toggleOriginalLinkExpand(${normalizedId})">${isExpanded ? "Thu gọn" : "Xem thêm"}</button>
  </div>`;
}

function renderTable(arr) {
  const tb = document.getElementById("tblBody");
  currentFilteredLinks = Array.isArray(arr) ? arr.slice() : [];
  if (!arr.length) {
    tb.innerHTML =
      '<tr><td colspan="8" class="tbl-empty">Chưa có link. <span style="color:var(--brand);cursor:pointer" onclick="navigate(\'create\')">Tạo ngay →</span></td></tr>';
    syncMobileCardTableLabels(tb);
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
      <td class="td-orig" title="${l.original_url || ""}">${renderOriginalLinkCell(l, p, linkId)}</td>
      <td><span class="pill ${p}">${lbl[p]}</span></td>
      <td>${l.og_title ? `<span style="font-size:11px;color:var(--green)">✅ ${esc(l.og_title).substring(0, 20)}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td style="font-weight:700;color:var(--text)">${l.clicks || 0}</td>
      <td style="color:var(--text3)">${date}</td>
      <td class="td-actions" style="display:flex;gap:5px">
        <button class="btn-cp" onclick="copyClip('${l.short_url || ""}')">📋</button>
        <button class="btn-cp" onclick="openEditModal(${l.id})" style="color:var(--brand)" title="Chỉnh sửa">✏️</button>
        <button class="btn-cp" onclick="deleteMyLink(${l.id},'${(l.short_url || "").replace(/^https?:\/\//, "")}')" style="color:var(--red);border-color:rgba(239,68,68,.2)" title="Xóa">🗑️</button>
      </td>
    </tr>`;
    })
    .join("");
  syncMobileCardTableLabels(tb);
  syncLinkBulkToolbar(currentFilteredLinks);
}

function toggleOriginalLinkExpand(linkId) {
  const normalizedId = Number(linkId);
  if (!Number.isFinite(normalizedId)) return;
  if (expandedOriginalLinkIds.has(normalizedId)) {
    expandedOriginalLinkIds.delete(normalizedId);
  } else {
    expandedOriginalLinkIds.add(normalizedId);
  }
  renderTable(currentFilteredLinks);
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
  const color = document.getElementById("qrColorSelect")?.value || "#3b82f6";
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
  if (hint)
    hint.textContent = `Đang tạo cho ${value.replace(/^https?:\/\//, "")}`;
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
  if (
    !previewTitle ||
    !previewSubtitle ||
    !previewAvatar ||
    !cover ||
    !linksWrap
  )
    return;

  previewTitle.textContent = title || "Bio của tôi";
  previewSubtitle.textContent = subtitle || "Mô tả ngắn sẽ xuất hiện ở đây.";
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
      const url = (l.short_url || l.original_url || "").replace(
        /^https?:\/\//,
        "",
      );
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
  chartDays = RECENT_STATS_WINDOW_DAYS;
  document.querySelectorAll(".cf").forEach((button) => {
    const buttonDays = Number(
      button.dataset.days || String(button.textContent || "").replace(/\D/g, ""),
    );
    button.classList.toggle("active", buttonDays === chartDays);
  });
  if (btn) btn.classList.add("active");
  renderChart();
}

function renderChart() {
  const ctx = document.getElementById("clickChart");
  if (!ctx) return;
  const { labels, vals } = getStatsTimelineSeries();
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
          ticks: {
            color: "#4b5563",
            font: { size: 11 },
            precision: 0,
            maxTicksLimit: 8,
          },
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
      (p === "free" && (plan === "free" || plan === "guest")) || plan === p;
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
  if (!t) return;
  if (toastTimer) clearTimeout(toastTimer);
  t.textContent = msg;
  t.className = "toast show " + type;
  toastTimer = setTimeout(() => {
    t.className = "toast";
    toastTimer = null;
  }, 2600);
}

// Ctrl+K
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "k") {
    e.preventDefault();
    document.getElementById("tbSearch").focus();
  }
});
document.getElementById("tbSearch").addEventListener("input", function () {
  const q = this.value.trim();
  if (q && !document.getElementById("page-links").classList.contains("active"))
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
    (statsAnalytics?.unique_timeline || statsAnalytics?.timeline || []).map(
      (item) => [String(item.date || ""), Number(item.clicks || 0)],
    ),
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
  const countries =
    Array.isArray(geo.unique_countries) && geo.unique_countries.length
      ? geo.unique_countries.filter(
          (item) => item.country_name_en && item.clicks > 0,
        )
      : Array.isArray(geo.countries)
        ? geo.countries.filter(
            (item) => item.country_name_en && item.clicks > 0,
          )
        : [];
  const trackedClicks = Number(
    geo.unique_tracked_clicks ?? geo.tracked_clicks ?? 0,
  );
  const totalClicks = Number(
    statsAnalytics?.unique_clicks ?? statsAnalytics?.total_clicks ?? 0,
  );

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
          (item) =>
            `${item.country_name}: ${(item.clicks || 0).toLocaleString()} click`,
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
  const rows =
    Array.isArray(statsAnalytics?.geo?.unique_top_countries) &&
    statsAnalytics.geo.unique_top_countries.length
      ? statsAnalytics.geo.unique_top_countries
      : Array.isArray(statsAnalytics?.geo?.top_countries)
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
  const distribution = statsAnalytics?.platforms?.unique_distribution?.length
    ? statsAnalytics.platforms.unique_distribution
    : statsAnalytics?.platforms?.distribution?.length
      ? statsAnalytics.platforms.distribution
      : getFallbackPlatformDistribution();
  const usingFallback =
    !statsAnalytics?.platforms?.unique_distribution?.length &&
    !statsAnalytics?.platforms?.distribution?.length;
  if (summaryEl) {
    const totalClicks = Number(
      statsAnalytics?.unique_clicks ?? statsAnalytics?.total_clicks ?? 0,
    );
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
  const rows = statsAnalytics?.platforms?.top_platforms?.length
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
            ticks: {
              color: "#4b5563",
              font: { size: 11 },
              precision: 0,
              maxTicksLimit: 8,
            },
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
  if (!confirmed) return;
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
let adminUserLocationAnalytics = null;
let adminDomains = [];
let adminRedirects = [];
let adminPayments = [];
let adminSection = "overview";
let adminUserSearchQuery = "";
let adminUserPlanFilter = "all";
let adminPaymentSearchQuery = "";
let adminUserPage = 1;
let adminPaymentPage = 1;
let adminRedirectPage = 1;
let adminSelectedUserIds = new Set();
let billingConfig = null;
let billingRequests = [];
let paymentRequestDraft = null;
let paymentSelectedPlan = "pro";
let paymentQrStyler = null;
let supportMessages = [];
let supportThread = null;
let supportLoading = false;
let supportSending = false;
let supportNotice = "";
let supportWidgetOpen = false;
let supportLoaded = false;
let supportSyncInFlight = false;
let supportPollTimer = null;
let supportEventSource = null;
let supportEventSourceMode = "";
let supportReplySoundAt = 0;
let adminSupportThreads = [];
let adminSupportMessages = [];
let adminSupportSelectedUserId = null;
let adminSupportActiveUser = null;
let adminSupportLoading = false;
let adminSupportSending = false;
let adminSupportNotice = "";
let adminSupportSyncInFlight = false;
let adminSupportConversationSyncInFlight = false;
let adminSupportPollTimer = null;
let adminSupportEventSource = null;
const ADMIN_PAGE_SIZE = 20;
const SUPPORT_POLL_INTERVAL_MS = 7000;

function syncAdminSectionUI() {
  const availableSections = isAdminUser()
    ? new Set(["overview", "users", "payments", "support", "system", "logs"])
    : isSupportAgentUser()
      ? new Set(["support"])
      : new Set();
  if (!availableSections.has(adminSection)) {
    adminSection = availableSections.has("overview") ? "overview" : "support";
  }
  document.querySelectorAll(".admin-tab-btn").forEach((btn) => {
    const isAllowed = availableSections.has(btn.dataset.adminSection);
    const isActive = isAllowed && btn.dataset.adminSection === adminSection;
    btn.hidden = !isAllowed;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll(".admin-panel").forEach((panel) => {
    const isAllowed = availableSections.has(panel.dataset.adminPanel);
    const isActive = isAllowed && panel.dataset.adminPanel === adminSection;
    panel.classList.toggle("active", isActive);
    panel.hidden = !isActive;
  });
}

function setAdminSection(section) {
  adminSection = section || "overview";
  syncAdminSectionUI();
  startSupportSyncLoops();
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
      adminUserPlanFilter === "all" ||
      (u.plan || "free") === adminUserPlanFilter;
    return matchesQuery && matchesPlan;
  });
}

function getFilteredAdminPayments() {
  return adminPayments.filter((payment) => {
    if (!adminPaymentSearchQuery) return true;
    const keyword = adminPaymentSearchQuery;
    return [
      payment.reference_code,
      payment.transfer_note,
      payment.user_email,
      payment.user_name,
    ]
      .map((value) => String(value || "").toLowerCase())
      .some((value) => value.includes(keyword));
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

function filterAdminPayments(value) {
  adminPaymentSearchQuery = String(value || "")
    .trim()
    .toLowerCase();
  adminPaymentPage = 1;
  renderAdminPayments();
}

function getAdminSupportSelectedThread() {
  return adminSupportThreads.find(
    (thread) => Number(thread.user_id) === Number(adminSupportSelectedUserId),
  );
}

function sortAdminSupportThreads() {
  adminSupportThreads = [...adminSupportThreads].sort(
    (a, b) =>
      new Date(b.last_message_at || 0).getTime() -
      new Date(a.last_message_at || 0).getTime(),
  );
}

function renderAdminSupportThreadList() {
  const listEl = document.getElementById("adminSupportThreadList");
  const countEl = document.getElementById("adminSupportThreadCount");
  if (countEl) countEl.textContent = String(adminSupportThreads.length);
  if (!listEl) return;
  if (!adminSupportThreads.length) {
    listEl.innerHTML =
      '<div class="support-empty">Chưa có cuộc trò chuyện nào từ người dùng.</div>';
    return;
  }
  listEl.innerHTML = adminSupportThreads
    .map((thread) => {
      const threadUser = thread.user || {};
      const isActive =
        Number(thread.user_id || 0) === Number(adminSupportSelectedUserId || 0);
      const threadName =
        threadUser.name || threadUser.email || `User #${thread.user_id}`;
      const plan = String(threadUser.plan || "free").toUpperCase();
      return `<button
        class="support-thread-item ${isActive ? "active" : ""}"
        type="button"
        onclick="selectAdminSupportThread(${Number(thread.user_id)})"
      >
        <div class="support-thread-top">
          <div class="support-thread-name">${esc(threadName)}</div>
          ${
            thread.unread_for_admin
              ? `<span class="support-thread-badge">${esc(String(thread.unread_for_admin))}</span>`
              : ""
          }
        </div>
        <div class="support-thread-email">${esc(threadUser.email || `ID #${thread.user_id}`)}</div>
        <div class="support-thread-preview">${esc(
          thread.last_message || "Chưa có tin nhắn nào.",
        )}</div>
        <div class="support-thread-meta">
          <span class="support-thread-time">${esc(
            formatSupportTimelineTime(thread.last_message_at),
          )}</span>
          <span class="support-thread-email">${esc(
            `${plan} • ${thread.last_sender_role === "admin" ? "hỗ trợ" : "user"}`,
          )}</span>
        </div>
      </button>`;
    })
    .join("");
}

function renderAdminSupportConversation() {
  const selectedThread = getAdminSupportSelectedThread();
  const metaEl = document.getElementById("adminSupportThreadMeta");
  const noteEl = document.getElementById("adminSupportComposerNote");
  const btn = document.getElementById("adminSupportSendBtn");
  const activeUser = adminSupportActiveUser || selectedThread?.user || null;
  if (metaEl) {
    if (!selectedThread && !activeUser) {
      metaEl.textContent = "Chọn một hội thoại để xem chi tiết.";
    } else {
      const title = activeUser?.name || activeUser?.email || `User #${selectedThread?.user_id || "?"}`;
      const email = activeUser?.email || "Chưa có email";
      const role = String(activeUser?.role || "user").toUpperCase();
      const plan = String(activeUser?.plan || "free").toUpperCase();
      metaEl.textContent = `${title} • ${email} • ${plan} • ${role}`;
    }
  }
  renderSupportTimeline("adminSupportConversationList", adminSupportMessages, {
    viewerRole: "admin",
    ownLabel: isAdminUser() ? "Admin" : "Hỗ trợ",
    otherLabel:
      activeUser?.name || activeUser?.email || `User #${selectedThread?.user_id || ""}`,
    emptyText: selectedThread
      ? "Chưa có tin nhắn nào trong hội thoại này."
      : "Chọn một hội thoại để xem chi tiết.",
  });
  if (noteEl) {
    noteEl.textContent =
      adminSupportNotice ||
      (selectedThread?.unread_for_admin
        ? `${selectedThread.unread_for_admin} tin nhắn từ user chưa được mở trước đó.`
        : "Chọn thread ở cột trái rồi gửi phản hồi.");
  }
  if (btn) {
    btn.disabled = !adminSupportSelectedUserId || adminSupportSending;
    btn.textContent = adminSupportSending ? "Đang gửi..." : "Gửi phản hồi";
  }
}

async function refreshAdminSupport(options = {}) {
  if (!isSupportAgentUser() || adminSupportSyncInFlight) return;
  const silent = !!options.silent;
  const includeConversation = options.includeConversation !== false;
  adminSupportSyncInFlight = true;
  if (!silent) {
    adminSupportLoading = true;
    adminSupportNotice = "Đang tải hộp thư hỗ trợ...";
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
  }
  try {
    const response = await fetch("/api/admin/support");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tải hộp thư hỗ trợ");
    }
    adminSupportThreads = Array.isArray(data.threads) ? data.threads : [];
    sortAdminSupportThreads();
    if (
      adminSupportSelectedUserId &&
      !adminSupportThreads.some(
        (thread) =>
          Number(thread.user_id) === Number(adminSupportSelectedUserId),
      )
    ) {
      adminSupportSelectedUserId = null;
      adminSupportMessages = [];
      adminSupportActiveUser = null;
    }
    if (!adminSupportSelectedUserId && adminSupportThreads.length) {
      adminSupportSelectedUserId = Number(adminSupportThreads[0].user_id);
    }
    if (!silent) {
      adminSupportNotice = "";
    }
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
    if (includeConversation && adminSupportSelectedUserId) {
      await loadAdminSupportConversation(adminSupportSelectedUserId, {
        silent: true,
        peek: silent,
      });
    }
  } catch (error) {
    if (!silent || !adminSupportThreads.length) {
      adminSupportNotice = error.message || "Không thể tải hộp thư hỗ trợ";
    }
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
  } finally {
    adminSupportSyncInFlight = false;
    if (!silent) {
      adminSupportLoading = false;
    }
  }
}

async function loadAdminSupportConversation(userId, options = {}) {
  if (adminSupportConversationSyncInFlight) return;
  const normalizedUserId = Number(userId);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId < 1) return;
  adminSupportSelectedUserId = normalizedUserId;
  const silent = !!options.silent;
  const peekOnly = !!options.peek;
  adminSupportConversationSyncInFlight = true;
  if (!silent) {
    adminSupportNotice = "Đang tải hội thoại...";
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
  }
  try {
    const response = await fetch(
      peekOnly
        ? `/api/admin/support/${normalizedUserId}/messages?peek=1`
        : `/api/admin/support/${normalizedUserId}/messages`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tải hội thoại");
    }
    adminSupportMessages = Array.isArray(data.messages) ? data.messages : [];
    adminSupportActiveUser = data.user || getAdminSupportSelectedThread()?.user || null;
    adminSupportThreads = adminSupportThreads.map((thread) =>
      Number(thread.user_id) === normalizedUserId
        ? {
            ...(thread || {}),
            ...(data.thread || {}),
            user: data.user || thread.user,
            unread_for_admin: 0,
          }
        : thread,
    );
    sortAdminSupportThreads();
    if (!silent) {
      adminSupportNotice = "";
    }
  } catch (error) {
    if (!silent || !adminSupportMessages.length) {
      adminSupportNotice = error.message || "Không thể tải hội thoại";
    }
  } finally {
    adminSupportConversationSyncInFlight = false;
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
  }
}

function selectAdminSupportThread(userId) {
  adminSupportSelectedUserId = Number(userId) || null;
  void loadAdminSupportConversation(adminSupportSelectedUserId);
}

async function sendAdminSupportMessage() {
  if (!adminSupportSelectedUserId || adminSupportSending) return;
  const input = document.getElementById("adminSupportMessageInput");
  const message = String(input?.value || "").trim();
  if (!message) {
    toast("Nhập phản hồi trước khi gửi cho user", "warn");
    input?.focus();
    return;
  }
  adminSupportSending = true;
  adminSupportNotice = "Đang gửi phản hồi...";
  renderAdminSupportConversation();
  try {
    const response = await fetch(
      `/api/admin/support/${adminSupportSelectedUserId}/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể gửi phản hồi");
    }
    const created = data.message || null;
    adminSupportActiveUser = data.user || adminSupportActiveUser;
    if (created) {
      adminSupportMessages = [...adminSupportMessages, created];
      const existingThread = getAdminSupportSelectedThread();
      const nextThread = {
        ...(existingThread || {
          user_id: adminSupportSelectedUserId,
          user: adminSupportActiveUser,
          total_messages: 0,
          unread_for_admin: 0,
          unread_for_user: 0,
        }),
        user: adminSupportActiveUser || existingThread?.user || null,
        total_messages: Number(existingThread?.total_messages || 0) + 1,
        unread_for_admin: 0,
        unread_for_user: Number(existingThread?.unread_for_user || 0) + 1,
        last_message: created.message || message,
        last_message_at: created.created_at || new Date().toISOString(),
        last_sender_role: "admin",
      };
      adminSupportThreads = [
        nextThread,
        ...adminSupportThreads.filter(
          (thread) =>
            Number(thread.user_id) !== Number(adminSupportSelectedUserId),
        ),
      ];
      sortAdminSupportThreads();
    }
    if (input) input.value = "";
    adminSupportNotice = "Phản hồi đã được gửi cho user.";
    toast("Đã gửi phản hồi cho user", "ok");
  } catch (error) {
    adminSupportNotice = error.message || "Không thể gửi phản hồi";
    toast(adminSupportNotice, "err");
  } finally {
    adminSupportSending = false;
    renderAdminSupportThreadList();
    renderAdminSupportConversation();
  }
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
    const selectedOnPage = pageIds.filter((id) =>
      adminSelectedUserIds.has(id),
    ).length;
    pageCheckbox.checked =
      !!pageIds.length && selectedOnPage === pageIds.length;
    pageCheckbox.indeterminate =
      selectedOnPage > 0 && selectedOnPage < pageIds.length;
  }
}

async function loadAdminData() {
  if (!isSupportAgentUser()) {
    return;
  }
  void refreshAdminSupport();
  if (!isAdminUser()) {
    adminSection = "support";
    syncAdminSectionUI();
    return;
  }
  try {
    const [sr, dr, ur, rr, pr] = await Promise.all([
      fetch("/api/admin/stats"),
      fetch("/api/admin/domains"),
      fetch("/api/admin/users"),
      fetch("/api/admin/redirects?limit=500"),
      fetch("/api/admin/payments"),
    ]);
    let statsPayload = null;
    let redirectPayload = null;
    if (sr.ok) {
      statsPayload = await sr.json();
      renderAdminOverview(statsPayload);
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
      adminUserLocationAnalytics = u.locationAnalytics || null;
      adminSelectedUserIds = new Set(
        [...adminSelectedUserIds].filter((id) =>
          adminUsers.some((userItem) => Number(userItem.id) === Number(id)),
        ),
      );
      renderAdminUserLocationAnalytics();
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
    if (pr.ok) {
      const paymentsPayload = await pr.json();
      adminPayments = paymentsPayload.requests || [];
      renderAdminPayments();
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
    syncMobileCardTableLabels(tb);
    renderAdminPagination(
      "adRedirectPagination",
      pagination,
      "setAdminRedirectPage",
    );
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
  syncMobileCardTableLabels(tb);
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
    syncMobileCardTableLabels(tb);
    return;
  }
  tb.innerHTML = arr
    .map((d) => {
      const isPrimary = !!d.is_primary;
      const isActive = d.is_active !== false;
      const verificationStatus = String(
        d.verification_status || "verified",
      ).toLowerCase();
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
      <td class="td-actions" style="display:flex;gap:5px;flex-wrap:wrap">
        <button class="btn-cp" onclick="updateDomainHealth(${d.id},'${esc(d.hostname || "")}')">Lưu</button>
        <button class="btn-cp" onclick="setPrimaryDomain(${d.id},'${esc(d.hostname || "")}')" ${isPrimary ? "disabled" : ""}>Primary</button>
        <button class="btn-cp" onclick="toggleDomainActive(${d.id},${isActive ? "false" : "true"},'${esc(d.hostname || "")}')">${isActive ? "Pause" : "Activate"}</button>
        <button class="btn-del" onclick="deleteAdminDomain(${d.id},'${esc(d.hostname || "")}')">Xóa</button>
      </td>
    </tr>`;
    })
    .join("");
  syncMobileCardTableLabels(tb);
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
    syncMobileCardTableLabels(tb);
    syncAdminUserSelectionUI(filteredUsers, []);
    renderAdminPagination("adUserPagination", pagination, "setAdminUserPage");
    return;
  }
  tb.innerHTML = pageRows
    .map((u) => {
      const userId = Number(u.id);
      const isSelected = adminSelectedUserIds.has(userId);
      return `<tr class="admin-user-row ${isSelected ? "admin-row-selected" : ""}" onclick="openAdminUserDetailModal(${userId})">
    <td class="td-check" onclick="event.stopPropagation()">
      <label class="tbl-check">
        <input type="checkbox" ${isSelected ? "checked" : ""} onchange="toggleAdminUserSelection(${userId}, this.checked)" />
        <span></span>
      </label>
    </td>
    <td style="color:var(--text3)">${u.id}</td>
    <td style="font-weight:600">${esc(u.email)}</td>
    <td>${esc(u.name || "—")}</td>
    <td onclick="event.stopPropagation()">
      <select class="plan-select" data-current-plan="${esc(u.plan || "free")}" onchange="adminSetPlan(${u.id},this)">
        ${["free", "pro", "business", "admin"].map((p) => `<option value="${p}"${u.plan === p ? " selected" : ""}>${p}</option>`).join("")}
      </select>
    </td>
    <td onclick="event.stopPropagation()">
      <select class="plan-select" data-current-role="${esc(u.role || "user")}" onchange="adminSetRole(${u.id},this)">
        ${["user", "support", "admin"].map((role) => `<option value="${role}"${String(u.role || "user") === role ? " selected" : ""}>${getManagedUserRoleLabel(role)}</option>`).join("")}
      </select>
    </td>
    <td style="color:var(--text3);font-size:11px">${(u.created_at || "").substring(0, 10)}</td>
    <td class="td-actions"><button class="btn-del" onclick="adminDeleteUser(${u.id},'${esc(u.email)}')">Xóa</button></td>
  </tr>`;
    })
    .join("");
  syncMobileCardTableLabels(tb);
  syncAdminUserSelectionUI(filteredUsers, pageRows);
  renderAdminPagination("adUserPagination", pagination, "setAdminUserPage");
}

function renderAdminUserLocationAnalytics() {
  const mapEl = document.getElementById("adminUserGeoMap");
  const summaryEl = document.getElementById("adminUserGeoSummary");
  const topSummaryEl = document.getElementById("adminUserGeoTopSummary");
  const listEl = document.getElementById("adminUserGeoList");
  if (!mapEl || !listEl) return;

  const countries = Array.isArray(adminUserLocationAnalytics?.countries)
    ? adminUserLocationAnalytics.countries.filter(
        (item) => item.country_name_en && Number(item.clicks || 0) > 0,
      )
    : [];
  const usersWithLocation = Number(
    adminUserLocationAnalytics?.total_users_with_location || 0,
  );
  const usersWithoutLocation = Number(
    adminUserLocationAnalytics?.total_users_without_location || 0,
  );
  const totalUsers = usersWithLocation + usersWithoutLocation;

  if (summaryEl) {
    summaryEl.textContent = usersWithLocation
      ? `${usersWithLocation}/${totalUsers || usersWithLocation} user có vị trí`
      : "Chưa có dữ liệu địa lý";
  }
  if (topSummaryEl) {
    topSummaryEl.textContent = usersWithoutLocation
      ? `${usersWithoutLocation} user chưa ghi nhận vị trí`
      : "Theo login gần nhất";
  }

  if (!countries.length) {
    if (window.Plotly?.purge) window.Plotly.purge(mapEl);
    mapEl.innerHTML =
      '<div class="stats-map-empty">Chưa có dữ liệu vị trí user để hiển thị.</div>';
    listEl.innerHTML =
      '<div class="stats-map-empty">User cần đăng nhập ít nhất một lần trong môi trường có header địa lý.</div>';
    return;
  }

  if (!window.Plotly) {
    mapEl.innerHTML =
      '<div class="stats-map-empty">Không tải được thư viện bản đồ để hiển thị vị trí user.</div>';
  } else {
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
            (item) =>
              `${item.country_name}: ${Number(item.clicks || 0).toLocaleString()} user`,
          ),
          hovertemplate: "%{text}<extra></extra>",
          showscale: false,
          colorscale: [
            [0, "rgba(148,163,184,0.18)"],
            [0.35, "rgba(59,130,246,0.5)"],
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

  listEl.innerHTML = countries
    .slice(0, 8)
    .map(
      (country) => `<div class="admin-user-geo-item">
        <div class="admin-user-geo-item-main">
          <div class="admin-user-geo-country">${esc(
            country.country_name || country.country_code || "Không rõ",
          )}</div>
          <div class="admin-user-geo-city">Top city: ${esc(
            country.city || "Không rõ",
          )}</div>
        </div>
        <div class="admin-user-geo-count">${Number(
          country.clicks || 0,
        ).toLocaleString()} user</div>
      </div>`,
    )
    .join("");
}

function formatAdminUserDateTime(value) {
  if (!value) return "none";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("vi-VN");
}

function renderAdminUserDetailField(label, value) {
  return `
    <div class="admin-user-detail-item">
      <span class="admin-user-detail-label">${esc(label)}</span>
      <strong class="admin-user-detail-value">${esc(value || "—")}</strong>
    </div>`;
}

function openAdminUserDetailModal(userId, event) {
  const clickTarget = event?.target;
  if (
    clickTarget &&
    typeof clickTarget.closest === "function" &&
    clickTarget.closest(
      "input, select, button, a, .tbl-check, .btn-del, .plan-select",
    )
  ) {
    return;
  }

  const modal = document.getElementById("adminUserDetailModal");
  const userItem = adminUsers.find(
    (entry) => Number(entry.id) === Number(userId),
  );
  if (!modal || !userItem) return;

  const name = String(userItem.name || "").trim() || "Chưa cập nhật";
  const email = String(userItem.email || "").trim() || "—";
  const plan = String(userItem.plan || "free").trim() || "free";
  const role = String(userItem.role || "user").trim() || "user";
  const roleLabel = getManagedUserRoleLabel(role);
  const avatarText = (name || email || "U").charAt(0).toUpperCase();

  const titleEl = document.getElementById("adminUserDetailTitle");
  const subtitleEl = document.getElementById("adminUserDetailSubtitle");
  const avatarEl = document.getElementById("adminUserDetailAvatar");
  const summaryEl = document.getElementById("adminUserDetailSummary");
  const metaEl = document.getElementById("adminUserDetailMeta");
  const rawEl = document.getElementById("adminUserDetailRaw");

  if (titleEl) titleEl.textContent = name;
  if (subtitleEl) subtitleEl.textContent = email;
  if (avatarEl) avatarEl.textContent = avatarText || "U";
  if (summaryEl) {
    summaryEl.innerHTML = `
      <span class="admin-user-plan">${esc(plan)}</span>
      <span class="badge-role ${esc(role)}">${esc(roleLabel)}</span>
      <span class="admin-user-detail-id">ID #${esc(String(userItem.id || "—"))}</span>`;
  }
  if (metaEl) {
    metaEl.innerHTML = [
      renderAdminUserDetailField("Tên hiển thị", name),
      renderAdminUserDetailField("Email", email),
      renderAdminUserDetailField("Gói hiện tại", plan),
      renderAdminUserDetailField("Role", roleLabel),
      renderAdminUserDetailField(
        "Ngày tạo",
        formatAdminUserDateTime(userItem.created_at),
      ),
      renderAdminUserDetailField(
        "Cập nhật gần nhất",
        formatAdminUserDateTime(userItem.updated_at),
      ),
      renderAdminUserDetailField(
        "Số điện thoại",
        userItem.phone || userItem.phone_number || "none",
      ),
      renderAdminUserDetailField("Avatar URL", userItem.avatar_url || "none"),
    ].join("");
  }
  if (rawEl) rawEl.textContent = JSON.stringify(userItem, null, 2);

  modal.classList.remove("hidden");
}

function closeAdminUserDetailModal() {
  document.getElementById("adminUserDetailModal")?.classList.add("hidden");
}

function filterAdminUsers(q) {
  adminUserSearchQuery = String(q || "")
    .trim()
    .toLowerCase();
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
  const pageRows = paginateAdminRows(
    getFilteredAdminUsers(),
    adminUserPage,
  ).rows;
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
  const verificationStatus =
    String(verifyInput?.value || "verified").trim() || "verified";
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
  const verificationStatus =
    String(verifyInput?.value || "verified").trim() || "verified";
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
      title: willEnable
        ? "Domain đã được kích hoạt"
        : "Domain đã được tạm dừng",
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

function getManagedUserRoleLabel(role) {
  const normalizedRole = String(role || "user").trim().toLowerCase();
  if (normalizedRole === "admin") return "Admin";
  if (normalizedRole === "support") return "Hỗ trợ";
  return "User";
}

async function adminSetRole(userId, selectEl) {
  const nextRole = String(selectEl?.value || "")
    .trim()
    .toLowerCase();
  const currentRole = String(selectEl?.dataset?.currentRole || "user")
    .trim()
    .toLowerCase();
  if (!nextRole || nextRole === currentRole) return;
  const targetUser = adminUsers.find((u) => Number(u.id) === Number(userId));
  const confirmed = await showConfirmDialog({
    title: "Cập nhật vai trò người dùng",
    message: `Chuyển ${targetUser?.email || "người dùng này"} sang vai trò "${getManagedUserRoleLabel(nextRole)}"?`,
    note:
      nextRole === "support"
        ? "Vai trò này chỉ dùng để đọc và trả lời hộp thư hỗ trợ."
        : nextRole === "admin"
          ? "Vai trò admin sẽ mở toàn bộ khu vực quản trị."
          : "Vai trò user sẽ quay về quyền sử dụng thông thường.",
    confirmLabel: "Cập nhật vai trò",
  });
  if (!confirmed) {
    if (selectEl) selectEl.value = currentRole;
    return;
  }
  try {
    const r = await fetch("/api/admin/users/" + userId, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: nextRole }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (selectEl) selectEl.value = currentRole;
      throw new Error(data.error || "Không thể cập nhật vai trò");
    }
    const updatedUser = data.user || {};
    if (selectEl) {
      selectEl.dataset.currentRole = String(updatedUser.role || nextRole);
      selectEl.value = String(updatedUser.role || nextRole);
    }
    adminUsers = adminUsers.map((userItem) =>
      Number(userItem.id) === Number(userId)
        ? {
            ...userItem,
            role: updatedUser.role || nextRole,
            plan: updatedUser.plan || userItem.plan,
          }
        : userItem,
    );
    renderAdminUsers();
    toast(`✅ Đã cập nhật role → ${getManagedUserRoleLabel(updatedUser.role || nextRole)}`, "ok");
  } catch (error) {
    if (selectEl) selectEl.value = currentRole;
    toast(error.message || "Không thể cập nhật vai trò", "err");
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
function triggerEditImageUpload() {
  document.getElementById("editOgImageFile")?.click();
}

async function handleEditImageUpload(event) {
  const input = event?.target;
  const file = input?.files?.[0];
  if (!file) return;
  try {
    await uploadImageFileToField(file, {
      inputId: "editOgImage",
      previewId: "editThumbPreview",
      statusId: "editImageUploadStatus",
      onAfterSet: () => updateEditThumbPreview(),
    });
    toast("Upload ảnh xong!", "ok");
  } catch (error) {
    if (error?.status === 401) {
      redirectToAuth("login", "Cần đăng nhập để upload ảnh.");
      return;
    }
    if (error?.status === 403 && error?.payload?.upgrade) {
      toast(error.payload.error || "Tính năng này yêu cầu gói Pro", "warn");
      return;
    }
    setInlineUploadStatus(
      "editImageUploadStatus",
      error?.message || "Upload ảnh thất bại",
      "err",
    );
    toast(error?.message || "Không thể upload ảnh", "err");
  } finally {
    if (input) input.value = "";
  }
}

function openEditModal(linkId) {
  const link =
    links.find((l) => l.id == linkId) || adminLinks.find((l) => l.id == linkId);
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
  document.getElementById("editLinkType").value = link.link_type || "direct";
  document.getElementById("editOgTitle").value = link.og_title || "";
  document.getElementById("editOgDesc").value = link.og_desc || "";
  document.getElementById("editOgImage").value = link.og_image || "";
  setInlineUploadStatus("editImageUploadStatus", "");
  const editImageFileInput = document.getElementById("editOgImageFile");
  if (editImageFileInput) editImageFileInput.value = "";
  document.getElementById("editVideoUrl").value = link.video_url || "";
  document.getElementById("editVideoText").value =
    link.video_overlay_text || "";
  const editPopup3s = document.getElementById("editVideoPopupUrl3s");
  const editPopup5s = document.getElementById("editVideoPopupUrl5s");
  const editPopup300s = document.getElementById("editVideoPopupUrl300s");
  if (editPopup3s) editPopup3s.value = link.video_popup_url_3s || "";
  if (editPopup5s) editPopup5s.value = link.video_popup_url_5s || "";
  if (editPopup300s) editPopup300s.value = link.video_popup_url_300s || "";
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
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          persistGeneratedThumb(dataUrl, "editOgImage", updateEditThumbPreview)
            .then(() => {
              toast("✅ Đã cắt thumbnail từ video!", "ok");
              resolve();
            })
            .catch((e) => reject(e));
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
  const nextLinkType = document.getElementById("editLinkType").value;
  const nextVideoUrl = document.getElementById("editVideoUrl").value.trim();
  errEl.classList.remove("show");
  if (nextLinkType === "video" && !nextVideoUrl) {
    errEl.textContent =
      "Link video cần URL video hoặc upload video trước khi lưu";
    errEl.classList.add("show");
    return;
  }
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
        link_type: nextLinkType,
        video_url: nextVideoUrl,
        video_overlay_text: document
          .getElementById("editVideoText")
          .value.trim(),
        video_popup_url_3s:
          document.getElementById("editVideoPopupUrl3s")?.value.trim() || "",
        video_popup_url_5s:
          document.getElementById("editVideoPopupUrl5s")?.value.trim() || "",
        video_popup_url_300s:
          document.getElementById("editVideoPopupUrl300s")?.value.trim() || "",
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
// Team workspace overrides
function normalizeTeamTemplateSectionCopy() {
  const card = document.getElementById("teamTemplatesCard");
  const count = document.getElementById("teamTemplateCount");
  if (!card || !count) return;
  const titleEl = card.querySelector(".tbl-head h3");
  if (titleEl) {
    titleEl.innerHTML = `Mau link chung (<span id="teamTemplateCount">${count.textContent || "0"}</span>)`;
  }
  const sourceLabel = document.getElementById("teamTemplateSourceLabel");
  const nameLabel = document.getElementById("teamTemplateNameLabel");
  const uploadBtn = document.getElementById("teamTemplateUploadBtn");
  const createBtn = document.getElementById("teamTemplateCreateBtn");
  const personalBtn = document.getElementById("teamTemplateCreatePersonalBtn");
  const formNote = document.getElementById("teamTemplateFormNote");
  const nameInput = document.getElementById("teamTemplateName");
  if (sourceLabel) sourceLabel.textContent = "Chọn link nguồn của bạn";
  if (nameLabel) nameLabel.textContent = "Tên mẫu chung";
  if (uploadBtn) uploadBtn.textContent = "Tải video/ảnh từ máy";
  if (createBtn) createBtn.textContent = "Tạo mẫu chung";
  if (personalBtn) personalBtn.textContent = "Tạo link cá nhân";
  if (nameInput) nameInput.placeholder = "Ví dụ: Template TikTok campaign A";
  if (formNote) {
    formNote.innerHTML =
      "Mẫu chung chỉ khóa nội dung share, kiểu link, video overlay và domain. Editor lấy theo từng link để sửa URL gốc của riêng mình, không ảnh hưởng tới mẫu chung.";
  }
}

function renderTeamMembers(members) {
  const body = document.getElementById("teamMemberBody");
  if (!body) return;

  if (!user) {
    body.innerHTML = `<tr><td colspan="6" class="tbl-empty">Đăng nhập để mời cộng tác viên. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Đăng nhập</a></td></tr>`;
    syncMobileCardTableLabels(body);
    return;
  }

  if (!Array.isArray(members) || !members.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="tbl-empty">Chưa có thành viên nào trong workspace.</td></tr>';
    syncMobileCardTableLabels(body);
    return;
  }

  const canManageMembers = canInviteTeamMembers();
  body.innerHTML = members
    .map((member) => {
      const isOwner = member.role === "owner";
      const isPending = member.status === "pending";
      const nextStatus =
        member.status === "pending"
          ? "active"
          : member.status === "active"
            ? "paused"
            : "active";
      const nextLabel =
        member.status === "pending"
          ? "Kích hoạt"
          : member.status === "active"
            ? "Tạm dừng"
            : "Mở lại";
      const actionMarkup = isOwner
        ? '<button class="btn-cp" disabled>Owner</button>'
        : canManageMembers
          ? `<button class="btn-cp" ${isPending ? "disabled" : ""} onclick="cycleTeamMemberStatus(${Number(member.id)}, '${nextStatus}')">${isPending ? "Chờ user xác nhận" : nextLabel}</button>
             <button class="btn-del" onclick="removeTeamMember(${Number(member.id)})">Xóa</button>`
          : '<span style="color:var(--text3);font-size:12px">Chỉ owner quản lý</span>';
      return `<tr>
      <td>
        <div style="display:flex;flex-direction:column;gap:4px">
          <strong>${esc(member.display_name || member.email || "Member")}</strong>
          <span style="color:var(--text3);font-size:12px">${esc(member.email || "Chưa có email")}</span>
        </div>
      </td>
      <td><span class="badge-role ${isOwner ? "admin" : "user"}">${getRoleLabel(member.role)}</span></td>
      <td>${esc(getStatusLabel(member.status))}</td>
      <td style="max-width:240px;color:var(--text2)">${esc(getRoleFocus(member.role))}</td>
      <td style="color:var(--text3);font-size:12px">${esc(formatTeamDateTime(member.joined_at || member.updated_at || member.created_at, "Chưa tham gia"))}</td>
      <td class="td-actions" style="display:flex;gap:6px;flex-wrap:wrap">${actionMarkup}</td>
    </tr>`;
    })
    .join("");
  syncMobileCardTableLabels(body);
}

function renderTeamTemplates(templates) {
  const body = document.getElementById("teamTemplateBody");
  if (!body) return;

  if (!user) {
    body.innerHTML = `<tr><td colspan="1" class="tbl-empty">Đăng nhập để dùng mẫu liên kết chung. <a href="${buildAuthUrl("login")}" style="color:var(--brand);font-weight:700">Đăng nhập</a></td></tr>`;
    return;
  }

  if (!Array.isArray(templates) || !templates.length) {
    body.innerHTML =
      '<tr><td colspan="1" class="tbl-empty">Chưa có mẫu chung nào. Hãy chọn một liên kết của bạn rồi bấm Tạo mẫu chung.</td></tr>';
    return;
  }

  const canUseTemplates = canUseSharedTemplates();
  body.innerHTML = templates
    .map((template) => {
      const title = template.name || template.og_title || "Template";
      const playableVideoUrl = buildCloudinaryPlayableVideoUrl(template.video_url || "");
      const mediaMarkup = playableVideoUrl
        ? `<div class="team-template-media"><video src="${esc(playableVideoUrl)}" controls preload="metadata" playsinline muted></video></div>`
        : template.og_image
          ? `<div class="team-template-media"><img src="${esc(template.og_image)}" alt="${esc(title)}" /></div>`
          : `<div class="team-template-media"></div>`;
      const downloadVideoButton = playableVideoUrl
        ? `<a class="btn-cp" href="${esc(playableVideoUrl)}" target="_blank" rel="noopener noreferrer" download>Tải video</a>`
        : "";
      const groupedLinks = Array.isArray(template.source_links) && template.source_links.length
        ? template.source_links
        : [
            {
              id: Number(template.source_link_id || 0) || null,
              title: template.og_title || template.name || "Link",
              short_url: template.source_link_short_url || "",
              original_url: template.source_link_original_url || "",
            },
          ];
      const sourcePlatform = groupedLinks[0]?.original_url ? pt(groupedLinks[0].original_url) : "generic";
      const platformLabel = sourcePlatform === "shopee" ? "Shopee" : sourcePlatform === "tiktok" ? "TikTok" : "Generic";
      const canEditTemplate = Number(template.created_by_user_id || 0) === Number(user?.id || 0);
      const templateActionButtons = canEditTemplate
        ? `<button class="btn-cp" onclick="openTeamTemplateModal('edit', ${Number(template.id)})" title="Sửa mẫu">Sửa</button>
           <button class="btn-cp" onclick="deleteTeamTemplate(${Number(template.id)})" title="Xóa mẫu" style="color:var(--red);border-color:rgba(239,68,68,.2)">Xóa</button>`
        : "";
      const groupedLinkMarkup = groupedLinks
        .map((link, index) => {
          const linkId = Number(link.id || 0) || Number(template.source_link_id || 0);
          const useButton = canUseTemplates && linkId > 0
            ? `<button class="btn-cp" onclick="useTeamTemplateSource(${Number(template.id)}, ${linkId})">Lấy link cho tôi</button>`
            : '<span style="color:var(--text3);font-size:12px">Chỉ editor được lấy</span>';
          return `<div class="team-template-link-row">
                <div class="team-template-link-main">
                  <span class="team-template-link-label">Link ${index + 1}</span>
                  <span class="team-template-meta">${esc(link.title || `Link ${index + 1}`)}</span>
                  <span class="team-template-link-value" title="${esc(link.short_url || link.original_url || "Chưa có link rút gọn")}">${esc(link.short_url || link.original_url || "Chưa có link rút gọn")}</span>
                </div>
                <div class="team-template-link-action">${useButton}</div>
              </div>`;
        })
        .join("");
      return `<tr>
      <td colspan="1">
        <div class="team-template-card-shell">
          <div class="team-template-card">
            ${mediaMarkup}
            <div class="team-template-card-copy">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <strong>${esc(title)}</strong>
                ${playableVideoUrl ? '<span class="team-template-flag">Video</span>' : ""}
                <span class="team-template-flag">${platformLabel}</span>
              </div>
              <div class="team-template-link-list">${groupedLinkMarkup}</div>
            </div>
          </div>
          <div class="team-template-card-right">
            <div class="team-template-meta-grid">
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Người tạo</span>
                <span class="team-template-meta">${esc(template.creator_name || "Member")}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Kiểu</span>
                <span class="team-template-meta">${esc(formatTeamTemplateType(template.link_type))}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Domain</span>
                <span class="team-template-meta">${esc(template.domain_hostname || template.preview_domain || location.host)}</span>
              </div>
              <div class="team-template-meta-box">
                <span class="team-template-link-label">Cập nhật</span>
                <span class="team-template-meta muted">${esc(formatTeamDateTime(template.updated_at || template.created_at))}</span>
              </div>
            </div>
            <div class="team-template-actions">
              ${downloadVideoButton ? `<div class="team-template-actions-row">${downloadVideoButton}</div>` : ""}
              ${templateActionButtons ? `<div class="team-template-actions-row">${templateActionButtons}</div>` : ""}
            </div>
          </div>
        </div>
      </td>
    </tr>`;
    })
    .join("");
}

function renderTeamWorkspaceSummary() {
  const workspace = teamWorkspaceData?.workspace || null;
  const membership = teamWorkspaceData?.membership || null;
  const members = Array.isArray(teamWorkspaceData?.members) ? teamWorkspaceData.members : [];
  const sourceLinks = Array.isArray(teamWorkspaceData?.source_links) ? teamWorkspaceData.source_links : [];
  const templates = Array.isArray(teamWorkspaceData?.templates) ? teamWorkspaceData.templates : [];
  const seatLimit = getTeamSeatLimit();
  const activeCount = members.filter((member) => member.status === "active").length;
  const pendingCount = members.filter((member) => member.status === "pending").length;
  const ownerMember = members.find((member) => member.role === "owner");
  const canManageMembers = canInviteTeamMembers();
  const canCreateTemplates = canCreateSharedTemplates();
  const canUseTemplates = canUseSharedTemplates();
  const pendingInvitation = hasPendingTeamInvitation();

  const seatCount = document.getElementById("teamSeatCount");
  const seatHint = document.getElementById("teamSeatHint");
  const activeEl = document.getElementById("teamActiveCount");
  const pendingEl = document.getElementById("teamPendingCount");
  const workspaceName = document.getElementById("teamWorkspaceName");
  const workspaceStatus = document.getElementById("teamWorkspaceStatus");
  const ownerLabel = document.getElementById("teamOwnerLabel");
  const inviteControls = document.getElementById("teamInviteControls");
  const inviteHint = document.getElementById("teamInviteHint");
  const inviteBtn = document.getElementById("teamInviteBtn");
  const inviteEmail = document.getElementById("teamInviteEmail");
  const inviteRole = document.getElementById("teamInviteRole");
  const domainLabel = document.getElementById("teamDomainLabel");
  const templateCount = document.getElementById("teamTemplateCount");
  const templateHint = document.getElementById("teamTemplateHint");
  const templateSourceTrigger = document.getElementById("teamTemplateSourceTrigger");
  const templateSourceDropdown = document.getElementById("teamTemplateSourceDropdown");
  const templateSourcePicker = document.getElementById("teamTemplateSourcePicker");
  const templateSourceStatus = document.getElementById("teamTemplateSourceStatus");
  const templateUploadStatus = document.getElementById("teamTemplateUploadStatus");
  const templateName = document.getElementById("teamTemplateName");
  const templateCreateBtn = document.getElementById("teamTemplateCreateBtn");
  const invitationBanner = document.getElementById("teamInvitationBanner");
  const membersCard = document.getElementById("teamMembersCard");
  const templatesCard = document.getElementById("teamTemplatesCard");

  if (seatCount) {
    seatCount.textContent = pendingInvitation ? "Chờ" : `${members.length}/${seatLimit}`;
  }
  if (seatHint) {
    seatHint.textContent = pendingInvitation
      ? "Lời mời workspace"
      : workspace
        ? `${membership?.role === "owner" ? "Owner" : getRoleLabel(membership?.role)} · ${user?.plan || "free"} workspace`
        : "Workspace cá nhân";
  }
  if (activeEl) activeEl.textContent = pendingInvitation ? 0 : activeCount;
  if (pendingEl) pendingEl.textContent = pendingInvitation ? 1 : pendingCount;
  if (workspaceName) {
    workspaceName.textContent = workspace?.name || (user ? `${getUserDisplayName(user)} Workspace` : "Workspace");
  }
  if (workspaceStatus) {
    workspaceStatus.textContent = pendingInvitation
      ? `Bạn đang có lời mời với quyền ${getRoleLabel(membership?.role)}`
      : workspace
        ? `Seat đang dùng ${members.length}/${seatLimit} · Quyền của bạn ${getRoleLabel(membership?.role)}`
        : "Đăng nhập để mở workspace và cộng tác theo team.";
  }
  if (ownerLabel) {
    ownerLabel.textContent = ownerMember
      ? `Owner: ${ownerMember.display_name || ownerMember.email}`
      : "Owner: chưa xác định";
  }
  if (inviteControls) {
    inviteControls.style.display = !pendingInvitation && canManageMembers ? "" : "none";
  }
  if (inviteHint) {
    inviteHint.textContent = !user
      ? "Đăng nhập để mời cộng tác viên và tạo workspace thật trên server."
      : canManageMembers
        ? "Chỉ owner đang hoạt động mới được mời thành viên."
        : "Bạn không được mời thành viên ở workspace này.";
  }
  if (inviteBtn) inviteBtn.disabled = !canManageMembers;
  if (inviteEmail) inviteEmail.disabled = !canManageMembers;
  if (inviteRole) inviteRole.disabled = !canManageMembers;
  if (domainLabel) {
    domainLabel.textContent =
      templates[0]?.domain_hostname || sourceLinks[0]?.domain_hostname || location.host || "boclink.click";
  }
  if (templateCount) templateCount.textContent = String(templates.length);
  if (templateHint) {
    templateHint.textContent = canCreateTemplates
      ? "Chọn link của riêng bạn để chụp snapshot metadata chung cho team"
      : canUseTemplates
        ? "Editor lấy theo từng link để sửa URL gốc của riêng mình"
        : "Chỉ editor đang hoạt động mới được lấy link từ mẫu chung";
  }

  selectedTeamTemplateSourceIds = selectedTeamTemplateSourceIds.filter((id) =>
    sourceLinks.some((link) => Number(link.id) === Number(id)),
  );
  const selectedSourceLinks = getSelectedTeamTemplateSourceLinks(sourceLinks);
  const mediaEligibleLinks = selectedSourceLinks.filter((link) => !!(link.video_url || link.og_image));
  if (selectedTeamTemplateMediaLinkId && !mediaEligibleLinks.some((link) => Number(link.id) === Number(selectedTeamTemplateMediaLinkId))) {
    selectedTeamTemplateMediaLinkId = null;
  }
  if (!selectedTeamTemplateMediaLinkId && mediaEligibleLinks.length) {
    selectedTeamTemplateMediaLinkId = Number(mediaEligibleLinks[0].id);
  }

  if (templateSourceTrigger) {
    const triggerLabel = selectedSourceLinks.length
      ? selectedSourceLinks
          .slice(0, 2)
          .map((link) => link.og_title || link.alias || link.short_code || `Link #${link.id}`)
          .join(" · ")
      : "Chọn tối đa 5 link nguồn";
    const suffix = selectedSourceLinks.length > 2 ? ` +${selectedSourceLinks.length - 2}` : "";
    templateSourceTrigger.textContent = `${triggerLabel}${suffix}`;
    templateSourceTrigger.disabled = !canCreateTemplates || !sourceLinks.length;
    templateSourceTrigger.classList.toggle("open", isTeamTemplateSourceDropdownOpen);
  }
  if (templateSourceDropdown) {
    templateSourceDropdown.classList.toggle("hidden", !isTeamTemplateSourceDropdownOpen);
  }
  if (templateSourcePicker) {
    if (!sourceLinks.length) {
      templateSourcePicker.innerHTML =
        '<div class="tbl-empty" style="padding:12px 4px">Chưa có link nguồn nào để tạo mẫu chung.</div>';
      closeTeamTemplateSourceDropdown();
    } else {
      templateSourcePicker.innerHTML = sourceLinks
        .map((link) => {
          const primary = link.og_title || link.alias || link.short_code || `Link #${link.id}`;
          const secondary = link.original_url || "";
          const selected = selectedTeamTemplateSourceIds.includes(Number(link.id));
          const disabled = !selected && selectedTeamTemplateSourceIds.length >= 5;
          return `<label class="team-template-source-item ${selected ? "active" : ""} ${disabled || !canCreateTemplates ? "disabled" : ""}">
            <input type="checkbox" ${selected ? "checked" : ""} ${disabled || !canCreateTemplates ? "disabled" : ""} onchange="toggleTeamTemplateSourceSelection(${Number(link.id)})" />
            <span class="team-template-source-copy">
              <span class="team-template-source-primary">${link.video_url ? "[Video] " : ""}${esc(primary)}</span>
              <span class="team-template-source-secondary" title="${esc(secondary || "Không có link gốc")}">${esc(secondary || "Không có link gốc")}</span>
            </span>
          </label>`;
        })
        .join("");
    }
  }
  if (templateSourceStatus) {
    templateSourceStatus.textContent = sourceLinks.length
      ? `Đã chọn ${selectedTeamTemplateSourceIds.length}/5 link. Media sẽ tự lấy từ link đầu tiên có preview, hoặc file upload.`
      : "Chọn tối đa 5 link để gom vào cùng 1 mẫu chia sẻ.";
  }
  if (templateUploadStatus) {
    if (uploadedTeamTemplateMedia?.url) {
      templateUploadStatus.textContent = `Đang dùng media tải từ máy: ${uploadedTeamTemplateMedia.name || "media mới"}`;
    } else if (selectedTeamTemplateMediaLinkId) {
      const mediaSource = mediaEligibleLinks.find((link) => Number(link.id) === Number(selectedTeamTemplateMediaLinkId));
      const mediaName = mediaSource?.og_title || mediaSource?.alias || mediaSource?.short_code || `Link #${selectedTeamTemplateMediaLinkId}`;
      templateUploadStatus.textContent = `Media sẽ lấy từ link đã chọn: ${mediaName}`;
    } else {
      templateUploadStatus.textContent = "Media sẽ tự lấy từ link đã tick nếu có preview, hoặc bạn có thể tải file riêng từ máy.";
    }
  }
  if (templateName) templateName.disabled = !canCreateTemplates;
  if (templateCreateBtn) templateCreateBtn.disabled = !canCreateTemplates || !sourceLinks.length;

  syncTeamTemplateComposer();
  if (membersCard) {
    membersCard.style.display = pendingInvitation ? "none" : "";
  }
  if (templatesCard) {
    templatesCard.style.display = pendingInvitation ? "none" : "";
  }
  if (invitationBanner) {
    if (!pendingInvitation || !workspace || !membership) {
      invitationBanner.style.display = "none";
      invitationBanner.innerHTML = "";
    } else {
      invitationBanner.style.display = "block";
      invitationBanner.innerHTML = `
              <div class="tbl-card">
                <div class="card-p" style="display:flex;gap:16px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap">
                  <div style="display:flex;flex-direction:column;gap:6px;min-width:260px">
                    <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand)">Lời mời workspace</div>
                    <div style="font-size:22px;font-weight:800;color:var(--text)">${esc(workspace.name || "Workspace")}</div>
                    <div style="font-size:13px;color:var(--text2)">Owner: ${esc(ownerMember?.display_name || ownerMember?.email || "Workspace owner")}</div>
                    <div style="font-size:13px;color:var(--text2)">Vai trò được mời: ${esc(getRoleLabel(membership.role))}</div>
                    <div style="font-size:13px;color:var(--text3)">Bạn chưa vào workspace này. Hãy đồng ý hoặc từ chối lời mời trước khi xem dữ liệu chung.</div>
                  </div>
                  <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
                    <button class="user-btn secondary" type="button" onclick="declineTeamInvitation()">Từ chối</button>
                    <button class="user-btn primary" type="button" onclick="acceptTeamInvitation()">Đồng ý tham gia</button>
                  </div>
                </div>
              </div>`;
    }
  }
}

async function renderTeamPage() {
  normalizeTeamTemplateSectionCopy();
  renderTeamMembers([]);
  renderTeamTemplates([]);
  renderTeamWorkspaceSummary();
  const body = document.getElementById("teamMemberBody");
  const templateBody = document.getElementById("teamTemplateBody");
  if (user && body) {
    body.innerHTML = '<tr><td colspan="6" class="tbl-empty">Đang tải team workspace...</td></tr>';
  }
  if (user && templateBody) {
    templateBody.innerHTML = '<tr><td colspan="1" class="tbl-empty">Đang tải mẫu link chung...</td></tr>';
  }
  await loadTeamWorkspace({ silent: true });
  renderTeamWorkspaceSummary();
  renderTeamMembers(teamWorkspaceData?.members || []);
  renderTeamTemplates(teamWorkspaceData?.templates || []);
}

function toggleTeamTemplateSourceSelection(linkId) {
  const normalizedId = Number(linkId);
  if (!Number.isInteger(normalizedId) || normalizedId < 1) return;
  const selected = new Set(selectedTeamTemplateSourceIds.map((id) => Number(id)));
  if (selected.has(normalizedId)) {
    selected.delete(normalizedId);
  } else {
    if (selected.size >= 5) {
      toast("Chỉ được chọn tối đa 5 link cho mỗi lần tạo mẫu.", "warn");
      return;
    }
    selected.add(normalizedId);
  }
  selectedTeamTemplateSourceIds = [...selected];
  renderTeamWorkspaceSummary();
}

async function createTeamTemplate() {
  if (!user) {
    redirectToAuth("register", "Đăng nhập để tạo mẫu chung.");
    return;
  }
  if (!canCreateSharedTemplates()) {
    toast("Vai trò hiện tại chưa thể tạo mẫu chung.", "warn");
    return;
  }
  const sourceInput = document.getElementById("teamTemplateSourceTrigger");
  const nameInput = document.getElementById("teamTemplateName");
  const selectedSourceLinkIds = [...selectedTeamTemplateSourceIds];
  const name = String(nameInput?.value || "").trim();
  if (!selectedSourceLinkIds.length) {
    toast("Chọn ít nhất một link nguồn trước khi tạo mẫu.", "warn");
    sourceInput?.focus();
    return;
  }
  if (selectedSourceLinkIds.length > 5) {
    toast("Chỉ được chọn tối đa 5 link cho mỗi lần tạo mẫu.", "warn");
    sourceInput?.focus();
    return;
  }
  try {
    const response = await fetch("/api/team/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source_link_ids: selectedSourceLinkIds,
        uploaded_media_kind: uploadedTeamTemplateMedia?.kind || null,
        uploaded_media_url: uploadedTeamTemplateMedia?.url || null,
        uploaded_media_thumb: uploadedTeamTemplateMedia?.image || null,
        name,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Không thể tạo mẫu chung");
    }
    setTeamWorkspaceData(data);
    if (nameInput) nameInput.value = "";
    selectedTeamTemplateSourceIds = [];
    selectedTeamTemplateMediaLinkId = null;
    uploadedTeamTemplateMedia = null;
    editingTeamTemplateId = null;
    closeTeamTemplateSourceDropdown();
    renderTeamWorkspaceSummary();
    renderTeamMembers(teamWorkspaceData?.members || []);
    renderTeamTemplates(teamWorkspaceData?.templates || []);
    syncTeamTemplateComposer();
    toast("Đã tạo mẫu chung cho workspace.", "ok");
  } catch (error) {
    toast(error.message || "Không thể tạo mẫu chung", "warn");
  }
}

function syncTeamTemplateComposer() {
  const nameInput = document.getElementById("teamTemplateName");
  const createBtn = document.getElementById("teamTemplateCreateBtn");
  const uploadBtn = document.getElementById("teamTemplateUploadBtn");
  const personalBtn = document.getElementById("teamTemplateCreatePersonalBtn");
  const isEditing = Number(editingTeamTemplateId || 0) > 0;
  if (createBtn) {
    createBtn.textContent = isEditing ? "Lưu mẫu" : "Tạo mẫu chung";
  }
  if (uploadBtn) {
    uploadBtn.textContent = "Tải video/ảnh từ máy";
  }
  if (personalBtn) {
    personalBtn.textContent = isEditing ? "Hủy sửa" : "Tạo link cá nhân";
    personalBtn.onclick = () => {
      if (isEditing) {
        cancelEditTeamTemplate();
        return;
      }
      clearTeamTemplateDraft(true);
      navigate("create");
    };
  }
  if (isEditing && nameInput && !nameInput.value) nameInput.focus();
}

function buildPersonalTeamTemplateDraft(template, sourceLink) {
  return {
    id: template.id,
    name: template.name,
    creator_name: template.creator_name,
    source_link_id: Number(sourceLink?.id || template.source_link_id || 0) || null,
    source_link_label: sourceLink?.title || template.name || "Link",
    original_url: sourceLink?.original_url || "",
    og_title: template.og_title || "",
    og_desc: template.og_desc || "",
    og_image: template.og_image || "",
    link_type: template.link_type || "direct",
    video_url: template.video_url || "",
    video_overlay_text: template.video_overlay_text || "",
    domain_hostname: template.domain_hostname || "",
  };
}

function useTeamTemplateSource(templateId, sourceLinkId) {
  if (!user) {
    redirectToAuth("register", "Đăng nhập để lấy link từ mẫu chung.");
    return;
  }
  if (!canUseSharedTemplates()) {
    toast("Chỉ editor đang hoạt động mới được lấy link từ mẫu chung.", "warn");
    return;
  }
  const template = findTeamTemplateById(templateId);
  if (!template) {
    toast("Không tìm thấy mẫu link chung.", "warn");
    return;
  }
  const groupedLinks = Array.isArray(template.source_links) ? template.source_links : [];
  const selectedSource = groupedLinks.find((link) => Number(link.id) === Number(sourceLinkId)) || groupedLinks[0] || {
    id: template.source_link_id,
    title: template.og_title || template.name || "Link",
    original_url: template.source_link_original_url || "",
  };
  openTeamTemplateModal("use", template.id, selectedSource.id);
}

function useTeamTemplate(templateId) {
  const template = findTeamTemplateById(templateId);
  const firstSourceId = Number(template?.source_links?.[0]?.id || template?.source_link_id || 0);
  if (!template || !firstSourceId) {
    toast("Không tìm thấy link nguồn trong mẫu chung.", "warn");
    return;
  }
  useTeamTemplateSource(templateId, firstSourceId);
}

document.addEventListener("click", (event) => {
  const trigger = document.getElementById("teamTemplateSourceTrigger");
  const dropdown = document.getElementById("teamTemplateSourceDropdown");
  if (!trigger || !dropdown || !isTeamTemplateSourceDropdownOpen) return;
  if (trigger.contains(event.target) || dropdown.contains(event.target)) return;
  closeTeamTemplateSourceDropdown();
});

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
    applyAppLanguage(appLanguage);
    if (!shouldUseAppShell(location.pathname)) {
      window.location.replace("/");
      return;
    }
    updateIntegrationUI();
    await loadAvailableDomains();
    const authMode = getAuthRouteMode();
    const r = await fetch("/api/auth/me");
    const d = await r.json();
    if (d.user) {
      user = d.user;
      showApp();
    } else {
      if (isDirectAppPath(location.pathname)) {
        redirectToLoginPage(location.pathname);
        return;
      }
      showAuthScreen(authMode);
    }
  } catch {
    if (isDirectAppPath(location.pathname)) {
      redirectToLoginPage(location.pathname);
      return;
    }
    showAuthScreen(getAuthRouteMode());
  }
})();


