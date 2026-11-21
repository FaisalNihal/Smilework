/**
 * Colgate Smile Corner — backend configuration.
 * Everything that might change lives here or in the Settings tab.
 * Secrets (Gemini key, token secret) live in Script Properties, never in code.
 */

const APP_VERSION = '2.1.1';
const TZ = 'Asia/Dhaka';

const TAB = {
  PJP: 'PJP',
  USERS: 'Users',
  IMAGES: 'Images',
  REVIEW: 'Review',
  SKU: 'SKU_Master',
  SETTINGS: 'Settings',
  HOLIDAYS: 'Holidays',
  CHECKINS: 'CheckIns',
  SUMMARY: 'Daily_Summary',
  ATTENDANCE: 'CM_Attendance',
  NEW_OUTLET: 'NewEnrolledOutlet',
  CONVERSIONS: 'Conversions',
  OUTLET_STATUS: 'Outlet_Status',
  REVIEW_LOG: 'Review_Log',
  LOCATIONS: 'Outlet_Locations',
  PREMIUM_DETAIL: 'Premium_Detail',
  LOG: 'Log'
};

/** PJP columns (0-based), same layout as the current PJP sheet. Latitude/Longitude are optional new columns. */
const PJP = {
  REGION: 0, ZONE: 1, TERRITORY: 2, DB_CODE: 3, DB_NAME: 4, CODE: 5, NAME: 6, SLAB: 7,
  ROUTE_CODE: 8, ROUTE: 9, VISIT_DAY: 10, MERCH: 11, STATUS: 12, UNIT: 13, CLUSTER: 14,
  LAT: 15, LON: 16
};
const PJP_HEADERS = ['Region', 'Zone', 'Territory', 'Distributor Code', 'DB Name', 'Outlet Code', 'Outlet Name',
  'Slab', 'Route Code', 'Route Name', 'Visit Day', 'Merchandiser', 'Outlet Status', 'Unit', 'Cluster',
  'Latitude', 'Longitude'];

/** Images tab: one row per photo. Order = column order (A, B, C ...). */
const IMG_COLS = [
  ['ts', 'Timestamp'], ['uploadId', 'Upload ID'], ['month', 'Month'],
  ['merch', 'Merchandiser'], ['role', 'Role'],
  ['code', 'Outlet Code'], ['outletName', 'Outlet Name'], ['region', 'Region'], ['dbCode', 'DB Code'],
  ['dbName', 'DB Name'], ['route', 'Route'], ['slab', 'Slab'],
  ['fileId', 'Photo File ID'], ['url', 'Photo Link'],
  ['lat', 'Latitude'], ['lon', 'Longitude'], ['acc', 'GPS Accuracy (m)'], ['dist', 'Distance From Outlet (m)'],
  ['fp', 'Fingerprint'], ['framing', 'Framing Score'],
  ['dupStatus', 'Duplicate Status'], ['dupReason', 'Duplicate Reason'],
  ['valid', 'Display Valid'], ['CDC', 'CDC'], ['CAS', 'CAS'], ['MAX', 'MAX'], ['TOT', 'TOT'], ['VW', 'VW'],
  ['full', 'Full Display'], ['st', 'Shelf Talker'],
  ['premium', 'Premium SKUs Found'], ['facings', 'Premium Facings'], ['conf', 'AI Confidence'], ['comment', 'AI Comment'],
  ['aiStatus', 'AI Status'], ['photoNo', 'Photo No. This Month'], ['appVer', 'App Version'],
  ['captureTs', 'Captured At'], ['source', 'Source'], ['guide', 'Camera Guide'],
  ['reviewDecision', 'Review Decision'], ['sameShop', 'AI Same-Shop Check'], ['status', 'Outlet Status'],
  // v2.1 columns. Always added at the END so older columns never move.
  ['outletType', 'Outlet Type at Capture'], ['quality', 'Quality Check'], ['qualityVals', 'Quality Values'],
  ['override', 'Quality Override Reason'], ['displaySeen', 'Display Seen by Camera'], ['colgate', 'Colgate Products Visible'],
  ['premiumPresence', 'Premium SKU Presence'], ['premiumBy', 'Premium Checked By'], ['phash', 'Fingerprint 256'],
  ['sha', 'File Hash'], ['thumbId', 'Thumbnail File ID'], ['locCheck', 'Location Check'], ['notes', 'Notes']
];
/** IMG.key = 1-based column number. */
const IMG = IMG_COLS.reduce((m, c, i) => { m[c[0]] = i + 1; return m; }, {});
const DISPLAY_BRANDS = ['CDC', 'CAS', 'MAX', 'TOT', 'VW'];

