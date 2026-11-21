/*
 * Service worker: keeps the app's own files on the phone so it opens fast and works offline,
 * and (on Android Chrome) sends waiting photos in the background when the network comes back.
 * Bump CACHE whenever you change any app file, so phones pick up the new version.
 */
const CACHE = 'smile-corner-v2.1.1';
const APP_FILES = ['./', 'index.html', 'app.js', 'camera.js', 'premium.js', 'demo.js', 'config.js', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png'];
// The Bangla font. Saved at install so the app looks right offline from the first day.
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&display=swap';
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(APP_FILES);
    try {
      // Font stylesheet, then the font files it lists (best effort: the app still works without them).
      const css = await fetch(FONT_CSS);
      if (css.ok) {
        await c.put(FONT_CSS, css.clone());
        const urls = ((await css.text()).match(/https:\/\/fonts\.gstatic\.com\/[^)]+/g) || []).slice(0, 12);
        await Promise.all(urls.map(u => fetch(u, { mode: 'cors' }).then(r => r.ok && c.put(u, r)).catch(() => {})));
      }
    } catch (err) { /* offline at install: fonts are saved on first online use instead */ }
  }).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // uploads and API calls always go to the network
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  if (!own && CDN_HOSTS.indexOf(url.hostname) < 0) return; // Apps Script, Drive photos: never cached here

  // App files: answer from the phone at once, refresh the copy in the background.
  e.respondWith(caches.open(CACHE).then(cache => cache.match(req, { ignoreSearch: own && url.pathname.endsWith('/') }).then(hit => {
    const fresh = fetch(req).then(res => {
      if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || fresh;
  })));
});

/* ---------- Background sync: send waiting photos even if the app was closed (Chrome on Android) ---------- */
self.addEventListener('sync', e => {
  if (e.tag === 'upload-queue') e.waitUntil(sendWaiting());
});

function idb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open('smilecorner', 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('uploads')) db.createObjectStore('uploads', { keyPath: 'clientId' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = (db, store, mode, fn) => new Promise((resolve, reject) => {
  const t = db.transaction(store, mode);
  const out = fn(t.objectStore(store));
  t.oncomplete = () => resolve(out && 'result' in out ? out.result : undefined);
  t.onerror = () => reject(t.error);
});

async function sendWaiting() {
  const db = await idb();
  const auth = await tx(db, 'kv', 'readonly', s => s.get('auth'));
  if (!auth || !auth.token || !auth.api) return;
  const all = (await tx(db, 'uploads', 'readonly', s => s.getAll())) || [];
  const waiting = all.filter(r => r.state === 'queued' && r.payload && r.payload.image).sort((a, b) => a.createdAt - b.createdAt);
  for (const rec of waiting) {
    // The server ignores an upload ID it already has, so sending here and from the open app at once is safe.
    const body = Object.assign({}, rec.payload, { thumb: rec.thumb, action: rec.kind === 'convert' ? 'convert' : 'upload', token: auth.token, appVersion: auth.version });
    let res;
    try {
      const r = await fetch(auth.api, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' });
      res = r.ok ? await r.json() : null;
    } catch (err) { throw err; }                            // still offline: Chrome tries again later
    if (!res) throw new Error('server');
    if (res.ok) {
      rec.state = res.status === 'flagged' ? 'flagged' : 'accepted';
      rec.message = res.message || ''; rec.fileId = res.fileId || ''; rec.photoNo = res.photoNo || '';
      rec.payload.image = null; rec.doneAt = Date.now();
    } else if (res.error === 'REJECTED') {
      rec.state = 'rejected'; rec.message = res.message || ''; rec.payload.image = null;
    } else if (res.final) {
      rec.state = 'attention'; rec.message = res.message || '';
    } else {
      throw new Error(res.error || 'retry');                // busy or login problem: keep it waiting
    }
    await tx(db, 'uploads', 'readwrite', s => s.put(rec));
  }
}
