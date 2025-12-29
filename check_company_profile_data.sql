-- Check antonia_config schema to see if it has company profile data
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'antonia_config'
ORDER BY ordinal_position;

-- Check if there's data in antonia_config
SELECT *
FROM antonia_config
WHERE organization_id = '289b6053-6e25-434d-b212-60df44c8cc3c';
