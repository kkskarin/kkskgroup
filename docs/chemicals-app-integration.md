# Chemicals app → KKSK Bills & Vouchers: integration brief

Paste this whole file into Claude when building the Chemicals app's link to Bills & Vouchers.

## What this is

The Chemicals app enters chemical purchases, proformas and imports and approves them (Akheena). Her approval is
final. KKSK Bills & Vouchers (same Supabase project) only **accounts** them (checks the ledger split, adds TDS,
exports to Tally) and **pays** them (Finance, Payment Entry). Nothing is approved again on our side.

## Where

- Supabase project: **KKSK Group**, ref `uqjirmofridjuykeemml`, URL `https://uqjirmofridjuykeemml.supabase.co`
  (region ap-southeast-2).
- All records live in one table, `public.app_docs`:
  - `path` text, primary key, `"<collection>/<id>"` (e.g. `bills/chm_b_000123`)
  - `data` jsonb: the record
  - `collection`, `doc_id`: generated from `path`; don't write them
  - `updated_at`, `updated_by`: filled in automatically
- Write from the Chemicals app's **server side with the service role key** (Supabase dashboard › Project Settings ›
  API). Never put that key in a browser or mobile app. Upsert on `path`:
  `insert into app_docs (path, data) values ($1, $2) on conflict (path) do update set data = excluded.data`
  (or `supabase.from('app_docs').upsert({ path, data })`).
- Files go to Storage bucket **`bill-files`** (private; PDF, JPG, PNG or WebP, max 25 MB):
  - bills: `live/bills/<bill id>/<file name>`
  - proformas and imports: `live/advances/<advance id>/<file name>`
- Bills & Vouchers picks up changes to `app_docs` by itself; nothing else needs calling.

Formats:
- Dates `YYYY-MM-DD`.
- Moments (`at`, `submittedAt`, `createdAt`) are milliseconds since 1970 (JavaScript `Date.now()`).
- Amounts are numbers in rupees with paise, 2 decimals.
- Your ids: letters, digits, `_` and `-` only, stable and unique, prefixed `chm_` (e.g. `chm_b_000123`, `chm_pi_000045`,
  `chm_v_000012`).

## IDs you need

**Akheena (approver):** `u_817f85c5f4144941979f78a0f5561803`, name `Akheel` as saved in our users. Use this for
`approverId` and approvals' `by`.

**Division:** `"chm"`, on every bill and advance.

**Companies** (`companyId`); read live from `companies/*` too:

| Company | Short | GSTIN | companyId |
|---|---|---|---|
| K K S K International LLP | INTL | 33AANFK0294K1Z3 | `c_muy1ml0lx7m8` |
| K K S K Hides Pvt. Ltd. | HPL | 33AACCK2368J1ZJ | `c_muyh6uz6wghz` |
| K K S K Tanning Co. Pvt. Ltd. | TCPL | 33AABCK5734B1Z1 | `c_muyhc4n3kbb6` |
| K K S K Industries Pvt. Ltd. | IPL | 33AACCK2352A1ZA | `c_muyhgbstt6uf` |
| Raswi Industries Pvt. Ltd. | RIPL | 33AADCR8938C1ZE | `c_mvt9rludkiq4` |
| TARS Creations Pvt. Ltd. | TARS | 33AAOCA5854B1ZT | `c_mvtdklasejzu` |
| ARA Holidays Pvt. Ltd. | SITARE | 33ABACA8497M1Z5 | `c_mvw01y3lnwdq` |

**Ledgers** (`ledgers/*`): one ledger record can serve several companies (`companyIds`, or `allCos: true`):

| Ledger | ledger id | Companies |
|---|---|---|
| Purchase of ETP Chemicals | `lg_4832ed36525d` | INTL, HPL, TCPL, IPL |
| Lorry Freight - Chemical | `lg_6d971dc5d8d4` | INTL, HPL, TCPL, IPL |
| Chemical Testing Expenses | `lg_84dc5e53fdae` | INTL, HPL, TCPL, IPL |
| Tanning Chemicals | *not created yet: ask our accountant* | |

Look ledgers up by `data->>'name'`, with the bill's `companyId` in `data->'companyIds'` (or `data->>'allCos' = 'true'`).
Never create ledgers yourself; ask us.

**Vendors** (`vendors/*`): reuse an existing vendor with the same `gstin` (or, for overseas/unregistered, the same
name). Read them first.

## 1. Vendors: `vendors/<id>`

Create one only when no vendor matches; when reusing, add `"chm"` to its `apps`.

```json
{
  "name": "Legal Name As On GST Portal",
  "tradeName": "Trade name if different",
  "type": "registered",
  "gstin": "33AAAAA0000A1Z5",
  "pan": "AAAAA0000A",
  "country": "",
  "address": "Full address in one line",
  "termDays": 30,
  "bank": { "name": "Account holder", "acct": "123456789012", "ifsc": "HDFC0001234", "bank": "HDFC Bank", "branch": "Ambur", "type": "Current", "phone": "" },
  "apps": ["chm"],
  "active": true
}
```

- `type` is one of `registered`, `unregistered`, `composition` or `overseas`. Overseas vendors also need `country`.
- `pan` is characters 3–12 of the GSTIN.
- Bank `type` is one of `Current`, `Savings`, `Cash Credit` or `Overdraft`.

## 2. Bills: `bills/<id>`

Write the bill once it is approved in the Chemicals app. To change it, update the same id.

