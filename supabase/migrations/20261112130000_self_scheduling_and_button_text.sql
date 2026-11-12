-- =============================================================================
-- Self-scheduling links, and the wording of the widget's two result buttons.
--
-- A provider can have an appointment-request link (provider_locations.
-- booking_link, as before) and now also a self-scheduling link per location.
-- The widget shows the self-scheduling button only where a link exists. Like the
-- booking link and the phone number, it is either one link for all of a
-- provider's locations ("simple") or one per location ("advanced"), chosen per
-- organization with a per-provider override.
--
-- The two buttons' text is the widget's own language, so it lives on the widget.
-- Blank means the widget's built-in wording.
--
-- Purely additive: every new column is nullable, so existing rows, the import
-- functions and the live widget are unaffected until a value is set.
-- =============================================================================

ALTER TABLE public.provider_locations
  ADD COLUMN IF NOT EXISTS self_schedule_link text;

-- The widget links patients to this, so it must be an https URL like the others.
ALTER TABLE public.provider_locations
  ADD CONSTRAINT provider_locations_self_schedule_link_https
  CHECK (self_schedule_link IS NULL OR self_schedule_link ~* '^https://[^[:space:]]+$');

ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS self_schedule_mode text DEFAULT 'default';

ALTER TABLE public.providers
  ADD CONSTRAINT providers_self_schedule_mode_check
  CHECK (self_schedule_mode IN ('default', 'simple', 'advanced'));

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_self_schedule_mode text DEFAULT 'simple';

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_default_self_schedule_mode_check
  CHECK (default_self_schedule_mode IN ('simple', 'advanced'));

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS booking_button_text text;

ALTER TABLE public.widgets
  ADD COLUMN IF NOT EXISTS self_schedule_button_text text;

ALTER TABLE public.widgets
  ADD CONSTRAINT widgets_booking_button_text_length
  CHECK (booking_button_text IS NULL OR char_length(booking_button_text) <= 40);

ALTER TABLE public.widgets
  ADD CONSTRAINT widgets_self_schedule_button_text_length
  CHECK (self_schedule_button_text IS NULL OR char_length(self_schedule_button_text) <= 40);

COMMENT ON COLUMN public.provider_locations.self_schedule_link IS
  'Where a patient books a time themselves at this location. The widget shows its self-scheduling button only when set.';
COMMENT ON COLUMN public.providers.self_schedule_mode IS
  'default (use the organization''s), simple (one self-scheduling link for all locations) or advanced (one per location).';
COMMENT ON COLUMN public.organizations.default_self_schedule_mode IS
  'simple (one self-scheduling link for all of a provider''s locations) or advanced (one per location).';
COMMENT ON COLUMN public.widgets.booking_button_text IS
  'Text of the appointment-request button on a result card. Blank uses the built-in wording.';
COMMENT ON COLUMN public.widgets.self_schedule_button_text IS
  'Text of the self-scheduling button on a result card. Blank uses the built-in wording.';

-- =============================================================================
-- ROLLBACK (commented -- manual only)
-- -----------------------------------------------------------------------------
-- ALTER TABLE public.widgets DROP CONSTRAINT IF EXISTS widgets_self_schedule_button_text_length;
-- ALTER TABLE public.widgets DROP CONSTRAINT IF EXISTS widgets_booking_button_text_length;
-- ALTER TABLE public.widgets DROP COLUMN IF EXISTS self_schedule_button_text;
-- ALTER TABLE public.widgets DROP COLUMN IF EXISTS booking_button_text;
-- ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_default_self_schedule_mode_check;
-- ALTER TABLE public.organizations DROP COLUMN IF EXISTS default_self_schedule_mode;
-- ALTER TABLE public.providers DROP CONSTRAINT IF EXISTS providers_self_schedule_mode_check;
-- ALTER TABLE public.providers DROP COLUMN IF EXISTS self_schedule_mode;
-- ALTER TABLE public.provider_locations DROP CONSTRAINT IF EXISTS provider_locations_self_schedule_link_https;
-- ALTER TABLE public.provider_locations DROP COLUMN IF EXISTS self_schedule_link;
