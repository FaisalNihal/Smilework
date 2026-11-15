/**
 * AI checks with the Gemini API. SWITCHED OFF unless Settings ai_provider = Gemini (needs company approval:
 * photos are sent to Google; on the free tier Google may use them to improve its products).
 *  - analyzePhotos(): every 15 minutes, display check + premium SKU detection on new photos.
 *  - nightlyChecks(): once a night, "is this the same shop?" comparisons for photo 2 and flagged photos.
 * The API key is read from Script Properties (GEMINI_API_KEY), never from code.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models/';
const AI_TIME_BUDGET_MS = 270000;   // stop before Apps Script's 6-minute limit
const AI_PAUSE_MS = 4000;           // pause between calls to stay inside free-tier per-minute limits
const MAX_REFERENCE_IMAGES = 12;

/* ---------------- Trigger: analyse new photos ---------------- */

function analyzePhotos() {
  const s = getSettings_(true);
  if (s.ai_provider !== 'Gemini') return;
  if (!inWorkHours_(s.ai_work_hours)) return;
  const key = prop_('GEMINI_API_KEY');
  if (!key) { log_('ai', 'GEMINI_API_KEY is missing in Script Properties'); return; }
  if (!acquireRunFlag_('AI_RUN')) return;
  try {
    const sh = sheet_(TAB.IMAGES);
    const last = sh.getLastRow();
    if (last < 2) return;
    const pending = [];
    sh.getRange(2, IMG.aiStatus, last - 1, 1).getValues().forEach((r, i) => {
      if (norm_(r[0]) === 'Pending') pending.push(i + 2);
    });
    if (!pending.length) return;

    const sku = loadSkuConfig_();
    const start = Date.now();
    let done = 0;
    for (let i = 0; i < pending.length; i++) {
      if (done >= s.ai_batch_size || Date.now() - start > AI_TIME_BUDGET_MS) break;
      const row = pending[i];
      const fileId = norm_(sh.getRange(row, IMG.fileId).getValue());
      const outletType = rowOutletType_(sh, row);
      try {
        const blob = DriveApp.getFileById(fileId).getBlob();
        const res = analyzeImage_(blob, sku, s, key, outletType);
        if (res.quota) { log_('ai', 'Gemini free-tier limit reached; the rest will run later'); break; }
        if (res.error) {
          sh.getRange(row, IMG.aiStatus).setValue('Error');
          sh.getRange(row, IMG.comment).setValue(res.error.slice(0, 300));
          continue;
        }
        writeAnalysis_(sh, row, res.data, sku, outletType);
        done++;
      } catch (e) {
        sh.getRange(row, IMG.aiStatus).setValue('Error');
        sh.getRange(row, IMG.comment).setValue(String(e.message || e).slice(0, 300));
      }
      SpreadsheetApp.flush();
      Utilities.sleep(AI_PAUSE_MS);
    }
  } finally {
    releaseRunFlag_('AI_RUN');
  }
}

/** Outlet type saved with the photo (v2.1), or worked out from the PJP status saved with older photos. */
function rowOutletType_(sh, row) {
  const t = norm_(sh.getRange(row, IMG.outletType).getValue());
  if (t === 'Display' || t === 'Regular') return t;
  return isDisplayStatus_(sh.getRange(row, IMG.status).getValue()) ? 'Display' : 'Regular';
}

/** Menu helper: put rows with AI Status "Error" back in the queue. */
function retryFailedAnalysis() {
  const sh = sheet_(TAB.IMAGES);
  const last = sh.getLastRow();
  if (last < 2) return;
  const range = sh.getRange(2, IMG.aiStatus, last - 1, 1);
  const vals = range.getValues().map(r => [norm_(r[0]) === 'Error' ? 'Pending' : r[0]]);
  range.setValues(vals);
}

function inWorkHours_(spec) {
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(norm_(spec));
  if (!m) return true;
  const h = Number(fmt_(new Date(), 'H'));
  return h >= Number(m[1]) && h < Number(m[2]);
}

