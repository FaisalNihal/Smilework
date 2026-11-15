# Smile Corner v2.1: what changed

Built on the Claude-generated v2.0 code (your choice, 14 Nov). The v2.0 files are kept unchanged in a separate backup.
Nothing that worked was removed. Two behaviours were deliberately changed, as agreed: similar-looking photos and
reused conversion photos now go to **review** instead of being rejected automatically.

**Not changed (on purpose):** the Daily_Summary and CM_Attendance calculations (set aside until we compare them with
your company report), login, PIN lockout, TM/SR common password, conversion workflow, check-in, new outlet form, email.

## How to deploy this version

1. **Backend (Google Sheet):** paste all 11 `.gs` files from `apps-script/` into Apps Script (replace each file's text).
   Run **Smile Corner > 1. Setup** once: it adds the new tabs, the new columns **at the end** of Images and Review,
   the new Settings rows, the weekly backup and the tab protection. Then **Deploy > Manage deployments > pencil >
   New version > Deploy** (the URL stays the same).
2. **Phone app:** upload the `app/` folder to GitHub; Netlify publishes it. The version is 2.1.0 (`config.js` and `sw.js`).
   In the Settings tab, set `app_min_version` to `2.1.0` so old phones refresh.
3. If you used v2.0 before: run **Smile Corner > Make all photos private** until it says "All done".

## How to test

- Backend: `node tests/backend-test.js` (123 checks; all pass on the simulated Google services).
- Phone and real Google: follow `TESTING.md`. A problem counts as solved only after its real-phone test passes.

## Backend files (apps-script/)

| File | What changed |
| --- | --- |
| Config.gs | Version 2.1.0. New tabs: Review_Log, Outlet_Locations, Premium_Detail. 13 new Images columns at the end (Outlet Type at Capture, Quality Check, Quality Values, Quality Override Reason, Display Seen by Camera, Colgate Products Visible, Premium SKU Presence, Premium Checked By, Fingerprint 256, File Hash, Thumbnail File ID, Location Check, Notes). Review gets "Decision Reason". New settings: ai_provider (Off), quality_mode (warn), guide_max_glare, guide_frame_min_band, gps_wait_seconds, override_after_seconds, phash_flag_bits, dup_far_apart_m, location_learn_max_acc_m, drive_public_links (FALSE), backup_keep. guide_min_sharpness starts at 100 (new, more reliable blur measure). late_upload_hours 72 and only a note. Outlet_Status column renamed "Premium SKU Presence". |
| Util.gs | Reads the new settings. |
| Data.gs | `photoStatus_` (Approved / Pending review / Rejected, used everywhere), `logDecision_` (Review_Log), outlet location helpers (Proposed / Verified), `writePremiumDetail_`, private thumbnail folder, `applySharing_` (private by default), JPEG check, file hash. |
| Upload.gs | Day and month come from the **capture time**. The repeat check runs **before** anything is saved to Drive. Photos private. Small private thumbnail saved. Outlet type (Display, or Approved conversion = Display) saved. New rules: exact copy, similar photo under another outlet nearby, no GPS, far from a VERIFIED location (GPS accuracy allowed for), guide off, quality override, Display outlet with no Smile Corner, Regular photo with no Colgate product (when a model says so): **Pending review**. Same outlet similar photo, far-apart look-alike, weak GPS, late upload, same-spot two codes, low quality in warn mode: **note only**. Only company rules (monthly limit, minimum days) reject. Outlet removed from the PJP, or now in another CM's PJP: kept and sent to review instead of refused. Display seen at a Regular outlet: "Possible conversion" note. Premium result from the phone: Images + Premium_Detail; "Needs review" adds a note. Approved photos with good GPS propose the outlet location. |
| Conversion.gs | Private photo + thumbnail, repeat check before saving to Drive, JPEG check. A reused-looking photo is no longer refused: it is saved with a **Warning** the admin sees. Decisions record a reason and go to Review_Log. 3 new columns at the end (Warning, Thumbnail File ID, Decision Reason). |
| Api.gs | New `thumbs` action (private previews; a CM only gets their own photos; unknown Drive IDs are never served). Photos carry status, outlet type, premium presence, notes, capture and upload time. Review items say whether they hold the photo (`blocking`). Accept/Reject need a reason; every decision goes to Review_Log; "Seen" closes notes only. Admin can switch quality mode. AI queue only shown when Gemini is on. |
| Gemini.gs | **Off unless Settings ai_provider = Gemini.** When on: outlet-type-aware prompts (Regular: no display question, no display reference photos), separate display check / premium / quality, premium uncertain = Needs review (never No), Display not visible / Regular no Colgate product go to review, display at a Regular outlet = "Possible conversion" note. |
| Reports.gs | Outlet_Status only: "Not required" display columns for Regular outlets, Premium SKU Presence, approved conversions shown. **Daily_Summary and attendance unchanged.** |
| Setup.gs | Adds new tabs and new columns at the end of existing tabs (safe upgrade). Installs AI jobs only when Gemini is on. Weekly backup (Friday 3 am, keeps 8). Protects the data tabs. New menu items: Make all photos private, Back up this Sheet now, Protect data tabs. |
| Auth.gs, Email.gs, appsscript.json | No change. |

## Phone app files (app/)

| File | What changed |
| --- | --- |
| camera.js | Gets the outlet type. **Display:** red Smile Corner frame check by colour (no model file): "আরও কাছে যান", "একটু পিছনে যান, পুরো ডিসপ্লে ফ্রেমে আনুন", "ফোন একটু বাঁ/ডান দিকে সরান", "স্মাইল কর্নার ডিসপ্লে ফ্রেমে আনুন". **Regular:** no display target or check; a display seen by chance is only reported. Both: light, glare ("আলো চকচক করছে"), tilt, sharpness measured on the centre of the picture, GPS waits 60 s then allows "Location unknown". Warn mode (messages, photo allowed) or block mode (shutter waits; after 60 s "ভালো ছবি তোলা যাচ্ছে না" with a reason). The saved photo is checked again. 256-bit fingerprint added. The optional MediaPipe model path is kept. |
| premium.js | New. The slot for the on-phone premium model. Without a model every photo is "Not checked" (never "No"). In the preview it shows example boxes, clearly marked as demo. |
| app.js | Outlet type badge everywhere (Display, Regular, "রূপান্তর অনুমোদিত"). Type-specific instructions. Preview after capture: checklist of each check, premium result with boxes. Outlet list saved in IndexedDB (big lists no longer fail), permanent storage requested, warning if the phone cannot store photos, banner for photos waiting over 12 hours, "outlet list saved at" when offline. New status "জমা হয়নি, দেখুন" (Needs attention) for photos a retry cannot fix; they are never deleted automatically. My Photos: Approved / Pending review / Rejected, capture and upload time, offline note, private thumbnails kept on the phone. Admin: reason sheet for Accept/Reject, notes closed with "দেখেছি", quality mode switch. `?demo` ignored in production. |
| sw.js | Cache 2.1.0, saves premium.js and the Bangla font at install, background sending of waiting photos on Android Chrome (best effort; the server ignores repeats). |
| config.js | 2.1.0, PREMIUM_MODEL_URL, ALLOW_DEMO_PARAM = false. |
| index.html | Styles for the new screens; loads premium.js. |
| netlify.toml | New. Phones always check for a new app version; basic security headers. |
| demo.js | Preview only: follows the same rules as the server; camera scene uses your two real photos with distance, light, shake and no-GPS controls. |
| models/README.txt | Explains that no model is needed today, and where the premium model goes later. |

## Known limits (still true after this version)

- Not yet tested on real Android phones, real Google Sheets or real offline days. See `TESTING.md`.
- Quality and fingerprint limits are starting values, measured on 2 photos only. They must be tuned on your 500+ photos.
- The red-frame check can be confused by other large red signs; this is why the first 2 weeks run in warn mode.
- A web app cannot detect fake-GPS apps.
- Premium SKUs: "Not checked" until the custom model is trained (Stage 6).
- Daily_Summary: old rules, not final.
