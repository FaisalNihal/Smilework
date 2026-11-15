const fs = require('fs'), vm = require('vm'), path = require('path');
const { makeEnv } = require('./mock');
const dir = path.join(__dirname, '..', 'apps-script');
const code = ['Config', 'Util', 'Auth', 'Data', 'Upload', 'Conversion', 'Api', 'Gemini', 'Reports', 'Email', 'Setup']
  .map(f => fs.readFileSync(path.join(dir, f + '.gs'), 'utf8')).join('\n');

let geminiMode = 'analyze';
const geminiCalls = [];
const { env, ss, props, mails, files, folders } = makeEnv({
  fetch(url, o) {
    if (url.includes('drive.google.com/thumbnail')) return { getResponseCode: () => 404, getHeaders: () => ({}), getContent: () => [] };
    if (url.includes('/export?format=xlsx')) return { getResponseCode: () => 200, getBlob: () => ({ setName() { return this; } }) };
    if (url.includes('generativelanguage')) {
      const body = JSON.parse(o.payload);
      geminiCalls.push({ url, body });
      const isCompare = JSON.stringify(body).includes('same_shop');
      const isRegular = JSON.stringify(body).includes('REGULAR outlet');
      const ans = isCompare ? { same_shop: false, confidence: 'high', reason: 'Different walls' } : isRegular ? {
        smile_corner_visible: false, is_shop_photo: true, colgate_visible: true, shelf_talker: false,
        premium: [{ sku_id: 'P01', found: true, facings: 1, confidence: 'low' }], image_quality: 'good', comment: 'Colgate shelf.'
      } : {
        display_found: true, is_shop_photo: true, colgate_visible: true, brands: { CDC: true, CAS: true, MAX: false, TOT: true, VW: true }, shelf_talker: true,
        premium: [{ sku_id: 'P01', found: true, facings: 3, confidence: 'high' }], image_quality: 'good', comment: 'Display mostly full.'
      };
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }] }) };
    }
    throw new Error('unexpected fetch ' + url);
  }
});
const ctx = vm.createContext(env);
vm.runInContext(code + '\nthis.__api = { handle_, setup, analyzePhotos, nightlyChecks, updateReports, sendAttendanceEmail, IMG, getSettings_ };', ctx);
const A = ctx.__api;
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ok  ', msg); } else { fail++; console.log('  FAIL', msg); } };

// ---------- setup ----------
A.setup();
const sheetNames = ss.getSheets().map(s => s.name);
ok(['PJP', 'Users', 'Images', 'Review', 'SKU_Master', 'Settings', 'Daily_Summary', 'CM_Attendance', 'CheckIns', 'Log'].every(n => sheetNames.includes(n)), 'setup created tabs');
ok(props.PHOTOS_FOLDER_ID && props.REJECTED_FOLDER_ID && props.TOKEN_SECRET, 'setup created folders + secret');
const adminRow = ss.getSheetByName('Users').rows[1];
ok(adminRow[0] === 'Admin' && /^\d{4}$/.test(adminRow[1]), 'first admin user created');

// ---------- data ----------
const pjp = ss.getSheetByName('PJP');
const outlets = [
  ['Dhaka North', 'Z1', 'Mirpur', 'DB1021', 'Mirpur Traders', 'BDC1', 'Shop One', 'Gold', 'R1', 'Mirpur-10', 'Saturday', 'Rahim', 'Display', 'DCC', '', 23.80, 90.36],
  ['Dhaka North', 'Z1', 'Mirpur', 'DB1021', 'Mirpur Traders', 'BDC2', 'Shop Two', 'Silver', 'R1', 'Mirpur-10', 'Saturday', 'Rahim', 'Regular', 'DCC', '', '', ''],
  ['Dhaka North', 'Z1', 'Mirpur', 'DB1021', 'Mirpur Traders', 'BDC3', 'Shop Three', 'Bronze', 'R2', 'Pallabi', 'Sunday', 'Rahim', 'Regular', 'ROB', '', '', ''],
  ['Dhaka North', 'Z1', 'Uttara', 'DB1034', 'Uttara Dist', 'BDC9', 'Shop Nine', 'Gold', 'R9', 'Uttara-7', 'Sunday', 'Karim', 'Regular', 'SMT', '', '', ''],
  ['Dhaka South', 'Z2', 'Gulshan', 'DB2001', 'Gulshan Dist', 'SMT1', 'Super Mart One', 'Gold', 'R50', 'Gulshan-1', 'Monday', '', 'Display', 'SMT', '', '', ''],
  ['Dhaka South', 'Z2', 'Gulshan', 'DB2001', 'Gulshan Dist', 'SMT2', 'Super Mart Two', 'Gold', 'R50', 'Gulshan-1', 'Monday', '', 'Regular', 'SMT', '', '', '']
];
outlets.forEach(r => pjp.appendRow(r));
const users = ss.getSheetByName('Users');
users.appendRow(['Rahim', '0123', 'Merchandiser', '', 'TRUE']);
users.appendRow(['Karim', '4567', 'Merchandiser', '', 'TRUE']);
users.appendRow(['Sumon', '1111', 'SR', '', 'TRUE']);
ss.getSheetByName('SKU_Master').rows[6] = ['P01', 'Optic White', 'Renewal', '100g', 'Premium', 'black box', 'F000000000000000000000000000001', 'TRUE'];
ctx.CacheService.getScriptCache().remove('users');

