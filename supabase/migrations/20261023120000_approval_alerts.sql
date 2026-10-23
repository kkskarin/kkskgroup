-- WhatsApp approval alerts. When a live checking report starts waiting for approval (stage becomes "generated")
-- or a cash advance is requested, the approval-alert Edge Function is called with the record's path; it reads the
-- record itself and messages the approver through Sent. Demo records (demo__ paths) never alert.
create extension if not exists pg_net with schema extensions;

-- One row per wait already alerted, so a wait is never messaged twice. Only the Edge Function (service role) uses it.
create table public.app_alerts_sent (
  key text primary key,
  at timestamptz not null default now()
);
alter table public.app_alerts_sent enable row level security;
revoke all on public.app_alerts_sent from anon, authenticated;
grant select, insert, update, delete on public.app_alerts_sent to service_role;

create or replace function private.approval_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.path like 'reports/%' then
    if coalesce(new.data->>'stage', '') <> 'generated' then return new; end if;
    if tg_op = 'UPDATE' and coalesce(old.data->>'stage', '') = 'generated'
       and coalesce(old.data->>'generatedAt', '') = coalesce(new.data->>'generatedAt', '') then return new; end if;
  elsif new.path like 'cashadv/%' then
    if coalesce(new.data->>'status', '') <> 'pending' or coalesce(new.data->>'kind', '') = 'return' then return new; end if;
    if tg_op = 'UPDATE' and coalesce(old.data->>'status', '') = 'pending' then return new; end if;
  else
    return new;
  end if;
  perform net.http_post(
    url := 'https://uqjirmofridjuykeemml.supabase.co/functions/v1/approval-alert',
    body := jsonb_build_object('path', new.path),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  return new; -- an alert must never stop the record from saving
end;
$$;
revoke all on function private.approval_alert() from public, anon, authenticated;

create trigger app_docs_approval_alert
  after insert or update of data on public.app_docs
  for each row
  when (new.path like 'reports/%' or new.path like 'cashadv/%')
  execute function private.approval_alert();
