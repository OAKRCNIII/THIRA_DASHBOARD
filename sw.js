// ─────────────────────────────────────────────────────────────
// THIRA Service Worker
// ─────────────────────────────────────────────────────────────
// หน้าที่:
//   1. ทำให้ PWA install ได้ (browser requirement — Android Chrome)
//   2. Cache static shell (HTML/CSS/JS/icons) → app เปิดเร็ว + offline ใช้ได้
//   3. Network-first สำหรับ API (ข้อมูลสด)
//
// ⚠️ ห้ามใส่ secrets/keys ตรงนี้ — sw.js เปิดสาธารณะ
// ─────────────────────────────────────────────────────────────

const CACHE_NAME = 'thira-v2';
const SHELL = [
  './',
  './mobile.html',
  './dashboard.html',
  './monthly.html',
  './print_all.html',
  './auth.js',
  './manifest.json',
  './icon-96.png',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
];

// Install — เตรียม shell cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL).catch(() => {/* ignore — บางไฟล์อาจไม่มี */}))
  );
  self.skipWaiting();
});

// Activate — ลบ cache เก่า
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch:
//  - Supabase API + cdn = network first (สดเสมอ)
//  - Static shell = cache first
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase API + fonts.gstatic + cdnjs → network first
  if (
    url.hostname.endsWith('supabase.co') ||
    url.hostname.includes('fonts.gstatic') ||
    url.hostname.includes('cdnjs') ||
    url.hostname.includes('cdn.jsdelivr') ||
    url.hostname.includes('jsdelivr.net') ||
    url.hostname.includes('line-scdn')
  ) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req))
    );
    return;
  }

  // Same-origin shell → cache first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(req, clone));
          }
          return res;
        }).catch(() => cached);
      })
    );
  }
});
