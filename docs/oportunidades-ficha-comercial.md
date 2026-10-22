# Oportunidades: la ficha comercial, completa, visual y descargable tal cual

**Fecha:** 22 de octubre de 2026.

La «ficha comercial» es lo que se abre cuando la oportunidad es una señal: una empresa que está contratando («Actividad de contratación») o una publicación de LinkedIn.

## Qué le faltaba (evaluación antes del cambio)

Se revisó con la estructura real de producción (429 señales de contratación y 120 publicaciones, un informe cada una) y se renderizó la pantalla y el PDF de entonces.

| Tema | Antes |
| --- | --- |
| **Lo que ya sabe el radar** | Estaba en la base (avisos, cargos, regiones, ritmo de la última semana, portales, avisos de muestra) pero la ficha solo lo contaba en prosa. No había ni una cifra destacada ni un gráfico. |
| **Visual** | Texto en tarjetas. Ningún gráfico, ninguna escala, ninguna línea de tiempo. |
| **A quién contactar** | Un botón a «Contactos»; la ficha no decía qué cargos buscar ni daba un enlace para hacerlo. |
| **Qué decirle** | Un solo mensaje, escondido dentro de un párrafo del análisis. Sin canal, sin asunto, sin guion de llamada, sin botón para copiarlo. |
| **Seguimiento** | No existía: la ficha terminaba en el primer mensaje. |
| **Objeciones** | No existían. |
| **Calce con la oferta** | Una estrella y una frase. No decía con qué servicio calza ni qué habría que respaldar. |
| **Antes de la primera ficha** | Solo «Por qué apareció», con los motivos sueltos del radar. |
| **PDF** | Otro documento, no la ficha: portada y texto, sin cifras ni gráficos, y no se podía descargar sin informe escrito. |

## Qué hay ahora

Una sola fuente (`signal-sheet.ts`) arma la ficha, y la pantalla (`SignalSheet.tsx`) y el PDF (`signal-sheet-pdf.ts`) dibujan esa misma fuente: mismas secciones, mismo orden, mismas cifras.

1. **Resumen:** estrellas, decisión, relación con la empresa («Ya es tu cliente», «Ya tienes contactos ahí», «Empresa nueva para ti»), la jugada en una frase, «Por qué ahora», «Qué hacer ahora» (marcable, con «Crear tarea») y «Antes de decidir».
2. **La señal:** cifras (avisos en N días, última semana y cuántas veces su ritmo anterior, cargos distintos, regiones), barras de cargos y de regiones, ritmo de contratación (semana anterior contra la última) y portales. En una publicación: la cita, quién la escribió y cuándo.
3. **Calce con tu oferta:** escala de cinco franjas con el puntaje del radar, y por cada servicio cuánto calza (tres puntos) y por qué; «Lo que habría que respaldar».
4. **La empresa:** resumen y datos (relación, rubro, tamaño, presencia). Lo que no se sabe dice «No informado», nunca una cifra inventada.
5. **A quién contactar:** cargos primarios y de apoyo, cada uno con su búsqueda en LinkedIn ya armada (cargo + empresa). No inventa nombres de personas.
6. **Cómo abordarlos:** ángulo, qué mencionar y qué evitar (precios, cobertura o plazos sin validar).
7. **Mensajes listos:** LinkedIn (nota de conexión, con contador de 300), correo (asunto y cuerpo) y guion de llamada, con «Copiar». La ficha no escribe a nadie por su cuenta.
8. **Secuencia de seguimiento:** línea de tiempo de 4 a 7 pasos en tres semanas (es una propuesta).
9. **Objeciones y cómo responderlas.**
10. **Qué validar, pasos comerciales, riesgos y preguntas para la primera conversación:** como antes, con marcas, destacados y notas del equipo.
11. **Avisos de muestra:** enlaces a los avisos que vio el radar.
12. **Qué falta en esta ficha:** porcentaje y lista de lo que falta, con el botón que lo resuelve («Actualizar ficha» o «Buscar contactos»).

### Antes de que exista el informe

La parte que sale de los datos del radar (la señal, las barras, el calce, los datos de la empresa, los cargos que tu empresa suele contactar, «Por qué ahora» en frases completas) se ve desde el primer momento y no cuesta nada. La IA agrega lo demás al generar la ficha.

### Informes antiguos

Los informes ya generados no traen el plan estructurado. Siguen funcionando: la ficha usa el ángulo y el mensaje que estaban en el texto de «Cómo abordarlos», y «Qué falta» le dice a la persona que actualice para completar el resto.

## El PDF es la ficha

- `GET /api/commercial-opportunities/:id/export?format=pdf` entrega la ficha de las señales, incluso antes de que haya informe escrito (con «Datos del radar al …»).
- Dibuja los mismos datos con gráficos vectoriales (barras, escala de calce, línea de tiempo), los enlaces (LinkedIn de cada cargo, avisos) y lo que el equipo marcó: casillas con la marca y las notas con quién las escribió.
- Un título de sección nunca queda solo al pie de una hoja; el texto largo pasa a la hoja siguiente sin salirse de los márgenes (`signal-sheet-pdf.test.ts`, con un lápiz que registra lo dibujado).
- Emoji y símbolos que la tipografía del PDF no imprime se omiten en lugar de fallar la descarga (las publicaciones de LinkedIn los traen).
- Es la misma ficha, no una copia píxel a píxel: la pantalla se adapta al ancho y el PDF es A4.
- Word, Markdown y Excel de las señales siguen disponibles por la API con el formato anterior; la pantalla ofrece el PDF de la ficha.

## Lo que escribe la IA (`commercial`)

`reportSchema` tiene un bloque opcional `commercial` (`signal-brief.ts`) que el modelo llena solo para señales (`SIGNAL_BRIEF_RULE` en el prompt). Como un informe se paga y un fallo de formato no se reintenta, antes de validar se pasa por `sanitizeBrief`: recorta textos, descarta entradas sin su texto clave y lleva canales o fuerzas desconocidos al valor más seguro. Si no queda nada usable, el informe se guarda sin el bloque y la ficha usa lo que sí tiene.

**Pendiente de validar:** las pruebas cubren el esquema, el saneado y los dibujos, pero el texto que escribe el modelo real en este bloque no se ha medido (no hay clave para esa prueba en esta sesión). Conviene generar 3 o 4 fichas reales después de desplegar y revisar que los mensajes, las objeciones y la secuencia salgan como se espera. El presupuesto de salida del informe es de 16.000 tokens y el bloque agrega como máximo unos 3.000.

## Dónde está

| Pieza | Archivo |
| --- | --- |
| Datos del radar (cifras, barras, ritmo) | `src/lib/commercial-opportunities/signal-facts.ts` |
| Esquema, saneado y regla del prompt | `src/lib/commercial-opportunities/signal-brief.ts` |
| Modelo único de la ficha | `src/lib/commercial-opportunities/signal-sheet.ts` |
| Pantalla | `src/components/commercial-opportunities/SignalSheet.tsx` |
| PDF | `src/lib/server/commercial-opportunities/signal-sheet-pdf.ts`, `signal-sheet-export.ts` |
| Descarga | `src/app/api/commercial-opportunities/[id]/export/route.ts` |

No hay migraciones ni cambios de base de datos: el detalle de la oportunidad solo agrega la columna `company_linkedin_url`, que ya existe, a su lectura.
