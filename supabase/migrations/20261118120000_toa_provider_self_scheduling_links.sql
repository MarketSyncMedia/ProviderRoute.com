-- Gives each Towson Orthopaedic Associates provider their own self-scheduling
-- link (a Phreesia form already set up for that physician), so "Schedule with
-- Dr. Kelly" lands on Dr. Kelly's form instead of the general one where the
-- patient has to find the physician again.
--
-- Only provider_locations.self_schedule_link is written. The general
-- appointment-request link (booking_link) is not touched and stays the shared
-- form behind the appointment-request button.
--
-- The link goes on every location of the provider, so it holds in either mode
-- (the organization default is "simple": one link for all locations).
--
-- Data only; no schema change. Providers are matched by exact name within the
-- organization. On a database without that organization (CI, a fresh project)
-- nothing matches and nothing happens. On the real one, a name that no longer
-- matches exactly one provider aborts the migration rather than skipping a doctor
-- silently.

DO $$
DECLARE
  toa_org uuid;
  expected int;
  matched int;
  updated int;
BEGIN
  SELECT id INTO toa_org FROM public.organizations
  WHERE name = 'Towson Orthopaedic Associates';

  IF toa_org IS NULL THEN
    RAISE NOTICE 'Towson Orthopaedic Associates not present; nothing to update.';
    RETURN;
  END IF;

  CREATE TEMP TABLE toa_self_schedule_links (provider_name text PRIMARY KEY, link text NOT NULL)
    ON COMMIT DROP;

  INSERT INTO toa_self_schedule_links (provider_name, link) VALUES
    ('Alexander Adams',               'https://phreesia.me/TOA-AlexanderAdams'),
    ('Alvin J. Detterline',           'https://phreesia.me/TOA-AlvinJDetterline'),
    ('Anthony S. Machi',              'https://phreesia.me/TOA-AnthonyMachi'),
    ('Brian D. Mulliken',             'https://phreesia.me/TOA-BrianDMulliken'),
    ('Brian Shiu',                    'https://phreesia.me/TOA-BrianShiu'),
    ('Bruce S. Wolock',               'https://phreesia.me/TOA-BruceSWolock'),
    ('David T. Schroder',             'https://phreesia.me/TOA-DavidSchroder'),
    ('Elizabeth Inkellis Langhammer', 'https://phreesia.me/TOA-ElizabethLanghammer'),
    ('Jeffery T. Brodie',             'https://phreesia.me/TOA-JeffreyTBrodie'),
    ('Jack Steele',                   'https://phreesia.me/TOA-JohnSteele'),
    ('Kenneth DeFontes III',          'https://phreesia.me/TOA-KennethDeFontes'),
    ('Mark V. Clough',                'https://phreesia.me/TOA-MarkClough'),
    ('Michael J. Marion',             'https://phreesia.me/TOA-MichaelJMarion'),
    ('Patrick Kelly',                 'https://phreesia.me/TOA-PatrickKelly'),
    ('Richard D. Winakur',            'https://phreesia.me/TOA-RichardDWinakur'),
    ('Sarah Hobart',                  'https://phreesia.me/TOA-SarahHobart'),
    ('Scott J. Tarantino',            'https://phreesia.me/TOA-ScottJTarantino'),
    ('Teri M. McCambridge',           'https://phreesia.me/TOA-TeriMcCambridge'),
    ('Theodore T. Manson',            'https://phreesia.me/TOA-TheodoreManson'),
    ('Tiffany Tsay',                  'https://phreesia.me/TOA-TiffanyTsay'),
    ('Timothy P. Codd',               'https://phreesia.me/TOA-TimothyPCodd');

  SELECT count(*) INTO expected FROM toa_self_schedule_links;

  SELECT count(*) INTO matched
  FROM toa_self_schedule_links l
  WHERE (SELECT count(*) FROM public.providers p
         WHERE p.org_id = toa_org AND p.name = l.provider_name) = 1;

  IF matched <> expected THEN
    RAISE EXCEPTION
      'Expected each of % providers to match exactly one provider in the organization, but only % did',
      expected, matched;
  END IF;

  UPDATE public.provider_locations pl
  SET self_schedule_link = l.link,
      updated_at = now()
  FROM public.providers p
  JOIN toa_self_schedule_links l ON l.provider_name = p.name
  WHERE pl.provider_id = p.id
    AND p.org_id = toa_org;

  GET DIAGNOSTICS updated = ROW_COUNT;
  RAISE NOTICE 'Set self-scheduling links on % provider locations.', updated;
END
$$;

-- =============================================================================
-- ROLLBACK (commented -- manual only)
-- -----------------------------------------------------------------------------
-- UPDATE public.provider_locations pl SET self_schedule_link = NULL
-- FROM public.providers p
-- WHERE pl.provider_id = p.id
--   AND p.org_id = (SELECT id FROM public.organizations WHERE name = 'Towson Orthopaedic Associates')
--   AND pl.self_schedule_link LIKE 'https://phreesia.me/TOA-%';