/** Stops two runs of the same job overlapping (a run never lasts more than 6 minutes). */
function acquireRunFlag_(name) {
  const props = PropertiesService.getScriptProperties();
  const t = Number(props.getProperty(name) || 0);
  if (t && Date.now() - t < 7 * 60000) return false;
  props.setProperty(name, String(Date.now()));
  return true;
}
function releaseRunFlag_(name) { PropertiesService.getScriptProperties().deleteProperty(name); }

/* ---------------- SKU_Master ---------------- */

/** Reads SKU_Master and loads the reference photos once per run. */
function loadSkuConfig_() {
  const rows = rows_(TAB.SKU, SKU_HEADERS.length).filter(r => norm_(r[0]) && (norm_(r[7]) === '' || isTrue_(r[7])));
  const item = r => ({
    id: norm_(r[0]), name: norm_(r[1]), variant: norm_(r[2]), size: norm_(r[3]), group: norm_(r[4]).toLowerCase(),
    desc: norm_(r[5]), refs: norm_(r[6]).split(/[,\s]+/).map(fileIdFromUrl_).filter(Boolean)
  });
  const all = rows.map(item);
  const display = DISPLAY_BRANDS.map(id => all.find(x => x.id.toUpperCase() === id && x.group === 'display') ||
    { id: id, name: '', desc: '', refs: [] });
  const displayRefs = all.filter(x => x.group.indexOf('reference') >= 0);
  const premium = all.filter(x => x.group.startsWith('premium'));
  const lookalike = all.filter(x => x.group.startsWith('look'));

  // Display references are sent only for Display outlets; SKU references for both outlet types.
  const load = (list, max) => {
    const out = [];
    list.forEach(x => x.refs.forEach(fid => {
      if (out.length >= max) return;
      const img = referenceImage_(fid);
      if (img) out.push({ sku: x, mime: img.mime, data: img.data });
    }));
    return out;
  };
  const displayRefImages = load(displayRefs, 3);
  const skuRefImages = load(premium.concat(lookalike), MAX_REFERENCE_IMAGES - displayRefImages.length);
  return { display: display, displayRefs: displayRefs, premium: premium, lookalike: lookalike,
    displayRefImages: displayRefImages, skuRefImages: skuRefImages };
}

/** A reference photo, shrunk to about 800 px through Drive's thumbnail service when possible. */
function referenceImage_(fileId) {
  try {
    const resp = UrlFetchApp.fetch('https://drive.google.com/thumbnail?sz=w800&id=' + fileId, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
    });
    const type = String(resp.getHeaders()['Content-Type'] || '');
    if (resp.getResponseCode() === 200 && type.indexOf('image/') === 0) {
      return { mime: type.split(';')[0], data: Utilities.base64Encode(resp.getContent()) };
    }
  } catch (e) { /* fall back to the original file */ }
  try {
    const blob = DriveApp.getFileById(fileId).getBlob();
    if (blob.getBytes().length > 4 * 1024 * 1024) { log_('ai.reference', 'Reference photo too large: ' + fileId); return null; }
    return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    log_('ai.reference', 'Cannot open reference photo ' + fileId + ': ' + e.message);
    return null;
  }
}

function skuLabel_(x) {
  return [x.name || x.id, x.variant, x.size].filter(Boolean).join(' ');
}

/* ---------------- Photo analysis ---------------- */

