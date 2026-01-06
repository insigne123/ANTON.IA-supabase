-- Check if user has organization and if gmail.com is in excluded_domains
SELECT 
    u.id as user_id,
    u.email as user_email,
    om.organization_id,
    ed.domain,
    ed.created_at as domain_blocked_at
FROM auth.users u
LEFT JOIN organization_members om ON u.id = om.user_id
LEFT JOIN excluded_domains ed ON om.organization_id = ed.organization_id
WHERE ed.domain = 'gmail.com'
ORDER BY u.created_at DESC
LIMIT 10;

-- Also check all excluded domains
SELECT * FROM excluded_domains ORDER BY created_at DESC LIMIT 10;
