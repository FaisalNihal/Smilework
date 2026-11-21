/**
 * The web app. The phone sends every request as a POST with a JSON body {action, token, ...}
 * and always gets a JSON answer back: {ok: true, ...} or {ok: false, error, message}.
 * This is the ONLY doGet/doPost in the project.
 */

function doGet() {
  return json_({ ok: true, app: 'Colgate Smile Corner', version: APP_VERSION });
}

function doPost(e) {
  let req = {};
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD', message: 'Bad request' });
  }
  return json_(handle_(req));
}

function handle_(req) {
  const action = norm_(req.action);
  try {
    if (action === 'ping') return { ok: true, version: APP_VERSION };
    if (action === 'loginNames') return { ok: true, names: loginNames_() };
    if (action === 'login') return login_(req);
    if (action === 'teamLogin') return teamLogin_(req);

    const user = verifyToken_(req.token);
    if (!user) return { ok: false, error: 'AUTH', message: 'আবার লগইন করুন' };
    const settings = getSettings_();
    if (settings.maintenance && user.role !== 'Admin') {
      return { ok: false, error: 'MAINTENANCE', message: 'অ্যাপের কাজ চলছে। কিছুক্ষণ পর আবার চেষ্টা করুন।' };
    }
    const admin = () => {
      if (user.role !== 'Admin') throw new Error('Admins only');
    };

    switch (action) {
      case 'bootstrap': return bootstrap_(user, settings);
      case 'upload': return upload_(user, req, settings);
      case 'convert':
        if (user.role === 'Admin') throw new Error('Admins approve conversions; they do not submit them');
        return convert_(user, req, settings);
      case 'myPhotos': return myPhotos_(user, req);
      case 'thumbs': return thumbs_(user, req);
      case 'checkIn': return checkIn_(user, req);
      case 'newOutlet':
        if (user.role === 'Merchandiser') throw new Error('Not allowed');
        return newOutlet_(user, req);
      case 'adminStats': admin(); return adminStats_();
      case 'reviewList': admin(); return reviewList_();
      case 'reviewDecide': admin(); return reviewDecide_(user, req);
      case 'saveSettings': admin(); return saveSettings_(req);
      default: return { ok: false, error: 'BAD', message: 'Unknown action: ' + action };
    }
  } catch (err) {
    log_('api.' + action, err && err.stack ? err.stack : err);
    return { ok: false, error: 'SERVER', message: 'সার্ভারে সমস্যা: ' + (err && err.message ? err.message : err) };
  }
}

function publicSettings_(settings) {
  const out = {};
  PUBLIC_SETTINGS.forEach(k => { out[k] = settings[k]; });
  out.tm_login_on = !!norm_(settings.tm_password);
  return out;
}

/** Everything the app needs after login, in one call. */
function bootstrap_(user, settings) {
  const now = new Date();
  const month = monthKey_(now), today = dayKey_(now);
  const isMerch = user.role === 'Merchandiser';
  const pjp = pjpRows_().filter(o => isMerch ? sameName_(o.merch, user.name)
    : user.role === 'SR' ? inTeamScope_(o, settings) : true);
  const role = countRole_(user.role);

  const cols = ['region', 'territory', 'dbCode', 'dbName', 'code', 'name', 'slab', 'routeCode', 'route', 'visitDay',
    'merch', 'status', 'unit'];
  const monthStart = dateFromKey_(month + '-01');
  const rows = readImages_(monthStart);
  const rejected = rejectedIds_();
  const codes = new Set(pjp.map(o => o.code));
  const monthCounts = {};
  rows.forEach(r => {
    if (r.month !== month || r.role !== role || !isCounted_(r, rejected)) return;
    if (!codes.has(r.code)) return;
    monthCounts[r.code] = (monthCounts[r.code] || 0) + 1;
  });

  // Premium SKU presence this month per outlet: Yes beats Needs review beats No. "Not checked" is left out.
  const premium = {};
  const rank = { 'Yes': 3, 'Needs review': 2, 'No': 1 };
  rows.forEach(r => {
    if (r.month !== month || !codes.has(r.code) || !isCounted_(r, rejected)) return;
    let p = norm_(r.premiumPresence);
    if (!p && norm_(r.aiStatus) === 'Done') p = norm_(r.premium) ? 'Yes' : 'No';   // photos from before v2.1
    if (!rank[p]) return;
    if (!premium[r.code] || rank[p] > rank[premium[r.code]]) premium[r.code] = p;
  });

  const checkin = rows_(TAB.CHECKINS, CHECKIN_HEADERS.length)
    .find(r => cellDayKey_(r[0]) === today && sameName_(r[1], user.name));

  return {
    ok: true,
    user: user,
    serverVersion: APP_VERSION,
    serverTime: now.toISOString(),
    month: month,
    settings: publicSettings_(settings),
    pjp: { cols: cols, rows: pjp.map(o => cols.map(k => o[k])) },
    monthCounts: monthCounts,
    todayPhotos: rows.filter(r => sameName_(r.merch, user.name) && dayKey_(toDate_(r.captureTs) || toDate_(r.ts) || now) === today)
      .map(r => photoOut_(r, rejected)),
    checkIn: checkin && toDate_(checkin[2]) ? toDate_(checkin[2]).toISOString() : '',
    conversions: conversionStatusMap_(codes),
    premium: premium
  };
}

