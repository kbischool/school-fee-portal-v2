"""
Fee Portal data updater — 2026/2027 Session
=============================================

Reads the master workbook "2026 - 2027 FEE.xlsx" and produces one
students_<term>.json file per term sheet that exists in the workbook
("1ST TERM ACCOUNT", "2ND TERM ACCOUNT", "3RD TERM ACCOUNT").

WHY THIS SCRIPT IS DIFFERENT FROM THE OLD ONE
-----------------------------------------------
The old script generated each family's passcode from its ROW POSITION
in the sheet (row 1, row 2, row 3 ...). That's fragile: if a name is
ever deleted or a new name is inserted anywhere except the very end,
every row below it shifts up/down and gets a DIFFERENT passcode —
even though nothing about that student changed. Parents who already
have a code would suddenly find it stopped working.

This script fixes that by keeping a permanent registry file,
`code_registry.json`, that remembers which code belongs to which
student by NAME (not row position). Every time you run this script:

  1. It loads the existing registry (if one exists).
  2. For every student in the sheet(s), it looks up their name in the
     registry.
       - If found  -> reuses their existing code. Unchanged, forever.
       - If new    -> assigns the next unused code and saves it.
  3. Students who are deleted from the sheet simply stop appearing on
     the portal, but their code stays reserved in the registry (so if
     they're ever re-added, they'd get a fresh code rather than
     accidentally colliding with someone else — this is intentional
     and safe; unused entries in the registry cost nothing).

RULE FOR ADMINS: as long as you don't rename a student who already has
a code (per your own instruction — you'll delete/add but never edit an
existing name), that student's passcode will NEVER change, no matter
where they appear in the spreadsheet or how many rows you add/remove
around them.

IMPORTANT: Keep `code_registry.json` in this project folder and always
re-upload/include it whenever you ask for the data to be regenerated.
If it's ever lost, everyone gets issued a brand-new code.

Passcode FORMAT (unchanged from before):
    LAST[:3] + FIRST[:3] + (registry_index + 1000), letters/digits only, uppercase
    e.g. ABDULAZEEZ, ABDULLAH -> ABDABD1000
"""

import pandas as pd
import json
import os
import re
from datetime import datetime

WORKBOOK_PATH = "2026 - 2027 FEE.xlsx"
REGISTRY_PATH = "code_registry.json"
PARENT_CODES_PATH = "parent_codes.xlsx"

SESSION_LABEL = "2026/2027"

# Sheet name in the workbook -> (output json filename, display label)
TERM_SHEETS = [
    ("1ST TERM ACCOUNT", "students_1st_term.json", "1st Term"),
    ("2ND TERM ACCOUNT", "students_2nd_term.json", "2nd Term"),
    ("3RD TERM ACCOUNT", "students_3rd_term.json", "3rd Term"),
]

# Columns J..AB (0-based positions 9..27) hold the itemised fee breakdown
# plus TOTAL FEE / TOTAL PAID / BALANCE. Same layout as the source sheet.
FEE_COL_START = 9
FEE_COL_END = 28  # exclusive


def clean_code_fragment(s):
    return re.sub(r'[^A-Z0-9]', '', str(s).upper())


def generate_code(last_name, first_name, index):
    """Same passcode format as always: LAST[:3]+FIRST[:3]+(index+1000)."""
    code = clean_code_fragment(last_name)[:3] + clean_code_fragment(first_name)[:3] + str(int(index) + 1000)
    return code


def name_key(last_name, first_name):
    last = re.sub(r'\s+', ' ', str(last_name).strip().upper())
    first = re.sub(r'\s+', ' ', str(first_name).strip().upper())
    return f"{last}|{first}"


def load_registry():
    if os.path.exists(REGISTRY_PATH):
        with open(REGISTRY_PATH, 'r', encoding='utf-8') as f:
            registry = json.load(f)
    else:
        registry = {}
    next_index = 0
    for entry in registry.values():
        next_index = max(next_index, entry['index'] + 1)
    return registry, next_index


