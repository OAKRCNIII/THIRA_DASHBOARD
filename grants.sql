-- Grant access to thira + ants schemas for PostgREST roles
-- (RLS still locks data — these grants only allow schema-level access)

-- Schema usage
GRANT USAGE ON SCHEMA thira TO authenticated, anon, service_role;
GRANT USAGE ON SCHEMA ants  TO authenticated, anon, service_role;

-- Existing tables
GRANT ALL ON ALL TABLES IN SCHEMA thira TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ants  TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA thira TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA ants  TO authenticated, anon;

-- Sequences (for BIGSERIAL ids)
GRANT ALL ON ALL SEQUENCES IN SCHEMA thira TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ants  TO service_role;

-- Future tables created in these schemas
ALTER DEFAULT PRIVILEGES IN SCHEMA thira
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ants
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA thira
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ants
  GRANT ALL ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA thira
  GRANT SELECT ON TABLES TO authenticated, anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA ants
  GRANT SELECT ON TABLES TO authenticated, anon;

-- Enable RLS on tables (with permissive policy for service_role bypass)
-- service_role bypasses RLS automatically; anon/authenticated blocked by default
ALTER TABLE thira.trucks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE thira.outcomes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE thira.incomes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE thira.prices             ENABLE ROW LEVEL SECURITY;
ALTER TABLE thira.fuel_rates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE thira.prefix_factory_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE ants.containers          ENABLE ROW LEVEL SECURITY;
