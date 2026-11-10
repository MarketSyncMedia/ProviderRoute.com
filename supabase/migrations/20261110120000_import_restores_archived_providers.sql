-- Imports can merge into a provider that has been archived.
--
-- A row naming someone the admin had archived could not be matched to them:
-- the import only compared against live providers, and execute_provider_import
-- rejected an archived provider as a merge target. The row then created a second
-- provider for the same person. A conflict may now point at an archived provider
-- and, when resolved as a merge, brings them back before the rows are applied.
-- Everything else in the function is unchanged.

CREATE OR REPLACE FUNCTION public.execute_provider_import(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_org_id uuid := provider_matcher_private.get_user_org_id();
  v_rows jsonb := p_payload -> 'rows';
  v_mappings jsonb := p_payload -> 'mappings';
  v_headers jsonb := p_payload -> 'headers';
  v_resolutions jsonb := COALESCE(p_payload -> 'resolvedConflicts', '{}'::jsonb);
  v_provider_header text;
  v_case_type_header text;
  v_category_header text;
  v_row jsonb;
  v_mapping jsonb;
  v_conflict jsonb;
  v_row_index integer := -1;
  v_provider_name text;
  v_provider_key text;
  v_provider_id uuid;
  v_existing_provider_id uuid;
  v_resolution text;
  v_case_name text;
  v_case_type_id uuid;
  v_category_name text;
  v_category_id uuid;
  v_location_id uuid;
  v_location_ids uuid[];
  v_constraints jsonb;
  v_constraint public.constraints%ROWTYPE;
  v_raw text;
  v_number numeric;
  v_booking_link text;
  v_phone text;
  v_offering public.offerings%ROWTYPE;
  v_providers_created integer := 0;
  v_providers_updated integer := 0;
  v_offerings_upserted integer := 0;
  v_case_types_created integer := 0;
  v_categories_created integer := 0;
  v_duplicates integer := 0;
BEGIN
  IF v_org_id IS NULL OR NOT provider_matcher_private.can_write() THEN
    RAISE EXCEPTION 'Editor or owner role required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_payload) <> 'object'
    OR jsonb_typeof(v_rows) <> 'array'
    OR jsonb_typeof(v_mappings) <> 'array'
    OR jsonb_typeof(v_headers) <> 'array' THEN
    RAISE EXCEPTION 'Invalid import payload';
  END IF;
  IF octet_length(p_payload::text) > 10 * 1024 * 1024
    OR jsonb_array_length(v_rows) > 25000
    OR jsonb_array_length(v_mappings) > 250
    OR jsonb_array_length(v_headers) > 250 THEN
    RAISE EXCEPTION 'Import exceeds server limits';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_rows) AS r(row_value)
    CROSS JOIN LATERAL jsonb_each_text(r.row_value) AS cell(key, value)
    WHERE length(cell.value) > 10000
  ) THEN
    RAISE EXCEPTION 'Import cell exceeds 10000 characters';
  END IF;

  SELECT m ->> 'excelHeader' INTO v_provider_header
  FROM jsonb_array_elements(v_mappings) AS m WHERE m ->> 'role' = 'provider_name' LIMIT 1;
  SELECT m ->> 'excelHeader' INTO v_case_type_header
  FROM jsonb_array_elements(v_mappings) AS m WHERE m ->> 'role' = 'case_type' LIMIT 1;
  SELECT m ->> 'excelHeader' INTO v_category_header
  FROM jsonb_array_elements(v_mappings) AS m WHERE m ->> 'role' = 'category' LIMIT 1;
  IF v_provider_header IS NULL OR v_case_type_header IS NULL THEN
    RAISE EXCEPTION 'Provider and case type mappings are required';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_mappings) AS m
    WHERE m ->> 'role' NOT IN (
      'provider_name', 'case_type', 'category', 'constraint',
      'location', 'booking_link', 'phone', 'ignore'
    )
  ) THEN
    RAISE EXCEPTION 'Unsupported import mapping role';
  END IF;

  CREATE TEMP TABLE pm_import_case_types (
    lookup_key text PRIMARY KEY,
    id uuid NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pm_import_categories (
    lookup_key text PRIMARY KEY,
    id uuid NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pm_import_conflicts (
    row_index integer PRIMARY KEY,
    provider_id uuid NOT NULL,
    resolution text NOT NULL
  ) ON COMMIT DROP;
  CREATE TEMP TABLE pm_import_providers (
    lookup_key text PRIMARY KEY,
    id uuid NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.pm_import_case_types
  SELECT DISTINCT ON (lower(btrim(name))) lower(btrim(name)), id
  FROM public.case_types
  WHERE org_id = v_org_id AND is_archived = false
  ORDER BY lower(btrim(name)), created_at;
  INSERT INTO pg_temp.pm_import_categories
  SELECT DISTINCT ON (lower(btrim(name))) lower(btrim(name)), id
  FROM public.categories
  WHERE org_id = v_org_id AND is_archived = false
  ORDER BY lower(btrim(name)), created_at;

  FOR v_conflict IN SELECT value FROM jsonb_array_elements(COALESCE(p_payload -> 'conflicts', '[]'::jsonb))
  LOOP
    v_row_index := (v_conflict ->> 'rowIndex')::integer;
    v_existing_provider_id := (v_conflict ->> 'existingProviderId')::uuid;
    v_resolution := v_resolutions ->> v_row_index::text;
    IF v_resolution NOT IN ('merge', 'separate', 'skip') THEN
      RAISE EXCEPTION 'Every conflict requires a valid resolution';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.providers
      WHERE id = v_existing_provider_id AND org_id = v_org_id
    ) THEN
      RAISE EXCEPTION 'Conflict provider is outside the organization';
    END IF;
    INSERT INTO pg_temp.pm_import_conflicts VALUES (v_row_index, v_existing_provider_id, v_resolution);
    v_duplicates := v_duplicates + 1;
  END LOOP;

  -- Create missing case types first so every row can resolve to a controlled id.
  FOR v_case_name IN
    SELECT DISTINCT btrim(r.value ->> v_case_type_header)
    FROM jsonb_array_elements(v_rows) AS r(value)
    WHERE btrim(COALESCE(r.value ->> v_case_type_header, '')) <> ''
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_temp.pm_import_case_types WHERE lookup_key = lower(v_case_name)) THEN
      INSERT INTO public.case_types (org_id, name)
      VALUES (v_org_id, initcap(lower(v_case_name))) RETURNING id INTO v_case_type_id;
      INSERT INTO pg_temp.pm_import_case_types VALUES (lower(v_case_name), v_case_type_id);
      v_case_types_created := v_case_types_created + 1;
    END IF;
  END LOOP;

  IF v_category_header IS NOT NULL THEN
    FOR v_category_name IN
      SELECT DISTINCT btrim(part)
      FROM jsonb_array_elements(v_rows) AS r(value)
      CROSS JOIN LATERAL regexp_split_to_table(COALESCE(r.value ->> v_category_header, ''), ',') AS part
      WHERE btrim(part) <> ''
    LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_temp.pm_import_categories WHERE lookup_key = lower(v_category_name)) THEN
        INSERT INTO public.categories (org_id, name)
        VALUES (v_org_id, initcap(lower(v_category_name))) RETURNING id INTO v_category_id;
        INSERT INTO pg_temp.pm_import_categories VALUES (lower(v_category_name), v_category_id);
        v_categories_created := v_categories_created + 1;
      END IF;
    END LOOP;
  END IF;

  v_row_index := -1;
  FOR v_row IN SELECT value FROM jsonb_array_elements(v_rows)
  LOOP
    v_row_index := v_row_index + 1;
    v_provider_name := btrim(COALESCE(v_row ->> v_provider_header, ''));
    IF v_provider_name = '' THEN CONTINUE; END IF;
    v_provider_key := btrim(regexp_replace(regexp_replace(lower(v_provider_name), '[^a-z0-9 ]', '', 'g'), '\s+', ' ', 'g'));

    v_existing_provider_id := NULL;
    v_resolution := NULL;
    SELECT provider_id, resolution INTO v_existing_provider_id, v_resolution
    FROM pg_temp.pm_import_conflicts WHERE row_index = v_row_index;
    IF FOUND AND v_resolution = 'skip' THEN CONTINUE; END IF;

    SELECT id INTO v_provider_id FROM pg_temp.pm_import_providers WHERE lookup_key = v_provider_key;
    IF v_provider_id IS NULL THEN
      IF v_resolution = 'merge' THEN
        v_provider_id := v_existing_provider_id;
        v_providers_updated := v_providers_updated + 1;
        -- Merging into an archived provider brings them back, so the rows
        -- being imported do not land on someone hidden from every page.
        UPDATE public.providers SET is_archived = false
        WHERE id = v_provider_id AND is_archived;
      ELSE
        INSERT INTO public.providers (org_id, name, normalized_name, category_ids)
        VALUES (v_org_id, left(v_provider_name, 200), v_provider_key, '{}'::uuid[])
        RETURNING id INTO v_provider_id;
        v_providers_created := v_providers_created + 1;
      END IF;
      INSERT INTO pg_temp.pm_import_providers VALUES (v_provider_key, v_provider_id);
    END IF;

    IF v_category_header IS NOT NULL THEN
      FOR v_category_name IN
        SELECT btrim(part) FROM regexp_split_to_table(COALESCE(v_row ->> v_category_header, ''), ',') AS part
        WHERE btrim(part) <> ''
      LOOP
        SELECT id INTO v_category_id FROM pg_temp.pm_import_categories WHERE lookup_key = lower(v_category_name);
        UPDATE public.providers
        SET category_ids = ARRAY(
          SELECT DISTINCT item FROM unnest(COALESCE(category_ids, '{}'::uuid[]) || ARRAY[v_category_id]) AS item
        )
        WHERE id = v_provider_id;
      END LOOP;
    END IF;

    SELECT id INTO v_case_type_id
    FROM pg_temp.pm_import_case_types
    WHERE lookup_key = lower(btrim(COALESCE(v_row ->> v_case_type_header, '')));
    IF v_case_type_id IS NULL THEN CONTINUE; END IF;

    v_constraints := '{}'::jsonb;
    FOR v_mapping IN
      SELECT value FROM jsonb_array_elements(v_mappings) WHERE value ->> 'role' = 'constraint'
    LOOP
      SELECT * INTO v_constraint FROM public.constraints
      WHERE id = (v_mapping ->> 'constraintId')::uuid
        AND org_id = v_org_id AND is_archived = false;
      IF v_constraint.id IS NULL THEN RAISE EXCEPTION 'Constraint is outside the organization'; END IF;
      v_raw := btrim(COALESCE(v_row ->> (v_mapping ->> 'excelHeader'), ''));
      IF v_constraint.type = 'binary' THEN
        v_constraints := jsonb_set(
          v_constraints,
          ARRAY[v_constraint.mapped_key],
          to_jsonb(CASE WHEN lower(v_raw) IN ('1', 'true', 'yes', 'y') THEN 1 ELSE 0 END),
          true
        );
      ELSIF v_constraint.type = 'range' THEN
        BEGIN v_number := NULLIF(v_raw, '')::numeric; EXCEPTION WHEN invalid_text_representation THEN v_number := NULL; END;
        IF v_mapping ->> 'rangePosition' = 'min' THEN
          v_constraints := jsonb_set(v_constraints, ARRAY[v_constraint.mapped_key], to_jsonb(COALESCE(v_number, 0)), true);
        ELSIF v_mapping ->> 'rangePosition' = 'max' AND v_constraint.secondary_mapped_key IS NOT NULL THEN
          v_constraints := jsonb_set(v_constraints, ARRAY[v_constraint.secondary_mapped_key], to_jsonb(COALESCE(v_number, 999)), true);
        END IF;
      ELSE
        v_constraints := jsonb_set(
          v_constraints,
          ARRAY[v_constraint.mapped_key],
          CASE WHEN v_raw = '' THEN 'null'::jsonb ELSE to_jsonb(v_raw) END,
          true
        );
      END IF;
      v_constraint.id := NULL;
    END LOOP;

    v_location_ids := '{}'::uuid[];
    FOR v_mapping IN
      SELECT value FROM jsonb_array_elements(v_mappings) WHERE value ->> 'role' = 'location'
    LOOP
      v_raw := lower(btrim(COALESCE(v_row ->> (v_mapping ->> 'excelHeader'), '')));
      IF v_raw IN ('1', 'true', 'yes', 'y') THEN
        v_location_id := (v_mapping ->> 'locationId')::uuid;
        IF NOT EXISTS (
          SELECT 1 FROM public.locations
          WHERE id = v_location_id AND org_id = v_org_id AND is_archived = false
        ) THEN RAISE EXCEPTION 'Location is outside the organization'; END IF;
        v_location_ids := array_append(v_location_ids, v_location_id);

        SELECT NULLIF(btrim(v_row ->> (m ->> 'excelHeader')), '') INTO v_booking_link
        FROM jsonb_array_elements(v_mappings) AS m
        WHERE m ->> 'role' = 'booking_link'
          AND (m ->> 'locationScope' = v_location_id::text OR m ->> 'locationScope' = 'all')
        LIMIT 1;
        SELECT NULLIF(btrim(v_row ->> (m ->> 'excelHeader')), '') INTO v_phone
        FROM jsonb_array_elements(v_mappings) AS m
        WHERE m ->> 'role' = 'phone'
          AND (m ->> 'locationScope' = v_location_id::text OR m ->> 'locationScope' = 'all')
        LIMIT 1;
        IF v_booking_link IS NOT NULL AND v_booking_link !~* '^https://[^[:space:]]+$' THEN
          RAISE EXCEPTION 'Booking links must use HTTPS';
        END IF;
        IF v_phone IS NOT NULL AND regexp_replace(v_phone, '[^0-9+]', '', 'g') !~ '^\+?[0-9]{7,20}$' THEN
          RAISE EXCEPTION 'Invalid phone number';
        END IF;
        INSERT INTO public.provider_locations (provider_id, location_id, booking_link, phone)
        VALUES (v_provider_id, v_location_id, v_booking_link, v_phone)
        ON CONFLICT (provider_id, location_id) DO UPDATE
        SET booking_link = EXCLUDED.booking_link, phone = EXCLUDED.phone;
      END IF;
    END LOOP;

    -- A provider holds one offering per case type, archived or not
    -- (offerings_provider_id_case_type_id_key), so look at both: inserting a
    -- second row for a case type they have archived violates that constraint.
    SELECT * INTO v_offering FROM public.offerings
    WHERE org_id = v_org_id AND provider_id = v_provider_id
      AND case_type_id = v_case_type_id
    LIMIT 1 FOR UPDATE;
    IF v_offering.id IS NULL THEN
      INSERT INTO public.offerings (
        org_id, provider_id, case_type_id, location_ids, constraints, is_archived
      ) VALUES (
        v_org_id, v_provider_id, v_case_type_id,
        ARRAY(SELECT DISTINCT x FROM unnest(v_location_ids) AS x), v_constraints, false
      );
    ELSIF v_offering.is_archived THEN
      -- Bring it back with the row's own details, as Add Offering does,
      -- rather than blending them into whatever was archived.
      UPDATE public.offerings
      SET
        is_archived = false,
        location_ids = ARRAY(SELECT DISTINCT x FROM unnest(v_location_ids) AS x),
        constraints = v_constraints
      WHERE id = v_offering.id;
    ELSE
      UPDATE public.offerings
      SET
        location_ids = ARRAY(
          SELECT DISTINCT x FROM unnest(COALESCE(v_offering.location_ids, '{}'::uuid[]) || v_location_ids) AS x
        ),
        constraints = COALESCE(v_offering.constraints, '{}'::jsonb) || v_constraints
      WHERE id = v_offering.id;
    END IF;
    v_offering.id := NULL;
    v_offerings_upserted := v_offerings_upserted + 1;
  END LOOP;

  INSERT INTO public.import_history (
    org_id, filename, rows_processed, providers_created, providers_updated,
    duplicates_detected, errors, mapping_template
  ) VALUES (
    v_org_id, left(COALESCE(p_payload ->> 'filename', 'import'), 255), jsonb_array_length(v_rows),
    v_providers_created, v_providers_updated, v_duplicates, 0,
    jsonb_build_object('headers', v_headers, 'mappings', v_mappings)
  );

  RETURN jsonb_build_object(
    'providersCreated', v_providers_created,
    'providersUpdated', v_providers_updated,
    'offeringsUpserted', v_offerings_upserted,
    'newCaseTypesCount', v_case_types_created,
    'newCategoriesCount', v_categories_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_provider_import(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.execute_provider_import(jsonb) TO authenticated;

-- ROLLBACK (manual): DROP FUNCTION public.execute_provider_import(jsonb).
