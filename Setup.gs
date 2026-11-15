/**
 * One-time setup and the "Smile Corner" menu in the Sheet.
 * Run setup() once (menu: Smile Corner > Setup). It is safe to run again: it only adds what is missing.
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Smile Corner')
    .addItem('1. Setup (run first, safe to repeat)', 'setup')
    .addItem('2. Test Gemini key', 'testGemini')
    .addSeparator()
    .addItem('Update reports now', 'updateReports')
    .addItem('Rebuild all reports (slow)', 'rebuildAllReports')
    .addItem('Analyse new photos now', 'analyzePhotos')
    .addItem('Retry failed AI analysis', 'retryFailedAnalysis')
    .addItem('Run same-shop checks now', 'nightlyChecks')
    .addItem('Send attendance email now', 'sendTestEmail')
    .addSeparator()
    .addItem('Make all photos private', 'makePhotosPrivate')
    .addItem('Back up this Sheet now', 'backupNow')
    .addItem('Protect data tabs', 'protectTabs')
    .addToUi();
}

function alert_(msg) {
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { console.log(msg); }
}

function setup() {
  const ss = ss_();
  ss.setSpreadsheetTimeZone(TZ);
  const notes = [];

  // Tabs, headers and text formats (text stops Sheets turning codes and "2026-11" into numbers or dates).
  const tabs = [
    [TAB.PJP, PJP_HEADERS, [4, 6, 9]],
    [TAB.USERS, USERS_HEADERS, [2]],
    [TAB.IMAGES, IMG_COLS.map(c => c[1]), [IMG.uploadId, IMG.month, IMG.code, IMG.dbCode, IMG.fp, IMG.fileId]],
    [TAB.REVIEW, REVIEW_HEADERS, [2, 4, 7]],
    [TAB.SKU, SKU_HEADERS, [1, 7]],
    [TAB.SETTINGS, ['Key', 'Value', 'What it does'], [1, 2]],
    [TAB.HOLIDAYS, HOLIDAY_HEADERS, []],
    [TAB.CHECKINS, CHECKIN_HEADERS, []],
    [TAB.SUMMARY, SUMMARY_HEADERS, [4]],
    [TAB.ATTENDANCE, ATTENDANCE_HEADERS, []],
    [TAB.NEW_OUTLET, NEW_OUTLET_HEADERS, [2, 4, 7, 9]],
    [TAB.CONVERSIONS, CONV_HEADERS, [2, 3, 6, 9, 14, 19]],
    [TAB.OUTLET_STATUS, OUTLET_STATUS_HEADERS, [2]],
    [TAB.REVIEW_LOG, REVIEW_LOG_HEADERS, [2, 3]],
    [TAB.LOCATIONS, LOC_HEADERS, [1, 10]],
    [TAB.PREMIUM_DETAIL, PREMIUM_DETAIL_HEADERS, [2, 3, 6]],
    [TAB.LOG, LOG_HEADERS, []]
  ];

  // An Images tab in the old layout is kept as Images_old, and a new one is created.
  const oldImages = ss.getSheetByName(TAB.IMAGES);
  if (oldImages && oldImages.getLastRow() > 0 && norm_(oldImages.getRange(1, 2).getValue()) !== 'Upload ID') {
    oldImages.setName('Images_old_' + fmt_(new Date(), 'yyyyMMdd'));
    notes.push('Your old Images tab was renamed to ' + oldImages.getName() + ' (kept as an archive).');
  }

  tabs.forEach(t => {
    let sh = ss.getSheetByName(t[0]);
    if (!sh) { sh = ss.insertSheet(t[0]); notes.push('Created tab ' + t[0]); }
    if (sh.getMaxColumns() < t[1].length) sh.insertColumnsAfter(sh.getMaxColumns(), t[1].length - sh.getMaxColumns());
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, t[1].length).setValues([t[1]]).setFontWeight('bold').setBackground('#f3f3f3');
      sh.setFrozenRows(1);
    } else {
      // Upgrade: new columns are always added at the end, so existing data never moves.
      const have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(norm_);
      let n = have.length;
      while (n > 0 && !have[n - 1]) n--;
      if (n < t[1].length && have.slice(0, n).every((h, i) => h === t[1][i])) {
        sh.getRange(1, n + 1, 1, t[1].length - n).setValues([t[1].slice(n)]).setFontWeight('bold').setBackground('#f3f3f3');
        notes.push('Added new columns to ' + t[0] + ': ' + t[1].slice(n).join(', '));
      }
    }
    t[2].forEach(col => sh.getRange(2, col, sh.getMaxRows() - 1, 1).setNumberFormat('@'));
  });

  // Settings: add any missing keys with their default values.
  const set = sheet_(TAB.SETTINGS);
  const have = set.getLastRow() > 1 ? set.getRange(2, 1, set.getLastRow() - 1, 1).getValues().map(r => norm_(r[0])) : [];
  const missing = SETTINGS_DEFAULTS.filter(d => have.indexOf(d[0]) < 0);
  if (missing.length) set.getRange(set.getLastRow() + 1, 1, missing.length, 3).setValues(missing);
  CacheService.getScriptCache().remove('settings');

  // SKU_Master: the five display lines to fill in, and one example premium row (inactive).
  const sku = sheet_(TAB.SKU);
  if (sku.getLastRow() < 2) {
    const rows = DISPLAY_BRANDS.map(id => [id, 'FILL IN: full product name for ' + id, '', '', 'Display', 'FILL IN: what the pack looks like', '', 'TRUE']);
    rows.push(['REF1', 'Correct Smile Corner display', '', '', 'Display reference',
      'Full display: Colgate header on top, packs of all five lines on the shelves, front of packs facing out',
      'paste Drive links of 1-3 photos of a correct display', 'TRUE']);
    rows.push(['P01', 'FILL IN: premium SKU name', 'variant', 'pack size', 'Premium', 'FILL IN: e.g. black box, silver text',
      'paste Drive file IDs or links of pack photos', 'FALSE']);
    sku.getRange(2, 1, rows.length, SKU_HEADERS.length).setValues(rows);
  }

  // Users: create a first admin if the tab is empty.
  const users = sheet_(TAB.USERS);
  if (users.getLastRow() < 2) {
    const pin = String(Math.floor(1000 + Math.random() * 9000));
    users.getRange(2, 1, 1, USERS_HEADERS.length).setValues([['Admin', pin, 'Admin', dateFromKey_(dayKey_(new Date())), 'TRUE']]);
    notes.push('First login: name "Admin", PIN ' + pin + ' (change it in the Users tab).');
  }
  CacheService.getScriptCache().remove('users');

  // Drive folders, owned by this account.
  if (!prop_('PHOTOS_FOLDER_ID')) {
    const root = DriveApp.createFolder('Smile Corner');
    const sub = name => root.createFolder(name).getId();
    setProp_('ROOT_FOLDER_ID', root.getId());
    setProp_('PHOTOS_FOLDER_ID', sub('Photos'));
    setProp_('REJECTED_FOLDER_ID', sub('Rejected'));
    setProp_('SKU_FOLDER_ID', sub('SKU References'));
    setProp_('TRAINING_FOLDER_ID', sub('Training'));
    setProp_('ARCHIVE_FOLDER_ID', sub('Archive'));
    setProp_('CONV_FOLDER_ID', sub('Conversions'));
    notes.push('Created the "Smile Corner" folder in Google Drive.');
  }

  if (!prop_('BACKUP_FOLDER_ID')) {
    const root = DriveApp.getFolderById(prop_('ROOT_FOLDER_ID'));
    setProp_('BACKUP_FOLDER_ID', root.createFolder('Backups').getId());
  }

  tokenSecret_();
  installTriggers_();
  protectTabs(true);
  notes.push('Scheduled jobs installed: reports (hourly), weekly backup (Friday 3 am), email (9 am).');
  notes.push('Photo analysis by Gemini is OFF (Settings: ai_provider = Off). No photo is sent to any outside AI.');
  notes.push('Data tabs are protected: only you (the owner) can edit Images, Review, Review_Log, Conversions, Premium_Detail and Log.');

  alert_('Setup finished.\n\n' + notes.join('\n'));
}

function installTriggers_() {
  const handlers = ['analyzePhotos', 'updateReports', 'nightlyChecks', 'sendAttendanceEmail', 'weeklyBackup'];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  // The AI jobs are installed only when Gemini is switched on (Settings: ai_provider = Gemini, then run Setup again).
  if (getSettings_(true).ai_provider === 'Gemini') {
    ScriptApp.newTrigger('analyzePhotos').timeBased().everyMinutes(15).create();
    ScriptApp.newTrigger('nightlyChecks').timeBased().atHour(2).everyDays(1).inTimezone(TZ).create();
  }
  ScriptApp.newTrigger('updateReports').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('sendAttendanceEmail').timeBased().atHour(9).everyDays(1).inTimezone(TZ).create();
  ScriptApp.newTrigger('weeklyBackup').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(3).inTimezone(TZ).create();
}

/**
 * Tabs the app writes to are protected: only the owner (and the script) can edit them, so a sort
 * or an inserted column cannot silently break the reports. Other people can still view and filter.
 */
