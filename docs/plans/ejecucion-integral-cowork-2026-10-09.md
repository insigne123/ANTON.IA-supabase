# Ejecución del plan integral de Cowork · 9 oct 2026

## Resultado y nivel de cierre

Se ejecutó el trabajo de código, evaluación controlada y verificación independiente disponible durante el encargo nocturno. **El programa completo todavía no está aceptado en producción:** faltan sesión legítima del dueño para recorridos autenticados, conformidad/activación de infraestructura por el mantenedor y validación con ejecutivos/material de equipo. No se sustituyen por simulaciones ni se declaran medidos.

Referencia: [plan integral](plan-integral-cowork-2026-10-09.md). Bases congeladas `25e18428` (evaluación inicial), `4e307302` (documentación entrante) y `b8ec6148` (runner integrado). El código inicial del programa quedó integrado en `main` `8300af8aed2e73aee648aee3009c6f5d5beea0ef`, con reporte/lectura completos en `bf917c11`. La comprobación read-only del 9 oct a las 17:24 UTC observa `studio-build-2026-10-09-001` con el 100 % del tráfico. La revisión del 8 oct queda como observación histórica; no se ejecutó un deploy en este encargo ni se infiere el SHA de fuente del runtime solo por su nombre.

## Entregas por ticket

| Ticket | Trabajo realizado | Cierre disponible / pendiente |
|---|---|---|
| CW-01 | Manifest, censo completo, solicitud congelada, fuente/config/hashes y faltantes explícitos | Harness y casos controlados; aceptación autenticada pendiente |
| CW-02 | Prompts, schema, observaciones y precio fijados; ledger compartido y uso incierto reservado | Pruebas de reserva/modelo/techo; factura no reconciliada |
| CW-03 | Listas propias hasta 500 y compatibilidad consulta/panel/export | Fronteras 0/1/20/21/25/26/45/500 verificadas |
| CW-04 | Resolver de edición ligado al original y handoff con ID | Chrome: preview/copy/use coinciden; fuentes guardadas detectan drift |
| CW-05 | Tablas distintas conservadas y filas/columnas completas acotadas | Tests de dedupe y overflow preservado |
| CW-06 | Error de descarga junto a acción, retorno móvil, Stop mientras se escribe | DOM/Chrome; revisar shell completo autenticado |
| CW-07 | Brief compartido en chat, nativo y reply; 14 competencias versionadas, hasta tres pertinentes por turno | Casos de oferta nueva/roles; catálogo real y aceptación nativa pendientes |
| CW-08 | `question:null`, request original de Revisora, reloj fijo, protección de cláusulas | Regresión detectada/corregida, confirmación local 2/2; esfuerzo de edición en uso auténtico sigue pendiente |
| CW-09 | Evidencia tipada y períodos/scope exactos, tasa de cohorte del servidor | Conteos propios/equipo/calendario y aislamiento verificados con adapters |
| CW-10 | IDs de resultado, recibo nativo y estado incierto; link a campaña exacta | Tests de títulos ambiguos y falso resultado confirmado |
| CW-11 | Graph reconstruible, dependencias, targets, entrega Writer y continuidad | Tests de admisión vs entrega/queued/partial; flag y recorrido desplegado pendientes |
| CW-12 | Cola scoped con texto/ref/request/parent congelados; sustitución explícita; aclaración read-only | DOM + SQL aislado; migración/flag no aplicados en producción |
| CW-13 | Éxitos de consultas paralelas quedan en contexto/rescate aunque otra falle | Reproducción y regresión directa aprobadas |
| CW-14 | Routing/calls/latencia en harness; corregido `read:null` | Analista real invocado en 7,8 s; cola productiva no medida, no se amplían roles sin comparación |
| CW-15 | Inputs SHA inmutables, salida tmpfs/inodos, cleanup, cuarentena y publicación por intento | Adapters/12 tests + SQL de fencing; Docker real/VM e imágenes pendientes |
| CW-16 | Jobs durables v2 y adapter neutral, inspección, cancelación/reinicio sin replay | Tests de conflicto/stop/salida tardía; conformance remoto pendiente |
| CW-17 | Assets propios publicados reutilizables con hash; workspace lógico separado de cómputo; preview multiarchivo en origen opaco | HTML/CSS/JS clásico e imágenes ensamblados y renderizados; origen externo con TTL/toolchain/browser remotos pendientes |
| CW-18 | Informe PDF/Word/Markdown/Excel y calculadora autocontenida + manifest/ZIP | Piloto local de 45 contactos/30 correos y 20 renders; piloto cloud auténtico pendiente |
| CW-19 | Versión/targets a campaña pausada y apertura de identidad exacta | Transform/handoff y UI; ciclo nativo autenticado pendiente |
| CW-20 | Routing proactivo de cifras y orientación sin lecturas superfluas; casos de avisos existentes | Dedupe existente preservado; eventos reales/atención de usuario pendientes |

