-- Verificar el user_id exacto que se está usando
-- Este es el user_id que vemos en la consola del navegador
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    o.name as organization_name,
    om.created_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = 'de3a3194-29b1-449a-828a-53608a7ebe47';

-- Si el query de arriba está vacío, verifica TODOS los registros de organization_members
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    o.name as organization_name,
    om.created_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
ORDER BY om.created_at DESC
LIMIT 20;
