/**
 * Daily_Summary and CM_Attendance.
 * Built from the Images rows (who actually submitted, recorded at upload time).
 * Each hourly run recalculates only the last `report_days` days; older rows stay as they are.
 *
 * Planned outlets:
 *  - Date-wise PJP (Visit Day holds dates): the outlets in the PJP with the merchandiser's name and that date.
 *    Every planned day gets a row, even with 0 photos. Days of a month that is no longer in the PJP
 *    (last month, after next month's PJP was pasted in) are never recalculated, so their plan is kept.
 *  - Weekday PJP (old format): all outlets of the routes the merchandiser took photos in that day.
 * Planned Visited = how many of that day's planned outlets got a photo that day.
 * Visited Outlets also counts off-plan (catch-up) outlets.
 */

function updateReports() {
  if (!acquireRunFlag_('REPORT_RUN')) return;
  try {
    buildReports_(getSettings_(true).report_days || 7);
    buildOutletStatus_();
  } finally {
    releaseRunFlag_('REPORT_RUN');
  }
}

/** Menu helper: recalculate everything from the last 400 days. */
function rebuildAllReports() {
  buildReports_(400);
  buildOutletStatus_();
}

function buildReports_(days) {
  const s = getSettings_();
  const now = new Date();
  const todayKey = dayKey_(now);
  let startKey = dayKey_(new Date(now.getTime() - (days - 1) * 864e5));
  const pjp = pjpRows_();

  // Date-wise PJP: planned outlets per date + merchandiser.
  const dayPlan = {}, datedMerch = {}, planMonths = {};
  pjp.forEach(o => {
    if (!o.merch || !isDateKey_(o.visitDay)) return;
    const mk = o.merch.toLowerCase();
    datedMerch[mk] = true;
    planMonths[o.visitDay.slice(0, 7)] = true;
    const k = o.visitDay + '|' + mk;
    const p = dayPlan[k] = dayPlan[k] || { day: o.visitDay, merch: o.merch, region: o.region, dbCode: o.dbCode, total: 0, display: 0, regular: 0, codes: {} };
    if (p.codes[o.code]) return;
    p.codes[o.code] = true;
    p.total++;
    if (isDisplayStatus_(o.status)) p.display++; else p.regular++;
  });
  // Keep earlier months as they are once their PJP has been replaced (this month is always recalculated).
  if (Object.keys(planMonths).length) {
    const thisMonth = todayKey.slice(0, 7);
    while (startKey.slice(0, 7) < thisMonth && !planMonths[startKey.slice(0, 7)]) startKey = firstOfNextMonth_(startKey);
  }

  const rows = readImages_(dateFromKey_(startKey), IMG.status);
  const rejected = rejectedIds_();

  // Weekday PJP: planned outlets per merchandiser + route. And each merchandiser's home region/DB.
  const plan = {}, home = {};
  pjp.forEach(o => {
    if (!o.merch) return;
    const mk = o.merch.toLowerCase();
    if (!home[mk]) home[mk] = { region: o.region, dbCode: o.dbCode };
    const k = mk + '|' + o.route;
    const p = plan[k] = plan[k] || { total: 0, display: 0, regular: 0, codes: {} };
    if (p.codes[o.code]) return;
    p.codes[o.code] = true;
    p.total++;
    if (isDisplayStatus_(o.status)) p.display++; else p.regular++;
  });

  const checkins = {};
  rows_(TAB.CHECKINS, CHECKIN_HEADERS.length).forEach(r => {
    const dk = cellDayKey_(r[0]), t = toDate_(r[2]);
    if (!dk || !t || dk < startKey) return;
    const k = dk + '|' + norm_(r[1]).toLowerCase();
    if (!checkins[k] || t < checkins[k]) checkins[k] = t;
  });

  // Group counted merchandiser photos by day + person.
  const groups = {};
  rows.forEach(r => {
    if (r.role !== 'Merchandiser' || !isCounted_(r, rejected)) return;
    const t = toDate_(r.ts);
    if (!t) return;
    const dk = dayKey_(t);
    if (dk < startKey) return;
    const key = dk + '|' + norm_(r.merch).toLowerCase();
    const g = groups[key] = groups[key] || {
      day: dk, merch: norm_(r.merch), regions: new Set(), dbs: new Set(), routes: new Set(), codes: new Set(),
      disp: new Set(), reg: new Set(), first: t, last: t, flagged: 0, premium: 0
    };
    if (r.region) g.regions.add(norm_(r.region));
    if (r.dbCode) g.dbs.add(norm_(r.dbCode));
    if (r.route) g.routes.add(norm_(r.route));
    g.codes.add(r.code);
    (isDisplayStatus_(r.status) ? g.disp : g.reg).add(r.code);
    if (t < g.first) g.first = t;
    if (t > g.last) g.last = t;
    if (norm_(r.dupStatus) === 'Flagged') g.flagged++;
    if (norm_(r.premium)) g.premium++;
  });

  const convCount = {};
  readConversions_().forEach(c => {
    const t = toDate_(c.ts);
    if (!t || c.role !== 'Merchandiser' || c.status === 'Rejected') return;
    const k = dayKey_(t) + '|' + c.by.toLowerCase();
    convCount[k] = (convCount[k] || 0) + 1;
  });

  // ---- Daily_Summary ----
  const summary = Object.keys(groups).map(key => {
    const g = groups[key];
    const mk = g.merch.toLowerCase();
    let pt = 0, pd = 0, pr = 0, pv = 0;
    if (datedMerch[mk]) {
      const p = dayPlan[key];
      if (p) { pt = p.total; pd = p.display; pr = p.regular; g.codes.forEach(c => { if (p.codes[c]) pv++; }); }
    } else {
      const seen = {};
      g.routes.forEach(route => {
        const p = plan[mk + '|' + route];
        if (!p) return;
        pt += p.total; pd += p.display; pr += p.regular;
        g.codes.forEach(c => { if (p.codes[c] && !seen[c]) { seen[c] = true; pv++; } });
      });
    }
    const ci = checkins[key] || '';
    const startT = ci && ci < g.first ? ci : g.first;
    const hours = Math.round((g.last - startT) / 36e5 * 100) / 100;
    return [dateFromKey_(g.day), g.merch, Array.from(g.regions).join(', '), Array.from(g.dbs).join(', '),
      g.routes.size, pt, pd, pr, g.codes.size, g.disp.size, g.reg.size, ci, g.first, g.last, hours, g.flagged, g.premium,
      convCount[key] || 0, pv];
  });
  // Planned days with no counted photo still get a row: planned N, visited 0.
  Object.keys(dayPlan).forEach(key => {
    const p = dayPlan[key];
    if (groups[key] || p.day < startKey || p.day > todayKey) return;
    summary.push([dateFromKey_(p.day), p.merch, p.region, p.dbCode, 0, p.total, p.display, p.regular, 0, 0, 0,
      checkins[key] || '', '', '', 0, 0, 0, convCount[key] || 0, 0]);
  });
  writeWindow_(TAB.SUMMARY, SUMMARY_HEADERS, summary, startKey, 0, 1, {
    1: 'yyyy-mm-dd', 12: 'h:mm AM/PM', 13: 'h:mm AM/PM', 14: 'h:mm AM/PM', 15: '0.00'
  });

  // ---- CM_Attendance ----
  const holidays = {};
  rows_(TAB.HOLIDAYS, HOLIDAY_HEADERS.length).forEach(r => {
    const k = cellDayKey_(r[0]);
    if (k) holidays[k] = norm_(r[1]) || 'Holiday';
  });
  const merchs = users_(true).filter(u => u.role === 'Merchandiser');
  const attendance = [];
  for (let k = startKey; k <= todayKey; k = nextDay_(k)) {
    const date = dateFromKey_(k);
    const weekday = fmt_(date, 'EEEE');
    merchs.forEach(u => {
      const key = k + '|' + u.name.toLowerCase();
      const g = groups[key];
      if (!g && (!u.active || (u.joinDate && k < u.joinDate))) return;
      let status;
      if (g) status = 'Present';
      else if (holidays[k]) status = 'Holiday';
      else if (sameName_(weekday, s.weekend_day)) status = 'Weekend';
      else if (k === todayKey) status = 'Not yet';
      else status = 'Absent';
      const h = home[u.name.toLowerCase()] || { region: '', dbCode: '' };
      const sRow = summary.find(r => dayKey_(r[0]) === k && sameName_(r[1], u.name));
      attendance.push([dateFromKey_(k.slice(0, 7) + '-01'), date,
        g ? Array.from(g.regions).join(', ') : h.region, g ? Array.from(g.dbs).join(', ') : h.dbCode,
        u.name, status, sRow ? sRow[5] : 0, sRow ? sRow[8] : 0, sRow ? sRow[14] : 0]);
    });
  }
  writeWindow_(TAB.ATTENDANCE, ATTENDANCE_HEADERS, attendance, startKey, 1, 4, {
    1: 'mmmm yyyy', 2: 'yyyy-mm-dd', 9: '0.00'
  });
}

