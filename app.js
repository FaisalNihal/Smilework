/*
 * Smile Corner merchandiser app.
 * Screens: login, My Day, capture (guided camera), My Photos, monthly progress, admin, new outlet.
 * Every photo goes into a queue on the phone first, so nothing is lost on a weak network.
 */
(function () {
  'use strict';

  const CFG = window.APP_CONFIG || {};
  const VERSION = CFG.APP_VERSION || '2.1.0';
  // Demo mode only when no server is configured. "?demo" works only if config.js allows it (never in production).
  const DEMO = !CFG.API_URL || (CFG.ALLOW_DEMO_PARAM === true && /[?&]demo\b/.test(location.search));
  const demo = DEMO ? window.SmileDemo.create() : null;
  const root = document.getElementById('root');

  /* ======================= small helpers ======================= */
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bn = v => String(v).replace(/\d/g, d => '০১২৩৪৫৬৭৮৯'[d]);
  const pad2 = n => String(n).padStart(2, '0');
  const monthKey = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  const sameDay = (a, b) => a.toDateString() === b.toDateString();
  const timeOf = iso => {
    if (!iso) return '--:--';
    const d = new Date(iso);
    if (isNaN(d)) return '--:--';
    let h = d.getHours(); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
    return bn(h + ':' + pad2(d.getMinutes())) + ' ' + ap;
  };
  const dateLong = d => d.toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
  const monthName = key => {
    const [y, m] = key.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' });
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12));
  const cmpVer = (a, b) => {
    const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const x = pa[i] || 0, y = pb[i] || 0; if (x !== y) return x < y ? -1 : 1; }
    return 0;
  };
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sc_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('sc_' + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem('sc_' + k); } catch (e) { /* ignore */ } }
  };

  /* Visit days: PJP may say "Saturday", "Sat", "শনিবার" or several days in one cell. */
  const DAY_WORDS = [['sun', 'রবি'], ['mon', 'সোম'], ['tue', 'মঙ্গল'], ['wed', 'বুধ'], ['thu', 'বৃহস্পতি'], ['fri', 'শুক্র'], ['sat', 'শনি']];
  const DAY_BN = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];
  const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5];
  function dayIndexes(text) {
    const s = String(text || '').toLowerCase();
    if (isDateKey(s)) return [];                 // a date, not a weekday name
    const out = [];
    DAY_WORDS.forEach((w, i) => { if (s.indexOf(w[0]) >= 0 || s.indexOf(w[1]) >= 0) out.push(i); });
    return out;
  }
  /* Date-wise PJP: the server sends Visit Day as 'yyyy-MM-dd'. */
  const isDateKey = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
  const dateKeyOf = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const dateOfKey = k => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const dateShort = k => dateOfKey(k).toLocaleDateString('bn-BD', { day: 'numeric', month: 'long', weekday: 'long' });
  const ORD_BN = ['১ম', '২য়', '৩য়', '৪র্থ', '৫ম', '৬ষ্ঠ'];
  /** True when the PJP uses real dates (any row has a date). Old weekday PJPs return false. */
  const isDatePjp = () => pjpList().some(o => isDateKey(o.visitDay));
  /** Visit number of an outlet on a date: its 1st, 2nd... planned date this month. 0 if not planned that day. */
  function visitNo(code, key) {
    const dates = Array.from(new Set(pjpList().filter(o => o.code === code && isDateKey(o.visitDay)).map(o => o.visitDay))).sort();
    return dates.indexOf(key) + 1;
  }
  const visitTag = n => n ? '<span class="chip visit" style="padding:0 8px">' + (ORD_BN[n - 1] || bn(n) + 'ম') + ' ভিজিট</span>' : '';

  const ICON = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8.5 14.5l2 2 4-4"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.5-2h5.6l1.5 2h1.2A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.6"/></svg>',
    convert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="12.5" width="7" height="8" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="17" rx="1.5"/><path d="M5 8.5c0-3 2.5-5 6-5M9 1.8l2 1.7-2 1.8"/></svg>',
    photos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="M20.5 16l-5-5-8.5 8.5"/></svg>',
    progress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M5 20V12M12 20V5M19 20v-5"/></svg>',
    admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.2-7.5 9.5-4.3-1.3-7.5-4.9-7.5-9.5V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    outlet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5L5.5 4h13L20 9.5M4 9.5h16M4 9.5v10h16v-10"/><path d="M12 12.5v5M9.5 15h5"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="5" width="16" height="13" rx="2.5"/><path d="M8 18v2M16 18v2M4 10h16"/></svg>',
    shelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5h17M3.5 12h17M3.5 19h17"/><path d="M6 5v-1.5M10 12v-3M14 12v-2M18 19v-3M7 19v-2.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>'
  };
  const MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="12" fill="#fff"/><path d="M9.5 19.5c2.6 5.6 6.2 8.4 10.5 8.4s7.9-2.8 10.5-8.4" fill="none" stroke="#E2231A" stroke-width="3.6" stroke-linecap="round"/><circle cx="14.5" cy="14" r="2.3" fill="#E2231A"/><circle cx="25.5" cy="14" r="2.3" fill="#E2231A"/></svg>';
  const ROLE_BN = { Merchandiser: 'মার্চেন্ডাইজার', SR: 'TM / SR (SMT আউটলেট)', Admin: 'অ্যাডমিন' };

  /* ======================= phone storage for the upload queue ======================= */
  const DB = (function () {
    let dbp = null;
    const mem = new Map(), kvMem = new Map();
    const info = { ok: null };
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(resolve => {
        try {
          const r = indexedDB.open('smilecorner', 2);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains('uploads')) db.createObjectStore('uploads', { keyPath: 'clientId' });
            if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
          };
          r.onsuccess = () => { info.ok = true; resolve(r.result); };
          r.onerror = () => { info.ok = false; resolve(null); };
          r.onblocked = () => { info.ok = false; resolve(null); };
        } catch (e) { info.ok = false; resolve(null); }
      });
      return dbp;
    }
    return {
      info: info,
      open: open,
      async kvGet(k) {
        const db = await open();
        if (!db) return kvMem.get(k);
        return new Promise(res => {
          try {
            const r = db.transaction('kv').objectStore('kv').get(k);
            r.onsuccess = () => res(r.result);
            r.onerror = () => res(kvMem.get(k));
          } catch (e) { res(kvMem.get(k)); }
        });
      },
      async kvSet(k, v) {
        kvMem.set(k, v);
        const db = await open();
        if (!db) return false;
        return new Promise(res => {
          try {
            const t = db.transaction('kv', 'readwrite');
            if (v === undefined) t.objectStore('kv').delete(k); else t.objectStore('kv').put(v, k);
            t.oncomplete = () => res(true); t.onerror = () => res(false); t.onabort = () => res(false);
          } catch (e) { res(false); }
        });
      },
      async all() {
        const db = await open();
        if (!db) return Array.from(mem.values());
        return new Promise(res => {
          try {
            const r = db.transaction('uploads').objectStore('uploads').getAll();
            r.onsuccess = () => res(r.result || []);
            r.onerror = () => res([]);
          } catch (e) { res(Array.from(mem.values())); }
        });
      },
      async put(rec) {
        mem.set(rec.clientId, rec);
        const db = await open();
        if (!db) return;
        await new Promise(res => {
          try {
            const t = db.transaction('uploads', 'readwrite');
            t.objectStore('uploads').put(rec);
            t.oncomplete = res; t.onerror = res; t.onabort = res;
          } catch (e) { res(); }
        });
      },
      async del(id) {
        mem.delete(id);
        const db = await open();
        if (!db) return;
        await new Promise(res => {
          try {
            const t = db.transaction('uploads', 'readwrite');
            t.objectStore('uploads').delete(id);
            t.oncomplete = res; t.onerror = res;
          } catch (e) { res(); }
        });
      }
    };
  })();

  /* ======================= server ======================= */
  async function api(action, payload, opts) {
    const body = Object.assign({}, payload || {}, { action: action, token: state.token, appVersion: VERSION });
    let res;
    if (DEMO) res = await demo.handle(body);
    else {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 30000);
      try {
        const r = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(body), signal: ctrl.signal, redirect: 'follow' });
        res = r.ok ? await r.json() : { ok: false, error: 'NETWORK', message: 'সার্ভারে পৌঁছানো যায়নি (' + r.status + ')' };
      } catch (e) {
        res = { ok: false, error: 'NETWORK', message: 'নেটওয়ার্ক নেই বা দুর্বল' };
      } finally { clearTimeout(timer); }
    }
    if (res && res.error === 'AUTH' && action !== 'login') { logout(true); }
    if (res && res.error === 'MAINTENANCE') { state.maintenance = res.message; render(); }
    return res || { ok: false, error: 'NETWORK', message: 'কোনো উত্তর আসেনি' };
  }

  /* ======================= state ======================= */
  const state = {
    token: store.get('token', ''),
    user: store.get('user', null),
    boot: store.get('boot', null),
    tab: '',
    pick: null, capture: null, result: null,
    f: { region: '', db: '', route: '', q: '' },
    day: null,
    dayDate: '',
    photos: null, photosMonth: monthKey(new Date()), photosLoading: false,
    progressFilter: 'all',
    conv: { pick: null, capture: null, result: null, filter: 'todo', route: '', q: '' },
    admin: null, review: null, adminLoading: false, thumbs: {},
    local: [], sending: false, inFlight: new Set(),
    online: navigator.onLine, maintenance: '', loading: false, names: null, loginError: '',
    loginMode: store.get('loginMode', 'merch')
  };

  function pjpList() {
    const b = state.boot;
    if (!b || !b.pjp) return [];
    if (!b._list) b._list = b.pjp.rows.map(r => { const o = {}; b.pjp.cols.forEach((c, i) => { o[c] = r[i] == null ? '' : String(r[i]); }); return o; });
    return b._list;
  }
  const outletByCode = code => pjpList().find(o => o.code === code);
  /** PJP can list one outlet twice (e.g. visited on two days): keep the first row per outlet code. */
  function uniqueOutlets(list) {
    const seen = new Set();
    return list.filter(o => { if (seen.has(o.code)) return false; seen.add(o.code); return true; });
  }
  /** Conversion state for an outlet: '' (none), 'queued', 'Pending', 'Approved' or 'Rejected'. */
  function convStatus(code) {
    const local = state.local.find(r => r.kind === 'convert' && r.outletCode === code);
    if (local && (local.state === 'queued' || local.state === 'sending')) return 'queued';
    const server = (state.boot && state.boot.conversions && state.boot.conversions[code]) || '';
    if (local && local.state === 'accepted' && server !== 'Approved' && server !== 'Rejected') return 'Pending';
    return server;
  }
  /** Display if PJP says so, or once a Regular -> Display conversion is Approved (before PJP is edited). */
  function outletType(o) {
    if (!o) return 'Regular';
    if (/display/i.test(o.status || '')) return 'Display';
    const server = state.boot && state.boot.conversions && state.boot.conversions[o.code];
    return server === 'Approved' ? 'Display' : 'Regular';
  }
  const typeTag = o => {
    const t = outletType(o), conv = t === 'Display' && !/display/i.test(o.status || '');
    return '<span class="otag' + (t === 'Display' ? ' display' : '') + '">' + (t === 'Display' ? 'ডিসপ্লে' : 'রেগুলার') + (conv ? ' (রূপান্তর অনুমোদিত)' : '') + '</span>';
  };
  const maxPerMonth = () => Number(state.boot && state.boot.settings && state.boot.settings.max_photos_per_month) || 2;
  const isMerch = () => state.user && state.user.role === 'Merchandiser';
  /** Merchandisers and TM/SR have the monthly photo limit; admins do not. */
  const limited = () => state.user && state.user.role !== 'Admin';

  /** Photos counted this month per outlet = server count + accepted local uploads the server count doesn't include yet. */
  function monthCount(code) {
    const base = (state.boot && state.boot.monthCounts && state.boot.monthCounts[code]) || 0;
    const serverT = state.boot && state.boot.serverTime ? Date.parse(state.boot.serverTime) : 0;
    const extra = state.local.filter(r => r.kind !== 'convert' && r.outletCode === code && r.month === (state.boot && state.boot.month) &&
      (r.state === 'queued' || r.state === 'sending' ||
       ((r.state === 'accepted' || r.state === 'flagged') && !(r.doneAt && serverT > r.doneAt)))).length;
    return base + extra;
  }
  function doneToday(code) {
    const now = new Date();
    if (state.boot && (state.boot.todayPhotos || []).some(p => p.code === code && p.dupStatus !== 'Rejected')) return true;
    return state.local.some(r => r.kind !== 'convert' && r.outletCode === code && sameDay(new Date(r.createdAt), now) && r.state !== 'rejected');
  }

  /* ======================= startup ======================= */
  async function start() {
    window.addEventListener('online', () => { state.online = true; render(); processQueue(); });
    window.addEventListener('offline', () => { state.online = false; render(); });
    setInterval(() => { if (state.token) processQueue(); }, 45000);
    if (!DEMO && 'serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    if (DEMO && !state.token) store.del('boot');
    // Ask Chrome to keep this app's data even when the phone is low on space.
    try { if (navigator.storage && navigator.storage.persist) state.persisted = await navigator.storage.persist(); } catch (e) { /* not supported */ }
    await DB.open();
    if (!state.boot && state.token) {
      const saved = await DB.kvGet('boot');
      if (saved) { state.boot = saved; state.bootAt = 0; }
    }
    state.bootSavedAt = (await DB.kvGet('bootSavedAt')) || store.get('bootSavedAt', 0);
    if (!DEMO && state.token) DB.kvSet('auth', { token: state.token, api: CFG.API_URL, version: VERSION });
    await loadLocal();
    if (state.token) {
      state.tab = state.tab || defaultTab();
      render();
      refreshBoot();
      processQueue();
    } else {
      render();
      loadNames();
    }
  }

  function defaultTab() { return isMerch() ? 'today' : 'capture'; }

  async function loadLocal() {
    const all = await DB.all();
    const cutoff = Date.now() - 40 * 864e5;
    for (const r of all) {
      // Waiting photos and photos that need attention are never deleted automatically.
      if (r.createdAt < cutoff && ['queued', 'sending', 'attention'].indexOf(r.state) < 0) await DB.del(r.clientId);
    }
    state.local = (await DB.all()).filter(r => state.user && r.user === state.user.name).sort((a, b) => b.createdAt - a.createdAt);
  }

  async function loadNames() {
    const res = await api('loginNames');
    state.names = res.ok ? res.names : [];
    render();
  }

  async function refreshBoot() {
    state.loading = !state.boot;
    render();
    const res = await api('bootstrap');
    state.loading = false;
    if (res.ok) {
      state.bootAt = Date.now();
      state.boot = res;
      state.maintenance = '';
      saveBoot(res);
      if (CFG.GUIDE_MODEL_URL && window.GuidedCamera) window.GuidedCamera.preload(CFG.GUIDE_MODEL_URL);
    } else if (!state.boot) {
      toast(res.message || 'ডেটা লোড হয়নি');
    }
    render();
  }

  async function quietRefresh() {
    state.bootAt = Date.now();
    const res = await api('bootstrap');
    if (res.ok) { state.boot = res; saveBoot(res); render(); }
  }

  /** The outlet list is kept in IndexedDB (large, reliable) and, if it fits, in localStorage too. */
  function saveBoot(res) {
    state.bootSavedAt = Date.now();
    DB.kvSet('boot', res).then(okSaved => { if (!okSaved && !DB.info.ok) toast('ফোনে আউটলেট তালিকা সেভ করা যায়নি'); });
    DB.kvSet('bootSavedAt', state.bootSavedAt);
    store.set('boot', res);
    store.set('bootSavedAt', state.bootSavedAt);
  }

  async function login(name, pin, team) {
    state.loginError = '';
    const res = team ? await api('teamLogin', { password: pin, name: name }) : await api('login', { name: name, pin: pin });
    if (!res.ok) { state.loginError = res.message || 'লগইন হয়নি'; render(); return; }
    state.token = res.token; state.user = res.user;
    store.set('token', res.token); store.set('user', res.user);
    if (!DEMO) DB.kvSet('auth', { token: res.token, api: CFG.API_URL, version: VERSION });
    state.tab = defaultTab();
    await loadLocal();
    await refreshBoot();
    processQueue();
  }

  function logout(expired) {
    state.token = ''; state.user = null; state.boot = null; state.photos = null; state.admin = null; state.review = null;
    state.pick = null; state.capture = null; state.result = null;
    store.del('token'); store.del('user'); store.del('boot');
    DB.kvSet('boot', undefined); DB.kvSet('auth', undefined);
    state.loginError = expired ? 'সময় শেষ, আবার লগইন করুন' : '';
    render();
    if (!state.names) loadNames();
  }

  /* ======================= upload queue ======================= */
  async function enqueue(cap, outlet, kind) {
    const rec = {
      kind: kind || 'photo',
      clientId: uuid(), user: state.user.name, createdAt: cap.capturedAt || Date.now(), month: monthKey(new Date(cap.capturedAt || Date.now())),
      outletCode: outlet.code, outletName: outlet.name, outletType: cap.outletType || outletType(outlet),
      state: 'queued', tries: 0, message: '', thumb: cap.thumb, premium: cap.premium || null,
      payload: {
        outletCode: outlet.code, outletName: outlet.name, outletStatus: outlet.status || '',
        image: cap.image, thumb: cap.thumb, fp: cap.fp, phash: cap.phash || '', lat: cap.lat, lon: cap.lon, acc: cap.acc,
        capturedAt: cap.capturedAt, framing: cap.framing, guide: cap.guide, source: 'camera',
        outletType: cap.outletType || outletType(outlet), frame: cap.frame || '', displaySeen: !!cap.displaySeen,
        quality: cap.quality || null, overrideReason: cap.overrideReason || '', premium: cap.premium || null
      }
    };
    rec.payload.clientId = rec.clientId;
    await DB.put(rec);
    if (DB.info.ok === false) toast('সতর্কতা: ফোনে ছবি নিরাপদে রাখা যাচ্ছে না। অ্যাপ বন্ধ করার আগে ইন্টারনেটে জমা দিন।');
    state.local.unshift(rec);
    askBackgroundSync();
    return rec;
  }

  /** Chrome on Android can send waiting photos in the background when the network returns (best effort). */
  function askBackgroundSync() {
    if (DEMO || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.ready.then(r => { if (r.sync) r.sync.register('upload-queue').catch(() => {}); }).catch(() => {});
  }

  async function sendOne(rec) {
    state.inFlight.add(rec.clientId);
    rec.state = 'sending';
    await DB.put(rec);
    renderSync();
    const payload = Object.assign({}, rec.payload, { thumb: rec.thumb });
    const res = await api(rec.kind === 'convert' ? 'convert' : 'upload', payload, { timeout: 120000 });
    if (res.ok) {
      rec.state = res.status === 'flagged' ? 'flagged' : 'accepted';
      rec.message = res.message || ''; rec.fileId = res.fileId || ''; rec.photoNo = res.photoNo || '';
      rec.payload.image = null; rec.doneAt = Date.now();
    } else if (res.error === 'REJECTED') {
      // A company rule (e.g. the monthly photo limit). The photo is kept on the server as evidence.
      rec.state = 'rejected'; rec.message = res.message || 'বাতিল'; rec.fileId = res.fileId || ''; rec.payload.image = null;
    } else if (res.final) {
      // Something a retry cannot fix. The photo stays on the phone and is shown as "Needs attention".
      rec.state = 'attention'; rec.message = res.message || 'সমস্যা হয়েছে';
    } else {
      rec.state = 'queued'; rec.tries++; rec.message = res.message || '';
      askBackgroundSync();
    }
    await DB.put(rec);
    state.inFlight.delete(rec.clientId);
    return res;
  }

  async function processQueue() {
    if (state.sending || !state.token || !state.online) { renderSync(); return; }
    state.sending = true;
    try {
      const recs = state.local.filter(r => (r.state === 'queued' || r.state === 'sending') && !state.inFlight.has(r.clientId))
        .sort((a, b) => a.createdAt - b.createdAt);
      for (const r of recs) {
        const res = await sendOne(r);
        if (!res.ok && !res.final && res.error !== 'REJECTED') break;
      }
    } finally {
      state.sending = false;
      renderSync();
      if (state.tab === 'photos' || state.tab === 'today' || state.tab === 'progress') render();
    }
  }

  function pendingCount() { return state.local.filter(r => r.state === 'queued' || r.state === 'sending').length; }
  function attentionCount() { return state.local.filter(r => r.state === 'attention').length; }

  /* ======================= rendering ======================= */
  function render() {
    if (!state.token || !state.user) { root.innerHTML = loginView(); return; }
    if (!state.tab) state.tab = defaultTab();
    const tabs = tabsFor(state.user.role);
    if (!tabs.some(t => t[0] === state.tab)) state.tab = tabs[0][0];
    root.innerHTML =
      '<div class="shell">' +
        '<header class="topbar">' + MARK +
          '<div class="who"><b>' + esc(state.user.name) + '</b><span>' + esc(ROLE_BN[state.user.role] || state.user.role) + (DEMO ? '<span class="demo-pill">ডেমো</span>' : '') + '</span></div>' +
          '<button type="button" class="sync" id="syncChip" data-act="sync"></button>' +
          '<button type="button" class="iconbtn" data-act="logout" aria-label="লগআউট">' + ICON.logout + '</button>' +
        '</header>' +
        '<main id="main">' + banners() + screen() + '</main>' +
        '<nav class="tabbar" aria-label="মেনু"><div class="in">' + tabs.map(t =>
          '<button type="button" class="tab' + (t[0] === 'capture' ? ' shoot' : '') + '" data-act="tab" data-tab="' + t[0] + '"' + (state.tab === t[0] ? ' aria-current="page"' : '') + '>' +
          (t[0] === 'capture' ? '<i>' + ICON[t[2]] + '</i>' : ICON[t[2]]) + '<span>' + t[1] + '</span>' +
          (t[0] === 'photos' && pendingCount() ? '<span class="dot">' + bn(pendingCount()) + '</span>' : '') +
          '</button>').join('') + '</div></nav>' +
      '</div>';
    renderSync();
  }

  function tabsFor(role) {
    if (role === 'Merchandiser') return [['today', 'আজ', 'today'], ['photos', 'আমার ছবি', 'photos'], ['capture', 'ছবি', 'camera'], ['progress', 'অগ্রগতি', 'progress'], ['convert', 'রূপান্তর', 'convert']];
    if (role === 'SR') return [['photos', 'আমার ছবি', 'photos'], ['progress', 'অগ্রগতি', 'progress'], ['capture', 'ছবি', 'camera'], ['convert', 'রূপান্তর', 'convert'], ['outlet', 'নতুন', 'outlet']];
    return [['photos', 'ছবি', 'photos'], ['progress', 'অগ্রগতি', 'progress'], ['capture', 'তুলুন', 'camera'], ['admin', 'রিভিউ', 'admin'], ['outletAdmin', 'নতুন', 'outlet']];
  }

  function renderSync() {
    const chip = document.getElementById('syncChip');
    if (!chip) return;
    const n = pendingCount();
    chip.className = 'sync ' + (!state.online ? '' : n ? 'warn' : 'ok');
    chip.textContent = !state.online ? (n ? 'অফলাইন · ' + bn(n) : 'অফলাইন')
      : state.sending ? 'পাঠানো হচ্ছে…' : n ? bn(n) + 'টি বাকি' : 'সব জমা';
  }

  function banners() {
    let h = '';
    if (state.maintenance) h += '<div class="banner notice">' + esc(state.maintenance) + '</div>';
    const s = state.boot && state.boot.settings;
    if (s && s.notice) h += '<div class="banner notice"><span>📢 ' + esc(s.notice) + '</span></div>';
    if (s && cmpVer(VERSION, s.app_min_version) < 0) h += '<div class="banner info"><span>নতুন ভার্সন এসেছে</span><button type="button" data-act="reload">আপডেট</button></div>';
    if (!state.online) h += '<div class="banner off">অফলাইন · ছবি ফোনে জমা থাকবে, নেট পেলে যাবে</div>';
    if (DB.info.ok === false) h += '<div class="banner notice">এই ফোনে ছবি জমা রাখা যাচ্ছে না · অনলাইনে জমা দিন</div>';
    const old = state.local.filter(r => (r.state === 'queued' || r.state === 'sending') && Date.now() - r.createdAt > 12 * 3600e3).length;
    if (old) h += '<div class="banner notice">' + bn(old) + 'টি ছবি ১২ ঘণ্টার বেশি অপেক্ষায় · নেটে যুক্ত হন</div>';
    if (attentionCount()) h += '<div class="banner notice"><span>' + bn(attentionCount()) + 'টি ছবি জমা হয়নি</span><button type="button" data-act="tab" data-tab="photos">দেখুন</button></div>';
    return h;
  }

  function screen() {
    if (state.loading && !state.boot) return '<div class="empty"><div class="spinner"></div><p>ডেটা লোড হচ্ছে…</p></div>';
    switch (state.tab) {
      case 'today': return todayView();
      case 'capture': return captureView();
      case 'photos': return photosView();
      case 'progress': return state.user.role === 'Admin' ? adminProgressView() : progressView();
      case 'admin': return adminView();
      case 'outlet': case 'outletAdmin': return newOutletView();
      case 'convert': return convertView();
      default: return '';
    }
  }

  /* ---------- login ---------- */
  function loginView() {
    const names = state.names;
    const nameField = names === null
      ? '<div class="empty"><div class="spinner"></div></div>'
      : names.length
        ? '<select class="input" id="loginName"><option value="">নাম বাছুন</option>' + names.map(n => '<option>' + esc(n) + '</option>').join('') + '</select>'
        : '<input class="input" id="loginName" autocomplete="username" placeholder="আপনার নাম">';
    const team = state.loginMode === 'team';
    const seg = (m, label) => '<button type="button" data-act="loginMode" data-m="' + m + '" aria-pressed="' + (state.loginMode === m) + '">' + label + '</button>';
    const fields = team
      ? '<label class="field" for="loginPw">পাসওয়ার্ড<input class="input" id="loginPw" type="password" autocomplete="current-password"' + (DEMO ? ' value="smile2026"' : '') + '></label>' +
        '<label class="field" for="loginTmName">নাম (ঐচ্ছিক)<input class="input" id="loginTmName" maxlength="40" autocomplete="name" value="' + esc(store.get('tmName', '')) + '"></label>'
      : '<label class="field" for="loginName">নাম' + nameField + '</label>' +
        '<label class="field" for="loginPin">পিন<input class="input pin" id="loginPin" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="current-password" placeholder="••••"' + (DEMO ? ' value="1234"' : '') + '></label>';
    return '<div class="login-wrap"><div class="login-top">' + MARK + '<h1>স্মাইল কর্নার</h1><p>Colgate আউটলেট ছবি</p></div>' +
      '<form class="login" id="loginForm" novalidate>' +
      '<div class="seg" role="group" aria-label="আপনি কে?">' + seg('merch', 'মার্চেন্ডাইজার') + seg('team', 'TM / SR') + '</div>' +
      fields +
      (DEMO ? '<p class="small muted">ডেমো: যেকোনো ৪ সংখ্যার পিন</p>' : '') +
      '<p class="error" role="alert">' + esc(state.loginError) + '</p>' +
      '<button class="btn primary big block" type="submit" id="loginBtn">লগইন</button>' +
      '</form></div>';
  }

  /** Circular progress for the red hero card. */
  function ring(done, total) {
    const c = 2 * Math.PI * 40, f = total ? Math.min(1, done / total) : 0;
    return '<div class="ring" role="img" aria-label="' + done + ' / ' + total + '"><svg viewBox="0 0 92 92">' +
      '<circle cx="46" cy="46" r="40" fill="none" stroke="rgba(255,255,255,.22)" stroke-width="9"/>' +
      '<circle cx="46" cy="46" r="40" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + (c * f).toFixed(1) + ' ' + c.toFixed(1) + '"/>' +
      '</svg><b>' + bn(done) + '/' + bn(total) + '</b></div>';
  }

  /* ---------- My Day ---------- */
  function todayView() {
    const now = new Date();
    const mine = pjpList();
    const photosToday = ((state.boot && state.boot.todayPhotos) || []).map(p => new Date(p.ts))
      .concat(state.local.filter(r => r.kind !== 'convert' && sameDay(new Date(r.createdAt), now) && r.state !== 'rejected').map(r => new Date(r.createdAt)))
      .filter(d => !isNaN(d)).sort((a, b) => a - b);
    const first = photosToday[0], last = photosToday[photosToday.length - 1];
    const ci = state.boot && state.boot.checkIn ? new Date(state.boot.checkIn) : null;
    const startT = ci && (!first || ci < first) ? ci : first;
    const mins = startT && last ? Math.max(0, Math.round((last - startT) / 60000)) : 0;

    const byDate = isDatePjp();
    const todayKey = dateKeyOf(now);
    let days = [], list, pickKey = '';
    if (byDate) {
      // Date-wise PJP: show the outlets planned for the picked date (today by default).
      if (!isDateKey(state.dayDate)) state.dayDate = todayKey;
      pickKey = state.dayDate;
      list = uniqueOutlets(mine.filter(o => o.visitDay === pickKey));
    } else {
      // Weekday PJP (old format): unchanged.
      days = Array.from(new Set(mine.map(o => o.visitDay).filter(Boolean)));
      days.sort((a, b) => WEEK_ORDER.indexOf((dayIndexes(a)[0] ?? 9)) - WEEK_ORDER.indexOf((dayIndexes(b)[0] ?? 9)));
      if (state.day === null || (days.length && days.indexOf(state.day) < 0)) {
        state.day = days.find(d => dayIndexes(d).indexOf(now.getDay()) >= 0) || '';
      }
      list = uniqueOutlets(state.day ? mine.filter(o => o.visitDay === state.day) : mine);
    }
    // The red card always counts today's own plan, even while another date is picked below.
    const heroList = byDate ? uniqueOutlets(mine.filter(o => o.visitDay === todayKey)) : list;
    const done = heroList.filter(o => doneToday(o.code)).length;

    let h = '<section class="hero"><div class="top">' + ring(done, heroList.length) +
        '<div><h1>আজ</h1><div class="date">' + esc(dateLong(now)) + '</div><div class="date">' +
        (byDate && !heroList.length ? 'আজ PJP-তে আউটলেট নেই' : bn(heroList.length - done) + 'টি আউটলেট বাকি') + '</div></div></div>' +
        '<div class="stats4">' +
          '<div><b>' + (ci ? timeOf(ci.toISOString()) : '--:--') + '</b><span>শুরু</span></div>' +
          '<div><b>' + (first ? timeOf(first.toISOString()) : '--:--') + '</b><span>প্রথম ছবি</span></div>' +
          '<div><b>' + (last ? timeOf(last.toISOString()) : '--:--') + '</b><span>শেষ ছবি</span></div>' +
          '<div><b>' + bn(Math.floor(mins / 60)) + 'ঘ ' + bn(mins % 60) + 'মি</b><span>সময়</span></div>' +
        '</div>' +
        (!ci ? '<button type="button" class="btn white block" data-act="checkin">দিন শুরু করুন</button>' : '') +
      '</section>';

    if (byDate) {
      const isToday = pickKey === todayKey;
      h += '<div class="datehead"><h2>' + (isToday ? 'আজকের আউটলেট' : 'এই দিনের আউটলেট') + '</h2>' +
        '<span class="muted small num">' + bn(list.length) + 'টি</span></div>' +
        '<div class="daynav">' +
          '<button type="button" class="btn line small" data-act="dayStep" data-step="-1" aria-label="আগের দিন">‹</button>' +
          '<label class="input datepick"><span>' + esc(dateShort(pickKey)) + '</span>' +
            '<input type="date" id="dayDate" data-change="dayDate" value="' + esc(pickKey) + '" aria-label="ভিজিটের তারিখ বাছুন"></label>' +
          '<button type="button" class="btn line small" data-act="dayStep" data-step="1" aria-label="পরের দিন">›</button>' +
          (isToday ? '' : '<button type="button" class="btn line small" data-act="dayToday">আজ</button>') +
        '</div>';
      if (!list.length) {
        const monthHasPlan = mine.some(o => isDateKey(o.visitDay) && o.visitDay.slice(0, 7) === pickKey.slice(0, 7));
        h += '<div class="empty"><p><b>' + esc(dateShort(pickKey)) + '</b><br>' +
          (monthHasPlan ? 'এই তারিখে আপনার PJP-তে কোনো আউটলেট নেই।'
                        : 'এই মাসের PJP এখনো আসেনি। অফিসে জানান।') +
          '</p><p class="muted small">অন্য আউটলেটের ছবি "ছবি" ট্যাব থেকে তুলতে পারবেন।</p></div>';
      } else {
        h += outletRows(list, true, o => visitTag(visitNo(o.code, pickKey)));
      }
      return h;
    }

    h += '<div class="datehead"><h2>আজকের আউটলেট</h2>' +
      (days.length > 1 ? '<select class="input" id="daySel" data-change="day" aria-label="ভিজিটের দিন" style="width:auto;min-height:38px;padding:6px 10px">' +
        '<option value=""' + (state.day === '' ? ' selected' : '') + '>সব দিন</option>' +
        days.map(d => '<option' + (d === state.day ? ' selected' : '') + '>' + esc(d) + '</option>').join('') + '</select>' : '') + '</div>';
    if (!list.length) {
      h += '<div class="empty"><p>' + (mine.length ? 'এই দিনে কোনো আউটলেট নেই' : 'আপনার PJP-তে আউটলেট নেই') + '</p></div>';
    } else {
      h += outletRows(list, true);
    }
    return h;
  }

  /** Premium SKUs seen this month at this outlet (from the AI check of its photos). */
  function premiumTag(code) {
    const p = state.boot && state.boot.premium && state.boot.premium[code];
    if (p === 'Yes') return '<span class="chip ok" style="padding:0 8px">★ প্রিমিয়াম</span>';
    if (p === 'Needs review') return '<span class="chip warn" style="padding:0 8px">★ ?</span>';
    return '';
  }

  function pips(n) {
    const max = maxPerMonth();
    let s = '<span class="pips" aria-label="এই মাসে ' + n + ' / ' + max + ' ছবি">';
    for (let i = 0; i < max; i++) s += '<i class="' + (i < n ? 'on' : '') + '"></i>';
    return s + '<small>' + bn(Math.min(n, max)) + '/' + bn(max) + '</small></span>';
  }

  function outletRows(list, groupByRoute, extraTag) {
    const limit = 80;
    let shown = list;
    let more = 0;
    if (shown.length > limit) { more = shown.length - limit; shown = shown.slice(0, limit); }
    const row = o => {
      const n = monthCount(o.code), full = limited() && n >= maxPerMonth();
      const disp = outletType(o) === 'Display';
      return '<button type="button" class="outlet' + (disp ? ' disp' : '') + '" data-act="pick" data-code="' + esc(o.code) + '"' + (full ? ' disabled' : '') + '>' +
        '<span class="name">' + esc(o.name) + '</span>' +
        '<span class="side">' + pips(n) + (doneToday(o.code) ? '<span class="today-tick">✓ আজ</span>' : '') + '</span>' +
        '<span class="meta">' + esc(o.code) + (extraTag ? extraTag(o) : '') + typeTag(o) + premiumTag(o.code) + '</span>' +
        '</button>';
    };
    let h = '';
    if (groupByRoute) {
      const groups = {};
      shown.forEach(o => { (groups[o.route || 'রুট নেই'] = groups[o.route || 'রুট নেই'] || []).push(o); });
      Object.keys(groups).sort().forEach(r => {
        h += '<div class="group-title"><span>' + esc(r) + '</span><span class="num">' + bn(groups[r].length) + '</span></div>' +
          '<div class="list">' + groups[r].map(row).join('') + '</div>';
      });
    } else {
      h = '<div class="list">' + shown.map(row).join('') + '</div>';
    }
    if (more) h += '<p class="muted small">আরও ' + bn(more) + 'টি · খুঁজে বের করুন</p>';
    return h;
  }

  /* ---------- capture ---------- */
  function captureView() {
    if (state.result) return resultView();
    if (state.capture) return previewView();
    if (state.pick) {
      const o = outletByCode(state.pick);
      if (o) return pickedView(o);
    }
    return pickerView();
  }

  function pickerView() {
    const all = pjpList();
    const f = state.f;
    const opts = (vals, cur, label) => '<option value="">' + label + '</option>' +
      Array.from(new Set(vals.filter(Boolean))).sort().map(v => '<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
    let h = '<h2>কোন আউটলেট?</h2><div class="filters">';
    if (!isMerch()) {
      h += '<select class="input" id="fRegion" data-change="fRegion" aria-label="এরিয়া">' + opts(all.map(o => o.region), f.region, 'সব এরিয়া') + '</select>';
      const inRegion = all.filter(o => !f.region || o.region === f.region);
      h += '<select class="input" id="fDb" data-change="fDb" aria-label="ডিস্ট্রিবিউটর">' + opts(inRegion.map(o => o.dbName), f.db, 'সব ডিস্ট্রিবিউটর') + '</select>';
    }
    const inDb = all.filter(o => (!f.region || o.region === f.region) && (!f.db || o.dbName === f.db));
    h += '<select class="input" id="fRoute" data-change="fRoute" aria-label="রুট">' + opts(inDb.map(o => o.route), f.route, 'সব রুট') + '</select></div>';
    h += '<input class="input" id="fSearch" type="search" placeholder="🔍 নাম বা কোড" value="' + esc(f.q) + '" autocomplete="off">';
    h += '<div id="pickList">' + pickList() + '</div>';
    return h;
  }

  function pickList() {
    const f = state.f, q = f.q.trim().toLowerCase();
    const now = new Date();
    let list = uniqueOutlets(pjpList()).filter(o => (!f.region || o.region === f.region) && (!f.db || o.dbName === f.db) && (!f.route || o.route === f.route) &&
      (!q || o.name.toLowerCase().indexOf(q) >= 0 || o.code.toLowerCase().indexOf(q) >= 0));
    if (isMerch()) {
      // Today's planned outlets first: by date (date-wise PJP, any of the outlet's rows) or by weekday (old PJP).
      const todayKey = dateKeyOf(now);
      const plannedToday = new Set(pjpList().filter(o => o.visitDay === todayKey).map(o => o.code));
      const todayFirst = o => (plannedToday.has(o.code) || dayIndexes(o.visitDay).indexOf(now.getDay()) >= 0) ? 0 : 1;
      list = list.slice().sort((a, b) => todayFirst(a) - todayFirst(b));
    }
    if (!list.length) return '<div class="empty"><p>কোনো আউটলেট পাওয়া যায়নি</p></div>';
    return outletRows(list, !q);
  }

  function pickedView(o) {
    const n = monthCount(o.code), max = maxPerMonth(), full = limited() && n >= max;
    const disp = outletType(o) === 'Display';
    return '<div class="picked' + (disp ? ' disp' : '') + '">' +
        '<div class="top"><div><div class="name">' + esc(o.name) + '</div><div class="muted small">' + esc(o.code) + ' · ' + esc(o.route) + '</div></div>' +
        '<button type="button" class="btn line small" data-act="unpick">বদলান</button></div>' +
        '<div class="row" style="align-items:center;justify-content:space-between">' + pips(n) + typeTag(o) + '</div>' +
      '</div>' +
      (full
        ? '<div class="full">এই মাসের ' + bn(max) + 'টি ছবি সম্পূর্ণ ✓</div>'
        : '<div class="hint">' + (disp ? ICON.pin + '<span>পুরো স্মাইল কর্নার ফ্রেমে আনুন</span>' : ICON.shelf + '<span>কলগেটের শেলফের ছবি · স্টিকার লাগবে না</span>') + '</div>' +
          '<button type="button" class="btn primary big block" data-act="camera">' + ICON.camera + 'ক্যামেরা খুলুন</button>' +
          (DEMO ? '<label class="btn line small block" for="demoFile">গ্যালারি থেকে (শুধু ডেমো)<input id="demoFile" type="file" accept="image/*" data-change="demoFile" hidden></label>' : ''));
  }

  /** Photo with premium SKU boxes drawn on top (only when a model, or the preview demo, found something). */
  function boxedImage(src, premium, alt) {
    const items = premium && premium.items ? premium.items.filter(i => Array.isArray(i.box)) : [];
    return '<div class="boxed"><img class="preview-img" src="' + esc(src) + '" alt="' + esc(alt) + '">' +
      items.map(i => '<div class="pbox' + (i.conf >= 0.8 ? ' yes' : '') + '" style="left:' + (i.box[0] * 100).toFixed(1) + '%;top:' + (i.box[1] * 100).toFixed(1) +
        '%;width:' + (i.box[2] * 100).toFixed(1) + '%;height:' + (i.box[3] * 100).toFixed(1) + '%"><span>' + esc(i.name || i.sku) + ' ' + Math.round(i.conf * 100) + '%</span></div>').join('') +
      '</div>';
  }
  const PREMIUM_BN = { 'Yes': ['ok', 'প্রিমিয়াম আছে'], 'No': ['', 'প্রিমিয়াম নেই'], 'Needs review': ['warn', 'প্রিমিয়াম নিশ্চিত নয়'], 'Not checked': ['', 'প্রিমিয়াম যাচাই হয়নি'] };
  const CHECK_BN = { gps: 'লোকেশন', level: 'ফোন সোজা', light: 'আলো', sharp: 'স্থির / স্পষ্ট', frame: 'পুরো ডিসপ্লে, সঠিক দূরত্বে' };

  function captureChecks(c) {
    const q = c.quality || { passed: false, failed: [] }, failed = q.failed || [];
    const keys = ['gps', 'level', 'light', 'sharp'].concat(c.outletType === 'Display' ? ['frame'] : []);
    const chip = (cls, text) => '<span class="chip ' + cls + '">' + text + '</span>';
    const SHORT = { gps: 'লোকেশন', level: 'সোজা', light: 'আলো', sharp: 'স্পষ্ট', frame: 'ডিসপ্লে' };
    let h = keys.map(k => failed.indexOf(k) >= 0 ? chip('warn', '! ' + SHORT[k]) : chip('ok', '✓ ' + SHORT[k])).join('');
    if (c.outletType === 'Display' && c.frame === 'none') h += chip('bad', 'ডিসপ্লে দেখা যায়নি');
    if (c.displaySeen) h += chip('warn', 'ডিসপ্লে দেখা গেছে');
    if (c.lat == null) h += chip('warn', 'লোকেশন নেই');
    if (c.overrideReason) h += chip('warn', 'কারণ: ' + esc(c.overrideReason));
    return '<div class="checks-row">' + h + '</div>';
  }

  function previewView() {
    const c = state.capture, o = outletByCode(state.pick) || { name: '', code: state.pick };
    const pr = c.premium || { presence: 'Not checked' }, pl = PREMIUM_BN[pr.presence] || ['', pr.presence];
    const willReview = c.frame === 'none' || c.lat == null || c.overrideReason;
    return '<div class="datehead"><h2>' + esc(o.name) + '</h2>' + typeTag(o) + '</div>' +
      boxedImage(c.image, pr, o.name + ' আউটলেটের ছবি') +
      captureChecks(c) +
      (pr.presence !== 'Not checked' ? '<div class="checks-row"><span class="chip ' + (pl[0] || 'wait') + '">★ ' + esc(pl[1]) + '</span>' + (pr.model ? '<span class="small muted">' + esc(pr.model) + '</span>' : '') + '</div>' : '') +
      (willReview ? '<p class="small muted">অ্যাডমিন যাচাই করবেন</p>' : '') +
      '<div class="row"><button type="button" class="btn ghost" data-act="retake">আবার তুলুন</button>' +
      '<button type="button" class="btn primary" data-act="submit">জমা দিন</button></div>';
  }

  function resultView() {
    const rec = state.result.rec;
    const R = {
      accepted: ['ok', '✓', 'জমা হয়েছে', rec.photoNo ? 'এই মাসের ' + bn(rec.photoNo) + ' নম্বর ছবি' : ''],
      flagged: ['warn', '!', 'জমা হয়েছে', 'অ্যাডমিন যাচাই করবেন'],
      rejected: ['bad', '✕', 'বাতিল', rec.message || ''],
      attention: ['bad', '!', 'জমা হয়নি', (rec.message || '') + ' · ছবি ফোনে আছে'],
      queued: ['wait', '⇡', 'ফোনে রাখা আছে', 'নেট পেলে নিজেই জমা হবে']
    }[rec.state] || ['wait', '…', 'পাঠানো হচ্ছে…', ''];
    return '<div class="result ' + R[0] + '" role="status"><div class="big">' + R[1] + '</div><h2>' + R[2] + '</h2>' + (R[3] ? '<p>' + esc(R[3]) + '</p>' : '') +
      (rec.thumb ? '<img class="preview-img" src="' + rec.thumb + '" alt="জমা দেওয়া ছবি" style="max-width:180px">' : '') + '</div>' +
      '<div class="row">' +
        (rec.state === 'rejected' ? '<button type="button" class="btn ghost" data-act="again">আবার তুলুন</button>' : '') +
        '<button type="button" class="btn primary big" data-act="next"' + (rec.state === 'sending' ? ' disabled' : '') + '>পরের আউটলেট</button>' +
      '</div>';
  }

  /* ---------- Regular → Display conversion ---------- */
  const CONV_LABEL = {
    '': ['', ''], queued: ['wait', 'পাঠানো বাকি'], Pending: ['warn', 'যাচাইয়ের অপেক্ষায়'],
    Approved: ['ok', 'ডিসপ্লে হয়েছে'], Rejected: ['bad', 'বাতিল, আবার জমা দিন']
  };

  function regularOutlets() { return uniqueOutlets(pjpList()).filter(o => /regular/i.test(o.status || '')); }

  function convertView() {
    const c = state.conv;
    if (c.result) return convResultView();
    if (c.capture) return convPreviewView();
    if (c.pick) { const o = outletByCode(c.pick); if (o) return convPickedView(o); }
    const all = regularOutlets();
    const st = o => convStatus(o.code);
    const nDone = all.filter(o => st(o) === 'Approved').length;
    const nWait = all.filter(o => st(o) === 'Pending' || st(o) === 'queued').length;
    const q = c.q.trim().toLowerCase();
    const shown = all.filter(o => {
      const x = st(o);
      const okF = c.filter === 'all' || (c.filter === 'todo' && (x === '' || x === 'Rejected')) ||
        (c.filter === 'wait' && (x === 'Pending' || x === 'queued')) || (c.filter === 'done' && x === 'Approved');
      return okF && (!c.route || o.route === c.route) && (!q || o.name.toLowerCase().indexOf(q) >= 0 || o.code.toLowerCase().indexOf(q) >= 0);
    });
    const seg = (k, label) => '<button type="button" data-act="convFilter" data-k="' + k + '" aria-pressed="' + (c.filter === k) + '">' + label + '</button>';
    const routes = Array.from(new Set(all.map(o => o.route).filter(Boolean))).sort();
    let h = '<div class="datehead"><h1>রেগুলার → ডিসপ্লে</h1><span class="muted small num">' + bn(all.length) + 'টি রেগুলার</span></div>' +
      '<div class="daystrip" style="grid-template-columns:repeat(3,1fr)">' +
        '<div><b>' + bn(nDone) + '</b><span>ডিসপ্লে হয়েছে</span></div>' +
        '<div><b>' + bn(nWait) + '</b><span>যাচাইয়ের অপেক্ষায়</span></div>' +
        '<div><b>' + bn(all.length - nDone - nWait) + '</b><span>বাকি</span></div></div>' +
      '<div class="seg" role="group" aria-label="ফিল্টার">' + seg('todo', 'বাকি') + seg('wait', 'অপেক্ষায়') + seg('done', 'ডিসপ্লে হয়েছে') + seg('all', 'সব') + '</div>' +
      '<div class="filters"><select class="input" id="convRoute" data-change="convRoute" aria-label="রুট"><option value="">সব রুট</option>' +
        routes.map(r => '<option' + (r === c.route ? ' selected' : '') + '>' + esc(r) + '</option>').join('') + '</select></div>' +
      '<input class="input" id="convSearch" type="search" placeholder="🔍 নাম বা কোড" value="' + esc(c.q) + '" autocomplete="off">' +
      '<div id="convList">' + convRows(shown) + '</div>';
    return h;
  }

  function convRows(list) {
    if (!list.length) return '<div class="empty"><p>কোনো আউটলেট নেই</p></div>';
    const more = Math.max(0, list.length - 80);
    const rows = list.slice(0, 80).map(o => {
      const x = convStatus(o.code), lab = CONV_LABEL[x] || ['', ''];
      const locked = x === 'Pending' || x === 'Approved' || x === 'queued';
      return '<button type="button" class="outlet" data-act="convPick" data-code="' + esc(o.code) + '"' + (locked ? ' disabled' : '') + '>' +
        '<span class="name">' + esc(o.name) + '</span>' +
        '<span class="side">' + (lab[1] ? '<span class="chip ' + lab[0] + '">' + lab[1] + '</span>' : '<span class="otag display">→ ডিসপ্লে</span>') + '</span>' +
        '<span class="meta">' + esc(o.code) + ' · ' + esc(o.route) + '</span></button>';
    }).join('');
    return '<div class="list">' + rows + '</div>' + (more ? '<p class="muted small">আরও ' + bn(more) + 'টি আছে। খুঁজে বা রুট দিয়ে বের করুন।</p>' : '');
  }

  function convPickedView(o) {
    return '<div class="picked disp"><div class="top"><div><div class="name">' + esc(o.name) + '</div>' +
      '<div class="muted small">' + esc(o.code) + ' · ' + esc(o.route) + '</div></div>' +
      '<button type="button" class="btn line small" data-act="convUnpick">বদলান</button></div>' +
      '<div class="row" style="align-items:center;gap:8px"><span class="tag">' + esc(o.status || 'Regular') + '</span><span aria-hidden="true">→</span><span class="tag display">Display</span></div></div>' +
      (convStatus(o.code) === 'Rejected' ? '<div class="banner notice">আগেরটি বাতিল হয়েছিল · আবার জমা দিন</div>' : '') +
      '<div class="hint">' + ICON.pin + '<span>নতুন স্মাইল কর্নার পুরোটা ফ্রেমে আনুন</span></div>' +
      '<button type="button" class="btn primary big block" data-act="convCamera">' + ICON.camera + 'ডিসপ্লের ছবি তুলুন</button>' +
      (DEMO ? '<label class="btn line small block" for="convFile">গ্যালারি থেকে (শুধু ডেমো)<input id="convFile" type="file" accept="image/*" data-change="convFile" hidden></label>' : '');
  }

  function convPreviewView() {
    const c = state.conv.capture, o = outletByCode(state.conv.pick) || { name: '', code: state.conv.pick };
    return '<h2>রূপান্তরের ছবি</h2>' +
      '<img class="preview-img" src="' + c.image + '" alt="' + esc(o.name) + ' আউটলেটের নতুন ডিসপ্লে">' +
      '<dl class="facts"><dt>আউটলেট</dt><dd>' + esc(o.name) + ' (' + esc(o.code) + ')</dd>' +
      '<dt>পরিবর্তন</dt><dd>রেগুলার → ডিসপ্লে</dd>' +
      '<dt>লোকেশন</dt><dd>' + (c.lat != null ? bn(c.lat.toFixed(5) + ', ' + c.lon.toFixed(5)) + ' (±' + bn(Math.round(c.acc)) + ' মি)' : 'পাওয়া যায়নি') + '</dd></dl>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="convCamera">আবার তুলুন</button>' +
      '<button type="button" class="btn primary" data-act="convSubmit">রূপান্তর জমা দিন</button></div>';
  }

  function convResultView() {
    const rec = state.conv.result.rec;
    let cls = 'wait', title = 'পাঠানো হচ্ছে…', body = '<div class="spinner"></div>';
    let mark = '…';
    if (rec.state === 'accepted') { cls = 'ok'; mark = '✓'; title = 'রূপান্তর জমা হয়েছে'; body = '<p>অ্যাডমিন অনুমোদন দেবেন</p>'; }
    else if (rec.state === 'rejected' || rec.state === 'attention') { cls = 'bad'; mark = '✕'; title = 'জমা হয়নি'; body = '<p>' + esc(rec.message) + '</p>'; }
    else if (rec.state === 'queued') { mark = '⇡'; title = 'ফোনে রাখা আছে'; body = '<p>নেট পেলে নিজেই জমা হবে</p>'; }
    return '<div class="result ' + cls + '" role="status"><div class="big">' + mark + '</div><h2>' + title + '</h2>' + body + '</div>' +
      (rec.thumb ? '<img class="preview-img" src="' + rec.thumb + '" alt="জমা দেওয়া ছবি" style="max-width:220px">' : '') +
      '<button type="button" class="btn primary block" data-act="convNext"' + (rec.state === 'sending' ? ' disabled' : '') + '>তালিকায় ফিরে যান</button>';
  }

  /* ---------- My Photos ---------- */
  function statusOf(p) {
    if (p.local) {
      if (p.state === 'queued') return ['wait', 'ফোনে আছে, পাঠানো বাকি'];
      if (p.state === 'sending') return ['wait', 'পাঠানো হচ্ছে'];
      if (p.state === 'rejected') return ['bad', 'বাতিল'];
      if (p.state === 'attention') return ['bad', 'জমা হয়নি, দেখুন'];
      if (p.state === 'flagged') return ['warn', 'জমা হয়েছে, যাচাই বাকি'];
      return ['ok', 'জমা হয়েছে'];
    }
    if (p.status === 'Rejected' || p.dupStatus === 'Rejected' || /^reject/i.test(p.reviewDecision)) return ['bad', 'বাতিল'];
    if (p.status === 'Pending review') return ['warn', 'যাচাই বাকি'];
    if (p.status === 'Approved') return ['ok', /^accept/i.test(p.reviewDecision) ? 'যাচাই করে গৃহীত' : 'গৃহীত'];
    if (p.dupStatus === 'Flagged' && !/^accept/i.test(p.reviewDecision)) return ['warn', 'যাচাই বাকি'];
    return ['ok', 'জমা হয়েছে'];
  }
  function aiLine(p) {
    if (p.local) return p.message || '';
    if (p.dupStatus === 'Rejected') return p.dupReason;
    const parts = [];
    const type = p.outletType || '';
    if (type === 'Display') {
      if (p.valid === 'Yes') parts.push('ডিসপ্লে দেখা গেছে');
      else if (p.valid === 'Not visible' || p.valid === 'Unclear' || p.valid === 'No') parts.push('ডিসপ্লে দেখা যায়নি: যাচাই হবে');
    }
    const pp = p.premiumPresence || (p.aiStatus === 'Done' ? (p.premium ? 'Yes' : 'No') : '');
    if (pp === 'Yes') parts.push('প্রিমিয়াম: ' + (p.premium || 'আছে'));
    else if (pp === 'No') parts.push('প্রিমিয়াম নেই');
    else if (pp === 'Needs review') parts.push('প্রিমিয়াম নিশ্চিত নয়');
    if (p.dupReason) parts.push(p.dupReason);
    return parts.join('. ');
  }

  /* Photos are private in Drive, so preview images come from the server with the login (12 at a time) and are kept on the phone. */
  let thumbTimer = 0;
  const thumbWant = new Set();
  function thumbFor(p) {
    if (p.thumb) return p.thumb;
    const id = p.fileId;
    if (!id) return '';
    if (state.thumbs[id]) return state.thumbs[id];
    if (state.thumbs[id] === undefined) { thumbWant.add(id); clearTimeout(thumbTimer); thumbTimer = setTimeout(fetchThumbs, 60); }
    return '';
  }
  async function fetchThumbs() {
    const ids = Array.from(thumbWant).slice(0, 12);
    ids.forEach(id => { thumbWant.delete(id); state.thumbs[id] = null; });
    if (!ids.length) return;
    const need = [];
    for (const id of ids) {
      const saved = await DB.kvGet('thumb:' + id);
      if (saved) state.thumbs[id] = saved; else need.push(id);
    }
    if (need.length && state.online) {
      const res = await api('thumbs', { ids: need });
      if (res.ok && res.thumbs) Object.keys(res.thumbs).forEach(id => { state.thumbs[id] = res.thumbs[id]; DB.kvSet('thumb:' + id, res.thumbs[id]); });
    }
    if (['photos', 'admin'].indexOf(state.tab) >= 0) render();
    if (thumbWant.size) thumbTimer = setTimeout(fetchThumbs, 60);
  }
  const localPhoto = r => ({ local: true, uploadId: r.clientId, state: r.state, message: r.message, thumb: r.thumb, code: r.outletCode,
    outletName: r.outletName, outletType: r.outletType, premium: r.premium, ts: new Date(r.createdAt).toISOString(), doneAt: r.doneAt });

  function photosView() {
    const cur = monthKey(new Date());
    if (!state.photos && !state.photosLoading) loadPhotos();
    const serverIds = new Set((state.photos || []).map(p => p.uploadId));
    const local = state.local.filter(r => r.kind !== 'convert' && r.month === state.photosMonth && (!serverIds.has(r.clientId) || r.state === 'queued' || r.state === 'sending'))
      .map(localPhoto);
    const all = local.concat(state.photos || []);
    let h = '<div class="monthnav"><button type="button" class="iconbtn" data-act="month" data-d="-1" aria-label="আগের মাস">‹</button>' +
      '<h2>' + esc(monthName(state.photosMonth)) + '</h2>' +
      '<button type="button" class="iconbtn" data-act="month" data-d="1" aria-label="পরের মাস"' + (state.photosMonth >= cur ? ' disabled' : '') + '>›</button></div>';
    if (pendingCount()) h += '<button type="button" class="btn ghost block" data-act="sync">' + ICON.refresh + bn(pendingCount()) + 'টি এখন পাঠান</button>';
    if (!state.online) h += '<p class="small muted">অফলাইন · শুধু ফোনের ছবি</p>';
    if (state.photosLoading && !state.photos) return h + '<div class="empty"><div class="spinner"></div></div>';
    if (!all.length) return h + '<div class="empty"><p>এই মাসে কোনো ছবি নেই</p><button type="button" class="btn primary" data-act="tab" data-tab="capture">ছবি তুলুন</button></div>';
    h += '<div class="photos">' + all.map(p => {
      const st = statusOf(p), url = thumbFor(p);
      return '<button type="button" class="photo" data-act="photo" data-id="' + esc(p.uploadId) + '" style="border:0;background:none;padding:0;text-align:left">' +
        '<div class="img" style="' + (url ? 'background-image:url(\'' + esc(url) + '\')' : '') + '"><span class="chip ' + st[0] + '">' + st[1] + '</span></div>' +
        '<b>' + esc(p.outletName || p.code) + '</b>' +
        '<span>' + esc(p.code) + ' · ' + esc(new Date(p.ts).toLocaleDateString('bn-BD', { day: 'numeric', month: 'short' })) + ' ' + timeOf(p.ts) + '</span></button>';
    }).join('') + '</div>';
    return h;
  }

  async function loadPhotos() {
    state.photosLoading = true;
    const res = await api('myPhotos', { month: state.photosMonth });
    state.photosLoading = false;
    state.photos = res.ok ? res.photos : [];
    if (!res.ok && state.online) toast(res.message || 'ছবি লোড হয়নি');
    if (state.tab === 'photos') render();
  }

  function photoSheet(id) {
    const p = (state.photos || []).find(x => x.uploadId === id) || state.local.filter(r => r.clientId === id).map(localPhoto)[0];
    if (!p) return;
    const st = statusOf(p);
    const big = thumbFor(p);
    const pr = p.local ? (p.premium || { presence: 'Not checked' }) : { presence: p.premiumPresence || 'Not checked' };
    const pl = PREMIUM_BN[pr.presence] || ['', pr.presence];
    openSheet('<div class="row" style="justify-content:space-between;align-items:center"><h2>' + esc(p.outletName || p.code) + '</h2>' +
      '<span class="chip ' + st[0] + '">' + st[1] + '</span></div>' +
      (big ? boxedImage(big, p.local ? p.premium : null, p.outletName || p.code) : '<p class="muted small">ছবি লোড হচ্ছে…</p>') +
      '<dl class="facts"><dt>কোড</dt><dd>' + esc(p.code) + (p.outletType ? ' (' + (p.outletType === 'Display' ? 'ডিসপ্লে' : 'রেগুলার') + ')' : '') + '</dd>' +
      '<dt>ছবি তোলা</dt><dd>' + esc(new Date(p.ts).toLocaleString('bn-BD')) + '</dd>' +
      (p.uploadedAt && p.uploadedAt !== p.ts ? '<dt>জমা</dt><dd>' + esc(new Date(p.uploadedAt).toLocaleString('bn-BD')) + '</dd>' : '') +
      (p.local && p.doneAt ? '<dt>জমা</dt><dd>' + esc(new Date(p.doneAt).toLocaleString('bn-BD')) + '</dd>' : '') +
      '<dt>অবস্থা</dt><dd>' + esc(st[1]) + (p.local && (p.state === 'queued' || p.state === 'attention') ? ' (ছবিটি এই ফোনে নিরাপদে আছে)' : '') + '</dd>' +
      (p.photoNo ? '<dt>এই মাসে</dt><dd>' + bn(p.photoNo) + ' নম্বর ছবি</dd>' : '') +
      '<dt>প্রিমিয়াম</dt><dd>' + esc(pl[1]) + '</dd>' +
      '<dt>ফলাফল</dt><dd>' + esc(aiLine(p) || '—') + '</dd>' +
      (p.notes ? '<dt>নোট</dt><dd>' + esc(p.notes) + '</dd>' : '') +
      (p.comment ? '<dt>AI মন্তব্য</dt><dd>' + esc(p.comment) + '</dd>' : '') + '</dl>' +
      (p.local && p.state === 'queued' ? '<button type="button" class="btn primary block" data-act="sync">এখন পাঠান</button>' : '') +
      (p.local && p.state === 'attention' ? '<button type="button" class="btn primary block" data-act="retryOne" data-id="' + esc(p.uploadId) + '">আবার পাঠানোর চেষ্টা করুন</button>' : '') +
      '<button type="button" class="btn ghost block" data-act="closeSheet">বন্ধ করুন</button>');
  }

  /* ---------- monthly progress (merchandiser) ---------- */
  function progressView() {
    const list = uniqueOutlets(pjpList()), max = maxPerMonth();
    const n2 = list.filter(o => monthCount(o.code) >= max).length;
    const n1 = list.filter(o => { const n = monthCount(o.code); return n > 0 && n < max; }).length;
    const n0 = list.length - n2 - n1;
    const pct = v => list.length ? (v / list.length * 100).toFixed(1) + '%' : '0';
    const f = state.progressFilter;
    const shown = list.filter(o => {
      const n = monthCount(o.code);
      return f === 'all' || (f === 'none' && n === 0) || (f === 'one' && n > 0 && n < max) || (f === 'done' && n >= max);
    });
    const seg = (k, label) => '<button type="button" data-act="pfilter" data-k="' + k + '" aria-pressed="' + (f === k) + '">' + label + '</button>';
    return '<div class="datehead"><h1>' + esc(monthName(state.boot ? state.boot.month : monthKey(new Date()))) + '</h1>' +
      '<span class="muted small num">' + bn(list.length) + 'টি আউটলেট</span></div>' +
      '<div class="bar" role="img" aria-label="সম্পূর্ণ ' + n2 + ', একটি ছবি ' + n1 + ', বাকি ' + n0 + '"><i class="b2" style="width:' + pct(n2) + '"></i><i class="b1" style="width:' + pct(n1) + '"></i></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>সম্পূর্ণ ' + bn(n2) + '</span><span><i style="background:var(--warn)"></i>১টি ছবি ' + bn(n1) +
      '</span><span><i style="background:var(--line)"></i>কোনো ছবি নেই ' + bn(n0) + '</span></div>' +
      '<div class="seg" role="group" aria-label="ফিল্টার">' + seg('all', 'সব') + seg('none', 'বাকি') + seg('one', '১টি') + seg('done', 'সম্পূর্ণ') + '</div>' +
      (shown.length ? outletRows(shown, true) : '<div class="empty"><p>এই ফিল্টারে কোনো আউটলেট নেই।</p></div>');
  }

  /* ---------- admin ---------- */
  function adminProgressView() {
    if (!state.admin && !state.adminLoading) loadAdmin();
    if (!state.admin) return '<div class="empty"><div class="spinner"></div></div>';
    const p = state.admin.progress || [];
    const tot = p.reduce((a, r) => ({ o: a.o + r.outlets, d: a.d + r.done, one: a.one + r.one, n: a.n + r.none }), { o: 0, d: 0, one: 0, n: 0 });
    const pct = v => tot.o ? (v / tot.o * 100).toFixed(1) + '%' : '0';
    return '<div class="datehead"><h1>' + esc(monthName(monthKey(new Date()))) + '</h1><span class="muted small num">' + bn(tot.o) + 'টি আউটলেট</span></div>' +
      '<div class="bar"><i class="b2" style="width:' + pct(tot.d) + '"></i><i class="b1" style="width:' + pct(tot.one) + '"></i></div>' +
      '<div class="legend"><span><i style="background:var(--ok)"></i>২টি ছবি ' + bn(tot.d) + '</span><span><i style="background:var(--warn)"></i>১টি ছবি ' + bn(tot.one) +
      '</span><span><i style="background:var(--line)"></i>কোনো ছবি নেই ' + bn(tot.n) + '</span></div>' +
      '<div class="tablewrap"><table><thead><tr><th>মার্চেন্ডাইজার</th><th>আউটলেট</th><th>২/২</th><th>১/২</th><th>০/২</th><th>আজ</th><th>রূপান্তর</th></tr></thead><tbody>' +
      p.map(r => '<tr><td>' + esc(r.merch) + '</td><td>' + r.outlets + '</td><td>' + r.done + '</td><td>' + r.one + '</td><td>' + r.none + '</td><td>' + r.today + '</td><td>' + (r.conversions || 0) + '</td></tr>').join('') +
      '</tbody></table></div>' +
      '<button type="button" class="btn ghost block" data-act="adminRefresh">' + ICON.refresh + 'নতুন করে লোড করুন</button>';
  }

  async function loadAdmin() {
    state.adminLoading = true;
    const [a, r] = await Promise.all([api('adminStats'), api('reviewList')]);
    state.adminLoading = false;
    state.admin = a.ok ? a : { today: {}, progress: [] };
    state.review = r.ok ? r.items : [];
    if (state.tab === 'admin' || state.tab === 'progress') render();
  }

  function adminView() {
    if (!state.admin && !state.adminLoading) loadAdmin();
    if (!state.admin) return '<div class="empty"><div class="spinner"></div></div>';
    const a = state.admin, t = a.today || {};
    const s = (state.boot && state.boot.settings) || {};
    const stat = (v, l) => '<div><b>' + bn(v == null ? 0 : v) + '</b><span>' + l + '</span></div>';
    let h = '<div class="datehead"><h1>আজকের অবস্থা</h1><button type="button" class="iconbtn" data-act="adminRefresh" aria-label="নতুন করে লোড">' + ICON.refresh + '</button></div>' +
      '<div class="stats">' + stat(t.uploads, 'আজকের ছবি') + stat(t.people, 'কাজ করছেন') + stat(t.flagged, 'যাচাই বাকি') +
      stat(t.rejected, 'বাতিল') + (a.aiProvider === 'Gemini' ? stat(a.aiPending, 'AI বাকি') : '<div><b>বন্ধ</b><span>বাইরের AI</span></div>') + stat(a.openReviews, 'রিভিউ বাকি') + '</div>' +
      (a.conversions ? '<p class="small">এই মাসের রূপান্তর: অনুমোদিত <b>' + bn(a.conversions.approved) + '</b>, অপেক্ষায় <b>' +
        bn(a.conversions.pending) + '</b>, বাতিল <b>' + bn(a.conversions.rejected) + '</b></p>' : '');

    h += '<div class="section"><h2>রিভিউ</h2>';
    const items = state.review || [];
    if (!items.length) h += '<div class="empty"><p>সব রিভিউ শেষ ✓</p></div>';
    items.forEach(it => {
      const u1 = thumbFor({ thumb: it.thumb, fileId: it.fileId });
      const u2 = thumbFor({ thumb: it.matchedThumb, fileId: it.matchedFileId });
      const rejected = it.type === 'Rejected', isConv = it.type === 'Conversion', note = !rejected && !isConv && it.blocking === false;
      const label = rejected ? ['bad', 'বাতিল হয়েছে (নিয়ম)'] : isConv ? ['ok', 'রূপান্তর'] :
        it.type === 'Possible conversion' ? ['warn', 'রূপান্তর হতে পারে'] : it.type === 'Premium check' || it.type === 'Check AI' ? ['warn', 'প্রিমিয়াম নিশ্চিত নয়'] :
        note ? ['wait', 'নোট'] : ['warn', 'যাচাই বাকি: ছবি আটকে আছে'];
      h += '<div class="review">' +
        '<div class="row" style="justify-content:space-between;align-items:center"><b>' + esc(it.code) + '  ' + esc(it.merch) + '</b>' +
        '<span class="chip ' + label[0] + '">' + label[1] + '</span></div>' +
        '<p class="small">' + esc(it.reason) + '</p>' +
        (it.aiSameShop ? '<p class="small muted">AI তুলনা: ' + esc(it.aiSameShop) + '</p>' : '') +
        '<div class="pair"><div style="' + (u1 ? 'background-image:url(\'' + esc(u1) + '\')' : '') + '"><span>' + (isConv ? 'নতুন ডিসপ্লে' : 'এই ছবি') + '</span></div>' +
        (u2 ? '<div style="background-image:url(\'' + esc(u2) + '\')"><span>' + (isConv ? 'আগের ভিজিট' : 'যার সাথে মিলেছে') + '</span></div>' : '') + '</div>' +
        '<p class="small muted">' + esc(new Date(it.loggedAt).toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })) + '</p>' +
        '<div class="row">' + (rejected || note
          ? '<button type="button" class="btn ghost" data-act="decide" data-id="' + esc(it.uploadId) + '" data-d="Seen">দেখেছি</button>'
          : '<button type="button" class="btn ghost" data-act="decide" data-id="' + esc(it.uploadId) + '" data-d="Reject">বাতিল করুন</button>' +
            '<button type="button" class="btn primary" data-act="decide" data-id="' + esc(it.uploadId) + '" data-d="Accept">' + (isConv ? 'অনুমোদন দিন' : 'গ্রহণ করুন') + '</button>') +
        '</div></div>';
    });
    h += '</div>';

    h += '<div class="section"><h2>সবার জন্য নোটিশ</h2>' +
      '<textarea class="input" id="noticeText" maxlength="500" placeholder="সবার জন্য নোটিশ">' + esc(s.notice || '') + '</textarea>' +
      '<div class="row"><button type="button" class="btn ghost" data-act="clearNotice">মুছে ফেলুন</button><button type="button" class="btn primary" data-act="saveNotice">নোটিশ সেভ করুন</button></div>' +
      '<label class="switch" for="maintToggle"><span><b>মেইনটেন্যান্স</b><br><span class="small muted">শুধু অ্যাডমিন ঢুকতে পারবেন</span></span>' +
      '<input type="checkbox" id="maintToggle" data-change="maint"' + (s.maintenance ? ' checked' : '') + '></label>' +
      '<label class="switch" for="qualityToggle"><span><b>কঠোর মান যাচাই</b><br><span class="small muted">চালু: সব ঠিক না হলে ছবি তোলা যাবে না</span></span>' +
      '<input type="checkbox" id="qualityToggle" data-change="qualityMode"' + (s.quality_mode === 'block' ? ' checked' : '') + '></label></div>';

    h += '<div class="section"><h2>TM / SR লগইন</h2>' +
      '<p class="small muted">' + (s.tm_login_on ? 'চালু · বদলালে সবাই লগআউট হবেন' : 'বন্ধ') + '</p>' +
      '<input class="input" id="tmPwInput" type="text" autocomplete="off" placeholder="নতুন পাসওয়ার্ড (৬+ অক্ষর)">' +
      '<div class="row">' + (s.tm_login_on ? '<button type="button" class="btn ghost" data-act="tmPwOff">বন্ধ করুন</button>' : '') +
      '<button type="button" class="btn primary" data-act="tmPwSave">পাসওয়ার্ড সেভ করুন</button></div></div>';

    return h;
  }

  /* ---------- new outlet ---------- */
  function newOutletForm() {
    const all = pjpList();
    const dbs = {};
    all.forEach(o => { if (o.dbName) dbs[o.dbName] = o.dbCode; });
    const slabs = Array.from(new Set(all.map(o => o.slab).filter(Boolean))).sort();
    return '<form id="outletForm" class="section" novalidate>' +
      '<h2>নতুন আউটলেট এন্ট্রি</h2>' +
      '<label class="field" for="noDb">ডিস্ট্রিবিউটর *<select class="input" id="noDb" data-change="noDb" required><option value="">বাছুন</option>' +
        Object.keys(dbs).sort().map(d => '<option value="' + esc(d) + '" data-code="' + esc(dbs[d]) + '">' + esc(d) + ' (' + esc(dbs[d]) + ')</option>').join('') + '</select></label>' +
      '<label class="field" for="noRoute">রুট *<select class="input" id="noRoute" required disabled><option value="">আগে ডিস্ট্রিবিউটর বাছুন</option></select></label>' +
      '<label class="field" for="noName">দোকানের নাম *<input class="input" id="noName" required maxlength="80"></label>' +
      '<label class="field" for="noOwner">মালিকের নাম *<input class="input" id="noOwner" required maxlength="60"></label>' +
      '<label class="field" for="noPhone">মোবাইল নম্বর *<input class="input" id="noPhone" inputmode="numeric" maxlength="11" placeholder="01XXXXXXXXX" required></label>' +
      '<label class="field" for="noSlab">স্ল্যাব *<select class="input" id="noSlab" required><option value="">বাছুন</option>' +
        slabs.map(s => '<option>' + esc(s) + '</option>').join('') + '</select></label>' +
      '<p class="error" id="noError" role="alert"></p>' +
      '<button type="submit" class="btn primary block" id="noSubmit">আউটলেট সেভ করুন</button></form>';
  }
  function newOutletView() { return newOutletForm(); }

  /* ======================= sheet + toast ======================= */
  function openSheet(html) {
    closeSheet();
    const bg = document.createElement('div');
    bg.className = 'sheet-bg'; bg.id = 'sheetBg';
    bg.innerHTML = '<div class="sheet" role="dialog" aria-modal="true">' + html + '</div>';
    bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
    document.body.appendChild(bg);
    wireForms(bg);
  }
  function closeSheet() { const b = document.getElementById('sheetBg'); if (b) b.remove(); }
  let toastTimer = 0;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  /* ======================= actions ======================= */
  const actions = {
    tab(el) {
      state.tab = el.dataset.tab;
      if (state.tab === 'photos') { state.photos = null; state.photosMonth = monthKey(new Date()); }
      if (state.tab === 'admin' || state.tab === 'progress') { if (!isMerch()) state.admin = null; }
      // Refresh outlet data (month counts, premium, conversions) if it is more than 2 minutes old.
      if (['today', 'progress', 'convert', 'capture'].indexOf(state.tab) >= 0 && Date.now() - (state.bootAt || 0) > 120000) quietRefresh();
      render(); window.scrollTo(0, 0);
    },
    logout() {
      openSheet('<h2>লগআউট করবেন?</h2>' + (pendingCount() ? '<p>' + bn(pendingCount()) + 'টি ছবি এখনও পাঠানো বাকি। আবার লগইন করলে সেগুলো পাঠানো হবে।</p>' : '') +
        '<div class="row"><button type="button" class="btn ghost" data-act="closeSheet">না</button><button type="button" class="btn primary" data-act="logoutYes">লগআউট</button></div>');
    },
    logoutYes() { closeSheet(); logout(false); },
    closeSheet() { closeSheet(); },
    reload() { location.reload(); },
    sync() { closeSheet(); if (!state.online) { toast('ইন্টারনেট নেই'); return; } processQueue().then(() => { state.photos = null; render(); }); },
    pick(el) {
      state.pick = el.dataset.code; state.capture = null; state.result = null; state.tab = 'capture';
      render(); window.scrollTo(0, 0);
    },
    unpick() { state.pick = null; render(); },
    dayStep(el) {
      const d = dateOfKey(isDateKey(state.dayDate) ? state.dayDate : dateKeyOf(new Date()));
      d.setDate(d.getDate() + Number(el.dataset.step || 0));
      state.dayDate = dateKeyOf(d); render();
    },
    dayToday() { state.dayDate = dateKeyOf(new Date()); render(); },
    async camera() {
      const o = outletByCode(state.pick);
      if (!o) return;
      const type = outletType(o);
      if (DEMO) demo.scene.setType(type);
      const cap = await window.GuidedCamera.open({
        outlet: { code: o.code, name: o.name }, outletType: type, merchName: state.user.name, settings: (state.boot && state.boot.settings) || {},
        modelUrl: CFG.GUIDE_MODEL_URL || '', demoScene: DEMO ? demo.scene : null
      });
      if (cap) {
        cap.premium = await window.PremiumModel.analyze(cap, { demo: DEMO, outletType: type });
        state.capture = cap; render(); window.scrollTo(0, 0);
      }
    },
    retake() { state.capture = null; actions.camera(); },
    async submit(el) {
      el.disabled = true;
      const o = outletByCode(state.pick);
      const rec = await enqueue(state.capture, o);
      state.capture = null;
      state.result = { rec: rec };
      render();
      if (!state.online) { rec.message = 'ইন্টারনেট নেই।'; render(); return; }
      await sendOne(rec);
      render();
      renderSync();
      if (pendingCount()) processQueue();
    },
    next() { state.result = null; state.capture = null; state.pick = null; state.tab = isMerch() ? 'today' : 'capture'; render(); window.scrollTo(0, 0); },
    again() { state.result = null; render(); actions.camera(); },
    month(el) {
      const [y, m] = state.photosMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
      if (monthKey(d) > monthKey(new Date())) return;
      state.photosMonth = monthKey(d); state.photos = null; render();
    },
    photo(el) { photoSheet(el.dataset.id); },
    pfilter(el) { state.progressFilter = el.dataset.k; render(); },
    async checkin(el) {
      el.disabled = true; el.textContent = 'লোকেশন নেওয়া হচ্ছে…';
      const pos = await getPosition();
      const res = await api('checkIn', pos || {});
      if (res.ok) { state.boot.checkIn = res.time; store.set('boot', state.boot); toast('দিন শুরু হয়েছে'); }
      else toast(res.message || 'হাজিরা দেওয়া যায়নি');
      render();
    },
    adminRefresh() { state.admin = null; state.review = null; render(); },
    decide(el) {
      const id = el.dataset.id, d = el.dataset.d;
      if (d === 'Seen') { doDecide(id, 'Seen', ''); return; }
      const quick = d === 'Accept'
        ? ['যাচাই করেছি: আলাদা দোকান', 'যাচাই করেছি: ঠিক আছে', 'ডিসপ্লে আছে, ছবিতে বোঝা যাচ্ছিল না', 'কারণ যুক্তিসঙ্গত', 'নতুন ডিসপ্লে বসানো হয়েছে']
        : ['অন্য আউটলেটের ছবি', 'একই ছবি আবার দেওয়া', 'লোকেশন মিলছে না', 'ছবি অস্পষ্ট / ভুল জিনিসের ছবি', 'ডিসপ্লে নেই'];
      openSheet('<h2>' + (d === 'Accept' ? 'গ্রহণ / অনুমোদন করবেন?' : 'বাতিল করবেন?') + '</h2>' +
        '<p class="small muted">কারণ লিখুন বা বেছে নিন। এটি Review_Log-এ স্থায়ীভাবে থাকবে।</p>' +
        '<div class="reasons">' + quick.map(q => '<button type="button" data-act="reasonPick">' + esc(q) + '</button>').join('') + '</div>' +
        '<textarea class="input" id="decReason" maxlength="300" placeholder="কারণ"></textarea>' +
        '<div class="row"><button type="button" class="btn ghost" data-act="closeSheet">ফিরে যান</button>' +
        '<button type="button" class="btn primary" data-act="decideGo" data-id="' + esc(id) + '" data-d="' + d + '">' + (d === 'Accept' ? 'গ্রহণ করুন' : 'বাতিল করুন') + '</button></div>');
    },
    reasonPick(el) { const t = document.getElementById('decReason'); if (t) t.value = el.textContent; },
    decideGo(el) {
      const reason = ((document.getElementById('decReason') || {}).value || '').trim();
      if (!reason) { toast('কারণ লিখুন'); return; }
      closeSheet();
      doDecide(el.dataset.id, el.dataset.d, reason);
    },
    async retryOne(el) {
      const rec = state.local.find(r => r.clientId === el.dataset.id);
      closeSheet();
      if (!rec) return;
      if (!state.online) { toast('ইন্টারনেট নেই'); return; }
      await sendOne(rec); render(); renderSync();
    },
    async saveNotice() {
      const txt = (document.getElementById('noticeText') || {}).value || '';
      const res = await api('saveSettings', { notice: txt.trim() });
      if (res.ok) { state.boot.settings.notice = txt.trim(); toast(txt.trim() ? 'নোটিশ সেভ হয়েছে' : 'নোটিশ মুছে ফেলা হয়েছে'); render(); }
      else toast(res.message || 'সেভ হয়নি');
    },
    convFilter(el) { state.conv.filter = el.dataset.k; render(); },
    convPick(el) { state.conv.pick = el.dataset.code; state.conv.capture = null; state.conv.result = null; render(); window.scrollTo(0, 0); },
    convUnpick() { state.conv.pick = null; render(); },
    async convCamera() {
      const o = outletByCode(state.conv.pick);
      if (!o) return;
      // The CM photographs the NEW display, so the Display rules apply.
      if (DEMO) demo.scene.setType('Display');
      const cap = await window.GuidedCamera.open({
        outlet: { code: o.code, name: o.name }, outletType: 'Display', merchName: state.user.name, settings: (state.boot && state.boot.settings) || {},
        modelUrl: CFG.GUIDE_MODEL_URL || '', demoScene: DEMO ? demo.scene : null
      });
      if (cap) { state.conv.capture = cap; render(); window.scrollTo(0, 0); }
    },
    async convSubmit(el) {
      el.disabled = true;
      const o = outletByCode(state.conv.pick);
      const rec = await enqueue(state.conv.capture, o, 'convert');
      state.conv.capture = null;
      state.conv.result = { rec: rec };
      render();
      if (!state.online) return;
      await sendOne(rec);
      if (rec.state === 'accepted' && state.boot) { state.boot.conversions = state.boot.conversions || {}; state.boot.conversions[o.code] = 'Pending'; }
      render(); renderSync();
    },
    convNext() { state.conv.pick = null; state.conv.capture = null; state.conv.result = null; render(); window.scrollTo(0, 0); },
    loginMode(el) { state.loginMode = el.dataset.m; state.loginError = ''; store.set('loginMode', state.loginMode); render(); },
    async tmPwSave() {
      const v = ((document.getElementById('tmPwInput') || {}).value || '').trim();
      if (v.length < 6) { toast('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন'); return; }
      const res = await api('saveSettings', { tmPassword: v });
      if (res.ok) { state.boot.settings.tm_login_on = true; toast('TM / SR পাসওয়ার্ড সেভ হয়েছে'); render(); }
      else toast(res.message || 'সেভ হয়নি');
    },
    async tmPwOff() {
      const res = await api('saveSettings', { tmPassword: '' });
      if (res.ok) { state.boot.settings.tm_login_on = false; toast('TM / SR লগইন বন্ধ'); render(); }
      else toast(res.message || 'সেভ হয়নি');
    },
    clearNotice() { const t = document.getElementById('noticeText'); if (t) t.value = ''; actions.saveNotice(); },
    openOutlet() { openSheet(newOutletForm() + '<button type="button" class="btn ghost block" data-act="closeSheet">বন্ধ করুন</button>'); }
  };

  const changes = {
    convRoute(el) { state.conv.route = el.value; render(); },
    async convFile(el) {
      const file = el.files && el.files[0];
      if (!file) return;
      const o = outletByCode(state.conv.pick);
      try {
        state.conv.capture = await window.GuidedCamera.fromFile(file, { outlet: { code: o.code, name: o.name }, outletType: 'Display', merchName: state.user.name });
        render(); window.scrollTo(0, 0);
      } catch (e) { toast(e.message); }
    },
    async demoFile(el) {
      const file = el.files && el.files[0];
      if (!file) return;
      const o = outletByCode(state.pick);
      try {
        state.capture = await window.GuidedCamera.fromFile(file, { outlet: { code: o.code, name: o.name }, outletType: outletType(o), merchName: state.user.name });
        state.capture.premium = { presence: 'Not checked', items: [] };
        render(); window.scrollTo(0, 0);
      } catch (e) { toast(e.message); }
    },
    day(el) { state.day = el.value; render(); },
    dayDate(el) { if (isDateKey(el.value)) { state.dayDate = el.value; render(); } },
    fRegion(el) { state.f.region = el.value; state.f.db = ''; state.f.route = ''; render(); },
    fDb(el) { state.f.db = el.value; state.f.route = ''; render(); },
    fRoute(el) { state.f.route = el.value; render(); },
    async qualityMode(el) {
      const mode = el.checked ? 'block' : 'warn';
      const res = await api('saveSettings', { qualityMode: mode });
      if (res.ok) { state.boot.settings.quality_mode = mode; toast(el.checked ? 'কঠোর মান যাচাই চালু' : 'শুধু সতর্কতা মোড'); }
      else { el.checked = !el.checked; toast(res.message || 'সেভ হয়নি'); }
    },
    async maint(el) {
      const res = await api('saveSettings', { maintenance: el.checked });
      if (res.ok) { state.boot.settings.maintenance = el.checked; toast(el.checked ? 'মেইনটেন্যান্স মোড চালু' : 'মেইনটেন্যান্স মোড বন্ধ'); }
      else { el.checked = !el.checked; toast(res.message || 'সেভ হয়নি'); }
    },
    noDb(el) {
      const scope = el.closest('form');
      const routeSel = scope.querySelector('#noRoute');
      const routes = {};
      pjpList().filter(o => o.dbName === el.value).forEach(o => { if (o.route) routes[o.route] = o.routeCode; });
      routeSel.innerHTML = '<option value="">রুট বাছুন</option>' + Object.keys(routes).sort().map(r => '<option value="' + esc(r) + '" data-code="' + esc(routes[r]) + '">' + esc(r) + '</option>').join('');
      routeSel.disabled = !Object.keys(routes).length;
    }
  };

  async function doDecide(id, decision, reason) {
    const res = await api('reviewDecide', { uploadId: id, decision: decision, reason: reason });
    if (res.ok) { state.review = (state.review || []).filter(r => r.uploadId !== id); if (state.admin) state.admin.openReviews = state.review.length; toast('সেভ হয়েছে'); }
    else toast(res.message || 'সেভ হয়নি');
    render();
  }

  function getPosition() {
    if (DEMO) return Promise.resolve({ lat: 23.7808, lon: 90.4067, acc: 15 });
    return new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        () => res(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  async function submitOutlet(form) {
    const q = id => form.querySelector('#' + id);
    const err = q('noError');
    const db = q('noDb'), route = q('noRoute');
    const data = {
      distName: db.value, distCode: db.selectedOptions[0] ? db.selectedOptions[0].dataset.code || '' : '',
      routeName: route.value, routeCode: route.selectedOptions[0] ? route.selectedOptions[0].dataset.code || '' : '',
      outletName: q('noName').value.trim(), ownerName: q('noOwner').value.trim(), contactNumber: q('noPhone').value.trim(), slab: q('noSlab').value
    };
    if (!data.distName || !data.routeName || !data.outletName || !data.ownerName || !data.contactNumber || !data.slab) { err.textContent = 'সব * চিহ্নিত তথ্য পূরণ করুন'; return; }
    if (!/^01\d{9}$/.test(data.contactNumber)) { err.textContent = 'মোবাইল নম্বর ০১ দিয়ে শুরু হওয়া ১১ ডিজিট হতে হবে'; return; }
    const btn = q('noSubmit');
    btn.disabled = true; btn.textContent = 'সেভ হচ্ছে…';
    const res = await api('newOutlet', data);
    btn.disabled = false; btn.textContent = 'আউটলেট সেভ করুন';
    if (!res.ok) { err.textContent = res.message || 'সেভ হয়নি'; return; }
    toast('নতুন আউটলেট সেভ হয়েছে');
    form.reset();
    route.disabled = true;
    closeSheet();
  }

  /* ======================= events ======================= */
  document.addEventListener('click', e => {
    // Tap anywhere on the Bangla date box opens the phone's calendar (computers need showPicker).
    if (e.target.id === 'dayDate' && typeof e.target.showPicker === 'function') { try { e.target.showPicker(); } catch (err) { /* opens natively */ } }
    const t = e.target.closest('[data-act]');
    if (!t || t.disabled) return;
    const fn = actions[t.dataset.act];
    if (fn) { e.preventDefault(); fn(t, e); }
  });
  document.addEventListener('change', e => {
    const t = e.target.closest('[data-change]');
    if (t && changes[t.dataset.change]) changes[t.dataset.change](t, e);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'fSearch') {
      state.f.q = e.target.value;
      const box = document.getElementById('pickList');
      if (box) box.innerHTML = pickList();
    }
    if (e.target.id === 'convSearch') {
      state.conv.q = e.target.value;
      const box = document.getElementById('convList');
      if (box) { const keep = state.conv.q; render(); const inp = document.getElementById('convSearch'); if (inp) { inp.focus(); inp.setSelectionRange(keep.length, keep.length); } }
    }
    if (e.target.id === 'loginPin' || e.target.id === 'noPhone') e.target.value = e.target.value.replace(/\D/g, '');
  });
  document.addEventListener('submit', e => {
    e.preventDefault();
    if (e.target.id === 'loginForm') {
      const team = state.loginMode === 'team';
      const val = id => ((document.getElementById(id) || {}).value || '').trim();
      const name = team ? val('loginTmName') : val('loginName');
      const secret = team ? val('loginPw') : val('loginPin');
      if (!team && !name) { state.loginError = 'আপনার নাম বাছুন'; render(); return; }
      if (team && !secret) { state.loginError = 'পাসওয়ার্ড দিন'; render(); return; }
      if (team) store.set('tmName', name);
      const btn = document.getElementById('loginBtn');
      btn.disabled = true; btn.textContent = 'লগইন হচ্ছে…';
      login(name, secret, team);
    }
    if (e.target.id === 'outletForm') submitOutlet(e.target);
  });
  function wireForms() { /* forms inside sheets use the same document-level listeners */ }

  start();
})();
