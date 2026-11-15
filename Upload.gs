/**
 * Photo upload: save the photo, run the duplicate checks, write the Images row.
 * Every answer goes back to the phone, so the merchandiser sees the real result.
 */

function upload_(user, req, settings) {
  const clientId = norm_(req.clientId);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(clientId)) {
    return { ok: false, error: 'BAD', final: true, message: 'অ্যাপ আপডেট করুন (upload ID নেই)' };
  }
  const code = upper_(req.outletCode);
  if (!code) return { ok: false, error: 'OUTLET', final: true, message: 'আউটলেট কোড নেই' };
  const preFlags = [];
  let outlet = pjpByCode_()[code];
  if (!outlet) {
    if (user.role === 'Admin') return { ok: false, error: 'OUTLET', final: true, message: 'এই আউটলেট কোড PJP-তে নেই: ' + code };
    // The phone saved its outlet list earlier; the outlet left the PJP since. Keep the photo, an admin decides.
    outlet = {
      code: code, name: norm_(req.outletName) || code, region: '', dbCode: '', dbName: '', route: '', slab: '',
      status: norm_(req.outletStatus), merch: user.name, unit: '', lat: null, lon: null
    };
    preFlags.push('আউটলেটটি এখন PJP-তে নেই');
  } else if (user.role === 'Merchandiser' && !sameName_(outlet.merch, user.name)) {
    preFlags.push('আউটলেটটি এখন অন্য মার্চেন্ডাইজারের PJP-তে (' + (outlet.merch || 'TM/SR') + ')');
  } else if (user.role === 'SR' && !inTeamScope_(outlet, settings)) {
    return { ok: false, error: 'OUTLET', final: true, message: 'এই আউটলেটের ছবি মার্চেন্ডাইজার তোলেন: ' + code };
  }
  const m = /^data:image\/jpe?g;base64,(.+)$/.exec(String(req.image || ''));
  if (!m) return { ok: false, error: 'IMAGE', final: true, message: 'ছবি পাওয়া যায়নি, আবার তুলুন' };
  const bytes = Utilities.base64Decode(m[1]);
  if (!isJpeg_(bytes)) return { ok: false, error: 'IMAGE', final: true, message: 'ছবির ফাইল ঠিক নেই, আবার তুলুন' };
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'IMAGE', final: true, message: 'ছবির সাইজ অনেক বড়' };

  const now = new Date();
  // The day and month of a visit = when the photo was TAKEN (kept on the phone through offline time).
  let capturedAt = num_(req.capturedAt) ? new Date(Number(req.capturedAt)) : now;
  const clockWrong = capturedAt > new Date(now.getTime() + 10 * 60000);
  if (clockWrong) capturedAt = now;
  const month = monthKey_(capturedAt);
  const fp = /^[0-9a-f]{16}$/i.test(String(req.fp || '')) ? String(req.fp).toLowerCase() : '';
  const phash = /^[0-9a-f]{64}$/i.test(String(req.phash || '')) ? String(req.phash).toLowerCase() : '';
  const lat = num_(req.lat), lon = num_(req.lon), acc = num_(req.acc);
  const hasGps = lat != null && lon != null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const guide = ['full', 'frame', 'regular', 'basic', 'off'].indexOf(req.guide) >= 0 ? req.guide : 'off';
  const framing = num_(req.framing);
  const outletType = effectiveOutletType_(outlet);
  const q = req.quality && typeof req.quality === 'object' ? req.quality : null;
  const quality = q ? { passed: q.passed === true, failed: Array.isArray(q.failed) ? q.failed.map(norm_).slice(0, 8) : [],
    vals: q.vals && typeof q.vals === 'object' ? q.vals : {} } : null;
  const override = norm_(req.overrideReason).slice(0, 150);
  const frame = ['ok', 'far', 'close', 'offcenter', 'none', 'skip'].indexOf(req.frame) >= 0 ? req.frame : '';
  const displaySeen = req.displaySeen === true;
  const premium = cleanPremium_(req.premium);
  const sha = sha256Hex_(bytes);

  // One upload at a time. The repeat check runs BEFORE anything is saved to Drive.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) {
    return { ok: false, error: 'BUSY', message: 'সার্ভার ব্যস্ত। ছবিটি ফোনে রাখা আছে, একটু পরে নিজে থেকেই আবার পাঠানো হবে।' };
  }
  try {
    const since = new Date(now.getTime() - settings.fp_lookback_days * 864e5);
    const recent = readImages_(since, IMG.dupStatus);
    ['captureTs', 'reviewDecision', 'phash', 'sha'].forEach(k => attachColumn_(recent, k));
    const review = readReview_();

    // Same upload sent twice (the phone retried after a network drop): return the first answer, save nothing.
    const prev = recent.find(r => r.uploadId === clientId);
    if (prev) {
      const st = photoStatus_(prev, rejectedIds_(review));
      return {
        ok: true, status: st === 'Pending review' ? 'flagged' : 'accepted', uploadId: clientId,
        fileId: prev.fileId, photoNo: prev.photoNo, message: 'আগেই জমা হয়েছে'
      };
    }
    const prevRej = review.find(r => r.uploadId === clientId && r.type === 'Rejected');
    if (prevRej) {
      return { ok: false, error: 'REJECTED', final: true, uploadId: clientId, fileId: fileIdFromUrl_(prevRej.url), message: prevRej.reason };
    }

    const rejected = rejectedIds_(review);
    const locs = locationRows_();
    const check = runChecks_({
      user, code, outlet, outletType, fp, phash, sha, lat, lon, acc, hasGps, now, capturedAt, clockWrong, month,
      recent, rejected, settings, guide, quality, override, frame, displaySeen, premium, locs
    });
    check.flags = preFlags.concat(check.flags);

    const safeName = user.name.replace(/[^\wঀ-৿]+/g, '-');
    const fileName = code + '_' + fmt_(capturedAt, 'yyyy-MM-dd_HH-mm') + '_' + safeName + '.jpg';

    if (check.reject) {
      // A rule the company set (e.g. the monthly photo limit). The photo is kept as evidence in Rejected.
      const rf = rejectedFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg', 'REJECTED_' + fileName));
      applySharing_(rf, settings);
      addReview_({
        uploadId: clientId, type: 'Rejected', code, merch: user.name, reason: check.reject,
        matchedId: check.matched ? check.matched.uploadId : '', url: rf.getUrl(),
        matchedUrl: check.matched ? check.matched.url : ''
      });
      SpreadsheetApp.flush();
      return { ok: false, error: 'REJECTED', final: true, uploadId: clientId, fileId: rf.getId(), message: check.reject };
    }

    const file = monthFolder_(month).createFile(Utilities.newBlob(bytes, 'image/jpeg', fileName));
    applySharing_(file, settings);
    let thumbId = '';
    const tm = /^data:image\/jpe?g;base64,(.+)$/.exec(String(req.thumb || ''));
    if (tm && tm[1].length < 400000) {
      try {
        const tb = Utilities.base64Decode(tm[1]);
        if (isJpeg_(tb)) thumbId = thumbFolder_(month).createFile(Utilities.newBlob(tb, 'image/jpeg', 'T_' + fileName)).getId();
      } catch (e) { log_('upload.thumb', e.message); }
    }

    const flagged = check.flags.length > 0;
    const row = IMG_COLS.map(() => '');
    const put = (k, v) => { row[IMG[k] - 1] = v; };
    put('ts', now); put('uploadId', clientId); put('month', month);
    put('merch', user.name); put('role', user.role);
    put('code', code); put('outletName', outlet.name); put('region', outlet.region); put('dbCode', outlet.dbCode);
    put('dbName', outlet.dbName); put('route', outlet.route); put('slab', outlet.slab); put('status', outlet.status);
    put('fileId', file.getId()); put('url', file.getUrl());
    put('lat', hasGps ? lat : ''); put('lon', hasGps ? lon : ''); put('acc', acc != null ? Math.round(acc) : '');
    put('dist', check.dist);
    put('fp', fp); put('framing', framing != null ? Math.round(framing) : '');
    put('dupStatus', flagged ? 'Flagged' : 'Unique'); put('dupReason', check.flags.join('; '));
    put('valid', check.displayValid);
    if (outletType === 'Regular') { put('full', 'Not required'); DISPLAY_BRANDS.forEach(b => put(b, 'Not required')); }
    put('aiStatus', settings.ai_provider === 'Gemini' ? 'Pending' : 'Off');
    put('photoNo', check.photoNo); put('appVer', norm_(req.appVersion));
    put('captureTs', capturedAt); put('source', req.source === 'gallery' ? 'Gallery' : 'Camera'); put('guide', guide);
    put('outletType', outletType);
    put('quality', !quality ? '' : quality.passed ? 'Passed' : override ? 'Override' : 'Below limits');
    put('qualityVals', quality ? qualityText_(quality, frame) : '');
    put('override', override); put('displaySeen', displaySeen ? 'Yes' : '');
    put('colgate', premium.colgate || 'Not checked');
    put('premiumPresence', premium.presence); put('premiumBy', premium.model || '');
    if (premium.presence === 'Yes') {
      const found = premium.items.filter(it => it.found !== false);
      put('premium', found.map(it => it.name || it.sku).join(', '));
      put('facings', found.map(it => it.sku + ': ' + (it.facings || 1)).join('; '));
    }
    put('phash', phash); put('sha', sha); put('thumbId', thumbId); put('locCheck', check.locCheck);
    put('notes', check.notes.join('; '));

    const sh = sheet_(TAB.IMAGES);
    ensureRows_(sh, 1);
    sh.getRange(sh.getLastRow() + 1, 1, 1, row.length).setValues([row]);
    if (flagged) {
      addReview_({
        uploadId: clientId, type: 'Flagged', code, merch: user.name, reason: check.flags.join('; '),
        matchedId: check.matched ? check.matched.uploadId : '', url: file.getUrl(),
        matchedUrl: check.matched ? check.matched.url : ''
      });
    }
    check.reviewNotes.forEach(n => addReview_({
      uploadId: clientId, type: n.type, code, merch: user.name, reason: n.reason, url: file.getUrl(),
      matchedId: n.matched ? n.matched.uploadId : '', matchedUrl: n.matched ? n.matched.url : ''
    }));
    if (premium.items.length) {
      writePremiumDetail_({ capturedAt, uploadId: clientId, code, outletType, merch: user.name },
        premium.items, premium.presence, premium.model || 'On-phone model');
    }
    if (!flagged && hasGps && acc != null && acc <= settings.location_learn_max_acc_m && !verifiedLocation_(outlet, locs)) {
      try { learnLocation_(outlet, { lat, lon, acc }, recent, rejected, settings, clientId, locs); } catch (e) { log_('upload.location', e.message); }
    }
    SpreadsheetApp.flush();
    return {
      ok: true, status: flagged ? 'flagged' : 'accepted', uploadId: clientId, fileId: file.getId(), photoNo: check.photoNo,
      outletType: outletType,
      message: flagged ? 'জমা হয়েছে, অ্যাডমিন যাচাই করবেন: ' + check.flags.join('; ') : 'সফলভাবে জমা হয়েছে'
    };
  } finally {
    lock.releaseLock();
  }
}

