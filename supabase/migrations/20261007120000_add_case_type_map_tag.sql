-- Links a case type to a spot on the widget's clickable body map.
--
-- The positions of the spots live in the widget, keyed by these tags; the
-- database only records which case type a spot selects. Null means the case
-- type has no spot and the widget lists it as a plain button, which is how
-- every existing case type behaves -- so this changes nothing until an admin
-- assigns a tag.
--
-- The allowed values are the spots the widget draws. Adding a spot means
-- adding its position to the widget and its tag here.

ALTER TABLE public.case_types ADD COLUMN IF NOT EXISTS map_tag text;

ALTER TABLE public.case_types DROP CONSTRAINT IF EXISTS case_types_map_tag_check;
ALTER TABLE public.case_types ADD CONSTRAINT case_types_map_tag_check CHECK (
  map_tag IS NULL OR map_tag IN (
    'shoulder', 'clavicle', 'elbow', 'hand', 'wrist', 'pelvis', 'hip', 'groin',
    'knee', 'shin-splints', 'ankle', 'foot', 'toes',
    'neck', 'low-back', 'achilles', 'heel'
  )
);

-- One case type per spot per org, or a click on the spot is ambiguous.
-- Archived rows are excluded: nothing restores an archived case type, and an
-- archived row should not hold a spot the admin wants to reassign.
CREATE UNIQUE INDEX IF NOT EXISTS case_types_org_map_tag_key
  ON public.case_types (org_id, map_tag)
  WHERE map_tag IS NOT NULL AND is_archived = false;
