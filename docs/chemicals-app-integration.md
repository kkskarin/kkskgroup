# Chemicals app → Bills & Vouchers: integration

The Chemicals app enters chemical purchases, proformas and imports and approves them (Akheel). Bills & Vouchers
(KKSK Group Supabase project) only **accounts** them (checks the ledger split sent, adds TDS, Tally) and **pays** them (Finance, Payment Entry).
Everything is exchanged through the shared table `public.app_docs` (`path` text, `data` jsonb). Write with the service
role from the Chemicals app's server side; never from a browser.

Dates are `YYYY-MM-DD`; times (`at`, `submittedAt`) are milliseconds since 1970; amounts are numbers in rupees with paise
(two decimals). Ids are your own, stable and unique: letters, digits, `_` and `-` only (for example `chm_b_000123`).

## 1. Companies (read only)

Read `companies/*`. Use the document id (for example `c_muy1ml0lx7m8`) as `companyId`. Tick **Chemicals** under
"Used in" for the companies chemicals are bought for (Settings › Companies in Bills & Vouchers).

## 2. Vendors — `vendors/<id>`

First look for an existing vendor with the same `gstin` (or, for overseas/unregistered, the same name) and reuse its id.
Only create one when there is none; add `"chm"` to its `apps` list when reusing.

| Field | Notes |
|---|---|
| `name` | Legal name as on the GST portal |
| `tradeName` | If different |
| `type` | `registered`, `unregistered`, `composition` or `overseas` |
| `gstin`, `pan` | `pan` is characters 3–12 of the GSTIN when registered |
| `country` | Overseas only |
| `address` | Full address, one line |
| `termDays` | Payment terms in days from the bill date (0–365) |
| `bank` | `{ name: account holder, acct, ifsc, bank, branch, type: "Current" or "Savings", phone }` |
| `apps` | Include `"chm"` |
| `active` | `true` |

## 3. Bills — `bills/<id>`

Write the bill when it is approved in the Chemicals app (one write; update the same id if it changes).

| Field | Notes |
|---|---|
| `div` | `"chm"` (always) |
| `status` | `"done"` |
| `acct` | `"pending"` (our accountant sets it to approved after linking ledgers and TDS) |
| `companyId`, `vendorId` | From sections 1 and 2 |
| `billNo`, `billDate` | As on the bill |
| `currency` | `"INR"` unless overseas |
| `taxable`, `gstAmt`, `total` | `gstAmt` = CGST + SGST or IGST |
| `termDays`, `dueDate` | Due date = bill date + terms |
| `supplyOf` | `Goods`, `Services` or `Composite` |
| `einv` | `{ irn, ackNo, ackDate }` when the bill has them |
| `narration` | One line on what was bought, no payment words |
| `ledgers` | **The ledger split, from the Chemicals app**: `[{ id, amt }]`, e.g. Tanning Chemicals 15,000 and ETP Chemicals 5,000. `id` is a ledger here: read `ledgers/*` and pick the one with that `name` whose `companyIds` include the bill's company (or `allCos: true`). Amounts are before GST and add up to `taxable`. A ledger that doesn't exist yet is created by our accountant first. Our accountant only reviews the split and adds TDS. |
| `file` | `{ path, name, type, size }` — upload the PDF/photo to Storage bucket `bill-files` at `live/bills/<id>/<file name>` |
| `preparedBy`, `preparedByName` | Who raised it (`preparedBy` may be your own user id) |
| `submittedAt`, `submittedBy` | When it was sent to us |
| `approverId`, `approverName` | Akheel: `u_817f85c5f4144941979f78a0f5561803`, `Akheel` |
| `advanceId` | The proforma/import (`advances/<id>`) this final bill belongs to, if any |
| `extAppr` | **The approval**: `{ amount, by, byName, at, note }` — `amount` approved for payment (the whole total, or less for part), `note` e.g. "pay after QC" |

Once our accountant accounts it, an approved Bill Checking Report is made automatically and the bill appears on the
financier's Payment Entry (approved amount, due date, vendor bank). Anything not approved (the rest of a part approval)
stays open. A discount agreed with the vendor goes in `extAppr.discount: { amount, reason }`: the accountant and the
financier see it, and the financier records it with the payment.

## 4. Proformas and imports — `advances/<id>`

| Field | Notes |
|---|---|
| `div` | `"chm"` |
| `kind` | `proforma` or `import` |
| `status` | `"active"` |
| `companyId`, `vendorId`, `piNo`, `piDate` | |
| `currency`, `total`, `gst` | `gst` for proformas only |
| `installments` | `[{ pct, when, days }]`, shares adding to 100; `when` is `receipt` (first one), `afterPi`, `beforeDispatch` or `afterDispatch`; `days` a whole number |
| `dispatchDate`, `dispatchConfirmed` | When known |
| `arrivalDate`, `igst`, `duty`, `transport`, `other` | Imports, when known |
| `narration`, `file` | As for bills (`live/advances/<id>/<file name>`) |
| `preparedByName`, `approverId`, `approverName`, `createdAt` | |
| `instAppr` | **The approvals**: `[{ inst, amount, by, byName, at, note }]`, `inst` = 0 for the first instalment |

Each approved instalment gets an approved Advance Checking Report automatically and goes to Payment Entry. Add an
entry to `instAppr` when the next instalment is approved; do not change entries already sent.

## 5. What comes back

Read `transactions/*` (`kind` `payment` or `discount`): `amount`, `date`, `mode`, `ref`, and `billAlloc`
(`{ <bill id>: amount }`) for bills or `advanceId` and `inst` for instalments. The approved reports made for you are
`reports/rx_<bill id>` and `reports/rx_<advance id>_<instalment>`.
