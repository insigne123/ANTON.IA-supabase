-- OPCIONAL: Resetear el contador de hoy si quieres volver a probar
-- (Solo ejecuta esto si quieres empezar de cero el conteo de hoy)

DELETE FROM antonia_daily_usage
WHERE date = CURRENT_DATE;

-- Verificar que se borró
SELECT * FROM antonia_daily_usage
WHERE date = CURRENT_DATE;
