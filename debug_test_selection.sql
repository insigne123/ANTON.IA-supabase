-- debug_test_selection.sql
-- Run the exact selection logic from the test script to see if it returns data
SELECT 
    l.id as lead_id,
    l.email,
    p.id as user_id,
    p.full_name as user_name
FROM leads l, profiles p
WHERE l.email IS NOT NULL 
  AND l.company IS NOT NULL 
  AND l.company != ''
  AND p.id = 'de3a3194-29b1-449a-828a-53608a7ebe47'
LIMIT 5;
