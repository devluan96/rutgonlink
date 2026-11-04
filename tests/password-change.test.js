const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('authenticated users can change their password and revoke existing sessions', () => {
  const source = fs.readFileSync(path.join(root, 'api', 'index.js'), 'utf8');
  const database = fs.readFileSync(path.join(root, 'api', 'db.js'), 'utf8');

  assert.match(
    source,
    /app\.patch\("\/api\/auth\/password", requireAuth, async \(req, res\) =>/,
  );
  assert.match(
    source,
    /bcrypt\.compare\(\s*currentPassword,\s*currentUser\.password,?\s*\)/,
  );
  assert.match(source, /bcrypt\.hash\(newPassword, 12\)/);
  assert.match(source, /newPassword\.length < 8/);
  assert.match(source, /newPassword === currentPassword/);
  assert.match(source, /allowPasswordChangeAttempt\(req, currentUser\.id\)/);
  assert.match(source, /database\.changeUserPassword\(/);
  assert.match(source, /res\.clearCookie\("token", AUTH_COOKIE_OPTIONS\)/);

  assert.match(database, /async changeUserPassword\(userId, passwordHash, revokedAt/);
  assert.match(database, /password: passwordHash/);
  assert.match(database, /session_revoked_after: revokedAt/);
});

test('account security UI exposes and submits a password change form', () => {
  const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
  const client = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

  assert.match(html, /id="accountCurrentPassword"/);
  assert.match(html, /id="accountNewPassword"/);
  assert.match(html, /id="accountConfirmPassword"/);
  assert.match(html, /onsubmit="changeAccountPassword\(event\)"/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);

  assert.match(client, /async function changeAccountPassword\(event\)/);
  assert.match(client, /fetch\("\/api\/auth\/password"/);
  assert.match(client, /current_password: currentPassword/);
  assert.match(client, /new_password: newPassword/);
  assert.match(client, /newPassword !== confirmPassword/);
  assert.match(client, /function getAccountPasswordChangeErrorMessage\(error\)/);
  assert.match(client, /failed to fetch\|networkerror\|load failed/i);
  assert.match(client, /Không thể kết nối tới máy chủ/);
});
