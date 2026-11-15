# Smile Corner v2.1: test checklist (Phase 4)

Mark a problem as solved only when its tests pass on **real Android phones** with the **real Google Sheet**.
Use at least 3 phones: the slowest one your CMs use, a typical one, and one other brand. Write the phone model next to each tick.

Before you start: one test merchandiser in PJP (2 Display + 2 Regular outlets, ideally real shops near you) and in Users.

## 1. Android basics (each phone)

- [ ] Opens in Chrome, login works, **Add to Home screen** works, the icon opens the app.
- [ ] Camera and location permission asked once; the camera opens within 3 seconds.
- [ ] Bangla text looks right; buttons are big enough to tap with a thumb.

## 2. Photo quality (Problem 2)

- [ ] **Display outlet**, standing far away: "আরও কাছে যান". Very close (frame cut): "একটু পিছনে যান…". Off to one side: "ফোন একটু বাঁ/ডান দিকে সরান". Correct: green "ঠিক আছে, এখন ছবি তুলুন".
- [ ] **Regular outlet**: no display or sticker is asked for; only light, steadiness, tilt and GPS.
- [ ] Dark shop (or hand over the light): "আলো কম…". Shiny glare: "আলো চকচক করছে…". Moving the phone: "ফোন স্থির রাখুন". Phone tilted: "ফোন সোজা করে ধরুন".
- [ ] **Warn mode** (default): the photo can still be taken; the Images tab shows "Below limits" and the values in **Quality Values**.
- [ ] Admin turns on **কঠোর মান যাচাই**: the shutter stays locked until all checks pass; after 60 seconds "ভালো ছবি তোলা যাচ্ছে না" appears; with a reason the photo is sent and shows "যাচাই বাকি" for the CM and in Admin review.
- [ ] A red signboard or a wall of red packs at a Regular outlet does **not** make the Display check pass. (Write down every false result; this tunes the limits.)

## 3. Seeing photos (Problem 3)

- [ ] After the shutter: the photo, the checklist and Retake / Confirm are shown.
- [ ] **আমার ছবি** shows outlet code, date and time, Display/Regular and a status for every photo: "ফোনে আছে, পাঠানো বাকি", "পাঠানো হচ্ছে", "গৃহীত", "যাচাই বাকি", "বাতিল", "জমা হয়নি, দেখুন".
- [ ] Previous months open with the arrows; thumbnails appear (they come from the server with the login, because photos are private).
- [ ] The Photo Link in the Images tab, opened in a private browser window, asks for a Google sign-in (photo is private).

## 4. Offline (Problem 4)

- [ ] Log in online, open **আজ** once. Turn on airplane mode. Close the app fully. Open it from the home-screen icon: it opens and shows the outlet list and "আউটলেট তালিকা সেভ: …".
- [ ] Take 3 photos at 3 outlets offline (GPS still works outside; indoors it may say "Location unknown" after 60 s).
- [ ] Restart the phone. Open the app: the 3 photos are still "ফোনে আছে, পাঠানো বাকি".
- [ ] Turn the internet on with the app open: all 3 upload; each appears **once** in the Images tab; the Captured At time is the offline time.
- [ ] Repeat, but turn the internet on with the app **closed** (Android Chrome): note whether photos uploaded in the background. (Best effort: if not, they upload when the app is opened.)
- [ ] Weak network: start an upload and switch to airplane mode mid-way; after reconnecting there is still only one row.
- [ ] Offline for 5+ hours with 20+ photos: all upload afterwards; nothing lost.
- [ ] Note: login, Admin screen and reports need internet (expected).

## 5. Duplicates and GPS (Problem 5)

- [ ] Photo 2 of the same unchanged display (same outlet, a few days later): **গৃহীত**, with the note "একই আউটলেটের আগের ছবির মতো দেখতে".
- [ ] Same display photographed again and submitted under a **different outlet code** at the same place: **যাচাই বাকি** with "মিল আছে: অন্য আউটলেট …". Admin sees both photos side by side.
- [ ] Two different shops with similar displays far apart: approved with a note only.
- [ ] Photo taken with GPS off: "লোকেশন পাওয়া যায়নি" → review.
- [ ] Outlet_Locations: a Proposed row appears after the first approved photo. Set it to Verified. A photo of that outlet taken 300+ m away goes to review; one within the GPS accuracy does not.
- [ ] Admin Accept / Reject needs a reason; Review_Log gets a row with old status, new status, who and why; the CM's status changes.
- [ ] 3rd photo of an outlet in a month is refused (company rule) and shows "বাতিল".

## 6. Outlet types and premium SKUs (Problems 1 and 6)

- [ ] Regular outlet photos never show "ডিসপ্লে পাওয়া যায়নি"; Outlet_Status shows "Not required" for them.
- [ ] Display outlet photo where no Smile Corner was seen → review "ডিসপ্লে আউটলেট, কিন্তু ক্যামেরা স্মাইল কর্নার ডিসপ্লে দেখেনি".
- [ ] Approve a conversion for a Regular outlet: its next photo uses the Display rules before the PJP is edited.
- [ ] Premium SKU Presence shows "Not checked" (no model yet). **Accuracy tests come with the model (Stage 6):** on 100+ photos labelled by your team and never used in training, record per SKU how many YES were wrong and how many real premium packs were missed. Agree the acceptable numbers before switching it on.

## 7. Daily Summary (Problem 6)

- [ ] Not tested in this version: the old rules are unchanged on purpose. Reconcile after the new rules are agreed, against 2–3 CMs over 3–5 days counted by hand.

## 8. Safety

- [ ] Data tabs are protected (try to type in the Images tab with another Google account that has edit access: it is refused).
- [ ] **Back up this Sheet now** creates a copy in Drive > Smile Corner > Backups.
- [ ] Adding `?demo` to the app address does nothing in production.
- [ ] Changing the TM password logs every TM out.
