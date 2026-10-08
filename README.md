# KKSK Group

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
  admin named under Admin › Users). It prints on the voucher and on the checking reports. A named admin sees only
  the work they approve; the super admin sees everything.
- **Admins** don't see the entry screens (Enter Bills, Proformas, Imports, Cash Vouchers, To Account, Payment Entry)
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
  always works in Live. Data is kept apart by a `demo__` prefix on every collection except users, admins and
  requests. Everything entered before the switch existed is Demo; Live started with the companies, locations,
  departments and ledgers copied across.
- **Bill files** are kept in the private `bill-files` Storage bucket (`live/` or `demo/` folder). The accountant sees
  the file beside the form with page, zoom, fit, rotate and drag. Bills typed in by hand can attach a file.
- **Purchasers** must have a default approver (Admin › Users); it is filled in on their new work and can be changed.
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
