-- debug_user_org.sql
-- 1. Find the Organization ID for Nicolas Yarur
-- 2. Find a lead belonging to THAT organization.

WITH user_info AS (
    SELECT 
        u.id as user_id, 
        om.organization_id
    FROM profiles u
    JOIN organization_members om ON u.id = om.user_id
    WHERE u.id = 'de3a3194-29b1-449a-828a-53608a7ebe47'
)
SELECT 
    l.id as lead_id, 
    l.email, 
    l.organization_id as lead_org_id,
    u.organization_id as user_org_id
FROM leads l, user_info u
WHERE l.organization_id = u.organization_id
  AND l.email IS NOT NULL 
  AND l.company IS NOT NULL 
LIMIT 5;
