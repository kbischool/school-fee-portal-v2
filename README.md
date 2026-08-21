# School Fee Payment Portal — 2026/2027 Session

Real accounts for parents and administrators, backed by Firebase — no more sharing a code every time.

- **Parents**: use their existing school code **once** to create an email + password login (or link Google). Every visit after that is a normal login.
- **Admins**: same idea, with a separate admin code, landing on a dashboard to view students and issue new codes.
- Fee data now lives in Firestore, only readable by the parent it belongs to (or an admin) — this closes the "anyone can view the raw JSON" gap the previous version's README flagged.

> ⚠️ This repo contains real student and financial data (`2026 - 2027 FEE.xlsx`, `parent_codes.xlsx`, `students_1st_term.json`, `code_registry.json`). Keep this repo **private**, same as before. `serviceAccountKey.json` (created in Step 6 below) is even more sensitive — never commit it; it's already in `.gitignore`.

---

## What's new in this version

| File | Purpose |
|---|---|
| `index.html` | **Replaced.** Now the login / first-time code claim page (parent or admin, email+password or Google), instead of the passcode-only lookup. |
| `legacy-lookup.html` | Your old `index.html`, kept for reference — not linked from anywhere, safe to delete once you're confident in the new flow. |
| `parent-dashboard.html` | **New.** Where a logged-in parent sees their child's fee ledger. |
| `admin-dashboard.html` | **New.** Where a logged-in admin sees all students/codes and can issue new ones. |
| `js/firebase-config.js` | **New.** Your Firebase project's connection details — you'll fill this in during setup. |
| `js/auth.js` | **New.** Shared login/signup/code-claim logic used by the pages above. |
| `css/style.css` | **New.** Shared styling for the new pages. |
| `firestore.rules` | **New.** The real access control — who can read/write what in the database. |
| `migrate_to_firestore.py` | **New.** One-time script that imports your existing `code_registry.json` + `students_1st_term.json` into Firestore, matched exactly to their current format. |
| `2026 - 2027 FEE.xlsx`, `update_data.py`, `code_registry.json`, `parent_codes.xlsx`, `requirements.txt` | **Unchanged.** You still edit the spreadsheet and run `update_data.py` exactly as before each term — see below. |

---

## Part 1: Updating fee data each term (unchanged)

### One-time setup
```bash
pip install -r requirements.txt
```

### Every time you update fees or add/remove students
1. Edit `2026 - 2027 FEE.xlsx` directly:
   - **1st Term** goes in the sheet named `1ST TERM ACCOUNT`.
   - When 2nd term starts, add a sheet named exactly `2ND TERM ACCOUNT` (same column layout).
   - When 3rd term starts, add a sheet named exactly `3RD TERM ACCOUNT`.
   - You can delete a student's row, or add a brand new row for a new student, at any time.
   - **Do not rename an existing student** (their code is tied to their name).
2. Run:
   ```bash
   python3 update_data.py
   ```
3. This regenerates `students_1st_term.json` (and 2nd/3rd once those sheets exist), `parent_codes.xlsx`, and `code_registry.json`.
4. **New step:** run the migration script again to push the refreshed numbers into Firestore:
   ```bash
   python3 migrate_to_firestore.py
   ```
   Safe to re-run any time — existing codes and claimed accounts are untouched, only fee amounts and any brand-new students get written.

---

## Part 2: Firebase setup (do this once)

You've never touched Firebase before — follow this in order.

