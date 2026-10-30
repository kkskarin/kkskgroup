# KKSK Group

## KKSK Group: one sign-in, several apps

| Path | What | Supabase project |
| --- | --- | --- |
| `/` (`web/index.html`, `web/portal.js`) | KKSK Group home: sign-in, then a tile per app (straight into the app when a person has only one) | KKSK Group |
| `/maintenance/` | Maintenance & Civil: the division's bills, proformas, imports, cash vouchers and checking reports (entry only) | KKSK Group |
| `/renewable/` | Renewable Energy: the same for that division, plus Sales (energy billing for solar plants and windmills) | KKSK Group |
| `/bills-vouchers/` | Bills & Vouchers: its own entries, plus every division's bills and vouchers read-only (All Bills & Vouchers) | KKSK Group |
| `/accounts/` | Accounts: every division's accounting, ledgers, debit and credit notes, ledger books, companies | KKSK Group |
| `/finance/` | Finance: the only place payments are planned and recorded, for every division; advances, payables, salary, bank accounts, cheque and NEFT/RTGS templates | KKSK Group |
| `/approvals/` | Approvals: checking reports (bill, advance and voucher checking reports) and cash advances from every division, approved by admins or recorded by the financier on their behalf | KKSK Group |
| `/costing/` (`web/costing/index.html`) | W/B Costing: lot unloading, assortment piece by piece, cost sheets, costing report per origin (moved from a claude.ai artifact, started empty). Group sign-in first (Settings › Users › Apps › W/B Costing, `apps.wb`; admins always), then the app's own usernames and passwords; the first account is made by a Super Admin. Records live in `wb_*` collections of `app_docs`. **Grades** and **RH Sizes** are lookups (`wb_grades`, `wb_rhsizes`: code + order) managed under Reports › Grades / RH Sizes (add, reorder, delete); the Super Admin's first visit seeds the 15 standard RH sizes in order; a new cost sheet opens with every grade from the list in the list's order (an untouched new sheet keeps following the list), a saved sheet shows its grades in that order, a grade can't appear twice in a sheet (flagged while typing, refused on save), and a grade typed into a sheet joins the list when the sheet is saved; main tabs are Costing (the costing report; the app opens here), Unloading, Assortment, Cost Sheet, Data (Origins, RH Sizes, Grades, Users); on Unloading, Assortment and Cost Sheet the list on the left shows Drafts then Submitted (search filters both; a submitted assortment has a Costing button), and the action bar sits at the end of the form (fixed to the bottom on phones) with + New, Discard (drops unsaved changes, or clears the screen), Delete (saved entries), Save Draft and Submit; a load unloading starts with no size rows and the sizes are ticked (or a new one added inline, which joins the lookup). The header has **All Apps** (back to the KKSK Group home). Refreshing the page always asks for the app sign-in again. **Demo / Live**: admins, and users an admin switches Demo on for (Data › Users › Demo On/Off), get a switch; Demo keeps its own records (`wbdemo_*`) and its own unsent drafts, and the switch keeps the person signed in. **View As** (admins): see the app as another of its users; nothing can be saved meanwhile. **Safeguard**: signing in as the safeguard account (its username and password are kept only as PBKDF2 hashes in the page; the password is asked a second time) overwrites every record in `wb_` and `wbdemo_` `unloadings/assortments/costsheets/origins/grades/rhsizes` with a cooked-up stand-in of the same shape, removes it, and shuts the app behind a fake error page. Any costing admin restarts it with their own username and the safeguard password: leftovers are cooked and removed again first, the app reopens empty, and the standard RH sizes are re-seeded. Nothing real is restored. This reaches only what the app can write, not Supabase's backups | KKSK Group |
| `/production/` (`web/production/index.html`) | Production Planning (Live on the KKSK-Production tables; Demo sample for admins) | KKSK-Production, through the hand-over |
| `/inv/` (`web/inv/index.html`) | **Trial App**. Public: anyone with the address opens it and can change its data, no sign-in; not on the All Apps page. Tabs Raw to WB (Erode, Ambur, Ranipet), Tanned & Assorted (Grain, Split), WB Split - Ambur (Input, Output), each followed by Reports and Masters; the open one is kept in the address (`#tab/sub`). A place takes a day's stock position (today or the 6 days before, from a calendar): pieces at each stage (columns, from Masters, in order) for Domestic and Imports, with totals. Masters: each place's stages (add, rename, reorder, remove); Raw to WB starts with Rawhide, Liming / Tanning, Pickling, WB Fresh Lot, WW Fresh Lot. Reports: a pivot of where everything is on a chosen day (each place's latest entry on or before it), filtered by place, domestic/imports and stage, with rows and columns picked from place, stage and domestic/imports. Data in its own table `trial_docs` (migration 20261030170000), open to everyone | KKSK Group (own table) |

- **One page, five apps.** Maintenance, Renewable Energy, Accounts and Finance are all `web/bills/index.html`; `netlify.toml`
  serves it at each address and the address picks the app (`BV_APP`: mnt, re, acc, fin). `/bills/` (the old Bills & Vouchers)
  moves to `/maintenance/`. Every bill, report, proforma, voucher, payment, note and cash advance carries `div` (mnt or re;
  none means mnt). Maintenance and Renewable Energy each see only their own; Accounts and Finance see every division.
  **One home app per job.** Each job's steps appear only in its home app (`APP_STEPS`, and `app_portal()` in migration
  20261027120000): the division apps (Maintenance & Civil, Renewable Energy, Bills & Vouchers, and future ones) are for
  entering bills, proformas, imports and vouchers and their checking reports and cash advances (Renewable Energy also Sales);
  **Accounts** is the only place accounting happens (bills are never accounted while entered); **Approvals** the only place
  approvals happen (plus Slack's Approve); **Finance** the only place payments are planned and recorded, for every division
  including Renewable Energy, and the only place bank accounts, cheque and NEFT/RTGS templates and salary are kept (other
  apps only read them). A person with several jobs uses several apps; all share one database, so nothing is entered twice.
  An entry is changed only in the app it was made in. The header's **Apps** switcher lists the person's apps with what
  waits in each (division apps: their unfinished bills and anything sent back; Accounts: to account; Approvals: waiting
  for them; Finance: approved, not yet paid in full, and approved cash advances to hand over); its badge totals the other apps.
  **Core plus app-specific fields**: every bill and voucher has one core that Accounts, Approvals and Finance work from;
  a division app can add its own fields under `ext.<app>`, shown only there (`APP_EXT`, empty for now); Renewable Energy's
  is the cost centre (`ext.re.cc` / `ccT`; older entries' top-level `cc` still read).
  **Apps come with the role; divisions are the scope** (migration 20261028090000). Settings › Users has one switch,
  "Bills, Accounts, Finance & Approvals", then **Divisions** (Maintenance & Civil, Renewable Energy, Bills & Vouchers;
  `apps.mnt/re/bnv`, Maintenance & Civil on unless said otherwise): the divisions a person works for. Accounts opens for an
  Accountant (or Chief Accountant), Finance for a Financier (or Chief Accountant), Approvals for an Approver or Approval
  Recorder, with no ticks; a division app opens for entering in a ticked division (Sales ticks Renewable Energy by itself).
  At least one division is needed by Purchasers, Expenses Operators, Accountants, Financiers and Sales. In Accounts and
  Finance a person sees only their divisions' bills, vouchers, payments, notes and cash advances (`inDiv`); admins and a
  Chief Accountant see every division; Approvals is unaffected.
  **Approvers (the admins).** In Approvals, Checking Reports and Cash Advances open on **Assigned to me** (what names them,
  and anything naming nobody); "Assigned to <name>" or "Everyone's" shows the others'. Approving an item that names
  another approver asks **Approving as**: Myself, or **On behalf of <name>** (they approved it but couldn't in the app),
  saved as `onBehalf`, `behalfMode: "admin"`, `paperById/Name`, `behalfByName` and shown "Approved by Arin on behalf of
  Akheel". The approver on each entry is still a default the person entering can change.
  **Demo per person.** Settings › Users has a **Demo** switch on each person (`users.demoOk`); with it on they get the
  Demo / Live pill and choose. In Demo they practise the steps after their own (chain: Purchaser → Accountant → Approval →
  Financier): an Accountant also enters; a Financier also enters, accounts, approves (in an admin's name, chosen in the
  form; `behalfMode: "admin"`) and pays, with the apps for those steps opening for them in Demo. Real companies are shown;
  Demo users can't add companies, change ledgers or cheque templates (shared with Live); vendors and bank accounts made
  in Demo are Demo-only (`bankacct` is no longer shared, so Demo starts without bank accounts). Live never changes.
  **Chief Accountant** is no longer offered in the role list; whoever already has it keeps it.
  **Production Planning** is its own app again (tile back, address open). In KKSK Users it is a single tick (a new person
  starts as Floor Team); roles and plant are set in Production Planning's own Users tab.
  **Purchaser and Approver never go together** on one person (Users, sign-up requests, own role picker, profiles; per
  company, Approval with purchase steps is refused too).
  Accounts decides which divisions may use each ledger (Ledgers › Edit › Divisions that use it).
- **Workflow.** Every bill, voucher, proforma and import goes: data entry → accounting → approval → payment.
  Jobs: Purchaser (entry), Accountant (accounting), Approver (approval), Approval Recorder (records paper approvals),
  Expenses Operator (vouchers for other people), Financier (payment), Sales (energy billing); any mix may be held, except Approver with
  Approval Recorder. In Users each company has one tick per pair: **Bills & BCR**, **Vouchers & VCR**, **Proformas, Imports &
  ACR** (steps `bills`+`bcr`, `vouchers`+`vcr`, saved together; either half on an older record gives both). Checking reports are
  made only from the person's own bills and vouchers (and those of the profiles linked to their login, or vouchers they made as a
  Expenses Operator), and they see only those reports and vouchers. On the bill form GST shows as GST (CGST + SGST) or GST (IGST), from the vendor's and company's states.
  A Purchaser who is also the Accountant for a company accounts a bill as they record it (ledgers and TDS on the bill form);
  it skips Accounting but still goes to approval. The accountant "accounts" entries; only the Approver step "approves".
- **Approvals** happen only in the Approvals app, for admins and people with Approval. An Approver sees and approves only the
  checking reports and cash advances that name them; checking reports are made one per approver. An **Approval
  Recorder** records approvals already signed on paper: for every checking report and cash advance in their divisions (Maintenance &
  Civil with the Finance or Maintenance & Civil app, Renewable Energy with that app; every division if they have none of these),
  for companies where they hold the Approval Recorder step. They choose who signed (the named approver by default) and it is saved
  in that person's name, "recorded by" them. An Approval Recorder is never offered as an approver. Approving can be for the full
  amount or a part. No approving while viewing as someone.
- **Vouchers** are made by the person they belong to, or by a **Expenses Operator** for someone else (a person with a login, or a
  name from the saved list `vpeople/*`); the voucher counts as that person's (cash advance only for people with a login, and their
  checking report), and keeps who made it. **3 or fewer** vouchers of a person for a company go for approval without a checking
  report ("Send for approval"): they are printed one per page and signed. 4 or more go into a Voucher Checking Report.
- **TDS** is entered when an entry is accounted. The vendor is paid the total less TDS; the vendor statement and Ledger Statements
  show it. Checking reports and their PDFs don't.
- **Masters** (its own heading in every app with purchases or accounting, and Finance): Companies, Vendors, Ledgers; in
  Renewable Energy Companies, Consumers, PPA Rates, Vendors, Ledgers. One company list for the group (`companies/*`, logo required); each company lists the
  divisions that use it (`apps`) and keeps its own order per app (`orders`). A division app shows only its companies; Accounts and
  Finance see them all. Admins and the Accounts team (Accountant job, any app) add and edit companies; only admins deactivate one, and the database lets only admins delete a company (migration 20261016120000). Vendors (`apps`) and ledgers (`apps`) are kept apart by division the
  same way (none named means Maintenance & Civil); a vendor found by GSTIN from another division joins that division too.
- **Admins** do the same work as the Super Admin and can view as a Purchaser, Accountant or Financier. The Super Admin alone adds
  admins and edits the app. Admins can delete a person for good (Settings › Users › Delete): their login goes, their entries stay.
- **Vendor details have two keepers.** The accounting details (type, GSTIN, address, terms, opening balances) are the
  Accountant's; the payment details for cheques and NEFT / RTGS (bank, account number, IFSC, branch, account type,
  mobile) are the Financier's (Masters › Vendors in Finance). Each sees the other's part read-only, and a save writes
  only its own part (`vendors.bank` with `bankAt` / `bankBy` for the financier).
