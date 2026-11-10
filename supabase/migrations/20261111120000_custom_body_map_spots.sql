-- Lets an admin place a case type on the widget's body map themselves.
--
-- Until now a case type could only be linked to one of 18 built-in spots (map_tag),
-- whose positions live in the code, so a new case type with no matching spot
-- (Pectoral, Fingers, ...) could not be put on the map without a developer.
-- A case type can now instead carry its own position: which figure (front or
-- back), where on it, and optionally where its name is written. Positions are
-- percentages of the figure, like the built-in spots, so they hold at any size.
--
-- Purely additive: every existing row has all of these null and behaves as
-- before. A case type uses a built-in spot or its own position, never both.
-- The widget-data edge function must be redeployed to publish the new columns;
-- until then the widget ignores them and lists such a case type as a button.

ALTER TABLE public.case_types
  ADD COLUMN IF NOT EXISTS map_view text,
  ADD COLUMN IF NOT EXISTS map_x numeric,
  ADD COLUMN IF NOT EXISTS map_y numeric,
  ADD COLUMN IF NOT EXISTS map_label_x numeric,
  ADD COLUMN IF NOT EXISTS map_label_y numeric;

ALTER TABLE public.case_types DROP CONSTRAINT IF EXISTS case_types_map_position_check;
ALTER TABLE public.case_types ADD CONSTRAINT case_types_map_position_check CHECK (
  (
    map_view IS NULL AND map_x IS NULL AND map_y IS NULL
    AND map_label_x IS NULL AND map_label_y IS NULL
  )
  OR (
    map_tag IS NULL
    AND map_view IN ('front', 'back')
    AND map_x IS NOT NULL AND map_x BETWEEN 0 AND 100
    AND map_y IS NOT NULL AND map_y BETWEEN 0 AND 100
    AND (
      (map_label_x IS NULL AND map_label_y IS NULL)
      OR (
        map_label_x IS NOT NULL AND map_label_x BETWEEN -40 AND 140
        AND map_label_y IS NOT NULL AND map_label_y BETWEEN -40 AND 140
      )
    )
  )
);
