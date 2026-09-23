# Cowork: checklist de aceptación autenticada

Fecha: 23 de septiembre de 2026. Todo el código de las partes 1–9 está en `main` y desplegado (rollouts `studio--90260`, `studio--96464`, `studio--21860` sobre `studio--leadflowai-3yjcy.us-central1.hosted.app`). Lo que sigue requiere sesión real del usuario y no puede certificarse de otra forma.

Cuentas controladas: `nicolas.yarur.g@yago.cl` ↔ `nicogun123@gmail.com`. Nunca prospectos arbitrarios. Sin envíos masivos.

## Sesión A · Chat desplegado (partes 1, 2, 3)

- [ ] A1 · `lists.review_contact` sobre un contacto real: correo verificado, duplicados, restricciones y prioridad correctos (2.1, 2.3, 2.4, 2.6).
- [ ] A2 · Contexto comercial real configurado (voz, oferta, afirmaciones con evidencia) y `message.check_terms` bloqueando un término prohibido real (3.1–3.5, 3.9).
- [ ] A3 · Borrador generado con el estilo por defecto y pedido según rol; corrección en cascada ante un cambio del usuario (3.3, 3.8).

## Sesión B · Correo controlado (parte 4 + 8.3)

- [ ] B1 · Lote de prueba a `nicogun123@gmail.com`: espaciado, registro por toque y cadencia de 7 visible en `campaigns.batch_report` (4.1, 4.2, 4.4).
- [ ] B2 · `campaigns.next_touch` y `retry_review` sobre el lote real (4.5, 4.6).
- [ ] B3 · Respuesta desde la segunda dirección: freno por cuenta detiene seguimientos (4.7).
- [ ] B4 · `deliverability.sender` sobre los envíos reales: From y Authentication-Results coinciden con lo declarado (8.3).
- [ ] B5 · `deliverability.check` sobre el dominio remitente real (8.1).

## Sesión C · LinkedIn real (parte 5)

- [ ] C1 · Extensión emite `network-report` e `inbox-report` reales; `linkedin.network`/`linkedin.inbox` con cobertura completa (5.1, 5.2).
- [ ] C2 · Invitación sin nota ante perfil verificado, confirmada solo con estado Pendiente observado (5.3, 5.5).
- [ ] C3 · Segundo contacto a un no respondedor con 7+ días e información nueva (5.7).

## Sesión D · Respuestas y medición (partes 6, 7, 9)

- [ ] D1 · `replies.attention`, `replies.stalled`, `contacted.account` y `replies.meeting_chain` sobre respuestas reales (6.1–6.6).
- [ ] D2 · `metrics.rates` y `metrics.diagnose` con denominadores reales; `metrics.channels` cuando LinkedIn tenga resultados (7.1–7.3).
- [ ] D3 · `compliance.check` antes de cada contacto de prueba; `metrics.incidents` en cero críticos (9.3, 7.4).

## Cierre por función

Cada casilla se marca con fecha, quién la ejecutó y el identificador observado (run, lote, hilo o compromiso). Una función pasa a 🟢 cuando su casilla tiene evidencia; este documento es esa evidencia.