- **Voucher payees are identified by Aadhaar or PAN** (required; Aadhaar 12 digits, PAN like ABCDE1234F). It is kept
  with the name (`payees/*.idNo`, `idKind`) and on the voucher (`payeeIdNo`, `payeeIdKind`); a saved payee's number is
  shown, disabled, when picked again, and asked for when none is on file. A Cash Voucher has no address; a Self Invoice
  or Freight & Transport voucher still asks for it. The printed voucher shows the PAN, or the Aadhaar masked to its last
  four digits.
- **Vouchers print in the KKSK payment voucher format** (A5 landscape, 594.96 × 420 pt, `drawVoucher`). With the tax box
  (Freight & Transport, or a Self Invoice under RCM) the voucher sits at the top and the tax box, with Accounted by, below it;
  without it the voucher fills the page with the same margin all round and the description area takes the extra height.
- **Templates (Settings › Templates, Bills & Vouchers app, admins only)** set how the internal prints look: the checking
  reports (Bill, Advance, Voucher), the vendor statement and Ledger Statement (now also as a PDF), and the payment reports
  (Payables, Vendor Payables, Payment Plan, Transactions, the weekly / monthly / yearly report, Payments in a Period). A form
  with a live preview of the latest real document (all divisions; nothing is downloaded or marked printed): colours, table
  text size, logo and key facts on or off, every fixed label renamed or hidden (columns, totals, sign-off boxes, title
  words), signatures on checking reports, a footer note. Kept in `tpls/<doc>`; a checking report can also have
  `tpls/<doc>__<division>` (or `useDefault`). Without a template a document prints as standard. Vouchers keep their fixed
  format; cheques, NEFT / RTGS forms and Renewable Energy letterpads have their own templates. Hooks are in `pdfLook`
  (`doc.__tpl`, set by `newPdf(jsPDF, key, div)`).