const call = req => A.handle_(req);

// ---------- auth ----------
ok(call({ action: 'loginNames' }).names.includes('Rahim'), 'loginNames lists users');
ok(!call({ action: 'login', name: 'Rahim', pin: '9999' }).ok, 'wrong PIN refused');
const lr = call({ action: 'login', name: 'rahim', pin: '0123' });
ok(lr.ok && lr.user.role === 'Merchandiser', 'login works (case-insensitive name, PIN with leading zero)');
const T = lr.token;
ok(!call({ action: 'bootstrap', token: T + 'x' }).ok, 'tampered token refused');
const tk = call({ action: 'login', name: 'Karim', pin: '4567' }).token;
const sr = call({ action: 'login', name: 'Sumon', pin: '1111' }).token;
const ad = call({ action: 'login', name: 'Admin', pin: adminRow[1] }).token;
for (let i = 0; i < 6; i++) call({ action: 'login', name: 'Karim', pin: '0000' });
ok(call({ action: 'login', name: 'Karim', pin: '4567' }).error === 'LOCKED', 'lockout after repeated wrong PINs');

// ---------- bootstrap ----------
let b = call({ action: 'bootstrap', token: T });
ok(b.ok && b.pjp.rows.length === 3, 'merchandiser sees only own 3 outlets');
ok(call({ action: 'bootstrap', token: sr }).pjp.rows.length === 3, 'SR sees only SMT / no-merchandiser outlets');

// ---------- uploads (v2.1 rules) ----------
const crypto = require('crypto');
let seq = 0;
const jpg = tag => 'data:image/jpeg;base64,' + Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.from('jpeg-' + (tag || ++seq) + '-' + Math.random())]).toString('base64');
const up = (token, code, fp, extra) => call(Object.assign({ action: 'upload', token, clientId: crypto.randomUUID(), outletCode: code, image: jpg(), fp,
  lat: 23.80, lon: 90.36, acc: 12, capturedAt: Date.now(), guide: 'frame', frame: 'ok', appVersion: '2.1.0',
  quality: { passed: true, failed: [], vals: { brightness: 120, sharpness: 80 } } }, extra || {}));
const imgs = ss.getSheetByName('Images');
const rowOf = id => imgs.rows.find(r => r[A.IMG.uploadId - 1] === id);
const reviewOf = id => ss.getSheetByName('Review').rows.filter(r => r[1] === id);
const fileCount = () => Object.keys(files).length;