function analyzeImage_(blob, sku, s, key, outletType) {
  const isDisplay = outletType === 'Display';
  const brandLines = sku.display.map(b => '- ' + b.id + ': ' + (b.name || b.id) + (b.desc ? ' (' + b.desc + ')' : '')).join('\n');
  const premiumLines = sku.premium.map(p => '- ' + p.id + ': ' + skuLabel_(p) + (p.desc ? ' (' + p.desc + ')' : '')).join('\n');
  const lookLines = sku.lookalike.map(p => '- ' + skuLabel_(p) + (p.desc ? ' (' + p.desc + ')' : '')).join('\n');

  let prompt = 'You are checking a photo taken by a Colgate merchandiser in a retail shop in Bangladesh.\n';
  if (isDisplay) {
    prompt +=
      'This is a DISPLAY outlet: it should have a "Colgate Smile Corner", a red Colgate-branded display frame around a shelf of Colgate packs.\n\n' +
      '1. display_found: true only if a Colgate Smile Corner display is clearly visible' +
      (sku.displayRefImages.length ? ' (compare with the photos labelled "Example of a correct display")' : '') +
      '. Answer null if you cannot tell (e.g. blocked or blurry).\n';
  } else {
    prompt +=
      'This is a REGULAR outlet: it does NOT have a Smile Corner display and that is correct. Do not judge the photo by a display.\n\n' +
      '1. smile_corner_visible: true only if a red Colgate Smile Corner display frame happens to be visible anyway.\n';
  }
  prompt +=
    '2. is_shop_photo: false if this is a photo of a screen, a printed photo, or not a shop.\n' +
    '3. colgate_visible: true if at least one Colgate product pack is visible.\n' +
    (isDisplay ? '4. brands: for each product line below, true if at least one pack is visible on the display.\n' + brandLines + '\n' : '') +
    '5. shelf_talker: true if a Colgate shelf talker, wobbler or sign is visible.\n';
  if (sku.premium.length) {
    prompt +=
      '6. premium: for EACH premium SKU below, say if it is visible anywhere in the photo (on or off any display), count the facings ' +
      '(packs whose front faces the camera) and give your confidence. Reference photos follow the shop photo, each ' +
      'labelled with its SKU ID. Only say found=true when the pack design matches the reference. If unsure, say confidence low.\n' + premiumLines + '\n';
    if (lookLines) prompt += 'These are regular (NOT premium) look-alike packs. Do not count them as premium:\n' + lookLines + '\n';
  } else {
    prompt += '6. premium: return an empty list.\n';
  }
  prompt += '7. image_quality: good, blurry, dark or obstructed.\n' +
    '8. comment: one short sentence in English about what the photo shows.';

  const parts = [{ text: prompt }, { text: 'SHOP PHOTO:' },
    { inline_data: { mime_type: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } }];
  const refs = (isDisplay ? sku.displayRefImages : []).concat(sku.skuRefImages);
  refs.forEach(r => {
    const g = r.sku.group;
    const label = g.indexOf('reference') >= 0 ? 'Example of a correct display (' + (r.sku.desc || skuLabel_(r.sku)) + ')'
      : g.startsWith('premium') ? 'Reference for premium SKU ' + r.sku.id + ': ' + skuLabel_(r.sku)
      : 'Look-alike regular pack (NOT premium): ' + skuLabel_(r.sku);
    parts.push({ text: label });
    parts.push({ inline_data: { mime_type: r.mime, data: r.data } });
  });

  const brandProps = {};
  DISPLAY_BRANDS.forEach(b => { brandProps[b] = { type: 'BOOLEAN' }; });
  const premiumItem = {
    type: 'OBJECT',
    properties: {
      sku_id: sku.premium.length ? { type: 'STRING', enum: sku.premium.map(p => p.id) } : { type: 'STRING' },
      found: { type: 'BOOLEAN' },
      facings: { type: 'INTEGER' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] }
    },
    required: ['sku_id', 'found', 'facings', 'confidence']
  };
  const props = {
    is_shop_photo: { type: 'BOOLEAN' },
    colgate_visible: { type: 'BOOLEAN' },
    shelf_talker: { type: 'BOOLEAN' },
    premium: { type: 'ARRAY', items: premiumItem },
    image_quality: { type: 'STRING', enum: ['good', 'blurry', 'dark', 'obstructed'] },
    comment: { type: 'STRING' }
  };
  const required = ['is_shop_photo', 'colgate_visible', 'shelf_talker', 'premium', 'image_quality', 'comment'];
  if (isDisplay) {
    props.display_found = { type: 'BOOLEAN', nullable: true };
    props.brands = { type: 'OBJECT', properties: brandProps, required: DISPLAY_BRANDS };
    required.push('display_found', 'brands');
  } else {
    props.smile_corner_visible = { type: 'BOOLEAN' };
    required.push('smile_corner_visible');
  }
  return callGemini_(parts, { type: 'OBJECT', properties: props, required: required }, s, key);
}

