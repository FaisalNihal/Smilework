// Minimal Google Apps Script mocks, enough to run the Smile Corner backend in Node.
const crypto = require('crypto');
const TZ_OFFSET_MS = 6 * 3600e3; // Asia/Dhaka, no DST

function parts(d) { const x = new Date(d.getTime() + TZ_OFFSET_MS); return { y: x.getUTCFullYear(), M: x.getUTCMonth(), d: x.getUTCDate(), H: x.getUTCHours(), m: x.getUTCMinutes(), s: x.getUTCSeconds(), w: x.getUTCDay() }; }
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const p2 = n => String(n).padStart(2, '0');
function formatDate(date, tz, pat) {
  const p = parts(date);
  return pat.replace(/yyyy|MMMM|MMM|MM|dd|HH|H|mm|EEEE|ss/g, t => ({
    yyyy: p.y, MMMM: MONTHS[p.M], MMM: MONTHS[p.M].slice(0, 3), MM: p2(p.M + 1), dd: p2(p.d), HH: p2(p.H), H: p.H, mm: p2(p.m), ss: p2(p.s), EEEE: DAYS[p.w]
  }[t]));
}
function parseDate(str, tz, pat) {
  const [y, M, d] = str.split('-').map(Number);
  return new Date(Date.UTC(y, M - 1, d) - TZ_OFFSET_MS);
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getValue() { return this.sh.get(this.r, this.c); }
  setValues(v) {
    if (v.length !== this.nr || v[0].length !== this.nc) throw new Error(`setValues size mismatch ${v.length}x${v[0].length} vs ${this.nr}x${this.nc}`);
    if (this.r + this.nr - 1 > this.sh.maxRows) throw new Error('Range out of bounds (rows)');
    v.forEach((row, i) => row.forEach((x, j) => this.sh.set(this.r + i, this.c + j, x))); return this;
  }
  setValue(x) { this.sh.set(this.r, this.c, x); return this; }
  clearContent() { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) this.sh.set(this.r + i, this.c + j, ''); return this; }
  setNumberFormat() { return this; } setFontWeight() { return this; } setBackground() { return this; }
}
class Sheet {
  constructor(name) { this.name = name; this.rows = []; this.maxRows = 1000; this.maxCols = 26; }
  get(r, c) { const row = this.rows[r - 1]; const v = row ? row[c - 1] : undefined; return v === undefined ? '' : v; }
  set(r, c, v) {
    if (r > this.maxRows) throw new Error('Row ' + r + ' beyond max rows');
    while (this.rows.length < r) this.rows.push([]);
    // emulate Sheets: Date stays Date, numbers numbers, strings strings
    this.rows[r - 1][c - 1] = v;
  }
  getLastRow() { for (let i = this.rows.length; i > 0; i--) if (this.rows[i - 1].some(v => v !== '' && v !== undefined && v !== null)) return i; return 0; }
  getLastColumn() { let m = 0; this.rows.forEach(r => { for (let j = r.length; j > 0; j--) if (r[j - 1] !== '' && r[j - 1] !== undefined) { m = Math.max(m, j); break; } }); return m; }
  getMaxRows() { return this.maxRows; } getMaxColumns() { return this.maxCols; }
  getRange(r, c, nr, nc) {
    if (r < 1 || c < 1 || (nr !== undefined && nr < 1)) throw new Error(`Bad range ${r},${c},${nr},${nc}`);
    if (c + (nc || 1) - 1 > this.maxCols) throw new Error('Range beyond max columns');
    return new Range(this, r, c, nr, nc);
  }
  appendRow(v) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; v.forEach((x, j) => this.set(r, j + 1, x)); return this; }
  insertRowsAfter(after, n) { this.maxRows += n; } insertColumnsAfter(after, n) { this.maxCols += n; }
  deleteRows(r, n) { this.rows.splice(r - 1, n); }
  setFrozenRows() {} setName(n) { this.name = n; } getName() { return this.name; }
  getProtections() { return this.protections || []; }
  protect() { const p = { editors: [], setDescription() { return p; }, addEditor() { return p; }, removeEditors() { return p; }, getEditors: () => [], canDomainEdit: () => false, setDomainEdit() { return p; } }; this.protections = [p]; return p; }
}
class Spreadsheet {
  constructor() { this.sheets = []; this.id = 'SS1'; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; } setSpreadsheetTimeZone() {} getId() { return this.id; } getName() { return 'Smile Corner Database'; }
}

