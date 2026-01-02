-- Verificar la estructura de params en la misión
-- Para entender por qué userId es null

SELECT 
    id,
    title,
    params,
    params->>'userId' as user_id_extracted,
    user_id as mission_user_id,
    organization_id
FROM antonia_missions
WHERE id = 'ae1ec765-84ab-4906-b7b8-e3862273d630';