## Evaluación directa y hallazgos

Sin juez de pago. El asistente leyó respuestas, contenido de correos, evidencia de consultas y capturas; no es una revisión independiente de autoría ni un estudio con usuarios.

[Lectura de calidad por caso](../cowork-integral-quality-read-20261009.md): notas parciales de comprensión, veracidad, entrega, criterio comercial y redacción. La experiencia autenticada y la continuidad completa permanecen no medidas, por lo que no se publica un score global engañoso.

| Ronda | Casos / calls | Checks | Interpretación |
|---|---:|---:|---|
| Piloto + línea base Writer | 22 / 56 | 202/205; 19/22 casos | Mundo controlado, no sesión/cola productiva |
| Candidato pareado | 22 / 54 | 204/205; 21/22 casos | 1 repetición, no atribución causal ni paridad |
| Casos nuevos/runtime cercano | 9 / 28 | 69/78; 3/9 | Reveló instrumento amplio «cobertura», períodos sin routing, edición y ausencia de routing especialista |
| Ajustes de esas brechas | 7 / 22 | 54/58; 5/7 | Mes/semana exactos y oferta/roles en verde; especialista fallaba por `read:null` |
| Reproducción especialista | 2 / 9 | 14/15; 1/2 | Analista real en verde; edición aún perdió contenido, lo que disparó protección adicional |
| Confirmación final de edición | 2 repeticiones / 4 | 14/14; 2/2 | Sin consultas; conserva prueba y pregunta exacta. No acredita todos los tipos de edición |

La edición local detectó dos problemas: subject vacío eliminaba el bloque entero y una corrección semántica podía borrar una prueba que se pidió conservar. El candidato conserva el cuerpo sin asunto como borrador editable, detecta el asunto faltante y rechaza correcciones que pierden cláusulas protegidas. No se afirma que una nueva ronda global autenticada haya cerrado esa brecha.

Otros hallazgos que permanecen visibles: apertura y seguimientos genéricos, explicaciones repetidas, tasa de respuesta confundida con respuestas de otra cohorte, falta de medición de cola/latencia visible y algunas respuestas exactas clasificadas mal por exigir un siguiente paso artificial. Las rondas fallidas permanecen en la evidencia; no se cambió una nota con dimensiones no medidas por aprobado.

## Consumo de modelos

Último ledger observado: **173 admisiones**, 172 con usage y 1 incompleta:

- exposición conservadora registrada: **US$0,87934484**;
- reserva incompleta retenida: **US$0,03716438**;
- exposición total: **US$0,91650922**, dentro de US$10.

Precio fijado desde documentación Luna: input US$0,10/M, output US$0,50/M, cache US$0,01/M; ledger usa input no cacheado y buffer conservador. No es una factura. Una configuración heredada con otro modelo fue rechazada antes de admitir llamadas; esa salida no se utiliza como comparación del candidato.

## Verificación técnica

- Node 22.23.2.
- `npm run typecheck` y `npm run build` del candidato integral pasaron.
- `npm run test:unit` final: **2.745/2.745 en verde**, 497 archivos en 16 lotes Windows. La primera ronda de 2.741 detectó tres incompatibilidades; se corrigieron y se completó la suite final. El runner era incapaz de lanzar la suite (`ENAMETOOLONG`); se corrigió sin cargar credenciales.
- 126 pruebas focales de lógica, métricas/aislamiento, tablas/ID/cola en verde.
- Executor: **12/12** de protocolo/admisión/cancelación/reinicio/cleanup/límites/stop incierto en verde. Los adapters no acreditan Docker real.
- SQL real aislado: gate de acceso existente, root trigger, propuesta preservada, scope, revocación, idempotencia, service-only execute.
- SQL real aislado de código: intento antiguo no publica tras recuperar claim; revocación/cancelación impiden cierre; un solo manifiesto terminal; `build.dispatched` impide readmisión tras expirar el resultado remoto.
- Parsers independientes de PDF, Word y Excel abren los entregables y confirman las 45 filas/30 correos; ZIP incluye además calculadora autocontenida y manifest.
- DOM: workspace, continuaciones, sustitución explícita, foco, revocación y preview sandbox en verde.
- Chrome: 360/390/768/1024/1440, claro/oscuro; 20 renders, cero overflow, errores o violaciones axe. CSS de Cowork y tokens reales incluidos. Se revisaron capturas. No acredita el shell autenticado completo.

