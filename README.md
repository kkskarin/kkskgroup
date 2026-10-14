# KKSK Group

## KKSK Group: one sign-in, several apps

| Path | What | Supabase project |
| --- | --- | --- |
| `/` (`web/index.html`, `web/portal.js`) | KKSK Group home: sign-in, then a tile per app (straight into the app when a person has only one) | KKSK Group |
| `/maintenance/` | Maintenance & Civil: the division's bills, proformas, imports, cash vouchers and checking reports | KKSK Group |
| `/renewable/` | Renewable Energy: the same for that division, plus its own Payment Entry and energy billing for solar plants and windmills | KKSK Group |
| `/accounts/` | Accounts: every division's accounting, ledgers, debit and credit notes, ledger books, companies | KKSK Group |
| `/finance/` | Finance: Payment Entry and advances, payables | KKSK Group |
| `/approvals/` | Approvals: checking reports (bill, advance and voucher checking reports) and cash advances from every division, approved by admins or recorded by the financier on their behalf | KKSK Group |
| `/production/` (`web/production/index.html`) | Production Planning (Live on the KKSK-Production tables; Demo sample for admins) | KKSK-Production, through the hand-over |

- **One page, five apps.** Maintenance, Renewable Energy, Accounts and Finance are all `web/bills/index.html`; `netlify.toml`
  serves it at each address and the address picks the app (`BV_APP`: mnt, re, acc, fin). `/bills/` (the old Bills & Vouchers)
  moves to `/maintenance/`. Every bill, report, proforma, voucher, payment, note and cash advance carries `div` (mnt or re;
  none means mnt). Maintenance and Renewable Energy each see only their own; Accounts and Finance see every division.
  **The app decides the scope, a person's jobs decide the tabs.** Every app has the same headings in the same order (Reports,
  [Sales,] Expenses, Accounts, Payments, Masters, Settings); a division app (Maintenance & Civil, Renewable Energy) holds all of that
  division's work for whoever does it there (so a Renewable Energy purchaser + accountant + financier works only in that app);
  Accounts is accounting for every division and Finance is paying for every division.
  Accounts decides which divisions may use each ledger (Ledgers › Edit › Divisions that use it).
- **Workflow.** Every bill, voucher, proforma and import goes: data entry → accounting → approval → payment.
  Jobs: Purchaser (entry), Accountant (accounting), Approver (approval), Approval Recorder (records paper approvals),
  Voucher Maker (vouchers for other people), Financier (payment), Sales (energy billing); any mix may be held, except Approver with
  Approval Recorder. On the bill form GST shows as GST (CGST + SGST) or GST (IGST), from the vendor's and company's states.
  A Purchaser who is also the Accountant for a company accounts a bill as they record it (ledgers and TDS on the bill form);
  it skips Accounting but still goes to approval. The accountant "accounts" entries; only the Approver step "approves".
- **Approvals** happen only in the Approvals app, for admins and people with Approval. An Approver sees and approves only the
  checking reports and cash advances that name them; checking reports are made one per approver. An **Approval
  Recorder** records approvals already signed on paper: for every checking report and cash advance in their divisions (Maintenance &
  Civil with the Finance or Maintenance & Civil app, Renewable Energy with that app; every division if they have none of these),
  for companies where they hold the Approval Recorder step. They choose who signed (the named approver by default) and it is saved
  in that person's name, "recorded by" them. An Approval Recorder is never offered as an approver. Approving can be for the full
  amount or a part. No approving while viewing as someone.
- **Vouchers** are made by the person they belong to, or by a **Voucher Maker** for someone else (a person with a login, or a
  name from the saved list `vpeople/*`); the voucher counts as that person's (cash advance only for people with a login, and their
  checking report), and keeps who made it. **3 or fewer** vouchers of a person for a company go for approval without a checking
  report ("Send for approval"): they are printed one per page and signed. 4 or more go into a Voucher Checking Report.
- **TDS** is entered when an entry is accounted. The vendor is paid the total less TDS; the vendor statement and Ledger Statements
  show it. Checking reports and their PDFs don't.