const REVIEW_HEADERS = ['Logged At', 'Upload ID', 'Type', 'Outlet Code', 'Merchandiser', 'Reason',
  'Matched Upload ID', 'Photo Link', 'Matched Photo Link', 'AI Same-Shop', 'Decision', 'Decided By', 'Decided At',
  'Decision Reason'];
/** Review row types that hold a photo in "Pending review" until an admin decides. Other types are notes. */
const REVIEW_BLOCKING = ['Flagged'];
/** Every review decision, never overwritten. */
const REVIEW_LOG_HEADERS = ['Time', 'Upload ID', 'Outlet Code', 'Merchandiser', 'Review Type', 'Old Status', 'New Status',
  'Decided By', 'Reason'];
/** Outlet GPS learned from approved visits. Only rows with Status = Verified are used for distance warnings. */
const LOC_HEADERS = ['Outlet Code', 'Outlet Name', 'Status', 'Latitude', 'Longitude', 'Accuracy (m)', 'Visits Used',
  'Suggested Latitude', 'Suggested Longitude', 'First Upload ID', 'Updated At', 'Verified By', 'Map Link'];
/** One row per photo per premium SKU found (from the on-phone model, or Gemini if switched on). */
const PREMIUM_DETAIL_HEADERS = ['Captured At', 'Upload ID', 'Outlet Code', 'Outlet Type', 'Merchandiser', 'SKU ID',
  'SKU Name', 'Confidence', 'Facings', 'Box (x, y, w, h)', 'Photo Result', 'Checked By'];
const REV = REVIEW_HEADERS.reduce((m, h, i) => { m[h] = i + 1; return m; }, {});

const USERS_HEADERS = ['Name', 'PIN', 'Role', 'Join Date', 'Active'];
const SKU_HEADERS = ['SKU ID', 'Name', 'Variant', 'Pack Size', 'Group', 'Description', 'Reference Photo IDs', 'Active'];
const SUMMARY_HEADERS = ['Date', 'Merchandiser', 'Region', 'DB Code', 'Routes Visited', 'Planned Outlets',
  'Planned Display', 'Planned Regular', 'Visited Outlets', 'Display Visited', 'Regular Visited',
  'Check-in', 'First Photo', 'Last Photo', 'Hours', 'Flagged Photos', 'Premium Found', 'Conversions', 'Planned Visited'];
const ATTENDANCE_HEADERS = ['Month', 'Date', 'Region', 'Distributor', 'Merchandiser', 'Status',
  'Planned Outlet', 'Visited Outlet', 'Spend (Hour)'];
const CHECKIN_HEADERS = ['Date', 'Merchandiser', 'Time', 'Latitude', 'Longitude', 'GPS Accuracy (m)'];
const NEW_OUTLET_HEADERS = ['Enrolled Date', 'Distributor Code', 'Distributor Name', 'Outlet Code', 'Outlet Name',
  'Owner Name', 'Contact Number', 'Slab', 'Route Code', 'Route Name', 'Created By'];
const HOLIDAY_HEADERS = ['Date', 'Holiday'];
const OUTLET_STATUS_HEADERS = ['Month', 'Outlet Code', 'Outlet Name', 'Merchandiser', 'Unit', 'Route', 'PJP Status',
  'Photos This Month', 'Last Photo', 'Display OK', 'Full Display', 'Premium SKU Presence', 'Premium SKUs', 'Conversion'];
const LOG_HEADERS = ['Time', 'Where', 'Message'];

