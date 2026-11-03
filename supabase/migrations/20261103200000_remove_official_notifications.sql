-- Official Notifications removed from Tally (Demo): it used too much of the Anthropic API.
-- Stop the 10-minute schedule and clear what it kept. (Files it downloaded stay in bill-files/hsn-docs/auto/.)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'gst-rate-watch') then perform cron.unschedule('gst-rate-watch'); end if;
end $$;
delete from public.app_docs where path = 'tly__ratewatch/state' or path like 'tly\_\_notifdl/%' or path like 'tly\_\_notifrel/%';