ok(up(T, 'BDC1', 'ffff0000ffff0000', { image: 'data:image/jpeg;base64,' + Buffer.from('not a jpeg').toString('base64') }).error === 'IMAGE', 'non-JPEG bytes refused');
const firstImg = jpg('first');
let r1 = up(T, 'BDC1', 'ffff0000ffff0000', { image: firstImg, thumb: jpg('thumb1') });
ok(r1.ok && r1.status === 'accepted' && r1.photoNo === 1 && r1.outletType === 'Display', 'Display outlet photo 1 accepted: ' + r1.message);
ok(rowOf(r1.uploadId)[A.IMG.valid - 1] === 'Yes' && rowOf(r1.uploadId)[A.IMG.outletType - 1] === 'Display', 'Display Valid = Yes from the camera frame check');
ok(!files[r1.fileId].sharing, 'photo is private in Drive (no public link)');
ok(rowOf(r1.uploadId)[A.IMG.thumbId - 1], 'small private thumbnail saved');
ok(rowOf(r1.uploadId)[A.IMG.aiStatus - 1] === 'Off' && rowOf(r1.uploadId)[A.IMG.premiumPresence - 1] === 'Not checked', 'AI off; premium "Not checked", never "No"');
const nFiles = fileCount();
const again = call({ action: 'upload', token: T, clientId: r1.uploadId, outletCode: 'BDC1', image: firstImg, fp: 'ffff0000ffff0000', lat: 23.8, lon: 90.36, acc: 12, capturedAt: Date.now(), guide: 'frame', frame: 'ok' });
ok(again.ok && again.message === 'আগেই জমা হয়েছে' && fileCount() === nFiles, 'same upload retried: first answer, nothing new saved to Drive');
let r2 = up(T, 'BDC2', 'ffff0000ffff0001', { guide: 'regular', frame: 'skip' });
ok(r2.ok && r2.status === 'flagged' && /BDC1/.test(r2.message), 'near-identical photo under ANOTHER outlet nearby: pending review, not rejected: ' + r2.message);
ok(rowOf(r2.uploadId)[A.IMG.valid - 1] === 'Not required' && rowOf(r2.uploadId)[A.IMG.full - 1] === 'Not required', 'Regular outlet: display "Not required"');
let r3 = up(T, 'BDC1', 'ffff0000ffff0000');
ok(r3.ok && r3.status === 'accepted' && r3.photoNo === 2 && /আগের ছবির মতো/.test(rowOf(r3.uploadId)[A.IMG.notes - 1]), 'photo 2 of an unchanged display: approved with a note');
let r5 = up(T, 'BDC1', '123456789abcdef0');
ok(!r5.ok && r5.error === 'REJECTED' && /২টি|2/.test(r5.message), '3rd photo in month rejected (company rule): ' + r5.message);
const rejFile = Object.values(files).find(f => f.name.startsWith('REJECTED_'));
ok(rejFile && rejFile.folder.id === props.REJECTED_FOLDER_ID, 'rejected photo kept in Rejected folder');
let rCopy = up(T, 'BDC3', '0123012301230123', { image: firstImg, guide: 'regular', frame: 'skip' });
ok(rCopy.ok && rCopy.status === 'flagged' && /হুবহু/.test(rCopy.message), 'exact same file under another outlet: pending review: ' + rCopy.message);
let rFar = up(T, 'BDC3', 'ffff0000ffff0003', { lat: 23.85, lon: 90.40, guide: 'regular', frame: 'skip' });
ok(rFar.ok && rFar.status === 'accepted' && /দূরে/.test(rowOf(rFar.uploadId)[A.IMG.notes - 1]), 'similar photo but 6 km away with good GPS: note only: ' + rowOf(rFar.uploadId)[A.IMG.notes - 1]);
let r6 = up(T, 'BDC2', 'aaaa5555aaaa5555', { lat: 23.81, lon: 90.40, guide: 'regular', frame: 'skip' });
ok(r6.ok && r6.status === 'accepted', 'BDC2 photo 2 accepted: ' + r6.message);
let r8 = up(T, 'BDC9', '1111222233334444', { guide: 'regular', frame: 'skip' });
ok(r8.ok && r8.status === 'flagged' && /অন্য মার্চেন্ডাইজারের/.test(r8.message), "another CM's outlet (PJP changed while offline): pending review: " + r8.message);
let rGone = up(T, 'GONE1', '7070707070707070', { outletName: 'Closed Shop', outletStatus: 'Regular', guide: 'regular', frame: 'skip' });
ok(rGone.ok && rGone.status === 'flagged' && /PJP-তে নেই/.test(rGone.message), 'outlet removed from PJP: kept, pending review');
let r9 = up(sr, 'BDC9', '9999888877776666', { lat: null, lon: null, acc: null, guide: 'regular', frame: 'skip' });
ok(r9.ok && r9.status === 'flagged' && /লোকেশন পাওয়া যায়নি/.test(r9.message), 'no GPS: "Location unknown", pending review');
let r10 = up(sr, 'BDC9', 'abcdabcdabcdabcd', { lat: 23.90, lon: 90.50, capturedAt: Date.now() - 80 * 3600e3, guide: 'regular', frame: 'skip' });
ok(r10.ok && r10.status === 'accepted' && /ঘণ্টা পর জমা/.test(rowOf(r10.uploadId)[A.IMG.notes - 1]), 'uploaded 80 h after capture (offline): note only, not review');
const prevMonth = ctx.monthKey_(new Date(Date.now() - 20 * 864e5));
let rOld = up(T, 'BDC3', 'beefbeefbeefbeef', { capturedAt: Date.now() - 20 * 864e5, lat: 23.70, lon: 90.30, guide: 'regular', frame: 'skip' });
ok(rOld.ok && rowOf(rOld.uploadId)[A.IMG.month - 1] === prevMonth, 'month comes from capture time: ' + rowOf(rOld.uploadId)[A.IMG.month - 1]);
let rOff = up(ad, 'BDC3', 'cafecafecafecafe', { guide: 'off', lat: 23.71, lon: 90.31 });
ok(rOff.ok && rOff.status === 'flagged' && /গাইড ছাড়া/.test(rOff.message), 'camera guide off: pending review');
let rDispNone = up(ad, 'BDC1', '0f0f0f0f0f0f0f0f', { frame: 'none' });
ok(rDispNone.ok && rDispNone.status === 'flagged' && /ডিসপ্লে দেখেনি/.test(rDispNone.message) && rowOf(rDispNone.uploadId)[A.IMG.valid - 1] === 'Not visible', 'Display outlet, no Smile Corner seen: pending review');
let rWarn = up(ad, 'BDC2', '3c3c3c3c3c3c3c3c', { guide: 'regular', frame: 'skip', quality: { passed: false, failed: ['light'], vals: { brightness: 30 } } });
ok(rWarn.ok && rWarn.status === 'accepted' && rowOf(rWarn.uploadId)[A.IMG.quality - 1] === 'Below limits', 'warn mode: low-quality photo approved, values saved');
let rOv = up(ad, 'BDC2', '5a5a5a5a5a5a5a5a', { guide: 'regular', frame: 'skip', overrideReason: 'দোকানে আলো নেই', quality: { passed: false, failed: ['light'], vals: { brightness: 30 } } });
ok(rOv.ok && rOv.status === 'flagged' && rowOf(rOv.uploadId)[A.IMG.override - 1] === 'দোকানে আলো নেই', 'quality override with reason: pending review');
let rSeen = up(ad, 'BDC3', '6b6b6b6b6b6b6b6b', { guide: 'regular', frame: 'skip', displaySeen: true, lat: 23.72, lon: 90.32 });
ok(rSeen.ok && rSeen.status === 'accepted' && reviewOf(rSeen.uploadId).some(r => r[2] === 'Possible conversion'), 'display seen at a Regular outlet: approved + "Possible conversion" note');
let rPrem = up(ad, 'BDC2', '7c7c7c7c7c7c7c7c', { guide: 'regular', frame: 'skip', premium: { presence: 'Needs review', model: 'test-model', items: [{ sku: 'P01', name: 'Optic White', conf: 0.5, box: [0.1, 0.2, 0.1, 0.2] }] } });
ok(rPrem.ok && rPrem.status === 'accepted' && rowOf(rPrem.uploadId)[A.IMG.premiumPresence - 1] === 'Needs review' && reviewOf(rPrem.uploadId).some(r => r[2] === 'Premium check'), 'uncertain premium: "Needs review" note, photo still approved');
let rPremY = up(ad, 'BDC1', '8d8d8d8d8d8d8d8d', { premium: { presence: 'Yes', model: 'test-model', items: [{ sku: 'P01', name: 'Optic White', conf: 0.93, facings: 3, box: [0.1, 0.2, 0.1, 0.2] }] } });
const pd = ss.getSheetByName('Premium_Detail').rows.slice(1).filter(r => r.length && r[0] !== '');
ok(rPremY.ok && rowOf(rPremY.uploadId)[A.IMG.premiumPresence - 1] === 'Yes' && pd.some(r => r[1] === rPremY.uploadId && r[5] === 'P01' && r[8] === 3), 'premium Yes: Premium_Detail row with SKU, facings, box');
let rNoCol = up(ad, 'BDC2', '9e9e9e9e9e9e9e9e', { guide: 'regular', frame: 'skip', premium: { presence: 'No', colgate: 'No', model: 'test-model', items: [] } });
ok(rNoCol.ok && rNoCol.status === 'flagged' && /কলগেট পণ্য/.test(rNoCol.message), 'Regular photo with no Colgate product: pending review');
// Outlet locations
const locSh = ss.getSheetByName('Outlet_Locations');
const locRows = () => locSh.rows.slice(1).filter(r => r.length && r[0] !== '');
ok(locRows().some(r => r[0] === 'BDC2' && r[2] === 'Proposed') && !locRows().some(r => r[0] === 'BDC1'), 'first approved GPS becomes a PROPOSED location (BDC1 has PJP GPS, so none)');
const bdc2 = locSh.rows.findIndex(r => r[0] === 'BDC2');
locSh.rows[bdc2][2] = 'Verified'; locSh.rows[bdc2][3] = 23.80; locSh.rows[bdc2][4] = 90.36;
let rFarLoc = up(ad, 'BDC2', '1f2e3d4c5b6a7980', { lat: 23.83, lon: 90.36, guide: 'regular', frame: 'skip' });
ok(rFarLoc.status === 'flagged' && /যাচাই করা আউটলেট লোকেশন/.test(rFarLoc.message), '3 km from a VERIFIED location: pending review');
let rWeak = up(ad, 'BDC2', '2f2e3d4c5b6a7981', { lat: 23.81, lon: 90.36, acc: 1500, guide: 'regular', frame: 'skip' });
ok(rWeak.ok && !/যাচাই করা আউটলেট/.test(rWeak.message || ''), 'distance within GPS accuracy is not a warning');
// Private thumbnails
const th = call({ action: 'thumbs', token: T, ids: [r1.fileId] });
ok(th.ok && /^data:image\/jpeg;base64,/.test(th.thumbs[r1.fileId]), 'CM gets the thumbnail of their own photo');
ok(!call({ action: 'thumbs', token: tk, ids: [r1.fileId] }).thumbs[r1.fileId], "another CM cannot get it");
ok(call({ action: 'thumbs', token: ad, ids: [r1.fileId] }).thumbs[r1.fileId], 'admin can');
ok(!call({ action: 'thumbs', token: ad, ids: [props.PHOTOS_FOLDER_ID] }).thumbs[props.PHOTOS_FOLDER_ID], 'unknown Drive IDs are never served');