let idSeq = 0;
const files = {};
class Blob {
  constructor(bytes, type, name) { this.bytes = bytes; this.type = type; this.name = name; }
  getBytes() { return this.bytes; } getContentType() { return this.type; } getDataAsString() { return Buffer.from(this.bytes).toString('utf8'); }
  setName(n) { this.name = n; return this; }
}
class File {
  constructor(blob, folder) { this.id = 'F' + String(++idSeq).padStart(30, '0'); this.blob = blob; this.name = blob.name; this.folder = folder; this.trashed = false; files[this.id] = this; }
  getId() { return this.id; } getUrl() { return 'https://drive.google.com/file/d/' + this.id + '/view'; }
  setSharing(a) { this.sharing = a; } getSharingAccess() { return this.sharing || 'PRIVATE'; }
  setTrashed(t) { this.trashed = t; } moveTo(f) { this.folder = f; } setName(n) { this.name = n; } getName() { return this.name; }
  getBlob() { return this.blob; } getThumbnail() { return null; } getSize() { return this.blob.bytes.length; }
  getDateCreated() { return this.created || new Date(); }
  makeCopy(name, folder) { const f = new File(new Blob([1], 'application/vnd.google-apps.spreadsheet', name), folder); folder.files.push(f); return f; }
}
class Folder {
  constructor(name) { this.id = 'D' + String(++idSeq).padStart(30, '0'); this.name = name; this.children = []; this.files = []; folders[this.id] = this; }
  getId() { return this.id; } createFolder(n) { const f = new Folder(n); this.children.push(f); return f; }
  getFoldersByName(n) { const list = this.children.filter(c => c.name === n); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  getFolders() { const list = this.children; let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  getFiles() { const list = this.files.filter(f => !f.trashed); let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; }
  createFile(blob) { const f = new File(blob, this); this.files.push(f); return f; }
}
const folders = {};

function makeEnv(opts) {
  const ss = new Spreadsheet();
  const props = {};
  const cache = {};
  const mails = [];
  const triggers = [];
  const env = {
    console,
    SpreadsheetApp: {
      ProtectionType: { SHEET: 'SHEET' },
      getActiveSpreadsheet: () => ss, flush: () => {}, getUi: () => { throw new Error('no ui'); },
      create: n => { const s = new Spreadsheet(); s.id = 'TMP'; s.insertSheet('Sheet1'); return s; }
    },
    Utilities: {
      formatDate, parseDate,
      base64Decode: s => Array.from(Buffer.from(s, 'base64')).map(b => b > 127 ? b - 256 : b),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64EncodeWebSafe: b => Buffer.from(typeof b === 'string' ? Buffer.from(b) : b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (b, type, name) => new Blob(typeof b === 'string' ? Array.from(Buffer.from(b)) : b, type, name),
      computeHmacSha256Signature: (v, k) => Array.from(crypto.createHmac('sha256', k).update(v).digest()),
      computeDigest: (alg, bytes) => Array.from(crypto.createHash('sha256').update(Buffer.from(bytes.map(b => b & 255))).digest()).map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      getUuid: () => crypto.randomUUID(), sleep: () => {}
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    DriveApp: {
      createFolder: n => new Folder(n), getFolderById: id => { if (!folders[id]) throw new Error('no folder ' + id); return folders[id]; },
      getFileById: id => {
        if (id === ss.getId()) return { makeCopy: (name, folder) => folder.createFile(new Blob([1], 'application/vnd.google-apps.spreadsheet', name)) };
        if (!files[id]) throw new Error('no file ' + id); return files[id];
      },
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 1, NONE: 0 }
    },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: m => mails.push(m) },
    UrlFetchApp: { fetch: (url, o) => opts.fetch(url, o) },
    ScriptApp: {
      getOAuthToken: () => 'tok', getProjectTriggers: () => [], deleteTrigger: () => {},
      WeekDay: { FRIDAY: 'FRIDAY' },
      newTrigger: h => { const t = { timeBased: () => t, everyMinutes: () => t, everyHours: () => t, atHour: () => t, everyDays: () => t, onWeekDay: () => t, inTimezone: () => t, create: () => { triggers.push(h); return t; } }; return t; }
    },
    Logger: { log: () => {} },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) }
  };
  return { env, ss, props, cache, mails, files, triggers, folders };
}
module.exports = { makeEnv };