function protectTabs(quiet) {
  const me = Session.getEffectiveUser();
  [TAB.IMAGES, TAB.REVIEW, TAB.REVIEW_LOG, TAB.CONVERSIONS, TAB.PREMIUM_DETAIL, TAB.LOG, TAB.CHECKINS].forEach(name => {
    const sh = ss_().getSheetByName(name);
    if (!sh) return;
    if (sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) return;
    const p = sh.protect().setDescription('Smile Corner: written by the app only');
    p.addEditor(me);
    p.removeEditors(p.getEditors().filter(u => u.getEmail() !== me.getEmail()));
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });
  if (quiet !== true) alert_('Data tabs protected. Only you can edit them; others can still view and filter.');
}

/** Weekly copy of the whole Sheet into Drive > Smile Corner > Backups. Keeps the newest `backup_keep` copies. */
function weeklyBackup() {
  const folder = DriveApp.getFolderById(prop_('BACKUP_FOLDER_ID'));
  DriveApp.getFileById(ss_().getId()).makeCopy('Backup ' + fmt_(new Date(), 'yyyy-MM-dd HH-mm') + ' ' + ss_().getName(), folder);
  const keep = getSettings_(true).backup_keep || 8;
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort((a, b) => b.getDateCreated() - a.getDateCreated());
  files.slice(keep).forEach(f => f.setTrashed(true));
}

