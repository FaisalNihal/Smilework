/** Reading the Images and Review tabs efficiently. Rows in Images are always in time order. */

/**
 * Row number of the first Images row on or after `since`.
 * Only the timestamp column is read, so this stays fast as the sheet grows.
 * Returns null if every row is older.
 */
function firstImageRowSince_(sh, since) {
  const last = sh.getLastRow();
  if (last < 2) return null;
  const ts = sh.getRange(2, IMG.ts, last - 1, 1).getValues();
  let i = ts.length - 1;
  while (i >= 0) {
    const v = ts[i][0];
    if (v instanceof Date && v < since) break;
    i--;
  }
  const row = i + 3;
  return row > last ? null : row;
}

/** Images rows as objects (keys from IMG_COLS) plus `row` = sheet row number. */
function readImages_(since, width) {
  const sh = sheet_(TAB.IMAGES);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const start = since ? firstImageRowSince_(sh, since) : 2;
  if (!start) return [];
  const w = Math.min(width || IMG_COLS.length, IMG_COLS.length);
  const vals = sh.getRange(start, 1, last - start + 1, w).getValues();
  return vals.map((r, i) => {
    const o = { row: start + i };
    for (let c = 0; c < w; c++) o[IMG_COLS[c][0]] = r[c];
    o.code = upper_(o.code);
    o.uploadId = norm_(o.uploadId);
    if (o.month instanceof Date) o.month = monthKey_(o.month);
    else if (o.month !== undefined) o.month = norm_(o.month);
    if (o.role !== undefined) o.role = norm_(o.role);
    return o;
  });
}

/** Review tab rows as objects. */
function readReview_() {
  return rows_(TAB.REVIEW, REVIEW_HEADERS.length).map((r, i) => ({
    row: i + 2,
    loggedAt: r[0], uploadId: norm_(r[1]), type: norm_(r[2]), code: upper_(r[3]), merch: norm_(r[4]),
    reason: norm_(r[5]), matchedId: norm_(r[6]), url: norm_(r[7]), matchedUrl: norm_(r[8]),
    aiSameShop: norm_(r[9]), decision: norm_(r[10]), decidedBy: norm_(r[11]), decidedAt: r[12],
    decisionReason: norm_(r[13])
  }));
}

/** Upload IDs an admin rejected (in the Review tab or the Images Review Decision column). */
function rejectedIds_(reviewRows) {
  const set = new Set();
  (reviewRows || readReview_()).forEach(r => {
    if (/^reject/i.test(r.decision) && r.uploadId) set.add(r.uploadId);
  });
  return set;
}

/** True if an Images row counts as a real visit. */
function isCounted_(row, rejected) {
  if (rejected.has(row.uploadId)) return false;
  if (/^reject/i.test(norm_(row.reviewDecision))) return false;
  return true;
}

function addReview_(o) {
  sheet_(TAB.REVIEW).appendRow([
    new Date(), o.uploadId || '', o.type || '', o.code || '', o.merch || '', o.reason || '',
    o.matchedId || '', o.url || '', o.matchedUrl || '', o.aiSameShop || '', o.decision || '', '', '', ''
  ]);
}

/**
 * The photo's review status, the same everywhere (app, Admin screen, reports):
 *   Rejected       = an admin rejected it
 *   Pending review = it has a warning and no admin decision yet
 *   Approved       = no warning, or an admin accepted it
 */
function photoStatus_(row, rejected) {
  if (rejected && rejected.has(row.uploadId)) return 'Rejected';
  if (/^reject/i.test(norm_(row.reviewDecision))) return 'Rejected';
  if (norm_(row.dupStatus) === 'Flagged' && !/^accept/i.test(norm_(row.reviewDecision))) return 'Pending review';
  return 'Approved';
}

/** One line per review decision in Review_Log. Never overwritten, so the history stays complete. */
function logDecision_(o) {
  sheet_(TAB.REVIEW_LOG).appendRow([new Date(), o.uploadId || '', o.code || '', o.merch || '', o.type || '',
    o.oldStatus || '', o.newStatus || '', o.by || '', o.reason || '']);
}

/* ---------------- Outlet locations ---------------- */

function locationRows_() {
  return rows_(TAB.LOCATIONS, LOC_HEADERS.length).map((r, i) => ({
    row: i + 2, code: upper_(r[0]), name: norm_(r[1]), status: norm_(r[2]), lat: num_(r[3]), lon: num_(r[4]),
    acc: num_(r[5]), visits: Number(r[6]) || 0
  })).filter(r => r.code);
}

/**
 * The outlet location the distance check may trust: PJP Latitude/Longitude, or an Outlet_Locations row
 * that an authorised person set to Verified. Proposed rows are never used for warnings.
 */
function verifiedLocation_(outlet, locs) {
  if (outlet.lat != null && outlet.lon != null && !(outlet.lat === 0 && outlet.lon === 0)) {
    return { lat: outlet.lat, lon: outlet.lon, src: 'PJP' };
  }
  const v = (locs || locationRows_()).find(r => r.code === outlet.code && /^verified$/i.test(r.status) && r.lat != null && r.lon != null);
  return v ? { lat: v.lat, lon: v.lon, src: 'Verified' } : null;
}

