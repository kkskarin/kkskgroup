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
- **Sign-in**: email sign-in (link or 6-digit code) through Supabase Auth. First sign-in asks for a name.
- **Who can get in**: anyone with an `@kksk.in` address (`app_allowed_domains`), plus addresses listed in
  `app_allowed_emails`. Inside the app, the existing request and approval flow still decides what each person sees.
- **Super admin**: addresses in `app_super_admins` (starts with `arin@kksk.in`). This is the "owner" of the old artifact.
- **Access rules** (same as the artifact had): only a super admin writes `admins/*`; nobody writes their own
  `users/<id>` record unless they are an admin; every other record is writable by any member.
- **Claude**: bill and proforma reading and the "tidy into clean English" boxes call the `ai-sample`
  Edge Function, which calls the Anthropic API with the server-side `ANTHROPIC_API_KEY` secret.
- **Backups** download as Excel files. (The old "also save to Google Drive" step is not available outside claude.ai.)

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
5. **Email sending**: Supabase's built-in email is rate-limited and meant for testing. For a team, set up
   custom SMTP under Authentication → Emails → SMTP Settings.

### Managing access (SQL editor)

```sql
-- let someone outside @kksk.in in
insert into public.app_allowed_emails (email) values ('person@example.com');
-- add another super admin
insert into public.app_super_admins (email) values ('someone@kksk.in');
```
