/*
 * App settings. Change only these values:
 *   API_URL           = the /exec URL of your Apps Script web app deployment
 *   PREMIUM_MODEL_URL = 'models/premium/manifest.json' once the premium SKU model is trained (leave '' until then)
 *   GUIDE_MODEL_URL   = optional trained display model. NOT needed: Display outlets use the red-frame colour check.
 *   PHOTO_MAX_SIDE / PHOTO_QUALITY = photo size (see the storage plan in the runbook)
 *   APP_VERSION       = raise it together with CACHE in sw.js whenever any app file changes
 * With API_URL empty, the app runs in demo mode with sample data. Keep ALLOW_DEMO_PARAM false in production.
 */
window.APP_CONFIG = {
  API_URL: '',
  PREMIUM_MODEL_URL: '',
  GUIDE_MODEL_URL: '',
  ALLOW_DEMO_PARAM: false,
  // Photo size saved to Drive. 1280 / 0.75 is about 200-250 KB a photo (recommended to stay inside free storage).
  // 1600 / 0.8 is sharper for small packs but about twice the size.
  PHOTO_MAX_SIDE: 1280,
  PHOTO_QUALITY: 0.75,
  APP_VERSION: '2.1.0',
  MEDIAPIPE_VERSION: '1.2.3'
};