const row2 = imgs.rows[1];
ok(row2[A.IMG.month - 1] && /^\d{4}-\d{2}$/.test(row2[A.IMG.month - 1]) && row2[A.IMG.region - 1] === 'Dhaka North', 'Images row stores month and PJP snapshot');
const reviewRows = ss.getSheetByName('Review').rows.slice(1).filter(r => r.length);
ok(reviewRows.some(r => r[2] === 'Rejected') && reviewRows.some(r => r[2] === 'Flagged'), 'Review tab has rejected + flagged entries');
ok(imgs.rows[0].length === A.IMG.notes && imgs.rows[0][A.IMG.notes - 1] === 'Notes', 'new Images columns at the end: ' + imgs.rows[0].slice(-3).join(', '));

// ---------- bootstrap counts & photos ----------
b = call({ action: 'bootstrap', token: T });
ok(b.monthCounts.BDC1 === 2 && b.todayPhotos.length >= 4, 'bootstrap month counts + today photos: ' + JSON.stringify(b.monthCounts));
const mp = call({ action: 'myPhotos', token: T });
ok(mp.ok && mp.photos.some(p => p.status === 'Rejected') && mp.photos.some(p => p.status === 'Pending review') && mp.photos.some(p => p.status === 'Approved'), 'myPhotos: Approved / Pending review / Rejected');
ok(mp.photos.find(p => p.uploadId === r2.uploadId).outletType === 'Regular', 'myPhotos carries the outlet type');
ok(call({ action: 'checkIn', token: T, lat: 23.8, lon: 90.36, acc: 10 }).ok, 'check-in works');
ok(call({ action: 'checkIn', token: T }).already, 'second check-in keeps the first');