/** Settings tab defaults. Admins change values in the sheet; code picks them up within 5 minutes. */
const SETTINGS_DEFAULTS = [
  ['notice', '', 'Notice shown to every user at the top of the app'],
  ['maintenance', 'FALSE', 'TRUE blocks everyone except admins'],
  ['max_photos_per_month', 2, 'Merchandiser photos allowed per outlet per month'],
  ['min_days_between', 0, 'Minimum days between an outlet\'s 1st and 2nd photo (0 = no rule)'],
  ['fp_reject_bits', 5, 'Fingerprint difference at or below this = near-identical copy (sent to review, never rejected automatically)'],
  ['fp_flag_bits', 12, 'Fingerprint difference at or below this = similar photo'],
  ['phash_flag_bits', 60, 'Detailed (256-bit) fingerprint difference at or below this = similar photo (both fingerprints must agree)'],
  ['dup_far_apart_m', 300, 'Similar photo under another outlet, but both GPS good and further apart than this = note only, not review'],
  ['fp_lookback_days', 90, 'How many days of photos the fingerprint check compares against'],
  ['gps_far_m', 100, 'Review if (distance from the VERIFIED outlet location - GPS accuracy) is more than this'],
  ['gps_cluster_m', 20, 'Note (not review) two outlet codes shot within this many metres ...'],
  ['gps_cluster_min', 10, '... and within this many minutes, by the same person'],
  ['gps_max_accuracy_m', 100, 'GPS accuracy worse than this = "Location uncertain" note'],
  ['location_learn_max_acc_m', 50, 'Approved photos with GPS accuracy at or better than this suggest the outlet location'],
  ['late_upload_hours', 72, 'Note (not review) if a photo reaches the server this many hours after it was taken'],
  ['weekend_day', 'Friday', 'Weekly off day for attendance'],
  ['report_days', 7, 'How many recent days each report update recalculates'],
  ['ai_provider', 'Off', 'Off = no photo is sent to any outside AI. Gemini = only after company approval. Local = on-phone model'],
  ['gemini_model', 'gemini-3.8-flash', 'Main model for photo analysis'],
  ['gemini_fallback_model', 'gemini-3.6-flash', 'Used if the main model fails'],
  ['ai_batch_size', 25, 'Max photos analysed per 15-minute run'],
  ['ai_work_hours', '7-23', 'Hours (Dhaka) when photo analysis runs'],
  ['same_shop_max_per_night', 60, 'Max AI same-shop comparisons per night'],
  ['guide_min_width', 0.40, 'Camera guide: display must be at least this share of frame width'],
  ['guide_max_width', 0.75, 'Camera guide: display must be at most this share of frame width'],
  ['guide_max_center_offset', 0.15, 'Camera guide: how far off centre the display may be'],
  ['guide_max_tilt', 25, 'Camera guide: max phone tilt from upright, degrees'],
  ['guide_min_brightness', 45, 'Camera guide: below this (0-255) the image is too dark'],
  ['guide_min_sharpness', 100, 'Camera guide: below this the centre of the picture is too blurry (starting value, tune with real photos)'],
  ['guide_max_glare', 0.15, 'Camera guide: share of pure-white pixels above this = too much glare'],
  ['guide_frame_min_band', 0.6, 'Camera guide: how red the top/left/right edge of the Smile Corner frame must be (0-1)'],
  ['quality_mode', 'warn', 'warn = show quality messages but allow the photo; block = shutter waits until all checks pass'],
  ['gps_wait_seconds', 60, 'Camera waits this long for GPS, then allows the photo as "Location unknown" (sent to review)'],
  ['override_after_seconds', 60, 'Block mode: after this long, the CM may send a failed photo with a reason (sent to review)'],
  ['drive_public_links', 'FALSE', 'FALSE = photos are private (recommended). TRUE = anyone with the link can view'],
  ['backup_keep', 8, 'How many weekly backup copies of this Sheet to keep'],
  ['email_to', '', 'Daily email recipients (comma separated)'],
  ['email_bcc', '', 'Daily email hidden recipients (comma separated)'],
  ['app_min_version', '2.1.0', 'Phones on an older app version are asked to refresh'],
  ['tm_password', '', 'Common password for the TM/SR login (8+ characters). Empty = TM/SR login is off'],
  ['tm_outlet_units', 'SMT', 'TM/SR see outlets of these units (comma separated) plus outlets with no merchandiser. Empty = all outlets']
];

/** Settings the phone app is allowed to see. */
const PUBLIC_SETTINGS = ['notice', 'maintenance', 'max_photos_per_month', 'guide_min_width', 'guide_max_width',
  'guide_max_center_offset', 'guide_max_tilt', 'guide_min_brightness', 'guide_min_sharpness', 'guide_max_glare',
  'guide_frame_min_band', 'quality_mode', 'gps_wait_seconds', 'override_after_seconds',
  'gps_max_accuracy_m', 'app_min_version'];
