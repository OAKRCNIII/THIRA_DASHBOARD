-- ─────────────────────────────────────────────────────────────────────────
-- Atomic Container Sync (กัน race condition)
-- ─────────────────────────────────────────────────────────────────────────
-- ปัญหาเดิม: thira_sync.py ทำ DELETE แล้ว INSERT แยกกัน 2 ขั้น
-- ถ้า 2 sync รันพร้อมกัน (local watcher + GitHub Actions cron):
--   - sync A: DELETE all → INSERT 1707
--   - sync B: DELETE 1707 (ของ A) → INSERT 1707 ← เหลือ 1707, OK
--   - แต่ถ้า B's DELETE รันก่อน A's DELETE → ทั้ง 2 INSERT รัน → 3414 rows!
--
-- ทางแก้: รวม DELETE+INSERT เป็น atomic transaction + advisory lock
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION ants.sync_containers(rows_json jsonb)
RETURNS TABLE(deleted_count int, inserted_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ants, pg_temp
AS $$
DECLARE
    v_deleted int;
    v_inserted int;
BEGIN
    -- 1) Lock — สอง sync เรียกพร้อมกันจะถูก serialize (อันที่สองรอ)
    --    เลข lock เป็นค่าคงที่ของ "sync containers task" — ตั้งใจ unique
    PERFORM pg_advisory_xact_lock(847362001::bigint);

    -- 2) ลบของเก่าทั้งหมด (ใน transaction → atomic)
    --    หมายเหตุ: ต้องมี WHERE clause เพราะ pg-safeupdate policy ของ Supabase
    DELETE FROM ants.containers WHERE true;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    -- 3) Insert ใหม่จาก JSON
    INSERT INTO ants.containers (
        truck_plate, bundles, invoice_no, date_in, factory,
        vessel, container_no, weight, cado_no, date_pickup, status, source_row
    )
    SELECT
        (x->>'truck_plate')::text,
        NULLIF((x->>'bundles'),'')::int,
        (x->>'invoice_no')::text,
        NULLIF((x->>'date_in'),'')::date,
        (x->>'factory')::text,
        (x->>'vessel')::text,
        (x->>'container_no')::text,
        NULLIF((x->>'weight'),'')::numeric,
        (x->>'cado_no')::text,
        NULLIF((x->>'date_pickup'),'')::date,
        (x->>'status')::text,
        NULLIF((x->>'source_row'),'')::int
    FROM jsonb_array_elements(rows_json) x;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN QUERY SELECT v_deleted, v_inserted;
END;
$$;

-- ให้สิทธิ์ secret key เรียกได้
GRANT EXECUTE ON FUNCTION ants.sync_containers(jsonb) TO service_role;
