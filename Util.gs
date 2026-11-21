/** Small helpers shared by every file. */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  const sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Tab "' + name + '" not found. Run Setup from the Smile Corner menu.');
  return sh;
}

/** All data rows of a tab (no header) as arrays. */
function rows_(name, numCols) {
  const sh = sheet_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  const cols = numCols || sh.getLastColumn();
  return sh.getRange(2, 1, last - 1, cols).getValues();
}

function prop_(key) { return PropertiesService.getScriptProperties().getProperty(key); }
function setProp_(key, value) { PropertiesService.getScriptProperties().setProperty(key, value); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fmt_(date, pattern) { return Utilities.formatDate(date, TZ, pattern); }
function dayKey_(date) { return fmt_(date, 'yyyy-MM-dd'); }
const isDateKey_ = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
/** '2026-11-21' -> '2026-12-01' */
function firstOfNextMonth_(key) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y++; }
  return y + '-' + ('0' + m).slice(-2) + '-01';
}
function monthKey_(date) { return fmt_(date, 'yyyy-MM'); }
/** Midnight in Dhaka for a yyyy-MM-dd key, as a real Date. */
function dateFromKey_(key) { return Utilities.parseDate(key, TZ, 'yyyy-MM-dd'); }

/** A cell that may hold a Date or a text date -> yyyy-MM-dd, or '' if empty/invalid. */
function cellDayKey_(v) {
  if (v instanceof Date && !isNaN(v)) return dayKey_(v);
  const s = String(v || '').trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return isNaN(d) ? '' : dayKey_(d);
}

function norm_(s) { return String(s == null ? '' : s).trim(); }
function upper_(s) { return norm_(s).toUpperCase(); }
function sameName_(a, b) { return norm_(a).toLowerCase() === norm_(b).toLowerCase(); }
function num_(v) {
  if (v === '' || v == null || typeof v === 'boolean') return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
}
function isTrue_(v) { return v === true || /^(true|yes|y|1)$/i.test(norm_(v)); }

function uuid_() { return Utilities.getUuid(); }

/** Bits that differ between two hex fingerprints of equal length (Hamming distance). */
const POPCOUNT4_ = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4];
function hamming_(a, b) {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    if (isNaN(x)) return 999;
    d += POPCOUNT4_[x];
  }
  return d;
}