- **Masters** (its own heading in every app with purchases or accounting, and Finance): Companies, Vendors, Ledgers; in
  Renewable Energy Companies, Consumers, PPA Rates, Vendors, Ledgers. One company list for the group (`companies/*`, logo required); each company lists the
  divisions that use it (`apps`) and keeps its own order per app (`orders`). A division app shows only its companies; Accounts and
  Finance see them all. Only admins add or change companies. Vendors (`apps`) and ledgers (`apps`) are kept apart by division the
  same way (none named means Maintenance & Civil); a vendor found by GSTIN from another division joins that division too.
- **Admins** do the same work as the Super Admin and can view as a Purchaser, Accountant or Financier. The Super Admin alone adds
  admins and edits the app. Admins can delete a person for good (Settings › Users › Delete): their login goes, their entries stay.
- **Vendors and ledgers are kept by the Accountant** (or an admin, also when viewing as them), in any app. A vendor is added from
  its first bill or proforma, as read; after that only the accountant changes its details. A bill can't be accounted until its
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
  always works in Live. People, admins, access requests, companies, locations, departments and ledgers are
  shared; entries (bills, vouchers, proformas, reports, payments, cash advances, vendors, balances, change log)
  are kept apart by a `demo__` prefix. Everything entered before the switch existed is Demo.
- **Bill files** are kept in the private `bill-files` Storage bucket (`live/` or `demo/` folder). The accountant sees
  the file beside the form with page, zoom, fit, rotate and drag. Bills typed in by hand can attach a file.
- **Settings** (everyone): Personalise (shared by every KKSK app, saved to the login) has light/dark/device mode, a colour, text size, table density, a
  profile picture shown at the top, and Change Password. Admins also see Companies, Users, Change Log and Data &
  Archive there. PDFs and Excel always keep the standard KKSK format.
- **Admins** are added only by the Super Admin (Settings › Users › Add Admin), with a login or without one
  (named as approver only). The Super Admin can set an admin's password.
- **Logins made by an admin**: Settings › Users › Add Person With Login makes the email and password straight
  away (admin-users Edge Function), with roles and companies set before the person ever signs in. Editing a
  person with a login can set a new password (only the super admin can for admins).
- **Purchasers** must have a default approver (Settings › Users); it is filled in on their new work and can be changed.
- **Voucher numbers** are given automatically per company and financial year: `INTL-VOU001/10/26-27`.
- **Cash advances** are paid out by the financier in Payment Entry › Advances (date, how paid, reference).
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
  (transformers), each with a location and either its inverters, with the solar panels under each inverter (make, number,
  kW per panel), or its windmills (make, capacity); at least one HTSC finishes setting it up. Makes typed before are offered
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
- **Invoices**: register, receipts with TDS under 194Q, ageing 0–30/31–60/61–90/90+, Excel.
- **Reports › P&L**: filters for financial year, calendar year, months, season (Winter Jan–Feb, Summer Mar–May, South-west
  monsoon Jun–Sep, North-east monsoon Oct–Dec), solar or windmill, companies, consumers and ledgers (C counts only the chosen
  ledgers' lines; a proforma or import has none until its bill); by company and month: net generated, units
  billed, A (energy), B (deductions), A − B, **C (expenses)** and what is left (A − B − C); the expenses itemised; deductions by
  charge; line loss by consumer; all to Excel. C is everything raised in the Renewable Energy app for that company in that
  month: submitted bills, proformas and imports until their final tax bill comes (then the bill counts), and cash vouchers;
  cash advances are not counted (the vouchers paid from them are). C is not split by consumer, so it is hidden while
  consumers are filtered.
- Tabs in Renewable Energy: Reports (Transactions, Payables, P&L), Sales (Monthly Billing, Invoices), Expenses
  (bills, proformas, imports, vouchers and their checking reports, cash advances), Accounts, Payments, Masters (Companies,
  Consumers, PPA Rates, Vendors, Ledgers), Settings.
- Who may use it: the Renewable Energy app plus the Sales job for the generator's company.
  The division's own expenses go through its Bills and Cash Vouchers, so they reach Accounts like any other.