/** Calls the main model, then the fallback. Returns {data} | {error} | {quota: true}. */
function callGemini_(parts, schema, s, key) {
  const models = [s.gemini_model, s.gemini_fallback_model].map(m => norm_(m).replace(/^models\//, '')).filter(Boolean);
  let lastError = 'No model set in Settings';
  for (let i = 0; i < models.length; i++) {
    const resp = UrlFetchApp.fetch(GEMINI_URL + models[i] + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      muteHttpExceptions: true,
      payload: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 }
      })
    });
    const code = resp.getResponseCode();
    const body = resp.getContentText();
    if (code === 429) return { quota: true };
    if (code !== 200) {
      lastError = models[i] + ' HTTP ' + code + ': ' + body.slice(0, 300);
      log_('ai.call', lastError);
      continue;
    }
    try {
      const json = JSON.parse(body);
      const cand = json.candidates && json.candidates[0];
      const text = cand && cand.content && cand.content.parts
        ? cand.content.parts.filter(p => p.text && !p.thought).map(p => p.text).join('') : '';
      if (!text) {
        lastError = models[i] + ': empty answer (' + (cand ? cand.finishReason : 'no candidate') + ')';
        continue;
      }
      return { data: JSON.parse(text), model: models[i] };
    } catch (e) {
      lastError = models[i] + ': could not read answer: ' + e.message;
    }
  }
  return { error: lastError };
}

/**
 * Writes the AI answer. The four checks stay separate:
 *   outlet type (from the photo row), display check (Display outlets only), premium SKUs (both types), photo quality.
 */