/** Display if the PJP says so, or if a Regular → Display conversion was Approved (before the PJP is edited). */
function effectiveOutletType_(outlet) {
  if (isDisplayStatus_(outlet.status)) return 'Display';
  const conv = conversionStatusMap_(new Set([outlet.code]));
  return conv[outlet.code] === 'Approved' ? 'Display' : 'Regular';
}

/** The premium result the phone's model sent, cleaned. Without a model: "Not checked" (never "No"). */
function cleanPremium_(p) {
  const out = { presence: 'Not checked', items: [], model: '', colgate: '' };
  if (!p || typeof p !== 'object') return out;
  if (['Yes', 'No', 'Needs review'].indexOf(p.presence) >= 0) out.presence = p.presence;
  out.model = norm_(p.model).slice(0, 60);
  if (['Yes', 'No'].indexOf(p.colgate) >= 0) out.colgate = p.colgate;
  if (Array.isArray(p.items)) {
    out.items = p.items.slice(0, 30).map(it => ({
      sku: norm_(it.sku).slice(0, 30), name: norm_(it.name).slice(0, 80), conf: num_(it.conf),
      facings: num_(it.facings), found: it.found !== false,
      box: Array.isArray(it.box) ? it.box.slice(0, 4).map(Number) : null
    })).filter(it => it.sku);
  }
  return out;
}

