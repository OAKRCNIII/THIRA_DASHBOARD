-- ให้ตู้ที่ mirror ลง THIRA พกท่ามาด้วย (PADANG / SONGKHLA / LCB)
ALTER TABLE ants.containers
  ADD COLUMN IF NOT EXISTS port text NOT NULL DEFAULT 'PADANG';

COMMENT ON COLUMN ants.containers.port IS
  'ท่าที่รับ/คืนตู้ — มาจาก containers_all.source ฝั่ง ANTS (PADANG/SONGKHLA/LCB)';

CREATE INDEX IF NOT EXISTS containers_port_idx ON ants.containers (port);

-- RPC เดิมมีรายชื่อคอลัมน์ตายตัว → ต้องเพิ่ม port ไม่งั้นค่าที่ส่งมาหายเงียบ
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
    PERFORM pg_advisory_xact_lock(847362001::bigint);

    DELETE FROM ants.containers WHERE true;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    INSERT INTO ants.containers (
        truck_plate, bundles, invoice_no, date_in, factory,
        vessel, container_no, weight, cado_no, date_pickup, status, source_row, port
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
        NULLIF((x->>'source_row'),'')::int,
        COALESCE(NULLIF((x->>'port'),''), 'PADANG')
    FROM jsonb_array_elements(rows_json) x;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    RETURN QUERY SELECT v_deleted, v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION ants.sync_containers(jsonb) TO service_role;
-- sync 2 ตัววิ่งคนละแหล่ง: cron อ่าน ANTS (ทุกท่า) · watcher ในเครื่องอ่าน Excel (ปาดังอย่างเดียว)
-- ถ้าตัวที่อ่าน Excel ลบทั้งตาราง ตู้สงขลา/แหลมฉบังจะหายจนกว่า cron จะรันรอบถัดไป
-- → ให้ลบเฉพาะท่าที่แหล่งนั้นรับผิดชอบ (scope_ports = NULL แปลว่าทุกท่า)
CREATE OR REPLACE FUNCTION ants.sync_containers(rows_json jsonb, scope_ports text[] DEFAULT NULL)
RETURNS TABLE(deleted_count int, inserted_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ants, pg_temp
AS $$
DECLARE
    v_deleted int;
    v_inserted int;
BEGIN
    PERFORM pg_advisory_xact_lock(847362001::bigint);

    DELETE FROM ants.containers
     WHERE scope_ports IS NULL OR COALESCE(port, 'PADANG') = ANY(scope_ports);
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    INSERT INTO ants.containers (
        truck_plate, bundles, invoice_no, date_in, factory,
        vessel, container_no, weight, cado_no, date_pickup, status, source_row, port
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
        NULLIF((x->>'source_row'),'')::int,
        COALESCE(NULLIF((x->>'port'),''), 'PADANG')
    FROM jsonb_array_elements(rows_json) x;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    RETURN QUERY SELECT v_deleted, v_inserted;
END;
$$;

GRANT EXECUTE ON FUNCTION ants.sync_containers(jsonb, text[]) TO service_role;
