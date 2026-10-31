-- Two levels of approval: a report with a 1st approver ("l1": "wait") alerts its admin only once the 1st approver passes it on.
-- The alert function itself skips a report still with its 1st approver; this lets the pass-on (same stage, l1 changes) call it.
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
       and coalesce(old.data->>'generatedAt', '') = coalesce(new.data->>'generatedAt', '')
       and coalesce(old.data->>'l1', '') = coalesce(new.data->>'l1', '') then return new; end if;
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
