"""
migrate_to_firestore.py
------------------------
One-time script to import your EXISTING data (code_registry.json,
students_1st_term.json, and the 2nd/3rd term files once they exist)
into Firestore, so nobody's code changes and nothing is lost.

This is written to match your actual files exactly:

code_registry.json shape:
    { "LASTNAME|FIRSTNAME": {"code": "ABDABD1000", "index": 0, "name": "ABDULAZEEZ ABDULLAH"}, ... }

students_<term>.json shape, keyed by code:
    { "ABDABD1000": {
          "name": "...", "class": "...",
          "total_fee": 24550.0, "total_paid": 0.0, "balance": 24550.0,
          "details": { " AD_FORM": "0.0", "TUITION": "19500.0", ...,
                        "TOTAL FEE": "24550", "TOTAL PAID": "0", "BALANCE": "24550" }
      }, ... }

WHAT THIS DOES
- For every entry in code_registry.json: creates a students/{code} document
  (name, class) and a schoolCodes/{code} document (unclaimed).
- For every student in each students_*_term.json file: fills in that
  student's terms.termN data (totalFee, totalPaid, balance, and the
  itemised breakdown, with the redundant TOTAL FEE/TOTAL PAID/BALANCE/
  OUTSTANDING summary rows stripped out of the itemised list since
  they're already stored as totalFee/totalPaid/balance).
- Leaves everyone's existing code exactly as it is today — parents will
  still use their current code the first (and only) time they log in.

USAGE
    pip install firebase-admin --break-system-packages
    python3 migrate_to_firestore.py
"""

import json
import os
import sys
import firebase_admin
from firebase_admin import credentials, firestore

SERVICE_ACCOUNT_PATH = "serviceAccountKey.json"
CODE_REGISTRY_FILE = "code_registry.json"

# term file -> Firestore field name under students/{id}.terms
TERM_FILES = {
    "students_1st_term.json": "term1",
    "students_2nd_term.json": "term2",
    "students_3rd_term.json": "term3",
}

# These keys inside "details" just repeat total_fee/total_paid/balance —
# skip them in the itemised list so the parent dashboard doesn't show
# "Total Fee" twice. Matches the exclusion list the original index.html used.
SUMMARY_KEYS_TO_SKIP = {"LAST NAME", "FIRST NAME", "CLASS", "TOTAL FEE", "TOTAL PAID", "BALANCE"}


def title_case_label(raw_key):
    label = raw_key.replace("_", " ").strip()
    label = " ".join(label.split())  # collapse repeated spaces
    return label.title()


def load_json(path):
    if not os.path.exists(path):
        print(f"  (skipping — {path} not found in this folder)")
        return None
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main():
    if not os.path.exists(SERVICE_ACCOUNT_PATH):
        print(f"ERROR: {SERVICE_ACCOUNT_PATH} not found.")
        print("Download it from Firebase Console -> Project settings -> Service accounts")
        print("-> Generate new private key, save it next to this script with that exact name.")
        sys.exit(1)

    cred = credentials.Certificate(SERVICE_ACCOUNT_PATH)
    firebase_admin.initialize_app(cred)
    db = firestore.client()

    print("Loading code_registry.json ...")
    registry = load_json(CODE_REGISTRY_FILE)
    if registry is None:
        print("Can't continue without code_registry.json — put this script in the same")
        print("folder as your existing repo's files and try again.")
        sys.exit(1)

    print(f"Found {len(registry)} students in the registry.")

    batch = db.batch()
    batch_count = 0

    def commit_if_full():
        nonlocal batch, batch_count
        if batch_count >= 400:  # Firestore batch limit is 500; leave headroom
            batch.commit()
            batch = db.batch()
            batch_count = 0

    # 1) Students + codes, from code_registry.json
    for _key, entry in registry.items():
        code = entry["code"]
        name = entry.get("name", "Unknown")
        index = entry.get("index", 0)

        student_ref = db.collection("students").document(code)
        batch.set(student_ref, {
            "name": name,
            "class": "",  # filled in from term files below, if present
            "terms": {},
        }, merge=True)
        batch_count += 1
        commit_if_full()

        # 'index' is carried over so the admin dashboard's "issue a new
        # code" feature can keep counting up from the same sequence
        # update_data.py uses, instead of risking a collision.
        code_ref = db.collection("schoolCodes").document(code)
        batch.set(code_ref, {
            "studentId": code,
            "index": index,
            "claimed": False,
            "createdAt": firestore.SERVER_TIMESTAMP,
        }, merge=True)
        batch_count += 1
        commit_if_full()

    if batch_count > 0:
        batch.commit()
        batch = db.batch()
        batch_count = 0

    print(f"Imported {len(registry)} students + codes.")

    # 2) Term fee data
    for filename, term_field in TERM_FILES.items():
        print(f"Loading {filename} ...")
        term_data = load_json(filename)
        if term_data is None:
            continue

        count = 0
        for code, entry in term_data.items():
            # Only keep itemised rows with a real, positive value — mirrors
            # the original site's behaviour of hiding zero/blank fee lines.
            items = []
            for label, value in entry.get("details", {}).items():
                if label.strip().upper() in SUMMARY_KEYS_TO_SKIP:
                    continue
                amount = to_float(value)
                if amount > 0:
                    items.append({"label": title_case_label(label), "amount": amount})

            student_ref = db.collection("students").document(code)
            batch.set(student_ref, {
                "name": entry.get("name", ""),
                "class": entry.get("class", ""),
                "terms": {
                    term_field: {
                        "totalDue": to_float(entry.get("total_fee", 0)),
                        "totalPaid": to_float(entry.get("total_paid", 0)),
                        "balance": to_float(entry.get("balance", 0)),
                        "items": items,
                    }
                }
            }, merge=True)
            batch_count += 1
            count += 1
            commit_if_full()

        if batch_count > 0:
            batch.commit()
            batch = db.batch()
            batch_count = 0

        print(f"  -> wrote {term_field} data for {count} students.")

    print("\nDone. Every existing code is now in Firestore, unclaimed,")
    print("ready for parents to use for their first login.")
    print("\nNext: create at least one admin code manually so you can log in")
    print("as an admin the first time (see README 'Create your first admin code').")


if __name__ == "__main__":
    main()