// ---------- admin ----------
ok(!call({ action: 'adminStats', token: T }).ok, 'non-admin cannot read admin stats');
const st = call({ action: 'adminStats', token: ad });
ok(st.ok && st.today.uploads >= 5 && st.progress.find(p => p.merch === 'Rahim').done >= 2, 'admin stats: ' + JSON.stringify(st.today) + ' ' + JSON.stringify(st.progress.find(p => p.merch === 'Rahim')));
const rl = call({ action: 'reviewList', token: ad });
ok(rl.ok && rl.items.length >= 3, 'review list has items: ' + rl.items.length);
const flaggedItem = rl.items.find(i => i.type === 'Flagged' && i.uploadId === rCopy.uploadId);
ok(flaggedItem && flaggedItem.blocking, 'flagged item is marked as blocking (photo waits)');
ok(rl.items.some(i => i.type === 'Possible conversion' && !i.blocking), 'notes are listed but do not hold the photo');
ok(call({ action: 'reviewDecide', token: ad, uploadId: flaggedItem.uploadId, decision: 'Reject' }).error === 'FORM', 'a decision without a reason is refused');
ok(call({ action: 'reviewDecide', token: ad, uploadId: flaggedItem.uploadId, decision: 'Reject', reason: 'Same photo as BDC1' }).ok, 'admin rejects with a reason');
const acc1 = call({ action: 'reviewDecide', token: ad, uploadId: r2.uploadId, decision: 'Accept', reason: 'Checked: different shop' });
ok(acc1.ok && call({ action: 'myPhotos', token: T }).photos.find(p => p.uploadId === r2.uploadId).status === 'Approved', 'accepted photo becomes Approved');
const logRows = ss.getSheetByName('Review_Log').rows.slice(1).filter(r => r.length && r[0] !== '');
ok(logRows.some(r => r[1] === rCopy.uploadId && r[5] === 'Pending review' && r[6] === 'Rejected' && r[8] === 'Same photo as BDC1'), 'Review_Log keeps old status, new status, who and why');
ok(call({ action: 'reviewDecide', token: ad, uploadId: rSeen.uploadId, decision: 'Seen' }).ok, 'note closed with "Seen"');
b = call({ action: 'bootstrap', token: T });
ok(!b.monthCounts.BDC3 || b.monthCounts.BDC3 <= 3, 'rejected photo no longer counted: BDC3=' + b.monthCounts.BDC3);
ok(call({ action: 'saveSettings', token: ad, notice: 'Hello team', maintenance: false }).settings.notice === 'Hello team', 'admin saves notice');
ok(call({ action: 'bootstrap', token: T }).settings.notice === 'Hello team', 'notice reaches merchandisers');
call({ action: 'saveSettings', token: ad, maintenance: true });
ok(call({ action: 'bootstrap', token: T }).error === 'MAINTENANCE', 'maintenance blocks merchandisers');
ok(call({ action: 'bootstrap', token: ad }).ok, 'maintenance lets admins in');
call({ action: 'saveSettings', token: ad, maintenance: false });
ok(call({ action: 'newOutlet', token: sr, distCode: 'DB1021', distName: 'Mirpur Traders', outletName: 'New', ownerName: 'Ali', contactNumber: '01711111111', slab: 'Gold', routeName: 'Mirpur-10', routeCode: 'R1' }).ok, 'SR adds new outlet');
ok(!call({ action: 'newOutlet', token: sr, distCode: 'x', distName: 'x', outletName: 'x', ownerName: 'x', contactNumber: '123', slab: 'x', routeName: 'x' }).ok, 'bad phone refused');