function qualityText_(q, frame) {
  const v = q.vals || {};
  const parts = [];
  ['brightness', 'sharpness', 'glare', 'tilt', 'frameWidth', 'frameOffset', 'band'].forEach(k => {
    if (v[k] != null && v[k] !== '') parts.push(k + '=' + (Math.round(Number(v[k]) * 100) / 100));
  });
  if (frame) parts.push('frame=' + frame);
  if (q.failed.length) parts.push('failed=' + q.failed.join('/'));
  return parts.join(' ');
}

/**
 * All duplicate, location and quality rules.
 * Returns {reject, flags[], notes[], reviewNotes[], matched, dist, photoNo, displayValid, locCheck}.
 *   reject      = a company rule (monthly limit, min days). Only these stop a photo.
 *   flags       = the photo waits in "Pending review" until an admin decides.
 *   notes       = information only; the photo is approved.
 */
function runChecks_(c) {
  const s = c.settings;
  const flags = [], notes = [], reviewNotes = [];
  let reject = null, matched = null, dist = '', photoNo = '', locCheck = '';
  const counted = r => isCounted_(r, c.rejected);
  const when = r => toDate_(r.captureTs) || toDate_(r.ts) || c.now;

  // A. The photos-a-month rule (by capture month): each role counts its own photos. Admins are not limited.
  if (c.user.role !== 'Admin') {
    const thisMonth = c.recent.filter(r => r.month === c.month && r.code === c.code && r.role === c.user.role && counted(r));
    photoNo = thisMonth.length + 1;
    if (thisMonth.length >= s.max_photos_per_month) {
      reject = 'এই মাসে এই আউটলেটের ' + thisMonth.length + 'টি ছবি আগেই জমা হয়েছে';
    } else if (s.min_days_between > 0 && thisMonth.length) {
      const lastTs = Math.max.apply(null, thisMonth.map(r => when(r).getTime()));
      const days = (c.capturedAt.getTime() - lastTs) / 864e5;
      if (days < s.min_days_between) {
        reject = 'আগের ছবির কমপক্ষে ' + s.min_days_between + ' দিন পর ২য় ছবি তুলুন (আরও ' +
          Math.ceil(s.min_days_between - days) + ' দিন বাকি)';
      }
    }
  }
  if (reject) return { reject, flags, notes, reviewNotes, matched, dist, photoNo, displayValid: '', locCheck };

  // B. Exact copy of an earlier file (same bytes).
  const copy = c.sha ? c.recent.find(r => r.sha && String(r.sha) === c.sha && counted(r)) : null;
  if (copy) {
    matched = copy;
    flags.push('হুবহু একই ফাইল আগে ' + copy.code + ' আউটলেটে জমা হয়েছে (' + dayKey_(when(copy)) + ')');
  }

  // C. Similar-looking photo. A warning only, never an automatic rejection.
  if (!copy && c.fp) {
    let best = null;
    c.recent.forEach(r => {
      if (!r.fp || !counted(r)) return;
      const d = hamming_(c.fp, String(r.fp));
      const dp = c.phash && r.phash ? hamming_(c.phash, String(r.phash)) : null;
      const similar = d <= s.fp_flag_bits && (dp == null || dp <= s.phash_flag_bits);
      if (!similar) return;
      if (!best || d < best.d) best = { d: d, dp: dp, r: r };
    });
    if (best) {
      const r = best.r, nearCopy = best.d <= s.fp_reject_bits;
      if (r.code === c.code) {
        // A new photo of the same unchanged display is fine (agreed 14 Nov).
        notes.push('একই আউটলেটের আগের ছবির মতো দেখতে');
      } else {
        const rl = num_(r.lat), ro = num_(r.lon), ra = num_(r.acc);
        const apart = c.hasGps && rl != null && ro != null ? haversine_(c.lat, c.lon, rl, ro) : null;
        const goodGps = c.acc != null && c.acc <= s.gps_max_accuracy_m && ra != null && ra <= s.gps_max_accuracy_m;
        if (apart != null && goodGps && apart > s.dup_far_apart_m) {
          notes.push('অন্য আউটলেট ' + r.code + ' এর ছবির মতো, তবে ' + Math.round(apart) + ' মিটার দূরে (আলাদা দোকান)');
        } else {
          matched = r;
          flags.push((nearCopy ? 'প্রায় হুবহু মিল: ' : 'মিল আছে: ') + 'অন্য আউটলেট ' + r.code + ' এর ছবির সাথে' +
            (apart != null ? ' (' + Math.round(apart) + ' মিটার)' : ' (GPS নেই)'));
        }
      }
    }
  }

  // D. Location.
  if (!c.hasGps) {
    flags.push('লোকেশন পাওয়া যায়নি');
    locCheck = 'Location unknown';
  } else {
    if (c.acc != null && c.acc > s.gps_max_accuracy_m) notes.push('GPS দুর্বল (±' + Math.round(c.acc) + ' মি)');
    const ref = verifiedLocation_(c.outlet, c.locs);
    if (ref) {
      dist = Math.round(haversine_(c.lat, c.lon, ref.lat, ref.lon));
      const beyond = dist - (c.acc || 0);
      if (beyond > s.gps_far_m) {
        flags.push('যাচাই করা আউটলেট লোকেশন থেকে ' + dist + ' মিটার দূরে');
        locCheck = 'Far from verified location';
      } else locCheck = 'OK (' + ref.src + ')';
    } else {
      const p = c.locs.find(r => r.code === c.code && r.lat != null && r.lon != null);
      if (p) dist = Math.round(haversine_(c.lat, c.lon, p.lat, p.lon));
      locCheck = 'Outlet location not verified yet';
    }
    const windowMs = s.gps_cluster_min * 60000;
    const near = c.recent.find(r => {
      if (!sameName_(r.merch, c.user.name) || r.code === c.code || !counted(r)) return false;
      const rl = num_(r.lat), ro = num_(r.lon);
      if (rl == null || ro == null) return false;
      if (Math.abs(when(r).getTime() - c.capturedAt.getTime()) > windowMs) return false;
      return haversine_(c.lat, c.lon, rl, ro) <= s.gps_cluster_m;
    });
    if (near) notes.push('কাছাকাছি সময়ে একই জায়গা থেকে আউটলেট ' + near.code + ' এর ছবিও তোলা');
  }

  // E. Time.
  if (c.clockWrong) notes.push('ফোনের ঘড়ি ভুল ছিল; জমার সময় ব্যবহার করা হয়েছে');
  const hoursLate = (c.now.getTime() - c.capturedAt.getTime()) / 36e5;
  if (hoursLate > 30 * 24) flags.push('ছবিটি ৩০ দিনের বেশি পুরনো');
  else if (hoursLate > s.late_upload_hours) notes.push('ছবি তোলার ' + Math.round(hoursLate) + ' ঘণ্টা পর জমা');

  // F. Camera and photo quality.
  if (c.guide === 'off') flags.push('ক্যামেরা গাইড ছাড়া তোলা');
  if (c.quality && !c.quality.passed) {
    if (c.override) flags.push('মান যাচাই পাস করেনি; কারণ: ' + c.override);
    else notes.push('ছবির মান সীমার নিচে (' + c.quality.failed.join(', ') + ')');
  }

  // G. Outlet type. Display outlets need the Smile Corner frame; Regular outlets never do.
  let displayValid = 'Not required';
  if (c.outletType === 'Display') {
    if (!c.frame || c.frame === 'skip') displayValid = '';
    else if (c.frame === 'none') {
      displayValid = 'Not visible';
      flags.push('ডিসপ্লে আউটলেট, কিন্তু ক্যামেরা স্মাইল কর্নার ডিসপ্লে দেখেনি');
    } else displayValid = 'Yes';
  } else if (c.displaySeen) {
    reviewNotes.push({ type: 'Possible conversion', reason: 'Regular আউটলেটে স্মাইল কর্নার ডিসপ্লে দেখা গেছে: রিপোর্ট না হওয়া রূপান্তর হতে পারে' });
  }

  // H. Premium SKUs: an uncertain answer is never turned into "No".
  if (c.premium.presence === 'Needs review') {
    reviewNotes.push({ type: 'Premium check', reason: 'প্রিমিয়াম SKU নিশ্চিত নয়: ' + c.premium.items.map(i => i.sku).join(', ') });
  }
  if (c.premium.colgate === 'No' && c.outletType === 'Regular') flags.push('ছবিতে কোনো কলগেট পণ্য দেখা যায়নি');

  return { reject, flags, notes, reviewNotes, matched, dist, photoNo, displayValid, locCheck };
}

