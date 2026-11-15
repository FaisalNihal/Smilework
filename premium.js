/*
 * Premium SKU check on the phone (no API, no per-photo cost).
 *
 * TODAY: no model is installed, so every photo is "Not checked". The app never says "No" without a model.
 * LATER (Stage 6, after training on your SKU and outlet photos):
 *   1. Put the model files in  models/premium/  (pack_detector.tflite, sku_embedder.tflite, references.json, manifest.json)
 *   2. Set PREMIUM_MODEL_URL: 'models/premium/manifest.json' in config.js and raise the app version.
 *   The model runs after the CM confirms a photo, works offline, and returns the result below.
 *
 * Result shape (saved with the photo and sent to the Images and Premium_Detail tabs):
 *   { presence: 'Yes' | 'No' | 'Needs review' | 'Not checked',
 *     colgate: 'Yes' | 'No' | '',            // were any Colgate packs found (Regular outlets: "No" goes to review)
 *     model: 'name and version',
 *     items: [{ sku, name, conf (0-1), facings, box: [x, y, w, h] as shares of the photo, found }] }
 * Rule: YES only for a confident match that is clearly closer to the premium reference than to any look-alike;
 *       NO only when the photo passed the quality checks and every pack found matched a non-premium product;
 *       everything else is NEEDS REVIEW.
 */
(function () {
  'use strict';
  const CFG = window.APP_CONFIG || {};

  async function analyze(cap, ctx) {
    ctx = ctx || {};
    if (ctx.demo) return demoResult(cap);
    if (!CFG.PREMIUM_MODEL_URL) return { presence: 'Not checked', colgate: '', model: '', items: [] };
    // The trained model is loaded here in Stage 6. Until then, never guess.
    return { presence: 'Not checked', colgate: '', model: 'model not installed', items: [] };
  }

  /**
   * Preview only: shows HOW a result will look, using fixed example boxes on the sample photos.
   * These are not real detections and not your real premium SKU list.
   */
  function demoResult(cap) {
    const boxes = (cap.demoBoxes || []).filter(b => b.box[2] > 0.02 && b.box[3] > 0.01 &&
      b.box[0] >= 0 && b.box[1] >= 0 && b.box[0] + b.box[2] <= 1 && b.box[1] + b.box[3] <= 1);
    if (!boxes.length) {
      return { presence: cap.quality && cap.quality.passed ? 'No' : 'Needs review', colgate: 'Yes', model: 'ডেমো (আসল মডেল নয়)', items: [] };
    }
    // A photo that failed the quality checks can never give a confident answer.
    const okPhoto = !!(cap.quality && cap.quality.passed);
    const items = boxes.map(b => ({ sku: b.sku, name: b.name, conf: okPhoto ? b.conf : Math.min(b.conf, 0.5), facings: b.facings || 1, box: b.box, found: true }));
    const sure = okPhoto && items.some(i => i.conf >= 0.8);
    return { presence: sure ? 'Yes' : 'Needs review', colgate: 'Yes', model: 'ডেমো (আসল মডেল নয়)', items: items };
  }

  window.PremiumModel = {
    analyze: analyze,
    installed: () => !!CFG.PREMIUM_MODEL_URL
  };
})();
