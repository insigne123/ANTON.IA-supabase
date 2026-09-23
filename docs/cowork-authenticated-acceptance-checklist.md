# Cowork: checklist de aceptación autenticada

Fecha: 23 de septiembre de 2026. Las partes 1–9 tienen implementación en `main` y despliegues previos; **no están aceptadas como recorridos reales**. Las cinco ejecuciones productivas registradas para el usuario habilitado son anteriores a las etapas 6–9. Auditoría técnica: `docs/cowork-audit-2026-09-23.md`. Las comprobaciones de esta lista requieren sesión del usuario en los proveedores y observación del resultado, no solo un deploy.

Cuentas controladas: `nicolas.yarur.g@yago.cl` ↔ `nicogun123@gmail.com`. Nunca prospectos arbitrarios. Sin envíos masivos.

## Sesión A · Chat desplegado (partes 1, 2, 3)

- [ ] A1 · `lists.review_contact` sobre un contacto real: correo verificado, duplicados, restricciones y prioridad correctos (2.1, 2.3, 2.4, 2.6).
- [ ] A2 · Revisar `docs/cowork-grupoexpro-public-commercial-proposal.md` con las páginas públicas de GrupoExpro; aprobar solo afirmaciones/voz/servicios que el equipo quiera usar, configurar el contexto mediante `message_context.update` y comprobar `message.check_terms` (3.1–3.5, 3.9). El borrador público no es un contexto aprobado.
- [ ] A3 · Borrador generado con el estilo por defecto y pedido según rol; corrección en cascada ante un cambio del usuario (3.3, 3.8).

## Sesión B · Correo controlado (parte 4 + 8.3)

- [ ] B1 · Lote de prueba únicamente a `nicogun123@gmail.com`: espaciado, registro por toque y plan de 7 visible en `campaigns.batch_report` (4.1, 4.2); ejecutar los 7 toques requiere observación en el tiempo y aprobación separada (4.4).
- [ ] B2 · `campaigns.next_touch` y `retry_review` sobre el lote real (4.5, 4.6).
- [ ] B3 · Respuesta desde la segunda dirección: freno por cuenta detiene seguimientos (4.7).
- [ ] B4 · `deliverability.sender` sobre los envíos reales: From y Authentication-Results coinciden con lo declarado (8.3).
- [ ] B5 · `deliverability.check` sobre el dominio remitente real (8.1).

## Sesión C · LinkedIn real (parte 5)

- [ ] C1 · Extensión emite `network-report` e `inbox-report` reales; `linkedin.network`/`linkedin.inbox` con cobertura completa (5.1, 5.2). **La UI actual del panel no ofrece un control de barrido de red/bandeja:** abrir la extensión o pulsar «Sincronizar historial de LinkedIn» solo sincroniza envíos y no acredita esta casilla.
- [ ] C2 · Invitación sin nota ante perfil verificado, confirmada solo con estado Pendiente observado (5.3, 5.5).
- [ ] C3 · Segundo contacto a un no respondedor con 7+ días e información nueva (5.7).

## Sesión D · Respuestas y medición (partes 6, 7, 9)

- [ ] D1 · `replies.attention`, `replies.stalled`, `contacted.account` y `replies.meeting_chain` sobre respuestas reales (6.1–6.6).
- [ ] D2 · `metrics.rates` y `metrics.diagnose` con denominadores reales; `metrics.channels` cuando LinkedIn tenga resultados (7.1–7.3).
- [ ] D3 · `compliance.check` antes de cada contacto de prueba; `metrics.incidents` en cero críticos (9.3, 7.4).

## Cierre por función

Cada casilla se marca con fecha, quién la ejecutó y el identificador observado (run, lote, hilo o compromiso). Mientras no tenga evidencia, permanece pendiente de aceptación, aunque la implementación esté marcada 🟢 en el plan.