- **Ask Claude on every template** (`aiTalk`): Settings › Templates, cheque templates and NEFT / RTGS forms have a box to
  say (type or speak) what to change; Claude sees the template as it prints and, when ticked or named in the request
  (“like the voucher”), the latest voucher or any internal print as a reference picture, or an attached sample. Its answer
  is checked (`ptClean`, `chqTalk`, `neftTalk`) and put in the editor to check and save; Undo steps back. The letterpad
  pages' own Claude box takes the same references.
- **GST and TDS (Masters › Ledgers › GST, TDS)**, kept by the accountant (or an admin) in `taxes/<id>`: TDS sections
  (`sec`, `nature`, `rate`, `rate2`, `ledName`) and GST ledgers (`name`, `order`; no rates). Each makes one ledger under
  Duties & Taxes (`ledgers/tax_<id>`), `allCos` (every company, also any added later) and every division, `locked`: shown in
  the Ledgers list but changed or removed only from GST or TDS. Tax ledgers are not offered as expense ledgers. The TDS
  sections are the ones offered when accounting; reverse charge offers 5, 12, 18, 28 and 40%. GST ledgers: CGST, SGST and
  IGST Input, Input (RCM) and Input - Ineligible (migration `20261028170000`); TDS started with the sections the app offered.
- **GST on a bill is spread over the GST ledgers when it is accounted**: tick one or more credit types (Input, ticked to start;
  Input (RCM); Input - Ineligible). Intrastate or interstate is decided from the vendor's and company's GSTIN state codes (not
  chosen; accounting waits if a code is missing). Intrastate each type is a row of CGST and SGST, always equal, with only CGST
  typed; interstate (or abroad) a row is IGST. The last row takes the balance, no row may be nil, and the rows add up to the
  bill's GST exactly (`gstLedgers` [{id, amt}], `gstSupply` intra / inter, `gstTypes`). The expense ledgers must also add up
  to the purchaser's taxable amount to the paisa; anything else is sent back. Union Territory tax (UTGST) is not offered:
  every company is registered in Tamil Nadu, and supplies from a UT are inter-state (IGST). GST posts to its ledgers in
  Ledger Statements (Duties & Taxes).
- **Bill files:** a bill back for editing (postponed or sent back) shows its kept file beside the form, as the accountant
  sees it. The viewer has a Browser view switch (remembered per device) for scans the app draws doubled or blurred.
- **GST through WhiteBooks** (GSP: BVM IT Consulting): the `gst-api` Edge Function holds the keys as secrets (`WB_BASE_URL`,
  default the sandbox `https://apisandbox.whitebooks.in`; `WB_EMAIL`; `WB_GST_CLIENT_ID`; `WB_GST_CLIENT_SECRET`) and is
  called by signed-in members through `window.bvGst` (`status`, `search`). Vendors › GSTIN has "Check on the GST portal":
  legal and trade name, status, type and address, with "Use This Name and Address". Sandbox finds only WhiteBooks' test
  GSTINs. Live: `WB_BASE_URL` is `https://api.whitebooks.in` (GST subscription only; e-Invoice and e-Way Bill not connected).
  - The portal's details are saved on the vendor as `gst` (status, type, constitution, e-invoice status, checkedAt) and
    trusted only for the vendor's current GSTIN (`vGst`). They are checked again in the background (`gstRefresh`) when older
    than 30 days, as the vendor's bills are entered or accounted.
  - Alerts (`gstAlerts`, `billAlerts`), shown on the bill form and at the top of the accounting view, and counted in the
    Accounting list: GSTIN cancelled or suspended; composition dealer charging GST; e-invoicing vendor whose bill has no IRN.
    None stops a bill, except that a composition dealer's GST can't be accounted (send it back).
  - Bills record the e-invoice's IRN, Ack No and Ack Date (`einv`), read by Claude when printed and editable on the bill form.
  - TDS: choosing a section fills the amount from its rate, rounded to the rupee; 194C takes 1% for a proprietorship,
    individual or HUF and 2% for others, from the vendor's constitution (`tdsRateFor`).
- **Bank Names** (Finance › Masters › Others, `banknames/*`, shared): one name per bank with its IFSC code (first 4 letters).
  Renaming one rewrites it on every bank account, cheque template and vendor (`bnForm`). A bank is added by itself
  (`bnEnsure`) when an IFSC of a new bank is saved on a company bank account or a vendor.
- **Bank accounts first:** a company bank account starts from its IFSC, which fills bank (from Bank Names), branch, city and
  branch address (Razorpay's free IFSC lookup, `ifscGet`). A cheque template's bank can only be one a company has an
  account with (`tplBankSelect`). Vendors' bank details: Bank is a pick from Bank Names; the IFSC fills it with branch and
  branch address.
- **New vendors on a bill:** as soon as the bill is read, its GSTIN is looked up on the GST portal (`cardGst`): the legal
  name and type fill in (editable), and if the portal's address differs from the bill's the purchaser picks one. The
  portal's details are saved with the vendor. Payment terms are required for every new vendor (bill, proforma, import,
  Add Vendor and the Excel upload). Check on the GST portal is for the accountant and admins only.
- **Who sees what in Accounts and Finance** (they span every division): Masters › Companies and Bank Accounts list only the
  person's own companies (admins see all); Vendors lists only vendors of the person's divisions.
