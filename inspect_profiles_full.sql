-- inspect_profiles_full.sql
-- 1. Ver estructura de la tabla profiles (columnas importantes)
SELECT 
    column_name, 
    data_type 
FROM information_schema.columns 
WHERE table_name = 'profiles'
  AND column_name IN ('id', 'full_name', 'username', 'job_title', 'role', 'company_name');

-- 2. Ver los datos del usuario "Nicolas Yarur" (buscando por nombre o ID si lo tenemos)
-- Usamos el ID validado anteriormente: de3a3194-29b1-449a-828a-53608a7ebe47
SELECT 
    id, 
    full_name, 
    job_title, 
    company_name, 
    email -- A veces útil para confirmar
FROM profiles 
WHERE id = 'de3a3194-29b1-449a-828a-53608a7ebe47';

-- 3. Ver si hay algún otro usuario que coincida el nombre
SELECT id, full_name, job_title, company_name 
FROM profiles 
WHERE full_name ILIKE '%Nicolas Yarur%';
