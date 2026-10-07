-- rls_auto_enable is the event-trigger helper Supabase installs to switch on row level security for
-- new tables in public. It runs from its event trigger, so nobody needs to call it through the API.
-- Removing EXECUTE clears the security advisor warnings without changing what the trigger does.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
