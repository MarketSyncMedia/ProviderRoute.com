-- Adds a bicep spot to the widget's body map. Only widens the allowed values,
-- so no existing case type changes until an admin links one to the new spot.
-- The spot's position lives in src/shared/bodyMap.ts.

ALTER TABLE public.case_types DROP CONSTRAINT IF EXISTS case_types_map_tag_check;
ALTER TABLE public.case_types ADD CONSTRAINT case_types_map_tag_check CHECK (
  map_tag IS NULL OR map_tag IN (
    'shoulder', 'clavicle', 'bicep', 'elbow', 'hand', 'wrist', 'pelvis', 'hip', 'groin',
    'knee', 'shin-splints', 'ankle', 'foot', 'toes',
    'neck', 'low-back', 'achilles', 'heel'
  )
);