function photoOut_(r, rejected) {
  const t = toDate_(r.captureTs) || toDate_(r.ts);
  return {
    uploadId: r.uploadId, ts: t ? t.toISOString() : '', uploadedAt: toDate_(r.ts) ? toDate_(r.ts).toISOString() : '',
    code: r.code, outletName: norm_(r.outletName), fileId: norm_(r.fileId), dupStatus: norm_(r.dupStatus),
    dupReason: norm_(r.dupReason), valid: norm_(r.valid), premium: norm_(r.premium), aiStatus: norm_(r.aiStatus),
    comment: norm_(r.comment), photoNo: r.photoNo, reviewDecision: norm_(r.reviewDecision), merch: norm_(r.merch),
    status: photoStatus_(r, rejected || new Set()), outletType: norm_(r.outletType) || (isDisplayStatus_(r.status) ? 'Display' : 'Regular'),
    premiumPresence: norm_(r.premiumPresence) || 'Not checked', quality: norm_(r.quality), notes: norm_(r.notes),
    locCheck: norm_(r.locCheck)
  };
}

/** A person's photos for a month (admins may ask for anyone), including rejected attempts. */
function myPhotos_(user, req) {
  const month = /^\d{4}-\d{2}$/.test(norm_(req.month)) ? norm_(req.month) : monthKey_(new Date());
  const who = user.role === 'Admin' && norm_(req.merch) ? norm_(req.merch) : user.name;
  const start = dateFromKey_(month + '-01');
  const rows = readImages_(start).filter(r => r.month === month && sameName_(r.merch, who));
  const review = readReview_();
  const rejectedIds = rejectedIds_(review);
  const photos = rows.map(r => {
    const p = photoOut_(r, rejectedIds);
    if (rejectedIds.has(r.uploadId)) p.reviewDecision = 'Reject';
    return p;
  });
  review.forEach(r => {
    const t = toDate_(r.loggedAt);
    if (r.type !== 'Rejected' || !sameName_(r.merch, who) || !t || monthKey_(t) !== month) return;
    photos.push({
      uploadId: r.uploadId, ts: t.toISOString(), code: r.code, outletName: '', fileId: fileIdFromUrl_(r.url),
      dupStatus: 'Rejected', dupReason: r.reason, valid: '', premium: '', aiStatus: '', comment: '', photoNo: '',
      reviewDecision: '', merch: r.merch, status: 'Rejected', outletType: '', premiumPresence: '', quality: '', notes: ''
    });
  });
  photos.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return { ok: true, month: month, photos: photos };
}