// ---------- TM/SR common password ----------
ok(call({ action: 'teamLogin', password: 'x' }).message.includes('চালু হয়নি'), 'team login off until a password is set');
ok(!call({ action: 'saveSettings', token: ad, tmPassword: '123' }).ok, 'too-short team password refused');
ok(call({ action: 'saveSettings', token: ad, tmPassword: 'smile2026' }).settings.tm_login_on, 'admin sets team password');
ok(!('tm_password' in call({ action: 'bootstrap', token: T }).settings), 'team password never sent to phones');
ok(!call({ action: 'teamLogin', password: 'wrong' }).ok, 'wrong team password refused');
const tl = call({ action: 'teamLogin', password: 'smile2026', name: 'Hasan <b>' });
ok(tl.ok && tl.user.name === 'TM/SR: Hasan b' && tl.user.role === 'SR', 'team login works, name cleaned: ' + tl.user.name);
const tm = tl.token;
const tb = call({ action: 'bootstrap', token: tm });
ok(tb.ok && tb.pjp.rows.length === 3 && tb.pjp.rows.every(r => r[tb.pjp.cols.indexOf('unit')] === 'SMT'), 'TM sees SMT outlets only');
ok(up(tm, 'BDC1', '0000111100001111').error === 'OUTLET', 'TM cannot upload a merchandiser outlet');
const t1 = up(tm, 'SMT1', '0101010101010101', { lat: 23.79, lon: 90.41 });
const t2 = up(tm, 'SMT1', '1100110011001100', { lat: 23.79, lon: 90.41 });
ok(t1.ok && t2.ok && t2.photoNo === 2, 'TM photos 1 and 2 accepted');
ok(up(tm, 'SMT1', '0011001100110011').error === 'REJECTED', 'TM 3rd photo of the month rejected');
ok(call({ action: 'bootstrap', token: tm }).monthCounts.SMT1 === 2, 'TM month counts use TM photos');
const stats2 = call({ action: 'adminStats', token: ad });
const teamRow = stats2.progress.find(p => p.team);
ok(teamRow && teamRow.outlets === 3 && teamRow.done === 2, 'admin progress has a TM/SR row: ' + JSON.stringify(teamRow));
call({ action: 'saveSettings', token: ad, tmPassword: 'newpass99' });
ok(call({ action: 'bootstrap', token: tm }).error === 'AUTH', 'changing the team password logs TMs out');
ok(call({ action: 'teamLogin', password: 'newpass99' }).ok, 'new team password works');

// ---------- Regular -> Display conversion ----------
const conv = (token, code, fp, extra) => call(Object.assign({ action: 'convert', token, clientId: require('crypto').randomUUID(), outletCode: code, image: jpg(), fp,
  lat: 23.80, lon: 90.36, acc: 15, capturedAt: Date.now(), guide: 'basic' }, extra || {}));
