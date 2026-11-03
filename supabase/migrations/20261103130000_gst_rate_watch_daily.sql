-- Tally (Demo) › Masters › HSN / SAC: the daily check for new GST rate notifications (gst-rate-watch Edge Function).
-- Called at 17 minutes past each hour; the function runs only when its last good check is over 20 hours old
-- (once a day), or, while a search is unfinished, an hour after the last round (up to 8 rounds).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname = 'gst-rate-watch';
select cron.schedule('gst-rate-watch', '17 * * * *', $$
  select net.http_post(
    url := 'https://uqjirmofridjuykeemml.supabase.co/functions/v1/gst-rate-watch',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);