- **Cash limits (Payment Entry):** cash to one person stays under ₹10,000 a day; Freight & Transport vouchers can be paid up
  to ₹30,000 in cash a day (`CASH_FREIGHT`, `payFreight`). Cheques and NEFT / RTGS have no limit.
- **Signatures.** Admins, purchasers, Expenses Operators, accountants, approvers and approval recorders sign once, with a
  finger, stylus or mouse in a 3 : 1 box (or a photo of a paper signature, whitened), before they can carry on; they can
  change it in Settings › Personalise. Kept in `sigs/<person id>` (`png`, trimmed to the ink on white; the same in Demo and
  Live). The voucher prints the preparer's in Prepared by, the accountant's in Accounted by and the approver's in Approved by
  (the one who signed on paper when an approval recorder entered it; the recorder's if the approver has none). Older entries
  print with whatever signatures their people have since added.
- **Vendors and ledgers are kept by the Accountant** (or an admin, also when viewing as them), in any app. A vendor is added from
  its first bill or proforma, as read, or by the accountant with Add Vendor on the Vendors tab; after that only the accountant changes its details. A bill can't be accounted until its
  vendor's details are complete (type, terms, address, valid GSTIN); its opening balance, entered by the accountant, approves the
  vendor and is needed before a checking report. Ledgers: the accountant adds, edits, imports and deletes (only if unused).
- **Access per app** is set on each person (Settings › Users › Apps): Maintenance, Renewable Energy, Accounts, Finance, Approvals (approvers and approval recorders), and a Production Planning
  role (Approver, Planner, Floor Team) with a region (Erode, Ambur, or both). Admins and Super Admins get every app.
  `app_portal()` in KKSK Group answers what a signed-in person may open.
- **Super Admins** are managed by Super Admins in Settings › Users › Super Admins. Someone added becomes a Super Admin
  once they sign in with that confirmed email. The last one cannot be removed.
- **KKSK-Production** keeps its Zoho functions and secrets as they are. People never sign in there: the
  `kksk-handover` Edge Function checks the KKSK Group sign-in (`app_portal`), keeps `pp_users` in step with the role
  and region given in KKSK Group, and returns a KKSK-Production session. Its source and the security changes made to
  that project are kept in `production/supabase/` (not linked to the GitHub integration; `supabase/` is KKSK Group).
- **Production Planning Live / Demo.** Live reads Zoho orders (`pp_orders`) and the `pp_*` tables and writes every change
  back (`web/production/live.js`): lots (numbers come from the database), lot data entries, approvals, stock moves,
  pooling, dispatch counted against orders, default rates and other WF1 work. Screens refresh when someone else saves.
  Admins and Super Admins can switch to Demo with the LIVE / DEMO pill: sample data kept in that browser only, never
  written to the database. Everyone else is always on Live.
- **Settings in every app**: Users, Change Log (admins) and Personalise (everyone); Companies and Data & Archive are in
  Accounts only. Users are the same KKSK Group people in both; Production Planning's Users tab sets who may use it,
  as what and for which plant, and can add a person with a Production Planning-only login. Personalise (picture, look,
  password) is saved per login in KKSK Group (`prefs/<uid>`) and shared by every app.

## Bills & Vouchers Accounting (`web/`)

The Bills & Vouchers app, moved off claude.ai so it runs as its own website on Supabase.

| Piece | Where |
| --- | --- |
| The app (unchanged apart from a few messages) | `web/index.html` |
| Stand-in for the claude.ai runtime: database, sign-in, Claude, downloads | `web/supabase-runtime.js` |
| Supabase project URL and publishable key | `web/config.js` |
| Sign-in screen styles | `web/auth.css` |
| Database tables, access rules | `supabase/migrations/` |
| Reading bills with Claude (Edge Function `ai-sample`) | `supabase/functions/ai-sample/` |

### How it works

The app was written against claude.ai's `window.claude.use(...)` calls. `supabase-runtime.js`
provides the same calls, so the app code did not need rewriting:

- **Data**: every record is a JSON document in `public.app_docs` (`path` such as `bills/b_123`).
  Pages see each other's changes live through Supabase Realtime, with a 30-second refresh as a fallback.
- **Sign-in**: email and password (Create account / Sign in / Forgot password), with an emailed
  one-time code as a fallback. First sign-in asks for a name.
- **Who can get in**: anyone can create an account with any email. Until an admin approves their
  request in the app, the database only shows them what the "Ask for Access" screen needs
  (company, location and department lists, and their own request). Approved = an active
  `users/<id>` record, an app admin, or a super admin.
- **Super admin**: addresses in `app_super_admins` (starts with `arin@kksk.in`), once that email is
  confirmed. Add a super admin only after the person has created their account.
- **Access rules** (same as the artifact had): only a super admin writes `admins/*`; nobody writes their own
  `users/<id>` record unless they are an admin; every other record is writable by any member.
- **Claude**: bill and proforma reading and the "tidy into clean English" boxes call the `ai-sample`
  Edge Function, which calls the Anthropic API with the server-side `ANTHROPIC_API_KEY` secret.
- **Backups** download as Excel files. (The old "also save to Google Drive" step is not available outside claude.ai.)

### What the app does for each role

- **Approver**: every bill, proforma, import and voucher names the admin who approves it (the super admin or an
  admin named under Settings › Users). It prints on the voucher and on the checking reports. A named admin sees only
  the work they approve; the super admin sees everything.
- **Admins** don't see the entry screens (Enter Bills, Proformas, Imports, Cash Vouchers, Accounting, Payment Entry)
  or draft checking reports, and don't ask for cash advances on anyone's behalf (switch to the person's profile
  instead). Reports › **Transactions** shows every item, the step it is at and who has it now, with a
  "Who has what open" summary; each view downloads as PDF or Excel. "View as" still opens a person's own screens.
- **Everyone else**: Transactions shows only their own work and that of profiles on their login.
- **Transactions** has Expenses and Payments, each narrowed to All, Bills, Proformas & Imports or Vouchers (cash
  advances paid count under Vouchers). Weekly and Monthly live here: pick All Dates, Weekly or Monthly (arrows move
  the period) and download that period's report.
- **Financier** (pays out only): two headings. Reports › **Payables** (unpaid bills and opening balances with the AP
  ageing by vendor) and **Payments** (Transactions showing payments only) cover every company they pay for; Payments › Payment Entry and
  **Advances** (each person's opening balance, advances paid, vouchers settled, cash on hand, the balance when an
  advance was asked for, and the Advance Ageing (AS Ageing) summary).
- **Filters** on Transactions and Payables are tick-box lists for companies, vendors, prepared by and
  approver, plus a from/to date range. A heading with a single tab shows no sub-tab bar.
- **Demo and Live**: admins switch with the DEMO / LIVE pill in the header (remembered per browser). Everyone else
  always works in Live. People, admins, access requests, preferences and signatures are one set (`NS_SHARED`;
  Demo shows the Live signature and never asks for or changes one). Masters (`NS_LAYER`: companies, vendors, ledgers,
  GST / TDS, locations, departments, regions, bank names, bank accounts, cheque templates, staff, payees, templates,
  balances, rates, solar consumers and rates) in Demo are Live's with Demo's own changes on top: Demo reads both and
  writes only to `demo__…` (the first change copies the Live record; a removal only hides it in Demo). Entries are kept
  apart by the `demo__` prefix. Nothing done in Demo reaches Live.
  **Approving in Demo:** everyone given Demo gets the Approvals app while in Demo and sees, as an admin would, only the
  checking reports and cash advances they raised or accounted (`demoInvolved`), approving them in an admin's name. The
  database returns these Demo-only apps as `app_portal().demo` (migration 20261030150000); the page and the home tiles use
  them only while the person's saved mode is Demo.
- **Bill files** are kept in the private `bill-files` Storage bucket (`live/` or `demo/` folder). The accountant sees
  the file beside the form with page, zoom, fit, rotate and drag. Bills typed in by hand can attach a file.
- **Settings** (everyone): Personalise (shared by every KKSK app, saved to the login) has light/dark/device mode, a colour, text size (only the text grows: every font size is calc(size × var(--ts)) set by web/textsize.js, so layouts stay and cells wrap; prints are unaffected), table density, a
  profile picture shown at the top, and Change Password. Admins also see Companies, Users, Change Log and Data &
  Archive there. PDFs and Excel always keep the standard KKSK format.
- **Admins** are added only by the Super Admin (Settings › Users › Add Admin), with a login or without one
  (named as approver only). The Super Admin can set an admin's password.
- **Logins made by an admin**: Settings › Users › Add Person With Login makes the email and password straight
  away (admin-users Edge Function), with roles and companies set before the person ever signs in. Editing a
  person with a login can set a new password (only the super admin can for admins).
- **Purchasers** must have a default approver (Settings › Users); it is filled in on their new work and can be changed.
- **Voucher numbers** are given automatically per company and financial year: `INTL-VOU001/10/26-27`.
- **Cash advances** approved go to the financier's **Payments › Advance Requests**, company by company, one row per
  person with all their approved advances clubbed. **Withdraw Cash** records any amount the financier withdraws for the
  company (date, self cheque / ATM / counter, reference); it is held by them (cashadv docs of kind `wd`, kept out of
  `caList`; `wdHeld`) and isn't tied to any advance. **Hand Over** gives a person the total of their advances in one go from
  that cash (needs enough held); **Pay Directly** pays the total to their account instead. Each handover marks all the
  person's advances received (`handId`), so it counts once in their balance. Withdrawals and handovers can be undone.
- **Returning cash**: a person with cash on hand presses **Return Cash** (Expenses › Cash Advance) for all or part of it. The
  amount is held back at once (it can't be settled by vouchers), and only the financier can mark it received (Advance
  Requests › Cash Being Returned; they may take less). It then comes off the person's balance and their oldest cash first.
  Stored in `cashadv/*` with `kind: "return"`, status `returning` → `returned`.
- **Chief Accountant** (job `chiefacct`): covers every company, now and later, with no companies or steps to choose
  in Users. They do the accounting everywhere (Accounting, Debit & Credit Notes, Ledger Statements, vendors and ledgers)
  and see the finance reports (Transactions, Payables, Advances) for all companies, but don't record payments (no
  Payment Entry or Advance Requests). The sign-in check (`app_portal`, migration 20261023180000) gives them the Accounts
  and Finance apps.