ok(conv(T, 'BDC1', 'abababababababab').message.includes('Display'), 'Display outlet cannot be converted');
ok(conv(T, 'SMT1', 'abababababababab').error === 'OUTLET', 'merchandiser cannot convert an outlet outside their PJP');
const c1 = conv(T, 'BDC2', '7777777777777777');
ok(c1.ok && c1.status === 'pending', 'merchandiser submits conversion for a Regular outlet');
ok(conv(T, 'BDC2', '1212121212121212').error === 'REJECTED', 'second conversion for same outlet refused while pending');
const cReuse = conv(T, 'BDC3', '7777777777777777', { image: jpg('conv-reuse') });
ok(cReuse.ok && cReuse.status === 'pending' && ss.getSheetByName('Conversions').rows.some(r => r[2] === cReuse.conversionId && /হুবহু/.test(r[23])), 'reused picture for a conversion: pending with a warning for the admin');
ok(call({ action: 'bootstrap', token: T }).conversions.BDC2 === 'Pending', 'bootstrap shows the pending conversion');
ok(!call({ action: 'convert', token: ad, outletCode: 'BDC3', clientId: require('crypto').randomUUID() }).ok, 'admins do not submit conversions');
const rlAll = call({ action: 'reviewList', token: ad });
if (!rlAll.ok) console.log('reviewList error', rlAll);
const rlc = (rlAll.items || []).find(i => i.type === 'Conversion' && i.code === 'BDC2');
ok(rlc && rlc.code === 'BDC2' && rlc.fileId && rlc.matchedFileId, 'conversion in admin review with last visit photo for comparison');
ok(call({ action: 'reviewDecide', token: ad, uploadId: rlc.uploadId, decision: 'Accept', reason: 'New display installed' }).ok, 'admin approves conversion');
ok(call({ action: 'bootstrap', token: T }).conversions.BDC2 === 'Approved', 'outlet now shows Approved');
const afterConv = up(ad, 'BDC2', '4242424242424242', { lat: 23.80, lon: 90.36 });
ok(afterConv.ok && afterConv.outletType === 'Display', 'approved conversion: outlet treated as Display before PJP is edited');
const cs = call({ action: 'adminStats', token: ad });
ok(cs.conversions.approved === 1 && cs.progress.find(p => p.merch === 'Rahim').conversions === 2, 'admin stats count conversions: ' + JSON.stringify(cs.conversions));
const tmc = call({ action: 'teamLogin', password: 'newpass99' }).token;
ok(conv(tmc, 'SMT2', '3333333333333333').ok, 'TM converts an SMT outlet');
const convRows = ss.getSheetByName('Conversions').rows.slice(1).filter(r => r.length && r[0] !== '');
ok(convRows.length === 3 && convRows[0][20] === 'Approved' && convRows[2][20] === 'Pending', 'Conversions tab has the rows with status');

// ---------- AI analysis (off by default) ----------
props.GEMINI_API_KEY = 'test-key';
A.analyzePhotos.call(null);
ok(geminiCalls.length === 0, 'ai_provider Off: no photo is sent to Gemini');
ctx.setSetting_('ai_provider', 'Gemini'); ctx.CacheService.getScriptCache().remove('settings');
imgs.rows.slice(1).forEach(r => { if (r.length && r[A.IMG.aiStatus - 1] === 'Off') r[A.IMG.aiStatus - 1] = 'Pending'; });
ctx.setSetting_('ai_batch_size', 100); ctx.setSetting_('ai_work_hours', '0-24'); ctx.CacheService.getScriptCache().remove('settings');
A.analyzePhotos.call(null);
const analysed = imgs.rows.slice(1).filter(r => r.length && r[A.IMG.aiStatus - 1] === 'Done');
ok(analysed.length >= 5, 'with Gemini switched on, pending rows analysed: ' + analysed.length);
const dRow = analysed.find(r => r[A.IMG.outletType - 1] === 'Display');
const gRow = analysed.find(r => r[A.IMG.outletType - 1] === 'Regular');
ok(dRow[A.IMG.CDC - 1] === 'Yes' && dRow[A.IMG.MAX - 1] === 'No' && dRow[A.IMG.full - 1] === 'No' && dRow[A.IMG.premiumPresence - 1] === 'Yes', 'Display photo: brands, full display, premium Yes');
ok(gRow[A.IMG.valid - 1] === 'Not required' && gRow[A.IMG.CDC - 1] === 'Not required' && gRow[A.IMG.premiumPresence - 1] === 'Needs review', 'Regular photo: no display needed; low-confidence premium = Needs review, not No');
const regCall = geminiCalls.find(c => JSON.stringify(c.body).includes('REGULAR outlet'));
const dispCall = geminiCalls.find(c => JSON.stringify(c.body).includes('DISPLAY outlet'));
ok(regCall && !JSON.stringify(regCall.body).includes('Example of a correct display') && dispCall, 'Regular prompt has no display question or display reference photos');
ok(ss.getSheetByName('Review').rows.some(r => r[2] === 'Premium check'), 'uncertain premium goes to Review as a note');

