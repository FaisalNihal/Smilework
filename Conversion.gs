/**
 * Regular → Display conversion (a separate KPI).
 * A merchandiser (or TM/SR for SMT outlets) picks a Regular outlet, takes a photo of the new display,
 * and the request lands in the Conversions tab as Pending. An admin approves or rejects it from the app.
 * PJP is not changed automatically: approved rows tell you which outlets to mark Display in PJP.
 */

const CONV_HEADERS = ['Submitted At', 'Month', 'Conversion ID', 'Submitted By', 'Role', 'Outlet Code', 'Outlet Name',
  'Region', 'DB Code', 'DB Name', 'Route', 'Unit', 'Status Before', 'Photo File ID', 'Photo Link', 'Latitude',
  'Longitude', 'GPS Accuracy (m)', 'Fingerprint', 'Camera Guide', 'Status', 'Decided By', 'Decided At',
  'Warning', 'Thumbnail File ID', 'Decision Reason'];
const CONV = CONV_HEADERS.reduce((m, h, i) => { m[h] = i + 1; return m; }, {});

function readConversions_() {
  return rows_(TAB.CONVERSIONS, CONV_HEADERS.length).map((r, i) => ({
    row: i + 2, ts: r[0], month: r[1] instanceof Date ? monthKey_(r[1]) : norm_(r[1]), id: norm_(r[2]),
    by: norm_(r[3]), role: norm_(r[4]), code: upper_(r[5]), outletName: norm_(r[6]), region: norm_(r[7]),
    dbCode: norm_(r[8]), route: norm_(r[10]), fileId: norm_(r[13]), url: norm_(r[14]), lat: num_(r[15]),
    lon: num_(r[16]), acc: num_(r[17]), fp: norm_(r[18]), status: norm_(r[20]), decidedBy: norm_(r[21]),
    warning: norm_(r[23]), thumbId: norm_(r[24])
  }));
}

function conversionFolder_() {
  let id = prop_('CONV_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* recreate */ } }
  const parent = prop_('ROOT_FOLDER_ID') ? DriveApp.getFolderById(prop_('ROOT_FOLDER_ID')) : DriveApp.getRootFolder();
  const folder = parent.createFolder('Conversions');
  setProp_('CONV_FOLDER_ID', folder.getId());
  return folder;
}

/** Latest conversion status per outlet code: Pending, Approved or Rejected. */
function conversionStatusMap_(codes) {
  const out = {};
  readConversions_().forEach(c => {
    if (codes && !codes.has(c.code)) return;
    out[c.code] = c.status;   // rows are in time order, so the last one wins
  });
  return out;
}

function convert_(user, req, settings) {
  const id = norm_(req.clientId);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, error: 'BAD', final: true, message: 'অ্যাপ আপডেট করুন' };
  const code = upper_(req.outletCode);
  const outlet = pjpByCode_()[code];
  if (!outlet) return { ok: false, error: 'OUTLET', final: true, message: 'এই আউটলেট কোড PJP-তে নেই: ' + code };
  if (user.role === 'Merchandiser' && !pjpRows_().some(o => o.code === code && sameName_(o.merch, user.name))) {
    return { ok: false, error: 'OUTLET', final: true, message: 'এই আউটলেট আপনার PJP-তে নেই: ' + code };
  }
  if (user.role === 'SR' && !inTeamScope_(outlet, settings)) {
    return { ok: false, error: 'OUTLET', final: true, message: 'এই আউটলেট মার্চেন্ডাইজারের তালিকায়: ' + code };
  }
  if (!/regular/i.test(outlet.status)) {
    return { ok: false, error: 'OUTLET', final: true, message: 'PJP-তে এই আউটলেট আগে থেকেই ' + (outlet.status || 'Display') };
  }
  const m = /^data:image\/jpe?g;base64,(.+)$/.exec(String(req.image || ''));
  if (!m) return { ok: false, error: 'IMAGE', final: true, message: 'ছবি পাওয়া যায়নি, আবার তুলুন' };
  const bytes = Utilities.base64Decode(m[1]);
  if (!isJpeg_(bytes)) return { ok: false, error: 'IMAGE', final: true, message: 'ছবির ফাইল ঠিক নেই, আবার তুলুন' };
  if (bytes.length > 6 * 1024 * 1024) return { ok: false, error: 'IMAGE', final: true, message: 'ছবির সাইজ অনেক বড়' };

  const now = new Date();
  const fp = /^[0-9a-f]{16}$/i.test(String(req.fp || '')) ? String(req.fp).toLowerCase() : '';
  const lat = num_(req.lat), lon = num_(req.lon), acc = num_(req.acc);

  // Repeat check first, so nothing is saved to Drive for a repeated request.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(28000)) {
    return { ok: false, error: 'BUSY', message: 'সার্ভার ব্যস্ত। ছবিটি ফোনে রাখা আছে, একটু পরে নিজে থেকেই পাঠানো হবে।' };
  }
  try {
    const conv = readConversions_();
    const prev = conv.find(c => c.id === id);
    if (prev) return { ok: true, status: 'pending', conversionId: id, message: 'আগেই জমা হয়েছে' };

    const open = conv.filter(c => c.code === code && (c.status === 'Pending' || c.status === 'Approved')).pop();
    if (open) {
      return {
        ok: false, error: 'REJECTED', final: true, conversionId: id,
        message: open.status === 'Approved' ? 'এই আউটলেটের রূপান্তর আগেই অনুমোদিত হয়েছে' : 'এই আউটলেটের রূপান্তর আগেই জমা হয়েছে, অ্যাডমিনের যাচাইয়ের অপেক্ষায়'
      };
    }

    // A picture that looks like an earlier photo is not rejected; the admin sees a warning before approving.
    let warning = '';
    if (fp) {
      const since = new Date(now.getTime() - settings.fp_lookback_days * 864e5);
      const pool = readImages_(since, IMG.fp).map(r => ({ code: r.code, fp: norm_(r.fp) }))
        .concat(conv.map(c => ({ code: c.code, fp: c.fp })));
      const hit = pool.find(p => p.fp && hamming_(fp, p.fp) <= settings.fp_reject_bits);
      if (hit) warning = 'আগের একটি ছবির সাথে প্রায় হুবহু মিল (আউটলেট ' + hit.code + ')';
    }
    const file = conversionFolder_().createFile(Utilities.newBlob(bytes, 'image/jpeg',
      'CONVERT_' + code + '_' + fmt_(now, 'yyyy-MM-dd_HH-mm') + '.jpg'));
    applySharing_(file, settings);
    let thumbId = '';
    const tm = /^data:image\/jpe?g;base64,(.+)$/.exec(String(req.thumb || ''));
    if (tm && tm[1].length < 400000) {
      try { thumbId = conversionFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(tm[1]), 'image/jpeg', 'T_' + file.getName())).getId(); }
      catch (e) { log_('convert.thumb', e.message); }
    }

    const sh = sheet_(TAB.CONVERSIONS);
    ensureRows_(sh, 1);
    sh.getRange(sh.getLastRow() + 1, 1, 1, CONV_HEADERS.length).setValues([[
      now, monthKey_(now), id, user.name, user.role, code, outlet.name, outlet.region, outlet.dbCode, outlet.dbName,
      outlet.route, outlet.unit, outlet.status, file.getId(), file.getUrl(), lat == null ? '' : lat, lon == null ? '' : lon,
      acc == null ? '' : Math.round(acc), fp, ['full', 'frame', 'regular', 'basic', 'off'].indexOf(req.guide) >= 0 ? req.guide : 'off',
      'Pending', '', '', warning, thumbId, ''
    ]]);
    SpreadsheetApp.flush();
    return { ok: true, status: 'pending', conversionId: id, fileId: file.getId(),
      message: 'রূপান্তর জমা হয়েছে। অ্যাডমিন যাচাই করে অনুমোদন দেবেন।' };
  } finally {
    lock.releaseLock();
  }
}