- **Show Activity** (Settings, admins and Chief Accountants, who see only the accounting and finance team:
  accountants, Chief Accountants and financiers; migration 20261024090000): one row per person with last active and last edit (date and time, "N/A"
  if none; from the admin-only `app_activity` database function), the work done in the period broken down by kind with
  its average time, and what is pending on them now with the oldest age. Only each job's own work counts: purchasers'
  bills, vouchers, proformas and imports entered (a bill's time, a proforma's final bill too, is bill date → uploaded); Expenses Operators' vouchers; accountants' and Chief Accountants' bills
  and vouchers accounted, vendors added or completed and items sent back to the purchaser (from each bill's and voucher's
  `acctLog`); anything sent back (by the accountant, or left out by the approver) also shows against the purchaser as
  "Sent back to them for correction" with who sent it and why; financiers' payments and cash advances handed over; approvers'
  and admins' reports and cash advances approved. Pending (not for purchasers): bills/vouchers to account and vendors
  still missing details (in their companies), approved bills to pay and cash to hand over, reports and cash advances to approve. Tapping a
  person opens their detail: totals, average, fastest and slowest time per kind, every pending item with its age, and
  every item done with the time it took. Period: today, 7/30/90 days, 12 months, all time, or chosen dates. People with
  nothing done and nothing pending are left out.
- **Accounting needs a complete vendor**: a bill is accounted (by the accountant, or in one go by someone who enters and
  accounts) only once its vendor has a type, payment terms, address, a valid GSTIN when registered, and the opening
  balance for the bill's company.
- **View as**: everything follows the person (their picture or initials, their look, their apps under All Apps,
  their profile in Personalise); only the view-as menu (switch person / back to admin) and Demo/Live stay the admin's. Personal settings (`prefs/<uid>`: look, picture, WhatsApp number) are readable only by the person and
  by admins (migration 20261024120000).
- **Bills & Vouchers** (`/bills-vouchers/`, key `bnv`): the group-wide expense app. **Expenses › All Bills & Vouchers**
  lists every bill and voucher of the person's companies from every division, read-only, with where each stands and
  "from <division>"; **Open in …** opens it in the app it was made in (`?go=b:<id>` / `?go=v:<id>`), where it is changed.
  It is also a division of its own (the app is given in Users to people who enter bills or vouchers). Bills, vouchers, checking reports and
  payments here are kept apart from Maintenance & Civil (records carry `div: "bnv"`; Accounts, Finance and Approvals see
  them with every division). On each bill and voucher the Expenses Operator picks **Prepared by**: themselves or a saved
  name (or a new one, saved for next time); the entry counts as that person's, with `madeBy` recording the Voucher
  Maker. A Expenses Operator enters bills wherever they make vouchers. Companies (and vendors, ledgers) must be ticked as
  used in Bills & Vouchers. Sign-in check: migration 20261024150000.