/** Admin dashboard numbers: today, the AI queue, the review queue and month progress per merchandiser. */
function adminStats_() {
  const now = new Date();
  const today = dayKey_(now), month = monthKey_(now);
  const rows = readImages_(dateFromKey_(month + '-01'), IMG.status);
  const review = readReview_();
  const rejected = rejectedIds_(review);
  const todays = rows.filter(r => dayKey_(toDate_(r.ts) || now) === today);

  const sh = sheet_(TAB.IMAGES);
  let aiPending = 0;
  if (sh.getLastRow() > 1 && getSettings_().ai_provider === 'Gemini') {
    aiPending = sh.getRange(2, IMG.aiStatus, sh.getLastRow() - 1, 1).getValues()
      .filter(r => norm_(r[0]) === 'Pending').length;
  }

  const outletsBy = {};
  pjpRows_().forEach(o => {
    if (!o.merch) return;
    (outletsBy[o.merch] = outletsBy[o.merch] || new Set()).add(o.code);
  });
  const counts = {};
  rows.forEach(r => {
    if (r.month !== month || r.role !== 'Merchandiser' || !isCounted_(r, rejected)) return;
    counts[r.code] = (counts[r.code] || 0) + 1;
  });
  const s = getSettings_();
  const teamCodes = Array.from(new Set(pjpRows_().filter(o => inTeamScope_(o, s)).map(o => o.code)));   // each outlet once (date-wise PJP lists it twice)
  const teamCounts = {};
  rows.forEach(r => {
    if (r.month !== month || r.role !== 'SR' || !isCounted_(r, rejected)) return;
    teamCounts[r.code] = (teamCounts[r.code] || 0) + 1;
  });
  const progress = Object.keys(outletsBy).sort().map(name => {
    const codes = Array.from(outletsBy[name]);
    const n = c => counts[c] || 0;
    return {
      merch: name, outlets: codes.length,
      done: codes.filter(c => n(c) >= 2).length,
      one: codes.filter(c => n(c) === 1).length,
      none: codes.filter(c => n(c) === 0).length,
      today: todays.filter(r => sameName_(r.merch, name)).length
    };
  });
  if (teamCodes.length) {
    const n = c => teamCounts[c] || 0;
    progress.push({
      merch: 'TM/SR (' + (norm_(s.tm_outlet_units) || 'all') + ')', outlets: teamCodes.length, team: true,
      done: teamCodes.filter(c => n(c) >= 2).length, one: teamCodes.filter(c => n(c) === 1).length,
      none: teamCodes.filter(c => n(c) === 0).length, today: todays.filter(r => r.role === 'SR').length
    });
  }

  const convMonth = readConversions_().filter(c => c.month === month);
  const convBy = {};
  convMonth.forEach(c => {
    if (c.status === 'Rejected') return;
    const k = c.role === 'SR' ? 'TM/SR' : c.by.toLowerCase();
    convBy[k] = (convBy[k] || 0) + 1;
  });
  progress.forEach(p => { p.conversions = p.team ? (convBy['TM/SR'] || 0) : (convBy[p.merch.toLowerCase()] || 0); });
  return {
    ok: true,
    conversions: {
      pending: convMonth.filter(c => c.status === 'Pending').length,
      approved: convMonth.filter(c => c.status === 'Approved').length,
      rejected: convMonth.filter(c => c.status === 'Rejected').length
    },
    today: {
      uploads: todays.length,
      flagged: todays.filter(r => photoStatus_(r, rejected) === 'Pending review').length,
      rejected: review.filter(r => r.type === 'Rejected' && toDate_(r.loggedAt) && dayKey_(toDate_(r.loggedAt)) === today).length,
      people: new Set(todays.map(r => norm_(r.merch).toLowerCase())).size
    },
    aiPending: aiPending,
    openReviews: review.filter(r => !r.decision).length,
    aiProvider: getSettings_().ai_provider,
    progress: progress
  };
}

function reviewList_() {
  const conv = conversionReviewItems_();
  const items = readReview_().filter(r => !r.decision).reverse().slice(0, 60).map(r => ({
    uploadId: r.uploadId, type: r.type, code: r.code, merch: r.merch, reason: r.reason,
    loggedAt: toDate_(r.loggedAt) ? toDate_(r.loggedAt).toISOString() : '',
    fileId: fileIdFromUrl_(r.url), matchedId: r.matchedId, matchedFileId: fileIdFromUrl_(r.matchedUrl),
    aiSameShop: r.aiSameShop, blocking: REVIEW_BLOCKING.indexOf(r.type) >= 0
  }));
  return { ok: true, items: conv.concat(items) };
}

/**
 * Accept or Reject a photo waiting for review (a reason is required), or close a note with "Seen".
 * Every decision is also written to Review_Log, which is never overwritten.
 */
