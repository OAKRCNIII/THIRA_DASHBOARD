// ─── Simple client-side login gate ───
// User: OAK_THIRA / Pass hash (sha256 of 'RCN2026')
// Session 30 days in localStorage
// Note: client-side only — กันคนแอบดูทั่วไป ไม่ใช่ security ระดับ enterprise

(function() {
  const USER = 'OAK_THIRA';
  const PASS_HASH = 'dcd66616d86e5c5c34d39fbc238f021cffe502c329e70e16d7f4057742ef1ff0';
  const SESSION_KEY = 'thira_auth_session_v1';
  const SESSION_DAYS = 30;

  async function sha256(s) {
    const buf = new TextEncoder().encode(s);
    const hashBuf = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function isLoggedIn() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || '{}');
      if (!s.t) return false;
      return (Date.now() - s.t) < SESSION_DAYS * 24 * 3600 * 1000;
    } catch { return false; }
  }
  function setSession() { localStorage.setItem(SESSION_KEY, JSON.stringify({t: Date.now()})); }
  function logout() { localStorage.removeItem(SESSION_KEY); location.reload(); }
  window.thiraLogout = logout;

  if (isLoggedIn()) {
    // เพิ่มปุ่ม logout เล็กๆ มุมขวาบนตอน DOMContentLoaded
    document.addEventListener('DOMContentLoaded', () => {
      const btn = document.createElement('button');
      btn.textContent = '↪ ออกจากระบบ';
      btn.style.cssText = 'position:fixed;top:10px;right:10px;z-index:9998;padding:5px 10px;font-size:11px;font-family:Sarabun,sans-serif;background:rgba(0,0,0,0.1);border:0;border-radius:4px;cursor:pointer;color:#666';
      btn.onmouseover = () => btn.style.background = 'rgba(220,38,38,0.15)';
      btn.onmouseout = () => btn.style.background = 'rgba(0,0,0,0.1)';
      btn.onclick = () => { if (confirm('ออกจากระบบ?')) logout(); };
      document.body.appendChild(btn);
    });
    return;
  }

  // ไม่ได้ login → block + show login overlay
  document.documentElement.style.overflow = 'hidden';

  const overlayHTML = `
    <div id="auth-overlay" style="position:fixed;inset:0;background:linear-gradient(135deg,#1e3a5f 0%,#2c5282 100%);z-index:99999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Sarabun,sans-serif;">
      <div style="background:white;padding:32px 40px;border-radius:16px;box-shadow:0 25px 70px rgba(0,0,0,0.4);width:400px;max-width:100%;text-align:center;">
        <div style="font-size:54px;margin-bottom:6px">🚛</div>
        <h2 style="margin:0;color:#1e3a5f;font-size:22px">THIRA Dashboard</h2>
        <p style="color:#666;margin:6px 0 22px;font-size:14px">เข้าสู่ระบบเพื่อใช้งาน</p>
        <form id="auth-form" style="display:flex;flex-direction:column;gap:10px">
          <input id="auth-user" type="text" autocomplete="username" required placeholder="Username"
            style="font-family:inherit;font-size:15px;padding:12px 14px;border:1.5px solid #d1d5db;border-radius:8px;text-align:center;outline:none">
          <input id="auth-pass" type="password" autocomplete="current-password" required placeholder="Password"
            style="font-family:inherit;font-size:15px;padding:12px 14px;border:1.5px solid #d1d5db;border-radius:8px;text-align:center;outline:none">
          <div id="auth-err" style="color:#dc2626;font-size:13px;font-weight:600;display:none">❌ Username หรือ Password ไม่ถูกต้อง</div>
          <button type="submit" style="font-family:inherit;padding:13px;border:0;border-radius:8px;background:#1e3a5f;color:white;font-weight:700;font-size:15px;cursor:pointer;margin-top:4px">เข้าสู่ระบบ</button>
        </form>
        <p style="color:#999;font-size:11px;margin-top:18px">session อยู่ได้ ${SESSION_DAYS} วัน</p>
      </div>
    </div>
  `;

  function mount() {
    document.body.insertAdjacentHTML('beforeend', overlayHTML);
    const userInp = document.getElementById('auth-user');
    const passInp = document.getElementById('auth-pass');
    const err = document.getElementById('auth-err');
    [userInp, passInp].forEach(i => {
      i.addEventListener('focus', () => i.style.borderColor = '#2c5282');
      i.addEventListener('blur', () => i.style.borderColor = '#d1d5db');
    });
    document.getElementById('auth-form').addEventListener('submit', async e => {
      e.preventDefault();
      const user = userInp.value.trim();
      const pass = passInp.value;
      const hash = await sha256(pass);
      if (user === USER && hash === PASS_HASH) {
        setSession();
        document.getElementById('auth-overlay').remove();
        document.documentElement.style.overflow = '';
      } else {
        err.style.display = 'block';
        passInp.value = '';
        passInp.focus();
      }
    });
    setTimeout(() => userInp.focus(), 80);
  }

  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