- **Cheque Templates and printing**: Masters › Cheque Templates (Finance only; admins and financiers)
  holds one template per bank's cheque layout in `chqtpl/*` (Demo layers its own changes on top): reference name, bank, a blank
  cheque scanned or photographed at any size (PDF, JPG or PNG; kept in storage under `cheques/`), where the cheque sits
  on the A4 page when printing (mm) and where the date (digit boxes or DD-MM-YYYY), payee, amount in words (two lines),
  amount in figures and an optional "A/c Payee" crossing go (mm from the cheque's top left), and the text size.
  **Scan clean-up** on upload (OpenCV.js, loaded only there): the cheque's four corners are found (outlines from edges, from
  the paper being brighter than its background, e.g. a scanner lid, even when the cheque touches the glass's edge, and from
  it being darker; the page's own colour, taken from the border, and everything that differs from it, which catches a pale tint on white; the most cheque-like, about 2.2 : 1, wins; a scan already cropped to the cheque is taken whole; if
  nothing is found it says so and Adjust Corners is used), the cheque is
  straightened (perspective) and cropped a hair inside its edges, turned landscape and, when Claude sees it upside down,
  turned round, then made clearer (one levels stretch for all colours, so the logo and tint keep their colours, and
  sharpened). Size: what a flat scan measures when that is a cheque's size, else 203 × 93 mm. The original stays as
  uploaded (`pad`), the cleaned cheque is a JPEG (`clean`, 12 px per mm) with the corners used (`corners`); **Adjust
  Corners** shows the original with the four corners to drag and applies them again. Templates with an older A4 scan
  keep working as before until a new scan is uploaded. Then Claude reads the cheque to place each field ("Find Fields
  Again" repeats it). A live
  preview draws a made-up payment on the scan, in black; fields can be dragged into place. Everything prints in black. In Payment Entry › Paid, a cheque payment has **Print Cheque**: pick the cheque
  book, check the payee, and download an A4 PDF with only the text at those places (or a test print with the scan
  behind). Print at 100%. The payment records when and with which template it was printed.
- **Bank accounts** (Masters › Bank Accounts, Finance only; admins and financiers; other apps read them): `bankacct/*` (shared by
  Demo and Live) with company, bank name, reference name, branch, city, account number, IFSC and the cheque numbers: first,
  last and last used (next = last used + 1; from 15 leaves left it asks for the next book's numbers, never a block; gaps
  are fine); one default account per company. **Bank names** are one lookup (`banknames/*`, shared, plus every name already
  used) for bank accounts and cheque templates, with "+ Add new bank". A **cheque template** is only a layout for a bank's
  cheques, not tied to an account: an account uses the template it picks, else the first one of its bank. Accounts saved
  before this keep the numbers their old cheque book template had until they are entered on the account.
- **Salary** (Payments › Salary, Finance; admins and financiers): each company's **staff list**
  (`staff/*`: name, a person or a firm, bank, branch, IFSC, account number, monthly salary, active) and the **monthly
  salary** (`salruns/<company>_<YYYY-MM>`), which opens filled in from the latest month before it (inactive staff left
  out; anyone on the list can be added) or else from the staff list. **Issue Cheque & Print Pack** takes the company's
  default bank account and its default cheque book (next number, can be changed; a used number is refused), records a
  cheque "Yourselves for NEFT" for the total (`cheques`, with `salRunId`) and a cheque payment (`transactions`, payee
  "Staff salary · Month YYYY", `salaryRun`), and downloads one PDF: the cheque, the covering letter (To the Branch Manager,
  bank, branch and city; "Request for our Staff Salary disbursal from our Account – Reg."; current account number; cheque
  number, date, amount in figures and words; credit as per the enclosed list; For the company, Authorised Signatory) on the
  RE letterpad when the company has one (else its name and address at the top), and "List of Staff – Salary for the Month
  of …" (S.No, name, bank, branch, IFSC, account number, salary, total). Once issued, the rows keep the details as printed.
  Cancelling the cheque puts the month back to draft so it can be issued again.
- **Payment Entry: Plan for Payment / Already Paid.** "To pay" opens on **Plan for Payment**: per company (its bank
  account and cheque book, defaults filled in), per payee (vendor, or voucher payee), every approved item by due date with
  a tick and the amount to pay now (part payments leave the rest). Per payee: Cheque, NEFT/RTGS or Cash, and A/c Payee
  (ticked per payment; always on for NEFT/RTGS). "Select all" and **Print Cheques for All Selected** give one cheque per
  payee, numbered on from each cheque book (editing one number renumbers the ones after it), one PDF with a page per cheque,
  and record the payments (`cheques/*` with number, date, payee, amount, A/c Payee, status; each payment carries
  `chequeId`, `bankAcctId`, `chequeTpl`; a vendor's payment is set against the ticked bills in `billAlloc`). NEFT/RTGS
  takes a cheque number too; Cash is recorded (under ₹10,000 a payee a day). **Already Paid** is the one-line entry for
  payments made outside the app: Cheque or NEFT/RTGS (cheque number), Net banking (transaction ID), Credit card, Cash
  (SWIFT for foreign currency). In Paid, a planned cheque has **Print Again** and **Cancel Cheque** (with a reason): the
  cheque and its payments are marked cancelled (kept, never counted) and the bills return to Plan for Payment.
- **NEFT / RTGS form** (inside each cheque template): the bank's own form, scanned at any size and printed on A4 (the scan
  scaled to fit from the top left; fields in mm on the A4 page). On upload Claude finds which of
  the listed fields it has and where (`NEFT_FIELDS` in `web/bills/index.html` is the standard list: date, amount
  in figures and words, cheque number, remitter name/account/address/phone/PAN, beneficiary name/account/IFSC/bank/
  branch/account type/mobile/address, purpose); fields can be typed in mm (with a box spacing for character boxes) or
  dragged on the preview, and test printed. Data comes from the payment, the company (name, address, phone; PAN from
  GSTIN), its bank account and the vendor's **Bank details** (Masters › Vendors). In Paid, a NEFT/RTGS payment's **NEFT /
  RTGS Form** button stays disabled, listing what is missing, until every field the form needs has data.
  **Two-line fields**: any NEFT / RTGS field can have a first-line width and a second line (across / down, or dragged on
  the preview); text that doesn't fit the first line goes on to the second (Claude also reads second lines, e.g. amount in
  words or an address). On the cheque, the amount in words and the payee can both run to a second line.
  Banks ask for different things, so each template also has **Extra fields this bank asks for** (`neft.extra`: name,
  and either "Same every time", typed in the template, e.g. a customer ID, or "Typed when printing", asked in a small
  dialog for each payment and kept on the cheque record as `neftExtra` for reprints). Claude adds any such field it finds
  on the form as "Typed when printing"; switch it to "Same every time" where that fits.
