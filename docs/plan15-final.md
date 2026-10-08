# Plan 15: la IA más útil, más clara y con mejor material (8 oct 2026)

Objetivo del dueño: «mejorar la experiencia del usuario con la IA en la app; que Cowork funcione perfecto para que el usuario se
comunique con la IA con facilidad y le responda lo que necesita de manera fácil de entender; revisar el sistema de investigación,
informe, borradores y seguimientos para que sean poderosos y creen material de calidad; que Cowork sea una extensión del usuario».

Todo se midió antes y después con el modelo real (`gpt-6-luna`; juez de Cowork `gpt-6.1-sol`), sin astra, sin escrituras en la base y
sin envíos. Ningún PR trae migraciones ni flags nuevos.

## Lo que cambió para el usuario

| PR | Qué cambia | Medición |
|---|---|---|
| #251 Informe | Dice primero si conviene escribirle; el largo sigue a la evidencia (con poca, ~1000 palabras en vez de ~2000); las salvedades van una vez; el primer correo sugerido abre con la señal, sin «me gustaría» | Palabras 2149/1916/1936 → 1056/886/1000; salvedades repetidas 14/7/4 → 2/2/2 |
| #252 Borradores y seguimientos | El servicio en presente y sin rodeos; el beneficio con las palabras del vendedor; el primer seguimiento pregunta cómo lo resuelven hoy en vez de pedir otra vez 15 minutos; el cierre respeta usted o tú (corrige un error que ponía «¿Le parece…?» a correos de tú) | AXIS: listos para enviar 8 → 12 de 24, revisión humana 8 → 3; ServiPro: revisión humana 41 % → 22 %, veracidad 4,17 → 4,54 |
| #253 Cowork, claridad | Hace la consulta en vez de ofrecerla («¿Quieres que identifique…?»); sin «Por cierto» repetido; no explica su prudencia; costo correcto de buscar decisores | Juez (39 casos): malas 7 → 3; claridad 4,62 → 4,87; los 5 criterios suben |
| #254 Cowork, segunda ronda | «¿A quiénes les ofrezco mi producto?» ya no termina en error; las tablas salen como tarjeta descargable, no escritas en el texto; sin «Por cierto» en la agenda | Los 3 casos pasan 2 de 2 (antes fallaban) |
| #255 Cupo de LinkedIn | Dice cuántas invitaciones quedan (antes confundía 22 usadas con 22 disponibles) y cuántas siguen sin aceptar | Correcto 1 de 3 → 3 de 3; «al menos 61 sin aceptar» 0 → 3 de 3 |
| #256 Campaña a los contactos con correo | «con correo» en la búsqueda: la campaña llega a todos los que tienen correo (antes a 1 de 21); `campaigns.list` dice el total | Destinatarios 1 → 21; casos de marketing, inicio y campañas 18/20 → 20/20 |
| #257 Tres respuestas | Al preparar las respuestas de tres personas, lee las tres conversaciones | Lee las 3: 2 de 3 → 3 de 3 en el caso de envío |

El detalle de cada uno está en `docs/informe-claro-plan15.md`, `docs/borradores-plan15.md`, `docs/cowork-plan15-claridad.md`,
`docs/cowork-plan15-segunda-ronda.md`, `docs/cowork-plan15-cupo-linkedin.md`, `docs/cowork-plan15-con-correo.md` y
`docs/cowork-plan15-tres-lecturas.md`.

## Herramientas de medición que quedaron mejor

- `scripts/evaluate-outreach-set.ts` usa y valida el cierre de usted como la app; `scripts/judge-outreach-set.ts` le da al juez la
  relación anterior de una reconexión.
- El banco de conversaciones de Cowork es más fiel a producción: la búsqueda sin palabras dice que hay más de los que muestra, las
  campañas dicen su total, y «con correo» devuelve los contactos con correo.
- Checks al día con el producto: la tarea de varios pasos cuenta como proponer la búsqueda (con `COWORK_TASKS_ENABLED`), y sin perfil
  de LinkedIn se rechaza la invitación, no buscar sus datos.

## Para el mantenedor

1. **Desplegar `main`** como siempre, con su tag `prod-AAAA-MM-DD`. No hay migraciones ni variables nuevas.
2. **Pruebas de humo** de siempre (`/api/onboarding/tour` 401, `/cowork` 200, `POST /api/cowork/wake` 401).
3. **Qué mirar después del deploy**:
   - los borradores nuevos salen con `native-draft/v19` y los informes nuevos con `report-v2/editor/9` (los anteriores no cambian);
   - el 👎 de Cowork (`cowork_run_events` con `kind = 'answer.feedback'`) durante dos semanas, para ver si bajan los motivos de
     «no entendí» o «me hizo trabajar».
4. **Rollback**: `git revert` del PR que corresponda, redeploy y pruebas de humo. Ninguno deja datos que limpiar.

## Lo que queda

- **Medir con datos reales.** No hubo acceso a la base de producción en esta ronda (el conector de Supabase estaba desconectado):
  todo se midió con los bancos de prueba. Con acceso de lectura, lo siguiente es revisar el 👎 y las conversaciones reales de Cowork.
- **Investigación con fuentes reales**: la búsqueda web y la lectura de páginas necesitan las claves de los proveedores; se midió el
  informe con casos armados de 3 fuentes. Falta medir cobertura y tiempos con empresas reales.
- **Ofrecer una consulta en un botón de respuesta sugerida** («Revisar contactos») sigue siendo lo más frecuente en las respuestas
  «mejorables» del juez.
- **Tableros y vistas** que arma la diseñadora usan solo las filas que se leyeron en el turno: con muchas filas, conviene que digan
  cuántas muestran de cuántas.
- **Teléfonos de varias personas** se proponen de a uno.
- `ur-oferta-app`: la receta «Ayúdame a vender» parte por los contactos con correo y el caso espera una búsqueda de prospectos nuevos;
  hay que decidir cuál es lo correcto cuando el usuario pide explícitamente «encontrar clientes».