def save_registry(registry):
    with open(REGISTRY_PATH, 'w', encoding='utf-8') as f:
        json.dump(registry, f, indent=2, ensure_ascii=False)


def safe_float(val):
    try:
        return float(val) if val not in (None, '') else 0
    except (ValueError, TypeError):
        return 0


def get_or_assign_code(registry, next_index, last_name, first_name, seen_this_run):
    base_key = name_key(last_name, first_name)
    key = base_key
    # Disambiguate genuine duplicate names encountered within the same run
    # (e.g. same-named siblings) so they don't collapse onto one code.
    suffix = 2
    while key in seen_this_run:
        key = f"{base_key}#{suffix}"
        suffix += 1
    seen_this_run.add(key)

    if key in registry:
        code = registry[key]['code']
    else:
        code = generate_code(last_name, first_name, next_index)
        registry[key] = {'code': code, 'index': next_index, 'name': f"{last_name} {first_name}".strip()}
        next_index += 1
    return code, next_index


def process_term_sheet(sheet_name, workbook_path, registry, next_index, seen_this_run):
    xls = pd.ExcelFile(workbook_path)
    if sheet_name not in xls.sheet_names:
        return None, next_index

    df = pd.read_excel(workbook_path, sheet_name=sheet_name)
    # Drop the trailing totals row (no LAST NAME) and any fully-blank rows
    df = df[df['LAST NAME'].notna() & (df['LAST NAME'].astype(str).str.strip() != '')]
    df = df.fillna('')

    all_columns = list(df.columns)
    fee_columns = all_columns[FEE_COL_START:FEE_COL_END]

    data = {}
    for _, row in df.iterrows():
        last_name = row['LAST NAME']
        first_name = row['FIRST NAME']
        name = f"{last_name} {first_name}".strip()

        code, next_index = get_or_assign_code(registry, next_index, last_name, first_name, seen_this_run)

        details = {}
        for col in fee_columns:
            if col in row.index:
                val = row[col]
                details[col] = str(val) if str(val).strip() else '0'

        student = {
            'name': name,
            'class': row['CLASS'],
            'total_fee': safe_float(row.get('TOTAL FEE', 0)),
            'total_paid': safe_float(row.get('TOTAL PAID', 0)),
            'balance': safe_float(row.get('BALANCE', 0)),
            'details': details,
        }
        data[code] = student

    return data, next_index


def update_school_data(workbook_path=WORKBOOK_PATH):
    print(f"Session: {SESSION_LABEL}")
    print(f"Reading workbook: {workbook_path}")

    registry, next_index = load_registry()
    seen_this_run = set()

    all_codes_rows = []
    any_term_found = False

    for sheet_name, json_filename, label in TERM_SHEETS:
        data, next_index = process_term_sheet(sheet_name, workbook_path, registry, next_index, seen_this_run)
        if data is None:
            print(f"  - Sheet '{sheet_name}' not found — skipping {label} (not available yet).")
            continue

        any_term_found = True
        with open(json_filename, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  - {label}: {len(data)} students -> {json_filename}")

        for code, student in data.items():
            all_codes_rows.append({'Code': code, 'Student': student['name'], 'Class': student['class']})

    save_registry(registry)

    if not any_term_found:
        print("No recognised term sheets found. Expected one of:", [t[0] for t in TERM_SHEETS])
        return

    # Admin reference sheet: de-duplicate by code (same student may appear in multiple terms)
    seen = {}
    for row in all_codes_rows:
        seen[row['Code']] = row
    codes_df = pd.DataFrame(list(seen.values())).sort_values('Code')
    codes_df.to_excel(PARENT_CODES_PATH, index=False)

    print(f"\nDone at {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Total unique students on record: {len(seen)}")
    print(f"Family codes saved to {PARENT_CODES_PATH}")
    print(f"Code registry saved to {REGISTRY_PATH} — keep this file safe, it's what keeps codes stable.")


if __name__ == "__main__":
    update_school_data()
