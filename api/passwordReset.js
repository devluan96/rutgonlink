const crypto = require('node:crypto');

const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

function createPasswordResetToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function normalizeHttpOrigin(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.origin;
  } catch (_) {
    return '';
  }
}

function resolvePasswordResetBaseUrl({
  configuredBaseUrl,
  requestProtocol,
  requestHost,
  isProduction,
}) {
  const configuredOrigin = normalizeHttpOrigin(configuredBaseUrl);
  if (!isProduction) {
    const protocol = requestProtocol === 'https' ? 'https' : 'http';
    const requestOrigin = normalizeHttpOrigin(`${protocol}://${requestHost || ''}`);
    if (requestOrigin) {
      const hostname = new URL(requestOrigin).hostname.toLowerCase();
      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
        return requestOrigin;
      }
    }
  }
  if (!configuredOrigin) throw new Error('PASSWORD_RESET_BASE_URL_INVALID');
  return configuredOrigin;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildPasswordResetEmail({ baseUrl, token, name }) {
  const resetUrl = new URL('/reset-password', baseUrl);
  resetUrl.searchParams.set('token', token);
  const safeName = escapeHtml(name || 'bạn');
  const safeResetUrl = escapeHtml(resetUrl.toString());
  const text = [
    `Xin chào ${name || 'bạn'},`,
    '',
    'BocLink nhận được yêu cầu đặt lại mật khẩu cho tài khoản của bạn.',
    `Mở liên kết sau trong vòng 30 phút: ${resetUrl}`,
    '',
    'Nếu bạn không yêu cầu thay đổi này, hãy bỏ qua email.',
  ].join('\n');
  const html = `<!doctype html>
<html lang="vi"><body style="margin:0;background:#f3f6fc;font-family:Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:40px 20px">
    <div style="background:#ffffff;border:1px solid #dbe3f0;border-radius:20px;padding:32px">
      <p style="margin:0 0 20px;font-weight:700;color:#3b82f6">BocLink</p>
      <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2">Đặt lại mật khẩu</h1>
      <p style="margin:0 0 14px;line-height:1.6">Xin chào ${safeName},</p>
      <p style="margin:0 0 24px;line-height:1.6;color:#475569">Liên kết bên dưới chỉ dùng được một lần và hết hạn sau 30 phút.</p>
      <p style="margin:0 0 24px"><a href="${safeResetUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#3b82f6;color:#ffffff;text-decoration:none;font-weight:700">Tạo mật khẩu mới</a></p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">Nếu bạn không yêu cầu thay đổi này, hãy bỏ qua email. Mật khẩu hiện tại vẫn được giữ nguyên.</p>
    </div>
  </div>
</body></html>`;
  return { resetUrl: resetUrl.toString(), subject: 'Đặt lại mật khẩu BocLink', text, html };
}

async function sendPasswordResetEmail({
  apiKey,
  from,
  to,
  baseUrl,
  token,
  name,
  fetchImpl = fetch,
}) {
  if (!apiKey || !from) throw new Error('PASSWORD_RESET_EMAIL_NOT_CONFIGURED');
  const email = buildPasswordResetEmail({ baseUrl, token, name });
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': `password-reset/${hashPasswordResetToken(token)}`,
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || typeof data.id !== 'string') {
    throw new Error('PASSWORD_RESET_EMAIL_FAILED');
  }
  return { id: data.id };
}

module.exports = {
  PASSWORD_RESET_TTL_MS,
  buildPasswordResetEmail,
  createPasswordResetToken,
  hashPasswordResetToken,
  resolvePasswordResetBaseUrl,
  sendPasswordResetEmail,
};
