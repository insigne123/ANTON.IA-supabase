# Etapa 9 · Cumplimiento y límites — cierre

Fecha: 23 de septiembre de 2026. Sin migración: guards en código y lecturas sobre tablas existentes.

Regla de cierre aplicada: cada función quedó conectada al agente, respeta el alcance y produce un resultado comprobable. Detalle de pruebas en `src/lib/compliance.test.ts`, `src/lib/server/cowork/compliance-reads.test.ts`, `src/lib/server/campaign-send-guards.test.ts`, `src/lib/server/bulk-campaign-sender.test.ts` y `src/lib/server/campaigns-v2/follow-up-auto-sender.test.ts`.

## 9.1 Legalidad vigente — cerrada

- Lectura `compliance.law`: jurisdicción CL, revisión 2026-09-23, Ley 19.628 (D.O. 28-08-1999, vigente hasta el 30-11-2026: autorización o consentimiento, excepción de fuente pública, oposición a publicidad) y Ley 21.719 (D.O. 13-12-2024, vigencia 01-12-2026: Agencia, ARCO+P, sanciones; el Gobierno evaluaba postergar a ago-2026, por eso se manda verificar el texto vigente). Fuentes: BCN leychile, informe BCN 12-25, DT. Información general, no asesoría legal.
- Pruebas: jurisdicción, leyes, fechas y fuentes presentes.

## 9.2 Regulación del comprador — cerrada

- Lectura `compliance.obligation`: base para todo empleador (Ley Karin 21.643, Ley 21.719) + KB por industria desambiguada (salud, minería, banca, retail, sector público, manufactura) con ley, fechas, cargos presionados y fuente. Industria desconocida → solo base, nunca invento.
- Pruebas: desambiguación, base mínima, campos obligatorios por obligación.

## 9.3 Límites transversales — cerrada

- `findPersonFrequencyHold` en `campaign-send-guards.ts`: 1/día, 3/7d, 8/40d, fail-closed ante historial incompleto. La cadencia canónica (0/2/4/4/5/7/15) nunca lo activa sola: probado.
- Cableado antes del proveedor en los tres motores: lotes (`BULK_CAMPAIGN_PERSON_FREQUENCY`, `BULK_CAMPAIGN_DOMAIN_EXCLUDED`), V2 automática (`person_frequency_hold`, `company_replied`, `account_negotiation`, `domain_excluded` + rechequeo pre-proveedor) y Cowork (`company_replied`, `account_negotiation`, `person_frequency_hold`). De paso se cerró 2.4: `excluded_domains` ahora rige en todos los motores.
- Lectura `compliance.check` (UUID de contacto): baja, do_not_contact, dominio excluido, frecuencia, empresa-día (Santiago) y respuesta, con veredicto allow/defer/block y próxima fecha elegible.
- Topes por defecto pendientes de decisión de la jefatura (`contact-policy/v1`).
- Pruebas: frecuencia por ventana, cadencia canónica, dominios exactos sin subdominios, secuencias de guards en bulk, allow/block/defer del check.

## Pendientes 1–5 (lo ejecutable sin sesión)

- **Despliegue al día:** todo lo de las partes 1–9 está en `main` y en producción; los "sin desplegar" anteriores quedaron obsoletos.
- **2.4 cerrada** con el cableado transversal de dominios excluidos.
- **Checklist autenticado:** `docs/cowork-authenticated-acceptance-checklist.md` con sesiones A–D, casilla por función pendiente y cuentas controladas. Sin sesión real (LinkedIn, envíos, buzón, materiales) esas casillas no pueden marcarse desde aquí.

## Verificación ejecutada

- Unit: 28 en verde (5 compliance + 4 lectores + guards + bulk + auto-sender).
- `typecheck` limpio; `next build` OK (solo aviso preexistente `<img>`).

## Límites declarados

- Topes de frecuencia por defecto; si la jefatura los cambia, se versionan.
- Aceptación autenticada pendiente según checklist; la V2 automática y Cowork comparten guards pero cada motor conserva sus códigos de error propios.