/**
 * One row per outlet for the current month: photos, display check (Display outlets only) and premium SKU presence.
 * Regular outlets show "Not required" for the display columns: they never need a Smile Corner display.
 */
function buildOutletStatus_() {
  const now = new Date(), month = monthKey_(now);
  const rows = readImages_(dateFromKey_(month + '-01'));
  const rejected = rejectedIds_();
  const conv = conversionStatusMap_(null);
  const rank = { 'Yes': 3, 'Needs review': 2, 'No': 1 };
  const by = {};
  rows.forEach(r => {
    if (r.month !== month || !isCounted_(r, rejected)) return;
    const o = by[r.code] = by[r.code] || { n: 0, last: null, lastRow: null, presence: '', premiumSkus: {} };
    o.n++;
    const t = toDate_(r.captureTs) || toDate_(r.ts);
    if (t && (!o.last || t > o.last)) { o.last = t; o.lastRow = r; }
    let p = norm_(r.premiumPresence);
    if (!p && norm_(r.aiStatus) === 'Done') p = norm_(r.premium) ? 'Yes' : 'No';
    if (rank[p] && (!o.presence || rank[p] > rank[o.presence])) o.presence = p;
    if (norm_(r.premium)) norm_(r.premium).split(',').forEach(x => { if (x.trim()) o.premiumSkus[x.trim()] = true; });
  });
  const seen = {};
  const out = [];
  pjpRows_().forEach(p => {
    if (seen[p.code]) return;
    seen[p.code] = true;
    const o = by[p.code];
    const isDisplay = isDisplayStatus_(p.status) || conv[p.code] === 'Approved';
    const a = o && o.lastRow;
    out.push([month, p.code, p.name, p.merch || 'TM/SR', p.unit, p.route, p.status + (conv[p.code] === 'Approved' && !isDisplayStatus_(p.status) ? ' (conversion approved)' : ''),
      o ? o.n : 0, o && o.last ? o.last : '',
      !isDisplay ? 'Not required' : a ? norm_(a.valid) : '',
      !isDisplay ? 'Not required' : a ? norm_(a.full) : '',
      o ? (o.presence || 'Not checked') : '',
      o ? Object.keys(o.premiumSkus).join(', ') : '', conv[p.code] || '']);
  });
  const sh = sheet_(TAB.OUTLET_STATUS);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, OUTLET_STATUS_HEADERS.length).clearContent();
  if (!out.length) return;
  if (sh.getMaxRows() < out.length + 1) sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, out.length, OUTLET_STATUS_HEADERS.length).setValues(out);
  sh.getRange(2, 9, out.length, 1).setNumberFormat('yyyy-mm-dd h:mm AM/PM');
}

