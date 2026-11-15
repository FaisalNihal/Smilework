# Smile Corner app: setup steps

Two folders:

- `apps-script/`: the backend. Paste it into Apps Script, attached to a new Google Sheet.
- `app/`: the phone app. Host it on Netlify (free), connected to a private GitHub repository.
- `tests/`: automatic checks for the backend. Run `node tests/backend-test.js` (needs Node.js) after any backend change.

Follow the parts in order. Part A takes about 30 minutes; Part B about 20.

---

## Part A: Google Sheet and backend

1. **Use a dedicated Google account** for the app (for example a new Gmail made only for this). It will own the Sheet, the photos and the scripts, so nothing is lost when a person leaves.

2. **Create a new Google Sheet** in that account, named for example `Smile Corner Database`.

3. **Open Apps Script:** in the Sheet, Extensions > Apps Script.
   - Delete everything in `Code.gs`, then rename it to `Config`.
   - Add these script files with the **+** button (Script). Paste each one's content from the `apps-script` folder:
     `Config`, `Util`, `Auth`, `Data`, `Upload`, `Conversion`, `Api`, `Gemini`, `Reports`, `Email`, `Setup`.
   - Project Settings (gear icon): tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace its content with the one in the folder.
   - Save (Ctrl+S).

4. **Run Setup:**
   - Go back to the Sheet and reload the page. A **Smile Corner** menu appears.
   - Click Smile Corner > **1. Setup**.
   - Google asks for permission. Click Advanced, then Go to project, then Allow. The warning appears because the script is your own and not published.
   - Setup creates every tab, the `Smile Corner` folder in Drive and the scheduled jobs.
   - It also shows the first admin login: name **Admin** and a PIN. That PIN is also in the Users tab.

5. **Fill in your data** (leave `ai_provider` = `Off` and `quality_mode` = `warn` in the Settings tab):
   - **PJP tab:** paste your PJP with the same columns as now (A Region … O Cluster). If you have outlet GPS, add it in **P Latitude** and **Q Longitude**; the location check gets much stronger.
   - **Users tab:** one row per person.
     - Name: exactly as in PJP column L.
     - PIN: 4 digits.
     - Role: `Merchandiser`, `SR` or `Admin`.
     - Join Date.
     - Active: `TRUE`.
   - **TMs / SRs do not go in the Users tab.** They all log in with one common password: put it in the Settings tab under `tm_password` (6+ characters), or set it from the app's Admin screen. Changing it logs every TM / SR out, so change it when someone leaves.
   - `tm_outlet_units` (Settings tab, default `SMT`) decides which outlets TMs see. They also see any outlet with an empty Merchandiser column in PJP.
   - **Holidays tab:** dates that should show as Holiday in attendance.
   - **Outlet_Status tab** (created by Setup, refreshed every hour): one row per outlet for the current month: photos taken, last photo, display OK and full display (**"Not required"** for Regular outlets), **Premium SKU Presence** (Yes / No / Needs review / Not checked) and which premium SKUs.
   - **Outlet_Locations tab:** the first approved photo with good GPS suggests each outlet's location as **Proposed**. Open the Map Link; if it is right, set Status to **Verified**. Only Verified locations (or Latitude/Longitude in PJP) are used for "too far from the outlet" warnings.
   - **Review_Log tab:** every admin decision (who, when, old and new status, reason). Never edit it.
   - **Premium_Detail tab:** one row per photo per premium SKU found (empty until the premium model is installed).
   - **SKU_Master, row REF1 (Display reference):** only used if Gemini is ever switched on.
   - **Conversions tab** (created by Setup): every Regular → Display request from the app, with its photo link and Status (Pending / Approved / Rejected). Approve or reject them on the app's Admin screen (a reason is required). The app never edits PJP: when a conversion is Approved, the camera already treats the outlet as Display; change its Outlet Status to Display in PJP yourself when you can.
   - **Settings tab:** fill `email_to` and `email_bcc` with the daily email recipients, comma separated. Check `min_days_between`, the minimum gap between an outlet's 1st and 2nd photo (0 = no rule).

6. **Gemini key: not needed.** Photo analysis by Gemini is switched off (`ai_provider` = `Off`), so no photo leaves Google Drive. **Delete the old key** that is in the old code (it has been shared, so treat it as public). Only if the company later approves Gemini: add `GEMINI_API_KEY` in Project Settings > Script Properties, set `ai_provider` = `Gemini`, run Setup again (it installs the AI jobs), then Test Gemini key.