/** Distance in metres between two lat/lon points. */
function haversine_(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function median_(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Compare dotted versions: returns -1, 0, 1. */
function compareVersion_(a, b) {
  const pa = String(a || '0').split('.').map(Number), pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/** Settings tab as an object, cached for 5 minutes. */
function getSettings_(fresh) {
  const cache = CacheService.getScriptCache();
  if (!fresh) {
    const hit = cache.get('settings');
    if (hit) return JSON.parse(hit);
  }
  const out = {};
  SETTINGS_DEFAULTS.forEach(d => { out[d[0]] = d[1]; });
  const sh = ss_().getSheetByName(TAB.SETTINGS);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => {
      const k = norm_(r[0]);
      if (k) out[k] = r[1];
    });
  }
  out.maintenance = isTrue_(out.maintenance);
  ['max_photos_per_month', 'min_days_between', 'fp_reject_bits', 'fp_flag_bits', 'fp_lookback_days', 'gps_far_m',
    'gps_cluster_m', 'gps_cluster_min', 'gps_max_accuracy_m', 'late_upload_hours', 'report_days', 'ai_batch_size',
    'same_shop_max_per_night', 'guide_min_width', 'guide_max_width', 'guide_max_center_offset', 'guide_max_tilt',
    'guide_min_brightness', 'guide_min_sharpness', 'guide_max_glare', 'guide_frame_min_band', 'gps_wait_seconds',
    'override_after_seconds', 'phash_flag_bits', 'dup_far_apart_m', 'location_learn_max_acc_m', 'backup_keep']
    .forEach(k => { out[k] = Number(out[k]); });
  out.quality_mode = /^block$/i.test(norm_(out.quality_mode)) ? 'block' : 'warn';
  out.ai_provider = /^gemini$/i.test(norm_(out.ai_provider)) ? 'Gemini' : /^local$/i.test(norm_(out.ai_provider)) ? 'Local' : 'Off';
  out.drive_public_links = isTrue_(out.drive_public_links);
  out.notice = norm_(out.notice);
  cache.put('settings', JSON.stringify(out), 300);
  return out;
}

function setSetting_(key, value) {
  const sh = sheet_(TAB.SETTINGS);
  const keys = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map(r => norm_(r[0])) : [];
  const i = keys.indexOf(key);
  if (i >= 0) sh.getRange(i + 2, 2).setValue(value);
  else sh.appendRow([key, value, '']);
  CacheService.getScriptCache().remove('settings');
}

/** Write an error or note to the Log tab (keeps the last 1,000 lines). */
function log_(where, message) {
  try {
    const sh = ss_().getSheetByName(TAB.LOG);
    if (!sh) { console.log(where, message); return; }
    sh.appendRow([new Date(), where, String(message).slice(0, 2000)]);
    if (sh.getLastRow() > 1200) sh.deleteRows(2, 200);
  } catch (e) { console.log('log failed', e); }
}

/** PJP rows as objects, read once per execution. */
let PJP_CACHE_ = null;
function pjpRows_() {
  if (PJP_CACHE_) return PJP_CACHE_;
  const sh = sheet_(TAB.PJP);
  const last = sh.getLastRow();
  if (last < 2) return (PJP_CACHE_ = []);
  const width = Math.min(17, sh.getMaxColumns());
  const vals = sh.getRange(2, 1, last - 1, width).getValues();
  PJP_CACHE_ = vals.filter(r => norm_(r[PJP.CODE])).map(r => ({
    region: norm_(r[PJP.REGION]), zone: norm_(r[PJP.ZONE]), territory: norm_(r[PJP.TERRITORY]),
    dbCode: norm_(r[PJP.DB_CODE]), dbName: norm_(r[PJP.DB_NAME]), code: upper_(r[PJP.CODE]),
    name: norm_(r[PJP.NAME]), slab: norm_(r[PJP.SLAB]), routeCode: norm_(r[PJP.ROUTE_CODE]),
    route: norm_(r[PJP.ROUTE]), visitDay: pjpVisitDay_(r[PJP.VISIT_DAY]), merch: norm_(r[PJP.MERCH]),
    status: norm_(r[PJP.STATUS]), unit: norm_(r[PJP.UNIT]), cluster: norm_(r[PJP.CLUSTER]),
    lat: num_(r[PJP.LAT]), lon: num_(r[PJP.LON])
  }));
  return PJP_CACHE_;
}

/**
 * PJP Visit Day cell -> a date 'yyyy-MM-dd' (date-wise PJP) or the original text (weekday PJP, e.g. "Sunday").
 * Accepts a real date cell, a date-formatted number, "2026-11-01", day-first "01/11/2026" or "1-11-2026",
 * and month names ("01-Nov-2026", "1 November 2026", "Nov 1, 2026").
 */
const PJP_MONTHS_ = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
function pjpVisitDay_(v) {
  if (Object.prototype.toString.call(v) === '[object Date]') return isNaN(v.getTime()) ? '' : dayKey_(v);
  if (typeof v === 'number' && v > 20000 && v < 80000) {           // a date cell formatted as a number (Sheets serial)
    return Utilities.formatDate(new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000), 'UTC', 'yyyy-MM-dd');
  }
  const s = norm_(v);
  const key = (y, m, d) => {
    if (y < 100) y += 2000;
    const t = new Date(Date.UTC(y, m - 1, d));
    if (m < 1 || m > 12 || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return '';
    return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2);
  };
  let x = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (x) return key(+x[1], +x[2], +x[3]) || s;
  x = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (x) return key(+x[3], +x[2], +x[1]) || s;
  x = s.match(/^(\d{1,2})[\s\-]+([A-Za-z]{3,})[\s\-,]+(\d{2,4})$/);
  if (x && PJP_MONTHS_.indexOf(x[2].slice(0, 3).toLowerCase()) >= 0) return key(+x[3], PJP_MONTHS_.indexOf(x[2].slice(0, 3).toLowerCase()) + 1, +x[1]) || s;
  x = s.match(/^([A-Za-z]{3,})\s+(\d{1,2}),?\s+(\d{2,4})$/);
  if (x && PJP_MONTHS_.indexOf(x[1].slice(0, 3).toLowerCase()) >= 0) return key(+x[3], PJP_MONTHS_.indexOf(x[1].slice(0, 3).toLowerCase()) + 1, +x[2]) || s;
  return s;
}

function pjpByCode_() {
  const m = {};
  pjpRows_().forEach(o => { if (!m[o.code]) m[o.code] = o; });
  return m;
}

function isDisplayStatus_(status) { return /display/i.test(status || ''); }

/** Outlets a TM/SR works on: the units in tm_outlet_units (e.g. SMT) and outlets with no merchandiser. */
function inTeamScope_(outlet, settings) {
  const units = norm_(settings.tm_outlet_units).split(',').map(u => u.trim().toUpperCase()).filter(Boolean);
  if (!units.length) return true;
  return !outlet.merch || units.indexOf(upper_(outlet.unit)) >= 0;
}

/** Which uploads count towards an outlet's monthly limit for this user: their own role's photos. */
function countRole_(role) { return role === 'Admin' ? 'Merchandiser' : role; }
