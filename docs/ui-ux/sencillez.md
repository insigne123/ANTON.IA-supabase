# Sencillez de uso

Qué tan fácil es usar ANTON.IA para alguien nuevo, medido en 12 tareas clave y revisado con las 10 heurísticas de Nielsen (Plan 11, sección 2). La medición es experta y automática. No reemplaza una prueba con personas; al final está la que recomiendo hacer.

La herramienta es `npm run audit:simplicity` y su método está en `scripts/usability/README.md`. Corre sobre el banco de la auditoría visual: Supabase simulado, sin red y sin envíos.

## Cómo se mide

Cada tarea se hace como la haría una persona nueva, en escritorio (1440 px) y en teléfono (390 px). Se puntúa de 0 a 100:

| Parte | Peso | Qué mide |
|---|---:|---|
| Logra hacerlo | 30 | Que la tarea se complete: escritorio 20 y teléfono 10 |
| Pasos | 20 | Pasos ideales frente a pasos hechos |
| Tiempo | 10 | Modelo KLM: 30 s o menos vale completo y 150 s o más vale cero |
| Decisiones | 15 | Controles a la vista por pantalla: 12 o menos vale completo y 60 o más vale cero |
| A la vista | 15 | Si el siguiente control se ve sin desplazarse: escritorio 10 y teléfono 5 |
| Claridad | 10 | Una o dos acciones principales por pantalla y 150 palabras o menos |

El índice es el promedio de las 12 tareas.

## Resultado

**Índice: de 80 a 92 de 100.** Las 12 tareas se completan ahora en escritorio y en teléfono; antes, 2 no se completaban en ninguno de los dos, y «Escribir el primer correo» no se completaba en teléfono.

