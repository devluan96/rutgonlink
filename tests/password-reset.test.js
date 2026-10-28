const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildPasswordResetEmail,
  createPasswordResetToken,
  hashPasswordResetToken,
  resolvePasswordResetBaseUrl,
  sendPasswordResetEmail,
} = require('../api/passwordReset');

test('password reset tokens are random and only their hash is persisted', () => {
  const first = createPasswordResetToken();
  const second = createPasswordResetToken();
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.match(hashPasswordResetToken(first), /^[a-f0-9]{64}$/);
  assert.notEqual(hashPasswordResetToken(first), first);
});

test('password reset email escapes user content and links to the configured origin', () => {
  const email = buildPasswordResetEmail({
    baseUrl: 'https://boclink.click/',
    token: 'safe_token',
    name: '<img src=x onerror=alert(1)>',
  });
  assert.equal(email.resetUrl, 'https://boclink.click/reset-password?token=safe_token');
  assert.doesNotMatch(email.html, /<img src=x/);
  assert.match(email.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(email.text, /https:\/\/boclink\.click\/reset-password\?token=safe_token/);
});

test('password reset links use localhost during development without trusting arbitrary hosts', () => {
  assert.equal(
    resolvePasswordResetBaseUrl({
      configuredBaseUrl: 'https://boclink.click',
      requestProtocol: 'http',
      requestHost: 'localhost:3000',
      isProduction: false,
    }),
    'http://localhost:3000',
  );
  assert.equal(
    resolvePasswordResetBaseUrl({
      configuredBaseUrl: 'https://boclink.click',
      requestProtocol: 'https',
      requestHost: 'attacker.example',
      isProduction: false,
    }),
    'https://boclink.click',
  );
  assert.equal(
    resolvePasswordResetBaseUrl({
      configuredBaseUrl: 'https://boclink.click',
      requestProtocol: 'http',
      requestHost: 'localhost:3000',
      isProduction: true,
    }),
    'https://boclink.click',
  );
});

test('Resend request keeps the API key in the Authorization header', async () => {
  let captured;
  const fakeFetch = async (url, options) => {
    captured = { url, options };
    return { ok: true, json: async () => ({ id: 'email_123' }) };
  };

  const result = await sendPasswordResetEmail({
    apiKey: 're_test_key',
    from: 'BocLink <no-reply@boclink.click>',
    to: 'member@example.com',
    baseUrl: 'https://boclink.click',
    token: 'safe_token',
    name: 'Thành viên',
    fetchImpl: fakeFetch,
  });

  assert.equal(result.id, 'email_123');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.options.headers.Authorization, 'Bearer re_test_key');
  assert.doesNotMatch(captured.options.body, /re_test_key/);
});

test('migration protects reset tokens and exposes service-role-only RPCs', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20261028_add_password_resets.sql'),
    'utf8',
  );
  assert.match(migration, /CREATE TABLE IF NOT EXISTS password_reset_tokens/i);
  assert.match(migration, /token_hash\s+TEXT\s+NOT NULL\s+UNIQUE/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION consume_password_reset_token/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION consume_password_reset_token[^;]+service_role/i);
});

test('auth routes expose request and consume endpoints without email enumeration', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  assert.match(source, /app\.post\("\/api\/auth\/password-reset-requests"/);
  assert.match(source, /app\.post\("\/api\/auth\/password-resets"/);
  assert.match(source, /Nếu địa chỉ email này đã đăng ký/i);
});

test('recovery and legal pages expose the expected user-facing routes', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
  const login = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'user', 'login', 'index.html'),
    'utf8',
  );
  const requestPage = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'user', 'forgot-password', 'index.html'),
    'utf8',
  );
  const resetPage = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'user', 'reset-password', 'index.html'),
    'utf8',
  );
  assert.match(source, /\["\/forgot-password", "\/forgot-password\/"\]/);
  assert.match(source, /\["\/reset-password", "\/reset-password\/"\]/);
  assert.match(login, /href="\/forgot-password"/);
  assert.match(requestPage, /data-reset-mode="request"/);
  assert.match(resetPage, /data-reset-mode="reset"/);
  assert.match(login, /href="\/terms"/);
  assert.match(login, /href="\/privacy"/);
});