function reviewDecide_(user, req) {
  const id = norm_(req.uploadId);
  const decision = ['Accept', 'Reject', 'Seen'].indexOf(req.decision) >= 0 ? req.decision : '';
  const reason = norm_(req.reason).slice(0, 300);
  if (!id || !decision) return { ok: false, error: 'BAD', message: 'Missing upload or decision' };
  if (decision !== 'Seen' && !reason) return { ok: false, error: 'FORM', message: 'কারণ লিখুন' };
  if (decideConversion_(user, id, decision, reason)) return { ok: true, updated: 1 };
  const sh = sheet_(TAB.REVIEW);
  const now = new Date();
  const review = readReview_();
  const img = readImages_(new Date(now.getTime() - 400 * 864e5), IMG.dupStatus).find(r => r.uploadId === id);
  if (img) attachColumn_([img], 'reviewDecision');
  const oldStatus = img ? photoStatus_(img, rejectedIds_(review)) : '';
  let found = 0, type = '';
  review.forEach(r => {
    if (r.uploadId !== id || r.decision) return;
    // "Seen" closes notes only; Accept/Reject close everything open for this photo.
    if (decision === 'Seen' && REVIEW_BLOCKING.indexOf(r.type) >= 0) return;
    sh.getRange(r.row, REV['Decision'], 1, 4).setValues([[decision, user.name, now, reason]]);
    type = type || r.type;
    found++;
  });
  let newStatus = oldStatus;
  if (decision !== 'Seen' && img) {
    sheet_(TAB.IMAGES).getRange(img.row, IMG.reviewDecision).setValue(decision);
    newStatus = decision === 'Accept' ? 'Approved' : 'Rejected';
  }
  logDecision_({ uploadId: id, code: img ? img.code : '', merch: img ? norm_(img.merch) : '', type: type || decision,
    oldStatus: oldStatus, newStatus: decision === 'Seen' ? 'Note seen' : newStatus, by: user.name, reason: reason });
  return { ok: true, updated: found };
}

/**
 * Small preview images for the app. Photos are private in Drive, so the app asks here, with its login.
 * A CM gets only their own photos; an admin gets any photo the app knows about. Max 12 per call.
 */
function thumbs_(user, req) {
  const ids = (Array.isArray(req.ids) ? req.ids : []).map(norm_).filter(x => /^[-\w]{20,}$/.test(x)).slice(0, 12);
  if (!ids.length) return { ok: true, thumbs: {} };
  const want = new Set(ids);
  const allowed = {};   // photo file id -> thumbnail file id ('' = none)
  const isAdmin = user.role === 'Admin';
  const imgs = readImages_(new Date(Date.now() - 400 * 864e5), IMG.fileId);
  attachColumn_(imgs, 'thumbId');
  imgs.forEach(r => {
    const f = norm_(r.fileId);
    if (want.has(f) && (isAdmin || sameName_(r.merch, user.name))) allowed[f] = norm_(r.thumbId);
  });
  readConversions_().forEach(c => {
    if (want.has(c.fileId) && (isAdmin || sameName_(c.by, user.name))) allowed[c.fileId] = c.thumbId || '';
  });
  readReview_().forEach(r => {
    [fileIdFromUrl_(r.url), fileIdFromUrl_(r.matchedUrl)].forEach(f => {
      if (f && want.has(f) && allowed[f] === undefined && (isAdmin || sameName_(r.merch, user.name))) allowed[f] = '';
    });
  });
  const out = {};
  Object.keys(allowed).forEach(f => {
    try {
      let blob = null;
      if (allowed[f]) blob = DriveApp.getFileById(allowed[f]).getBlob();
      else {
        const file = DriveApp.getFileById(f);
        blob = file.getThumbnail();
        if (!blob && file.getSize() < 1500000) blob = file.getBlob();
      }
      if (blob) out[f] = 'data:image/jpeg;base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) { log_('thumbs', f + ': ' + e.message); }
  });
  return { ok: true, thumbs: out };
}

function saveSettings_(req) {
  if (req.notice !== undefined) setSetting_('notice', String(req.notice).slice(0, 500));
  if (req.maintenance !== undefined) setSetting_('maintenance', req.maintenance ? 'TRUE' : 'FALSE');
  if (req.qualityMode !== undefined) setSetting_('quality_mode', req.qualityMode === 'block' ? 'block' : 'warn');
  if (req.tmPassword !== undefined) {
    const pw = norm_(req.tmPassword);
    if (pw && pw.length < 6) return { ok: false, error: 'FORM', message: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' };
    setSetting_('tm_password', pw);
  }
  return { ok: true, settings: publicSettings_(getSettings_(true)) };
}
