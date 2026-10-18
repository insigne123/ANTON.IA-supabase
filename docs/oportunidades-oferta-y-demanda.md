# Oportunidades: borrador de oferta y demanda futura

Dos funciones del workspace de Oportunidades (`OPPORTUNITIES_WORKSPACE_ENABLED`), 18 oct 2026.

## Borrador de oferta y cotización

En «Cómo postular», con el informe listo, «Preparar borrador de oferta» encola un trabajo `offer` (`workspace-offer.ts`). Sonnet arma, con el informe, los fragmentos citables del expediente, las líneas oficiales de la ficha de Mercado Público y lo que la empresa dijo de sí misma en Perfil:

- carta de presentación;
- oferta técnica por criterio de evaluación, con su ponderación y la cita de las bases;
- cumplimiento de requisitos técnicos;
- líneas a cotizar (unidad, cantidad, si el portal pide neto o total), vigencia y forma de pago;
- datos que faltan.

Reglas del prompt (`offer-draft.ts`): nunca inventar experiencia, clientes, certificados, cifras ni plazos; lo que falta va entre corchetes (`[RUT]`) y la pantalla lo marca. Las citas se validan contra los fragmentos; una cita que no está en las bases se elimina. Los precios los escribe el equipo: la hoja calcula subtotales, IVA y total, compara con el presupuesto y guarda con revisión optimista (si otra persona guardó antes, se muestran sus precios y se pide revisar). «Descargar Word» exporta todo (`/export?doc=offer&format=docx`).

Costo: una llamada de síntesis por versión (categoría `research` del presupuesto mensual), en caché por prompt. Tipos: licitación, Compra Ágil y privada.

## Demanda futura (Plan Anual de Compras)

Vista de administradores junto a «Embudo» y «Lista». Fuente: el Plan Anual de Compras que cada organismo publica (ley 19.886), en los datos abiertos de ChileCompra: `https://pac-files.da.mercadopublico.cl/{año}/pacorganismos_{año}.zip` (2026: 7,5 MB comprimido, 41 MB de texto, 989 organismos).

El trabajo `demand` (mensual al buscar oportunidades, o manual) descarga el ZIP, lo lee como flujo y conserva hasta 1.200 líneas candidatas que dicen alguna palabra del workspace (las de licitaciones y los servicios cortos). Haiku filtra en lotes de 120 (categoría `evaluation`, en caché por lote; con lotes de 300, un workspace con cientos de líneas de aseo y seguridad agotó el espacio de respuesta del modelo) y deja las compras que la empresa podría vender, con un motivo. Las candidatas quedan en `opportunity_source_snapshots` para que un trabajo que se reanuda no descargue de nuevo. Cada lectura reemplaza la anterior del mismo año.

El archivo no es CSV estricto: una comilla es texto, una descripción cortada en su largo máximo deja una comilla abierta (leído como CSV, 13 de ellas se tragan 5.900 líneas), 775 descripciones se parten en dos líneas y unas pocas traen un «;». `purchasePlanReader` lee por línea, une las partidas hasta completar las diez columnas y devuelve un «;» extra a la descripción cuando el resto de la línea se lee bien; lo demás se cuenta como omitido, nunca se corre de columna. Con el archivo 2026: 303.488 líneas leídas y 63 omitidas, en unos 10 s y 190 MB de memoria.

**Bloqueo de ChileCompra y copia en Storage.** El CloudFront de `pac-files.da.mercadopublico.cl` bloquea las redes en la nube: Google Cloud, donde corre App Hosting, y Azure, donde corre GitHub Actions, reciben 403 «Request blocked» (comprobado el 18 oct 2026; desde otras redes el archivo baja normal). Un año no publicado, en cambio, responde 403 de S3 con «AccessDenied». Cuando ChileCompra bloquea o falla, el servidor lee la copia en Storage (`opportunity-documents/public-data/purchase-plan/{año}/part-001.csv`, …: partes CSV de menos de 15 MB, porque el bucket acepta CSV hasta 20 MB); sin copia, el trabajo lo dice («no deja descargar… y aún no tenemos una copia») en vez de «aún no publica». Las líneas leídas de la copia tienen los mismos ids que las de ChileCompra.

**Copia mensual.** Una tarea programada de Claude Code («Copia mensual del Plan Anual de Compras», el día 3 de cada mes a las 9:17 de Chile) corre en el entorno en la nube de Claude, cuya salida a internet ChileCompra no bloquea:

```
SUPABASE_URL=https://yfdelflsheurzaicwayi.supabase.co SUPABASE_SERVICE_ROLE_KEY=… node scripts/mirror-purchase-plan.mjs <año>
```

El script no usa dependencias del proyecto (curl, unzip y la API REST de Storage), así que corre en una copia recién clonada. Si el año aún no está publicado (enero a marzo), termina con `{"published":false}` sin tocar nada y el servidor sigue con la copia del año anterior. La tarea necesita `FIREBASE_TOKEN` en las variables del entorno de Claude Code (con él lee `SUPABASE_SERVICE_ROLE_KEY` de los secretos de App Hosting) o directamente `SUPABASE_SERVICE_ROLE_KEY`. Se puede correr a mano desde cualquier red permitida; `--zip archivo.zip` usa un ZIP ya descargado y `--dry-run` solo muestra las partes.

«Seguir» crea una oportunidad comercial privada con el origen `purchase_plan`, un id estable por línea (no se duplica) y el documento «Plan Anual de Compras.txt» con el detalle. El plan es referencial: el organismo puede comprar menos, en otra fecha o por otro mecanismo.

## Migraciones

Una a la vez, en este orden:

1. `20261018120000_opportunity_jobs_offer_demand.sql`: agrega los tipos `offer` y `demand` a `opportunity_jobs`.
2. `20261018121000_opportunity_offer_drafts.sql`: tabla `opportunity_offer_drafts` (solo `service_role`, RLS activo).
3. `20261018122000_opportunity_purchase_plan.sql`: tabla `opportunity_purchase_plan` (solo `service_role`, RLS activo).

Sin las tablas, la app no muestra las funciones (`available: false`).

## Validación

Pruebas unitarias sin red: prompt, validación de citas, hoja económica e IVA, Word, lector del plan (piezas de cualquier tamaño, CRLF, comillas abiertas, líneas partidas, «;» extra, encabezado distinto), selección de candidatas, agrupación por organismo, flujo del trabajo con base y modelo en memoria, permisos de administrador y vista renderizada del borrador. Lectura real del archivo 2026 descargado localmente.
