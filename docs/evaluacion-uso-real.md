# Evaluación con uso real

Califica cada sección de ANTON.IA por lo que la gente hace en producción, no solo por las pruebas. Lee Cowork en las conversaciones reales de cada persona.

## Qué mide

**Por organización y sección** (Buscar, Contactos, Investigación, Correos, Cowork, Oportunidades, Campañas, CRM, LinkedIn):

- quiénes la usaron y cuánto;
- si funciona: qué parte de los intentos termina bien. Hoy se mide en Investigación y Cowork, que son las secciones con intentos que pueden fallar;
- qué produjo: búsquedas, contactos guardados, enriquecimientos, investigaciones, borradores, envíos, respuestas.

**Señal de cada sección**, con reglas a la vista:

- **Sin uso:** nadie la usó.
- **Atención:** menos de 7 de cada 10 intentos terminan bien, o en un equipo de 5 o más personas la usa solo una.
- **Bien:** el resto.

**Por persona** (opcional, con `--people`): enriquecimientos primero, luego búsquedas, guardados, investigaciones, borradores, envíos y última actividad. Solo se comparte con la jefatura de cada equipo.

**Cowork, conversación por conversación**, con señales que se leen sin modelo:

- un turno falló;
- un turno tardó más de un minuto;
- repitió casi la misma respuesta;
- la persona mostró frustración («otra vez lo mismo», «no sirve»);
- un turno quedó sin respuesta;
- propuso algo para aprobar y no se ejecutó.

**Juez de Cowork** (opcional, con `--judge`): un modelo distinto al que responde califica cada respuesta con la misma pauta de la batería (`src/lib/cowork/judge.ts`). Ve la respuesta tal como apareció en pantalla, con sus tarjetas, y los datos que leyó el turno.

## Privacidad

- **Antes de calificar o escribir algo**, se quitan correos, teléfonos y RUT. Los nombres quedan, para que la conversación se pueda leer.
- **`data.json`** usa «Persona N» en vez de cada usuario.
- **Es de solo lectura:** llama las dos funciones del informe de uso y lee `cowork_runs` y `cowork_run_events`.
- **No carga archivos `.env`:** la clave de servicio va en el entorno de quien lo corre.

## Cómo correrlo

```sh
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [OPENAI_API_KEY=…] \
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-real-usage.ts --read-production \
  --from=2026-10-01 --to=2026-10-16 --orgs=<uuid>,<uuid> --output=/ruta/salida \
  [--people] [--exclude-domains=yago.cl] [--judge --judge-model=gpt-6-sol --max-calls=100]
```

Deja `report.md` (para leer) y `data.json` (las conversaciones, ya sin datos personales, con sus señales y notas).

## Límites conocidos

- **Desde cuándo hay detalle:** las visitas y acciones se registran desde el 10 de octubre de 2026; los créditos, desde antes.
- **Lo que el juez no ve:** el contexto interno del turno, como las propuestas pendientes o el perfil. Puede marcar como «sin respaldo» una cifra que sí venía de ahí.
- **Cuentas internas:** las de QA usan otra firma y otro mundo de prueba. Con `--exclude-domains` quedan fuera de las cifras de uso, pero sus conversaciones de Cowork se siguen leyendo.
