-- Lets the scheduled "Prune Job Health" workflow check that telemetry retention
-- is actually running. The job is invisible from outside the database
-- (cron.* is not exposed through the API), so a silently failing prune would
-- leave patient telemetry past the 90-day window with nobody the wiser.
--
-- Returns only job metadata: whether the job exists and is active, and when it
-- last succeeded. No tenant or patient data, so it is safe for the anon role.

CREATE OR REPLACE FUNCTION public.prune_job_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'job_exists', j.jobid IS NOT NULL,
    'active', coalesce(j.active, false),
    'last_success_at', (
      SELECT max(d.end_time)
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid AND d.status = 'succeeded'
    ),
    'last_status', (
      SELECT d.status
      FROM cron.job_run_details d
      WHERE d.jobid = j.jobid
      ORDER BY d.start_time DESC
      LIMIT 1
    )
  )
  FROM (SELECT 1) AS one
  LEFT JOIN cron.job j ON j.jobname = 'provider-matcher-prune-widget-analytics'
$$;

REVOKE ALL ON FUNCTION public.prune_job_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prune_job_health() TO anon, authenticated;

-- ROLLBACK (manual): DROP FUNCTION public.prune_job_health();
