# Cowork fase 5: aceptación de ejecución por LinkedIn (5.1–5.7)

Fecha: 22 de septiembre de 2026. Estado: implementado en local + migración aplicada en producción. Cambios de app y extensión sin desplegar; sesión real de LinkedIn pendiente (bloqueo explícito de la especificación).

## Alcance

Operar LinkedIn desde Cowork con lectura verificable, trabajos en cola con revisión humana y resultados confirmados solo en destino. La ejecución ocurre exclusivamente en el navegador del usuario ante el perfil verificado; nada se auto-envía y lo incierto nunca se reintenta solo.

## Por función

| ID | Función | Implementación | Verificación |
|---|---|---|---|
| 5.1 | Leer la red y detectar contactos nuevos | `linkedin.network`: pares reportados por la extensión + `sweep_state` durable; sin barrido completo no se afirma quién es nuevo | 5 pruebas + reporte acotado (máx 200/página) |
| 5.2 | Auditar toda la bandeja | `linkedin.inbox` con paginación declarada (`cursor`/`hasMore`); `pendingCounts` solo con barrido completo, si no `null` + aviso | 5 pruebas (incompleto no concluye) |
| 5.3 | Enviar invitaciones sin nota | Efecto `linkedin.invite` (identidad + cupo + duplicado) → trabajo en cola → reclamo atómico → flujo DOM `PROSPECT_EXECUTE_INVITE` → `linkedin-job-result` | Aislado (10 pasos) + DOM JSDOM (4) + ruta (2) |
| 5.4 | Enviar mensajes en volumen | Efecto `linkedin.message` con los mismos frenos + 1/día/perfil; ejecución reutiliza `PROSPECT_EXECUTE_SEND` con `operationId=jobId` (deduplicación compartida con el panel) | Aislado + panel con sección Trabajos de Cowork |
| 5.5 | Verificar identidad antes de enviar | `verifyLinkedinIdentity`: URL canónica exacta + cruce slug/nombre; conflicto rechaza con mensaje explícito | 7 pruebas puras (incluye caso Apollo Marco/JANET) |
| 5.6 | Controlar cupo de invitaciones | `linkedin.quota` cuenta pendientes (cola+reclamadas) + confirmadas 7d contra límite operativo 100/sem; staging rechaza con cupo cubierto | Puras + modelo frena con 100/100 |
| 5.7 | Segundo contacto a no respondedores | `linkedin.followups`: envío confirmado, sin respuesta entrante, sin negociación, 7 días de espera, contenido nuevo exigido en revisión | 5 pruebas + elegibilidad pura |

## Garantías transversales

- Programar no es enviar: `linkedin_invite`/`linkedin_message` nunca se auto-aprueban; la cola vence en 7 días sin auto-ejecución.
- Confirmación solo con evidencia en destino (evento LinkedIn para mensajes, estado Pendiente para invitaciones); clics o aperturas no confirman nada.
- Lecturas acotadas con cobertura declarada; errores y truncados no certifican ausencia.
- Migración `20260922050000` aplicada y verificada (5 tablas, RLS solo `service_role`, vacías; vocabulario ampliado). Sin datos de prueba ni cambios de permisos.

## Limitaciones conocidas (bloquean la certificación integral)

- **Sesión real de LinkedIn**: el flujo DOM de invitación y la superficie del panel están implementados y probados con DOM simulado, pero exigen verificación con el DOM real y sesión vigente. Sin esto, nada de esta parte puede certificarse (dependencia declarada en la especificación).
- Los reportes de red/bandeja dependen de que la extensión los emita; hoy las lecturas declaran cobertura ausente.
- El límite 100/sem es una estimación operativa observada, no oficial de LinkedIn.
- Segundos contactos con respuestas fuera de la bandeja sincronizada no son visibles (parte 6).
- Sin despliegue de app ni distribución de la extensión actualizada; aceptación autenticada pendiente.

## Verificación ejecutada

- `npm run typecheck`, `npm run build`, `node scripts/verify-cowork.mjs` (exit 0, incluye `test-cowork-linkedin-jobs.mjs`).
- `npm run extension:test` 63/63 (incluye `invite.test.mjs` con 4 y `connection-recovery` actualizado a 4 scripts).
- Nuevas: `linkedin-bridge.test.ts` (7), `linkedin-bridge-ops.test.ts` (5), `linkedin-reads.test.ts` (5), `test-cowork-linkedin-jobs.mjs` (10 pasos), ruta extensión (+2).
- Modelo real (`gpt-5.6-luna`, `scripts/evaluate-cowork-linkedin.ts --live`, solo lectura, ~38 llamadas en 6 corridas): 4/4 final (cupo frena, propuesta con firma real, bandeja incompleta sin conteos, cola ≠ envío). La iteración corrigió instrucción de cupo previo, firma con nombre real vía `profile.get`, consulta de `linkedin.jobs` ante dudas de entrega y stubs de contexto de mensaje.
- Resultados en `docs/cowork-linkedin-results.json` y `docs/cowork-linkedin-audit-1790099672978.json` (final).
