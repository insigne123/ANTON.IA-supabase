# Funciones del 19 oct · Evaluación en producción

## Cómo se evaluó
- **Dónde:** producción (`studio--leadflowai-3yjcy`), con la cuenta QA «Pruebas ANTON.IA».
  - Es administradora de un workspace de cliente (31 personas que trabajan licitaciones), y ese es su workspace activo. Ahí solo se leyó: no se guardó, envió, pospuso, subió ni gastó nada.
- **Modos:** escritorio claro (1440 px), teléfono oscuro (390 px) y teclado.
- **Qué se registró:** errores de página, peticiones fallidas, desborde horizontal y tiempos reales, desde la navegación hasta ver el contenido.
- **Pauta (1 a 5):** utilidad, facilidad, claridad visual, robustez (errores, carga, estados vacíos, tiempos) y teléfono/oscuro/teclado. Es la misma de la evaluación local de los 7 PRs.
- **Versiones medidas:**
  - build-2026-10-19-002 (#435), pasada completa;
  - build-2026-10-19-003 (#436 a #438), segunda medición;
  - build-2026-10-19-005 (#439, video del informe semanal), pasada final completa. El 004 falló por un error de la plataforma (`RPC::DEADLINE_EXCEEDED` al consultar Cloud Build) y se reintentó.

## Resumen
- **Promedio 4,6. Ninguna función queda bajo 4,5.**
- **Pasada final (build 005), en escritorio y en teléfono:** 14 pantallas por modo, sin errores de página ni peticiones fallidas, y desborde horizontal 0. La pasada del build 002 dio lo mismo.
- **Lo que encontró la evaluación y quedó arreglado hoy:**
  - Mercado público fallaba con 500 porque las consultas tardaban más que el límite: #434 (índice de trigramas) y #435 (límite de 30 s del servidor y estado «no pudimos calcular» con «Reintentar»).
  - «Equipo» mostraba 31 filas en cero a un equipo que no escribe correos (#437).
  - «Firmas y estilo → Agenda» tardaba 7 s (#438).
  - Diez videos no calzaban con la app (#436, #439). Ahora producción (build 005) sirve los 16 videos idénticos a los del repositorio, y la duración que muestra la ayuda calza con cada archivo.
- **Lo que no depende del código:** la base del plan gratuito tiene unos 430 MB de memoria y hace swap. Cada consulta cuesta entre 0,2 y 0,9 s, y eso fija el piso de los tiempos (ver «Producción en el plan gratuito» en `docs/oportunidades-mercado-publico.md`).
  - También produce picos: en la pasada final, la verificación de sesión de Supabase (`/auth/v1/user`) llegó a 11,9 s y una carga de Empresas tardó 28 s. Minutos después, en teléfono, Empresas cargó a su ritmo normal.

## Notas

| Función | Utilidad | Facilidad | Claridad | Robustez | Tel/oscuro/teclado | Nota |
|---|---|---|---|---|---|---|
| Cowork para todos | 5 | 5 | 4,5 | 4,5 | 4,5 | 4,7 |
| Para retomar | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Agenda | 4,5 | 5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Llamadas y LinkedIn | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Mercado público | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Empresas y parecidas | 5 | 4,5 | 4,5 | 4,5 | 4,5 | 4,6 |
| Informe semanal | 5 | 5 | 5 | 4,5 | 4,5 | 4,8 |

## Evidencia por función
- **Cowork para todos:**
  - El build que sirve producción tiene `COWORK_OPEN_TO_ALL=true`, leído de la configuración del build en App Hosting.
  - La base tiene `cowork_access_policy.open_to_grants = true`, y `cowork_open_access` responde `true` para cualquier correo.
  - `/api/cowork/access` responde 200 `{ available: true }`. Cowork abre en 0,9 s y aparece en el menú, también en el menú del teléfono.
  - El permiso de cada persona se crea cuando abre la app, porque el menú consulta `/api/cowork/access`. La prueba local lo verificó con una miembro que no estaba en la lista anterior.
  - En producción todavía no hay un permiso creado así:
    - Los registros de Supabase muestran que, desde la apertura, solo la cuenta QA consultó ese acceso, y esa cuenta ya tenía permiso.
    - Otras 3 personas tuvieron actividad, pero sin volver a cargar la app (solo consultas de fondo). Su permiso se creará cuando la abran.
- **Para retomar** y **Llamadas y LinkedIn:**
  - `/api/reconnect` y `/api/touches` responden 200.
  - La cuenta QA no envió correos en ninguno de sus workspaces, así que las tarjetas no aparecen, que es lo diseñado: no hay a quién retomar ni a quién llamar.
  - Los flujos visibles se evaluaron con IA real en la integración local: tres motivos, posponer y deshacer, guion de llamada y resumen de una grabación.
- **Agenda:**
  - La pestaña carga en 2,2–2,8 s; antes de #438 tardaba 6,3–6,8 s.
  - Las tres formas de usar el enlace se ven en claro y oscuro.
- **Mercado público:**
  - «Competidores» trae 8 perfiles. Las personas naturales aparecen sin RUT, en la lista y en su perfil («Persona natural»).
  - «Demanda futura» y el perfil de cada proveedor cargan.
  - «Contratos por vencer»: POR COMPLETAR TRAS EL REINTENTO AUTOMÁTICO.
  - Es la pantalla más lenta: 7–9 s hasta ver los competidores, de los cuales la consulta del radar toma 4,2 s, limitada por la base.
- **Empresas y parecidas:**
  - 248 empresas en 3–4 s.
  - El detalle muestra quién decide, usa y paga, y ofrece «Buscar empresas parecidas» en las empresas con rubro.
  - Esa búsqueda gasta 1 crédito de Apollo y queda para tu aprobación.
- **Informe semanal:**
  - «Tu semana», «Equipo» y «Oportunidades» funcionan, y se llega a «Semana pasada» con Tab y Enter, con foco visible.
  - Un equipo que no escribió ve una frase («Nadie del equipo envió correos esta semana») y «Ver Oportunidades», en lugar de 31 filas en cero.
  - Carga en 3,7–3,8 s.

## Tiempos reales en producción (escritorio)

| Pantalla | build 002 | build 003 |
|---|---|---|
| Hoy | 0,3–0,8 s | 0,6–1 s |
| Cowork | 1,1 s | 0,9 s |
| Centro de ayuda | 0,3–0,8 s | 0,4–0,5 s |
| Empresas | 3,1–3,7 s | 3–4 s |
| Informe semanal | 3,9–5,8 s | 3,7–3,8 s |
| Agenda | 6,3–6,8 s | 2,2–2,8 s |
| Competidores | 8,9–11 s | 7,3–8,9 s |

En todas las pantallas, `/api/organizations` y `/api/quota/status` toman entre 0,7 y 3 s; es la misma base. El build 005 solo cambió un video, así que sus tiempos son los del 003.

## Lo que queda
- **Rendimiento:** pasar la base a un plan con más memoria es la mejora de tiempos más grande que queda. Es una decisión de costo.
- **Apollo:** probar «Buscar empresas parecidas» en producción gasta 1 crédito y espera tu confirmación.
- **Cowork, primera visita en producción:**
  - Se verá cuando otra persona abra la app.
  - Para probarlo antes con la cuenta QA hay que borrar su permiso, que es una escritura en producción y espera tu aprobación.
