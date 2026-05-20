-- ─────────────────────────────────────────────────────────────────────────
-- Add edit_token to line_pending_bills
-- ─────────────────────────────────────────────────────────────────────────
-- Security: LIFF page needs to fetch pending data via Supabase public REST API.
-- We don't want anyone with a known pending ID to access the data, so we add
-- a random UUID token. The LIFF URL contains both id + token.
--
-- Bot generates token when creating pending → only the user who got the LINE
-- message has the link → only they can open LIFF.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE thira.line_pending_bills
  ADD COLUMN IF NOT EXISTS edit_token uuid DEFAULT gen_random_uuid();

-- Set tokens for any pre-existing rows
UPDATE thira.line_pending_bills SET edit_token = gen_random_uuid() WHERE edit_token IS NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- RPC: fetch_pending_for_edit(id, token)
--   Used by LIFF page to read current pending data.
--   Returns NULL if id+token don't match OR if status != awaiting_edit/confirm.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION thira.fetch_pending_for_edit(
    p_id bigint,
    p_token uuid
)
RETURNS TABLE (
    id bigint,
    truck_plate text,
    date date,
    category text,
    amount numeric,
    liters numeric,
    note text,
    status text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = thira, pg_temp
AS $$
    SELECT
        b.id, b.truck_plate, b.date, b.category, b.amount, b.liters, b.note, b.status
    FROM thira.line_pending_bills b
    WHERE b.id = p_id
      AND b.edit_token = p_token
      AND b.status IN ('awaiting_edit', 'awaiting_confirm', 'awaiting_truck')
      AND b.created_at > NOW() - INTERVAL '24 hours'
    LIMIT 1;
$$;

-- Allow anon (publishable key) to call this — token acts as authentication
GRANT EXECUTE ON FUNCTION thira.fetch_pending_for_edit(bigint, uuid) TO anon;