/** First check-in of the day for the merchandiser ("Start day" button). */
function checkIn_(user, req) {
  const today = dayKey_(new Date());
  const existing = rows_(TAB.CHECKINS, CHECKIN_HEADERS.length)
    .find(r => cellDayKey_(r[0]) === today && sameName_(r[1], user.name));
  if (existing) return { ok: true, time: toDate_(existing[2]) ? toDate_(existing[2]).toISOString() : '', already: true };
  const now = new Date();
  const lat = num_(req.lat), lon = num_(req.lon), acc = num_(req.acc);
  sheet_(TAB.CHECKINS).appendRow([dateFromKey_(today), user.name, now, lat == null ? '' : lat, lon == null ? '' : lon,
    acc == null ? '' : Math.round(acc)]);
  return { ok: true, time: now.toISOString() };
}

function newOutlet_(user, req) {
  const f = k => norm_(req[k]);
  const required = ['distCode', 'distName', 'outletName', 'ownerName', 'contactNumber', 'slab', 'routeName'];
  if (required.some(k => !f(k))) return { ok: false, error: 'FORM', message: 'সব * চিহ্নিত তথ্য পূরণ করুন' };
  if (!/^01\d{9}$/.test(f('contactNumber'))) return { ok: false, error: 'FORM', message: 'মোবাইল নম্বর ০১ দিয়ে শুরু হওয়া ১১ ডিজিট হতে হবে' };
  sheet_(TAB.NEW_OUTLET).appendRow([new Date(), f('distCode'), f('distName'), '', f('outletName'), f('ownerName'),
    "'" + f('contactNumber'), f('slab'), f('routeCode'), f('routeName'), user.name]);
  return { ok: true, message: 'নতুন আউটলেট সেভ হয়েছে' };
}