- **Company order**: only the super admin can reorder companies (Masters › Companies).
- **Slack approvals**: when a live checking report starts waiting or a cash advance is requested, the
  `approval-alert` Edge Function sends the named approver a Slack DM (found by their login email) with **Approve** and
  **Review in app** buttons. Approve (with a confirm step) goes to the `slack-approve` Edge Function, which checks
  Slack's signature, that the person tapping is that approver (same email), and that the request is still in the same
  wait, then approves the full amount as the app does (bill reports: every bill in full; advance reports: the
  instalment; vouchers: every voucher; cash advances: the amount asked), logs "Approved on Slack" and an audit entry,
  and turns the message into "✅ approved". Part approvals and send-backs stay in the app (Review opens
  `/approvals/?go=…` at that request's form). The Slack app is `slack/manifest.yml`; secrets `SLACK_BOT_TOKEN` and
  `SLACK_SIGNING_SECRET`.
- **WhatsApp approval alerts** (through Sent): admins and approvers enter their WhatsApp number in Settings › Personalise
  (kept in their own `prefs/<uid>`, readable only by them and the server). When a live checking report starts waiting
  (stage `generated`) or a cash advance is requested, a database trigger calls the `approval-alert` Edge Function with
  the record's path; it reads the record itself and sends the Sent template `approval_request` (variables `name`,
  `item`, `details`, and `go` for its Approve button `https://kkskgroup.netlify.app/approvals/?go={{go}}`, which opens
  that request's approval form once signed in) to the approver named on it (nothing is submitted without one). Each wait is sent once
  (`app_alerts_sent`); Demo records never alert. Needs the Edge Function secret `SENT_API_KEY`; optional
  `SENT_TEMPLATE`, `SENT_CHANNEL` (default `whatsapp`).
- **Bills paid from a cash advance**: like vouchers, a tax bill (INR only) can say "Yes, I paid it from my cash advance"
  (`bills.settle`). The question shows on bills and vouchers only when the preparer holds the cash step for that company or
  has cash on hand; it can't exceed the cash on hand. Once its checking report is approved, the approved amount counts as
  a payment to the vendor (mode "From cash advance", derived, not stored) and comes off the preparer's cash; it is never
  listed in Payment Entry or Payables. Undoing the approval undoes both.
- **Ledgers and vendors** can be uploaded from Excel (Download template / Upload Excel on their pages). Rows are
  checked, exact duplicates skipped, and every row's result is listed. Ledgers are chosen by hand on bills.
- Every report has an **Excel** download, formatted in the KKSK colours.

### Setup checklist

1. **Anthropic API key**: Supabase dashboard → Edge Functions → Secrets → add `ANTHROPIC_API_KEY`
   (a key created inside a workspace; for a key with no workspace, also add `ANTHROPIC_WORKSPACE_ID`).
   Until then, bills are entered by hand and the app says reading with Claude isn't set up.
2. **Host the `web/` folder** on any static host, no build step. For example, connect this repository to
   Cloudflare Pages, Netlify or Vercel and set the output/publish directory to `web`.
   The live site (https://kkskgroup.netlify.app) deploys from this branch on every push; each production deploy
   uses Netlify credits. Put `[skip netlify]` in a commit message to push without deploying.
3. **Auth URLs**: Supabase dashboard → Authentication → URL Configuration: set *Site URL* to the site's
   address and add it under *Redirect URLs*, so emailed sign-in links come back to the app.
4. **Sign-in email with a code (optional)**: Authentication → Emails → *Magic Link* template: add `{{ .Token }}`
   so people can type the 6-digit code instead of clicking the link.
5. **Email sending (needed for open sign-up)**: Supabase's built-in email sends only a few emails an hour
   and only to the project's team members, so new accounts can't receive their confirmation or
   password-reset emails. Set up custom SMTP under Authentication → Emails → SMTP Settings.

### Managing access (SQL editor)

```sql
-- add another super admin (after they have created an account)
insert into public.app_super_admins (email) values ('someone@kksk.in');
```


### Paying vendors (from 10 Oct 2026)

- **No TDS.** Bills and vouchers count at their full total; the accountant approves with ledgers only.
- **Approve bill by bill.** On a Bill Checking Report the admin presses Approve for Payment: untick a bill to send it back to the
  purchaser, or lower its amount to approve part of it (a note to the purchaser is then needed). The unapproved rest
  waits with the purchaser, who may put it in a new Bill Checking Report. Advance Checking Reports can be approved in part the same way.
- **No Payment Planning.** Whatever the admin approves goes straight to the financier's Payment Entry, by due date:
  overdue and the next 7 days, then 1–2, 2–3, 3–4 weeks and later. Opening balances and credit notes are due now.
  A payment on a vendor line is set against that line's bills (`billAlloc` on the transaction).
- **Debit & Credit Notes** (Accounts): a debit note takes off what is owed (optionally against one bill), a credit
  note adds to it. Stored in `notes/`.
- **Vendor statement** (Vendors › View Statement, and the PDF): Date, Particulars (Bill, Payment, Discount, Debit
  Note, Credit Note, Voucher), Reference No., Payable, Paid and the running balance.

### Renewable Energy › Sales (energy billing, from 12 Oct 2026)

Monthly bills of supply from a solar plant or windmill to each consumer it supplies, as set out in the
"Solar Invoicing & Finance App" specification. Each generator is marked Solar plant or Windmill; that decides which HT bill
row (SOLAR or WIND) is billed and the wording on the bill.

- **Companies** (Masters; admins, and in Renewable Energy also people given "Can add and edit companies in Renewable
  Energy" in Users, at present Prabhu; a company they add is put on their own user record with the steps they hold on
  their other companies, never approving, through `claim_created_company()`): each Renewable Energy company has a generator type (solar or windmill), its
  capacity in MW (AC for solar; the DC figure is worked out as panels × capacity per panel), and its generator HTSCs
  (transformers), each with a site (printed on the invoice), a **location** (a district, from the Locations list) and a
  **region** (an area of that district, `regions/*` `{name, locId}`, shared; the list is filtered by the location; both are
  added from the dropdown's "+ Add new", typed once), and either its inverters, each with its **SEI ID**, with the solar
  panels under each inverter (make, number, kW per panel), or its windmills, each with its **WEG ID** (make, capacity); at
  least one HTSC finishes setting it up. Every WEG / SEI ID is required and belongs to one transformer only (checked across
  companies). Makes typed before are offered
  again (separate lists for windmills, inverters and panels). The invoice is set up as **pages** (by default Covering letter, Original for Recipient,
  Triplicate for Supplier; pages can be added, removed, renamed and reordered). Each page has three parts, side by side:
  (1) the wording, in a box the size of the space inside the margins and laid over the letterpad, with a toolbar (undo/redo,
  font, size, heading styles, bold, italic, underline, strikethrough, subscript, superscript, text and highlight colour,
  alignment, lists, indent, horizontal line, tables with add/delete row and column, clear formatting) and an HTML view;
  (2) **Ask Claude**: type or speak (browser dictation, Indian English) what the page should say or look like, optionally
  with a picture or PDF of a page to follow; Claude rewrites the page's HTML, which replaces the wording and can be undone;
  (3) the page **as printed**, redrawn with sample figures a moment after every change. Field buttons ({Invoice No},
  {Consumer Name}, {Amounts Table}, {Net in Words}…) put a field at the cursor; fields are filled in for each bill. Nothing
  has a background of its own (the amounts table is drawn with lines only), so the letterpad's design shows through. An
  optional **letterpad** (an A4 portrait PDF with the logo, name, address, GSTIN and background) is put behind every page,
  with top, bottom, left and right margins in mm; the wording needs no margins of its own, and a page that runs longer than
  the space is shrunk to fit. Adding a letterpad takes the standard company heading off the pages. Scripts, forms, event
  handlers and outside links are removed from the HTML. Download Sample PDF gives the whole PDF with sample figures.
  Older companies' letter and footer wording are turned into pages.
- **Consumers** (one or more HTSCs, address, GSTIN, injection voltage, credit days) and **PPA Rates** (per consumer, for
  all their HTSCs, optionally per generator HTSC, from a month).
- **Monthly Billing**: choose the company and the month and upload all its documents at once: each generator HTSC's
  generation statement, energy allotment order and energy adjusted report, and, if you have them, the consumers' HT bills.
  Claude works out which is which and reads it (text PDFs as text, scans as images); each document is filed under its
  generator HTSC in `solar_months/<generator HTSC>_<YYYY-MM>` (an HT bill listing several of our HTSCs under each of them),
  with the files in the `bill-files` bucket under `<live|demo>/solar/<company>/<month>/`. Every file uploaded is kept, even one
  that can't be read or isn't used, and listed under Uploaded files from `solar_uploads` with what came of it. **Discard Uploads** deletes chosen files (or
  everything for the month) with what was read from them; not while a bill of supply is issued for the month.
- **Bill**: one bill of supply per consumer per company per month, with a row for each consumer HTSC and generator HTSC pair.
  Units = units adjusted in the energy adjusted report; A = units × PPA rate; B = the charges the allotment order puts on the
  consumer, wheeling = gross allotted × 0.49967, self-generation tax = units adjusted × ₹0.10; net = A − B, rounded.
  Deductions can be changed by hand on Review (noted on the checks).
- **Checks** (pass, check, or blocks the invoice): the generation statement, allotment order and adjusted report present,
  units and charges tie out with the generation statement, loss applied, units adjusted, consumer HTSC in Masters, rate
  present, low net (< 20% of A). The HT bill is only compared (units credited, wheeling and every other charge, consumer):
  a difference is a check to look at, never a blocker, and billing goes ahead without it.
- **Issue** (with Preview PDF before issuing): number SHORT-NNN-YY/YY (e.g. ARA-001-26/27), one series per company per financial year, suggested and editable when
  issuing but never one already used; the PDF holds the company's pages. An issued invoice is locked; cancel it (admin, with a
  reason) and issue a new one for corrections.
- **Banked and lapsed units**: the adjusted report is also read for the generator's units banked (windmills) and lapsed
  this month (its totals, else the consumers' figures, else units not adjusted: banked for a windmill, lapsed for solar).
  The Issue dialog shows them for each generator HTSC on the bill (windmill: banked and lapsed; solar: lapsed only), to
  correct before saving; they are kept on the invoice (`bl`) and on the month (`solar_months.bl`, which then wins over what
  was read). Not split to WEG / SEI IDs yet.
- **Invoices**: register, receipts with TDS under 194Q, ageing 0–30/31–60/61–90/90+, Excel.
- **Reports › P&L**: filters for financial year, calendar year, months, season (Winter Jan–Feb, Summer Mar–May, South-west
  monsoon Jun–Sep, North-east monsoon Oct–Dec), solar or windmill, companies, consumers and ledgers (C counts only the chosen
  ledgers' lines; a proforma or import has none until its bill); by company and month: net generated, units
  billed, A (energy), B (deductions), A − B, **C (expenses)** and what is left (A − B − C); the expenses itemised; deductions by
  charge; line loss by consumer; all to Excel. C is everything raised in the Renewable Energy app for that company in that
  month: submitted bills, proformas and imports until their final tax bill comes (then the bill counts), and cash vouchers;
  cash advances are not counted (the vouchers paid from them are). C is not split by consumer, so it is hidden while
  consumers are filtered.
- **Cost centres**: a company, its transformers and their WEG / SEI IDs. Every bill and voucher of a company with
  transformers asks "Where is this expense from?": the company in general, a transformer, or a WEG / SEI ID (its
  transformer is filled in by itself); saved as `cc` (`""`, `t:<HTSC>` or `u:<ID>`) and `ccT` (the transformer). Entries of
  other divisions (Maintenance & Civil, Bills & Vouchers) tagged to a transformer or ID count in the Renewable Energy P&L
  too. **P&L › Profit by cost centre** (same filters) shows A − B, C and profit by company, transformer, WEG / SEI ID,
  location or region. In the WEG / SEI ID view a transformer's income and the expenses on the transformer itself are
  shared over its windmills or inverters by kW (inverters: AC capacity); transformers roll up to region and location, and
  General expenses stay with the company on a row of their own. Excel has a sheet per view.
  **Where an expense is from is required** on Renewable Energy bills, vouchers, proformas and imports of a company with
  transformers: one or more rows (`ext.re.ccs` [{cc, ccT, amt}], first row also as `cc` / `ccT`) of General (`gen`), a
  transformer or a WEG / SEI ID (under headings). Several rows must add up to the total including GST; one row takes the
  whole. Each row counts as its own expense in the reports. Older entries with nothing chosen count as General.
- Tabs in Renewable Energy: Reports (Transactions, Payables, P&L), Sales (Monthly Billing, Invoices), Expenses
  (bills, proformas, imports, vouchers and their checking reports, cash advances), Masters (Companies, Consumers, PPA
  Rates, Vendors, Ledgers), Settings. Its accounting is in Accounts and its payments in Finance.
- Who may use it: the Renewable Energy app plus the Sales job for the generator's company.
  The division's own expenses go through its Bills and Cash Vouchers, so they reach Accounts like any other.
