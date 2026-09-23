# Etapa 8 · Entregabilidad — cierre

Fecha: 23 de septiembre de 2026. Migración `20260923030000_deliverability_cache` aplicada y verificada en producción (tabla con RLS solo `service_role`, 0 filas).

Regla de cierre aplicada: cada función quedó conectada al agente (3 lecturas nuevas en el catálogo Cowork), respeta el alcance (dominios validados antes del DNS, buzón propio, errores genéricos) y produce un resultado comprobable. Detalle de pruebas en `src/lib/deliverability.test.ts` y `src/lib/server/cowork/deliverability-reads.test.ts`.

## 8.1 SPF, DKIM, DMARC y MX — cerrada

- Lectura `deliverability.check` (entrada: dominio desnudo, validación estricta; cualquier otra cosa se rechaza antes de tocar el DNS).
- DNS en vivo desde el servidor con timeout de 6 s por consulta: MX, TXT del dominio (SPF), TXT de `_dmarc` (DMARC) y 10 selectores DKIM comunes en paralelo.
- Calificación honesta: SPF estricto/blando/neutral/+all, DMARC reject/quarantine/none/ausente, DKIM encontrado o `unknown` (un selector personalizado seguiría siendo posible: la ausencia en la lista común nunca es un pass).
- Caché de 24 h por organización (`cowork_deliverability_checks`); la lectura declara `source: live|cache` y `checkedAt`.
- Pruebas: validación de dominios (URLs e inyecciones rechazadas), calificación SPF/DMARC/DKIM/MX, caché fresca sin DNS, errores genéricos.

## 8.2 Causas de rebote — cerrada

- Lectura `deliverability.bounces`: rebotes de 30 días contra el umbral del 2% con veredicto `above_threshold/below_threshold/no_data`, causas por categoría con su acción (`do_not_contact_fix_email`, `review_deliverability`, `retry_later`, `monitor`) y top-5 de dominios destinatarios agregados (sin buzones individuales).
- Pruebas: causas con acciones, umbral, agregación por dominio sin partes locales.

## 8.3 Remitente declarado vs real — cerrada

- Lectura `deliverability.sender`: identidad declarada (`profiles`: email, nombre, dominio) contra cabeceras `From`, `Return-Path` y `Authentication-Results` (spf/dkim/dmarc) de los últimos 5 envíos reales con identificador, por Gmail y Outlook.
- Veredicto `consistent/inconsistent/unverified`; la diferencia con el perfil se explica (cuenta distinta vs dominio ajeno), no se alarma.
- Pruebas: contraste match/differs/unverified con mocks.

## Verificación ejecutada

- Unit: 8 (constructores) + 6 (lectores) en verde.
- PGlite aislado: `scripts/test-deliverability-migrations.mjs` PASS (tabla, RLS, PK, upsert, dominio vacío rechazado).
- `typecheck` limpio, `next build` OK (solo aviso preexistente `<img>`).
- Prod: tabla con RLS verificada. DNS en vivo corre recién con el despliegue.

## Límites declarados (no cerrados aquí)

- Verificación contra el dominio real del usuario y sus envíos: pendiente de despliegue + sesión (esta es la dependencia que el plan pedía: el envío de prueba a la cuenta controlada sigue siendo el contraste definitivo).
- DKIM con selector personalizado requiere que el usuario lo indique; la lectura lo declara `unknown`, no lo inventa.
- Una falla transitoria de DNS se ve como registro ausente; la caché solo guarda resultados consultados y expira en 24 h.