### Step 1: Create the Firebase project
1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with a Google account (a school Google account is a good idea if you don't want to use a personal one).
2. Click **Add project**. Name it something like `school-fee-portal`.
3. You can turn **off** Google Analytics for this project — not needed.
4. Click **Create project** and wait for it to finish.

### Step 2: Register a web app
1. On the project's home screen, click the **`</>`** (web) icon to add a web app.
2. Nickname it "School Fee Portal Web".
3. Skip "Set up Firebase Hosting" for now (Step 7 covers hosting).
4. Click **Register app**. Copy the `firebaseConfig` object it shows you — you need it next.

### Step 3: Paste your config into the project
1. Open `js/firebase-config.js` in this project.
2. Replace the placeholder values with the real ones from Step 2 (`apiKey`, `authDomain`, `projectId`, etc.).
3. Save. These values aren't secret — access is controlled by the rules in Step 5, not by hiding this file.

### Step 4: Turn on Authentication
1. Left sidebar -> **Build -> Authentication -> Get started**.
2. Under **Sign-in method**, enable:
   - **Email/Password** — toggle on, Save.
   - **Google** — toggle on, pick a support email, Save.

### Step 5: Turn on Firestore and set the security rules
1. Left sidebar -> **Build -> Firestore Database -> Create database**.
2. Choose **Start in production mode** (real rules are ready to paste in, no need for test mode).
3. Pick the region closest to your school — can't be changed later, but not critical which one.
4. Once created, go to the **Rules** tab.
5. Delete everything there and paste in the entire contents of `firestore.rules` from this project.
6. Click **Publish**.

### Step 6: Import your existing codes and students
1. Get a service account key: ⚙️ **Project settings -> Service accounts -> Generate new private key**. A file downloads — rename it to `serviceAccountKey.json` and put it in this project folder, next to `migrate_to_firestore.py`.
   - **Never share or commit this file** — it gives full admin access to your database. Already excluded in `.gitignore`.
2. Make sure `code_registry.json` and `students_1st_term.json` are in this same folder (they already are, if you're working from this zip).
3. Install the one Python package this needs:
   ```bash
   pip install firebase-admin --break-system-packages
   ```
4. Run it:
   ```bash
   python3 migrate_to_firestore.py
   ```
5. It reports how many students and codes it imported. This script was written to match your actual `code_registry.json` / `students_1st_term.json` format exactly, so it should run without needing edits.

### Create your first admin code
The migration script only imports parent codes. Add one admin code by hand for your first login:
1. Firestore Database -> **Start collection** -> collection ID: `adminCodes`.
2. Document ID: a code you'll remember, e.g. `ADMIN001`.
3. Add fields: `claimed` (boolean, `false`), `label` (string, e.g. `"Head Admin"`).
4. Save. Use `ADMIN001` to claim your admin account the first time you open the site.

### Step 7: Host the site
Simplest option since you're already in Firebase:
1. Install Node.js if you don't have it, then: `npm install -g firebase-tools`
2. In this folder: `firebase login`, then `firebase init hosting`:
   - "Use an existing project" -> pick the one you made.
   - Public directory: `.` (a single dot).
   - Configure as a single-page app: **No**.
   - Don't overwrite `index.html`.
3. `firebase deploy` — gives you a live URL like `school-fee-portal-xxxxx.web.app`.

(You can keep using GitHub Pages instead if you prefer — nothing here requires Firebase Hosting specifically.)

### Step 8: Test before telling anyone
1. Claim one real parent code end-to-end on the live site — set an email + password, confirm you see the right child's fees.
2. In a second browser/incognito window, claim your `ADMIN001` code and confirm you land on the admin dashboard.
3. Log out, log back in with the password you set, and try "Continue with Google" too.
4. Only then, share the link with parents — everyone uses the **same code they already have**, just once, to set a password.

---

## How codes stay stable (unchanged)

Each family's code is generated once, from their name:
```
LAST NAME (first 3 letters) + FIRST NAME (first 3 letters) + a reserved number
e.g. ABDULAZEEZ, ABDULLAH → ABDABD1000
```
Saved permanently in `code_registry.json`, keyed to the student's name — not their row. Deleting or adding students elsewhere in the sheet never changes anyone else's code. If `code_registry.json` is ever lost, everyone would be issued fresh codes — keep a backup alongside the spreadsheet.

## Known limitation this version fixes

The previous version's README noted that `students_1st_term.json` shipped as a plain public file — anyone with dev tools could see every family's code and balance, not just their own. That's now fixed: fee data lives in Firestore, and `firestore.rules` enforces that a parent can only ever read their own linked child's record; only admins can read everyone's.