```json
{
  "div": "chm",
  "status": "done",
  "acct": "pending",
  "companyId": "c_muyhc4n3kbb6",
  "vendorId": "v_xxxxxxxx",
  "billNo": "INV/2026/0451",
  "billDate": "2026-10-28",
  "currency": "INR",
  "taxable": 20000.00,
  "gstAmt": 3600.00,
  "total": 23600.00,
  "termDays": 30,
  "dueDate": "2026-11-27",
  "supplyOf": "Goods",
  "einv": { "irn": "…64 characters…", "ackNo": "1123…", "ackDate": "2026-10-28" },
  "narration": "Sodium sulphide 1,000 kg and lime 2,000 kg for tannery.",
  "ledgers": [ { "id": "<Tanning Chemicals ledger id>", "amt": 15000.00 }, { "id": "lg_4832ed36525d", "amt": 5000.00 } ],
  "file": { "path": "live/bills/chm_b_000123/INV-0451.pdf", "name": "INV-0451.pdf", "type": "application/pdf", "size": 182345 },
  "preparedBy": "chm_user_7",
  "preparedByName": "Name of who raised it",
  "submittedAt": 1793431251736,
  "submittedBy": "chm_user_7",
  "approverId": "u_817f85c5f4144941979f78a0f5561803",
  "approverName": "Akheel",
  "advanceId": null,
  "extAppr": {
    "amount": 23600.00,
    "by": "u_817f85c5f4144941979f78a0f5561803",
    "byName": "Akheena",
    "at": 1793431251736,
    "note": "Pay after QC",
    "discount": { "amount": 472.00, "reason": "2% if paid by 10-Nov" }
  }
}
```

- **`status` and `acct`:** always `"done"` and `"pending"`. Our accountant sets `acct` to approved after checking the
  ledgers and adding TDS.
- **Tax amounts:** `gstAmt` is CGST + SGST, or IGST.
- **`dueDate`:** `billDate` + `termDays`.
- **`supplyOf`:** one of `Goods`, `Services` or `Composite`.
- **`einv`:** only when the bill has an e-invoice.
- **`narration`:** one line on what was bought. No payment words.
- **`ledgers` (the ledger split from your app):**
  - Amounts are before GST and must add up to `taxable`.
  - GST ledgers and TDS are added by us.
- **`advanceId`:** set it when this is the final bill of a proforma or import: `advances/<id>`.
- **`extAppr` (the final approval):**
  - `amount`: the whole total, or less if only part is to be paid now. The rest stays open.
  - `note`: optional.
  - `discount`: optional. The financier records it with the payment.

Once our accountant accounts the bill, an approved Bill Checking Report `reports/rx_<bill id>` is made automatically. The
bill then shows on the financier's Payment Entry with the approved amount, due date and vendor bank.

## 3. Proformas and imports: `advances/<id>`

```json
{
  "div": "chm",
  "kind": "proforma",
  "status": "active",
  "companyId": "c_muyhc4n3kbb6",
  "vendorId": "v_xxxxxxxx",
  "piNo": "PI-2026-88",
  "piDate": "2026-10-20",
  "currency": "INR",
  "total": 118000.00,
  "gst": 18000.00,
  "installments": [ { "pct": 30, "when": "receipt", "days": 0 }, { "pct": 70, "when": "beforeDispatch", "days": 5 } ],
  "dispatchDate": "2026-11-15",
  "dispatchConfirmed": false,
  "narration": "Chrome tanning salt 10 MT.",
  "file": { "path": "live/advances/chm_pi_000045/PI-88.pdf", "name": "PI-88.pdf", "type": "application/pdf", "size": 90211 },
  "preparedByName": "Name of who raised it",
  "approverId": "u_817f85c5f4144941979f78a0f5561803",
  "approverName": "Akheel",
  "createdAt": 1793431251736,
  "instAppr": [ { "inst": 0, "amount": 35400.00, "by": "u_817f85c5f4144941979f78a0f5561803", "byName": "Akheena", "at": 1793431251736, "note": "" } ]
}
```

- **`kind`:** `proforma` or `import`.
- **`gst`:** proformas only.
- **Imports also send:** `currency` (e.g. `USD`), plus `arrivalDate`, `igst`, `duty`, `transport` and `other` when known.
- **`installments`:**
  - The `pct` values add up to 100.
  - `when` is one of: `receipt` (always the first instalment), `afterPi`, `beforeDispatch` or `afterDispatch`.
  - `days` is a whole number.
- **`instAppr` (the final approvals):**
  - `inst` is 0 for the first instalment.
  - Add an entry each time the next instalment is approved, and never change entries already sent.
  - Each entry becomes an approved Advance Checking Report `reports/rx_<advance id>_<inst>` and goes to Payment Entry.

## 4. What comes back (read only)

`transactions/*` are the payments and discounts recorded by the financier. Fields:
- `kind`: `payment` or `discount`
- `amount`, `date`, `mode`, `ref`
- `billAlloc`: `{ "<bill id>": amount }` for bills
- `advanceId` and `inst` for instalments

The approved reports made for you are `reports/rx_<bill id>` and `reports/rx_<advance id>_<inst>`.

## Rules

- Only write `vendors/*`, `bills/*` and `advances/*` records that carry `div: "chm"`, plus files under
  `live/bills/` and `live/advances/` in `bill-files`.
- Never write `reports/*`, `transactions/*`, `ledgers/*`, `companies/*`, `users/*` or `admins/*`.
- Don't delete anything. To cancel, tell us.
- Never paste or commit the service role key.