7. **SKU_Master tab:**
   - Rows CDC, CAS, MAX, TOT, VW: replace "FILL IN" with each product's full name and what its pack looks like.
   - Add one row per **premium SKU**:
     - Group: `Premium`
     - Active: `TRUE`
     - Description: what the pack looks like.
   - Add rows for **look-alike regular packs**, with Group `Look-alike`.
   - Put the pack photos in Drive > Smile Corner > SKU References. Copy each photo's link into the **Reference Photo IDs** column; several links can go in one cell, separated by commas.
   - Keep the reference photos under 1,000 px wide.

8. **Publish the backend:**
   - In Apps Script, click Deploy > New deployment.
   - Click the gear, then Web app.
   - Execute as: **Me**. Who has access: **Anyone**.
   - Click Deploy and **copy the Web app URL** (it ends in `/exec`).

---

## Part B: the phone app (GitHub + Netlify)

9. **Put the URL in the app:** open `app/config.js`, paste the URL between the quotes of `API_URL: ''`. Keep `ALLOW_DEMO_PARAM: false`. Save.

10. **GitHub:** create a **private** repository, for example `smile-corner`. Upload everything in this folder (`app`, `apps-script`, `tests` and the `.md` files). Never upload the PJP file, photos or PINs.

11. **Netlify:** sign up with GitHub at netlify.com (free plan). **Add new project > Import an existing project > GitHub**, pick the repository, then:
    - Base directory: `app`
    - Build command: leave empty
    - Publish directory: `app`
    - Click Deploy. You get an address like `https://smile-corner-xyz.netlify.app`. `app/netlify.toml` makes sure phones always check for a new app version.

12. **Try it on a phone:**
    - Open the address in Chrome and log in as Admin.
    - Take a test photo at a test outlet.
    - Check that a row appears in the Images tab and the photo appears in Drive > Smile Corner > Photos. Open its Photo Link in a private window: Google must ask you to sign in (the photo is private).
    - Then use Chrome menu > **Add to Home screen**.
    - Work through `TESTING.md`.

13. **Stop the old system:**
    - In the old Apps Script projects, open Triggers (clock icon) and delete the old triggers. Otherwise the old email and old reports keep running.
    - Keep the old Sheet as a read-only archive.
    - Give merchandisers the new address.

---

## Changing things later

- **Backend code changed:**
  - Deploy > Manage deployments > pencil icon.
  - Version: **New version** > Deploy.
  - The URL stays the same. A *new* deployment would make a new URL, so don't create one.
- **App code changed:**
  - Commit to GitHub; Netlify publishes by itself. Each publish uses Netlify free credits (about 20 publishes a month), so group small changes together.
  - Also raise the version in two places:
    - `CACHE` in `sw.js`
    - `APP_VERSION` in `config.js`
  - To make old phones refresh, set `app_min_version` in the Settings tab to the new version.
- **Thresholds** (fingerprint, GPS distances, camera guide limits) are all in the Settings tab. The app picks up changes within 5 minutes.
- **Display check:** no model is needed. Display outlets are checked by the red Smile Corner frame. Tune it with `guide_min_width`, `guide_max_width`, `guide_max_center_offset` and `guide_frame_min_band` in Settings.
- **Premium SKU model** (after training): see `app/models/README.txt`.
- **Quality mode:** Admin screen > কঠোর মান যাচাই. Start with it OFF (warnings only) for 2 weeks, tune the limits, then turn it ON.

## Menu in the Sheet (Smile Corner)

| Item | When to use it |
| --- | --- |
| Setup | First time, or after a new version (adds new tabs and columns at the end). Safe to repeat. |
| Test Gemini key | Only if Gemini is ever switched on |
| Update reports now | To see Daily_Summary / CM_Attendance without waiting for the hourly run |
| Rebuild all reports | After a big PJP or Users correction |
| Analyse new photos now | To run the AI check without waiting 15 minutes |
| Retry failed AI analysis | After fixing a Gemini problem |
| Run same-shop checks now | To run the night-time AI comparison now |
| Send attendance email now | To test the email |
| Make all photos private | Once, after moving from v2.0 (removes old public links). Repeat until it says done |
| Back up this Sheet now | Before big edits. A weekly backup also runs by itself (Friday 3 am) |
| Protect data tabs | Setup already does this; use it if a protection was removed |

Errors from the scheduled jobs are written to the **Log** tab.
