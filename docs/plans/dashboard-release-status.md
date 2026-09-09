# Entrega del dashboard y pendientes — 2026-09-09

## Fuente canónica

`main` es la fuente de integración. El commit `7d84848` contiene el dashboard
con Mis créditos y la retirada de textos Apollo en búsqueda, leads guardados,
enriquecimiento y SUPL.IA. Los identificadores de integración y el endpoint
`/api/apollo/credits` se mantienen por compatibilidad.

## Consolidado en código

- Dashboard con pulido conservador, métricas y tarjeta Mis créditos.
- Cupo personal desde `/api/quota/status`; el saldo de equipo no sustituye al personal.
- En modo híbrido se muestra el personal y se avisa si el equipo condiciona el uso.
- Respuestas de cuota incompletas o inválidas muestran error, no un saldo inventado.
- Contactos: límite por defecto de 50 al día, con tests actualizados.
- Investigaciones: el default de 50 pertenece al cupo compartido con búsqueda y
  enriquecimiento. **No son 50 investigaciones adicionales independientes.**
- Las políticas administrativas y overrides explícitos conservan precedencia.

## Producción: publicación pendiente de reconciliación

Verificación por la API de Firebase App Hosting en esta sesión:

| Rollout | Estado | Observación |
| --- | --- | --- |
| build-2026-09-09-017 | SUCCEEDED (verificación anterior) | Publicó `7d84848`. |
| build-2026-09-09-020 | SUCCEEDED | Actualizado a las 20:53:45 UTC. |
| build-2026-09-09-021 | SUCCEEDED | Actualizado a las 21:05:19 UTC. |

Los posteriores reemplazaron el despliegue 017. El registro de campañas
(`bulk-campaigns-deployment-status.md`) documenta una publicación desde una copia
aislada detached sin integrar en main. No se ha verificado el contenido completo
del ZIP activo. No atribuir todo el retroceso a caché ni afirmar que main está publicado.

**No republicar una copia antigua de main ni restaurar 017 a ciegas:** puede retirar
las funcionalidades de campañas que ya están desplegadas. En esta entrega no se
ejecutó otro rollout ni se modificó la base de datos.

## Pendientes, en orden

1. **Integración y publicación:** cotejar el archivo fuente del rollout activo con
   main; integrar el conjunto ya publicado, revisar dependencias y ejecutar sus
   pruebas. Evitar un `git add .` del workspace con trabajo concurrente.
2. **Límites solicitados:** confirmar y aplicar, si se requiere, 50 investigaciones
   independientes por usuario y 50 contactos estrictos para todas las cuentas.
   Cambiar defaults no modifica políticas existentes ni el alcance de las cuotas.
3. **Verificación final:** probar dashboard autenticado, saldo personal, modo equipo,
   error/carga, claro/oscuro y móvil; compilar el conjunto integrado de main.
4. **Despliegue único:** publicar App Hosting desde main integrado; esperar SUCCEEDED
   y comprobar el dashboard servido antes de anunciar producción actualizada.
   No desplegar Functions ni cambiar feature flags como parte del dashboard.
5. **Dominio personalizado:** confirmar dominio y control DNS; comprobar vinculación
   real en App Hosting y configurar autenticación/callbacks antes del cambio de URL.
   `app.antonia.ai` no resolvía por DNS en la revisión anterior; su presencia en código
   no acredita una asociación en Firebase.
6. **Extensión:** el texto Completar datos está en el panel local, cuya implementación
   tiene trabajo independiente pendiente de integrar. Revisar el artefacto publicado
   según `../linkedin-extension-release-status.md` antes de dar por publicada esta copia.

## Otros trabajos presentes en el workspace

No forman parte de la entrega del dashboard y no se borran ni se incluyen automáticamente:

- Campañas masivas y migraciones: `bulk-campaigns-deployment-status.md` y
  `bulk-campaigns-implementation-status.md`.
- Investigación e informes: `../report-questionnaire-integration-status.md`,
  `../shared-public-company-research.md`, `../report-v2-luna-terra-validation.md`.
- Redacción, correo y plantillas: `../outreach-implementation-status.md`.
- Extensión: `../linkedin-extension-release-status.md`.

Estos documentos son registros de sus trabajos, no una certificación conjunta de release.

## Validación de esta entrega

- Node 22.23.2.
- `npm run typecheck`: aprobado.
- ESLint en UserCreditsCard y el módulo/test de saldo personal: aprobado.
- 29 pruebas unitarias de saldo personal, defaults y cuotas: aprobadas mediante
  `scripts/run-node-tests.mjs`, con entorno de pruebas aislado.
- No se ejecutó una prueba visual autenticada ni se validó un build del conjunto
  pendiente de reconciliar. Ambas verificaciones siguen pendientes antes de publicar.