const bp = call({ action: 'bootstrap', token: T });
ok(bp.premium && Object.values(bp.premium).includes('Yes'), 'bootstrap marks outlets with premium found: ' + JSON.stringify(bp.premium));

// ---------- nightly same-shop ----------
A.nightlyChecks();
const second = imgs.rows.slice(1).find(r => r[A.IMG.photoNo - 1] === 2 && r[A.IMG.sameShop - 1]);
ok(second && /Different shop/.test(second[A.IMG.sameShop - 1]) && second[A.IMG.dupStatus - 1] === 'Flagged', 'photo 2 that looks like a different shop gets flagged');

// ---------- reports ----------
A.updateReports();
const sum = ss.getSheetByName('Daily_Summary').rows.slice(1).filter(r => r.length && r[0] !== '');
const rahim = sum.find(r => r[1] === 'Rahim');
ok(rahim && rahim[8] >= 2 && rahim[5] >= 2, 'Daily_Summary row for Rahim: visited ' + (rahim && rahim[8]) + ', planned ' + (rahim && rahim[5]));
ok(!sum.find(r => r[1] === 'Sumon' || /^TM\/SR/.test(r[1])), 'SR/TM uploads not in merchandiser summary');
const isD = v => Object.prototype.toString.call(v) === '[object Date]';
ok(rahim[17] === 2, 'Daily_Summary (unchanged rules) counts non-rejected conversions: ' + rahim[17]);
ok(isD(rahim[0]) && isD(rahim[12]) && typeof rahim[14] === 'number', 'summary uses real dates and numeric hours');
const att = ss.getSheetByName('CM_Attendance').rows.slice(1).filter(r => r.length && r[0] !== '');
const todayRows = att.filter(r => ctx.dayKey_(r[1]) === ctx.dayKey_(new Date()));
ok(todayRows.find(r => r[4] === 'Rahim')[5] === 'Present', 'Rahim present today');
const kt = todayRows.find(r => r[4] === 'Karim')[5];
ok(['Not yet', 'Weekend', 'Holiday'].includes(kt), 'Karim (no photos) today: ' + kt);
ok(att.filter(r => r[4] === 'Karim').some(r => ['Absent', 'Weekend'].includes(r[5])), 'past days marked Absent/Weekend');
A.updateReports();
ok(ss.getSheetByName('Daily_Summary').rows.slice(1).filter(r => r.length && r[0] !== '').length === sum.length, 'running reports twice does not duplicate rows');

const os = ss.getSheetByName('Outlet_Status').rows.slice(1).filter(r => r.length && r[0] !== '');
const osRow = os.find(r => r[1] === 'BDC1');
ok(os.length === 6 && osRow && osRow[7] >= 1 && osRow[11] === 'Yes' && /Optic White/.test(osRow[12]), 'Outlet_Status: one row per outlet with premium: ' + JSON.stringify(osRow && osRow.slice(1, 14)));
ok(os.find(r => r[1] === 'BDC2')[13] === 'Approved', 'Outlet_Status shows the conversion status');
ok(os.find(r => r[1] === 'BDC3')[9] === 'Not required', 'Outlet_Status: Regular outlet display = "Not required"');

// ---------- backup and privacy tools ----------
ctx.weeklyBackup();
ok(folders[props.BACKUP_FOLDER_ID].files.length === 1, 'weekly backup copies the Sheet');
files[r1.fileId].sharing = 'ANYONE_WITH_LINK';
ctx.makePhotosPrivate();
ok(files[r1.fileId].sharing === 'PRIVATE', 'makePhotosPrivate removes old public links');
ok(ss.getSheetByName('Images').getProtections().length === 1, 'data tabs protected');

// ---------- email ----------
ctx.setSetting_('email_to', 'a@x.com,b@x.com');
A.sendAttendanceEmail();
ok(mails.length === 1 && /Daily Attendance/.test(mails[0].subject) && mails[0].attachments.length === 1, 'email sent with attachment');

// ---------- api wrapper ----------
const out = ctx.doPost({ postData: { contents: JSON.stringify({ action: 'ping' }) } });
ok(JSON.parse(out.text).ok, 'doPost returns JSON');
ok(!JSON.parse(ctx.doPost({ postData: { contents: 'not json' } }).text).ok, 'bad JSON handled');
const logs = ss.getSheetByName('Log').rows.slice(1).filter(r => r.length);
console.log('\nLog tab entries:', logs.map(r => r[1] + ': ' + String(r[2]).slice(0, 100)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
