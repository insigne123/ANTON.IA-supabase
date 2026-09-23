# Etapa 7 · Medición — cierre

Fecha: 23 de septiembre de 2026. Sin migración: capa de solo lectura sobre tablas existentes. Sintaxis PostgREST riesgosa (`select=data->commitment`, `or` con `gte`) verificada contra producción con lecturas `limit 1` antes de desplegar.

Regla de cierre aplicada: cada función quedó conectada al agente (4 lecturas nuevas en el catálogo Cowork), respeta el alcance (organización, consultas acotadas, errores genéricos) y produce un resultado comprobable (período, denominador y origen por cifra). Detalle de pruebas en `src/lib/metrics.test.ts` y `src/lib/server/cowork/metric-reads.test.ts`.

## 7.1 Tasas de respuesta, rebote y reunión — cerrada

- Lectura `metrics.rates`: ventanas 7 y 30 días con `sent`, `humanReplies`, `positives`, `meetingsRequested`, `autoReplies`, `bounces`, `unsubscribed`, `meetingsConfirmed` y tasas `reply/positive/meeting/bounce/unsubscribe`, cada una con `{value, numerator, denominator, unit: per_contact, period, source}`.
- `null` significa sin envíos, nunca cero. Reuniones solo desde compromisos `meeting` completados (`contacted_leads:data.commitment`); automáticas y rebotes nunca inflan la tasa humana.
- Pruebas: denominadores nulos, partición humano/auto/rebote en ambas ventanas, solo reuniones `meeting` completadas.

## 7.2 Diagnosticar bajo rendimiento — cerrada

- Lectura `metrics.diagnose`: 5 hipótesis con veredicto `supported/contradicted/inconclusive/untestable`, evidencia numérica y su límite:
  - `deliverability` (rebotes vs umbral 2%), `auto_noise`, `provider_gap` (brecha ≥3 pp con n≥10 por proveedor), `followup_gap` (interesados sin seguimiento, reutiliza `replies.stalled`).
  - `message_length` siempre `untestable`: no hay vínculo largo-de-borrador→respuesta por contacto, así que no se puede probar ni descartar. Es la lección del caso real convertida en contrato.
- Toda hipótesis carga su advertencia: correlación observada, no causa demostrada.
- Pruebas: veredictos con muestra suficiente e insuficiente.

## 7.3 Comparar canales — cerrada

- Lectura `metrics.channels`: email (tasas de 7.1) vs LinkedIn (envíos confirmados de jobs+sends, hilos entrantes, pendientes, cobertura de barrido).
- Veredicto `not_comparable` salvo n≥10 por canal en la misma ventana; `audiencias_distintas_no_verificadas` siempre presente. La función nunca declara un canal ganador.
- Estado real: LinkedIn sin envíos confirmados en producción (jobs/sends/threads en 0), así que hoy el veredicto es `not_comparable` con `linkedin_sin_envios_confirmados`. Atribución declarada como regla con huecos explícitos.
- Pruebas: línea base real (1143 envíos) contra LinkedIn vacío → `not_comparable` sin palabra de ganador.

## 7.4 Detectar fallas sistémicas — cerrada

- Lectura `metrics.incidents` con 6 chequeos, cada uno con severidad, conteo, muestra acotada y acción:
  - `steps_scheduled_for_replied` (alta), `active_enrollments_do_not_contact` (alta), `unclassified_backlog` (media), `sweep_errors` (media), `sync_error_states` (info), `open_exceptions` (info).
- Pruebas: combinación steps↔enrollments↔contactos con mocks.

## Verificación ejecutada

- Unit: 7 (constructores) + 5 (lectores) en verde.
- `typecheck` limpio, `next build` OK (solo aviso preexistente `<img>`).
- PostgREST real: `select=id,data->commitment` → 200 con clave `commitment`; `or=(sent_at.gte…,…)` → 200.
- Sin escrituras ni migración: nada que revertir en la base.

## Límites declarados (no cerrados aquí)

- Aceptación con cifras reales desde el chat desplegado: pendiente de despliegue + sesión del usuario.
- LinkedIn sin positivos ni reuniones vinculadas: la comparación seguirá cautelosa hasta que haya resultados vinculados.
- `metrics.overview` se conserva como resumen rápido; `metrics.rates` es la fuente con denominadores.