function writeAnalysis_(sh, row, d, sku, outletType) {
  const yn = v => (v ? 'Yes' : 'No');
  const isDisplay = outletType === 'Display';
  const brands = d.brands || {};
  const premium = Array.isArray(d.premium) ? d.premium : [];
  const byId = {};
  sku.premium.forEach(p => { byId[p.id] = p; });
  const found = premium.filter(p => p.found && byId[p.sku_id]);
  const rank = { low: 0, medium: 1, high: 2 };
  let conf = '';
  premium.forEach(p => { if (!conf || rank[p.confidence] < rank[conf]) conf = p.confidence; });

  // Premium presence: uncertain is "Needs review", never "No".
  let presence;
  if (!sku.premium.length) presence = 'Not checked';
  else if (found.some(p => p.confidence !== 'low')) presence = 'Yes';
  else if (found.length || premium.some(p => p.confidence === 'low') || d.image_quality !== 'good') presence = 'Needs review';
  else presence = 'No';

  let comment = norm_(d.comment);
  if (d.image_quality && d.image_quality !== 'good') comment = '[' + d.image_quality + '] ' + comment;
  if (!d.is_shop_photo) comment = '[not a shop photo] ' + comment;

  const displayCheck = !isDisplay ? 'Not required'
    : d.display_found === true ? 'Yes' : d.display_found === false ? 'Not visible' : 'Unclear';
  const okDisplay = displayCheck === 'Yes';
  const values = {
    valid: displayCheck,
    full: isDisplay ? yn(okDisplay && DISPLAY_BRANDS.every(b => brands[b])) : 'Not required',
    st: yn(d.shelf_talker),
    premium: found.filter(p => p.confidence !== 'low').map(p => skuLabel_(byId[p.sku_id])).join(', '),
    facings: found.map(p => p.sku_id + ': ' + (p.facings || 0)).join('; '),
    conf: conf,
    comment: comment,
    aiStatus: 'Done'
  };
  DISPLAY_BRANDS.forEach(b => { values[b] = isDisplay ? yn(okDisplay && brands[b]) : 'Not required'; });
  const first = IMG.valid, lastCol = IMG.aiStatus;
  const rowVals = [];
  for (let c = first; c <= lastCol; c++) {
    const k = IMG_COLS[c - 1][0];
    rowVals.push(values[k] !== undefined ? values[k] : sh.getRange(row, c).getValue());
  }
  sh.getRange(row, first, 1, rowVals.length).setValues([rowVals]);
  sh.getRange(row, IMG.colgate).setValue(d.colgate_visible === false ? 'No' : 'Yes');
  sh.getRange(row, IMG.premiumPresence).setValue(presence);
  sh.getRange(row, IMG.premiumBy).setValue('Gemini');

  const info = sh.getRange(row, 1, 1, IMG.url).getValues()[0];
  const ref = {
    uploadId: norm_(info[IMG.uploadId - 1]), code: upper_(info[IMG.code - 1]), merch: norm_(info[IMG.merch - 1]),
    url: norm_(info[IMG.url - 1])
  };
  writePremiumDetail_({ capturedAt: sh.getRange(row, IMG.captureTs).getValue() || info[IMG.ts - 1], uploadId: ref.uploadId,
    code: ref.code, outletType: outletType, merch: ref.merch },
    found.map(p => ({ sku: p.sku_id, name: skuLabel_(byId[p.sku_id]), conf: { high: 0.9, medium: 0.6, low: 0.3 }[p.confidence], facings: p.facings })),
    presence, 'Gemini');

  if (presence === 'Needs review') {
    addReview_(Object.assign({ type: 'Premium check', reason: 'প্রিমিয়াম SKU নিশ্চিত নয় (AI)' }, ref));
  }
  if (isDisplay && displayCheck !== 'Yes') flagLater_(sh, row, ref, 'ডিসপ্লে আউটলেট: AI স্মাইল কর্নার ডিসপ্লে ' + (displayCheck === 'Unclear' ? 'নিশ্চিত হতে পারেনি' : 'দেখেনি'));
  if (!isDisplay && d.colgate_visible === false) flagLater_(sh, row, ref, 'ছবিতে কোনো কলগেট পণ্য দেখা যায়নি (AI)');
  if (!isDisplay && d.smile_corner_visible) {
    addReview_(Object.assign({ type: 'Possible conversion', reason: 'Regular আউটলেটে স্মাইল কর্নার ডিসপ্লে দেখা গেছে (AI)' }, ref));
  }
}

/** Puts an already uploaded photo into "Pending review" (unless an admin already decided). */
function flagLater_(sh, row, ref, reason) {
  if (norm_(sh.getRange(row, IMG.reviewDecision).getValue())) return;
  const prev = norm_(sh.getRange(row, IMG.dupReason).getValue());
  sh.getRange(row, IMG.dupStatus).setValue('Flagged');
  sh.getRange(row, IMG.dupReason).setValue(prev ? prev + '; ' + reason : reason);
  addReview_(Object.assign({ type: 'Flagged', reason: reason }, ref));
}

/* ---------------- Nightly: same-shop comparisons ---------------- */

