(() => {
  const root = document.getElementById('passwordResetPage');
  const form = document.getElementById('passwordResetForm');
  const message = document.getElementById('passwordResetMessage');
  if (!root || !form || !message) return;

  const mode = root.dataset.resetMode === 'reset' ? 'reset' : 'request';
  const submit = form.querySelector('button[type="submit"]');

  const showMessage = (text, type = 'error') => {
    message.textContent = text;
    message.className = `auth-status auth-status--${type}`;
    message.hidden = !text;
    if (text) message.focus({ preventScroll: true });
  };

  const setBusy = (busy) => {
    submit.disabled = busy;
    form.querySelectorAll('input, button').forEach((control) => {
      control.disabled = busy;
    });
    submit.textContent = busy
      ? 'Đang xử lý...'
      : mode === 'reset'
        ? 'Lưu mật khẩu mới'
        : 'Gửi liên kết đặt lại';
  };

  document.querySelectorAll('[data-password-target]').forEach((toggle) => {
    const input = document.getElementById(toggle.dataset.passwordTarget || '');
    if (!input) return;
    toggle.addEventListener('click', () => {
      const shouldShow = input.type === 'password';
      input.type = shouldShow ? 'text' : 'password';
      toggle.textContent = shouldShow ? 'Ẩn' : 'Hiện';
      toggle.setAttribute('aria-label', shouldShow ? 'Ẩn mật khẩu' : 'Hiện mật khẩu');
      toggle.setAttribute('aria-pressed', String(shouldShow));
      input.focus({ preventScroll: true });
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    showMessage('');
    const payload = {};
    let endpoint = '/api/auth/password-reset-requests';

    if (mode === 'request') {
      const email = document.getElementById('resetEmail');
      if (!email.validity.valid) {
        showMessage('Nhập một địa chỉ email hợp lệ.');
        email.focus();
        return;
      }
      payload.email = email.value.trim();
    } else {
      const token = new URLSearchParams(window.location.search).get('token') || '';
      const password = document.getElementById('newPassword');
      const confirmation = document.getElementById('confirmPassword');
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
        showMessage('Liên kết đặt lại không hợp lệ hoặc đã hết hạn.');
        return;
      }
      if (password.value.length < 8) {
        showMessage('Mật khẩu mới cần ít nhất 8 ký tự.');
        password.focus();
        return;
      }
      if (password.value !== confirmation.value) {
        showMessage('Hai mật khẩu chưa trùng khớp.');
        confirmation.focus();
        return;
      }
      endpoint = '/api/auth/password-resets';
      payload.token = token;
      payload.password = password.value;
    }

    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Không thể xử lý yêu cầu.');
      showMessage(data.message || 'Yêu cầu đã được xử lý.', 'success');
      if (mode === 'request') form.reset();
      if (mode === 'reset') {
        form.hidden = true;
        document.getElementById('resetSuccessAction').hidden = false;
        window.history.replaceState({}, document.title, '/reset-password');
      }
    } catch (error) {
      showMessage(error?.message || 'Không thể kết nối máy chủ.');
    } finally {
      setBusy(false);
    }
  });
})();