/** Pending conversions for the admin review queue, each with the outlet's latest visit photo for comparison. */
function conversionReviewItems_() {
  const pending = readConversions_().filter(c => c.status === 'Pending');
  if (!pending.length) return [];
  const imgs = readImages_(new Date(Date.now() - 120 * 864e5), IMG.fileId);
  const lastPhoto = {};
  imgs.forEach(r => { if (r.fileId) lastPhoto[r.code] = norm_(r.fileId); });
  return pending.reverse().slice(0, 40).map(c => ({
    uploadId: c.id, type: 'Conversion', code: c.code, merch: c.by,
    reason: 'Regular → Display রূপান্তর: ' + c.outletName + ' (' + c.route + ')' + (c.acc != null ? ', GPS ±' + c.acc + ' মি' : ', GPS নেই') +
      (c.warning ? '. সতর্কতা: ' + c.warning : ''),
    loggedAt: toDate_(c.ts) ? toDate_(c.ts).toISOString() : '', fileId: c.fileId,
    matchedId: '', matchedFileId: lastPhoto[c.code] || '', aiSameShop: ''
  }));
}

/** Approve or reject a conversion. Returns true if the id was a conversion. */
function decideConversion_(user, id, decision, reason) {
  const c = readConversions_().find(x => x.id === id);
  if (!c) return false;
  if (c.status === 'Pending' && (decision === 'Accept' || decision === 'Reject')) {
    const next = decision === 'Accept' ? 'Approved' : 'Rejected';
    const sh = sheet_(TAB.CONVERSIONS);
    sh.getRange(c.row, CONV['Status'], 1, 3).setValues([[next, user.name, new Date()]]);
    if (reason) sh.getRange(c.row, CONV['Decision Reason']).setValue(reason);
    logDecision_({ uploadId: id, code: c.code, merch: c.by, type: 'Conversion', oldStatus: 'Pending', newStatus: next,
      by: user.name, reason: reason || '' });
  }
  return true;
}
