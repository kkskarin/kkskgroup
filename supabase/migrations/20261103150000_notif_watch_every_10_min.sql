-- Official notifications watch (gst-rate-watch): called every 10 minutes. It starts a new check only when the last
-- full one is over 20 hours old (so once a day); otherwise it only picks up topics a cut-off run left queued. A check
-- runs topic after topic by itself.
select cron.unschedule(jobid) from cron.job where jobname = 'gst-rate-watch';
select cron.schedule('gst-rate-watch', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://uqjirmofridjuykeemml.supabase.co/functions/v1/gst-rate-watch',
    body := '{}'::jsonb,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 10000
  );
$$);
