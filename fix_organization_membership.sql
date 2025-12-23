-- ============================================
-- DIAGNOSTIC: Organization Membership Issue
-- ============================================
-- Este script diagnostica y soluciona el problema de membresía a organización

-- 1. Verificar el usuario actual autenticado
SELECT 
    auth.uid() as current_user_id,
    auth.email() as current_user_email;

-- 2. Listar todas las organizaciones disponibles
SELECT 
    id as organization_id,
    name as organization_name,
    created_at
FROM organizations
ORDER BY created_at DESC;

-- 3. Verificar si el usuario actual tiene membresía
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    o.name as organization_name,
    om.created_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

-- 4. Si no hay resultados arriba, ejecuta este INSERT para crear la membresía
-- IMPORTANTE: Reemplaza 'YOUR_ORG_ID_HERE' con el ID de tu organización del paso 2

/*
INSERT INTO organization_members (user_id, organization_id, role)
VALUES (
    auth.uid(),
    'YOUR_ORG_ID_HERE',  -- <-- REEMPLAZA ESTO con el organization_id del paso 2
    'admin'
);
*/

-- 5. Verificar que se creó correctamente
SELECT 
    om.user_id,
    om.organization_id,
    om.role,
    o.name as organization_name,
    om.created_at
FROM organization_members om
JOIN organizations o ON o.id = om.organization_id
WHERE om.user_id = auth.uid();

-- ============================================
-- NOTAS:
-- ============================================
-- Si no tienes ninguna organización (paso 2 vacío), primero crea una:
/*
INSERT INTO organizations (name, created_at)
VALUES ('Mi Organización', NOW())
RETURNING id;
*/
-- Luego usa ese ID en el INSERT del paso 4
