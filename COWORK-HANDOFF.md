# Instrucciones para continuar: mejorar la IA de Cowork con el modelo real

Lee este archivo completo antes de tocar código. Escribe al usuario en español de Chile.

> **Estado (25 sep 2026, segunda sesión):** los pasos de abajo ya se hicieron. Con gpt-6-luna y el mismo código, los prompts nuevos pasan 13 y 13 de 14 casos (166 de 168 verificaciones; los originales, 1 y 0 de 14), y 42 de 42 en tres repeticiones más. Además se probó Cowork como usuario en la app local y se corrigió por qué el hilo no continuaba después de aprobar. Resultados, cambios y pendientes: `docs/cowork-evaluacion-conversaciones-2026-09-25.md`.

## Contexto

- **App:** ANTON.IA. Next.js 15, Supabase y Firebase App Hosting. Las reglas del repo están en `AGENTS.md`; léelas y respétalas.
- **Qué contiene este zip:** la app original con dos trabajos ya aplicados:
  1. Rediseño de Cowork con la paleta y la tipografía de ANTON.IA.
  2. Mejoras de IA después de evaluar 12 conversaciones reales en producción. El resultado está en `docs/cowork-evaluacion-conversaciones-2026-09-25.md` y las transcripciones y notas en `docs/cowork-evaluacion-transcripciones-2026-09-25.md`.
- **Qué falta:** estas mejoras nunca se probaron contra el modelo real, porque la sesión anterior no tenía acceso a `api.openai.com`. Este entorno debería tener `OPENAI_API_KEY` y `COWORK_MODEL=gpt-6-luna`.
- **Formato de archivos:** todo el repo usa finales de línea CRLF. Al editar, conserva CRLF; si los cambias, git mostrará archivos completos como modificados.

## Archivos clave

| Archivo | Rol |
|---|---|
| `src/lib/cowork/agent-instructions.ts` | Prompt principal. Las secciones «CÓMO RESPONDER» y «CÓMO TRABAJAR» son las nuevas. |
| `src/lib/cowork/commercial-behavior.ts` | Reglas comerciales |
| `src/lib/cowork/decision-context.ts` | Contexto enviado al modelo: reloj local, glosario y `rejectedDecisions` |
| `src/lib/cowork/agent-loop.ts` | Bucle de decisiones. Las decisiones rechazadas vuelven al modelo y las notas acompañan las propuestas. |
| `src/lib/cowork/answer-quality.ts` | Verificador de respuestas y limpieza de códigos internos |
| `scripts/fixtures/cowork-conversation-corpus.ts` | 14 casos reales, con sus verificaciones y el puntaje que tuvo producción |
| `scripts/evaluate-cowork-conversations.ts` | Evaluación con el modelo real |

## Pasos

1. **Prepara el proyecto:**
   - `npm ci`
   - `curl -sS -o /dev/null -w "%{http_code}\n" https://api.openai.com/v1/models -H "Authorization: Bearer $OPENAI_API_KEY"` debe devolver 200.
   - Si devuelve 000 o 403, avisa al usuario que falta permitir `api.openai.com` en la red del entorno y detente.
2. **Verifica sin modelo:**
   - `npx tsc --noEmit -p tsconfig.json`
   - `npm run test:unit`
   - `node --loader ./scripts/ts-test-loader.mjs --test scripts/cowork-conversation-corpus.test.ts`
3. **Mide la línea base con los prompts antiguos:**
   - Los prompts antiguos están en `docs/cowork-prompts-originales/*.ts.txt`.
   - Cópialos temporalmente sobre `src/lib/cowork/agent-instructions.ts` y `src/lib/cowork/commercial-behavior.ts`, guardando antes los nuevos.
   - Corre `node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=120 --repeat=2 --output=eval-base.json`.
   - Restaura los prompts nuevos.
4. **Mide la versión nueva:**
   ```
   node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts --live --max-calls=120 --repeat=2 --output=eval-nuevo.json
   ```
5. **Itera hasta que pasen al menos 12 de 14 casos en las dos repeticiones:**
   - Lee las respuestas reales en `eval-*.json`. No te quedes solo con PASS/FAIL.
   - Ajusta el prompt con cambios pequeños y específicos. No lo alargues sin necesidad: hoy tiene ~10.500 tokens y el modelo es pequeño.
   - Repite la medición después de cada cambio.
   - No debilites las verificaciones del corpus para que pasen. Si una verificación está mal escrita, corrígela y explica el motivo.
6. **Criterios que importan al usuario** (vienen de la evaluación):
   - Respuesta directa y con datos.
   - Lenguaje simple, sin palabras internas como «cobertura», «registros de la app», «barrido» o «last_30_days».
   - Siempre un siguiente paso concreto.
   - No preguntar lo que se puede consultar.
   - No repetir acciones que ya fallaron.
   - Propuestas con una explicación.
   - Fechas en hora de Chile.
7. **Entrega al usuario:**
   - Tabla antes/después: casos aprobados, verificaciones aprobadas, respuestas con problemas y llamadas usadas.
   - El parche nuevo y los archivos modificados.
   - Actualiza la sección «Límites y pendientes» del informe de evaluación.

## Reglas de seguridad

- No toques producción, la base de datos ni proveedores externos. La evaluación usa fixtures y solo llama al modelo.
- No cargues `.env.local` en pruebas.
- Nunca muestres ni registres la API key.
- Si el usuario pide probar en producción: solo campañas y envíos a nicogun123@gmail.com, máximo 10 enriquecimientos, y las búsquedas e investigaciones están permitidas. Antes de aprobar cualquier campaña, confirma que el único destinatario es esa dirección.

## Pendientes conocidos

- **Continuación después de aprobar:** corregida. La llamada a `cowork_admit_followup` era ambigua (PGRST203) porque la base tiene la versión de 6 y la de 7 parámetros. Después del deploy, confirma que no aparecen nuevos `[cowork] continuation not admitted`.
- **Campaña de prueba:** nicogun123@gmail.com debe estar guardado como contacto antes de crearla.
- **`scripts/test-cowork-start-research.mjs`:** corregido; `node scripts/verify-cowork.mjs` pasa completo.
- **Remontaje global de `AuthContext`, entorno local y avatar:** ver «Límites y pendientes» del informe.
