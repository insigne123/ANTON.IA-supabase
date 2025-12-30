-- test_random_lead_dry_run_v2.sql
-- Objetivo: Probar la función de investigación de leads (ENRICH -> INVESTIGATE -> CONTACT) en modo DRY RUN.
-- 1. Selecciona un lead aleatorio válido.
-- 2. Inserta una tarea 'ENRICH' para iniciar el flujo.
-- 3. Retorna el ID de la tarea creada para seguimiento.

WITH random_lead AS (
    SELECT 
        id, 
        email, 
        name, 
        company, 
        title, 
        linkedin_url, 
        mission_id, 
        organization_id
    FROM leads
    WHERE email IS NOT NULL 
      AND company IS NOT NULL 
      AND company != ''
    ORDER BY random()
    LIMIT 1 -- Just pick one
)
INSERT INTO antonia_tasks (
    mission_id,
    organization_id,
    type,
    status,
    payload,
    created_at
)
SELECT 
    mission_id,
    organization_id,
    'ENRICH',
    'pending',
    jsonb_build_object(
        'userId', 'de3a3194-29b1-449a-828a-53608a7ebe47', -- 🟢 ID de Nicolas Yarur (Hardcoded Valid)
        'dryRun', true, -- 🟢 IMPORTANTE: dryRun true para no enviar mail real
        'campaignName', 'Random Lead Dry Run Test v2',
        'enrichmentLevel', 'standard',
        'leads', jsonb_build_array(
            jsonb_build_object(
                'id', id,
                'email', email,
                'name', name,
                'company_name', company,
                'title', title,
                'linkedin_url', linkedin_url
                -- Si existiera 'website' en la tabla leads, agregarlo aquí:
                -- 'website', website
            )
        )
    ),
    NOW()
FROM random_lead
RETURNING id as created_task_id;

-- ==============================================================================
-- 🔍 CONSULTAS PARA VERIFICAR LOS RESULTADOS (Ejecutar después de unos segundos)
-- ==============================================================================

-- 1. Ver el estado de la tarea ENRICH que acabas de crear:
-- SELECT * FROM antonia_tasks WHERE id = '<COPIA_EL_ID_DE_ARRIBA>';

-- 2. Ver la tarea de INVESTIGATE que se generó (verifica los datos de entrada):
-- SELECT id, type, status, payload, result, created_at 
-- FROM antonia_tasks 
-- WHERE type = 'INVESTIGATE' 
-- ORDER BY created_at DESC 
-- LIMIT 1;

-- 3. Ver la tarea de CONTACT (Final) y el MAIL generado (en payload o result):
-- SELECT id, type, status, payload, result, created_at 
-- FROM antonia_tasks 
-- WHERE type = 'CONTACT' 
-- ORDER BY created_at DESC 
-- LIMIT 1;

-- Nota: Revisa el campo `result` o `payload` de la tarea CONTACT para ver el cuerpo del email.