function nightlyChecks() {
  const s = getSettings_(true);
  if (s.ai_provider !== 'Gemini') return;
  const key = prop_('GEMINI_API_KEY');
  if (!key) { log_('ai', 'GEMINI_API_KEY is missing in Script Properties'); return; }
  if (!acquireRunFlag_('NIGHT_RUN')) return;
  try {
    const now = new Date();
    const rows = readImages_(new Date(now.getTime() - 45 * 864e5));
    const review = readReview_();
    const rejected = rejectedIds_(review);
    const byId = {};
    rows.forEach(r => { byId[r.uploadId] = r; });
    const sh = sheet_(TAB.IMAGES);
    const recentCutoff = new Date(now.getTime() - 3 * 864e5);
    const jobs = [];

    // 1. Photo 2 of the month should show the same shop as photo 1.
    rows.forEach(r => {
      if (norm_(r.sameShop) || Number(r.photoNo) !== 2 || !isCounted_(r, rejected)) return;
      if (!(toDate_(r.ts) > recentCutoff)) return;
      const first = rows.find(x => x.code === r.code && x.month === r.month && Number(x.photoNo) === 1 && isCounted_(x, rejected));
      if (first) jobs.push({ kind: 'second', row: r, other: first });
    });
    // 2. Flagged photos that matched another outlet's photo.
    review.forEach(v => {
      if (v.type !== 'Flagged' || v.decision || v.aiSameShop || !v.matchedId) return;
      const r = byId[v.uploadId], other = byId[v.matchedId];
      if (r && other && r.code !== other.code) jobs.push({ kind: 'other', row: r, other: other, reviewRow: v.row });
    });

    const start = Date.now();
    let count = 0;
    for (let i = 0; i < jobs.length; i++) {
      if (count >= s.same_shop_max_per_night || Date.now() - start > AI_TIME_BUDGET_MS) break;
      const j = jobs[i];
      const res = compareShops_(j.row.fileId, j.other.fileId, s, key);
      if (res.quota) { log_('ai.night', 'Gemini free-tier limit reached'); break; }
      count++;
      if (res.error) { log_('ai.night', res.error); continue; }
      const verdict = (res.data.same_shop ? 'Same shop' : 'Different shop') + ' (' + res.data.confidence + ')';
      sh.getRange(j.row.row, IMG.sameShop).setValue(verdict + ' vs ' + j.other.code);
      const sure = res.data.confidence !== 'low';

      if (j.kind === 'second' && !res.data.same_shop && sure) {
        const reason = 'AI: ছবি ২ আউটলেটের ছবি ১ এর দোকানের মতো দেখায় না';
        sh.getRange(j.row.row, IMG.dupStatus).setValue('Flagged');
        const old = norm_(sh.getRange(j.row.row, IMG.dupReason).getValue());
        sh.getRange(j.row.row, IMG.dupReason).setValue(old ? old + '; ' + reason : reason);
        addReview_({
          uploadId: j.row.uploadId, type: 'Flagged', code: j.row.code, merch: j.row.merch, reason: reason,
          matchedId: j.other.uploadId, url: j.row.url, matchedUrl: j.other.url, aiSameShop: verdict
        });
      }
      if (j.kind === 'other') {
        sheet_(TAB.REVIEW).getRange(j.reviewRow, REV['AI Same-Shop']).setValue(verdict);
      }
      SpreadsheetApp.flush();
      Utilities.sleep(AI_PAUSE_MS);
    }
  } finally {
    releaseRunFlag_('NIGHT_RUN');
  }
}

function compareShops_(fileA, fileB, s, key) {
  let a, b;
  try {
    a = DriveApp.getFileById(fileA).getBlob();
    b = DriveApp.getFileById(fileB).getBlob();
  } catch (e) {
    return { error: 'Cannot open photo: ' + e.message };
  }
  const prompt =
    'Two photos were taken by merchandisers in retail shops in Bangladesh. Both shops have the same standard ' +
    'Colgate display, so IGNORE the Colgate display unit and Colgate products completely. Decide whether both ' +
    'photos show the SAME physical shop, using only the surroundings: walls, shelf structure, other brands and ' +
    'products, signboards, floor, ceiling, doors, lighting and anything fixed in the shop. The camera angle and ' +
    'distance may differ. Answer same_shop, confidence (high, medium or low) and a short reason in English.';
  const parts = [
    { text: prompt },
    { text: 'PHOTO A:' }, { inline_data: { mime_type: 'image/jpeg', data: Utilities.base64Encode(a.getBytes()) } },
    { text: 'PHOTO B:' }, { inline_data: { mime_type: 'image/jpeg', data: Utilities.base64Encode(b.getBytes()) } }
  ];
  const schema = {
    type: 'OBJECT',
    properties: {
      same_shop: { type: 'BOOLEAN' },
      confidence: { type: 'STRING', enum: ['high', 'medium', 'low'] },
      reason: { type: 'STRING' }
    },
    required: ['same_shop', 'confidence', 'reason']
  };
  return callGemini_(parts, schema, s, key);
}
