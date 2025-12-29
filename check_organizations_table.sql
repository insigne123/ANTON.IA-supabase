-- Check organizations table schema
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'organizations'
ORDER BY ordinal_position;

-- Check organization data
SELECT *
FROM organizations
WHERE id = '289b6053-6e25-434d-b212-60df44c8cc3c';
