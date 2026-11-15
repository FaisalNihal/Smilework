/*
 * Guided camera (v2.1).
 * Watches the live camera several times a second and checks, separately:
 *   - GPS (waits up to gps_wait_seconds, then allows the photo as "Location unknown"),
 *   - the phone is held upright, the picture is bright, not glaring and sharp,
 *   - DISPLAY outlets only: the red Smile Corner frame is in the picture, whole, at the right size and centred.
 *     This uses a colour check on the red frame; no trained model file is needed.
 *   - REGULAR outlets: no display is required. The same colour check runs quietly and only reports
 *     "display seen" (a possible unreported conversion) to the admin.
 * quality_mode "warn": messages are shown but the photo is allowed (while the limits are being tuned).
 * quality_mode "block": the shutter waits until every check passes; after override_after_seconds the CM may
 * send the photo with a reason, and it goes to admin review.
 * Both fingerprints are taken from the clean frame BEFORE the watermark is drawn.
 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};
  const MP = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + (CFG.MEDIAPIPE_VERSION || '1.2.3');
  const MAX_SIDE = Number(CFG.PHOTO_MAX_SIDE) || 1280, JPEG_Q = Number(CFG.PHOTO_QUALITY) || 0.75, THUMB_W = 360, READY_MS = 800, TICK_MS = 160, MODEL_TIMEOUT_MS = 25000;

  /* ---------- display detector (MediaPipe), loaded once and reused ---------- */
  let detectorPromise = null;
  function loadDetector(modelUrl) {
    if (!modelUrl) return Promise.resolve(null);
    if (!detectorPromise) {
      detectorPromise = (async () => {
        const mp = await import(MP + '/vision_bundle.mjs');
        const files = await mp.FilesetResolver.forVisionTasks(MP + '/wasm');
        const make = delegate => mp.ObjectDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: modelUrl, delegate: delegate },
          runningMode: 'VIDEO', scoreThreshold: 0.45, maxResults: 3
        });
        try { return await make('GPU'); } catch (e) { return await make('CPU'); }
      })();
      detectorPromise.catch(() => { detectorPromise = null; });
    }
    return detectorPromise;
  }

  /* ---------- image helpers ---------- */

  /** 64-bit difference hash ("fingerprint") as 16 hex characters. */
  function dHash(source) {
    const a = document.createElement('canvas');
    a.width = 144; a.height = 128;
    const ac = a.getContext('2d', { willReadFrequently: true });
    ac.imageSmoothingQuality = 'high';
    ac.drawImage(source, 0, 0, 144, 128);
    const b = document.createElement('canvas');
    b.width = 9; b.height = 8;
    const bc = b.getContext('2d', { willReadFrequently: true });
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(a, 0, 0, 9, 8);
    const p = bc.getImageData(0, 0, 9, 8).data;
    const g = i => p[i] * 0.299 + p[i + 1] * 0.587 + p[i + 2] * 0.114;
    let bits = '';
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const i = (y * 9 + x) * 4;
        bits += g(i) > g(i + 4) ? '1' : '0';
      }
    }
    let hex = '';
    for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }

  /**
   * 256-bit perceptual fingerprint (DCT hash) as 64 hex characters. More detailed than dHash, so two
   * different shops with similar displays are less likely to look "the same".
   */
  const COS32 = (() => {
    const t = new Float32Array(32 * 32);
    for (let k = 0; k < 32; k++) for (let n = 0; n < 32; n++) t[k * 32 + n] = Math.cos(Math.PI / 32 * (n + 0.5) * k);
    return t;
  })();
  function pHash(source) {
    const a = document.createElement('canvas');
    a.width = 128; a.height = 128;
    const ac = a.getContext('2d', { willReadFrequently: true });
    ac.imageSmoothingQuality = 'high';
    ac.drawImage(source, 0, 0, 128, 128);
    const b = document.createElement('canvas');
    b.width = 32; b.height = 32;
    const bc = b.getContext('2d', { willReadFrequently: true });
    bc.imageSmoothingQuality = 'high';
    bc.drawImage(a, 0, 0, 32, 32);
    const p = bc.getImageData(0, 0, 32, 32).data;
    const g = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) g[i] = p[i * 4] * 0.299 + p[i * 4 + 1] * 0.587 + p[i * 4 + 2] * 0.114;
    const rows = new Float32Array(32 * 16);                  // DCT along x, keep the 16 lowest frequencies
    for (let y = 0; y < 32; y++) for (let k = 0; k < 16; k++) {
      let sum = 0;
      for (let x = 0; x < 32; x++) sum += g[y * 32 + x] * COS32[k * 32 + x];
      rows[y * 16 + k] = sum;
    }
    const coef = new Float32Array(256);                      // then along y
    for (let k = 0; k < 16; k++) for (let j = 0; j < 16; j++) {
      let sum = 0;
      for (let y = 0; y < 32; y++) sum += rows[y * 16 + j] * COS32[k * 32 + y];
      coef[k * 16 + j] = sum;
    }
    const sorted = Array.from(coef.slice(1)).sort((x, y) => x - y);
    const med = sorted[Math.floor(sorted.length / 2)];
    let hex = '';
    for (let i = 0; i < 256; i += 4) {
      let n = 0;
      for (let j = 0; j < 4; j++) n = (n << 1) | (coef[i + j] > med ? 1 : 0);
      hex += n.toString(16);
    }
    return hex;
  }

  /**
   * Finds the red Smile Corner frame by colour (no model file). Works on a 96-px-wide copy.
   * Returns the biggest red area and how "frame-like" it is: the top, left and right edges of a real
   * Smile Corner are solid red, while a cluster of red packs on a shelf has gaps between the packs.
   */
  const frameCanvas = document.createElement('canvas');
  function detectFrame(source, sw, sh, minBand) {
    const W = 96, H = Math.max(32, Math.round(96 * sh / sw));
    frameCanvas.width = W; frameCanvas.height = H;
    const c = frameCanvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(source, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data;
    const n = W * H, m = new Uint8Array(n), dil = new Uint8Array(n), mask = new Uint8Array(n);
    for (let i = 0, j = 0; j < n; i += 4, j++) {
      const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(g, b);
      m[j] = r > 60 && r > 1.6 * g && r > 1.4 * b && r - mx > 35 ? 1 : 0;
    }
    // close small gaps (the white letters on the frame): grow, then shrink
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      dil[k] = m[k] || (x > 0 && m[k - 1]) || (x < W - 1 && m[k + 1]) || (y > 0 && m[k - W]) || (y < H - 1 && m[k + W]) ? 1 : 0;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x;
      mask[k] = dil[k] && (x === 0 || dil[k - 1]) && (x === W - 1 || dil[k + 1]) && (y === 0 || dil[k - W]) && (y === H - 1 || dil[k + W]) ? 1 : 0;
    }
    // the biggest connected red area
    const lab = new Int32Array(n), stack = new Int32Array(n);
    let best = null, label = 0;
    for (let s0 = 0; s0 < n; s0++) {
      if (!mask[s0] || lab[s0]) continue;
      label++;
      let sp = 0, cnt = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
      stack[sp++] = s0; lab[s0] = label;
      while (sp) {
        const k = stack[--sp], x = k % W, y = (k / W) | 0;
        cnt++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && mask[k - 1] && !lab[k - 1]) { lab[k - 1] = label; stack[sp++] = k - 1; }
        if (x < W - 1 && mask[k + 1] && !lab[k + 1]) { lab[k + 1] = label; stack[sp++] = k + 1; }
        if (y > 0 && mask[k - W] && !lab[k - W]) { lab[k - W] = label; stack[sp++] = k - W; }
        if (y < H - 1 && mask[k + W] && !lab[k + W]) { lab[k + W] = label; stack[sp++] = k + W; }
      }
      if (!best || cnt > best.cnt) best = { cnt, x0, x1, y0, y1, label };
    }
    if (!best || best.cnt < 12) return { found: false };
    const bw = best.x1 - best.x0 + 1, bh = best.y1 - best.y0 + 1;
    const bandFill = (xa, xb, ya, yb) => {
      let on = 0, all = 0;
      for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) { all++; if (lab[y * W + x] === best.label) on++; }
      return all ? on / all : 0;
    };
    const t = Math.max(1, Math.round(bh * 0.12)), sd = Math.max(1, Math.round(bw * 0.10));
    const top = bandFill(best.x0, best.x1, best.y0, best.y0 + t - 1);
    const left = bandFill(best.x0, best.x0 + sd - 1, best.y0, best.y1);
    const right = bandFill(best.x1 - sd + 1, best.x1, best.y0, best.y1);
    const band = Math.min(top, left, right), cover = best.cnt / (bw * bh);
    const kx = sw / W, ky = sh / H;
    return {
      found: band >= (minBand || 0.6) && cover >= 0.4 && bw / W >= 0.12,
      w: bw / W, h: bh / H, cx: (best.x0 + bw / 2) / W, cy: (best.y0 + bh / 2) / H, band: band, cover: cover,
      touch: best.x0 <= 1 || best.y0 <= 0 || best.x1 >= W - 2 || best.y1 >= H - 1,
      box: { originX: best.x0 * kx, originY: best.y0 * ky, width: bw * kx, height: bh * ky }
    };
  }

  /**
   * Brightness (0-255) and glare (share of pure-white pixels) from a small copy of the whole frame,
   * and sharpness (variance of the Laplacian) from the CENTRE of the frame at a higher resolution,
   * where shake and focus blur show clearly.
   */
  const statCanvas = document.createElement('canvas'), sharpCanvas = document.createElement('canvas');
  function frameStats(source, sw, sh) {
    const W = 128, H = Math.max(48, Math.round(128 * sh / sw));
    statCanvas.width = W; statCanvas.height = H;
    const c = statCanvas.getContext('2d', { willReadFrequently: true });
    c.drawImage(source, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data;
    let sum = 0, white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      sum += v;
      if (v > 248) white++;
    }
    // centre half of the picture, drawn 240 px wide
    const cw = sw * 0.5, ch = sh * 0.5, SW = 240, SH = Math.max(80, Math.round(240 * ch / cw));
    sharpCanvas.width = SW; sharpCanvas.height = SH;
    const sc = sharpCanvas.getContext('2d', { willReadFrequently: true });
    sc.drawImage(source, sw * 0.25, sh * 0.25, cw, ch, 0, 0, SW, SH);
    const e = sc.getImageData(0, 0, SW, SH).data;
    const gray = new Float32Array(SW * SH);
    for (let i = 0, j = 0; i < e.length; i += 4, j++) gray[j] = e[i] * 0.299 + e[i + 1] * 0.587 + e[i + 2] * 0.114;
    let n = 0, m = 0, m2 = 0;
    for (let y = 1; y < SH - 1; y++) {
      for (let x = 1; x < SW - 1; x++) {
        const k = y * SW + x;
        const lap = 4 * gray[k] - gray[k - 1] - gray[k + 1] - gray[k - SW] - gray[k + SW];
        n++; const delta = lap - m; m += delta / n; m2 += delta * (lap - m);
      }
    }
    return { brightness: sum / (W * H), sharpness: n > 1 ? m2 / (n - 1) : 0, glare: white / (W * H) };
  }

  function watermark(ctx, w, h, info) {
    const pad = Math.round(w * 0.025), fs = Math.max(13, Math.round(w * 0.022)), title = Math.round(fs * 1.35);
    const band = title + fs * 2 + pad * 2.4;
    const grad = ctx.createLinearGradient(0, h - band * 1.4, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(0.35, 'rgba(0,0,0,.62)');
    grad.addColorStop(1, 'rgba(0,0,0,.86)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - band * 1.4, w, band * 1.4);
    ctx.textBaseline = 'alphabetic';
    const y3 = h - pad, y2 = y3 - fs * 1.35, y1 = y2 - fs * 1.45;
    ctx.textAlign = 'left';
    ctx.font = '700 ' + title + 'px sans-serif';
    ctx.fillStyle = '#FF3B41';
    ctx.fillText('Colgate Smile Corner', pad, y1);
    ctx.font = '600 ' + fs + 'px sans-serif';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(info.when, pad, y2);
    ctx.fillText(info.who, pad, y3);
    ctx.textAlign = 'right';
    ctx.font = '700 ' + title + 'px sans-serif';
    ctx.fillText(info.code, w - pad, y1);
    ctx.font = '600 ' + fs + 'px sans-serif';
    ctx.fillStyle = '#FDE047';
    ctx.fillText(info.where, w - pad, y2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText(info.outlet.slice(0, 34), w - pad, y3);
  }

  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const LABELS = { gps: 'লোকেশন', level: 'সোজা', light: 'আলো', frame: 'ডিসপ্লে', sharp: 'স্থির' };
  const OVERRIDE_REASONS = ['দোকানে আলো খুব কম', 'ডিসপ্লে আংশিক ঢাকা / জিনিস রাখা', 'পিছনে যাওয়ার জায়গা নেই', 'ডিসপ্লে সরানো হয়েছে / নেই', 'GPS পাওয়া যাচ্ছে না', 'অন্য কারণ'];
  const num = (v, d) => { const n = Number(v); return isFinite(n) && n > 0 ? n : d; };

  /**
   * Opens the full-screen guided camera.
   * opts: { outlet:{code,name}, outletType:'Display'|'Regular', merchName, settings, modelUrl, demoScene }
   * Resolves with the photo, or null if the merchandiser closed the camera.
   */
  function open(opts) {
    const s = opts.settings || {};
    const isDisplay = opts.outletType === 'Display';
    const minW = num(s.guide_min_width, 0.40), maxW = num(s.guide_max_width, 0.75);
    const maxOff = num(s.guide_max_center_offset, 0.15), maxTilt = num(s.guide_max_tilt, 25);
    const minLight = num(s.guide_min_brightness, 45), minSharp = num(s.guide_min_sharpness, 100);
    const maxGlare = num(s.guide_max_glare, 0.15), minBand = num(s.guide_frame_min_band, 0.6);
    const blockMode = s.quality_mode === 'block';
    const gpsWaitMs = num(s.gps_wait_seconds, 60) * 1000, overrideMs = num(s.override_after_seconds, 60) * 1000;
    let demo = null;                         // set to the drawn scene only when no real camera is available
    const demoScene = opts.demoScene || null;

    // iOS asks for motion-sensor permission; this must happen inside the tap that opened the camera.
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        DeviceOrientationEvent.requestPermission().catch(() => {});
      }
    } catch (e) { /* not available */ }

    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'cam';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'গাইডেড ক্যামেরা');
      const chipKeys = Object.keys(LABELS).filter(k => k !== 'frame' || isDisplay);
      el.innerHTML =
        '<div class="hud-top">' +
          '<div class="hud-row"><button type="button" class="x" data-close aria-label="ক্যামেরা বন্ধ করুন">' + ICON_X + '</button>' +
          '<div class="grow"><b></b><span class="otype ' + (isDisplay ? 'display' : '') + '">' + (isDisplay ? 'ডিসপ্লে' : 'রেগুলার') + '</span></div></div>' +
          '<div class="say" aria-live="polite">ক্যামেরা চালু হচ্ছে…</div>' +
          '<div class="checks">' + chipKeys.map(k => '<span data-k="' + k + '">' + LABELS[k] + '</span>').join('') + '</div>' +
        '</div>' +
        '<canvas class="overlay"></canvas>' +
        '<div class="hud-bottom">' +
          (demoScene ? '<div class="demo-ctl" hidden>' +
            '<label for="demoDistance">ডেমো · দূরত্ব<input id="demoDistance" type="range" min="0" max="100" value="92"></label>' +
            '<label for="demoLight">ডেমো · আলো<input id="demoLight" type="range" min="0" max="100" value="100"></label>' +
            '<label class="demo-check" for="demoShake"><input id="demoShake" type="checkbox"> কাঁপছে</label>' +
            '<label class="demo-check" for="demoGps"><input id="demoGps" type="checkbox"> GPS নেই</label>' +
          '</div>' : '') +
          '<div class="override" hidden><p>কারণ বাছুন · অ্যাডমিন যাচাই করবেন</p>' +
            OVERRIDE_REASONS.map(r => '<button type="button" class="reason" data-reason="' + r + '">' + r + '</button>').join('') + '</div>' +
          '<button type="button" class="btn-override" hidden>ভালো ছবি তোলা যাচ্ছে না</button>' +
          '<button type="button" class="shutter" disabled aria-label="ছবি তুলুন"><i></i></button>' +
          '<div class="mode"></div>' +
        '</div>';
      el.querySelector('.grow b').textContent = (opts.outlet.name || '') + '  ' + opts.outlet.code;
      document.body.appendChild(el);

      const say = el.querySelector('.say'), shutter = el.querySelector('.shutter'), modeEl = el.querySelector('.mode');
      const overlay = el.querySelector('canvas.overlay');
      const ovBtn = el.querySelector('.btn-override'), ovPanel = el.querySelector('.override');
      const chips = {};
      el.querySelectorAll('.checks span').forEach(n => { chips[n.dataset.k] = n; });

      let source = null, stream = null, closed = false, timer = 0, watchId = null, tick = 0;
      let gps = null, gpsDenied = false, gpsStart = Date.now(), tilt = null, tiltSeen = false, okSince = 0;
      let lastBox = null, lastFrame = 'skip', lastFr = null, lastChk = {}, lastAllOk = false, lastStats = null;
      let displaySeenTicks = 0, overrideReason = '', openedAt = Date.now(), demoNoGps = false;
      let detector = null, guide = isDisplay ? (opts.modelUrl ? 'loading' : 'frame') : 'regular';
      const srcW = () => source ? (source.videoWidth || source.width || 0) : 0;
      const srcH = () => source ? (source.videoHeight || source.height || 0) : 0;

      function setMode() {
        modeEl.textContent = guide === 'loading' ? 'লোড হচ্ছে…'
          : guide === 'off' ? 'গাইড ছাড়া · যাচাই হবে'
          : isDisplay ? 'পুরো স্মাইল কর্নার ফ্রেমে আনুন' : 'কলগেটের শেলফ · স্টিকার লাগবে না';
      }
      setMode();

      // Tilt sensor
      function onOrient(e) {
        if (e.beta == null || e.gamma == null) return;
        tiltSeen = true;
        const r = Math.PI / 180;
        tilt = Math.asin(Math.min(1, Math.abs(Math.cos(e.beta * r) * Math.cos(e.gamma * r)))) / r;
      }

      /** Optional MediaPipe model, GPS and tilt. Called once the picture source is known. */
      function initGuides() {
        if (demo) {
          gps = { lat: 23.7808 + Math.random() * 0.0004, lon: 90.4067 + Math.random() * 0.0004, acc: 12, t: Date.now() };
          setMode();
          return;
        }
        if (isDisplay && opts.modelUrl) {
          const giveUp = setTimeout(() => { if (guide === 'loading') { guide = 'frame'; setMode(); } }, MODEL_TIMEOUT_MS);
          loadDetector(opts.modelUrl).then(d => {
            clearTimeout(giveUp);
            if (closed) return;
            if (d) { detector = d; guide = 'full'; } else { guide = 'frame'; }
            setMode();
          }).catch(() => { clearTimeout(giveUp); if (!closed) { guide = 'frame'; setMode(); } });
        }
        if (navigator.geolocation) {
          watchId = navigator.geolocation.watchPosition(p => {
            const fix = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
            if (!gps || fix.acc <= gps.acc * 1.5 || Date.now() - gps.t > 30000) gps = fix;
          }, err => {
            if (err.code === 1) gpsDenied = true;
          }, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
        }
        window.addEventListener('deviceorientation', onOrient);
        setMode();
      }

      function useScene() {
        demo = demoScene;
        source = demo.canvas;
        source.classList.add('feed');
        el.insertBefore(source, el.firstChild);
        demo.start();
        const ctl = el.querySelector('.demo-ctl');
        if (ctl) {
          ctl.hidden = false;
          const dist = ctl.querySelector('#demoDistance'), light = ctl.querySelector('#demoLight');
          if (demo.getDistance) dist.value = demo.getDistance();
          demo.setDistance(Number(dist.value)); demo.setLight(Number(light.value));
          dist.addEventListener('input', e => demo.setDistance(Number(e.target.value)));
          light.addEventListener('input', e => demo.setLight(Number(e.target.value)));
          ctl.querySelector('#demoShake').addEventListener('change', e => demo.setShake(e.target.checked));
          ctl.querySelector('#demoGps').addEventListener('change', e => {
            demoNoGps = e.target.checked;
            if (demoNoGps) { gps = null; gpsStart = Date.now() - gpsWaitMs + 8000; }
            else gps = { lat: 23.7808, lon: 90.4067, acc: 12, t: Date.now() };
          });
        }
      }

      // Picture source: the real back camera; in demo mode the drawn shop when no camera is allowed.
      async function startSource() {
        try {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('এই ফোনে ক্যামেরা চালু করা যাচ্ছে না');
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          });
        } catch (err) {
          if (demoScene) { useScene(); initGuides(); return; }
          throw err;
        }
        const v = document.createElement('video');
        v.setAttribute('playsinline', ''); v.muted = true; v.autoplay = true; v.srcObject = stream;
        el.insertBefore(v, el.firstChild);
        await v.play().catch(() => {});
        source = v;
        initGuides();
      }

      function drawOverlay(st) {
        const cw = overlay.clientWidth, ch = overlay.clientHeight, dpr = window.devicePixelRatio || 1;
        if (overlay.width !== Math.round(cw * dpr)) { overlay.width = Math.round(cw * dpr); overlay.height = Math.round(ch * dpr); }
        const c = overlay.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, cw, ch);
        const vw = srcW(), vh = srcH();
        if (!vw || !vh || !isDisplay) return;            // Regular outlets: no display target
        // object-fit: contain mapping from source pixels to screen (what you see is what is saved)
        const k = Math.min(cw / vw, ch / vh), ox = (cw - vw * k) / 2, oy = (ch - vh * k) / 2;
        const color = st.ready && st.allOk ? '#22C55E' : 'rgba(255,255,255,.85)';
        // Target zone: the ideal display width, centred
        const tw = vw * (minW + maxW) / 2 * k, th = Math.min(ch * 0.62, tw * 0.72);
        const tx = cw / 2 - tw / 2, ty = ch / 2 - th / 2 - 10, L = Math.min(tw, th) * 0.16;
        c.strokeStyle = color; c.lineWidth = 4; c.lineCap = 'round';
        c.beginPath();
        c.moveTo(tx, ty + L); c.lineTo(tx, ty); c.lineTo(tx + L, ty);
        c.moveTo(tx + tw - L, ty); c.lineTo(tx + tw, ty); c.lineTo(tx + tw, ty + L);
        c.moveTo(tx + tw, ty + th - L); c.lineTo(tx + tw, ty + th); c.lineTo(tx + tw - L, ty + th);
        c.moveTo(tx + L, ty + th); c.lineTo(tx, ty + th); c.lineTo(tx, ty + th - L);
        c.stroke();
        if (st.box) {
          const b = st.box;
          c.setLineDash([8, 6]); c.lineWidth = 2.5;
          c.strokeStyle = st.frame === 'ok' ? '#22C55E' : '#FACC15';
          c.strokeRect(ox + b.originX * k, oy + b.originY * k, b.width * k, b.height * k);
          c.setLineDash([]);
        }
      }

      function classify(fr, vw, vh) {
        if (!fr || !fr.found) return 'none';
        if (fr.touch || fr.w > maxW) return 'close';
        if (fr.w < minW) return 'far';
        if (Math.abs(fr.cx - 0.5) > maxOff) return 'offcenter';
        return 'ok';
      }

      function evaluate() {
        if (closed) return;
        const vw = srcW(), vh = srcH();
        if (!vw || !vh) { timer = setTimeout(evaluate, TICK_MS); return; }
        tick++;
        if (demo) demo.draw();
        const st = frameStats(source, vw, vh);
        lastStats = st;
        const now = Date.now();
        const gpsTimedOut = !gps && now - gpsStart > gpsWaitMs;
        const chk = {
          gps: !!gps || gpsTimedOut,
          level: demo || !tiltSeen || tilt == null ? true : tilt <= maxTilt,
          light: st.brightness >= minLight && st.glare <= maxGlare,
          sharp: st.sharpness >= minSharp,
          frame: true
        };
        let frame = 'skip', box = null, fr = null;
        if (isDisplay) {
          if (guide === 'loading') { chk.frame = false; frame = 'loading'; }
          else if (detector && guide === 'full') {
            try {
              const res = detector.detectForVideo(source, performance.now());
              const best = (res.detections || []).filter(d => d.boundingBox)
                .sort((a, b) => (b.categories[0] ? b.categories[0].score : 0) - (a.categories[0] ? a.categories[0].score : 0))[0];
              if (!best) frame = 'none';
              else {
                box = best.boundingBox;
                fr = { found: true, w: box.width / vw, cx: (box.originX + box.width / 2) / vw,
                  touch: box.originX < vw * 0.02 || box.originX + box.width > vw * 0.98 || box.originY < vh * 0.01 || box.originY + box.height > vh * 0.99 };
                frame = classify(fr, vw, vh);
              }
            } catch (e) { frame = 'none'; }
          } else {
            fr = detectFrame(source, vw, vh, minBand);
            frame = classify(fr, vw, vh);
            if (fr.found) box = fr.box;
          }
          chk.frame = frame === 'ok';
        } else if (tick % 3 === 0) {
          // Regular outlet: never required. Only notes a Smile Corner that happens to be there.
          const seen = detectFrame(source, vw, vh, minBand);
          if (seen.found && seen.w >= 0.2) displaySeenTicks++;
        }
        lastBox = box; lastFrame = frame; lastFr = fr; lastChk = chk;

        let msg;
        if (!chk.gps) {
          const left = Math.max(0, Math.ceil((gpsWaitMs - (now - gpsStart)) / 1000));
          msg = gpsDenied ? 'লোকেশনের অনুমতি দিন' : 'লোকেশন খোঁজা হচ্ছে… ' + left;
        }
        else if (!chk.level) msg = 'ফোন সোজা করে ধরুন';
        else if (st.brightness < minLight) msg = 'আলো কম';
        else if (st.glare > maxGlare) msg = 'চকচক করছে, কোণ বদলান';
        else if (frame === 'loading') msg = 'গাইড লোড হচ্ছে…';
        else if (frame === 'none') msg = 'স্মাইল কর্নার ফ্রেমে আনুন';
        else if (frame === 'far') msg = 'আরও কাছে যান';
        else if (frame === 'close') msg = 'একটু পিছনে যান';
        else if (frame === 'offcenter') msg = (fr && fr.cx < 0.5 ? 'একটু বাঁ দিকে সরান' : 'একটু ডান দিকে সরান');
        else if (!chk.sharp) msg = 'ফোন স্থির রাখুন';
        else msg = '';

        const allOk = !msg;
        lastAllOk = allOk;
        if (allOk) { if (!okSince) okSince = now; } else okSince = 0;
        const steady = allOk && now - okSince >= READY_MS;
        // Block mode: only when every check passes (or a reason was chosen). Warn mode: once GPS is settled.
        const ready = blockMode ? (steady || (!!overrideReason && chk.gps)) : chk.gps && frame !== 'loading';
        say.textContent = steady ? 'ঠিক আছে, ছবি তুলুন'
          : overrideReason && blockMode ? 'কারণ: ' + overrideReason
          : !blockMode && ready ? (msg || 'ধরে রাখুন…') : (msg || 'ধরে রাখুন…');
        say.classList.toggle('go', steady);
        say.classList.toggle('hint', !steady && ready);
        shutter.disabled = !ready;
        shutter.classList.toggle('warn', ready && !steady);
        ovBtn.hidden = !(blockMode && !allOk && !overrideReason && now - openedAt > overrideMs);
        Object.keys(chips).forEach(kk => chips[kk].classList.toggle('ok', !!chk[kk]));
        if (gps) chips.gps.textContent = 'লোকেশন ±' + Math.round(gps.acc) + 'মি';
        else if (gpsTimedOut) chips.gps.textContent = 'লোকেশন নেই';
        drawOverlay({ ready: ready, allOk: allOk, box: box, frame: frame });
        timer = setTimeout(evaluate, TICK_MS);
      }

      function framingScore() {
        if (!lastFr || !lastFr.found || lastFrame === 'skip') return null;
        const w = lastFr.w, cx = lastFr.cx;
        const mid = (minW + maxW) / 2, half = (maxW - minW) / 2;
        const ws = Math.max(0, 1 - Math.abs(w - mid) / half), cs = Math.max(0, 1 - Math.abs(cx - 0.5) / maxOff);
        return Math.round(100 * (0.6 * ws + 0.4 * cs));
      }

      function capture() {
        if (shutter.disabled) return;
        const vw = srcW(), vh = srcH(), k = Math.min(1, MAX_SIDE / Math.max(vw, vh));
        const w = Math.round(vw * k), h = Math.round(vh * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(source, 0, 0, w, h);
        const fp = dHash(c), ph = pHash(c);                    // clean frame, before the watermark
        const post = frameStats(c, w, h);                      // the saved photo itself, checked again
        const failed = Object.keys(lastChk).filter(kk => !lastChk[kk]);
        if (post.brightness < minLight && failed.indexOf('light') < 0) failed.push('light');
        if (post.sharpness < minSharp && failed.indexOf('sharp') < 0) failed.push('sharp');
        const quality = {
          passed: lastAllOk && !failed.length,
          failed: failed,
          vals: {
            brightness: Math.round(post.brightness), sharpness: Math.round(post.sharpness), glare: Math.round(post.glare * 1000) / 1000,
            tilt: tilt == null ? '' : Math.round(tilt),
            frameWidth: lastFr && lastFr.found ? Math.round(lastFr.w * 100) / 100 : '',
            frameOffset: lastFr && lastFr.found ? Math.round(Math.abs(lastFr.cx - 0.5) * 100) / 100 : '',
            band: lastFr && lastFr.band != null ? Math.round(lastFr.band * 100) / 100 : ''
          }
        };
        const frameBox = lastFr && lastFr.found ? [lastFr.box.originX / vw, lastFr.box.originY / vh, lastFr.box.width / vw, lastFr.box.height / vh] : null;
        const demoBoxes = demo && demo.premiumBoxes ? demo.premiumBoxes() : null;
        const now = new Date();
        const pad2 = n => String(n).padStart(2, '0');
        let hr = now.getHours(); const ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
        watermark(ctx, w, h, {
          when: now.getDate() + ' ' + now.toLocaleString('en-US', { month: 'short' }) + ' ' + now.getFullYear() + '  ' + hr + ':' + pad2(now.getMinutes()) + ' ' + ap,
          who: opts.merchName || '',
          code: opts.outlet.code,
          outlet: opts.outlet.name || '',
          where: gps ? gps.lat.toFixed(5) + ', ' + gps.lon.toFixed(5) + '  ±' + Math.round(gps.acc) + 'm' : 'GPS নেই'
        });
        const image = c.toDataURL('image/jpeg', JPEG_Q);
        const t = document.createElement('canvas');
        t.width = THUMB_W; t.height = Math.round(h * THUMB_W / w);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        finish({
          image: image, thumb: t.toDataURL('image/jpeg', 0.65), fp: fp, phash: ph,
          lat: gps ? gps.lat : null, lon: gps ? gps.lon : null, acc: gps ? gps.acc : null,
          capturedAt: now.getTime(), framing: framingScore(), guide: guide === 'loading' ? 'off' : guide, width: w, height: h,
          outletType: isDisplay ? 'Display' : 'Regular', frame: isDisplay ? lastFrame : 'skip',
          displaySeen: !isDisplay && displaySeenTicks >= 3, quality: quality, overrideReason: overrideReason,
          frameBox: frameBox, demoBoxes: demoBoxes,
          stats: { brightness: quality.vals.brightness, sharpness: quality.vals.sharpness, glare: quality.vals.glare }
        });
      }

      function finish(result) {
        if (closed) return;
        closed = true;
        clearTimeout(timer);
        if (stream) stream.getTracks().forEach(tr => tr.stop());
        if (watchId != null) navigator.geolocation.clearWatch(watchId);
        window.removeEventListener('deviceorientation', onOrient);
        if (demo) demo.stop();
        el.remove();
        resolve(result);
      }

      el.querySelector('[data-close]').addEventListener('click', () => finish(null));
      shutter.addEventListener('click', capture);
      ovBtn.addEventListener('click', () => {
        ovPanel.hidden = false; ovBtn.hidden = true;
        const ctl = el.querySelector('.demo-ctl'); if (ctl) ctl.hidden = true;
      });
      ovPanel.addEventListener('click', e => {
        const b = e.target.closest('[data-reason]');
        if (!b) return;
        overrideReason = b.dataset.reason;
        ovPanel.hidden = true;
        const ctl = el.querySelector('.demo-ctl'); if (ctl && demo) ctl.hidden = false;
      });
      document.addEventListener('keydown', function esc(e) {
        if (closed) { document.removeEventListener('keydown', esc); return; }
        if (e.key === 'Escape') finish(null);
      });

      startSource().then(evaluate).catch(err => {
        say.textContent = (err && err.name === 'NotAllowedError') ? 'ক্যামেরার অনুমতি দিন, তারপর আবার খুলুন' : (err.message || 'ক্যামেরা চালু করা যায়নি');
      });
    });
  }

  /**
   * Demo only: turn a photo picked with the phone's own camera app or gallery into the same result
   * the guided camera returns (resized, fingerprinted before the watermark, then watermarked).
   */
  function fromFile(file, opts) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const k = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
        const c = document.createElement('canvas');
        c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const fp = dHash(c), ph = pHash(c);
        const now = new Date();
        const st = frameStats(c, w, h);
        let hr = now.getHours(); const ap = hr >= 12 ? 'PM' : 'AM'; hr = hr % 12 || 12;
        watermark(ctx, w, h, {
          when: now.getDate() + ' ' + now.toLocaleString('en-US', { month: 'short' }) + ' ' + now.getFullYear() + '  ' + hr + ':' + String(now.getMinutes()).padStart(2, '0') + ' ' + ap,
          who: opts.merchName || '', code: opts.outlet.code, outlet: opts.outlet.name || '', where: 'ডেমো: GPS ছাড়া'
        });
        const t = document.createElement('canvas');
        t.width = THUMB_W; t.height = Math.round(h * THUMB_W / w);
        t.getContext('2d').drawImage(c, 0, 0, t.width, t.height);
        resolve({
          image: c.toDataURL('image/jpeg', JPEG_Q), thumb: t.toDataURL('image/jpeg', 0.65), fp: fp, phash: ph,
          lat: null, lon: null, acc: null, capturedAt: now.getTime(), framing: null, guide: 'off', width: w, height: h,
          outletType: opts.outletType || 'Regular', frame: 'skip', displaySeen: false, overrideReason: '',
          quality: { passed: false, failed: ['guide'], vals: { brightness: Math.round(st.brightness), sharpness: Math.round(st.sharpness), glare: Math.round(st.glare * 1000) / 1000 } },
          stats: { brightness: Math.round(st.brightness), sharpness: Math.round(st.sharpness) }
        });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('ছবিটি খোলা যায়নি')); };
      img.src = url;
    });
  }

  window.GuidedCamera = {
    open: open,
    fromFile: fromFile,
    preload: modelUrl => { loadDetector(modelUrl).catch(() => {}); },
    dHash: dHash,
    pHash: pHash,
    detectFrame: detectFrame,
    frameStats: frameStats
  };
})();