- **Antes:** la app sin estos arreglos y sin el rediseño de Firmas y estilo ([#190](https://github.com/insigne123/ANTON.IA-supabase/pull/190)).
- **1.er lote:** `main` con #190 y el primer lote de arreglos: 91.
- **2.º lote:** además, el segundo lote: 92. Los dos lotes van en [#193](https://github.com/insigne123/ANTON.IA-supabase/pull/193).

Las tres mediciones usan el mismo motor. Para el 2.º lote, los datos de ejemplo de Oportunidades traen más avisos (vienen de [#192](https://github.com/insigne123/ANTON.IA-supabase/pull/192)); por eso «Ver las licitaciones» baja de 100 a 98 sin que su pantalla cambie.

| Módulo | Antes | 1.er lote | 2.º lote |
|---|---:|---:|---:|
| Seguimiento | 66 | 88 | 88 |
| Configuración | 73 | 91 | 94 |
| Correo | 76 | 86 | 86 |
| Contactos | 91 | 91 | 92 |
| Prospectar | 96 | 96 | 95 |
| Cowork | 97 | 97 | 97 |

| Tarea | Antes | 1.er lote | 2.º lote | Qué cambió |
|---|---:|---:|---:|---|
| Responder a quien te escribió | 33 | 97 | **97** | Al enviar, «Respuesta enviada…» queda a la vista; antes no se veía ninguna confirmación |
| Poner tu teléfono en la firma y elegir un tono | 27 | 80 | **88** | El rediseño de Firmas y estilo (#190); en el 2.º lote, «Guardar firma» y «Guardar estilo» quedan a la vista |
| Escribir el primer correo | 76 | 86 | **86** | En teléfono se completa: «Investigar N» está en el detalle del contacto |
| Buscar el correo de un contacto | 87 | 87 | **89** | En el 2.º lote, comentarios y eliminar van en «Más»: de 38 a 33 controles por pantalla |
| Crear y aprobar una campaña | 74 | 74 | **74** | 15 pasos en vez de 16: la audiencia queda marcada al buscar |
| Mover un negocio de etapa | 92 | 92 | **92** | — |
| Encontrar 10 prospectos y guardarlos | 91 | 91 | **91** | — |
| Completar el perfil | 95 | 95 | **95** | — |
| Subir un archivo de contactos | 95 | 95 | **95** | — |
| Conectar el correo | 98 | 98 | **98** | — |
| Pedirle algo a Cowork | 97 | 97 | **97** | — |
| Ver las licitaciones | 100 | 100 | **98** | Más datos de ejemplo, misma pantalla |

Lo que más cuesta ahora:

- **Crear y aprobar una campaña (74):** 15 pasos frente a 8 ideales, y unos 2 minutos escribiendo el correo y el seguimiento.
- **Escribir el primer correo (86):** espera de 1 a 3 minutos de investigación antes de poder escribir.

## Evaluación heurística

Severidad de 0 a 4, según Nielsen:

- 0: no es un problema;
- 1: cosmético;
- 2: menor;
- 3: mayor;
- 4: catástrofe.

| Heurística | Dónde | Hallazgo | Sev. | Estado |
|---|---|---|---:|---|
| 1. Visibilidad del estado | Pipeline, Tabla de datos | Con las lecturas fallando decían «Aún no hay leads» o «Tu hoja está vacía» | 3 | Arreglado: avisan el error y ofrecen «Reintentar»; si faltan algunas lecturas, lo dicen |
| 1. Visibilidad del estado | Bajas y bloqueos | Al fallar la lectura mostraba «Correos (0)»: parecía que nadie estaba bloqueado | 3 | Arreglado |
| 1. Visibilidad del estado | Conversaciones | Al enviar una respuesta no se veía ninguna confirmación: el bloque «Responder» se cerraba con su mensaje adentro | 3 | Arreglado: «Respuesta enviada…» queda a la vista |
| 2. Lenguaje del usuario | Campañas | «Antigüedad» pedía escribir el nivel del cargo, pero los contactos lo guardan con códigos en inglés: «gerente» nunca encontraba a nadie | 3 | Arreglado: «Nivel del cargo» es una lista (Gerente, Director, Jefe de área…) que busca los códigos guardados |
| 5. Prevención de errores | Campañas | «Tamaño de empresa» compara texto, pero los contactos guardan el número de empleados: «201-500» nunca encontraba a nadie y «200» encontraba empresas de 1.200 o 12.000 | 3 | Mitigado: el campo ya no se ofrece (solo aparece para borrar un valor guardado antes). Falta una migración pequeña (abajo) |
| 3. Control y libertad | Campañas | Al buscar la audiencia había que «Seleccionar todos» antes de seguir | 2 | Arreglado: los resultados quedan marcados y se pueden quitar |
| 4. Consistencia | Buscar prospectos | «Búsquedas guardadas» abría un menú sin opciones de menú (lector de pantalla) | 2 | Arreglado: es una lista en un panel |
| 5. Prevención de errores | Buscar prospectos | Buscar solo con un cargo no corre, y el aviso quedaba fuera de la vista | 3 | Arreglado: el aviso queda junto al botón y el foco va al campo que falta |
| 5. Prevención de errores | Campañas | Exigía elegir la cantidad de seguimientos aunque ya escribiste el correo | 2 | Arreglado |
| 6. Reconocer antes que recordar | Campañas | El editor decía «Incluye tu firma en el mensaje», cuando la firma se agrega sola | 2 | Arreglado: dice que se agrega sola y desde dónde se cambia |
| 7. Flexibilidad y eficiencia | Campañas | Crear y aprobar una campaña toma 15 pasos, frente a 8 ideales | 3 | Mejorado (antes 16). Pendiente: partir de un estilo guardado para no escribir los correos desde cero |
| 7. Flexibilidad y eficiencia | Escribir el primer correo | Hay que investigar antes de escribir: de 1 a 3 minutos de espera | 2 | Pendiente: ofrecer «Escribir sin investigar» con el estilo predeterminado |
| 7. Flexibilidad y eficiencia | Escribir el primer correo, en teléfono | El detalle del contacto no mostraba cómo empezar a investigar | 3 | Arreglado: «Investigar N» está en el mismo detalle |
| 8. Diseño minimalista | Por completar | Hasta 80 controles a la vista (cuatro por fila) | 2 | Arreglado: comentarios y eliminar van en el menú «Más» de cada fila |
| 7. Flexibilidad y eficiencia | Firmas y estilo | «Guardar firma» y «Guardar estilo» quedaban bajo la vista previa: había que desplazarse para guardar | 2 | Arreglado: el botón queda fijo al pie mientras editas |
| 8. Diseño minimalista | Conversaciones | Al abrir «Responder», el botón «Enviar respuesta» quedaba fuera de la vista | 2 | Arreglado: el editor entra completo a la vista, con el cursor en la respuesta |
| 9. Ayudar con los errores | Privacidad | Si no se puede comprobar el acceso, las filas de administración desaparecen sin aviso | 1 | Arreglado |
| 10. Ayuda y documentación | Toda la app | La ayuda era solo texto | 2 | Arreglado en la sección 7: un video por módulo en el Centro de ayuda y en «?», y un recorrido más corto |

## Arreglos ordenados por impacto y esfuerzo

Hechos en el primer lote:

1. **Errores visibles.** El Pipeline, la Tabla de datos y Bajas y bloqueos dejan de mostrar «vacío» cuando no pueden leer, y el Pipeline conserva lo último que se vio si falla la actualización automática.
2. **Campañas.** La audiencia queda marcada al buscar y el correo escrito a mano cuenta como el primero. El editor dice que la firma se agrega sola.
3. **Teléfono.** «Investigar» está en el detalle del contacto.
4. **Conversaciones.** El editor de respuesta entra completo a la vista, con el cursor en la respuesta, y al enviar se ve la confirmación (antes no se veía ninguna).
5. **Buscar prospectos.** El aviso de filtro faltante queda junto al botón, «Búsquedas guardadas» es accesible y el aviso de marcas que no se pudieron leer.

Hechos en el segundo:

1. **Firmas y estilo.** «Guardar firma» y «Guardar estilo» quedan fijos al pie mientras editas.
2. **Campañas.** «Nivel del cargo» es una lista que busca los códigos que guardan los contactos. «Tamaño de empresa» ya no se ofrece, porque no podía funcionar (abajo).
3. **Por completar.** Comentarios y eliminar van en el menú «Más» de cada fila.

Hechos en el tercero (Plan 12, 7):

1. **Campañas, el paso de correos.**
   - «Generar secuencia con IA» ya no exige elegir antes cuántos seguimientos. Sin elegir, escribe el correo inicial y 1 seguimiento a los 3 días, que se cambian después.
   - La acción principal de cada paso queda fija al pie mientras bajas: «Continuar a correos», «Guardar y revisar correos» y «Aprobar campaña».
2. **Una tarea nueva, «campana-ia»**, mide el camino principal: generar la secuencia con la IA y revisarla. «campana» sigue midiendo escribir los dos correos a mano.

| Tarea | Antes | Ahora | Pasos | Tiempo (KLM) | Acción principal a la vista |
|---|---:|---:|---:|---:|---:|
| Crear y aprobar una campaña (a mano) | 74 | **76** | 15 | 123 s | 80 % (antes 67 %) |
| Crear y aprobar una campaña con la IA | — | **88** | 11 | 58 s | 91 % |

Pendientes recomendados:

| Arreglo | Impacto | Esfuerzo |
|---|---|---|
| Campañas: el objetivo prellenado desde la oferta de «Perfil» | Medio: un campo menos que escribir en «campana-ia» | Bajo |
| «Escribir sin investigar» con el estilo predeterminado | Alto: el primer correo sin esperar | Medio |
| Campañas: «Tamaño de empresa» por rangos (necesita migración) | Medio | Bajo |

### «Tamaño de empresa» en Campañas: propuesta de migración

- **El problema:** los contactos enriquecidos guardan el tamaño como número de empleados («220», «12000»). La búsqueda de audiencia (`search_bulk_audience_v1`) lo compara como texto.
  - Ningún rango («201-500») encuentra a nadie.
  - Un número suelto encuentra empresas de cualquier tamaño que lo contengan: «200» encuentra 1.200 y 12.000.
- **La propuesta:** una migración pequeña y forward-only. Una función `bulk_audience_size_match_v1(size text, ranges text[])` que lea el número y lo compare con rangos («1-10», «11-50», «51-200», «201-500», «501-1000», «1001-5000», «5001+»), usada en lugar de la comparación de texto para `p_sizes`.
- **Después:** «Tamaño de empresa» vuelve a la pantalla como lista de rangos.
- **Pendiente de solicitud explícita:** las migraciones necesitan un pedido explícito, así que queda propuesta.

## Prueba con personas (recomendada)

La medición automática dice dónde sobran pasos y controles. No dice qué entiende una persona.

- **Participantes:** 5 personas de ventas que no conozcan la app (con 5 se encuentra la mayoría de los problemas de uso).
- **Formato:** sesiones de 30 minutos por videollamada, pensando en voz alta, con una cuenta de prueba con datos de ejemplo.
- **Tareas:** 5 de las 12:
  1. completar el perfil;
  2. encontrar y guardar 10 prospectos;
  3. escribir el primer correo;
  4. crear una campaña;
  5. responder a quien te escribió.
- **Qué medir en cada tarea:**
  - si la completa sin ayuda;
  - el tiempo;
  - dónde duda;
  - qué esperaba encontrar.
- **Al cierre:** la escala SUS (10 preguntas).
- **Uso de los resultados:** comparar los pasos donde dudan con los de este informe. Lo que coincida se arregla primero.