function nextDay_(key) {
  const d = dateFromKey_(key);
  return dayKey_(new Date(d.getTime() + 36 * 36e5)); // +36h then back to the date: safe across any clock change
}

/**
 * Replace the rows on or after startKey (date in column dateIdx) with newRows,
 * keep older rows, sort by date then by column sortIdx, and apply number formats.
 */
function writeWindow_(tab, headers, newRows, startKey, dateIdx, sortIdx, formats) {
  const sh = sheet_(tab);
  const width = headers.length;
  // A column added in a newer version (e.g. Planned Visited) gets its heading even if Setup was not run again.
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  const head = sh.getRange(1, 1, 1, width).getValues()[0].map(norm_);
  const firstEmpty = head.indexOf('');
  if (firstEmpty >= 0 && head.slice(firstEmpty).every(h => !h) && head.slice(0, firstEmpty).every((h, i) => h === headers[i])) {
    sh.getRange(1, firstEmpty + 1, 1, width - firstEmpty).setValues([headers.slice(firstEmpty)]).setFontWeight('bold').setBackground('#f3f3f3');
  }
  const old = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, width).getValues() : [];
  const keep = old.filter(r => {
    const k = cellDayKey_(r[dateIdx]);
    return k && k < startKey;
  });
  const all = keep.concat(newRows);
  all.sort((a, b) => {
    const ka = cellDayKey_(a[dateIdx]), kb = cellDayKey_(b[dateIdx]);
    if (ka !== kb) return ka < kb ? -1 : 1;
    return String(a[sortIdx]).localeCompare(String(b[sortIdx]));
  });
  if (old.length) sh.getRange(2, 1, old.length, width).clearContent();
  if (!all.length) return;
  if (sh.getMaxRows() < all.length + 1) sh.insertRowsAfter(sh.getMaxRows(), all.length + 1 - sh.getMaxRows());
  sh.getRange(2, 1, all.length, width).setValues(all);
  Object.keys(formats || {}).forEach(col => {
    sh.getRange(2, Number(col), all.length, 1).setNumberFormat(formats[col]);
  });
}
