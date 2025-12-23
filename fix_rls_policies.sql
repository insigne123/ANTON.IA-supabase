-- ============================================
-- FIX: Row Level Security Policies
-- ============================================
-- Este script arregla las políticas RLS para organization_members

-- 1. Verificar si RLS está habilitado
SELECT 
    schemaname,
    tablename,
    rowsecurity as rls_enabled
FROM pg_tables
WHERE tablename = 'organization_members';

-- 2. Ver las políticas actuales
SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd,
    qual,
    with_check
FROM pg_policies
WHERE tablename = 'organization_members';

-- 3. Eliminar políticas existentes que puedan estar causando problemas
DROP POLICY IF EXISTS "Users can view their own organization memberships" ON organization_members;
DROP POLICY IF EXISTS "Users can view own memberships" ON organization_members;
DROP POLICY IF EXISTS "Enable read access for users" ON organization_members;

-- 4. Crear política correcta para permitir que los usuarios lean sus propias membresías
CREATE POLICY "Users can view their own organization memberships"
ON organization_members
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- 5. Verificar que la política se creó correctamente
SELECT 
    policyname,
    permissive,
    roles,
    cmd,
    qual
FROM pg_policies
WHERE tablename = 'organization_members';

-- 6. Probar que funciona
SELECT 
    user_id,
    organization_id,
    role
FROM organization_members
WHERE user_id = auth.uid();
