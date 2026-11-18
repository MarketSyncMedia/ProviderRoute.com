-- Corrects 20261118120000_toa_provider_self_scheduling_links.sql, which put each
-- Towson Orthopaedic Associates provider's own form link in the wrong field.
--
-- Intended: the widget's booking button ("Book Now", provider_locations.
-- booking_link) opens THAT provider's own form, so the patient doesn't have to
-- search for the physician again. The general appointment-request form lives on
-- the TOA website's own "Request an Appointment" button and is not touched here.
-- Not intended: a separate self-scheduling button.
--
-- So each phreesia.me/TOA-* link moves from self_schedule_link to booking_link,
-- replacing the general towsonortho.com form that every location had there, and
-- self_schedule_link is cleared again (so no "Schedule Online" button shows).
-- Only the rows holding one of those provider links are touched.
--
-- On a database without the organization (CI, fresh project) nothing matches and
-- nothing happens. On the real one, a count other than the 33 locations set by the
-- previous migration aborts instead of half-applying.

DO $$
DECLARE
  toa_org uuid;
  found int;
  moved int;
BEGIN
  SELECT id INTO toa_org FROM public.organizations
  WHERE name = 'Towson Orthopaedic Associates';

  IF toa_org IS NULL THEN
    RAISE NOTICE 'Towson Orthopaedic Associates not present; nothing to update.';
    RETURN;
  END IF;

  SELECT count(*) INTO found
  FROM public.provider_locations pl
  JOIN public.providers p ON p.id = pl.provider_id
  WHERE p.org_id = toa_org
    AND pl.self_schedule_link LIKE 'https://phreesia.me/TOA-%';

  IF found <> 33 THEN
    RAISE EXCEPTION 'Expected 33 provider locations holding a provider link, found %', found;
  END IF;

  UPDATE public.provider_locations pl
  SET booking_link = pl.self_schedule_link,
      self_schedule_link = NULL,
      updated_at = now()
  FROM public.providers p
  WHERE pl.provider_id = p.id
    AND p.org_id = toa_org
    AND pl.self_schedule_link LIKE 'https://phreesia.me/TOA-%';

  GET DIAGNOSTICS moved = ROW_COUNT;
  RAISE NOTICE 'Moved provider links into booking_link on % locations.', moved;
END
$$;

-- =============================================================================
-- ROLLBACK (commented -- manual only). Every location had the general form in
-- booking_link before; this puts it back and the provider link back where the
-- previous migration had it.
-- -----------------------------------------------------------------------------
-- UPDATE public.provider_locations pl
-- SET self_schedule_link = pl.booking_link,
--     booking_link = 'https://www.towsonortho.com/secure-online-appointment-form/'
-- FROM public.providers p
-- WHERE pl.provider_id = p.id
--   AND p.org_id = (SELECT id FROM public.organizations WHERE name = 'Towson Orthopaedic Associates')
--   AND pl.booking_link LIKE 'https://phreesia.me/TOA-%';