## Arquitectura y preparación

- [ADR resultados/tareas](../cowork-adr-005-results-and-tasks.md).
- [ADR laboratorio](../cowork-adr-006-marketing-build-lab.md).
- [Preparación GrupoExpro/PSOL](../cowork-team-rollout-20261009.md).

Flags nuevos permanecen ausentes/apagados: `COWORK_TASK_GRAPH_ENABLED`, `COWORK_CLARIFICATIONS_ENABLED`, `COWORK_CODE_FENCING_ENABLED`, `COWORK_EXECUTOR_ASYNC_ENABLED`, `COWORK_BUILD_WORKSPACES_ENABLED`. Hay dos migraciones pequeñas candidatas, independientes: aclaraciones y fencing de código. El mantenedor debe aplicar/verificar cada una por separado antes de activar su flag; el modo asíncrono exige fencing y supervisor verificado.

## Integración y siguiente ejecución

PR de trabajo desde main, etiqueta `ia-automerge`, revisión de integración y ambos gates sobre el mismo head. Solo `MERGED` acredita integración; merge no acredita deploy.

- [#306](https://github.com/insigne123/ANTON.IA-supabase/pull/306) runner Windows: integrado con CI verde.
- [#307](https://github.com/insigne123/ANTON.IA-supabase/pull/307) executor durable: integrado con CI verde.
- [#308](https://github.com/insigne123/ANTON.IA-supabase/pull/308) fidelidad y entregables: integrado con CI verde.
- [#309](https://github.com/insigne123/ANTON.IA-supabase/pull/309) contexto y evaluación: integrado con CI verde.
- [#310](https://github.com/insigne123/ANTON.IA-supabase/pull/310) settlement/cancelación del executor: integrado con CI verde.
- [#312](https://github.com/insigne123/ANTON.IA-supabase/pull/312) runtime/entregas/SQL candidato: integrado con revisión y ambos gates CI verdes sobre el head exacto. Merge `8300af8a`.
- [#313](https://github.com/insigne123/ANTON.IA-supabase/pull/313) evidencia, ADRs y lectura completa: integrado con CI verde. Merge `bf917c11`.

La actualización entrante [#311](https://github.com/insigne123/ANTON.IA-supabase/pull/311) corrige login y pertenece a otro trabajo. Se preservó al actualizar la base de #312; no se presenta como una entrega de este plan.

Para cerrar el programa: sesión del dueño y revisión de sus colas → aceptación de tareas auténticas → conformance del supervisor y asignación cloud → migración verificada y flags uno por vez → piloto remoto informe/calculadora → ciclo nativo de campaña pausada → casos nuevos y reporte final → material/apertura/piloto humano de equipos. Envíos, LinkedIn y activaciones reales conservan su alcance separado.

## Evidencia privada local

En `C:/Users/nicol/AppData/Local/Temp/opencode/`: `cowork-integral-20261009-{pilot,baseline,candidate-valid,confirmation,confirmation-v2,specialist-fix,edit-final}.json`, ledger, lecturas de respuesta y keys, `cowork-runtime-inventory-20261009.json`, `cowork-integral-deliverables-20261009/` y `cowork-integral-rendered-final-20261009/`. No se agregan transcripciones privadas, tokens ni archivos de entorno al repositorio.

## Bloqueos finales observables

1. No hay sesión legítima del dueño disponible para un recorrido autenticado; no se generaron tokens ni se suplantó la sesión.
2. El acceso de infraestructura se recuperó. El executor real responde `/v1/health` 200, `ok:true`, `busy:false`; `/v2/capabilities` responde 404. La base v2 implementada no está disponible en ese endpoint. No se ejecutaron jobs remotos ni se asignó gasto cloud adicional.
3. La lectura de producción confirma que las funciones de aclaraciones/fencing aún no existen y que los cinco flags nuevos siguen ausentes. El repositorio reserva deploy/activación y rollback al mantenedor; un merge no activa esos caminos.
4. Apertura a equipos, catálogo aprobado y estudio con ejecutivos requieren sus datos/personas; no pueden darse por validados por la revisión del asistente.

## Continuación · historial y miniapps multiarchivo

Problema de flujo/componente: se reutilizan la composición documentada de Cowork (hilos, conversación y panel de resultado), los botones `CwButton` y las surfaces/tokens `cw-*`. La acción de historial aparece donde faltan mensajes; loading y error se mantienen junto al control. La preview conserva el panel existente y suma feedback de preparación y recuperación, sin un nuevo shell ni bloques duplicados.

- UX-10: «Ver mensajes anteriores» recupera páginas de ocho turnos por los GET con sesión existentes. Valida la rama, conserva scroll, restituye foco, reintenta sin perder el contexto y permite abrir documentos antiguos sin cambiar el trabajo activo. El límite de contexto del modelo permanece igual.
- CW-17/18: preview estática de HTML + CSS + JS clásico + imágenes de una misma versión publicada, con comprobación de hashes y tamaño. Recursos ausentes/externos y módulos no compilados devuelven un error útil. La descarga original no cambia.
- Chrome reprodujo un defecto que el render standalone no detectaba: el sandbox sin `allow-forms` impedía que una calculadora manejara submit. Se habilitó ese evento local y se comprobó que `form-action 'none'` sigue bloqueando envíos externos.
- Diez renders adicionales: 360/390/768/1024/1440, light/dark. Calculadora correcta, CSS/JS ensamblados, foco por teclado, carga, error/reintento, revocación y origen opaco; cero overflow, page errors, requests externos o violaciones axe en parent y preview. Es una revisión fixture, no aceptación de un build cloud remoto.
- `typecheck`, `build` y suite completa del incremento aprobados: **2.748/2.748**, 499 archivos en 16 lotes. DOM de historial/preview/continuaciones también aprobado. No hubo llamadas de modelo adicionales: exposición sigue en **US$0,91650922**.
- Producción se inspeccionó solo en lectura: modelos Luna, funciones/flags y health/capabilities. En la ventana de logs de la revisión `studio-build-2026-10-09-001` consultada hasta las 17:24 UTC no aparecieron entradas ERROR. No equivale a garantía de ausencia futura de errores.

Evidencia privada nueva: `cowork-executor-inspect-live-20261009.json`, inventario actualizado y `cowork-multifile-rendered-20261009/evidence.json` con capturas. La conformidad del supervisor y la aceptación autenticada del dueño siguen pendientes.

## Continuación · despliegue solicitado por el dueño

El 9 oct el dueño pidió revisar recuperación de contraseña y desplegar las mejoras de Cowork. Las observaciones anteriores permanecen como snapshots de su fecha; esta autorización inicia su activación.

- Recuperación: [#315](https://github.com/insigne123/ANTON.IA-supabase/pull/315), merge `4823b340`, revisión y ambos gates CI verdes. Chrome con SDK/Provider/callback/middleware reales y Auth HTTP simulado comprobó PKCE, fragmentos de emails antiguos, token-hash, formulario, errores/validación, guardado y continuación. No se cambió la contraseña de cuentas reales durante esas pruebas.
- SQL productivo, una migración por vez: `cowork_pending_clarifications` (`20261009202749`) y `cowork_code_attempt_fencing` (`20261009203044`). Después de cada una se verificaron firmas, `security definer`, search path vacío, ejecución exclusiva de `service_role`, RLS conservada y ausencia de errores en los logs consultados. No se corrieron seeds/reset/suites contra producción.
- Executor v2 instalado en la VM existente desde `main` verificado, con fuente previa preservada. Conformidad Docker real con datos sintéticos: 45 filas a Excel/Word/PDF, miniapp HTML/CSS/JS, hashes, usuario sin privilegios, red denegada, idempotencia/conflicto, cancelación, timeout y reinicio sin replay. No se contrató un proveedor ni se ejecutaron modelos.
- La conformidad encontró un input temporal remanente tras reiniciar. El cierre registra el directorio exacto antes de ejecutar y lo elimina solo después de confirmar stop, sin exponer rutas en el protocolo público. La regresión de reinicio y 13 tests del executor quedaron en verde; el re-test remoto debe preceder a activar la app.
- `apphosting.yaml` incorpora los cinco flags del incremento. Configuración versionada no equivale a runtime activo: el rollout, tráfico y smoke se registran al concluir el despliegue.

La aceptación con usuarios/material de equipo y el score de tareas comerciales mantienen el alcance no medido anterior. La revisión operativa no es un estudio humano ni acredita esas dimensiones.