function backupNow() { weeklyBackup(); alert_('Backup saved in Drive > Smile Corner > Backups.'); }

/**
 * One-time clean-up: photos saved by older versions were shared as "anyone with the link".
 * This makes every file in the Smile Corner folder private again. Runs in parts of about 5 minutes; run again until it says done.
 */
function makePhotosPrivate() {
  const start = Date.now();
  let changed = 0;
  const walk = folder => {
    const files = folder.getFiles();
    while (files.hasNext()) {
      if (Date.now() - start > 300000) return false;
      const f = files.next();
      if (f.getSharingAccess() !== DriveApp.Access.PRIVATE) { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); changed++; }
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) { if (walk(subs.next()) === false) return false; }
    return true;
  };
  const done = walk(DriveApp.getFolderById(prop_('ROOT_FOLDER_ID')));
  alert_(changed + ' files made private.' + (done ? ' All done.' : ' Not finished yet: run "Make all photos private" again.'));
}

/** Menu: checks the key and the model names in Settings with a tiny request. */
function testGemini() {
  const key = prop_('GEMINI_API_KEY');
  if (!key) { alert_('GEMINI_API_KEY is missing.\nProject Settings > Script Properties > Add property.'); return; }
  const s = getSettings_(true);
  const lines = [s.gemini_model, s.gemini_fallback_model].filter(Boolean).map(model => {
    const resp = UrlFetchApp.fetch(GEMINI_URL + norm_(model).replace(/^models\//, '') + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, muteHttpExceptions: true,
      payload: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK.' }] }] })
    });
    const code = resp.getResponseCode();
    return model + ': ' + (code === 200 ? 'works' : 'HTTP ' + code + ' ' + resp.getContentText().slice(0, 200));
  });
  alert_('Gemini test\n\n' + lines.join('\n'));
}