/**
 * After an approved photo with good GPS: propose a location for an outlet that has none,
 * or refresh the suggested point (median of good visits) of a Proposed row. Verified rows are never changed.
 */
function learnLocation_(outlet, point, recent, rejected, settings, uploadId, locs) {
  const sh = sheet_(TAB.LOCATIONS);
  const row = (locs || locationRows_()).find(r => r.code === outlet.code);
  const maxAcc = settings.location_learn_max_acc_m || 50;
  const pts = recent.filter(r => r.code === outlet.code && photoStatus_(r, rejected) === 'Approved')
    .map(r => ({ lat: num_(r.lat), lon: num_(r.lon), acc: num_(r.acc) }))
    .filter(p => p.lat != null && p.lon != null && p.acc != null && p.acc <= maxAcc);
  pts.push(point);
  const sLat = median_(pts.map(p => p.lat)), sLon = median_(pts.map(p => p.lon));
  const map = 'https://maps.google.com/?q=' + sLat.toFixed(6) + ',' + sLon.toFixed(6);
  if (!row) {
    sh.appendRow([outlet.code, outlet.name, 'Proposed', point.lat, point.lon, Math.round(point.acc), 1, sLat, sLon,
      uploadId, new Date(), '', map]);
  } else if (/^proposed$/i.test(row.status)) {
    sh.getRange(row.row, 7, 1, 3).setValues([[pts.length, sLat, sLon]]);
    sh.getRange(row.row, 11).setValue(new Date());
    sh.getRange(row.row, 13).setValue(map);
  }
}

/* ---------------- Premium detail ---------------- */

function writePremiumDetail_(info, items, result, by) {
  if (!items || !items.length) return;
  const rows = items.map(it => [info.capturedAt, info.uploadId, info.code, info.outletType, info.merch,
    norm_(it.sku), norm_(it.name), it.conf == null ? '' : Math.round(Number(it.conf) * 100) / 100,
    it.facings == null ? '' : Number(it.facings) || 0,
    Array.isArray(it.box) ? it.box.map(v => Math.round(Number(v) * 1000) / 1000).join(', ') : '', result, by]);
  const sh = sheet_(TAB.PREMIUM_DETAIL);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, PREMIUM_DETAIL_HEADERS.length).setValues(rows);
}

/* ---------------- Private photos ---------------- */

/** Drive folder for the small preview images the app shows (private, like the photos). */
function thumbFolder_(month) {
  const key = 'THUMBS_' + month;
  const id = prop_(key);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  const parent = monthFolder_(month);
  const it = parent.getFoldersByName('thumbs');
  const folder = it.hasNext() ? it.next() : parent.createFolder('thumbs');
  setProp_(key, folder.getId());
  return folder;
}

/** Share setting for new photo files: private unless the Settings tab says otherwise. */
function applySharing_(file, settings) {
  if (!settings.drive_public_links) return;
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { log_('sharing', e.message); }
}

/** JPEG files start with the bytes FF D8 FF. */
function isJpeg_(bytes) {
  return bytes && bytes.length > 3 && (bytes[0] & 255) === 0xFF && (bytes[1] & 255) === 0xD8 && (bytes[2] & 255) === 0xFF;
}

function sha256Hex_(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function fileIdFromUrl_(url) {
  const m = /[-\w]{25,}/.exec(String(url || ''));
  return m ? m[0] : '';
}

function toDate_(v) {
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

/** Drive folder for a month's photos, created on first use. */
function monthFolder_(month) {
  const key = 'FOLDER_' + month;
  const id = prop_(key);
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* recreate below */ }
  }
  const parent = DriveApp.getFolderById(prop_('PHOTOS_FOLDER_ID'));
  const it = parent.getFoldersByName(month);
  const folder = it.hasNext() ? it.next() : parent.createFolder(month);
  setProp_(key, folder.getId());
  return folder;
}

function rejectedFolder_() {
  return DriveApp.getFolderById(prop_('REJECTED_FOLDER_ID'));
}

/** Make sure there are `n` empty rows at the bottom (new rows copy the text formats of the row above). */
function ensureRows_(sh, n) {
  const free = sh.getMaxRows() - sh.getLastRow();
  if (free < n) sh.insertRowsAfter(sh.getMaxRows(), Math.max(n, 500));
}

/**
 * Adds one more column (by IMG key) to rows read with readImages_ using a narrower width.
 * Reading two narrow blocks is much faster than one wide one when the Images tab is large.
 */
function attachColumn_(rows, key) {
  if (!rows.length) return rows;
  const start = rows[0].row, n = rows[rows.length - 1].row - start + 1;
  const vals = sheet_(TAB.IMAGES).getRange(start, IMG[key], n, 1).getValues();
  rows.forEach(r => { r[key] = vals[r.row - start][0]; });
  return rows;
}
