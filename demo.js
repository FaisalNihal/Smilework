/*
 * Demo mode: used only when config.js has no API_URL (the preview). Never used in production.
 * A pretend server that follows the same rules as the real Apps Script backend, and a shop scene
 * built from real photos (demo-display.jpg, demo-regular.jpg) in place of the camera, so the
 * camera checks run on real pixels: move the distance and light sliders to see them react.
 */
(function () {
  'use strict';

  /* ---------- the camera scene: a real photo on a shop wall, at a distance you choose ---------- */
  function DemoScene() {
    const W = 720, H = 1280;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    let distance = 92, light = 100, shake = false, type = 'Display', raf = 0;
    const t0 = performance.now();
    const pics = {};
    [['Display', 'demo-display.jpg'], ['Regular', 'demo-regular.jpg']].forEach(([k, src]) => {
      const im = new Image();
      im.onload = () => { pics[k] = im; };
      im.src = src;
    });
    // Example boxes on the two sample photos, as shares of each photo. NOT real detections, NOT your SKU list.
    const EXAMPLES = {
      Display: [
        { sku: 'DEMO-A', name: 'উদাহরণ SKU A (ডেমো)', conf: 0.91, facings: 1, rel: [0.418, 0.30, 0.372, 0.11] },
        { sku: 'DEMO-B', name: 'উদাহরণ SKU B (ডেমো)', conf: 0.86, facings: 1, rel: [0.426, 0.42, 0.38, 0.17] }
      ],
      Regular: [
        { sku: 'DEMO-A', name: 'উদাহরণ SKU A (ডেমো)', conf: 0.55, facings: 2, rel: [0.355, 0.497, 0.075, 0.116] }
      ]
    };
    const share = () => 1.15 - distance / 100 * 0.93;          // photo width as a share of the screen
    const sway = () => Math.sin((performance.now() - t0) / 900) * 6;
    function rect() {
      const im = pics[type];
      if (!im) return null;
      const w = W * share(), h = w * im.naturalHeight / im.naturalWidth;
      return { x: W / 2 - w / 2 + sway(), y: H / 2 - h / 2, w: w, h: h };
    }
    function draw() {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = shake ? 'blur(6px)' : 'none';
      ctx.fillStyle = '#CFC6B4';
      ctx.fillRect(0, 0, W, H);
      // plain shelves around the photo, so "too far" looks like a real shop
      ctx.fillStyle = '#8D6E63';
      for (let y = 140; y < H; y += 260) ctx.fillRect(0, y, W, 12);
      ctx.fillStyle = '#B9AE98';
      for (let y = 140; y < H; y += 260) for (let x = 12; x < W; x += 58) ctx.fillRect(x, y - 46 - (x % 3) * 8, 40, 46 + (x % 3) * 8);
      const r = rect();
      if (r) ctx.drawImage(pics[type], r.x, r.y, r.w, r.h);
      ctx.filter = 'none';
      if (light < 100) { ctx.fillStyle = 'rgba(0,0,0,' + ((100 - light) / 100 * 0.88).toFixed(3) + ')'; ctx.fillRect(0, 0, W, H); }
    }
    function loop() { draw(); raf = requestAnimationFrame(loop); }
    return {
      canvas: canvas,
      draw: draw,
      setType: t => { type = t === 'Display' ? 'Display' : 'Regular'; distance = type === 'Display' ? 92 : 22; light = 100; shake = false; },
      getDistance: () => distance,
      setDistance: v => { distance = v; },
      setLight: v => { light = v; },
      setShake: v => { shake = !!v; },
      start: () => { cancelAnimationFrame(raf); loop(); },
      stop: () => cancelAnimationFrame(raf),
      /** Example premium boxes where the sample photo is right now, as shares of the camera picture. */
      premiumBoxes: () => {
        const r = rect();
        if (!r) return [];
        return (EXAMPLES[type] || []).map(e => ({
          sku: e.sku, name: e.name, conf: e.conf, facings: e.facings,
          box: [(r.x + e.rel[0] * r.w) / W, (r.y + e.rel[1] * r.h) / H, e.rel[2] * r.w / W, e.rel[3] * r.h / H]
        }));
      },
      /** A small picture of the scene, for sample photos. */
      snapshot: (d, t, tint) => {
        const keep = [distance, type]; distance = d; type = t || 'Display'; draw(); [distance, type] = keep;
        const c = document.createElement('canvas');
        c.width = 240; c.height = 320;
        const x = c.getContext('2d');
        x.drawImage(canvas, 0, 0, 240, 320);
        if (tint) { x.fillStyle = tint; x.fillRect(0, 0, 240, 320); }
        return c.toDataURL('image/jpeg', 0.7);
      }
    };
  }

  /* ---------- pretend server ---------- */
  const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const SHOPS = ['মায়ের দোয়া স্টোর', 'রহমান ফার্মেসী', 'নিউ বিসমিল্লাহ জেনারেল স্টোর', 'আল-আমিন ট্রেডার্স', 'সততা স্টোর',
    'হক মেডিসিন কর্নার', 'জনতা ডিপার্টমেন্টাল', 'ভাই ভাই স্টোর', 'মা ফার্মা', 'শাপলা স্টোর', 'নূর জেনারেল স্টোর',
    'সোনালী ভ্যারাইটিজ', 'মদিনা স্টোর', 'স্বপ্ন সুপার শপ', 'তাজ মেডিকো', 'আদর্শ স্টোর', 'বন্ধু জেনারেল স্টোর', 'রূপসা ট্রেডার্স'];

  function DemoApi() {
    const scene = DemoScene();
    const today = new Date();
    // Date-wise PJP like the real one: each outlet twice, 14 days apart; route offset 0 = planned today.
    const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const plus = i => { const d = new Date(today); d.setDate(d.getDate() + i); return dkey(d); };
    const day = i => [today.getDate() + i - 14 >= 1 ? plus(i - 14) : plus(i + 14), plus(i)].sort();
    const mk = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const month = mk(today);
    const users = { 'Rahim Uddin': 'Merchandiser', 'Karim Hossain': 'Merchandiser', 'Admin': 'Admin' };
    const cols = ['region', 'territory', 'dbCode', 'dbName', 'code', 'name', 'slab', 'routeCode', 'route', 'visitDay', 'merch', 'status', 'unit'];
    const pjp = [];
    const routes = [
      ['Mirpur-10', 'R101', day(0), 'Rahim Uddin'], ['Pallabi', 'R102', day(1), 'Rahim Uddin'], ['Kazipara', 'R103', day(2), 'Rahim Uddin'],
      ['Uttara-7', 'R201', day(0), 'Karim Hossain'], ['Abdullahpur', 'R202', day(1), 'Karim Hossain'],
      ['Gulshan-1', 'R301', day(0), ''], ['Banani', 'R302', day(1), '']
    ];
    let n = 0;
    routes.forEach((r, ri) => {
      const smt = !r[3];
      const count = smt ? 4 : ri < 3 ? 6 : 5;
      for (let i = 0; i < count; i++) {
        const k = n++;
        r[2].forEach(visitDay => pjp.push({
          region: smt ? 'Dhaka South' : 'Dhaka North', territory: smt ? 'Gulshan' : ri < 3 ? 'Mirpur' : 'Uttara',
          dbCode: smt ? 'DB2001' : ri < 3 ? 'DB1021' : 'DB1034',
          dbName: smt ? 'Gulshan Distribution' : ri < 3 ? 'Mirpur Traders' : 'Uttara Distribution',
          code: (smt ? 'SMT' : 'BDC') + (10230 + k),
          name: smt ? ['Shwapno Gulshan-1', 'Agora Gulshan', 'Unimart', 'Meena Bazar Banani', 'Shwapno Banani', 'Lavender Super Store', 'Daily Shopping', 'Prince Bazar'][i + (ri - 5) * 4] : SHOPS[k % SHOPS.length],
          slab: ['Gold', 'Silver', 'Bronze'][k % 3], routeCode: r[1], route: r[0], visitDay, merch: r[3],
          status: smt || k % 3 === 0 ? 'Display' : 'Regular', unit: smt ? 'SMT' : ['DCC', 'ROB'][k % 2]
        }));
      }
    });
    const counts = {};
    Array.from(new Set(pjp.map(o => o.code))).forEach((code, i) => { counts[code] = i % 4 === 0 ? 2 : i % 4 === 1 ? 1 : i % 4 === 2 ? 1 : 0; });

    const iso = (h, m, dayOffset) => { const d = new Date(today); d.setDate(d.getDate() - (dayOffset || 0)); d.setHours(h, m, 0, 0); return d.toISOString(); };
    const photos = [];
    const isDisp = o => /display/i.test(o.status);
    const addPhoto = (o, h, m, opts) => {
      photos.push(Object.assign({
        uploadId: 'demo-' + photos.length, ts: iso(h, m, opts && opts.daysAgo), code: o.code, outletName: o.name, fileId: '',
        dupStatus: 'Unique', dupReason: '', valid: isDisp(o) ? 'Yes' : 'Not required', premium: '', aiStatus: 'Off', comment: '',
        photoNo: counts[o.code] || 1, reviewDecision: '', merch: o.merch, status: 'Approved', outletType: isDisp(o) ? 'Display' : 'Regular',
        premiumPresence: 'Not checked', notes: '', thumb: scene.snapshot(40 + (photos.length * 7) % 25, isDisp(o) ? 'Display' : 'Regular')
      }, opts || {}));
    };
    const rahim = pjp.filter((o, i) => o.merch === 'Rahim Uddin' && pjp.findIndex(x => x.code === o.code) === i);
    addPhoto(rahim[0], 9, 41);
    addPhoto(rahim[1], 10, 18);
    addPhoto(rahim[4], 16, 5, { daysAgo: 2, dupStatus: 'Flagged', status: 'Pending review', dupReason: 'যাচাই করা আউটলেট লোকেশন থেকে 240 মিটার দূরে' });
    addPhoto(rahim[8], 12, 30, { daysAgo: 3 });
    addPhoto(rahim[6], 11, 2, { daysAgo: 5, dupStatus: 'Rejected', status: 'Rejected', dupReason: 'এই মাসে এই আউটলেটের ২টি ছবি আগেই জমা হয়েছে', valid: '' });
    const lastMonth = (d, h) => new Date(today.getFullYear(), today.getMonth() - 1, d, h, 15).toISOString();
    addPhoto(rahim[2], 0, 0, { ts: lastMonth(9, 11), photoNo: 1 });
    addPhoto(rahim[2], 0, 0, { ts: lastMonth(23, 15), photoNo: 2 });
    photos.sort((a, b) => (a.ts < b.ts ? 1 : -1));
    let checkIn = iso(9, 12);
    let notice = 'আজ বিকেল ৫টার মধ্যে সব ছবি জমা দিন';
    let qualityMode = 'block';
    let review = [
      { uploadId: 'demo-r1', type: 'Flagged', blocking: true, code: 'BDC10236', merch: 'Rahim Uddin', reason: 'মিল আছে: অন্য আউটলেট BDC10235 এর ছবির সাথে (12 মিটার)',
        loggedAt: iso(15, 20, 1), thumb: scene.snapshot(46, 'Display'), matchedThumb: scene.snapshot(52, 'Display'), aiSameShop: '' },
      { uploadId: 'demo-r2', type: 'Possible conversion', blocking: false, code: 'BDC10241', merch: 'Karim Hossain', reason: 'Regular আউটলেটে স্মাইল কর্নার ডিসপ্লে দেখা গেছে: রিপোর্ট না হওয়া রূপান্তর হতে পারে',
        loggedAt: iso(11, 47, 0), thumb: scene.snapshot(38, 'Display'), matchedThumb: '', aiSameShop: '' }
    ];
    // Private preview with a real PJP (pjp-data.js): replace the sample outlets and people with it.
    const REAL = window.SMILE_DEMO_PJP;
    if (REAL && REAL.rows) {
      pjp.length = 0;
      REAL.rows.forEach(r => { const o = {}; REAL.cols.forEach((c, i) => { o[c] = r[i] == null ? '' : String(r[i]); }); pjp.push(o); });
      Object.keys(users).forEach(k => { if (users[k] === 'Merchandiser') delete users[k]; });
      pjp.forEach(o => { if (o.merch) users[o.merch] = 'Merchandiser'; });
      Object.keys(counts).forEach(k => { delete counts[k]; });
      photos.length = 0; review = []; checkIn = '';
      notice = 'প্রিভিউ · আসল PJP · কিছুই সেভ হয় না';
    }
    const wait = (v, ms) => new Promise(r => setTimeout(() => r(v), ms || 350));
    const fps = [];               // {fp, phash, code, lat, lon, acc, uploadId}
    const conversions = {};       // code -> {status, by, thumb, id, ts}
    const POP = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
    const hamming = (a, b) => {
      if (!a || !b || a.length !== b.length) return 999;
      let d = 0;
      for (let i = 0; i < a.length; i++) d += POP[parseInt(a[i], 16) ^ parseInt(b[i], 16)];
      return d;
    };
    const metres = (a, b, c, d) => {
      const R = 6371000, t = x => x * Math.PI / 180;
      const h = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2;
      return 2 * R * Math.asin(Math.sqrt(h));
    };
    const effType = o => isDisp(o) || (conversions[o.code] && conversions[o.code].status === 'Approved') ? 'Display' : 'Regular';

    function handle(req) {
      const a = req.action;
      if (a === 'loginNames') return wait({ ok: true, names: Object.keys(users).filter(n => users[n] !== 'SR').sort((x, y) => (x === 'Admin') - (y === 'Admin') || x.localeCompare(y)) });
      if (a === 'teamLogin') {
        if (req.password !== 'smile2026') return wait({ ok: false, error: 'LOGIN', message: 'পাসওয়ার্ড ভুল' });
        const nm = String(req.name || '').trim().slice(0, 40);
        const full = nm ? 'TM/SR: ' + nm : 'TM/SR';
        users[full] = 'SR';
        return wait({ ok: true, token: 'demo.' + full, user: { name: full, role: 'SR', team: true } });
      }
      if (a === 'login') {
        if (!users[req.name] || !/^\d{4}$/.test(req.pin || '')) return wait({ ok: false, error: 'LOGIN', message: 'নাম বা পিন ভুল' });
        return wait({ ok: true, token: 'demo.' + req.name, user: { name: req.name, role: users[req.name] } });
      }
      const name = String(req.token || '').replace(/^demo\./, '');
      const role = users[name];
      if (!role) return wait({ ok: false, error: 'AUTH', message: 'আবার লগইন করুন' });
      const mine = role === 'Merchandiser' ? pjp.filter(o => o.merch === name) : role === 'SR' ? pjp.filter(o => o.unit === 'SMT' || !o.merch) : pjp;
      const todayKey = new Date().toDateString();

      if (a === 'bootstrap') {
        const mc = {};
        mine.forEach(o => { if (counts[o.code]) mc[o.code] = counts[o.code]; });
        const rank = { 'Yes': 3, 'Needs review': 2, 'No': 1 };
        const prem = {};
        photos.forEach(p => {
          if (p.status === 'Rejected' || !rank[p.premiumPresence] || !mine.some(o => o.code === p.code)) return;
          if (!prem[p.code] || rank[p.premiumPresence] > rank[prem[p.code]]) prem[p.code] = p.premiumPresence;
        });
        return wait({
          ok: true, user: { name: name, role: role }, serverVersion: '2.1.0', serverTime: new Date(Date.now() - 1000).toISOString(), month: month,
          settings: { notice: notice, maintenance: false, max_photos_per_month: 2, guide_min_width: 0.4, guide_max_width: 0.75,
            guide_max_center_offset: 0.15, guide_max_tilt: 25, guide_min_brightness: 45, guide_min_sharpness: 100,
            guide_max_glare: 0.15, guide_frame_min_band: 0.6, quality_mode: qualityMode, gps_wait_seconds: 60, override_after_seconds: 20,
            gps_max_accuracy_m: 100, app_min_version: '2.1.0', tm_login_on: true },
          pjp: { cols: cols, rows: mine.map(o => cols.map(c => o[c])) },
          monthCounts: mc,
          premium: prem,
          conversions: Object.keys(conversions).reduce((m, k) => { if (mine.some(o => o.code === k)) m[k] = conversions[k].status; return m; }, {}),
          todayPhotos: photos.filter(p => p.merch === name && new Date(p.ts).toDateString() === todayKey && p.status !== 'Rejected'),
          checkIn: role === 'Merchandiser' ? checkIn : ''
        }, 600);
      }
      if (a === 'upload') {
        // Same rules as Upload.gs (simplified): only company rules reject; everything else is a note or a review.
        const flags = [], notes = [], reviewNotes = [];
        let o = pjp.find(x => x.code === req.outletCode);
        if (!o) { o = { code: req.outletCode, name: req.outletName || req.outletCode, status: req.outletStatus || '' }; flags.push('আউটলেটটি এখন PJP-তে নেই'); }
        const cMonth = mk(new Date(req.capturedAt || Date.now()));
        if (role !== 'Admin' && cMonth === month && (counts[o.code] || 0) >= 2) {
          const msg = 'এই মাসে এই আউটলেটের ২টি ছবি আগেই জমা হয়েছে';
          photos.unshift({ uploadId: req.clientId, ts: new Date(req.capturedAt).toISOString(), code: o.code, outletName: o.name, fileId: '', dupStatus: 'Rejected', status: 'Rejected',
            dupReason: msg, valid: '', premium: '', aiStatus: '', comment: '', photoNo: '', reviewDecision: '', merch: name, thumb: req.thumb, outletType: effType(o), premiumPresence: '' });
          return wait({ ok: false, error: 'REJECTED', final: true, uploadId: req.clientId, message: msg }, 900);
        }
        const type = effType(o);
        let matched = null;
        let best = null;
        fps.forEach(f => {
          const d = hamming(f.fp, req.fp || ''), dp = f.phash && req.phash ? hamming(f.phash, req.phash) : null;
          if (d <= 12 && (dp == null || dp <= 60) && (!best || d < best.d)) best = { d: d, f: f };
        });
        if (best) {
          if (best.f.code === o.code) notes.push('একই আউটলেটের আগের ছবির মতো দেখতে');
          else {
            const apart = req.lat != null && best.f.lat != null ? metres(req.lat, req.lon, best.f.lat, best.f.lon) : null;
            if (apart != null && apart > 300 && req.acc <= 100 && best.f.acc <= 100) notes.push('অন্য আউটলেট ' + best.f.code + ' এর ছবির মতো, তবে ' + Math.round(apart) + ' মিটার দূরে');
            else { matched = best.f; flags.push((best.d <= 5 ? 'প্রায় হুবহু মিল: ' : 'মিল আছে: ') + 'অন্য আউটলেট ' + best.f.code + ' এর ছবির সাথে' + (apart != null ? ' (' + Math.round(apart) + ' মিটার)' : ' (GPS নেই)')); }
          }
        }
        if (req.lat == null) flags.push('লোকেশন পাওয়া যায়নি');
        else if (req.acc > 100) notes.push('GPS দুর্বল (±' + Math.round(req.acc) + ' মি)');
        if (req.guide === 'off') flags.push('ক্যামেরা গাইড ছাড়া তোলা');
        const q = req.quality;
        if (q && !q.passed) { if (req.overrideReason) flags.push('মান যাচাই পাস করেনি; কারণ: ' + req.overrideReason); else notes.push('ছবির মান সীমার নিচে (' + (q.failed || []).join(', ') + ')'); }
        let valid = 'Not required';
        if (type === 'Display') {
          if (req.frame === 'none') { valid = 'Not visible'; flags.push('ডিসপ্লে আউটলেট, কিন্তু ক্যামেরা স্মাইল কর্নার ডিসপ্লে দেখেনি'); }
          else valid = req.frame && req.frame !== 'skip' ? 'Yes' : '';
        } else if (req.displaySeen) reviewNotes.push({ type: 'Possible conversion', reason: 'Regular আউটলেটে স্মাইল কর্নার ডিসপ্লে দেখা গেছে: রিপোর্ট না হওয়া রূপান্তর হতে পারে' });
        const prem = req.premium || { presence: 'Not checked', items: [] };
        if (prem.presence === 'Needs review') reviewNotes.push({ type: 'Premium check', reason: 'প্রিমিয়াম SKU নিশ্চিত নয়: ' + (prem.items || []).map(i => i.name || i.sku).join(', ') });

        if (req.fp) fps.push({ fp: req.fp, phash: req.phash, code: o.code, lat: req.lat, lon: req.lon, acc: req.acc, uploadId: req.clientId, thumb: req.thumb });
        if (cMonth === month) counts[o.code] = (counts[o.code] || 0) + 1;
        const flagged = flags.length > 0;
        const added = {
          uploadId: req.clientId, ts: new Date(req.capturedAt || Date.now()).toISOString(), uploadedAt: new Date().toISOString(), code: o.code, outletName: o.name, fileId: '',
          dupStatus: flagged ? 'Flagged' : 'Unique', dupReason: flags.join('; '), valid: valid, aiStatus: 'Off', comment: '',
          premium: prem.presence === 'Yes' ? (prem.items || []).map(i => i.name || i.sku).join(', ') : '', premiumPresence: prem.presence || 'Not checked',
          photoNo: counts[o.code], reviewDecision: '', merch: name, thumb: req.thumb, status: flagged ? 'Pending review' : 'Approved', outletType: type,
          notes: notes.join('; ')
        };
        photos.unshift(added);
        if (flagged) review.unshift({ uploadId: req.clientId, type: 'Flagged', blocking: true, code: o.code, merch: name, reason: flags.join('; '),
          loggedAt: new Date().toISOString(), thumb: req.thumb, matchedThumb: matched ? matched.thumb : '', aiSameShop: '' });
        reviewNotes.forEach(nn => review.unshift({ uploadId: req.clientId, type: nn.type, blocking: false, code: o.code, merch: name, reason: nn.reason,
          loggedAt: new Date().toISOString(), thumb: req.thumb, matchedThumb: '', aiSameShop: '' }));
        return wait({ ok: true, status: flagged ? 'flagged' : 'accepted', uploadId: req.clientId, photoNo: counts[o.code], outletType: type,
          message: flagged ? 'জমা হয়েছে, অ্যাডমিন যাচাই করবেন: ' + flags.join('; ') : 'সফলভাবে জমা হয়েছে' }, 1200);
      }
      if (a === 'thumbs') return wait({ ok: true, thumbs: {} }, 100);
      if (a === 'convert') {
        const o = pjp.find(x => x.code === req.outletCode);
        if (!/regular/i.test(o.status)) return wait({ ok: false, error: 'OUTLET', final: true, message: 'PJP-তে এই আউটলেট আগে থেকেই Display' });
        const cur = conversions[o.code];
        if (cur && cur.status !== 'Rejected') return wait({ ok: false, error: 'REJECTED', final: true, message: 'এই আউটলেটের রূপান্তর আগেই জমা হয়েছে' });
        const hit = fps.find(f => hamming(f.fp, req.fp || '') <= 5);
        if (req.fp) fps.push({ fp: req.fp, phash: req.phash, code: o.code, lat: req.lat, lon: req.lon, acc: req.acc, thumb: req.thumb });
        conversions[o.code] = { status: 'Pending', by: name, thumb: req.thumb, id: req.clientId, ts: new Date().toISOString(), name: o.name, route: o.route,
          warning: hit ? 'আগের একটি ছবির সাথে প্রায় হুবহু মিল (আউটলেট ' + hit.code + ')' : '' };
        return wait({ ok: true, status: 'pending', conversionId: req.clientId, message: 'রূপান্তর জমা হয়েছে। অ্যাডমিন যাচাই করে অনুমোদন দেবেন।' }, 1000);
      }
      if (a === 'myPhotos') {
        const want = /^\d{4}-\d{2}$/.test(req.month || '') ? req.month : month;
        return wait({ ok: true, month: want, photos: photos.filter(p => p.merch === name && mk(new Date(p.ts)) === want) });
      }
      if (a === 'checkIn') { checkIn = new Date().toISOString(); return wait({ ok: true, time: checkIn }); }
      if (a === 'newOutlet') return wait({ ok: true, message: 'নতুন আউটলেট সেভ হয়েছে' }, 700);
      if (a === 'adminStats') {
        const byMerch = {};
        pjp.forEach(o => { const k = o.merch || 'TM/SR (SMT)'; (byMerch[k] = byMerch[k] || []); if (byMerch[k].indexOf(o.code) < 0) byMerch[k].push(o.code); });
        const todays = photos.filter(p => new Date(p.uploadedAt || p.ts).toDateString() === todayKey);
        return wait({
          ok: true,
          today: REAL ? {
            uploads: todays.filter(p => p.status !== 'Rejected').length,
            flagged: todays.filter(p => p.status === 'Pending review').length,
            rejected: todays.filter(p => p.status === 'Rejected').length,
            people: new Set(todays.map(p => p.merch)).size
          } : { uploads: 23, flagged: 2, rejected: 1, people: 2 },
          aiPending: 0, aiProvider: 'Off',
          openReviews: review.length + Object.keys(conversions).filter(k => conversions[k].status === 'Pending').length,
          conversions: ['Pending', 'Approved', 'Rejected'].reduce((m, st) => { m[st === 'Pending' ? 'pending' : st === 'Approved' ? 'approved' : 'rejected'] = Object.keys(conversions).filter(k => conversions[k].status === st).length; return m; }, {}),
          progress: Object.keys(byMerch).map(m => ({
            merch: m, outlets: byMerch[m].length, done: byMerch[m].filter(c => counts[c] >= 2).length,
            one: byMerch[m].filter(c => counts[c] === 1).length, none: byMerch[m].filter(c => !counts[c]).length,
            today: todays.filter(p => p.merch === m || (m === 'TM/SR (SMT)' && /^TM\/SR/.test(p.merch))).length,
            conversions: Object.keys(conversions).filter(k => conversions[k].status !== 'Rejected' && (conversions[k].by === m || (m === 'TM/SR (SMT)' && /^TM\/SR/.test(conversions[k].by)))).length
          }))
        });
      }
      if (a === 'reviewList') {
        const conv = Object.keys(conversions).filter(k => conversions[k].status === 'Pending').map(k => {
          const c = conversions[k];
          const before = photos.find(p => p.code === k && p.status !== 'Rejected');
          return { uploadId: c.id, type: 'Conversion', code: k, merch: c.by,
            reason: 'Regular → Display রূপান্তর: ' + c.name + ' (' + c.route + ')' + (c.warning ? '. সতর্কতা: ' + c.warning : ''),
            loggedAt: c.ts, thumb: c.thumb, matchedThumb: before ? before.thumb : scene.snapshot(34, 'Regular'), aiSameShop: '' };
        });
        return wait({ ok: true, items: conv.concat(review) });
      }
      if (a === 'reviewDecide') {
        if (req.decision !== 'Seen' && !String(req.reason || '').trim()) return wait({ ok: false, error: 'FORM', message: 'কারণ লিখুন' });
        const ck = Object.keys(conversions).find(k => conversions[k].id === req.uploadId);
        if (ck) { conversions[ck].status = req.decision === 'Accept' ? 'Approved' : 'Rejected'; return wait({ ok: true, updated: 1 }); }
        if (req.decision === 'Seen') review = review.filter(r => !(r.uploadId === req.uploadId && !r.blocking));
        else {
          review = review.filter(r => r.uploadId !== req.uploadId);
          const p = photos.find(x => x.uploadId === req.uploadId);
          if (p) { p.reviewDecision = req.decision; p.status = req.decision === 'Accept' ? 'Approved' : 'Rejected'; }
        }
        return wait({ ok: true, updated: 1 });
      }
      if (a === 'saveSettings') {
        if (req.notice !== undefined) notice = req.notice;
        if (req.qualityMode !== undefined) qualityMode = req.qualityMode === 'block' ? 'block' : 'warn';
        if (req.tmPassword !== undefined && req.tmPassword && req.tmPassword.length < 6) return wait({ ok: false, message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' });
        return wait({ ok: true, settings: { notice: notice, maintenance: !!req.maintenance, quality_mode: qualityMode, tm_login_on: req.tmPassword !== '' } });
      }
      return wait({ ok: false, error: 'BAD', message: 'Unknown action' });
    }

    return { handle: handle, scene: scene };
  }

  window.SmileDemo = { create: DemoApi };
})();
