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

**Índice: de 80 a 91 de 100.** Las 12 tareas se completan ahora en escritorio y en teléfono; antes, 2 no se completaban en ninguno de los dos, y «Escribir el primer correo» no se completaba en teléfono.

- **Antes:** la app sin los arreglos de esta PR y sin el rediseño de Firmas y estilo ([#190](https://github.com/insigne123/ANTON.IA-supabase/pull/190)).
- **Después:** `main` con #190 y esta PR.

Las dos mediciones usan el mismo motor y los mismos datos.

| Módulo | Antes | Después |
|---|---:|---:|
| Seguimiento | 66 | 88 |
| Configuración | 73 | 91 |
| Correo | 76 | 86 |
| Contactos | 91 | 91 |
| Prospectar | 96 | 96 |
| Cowork | 97 | 97 |

| Tarea | Antes | Después | Qué cambió |
|---|---:|---:|---|
| Responder a quien te escribió | 33 | **97** | Al enviar, «Respuesta enviada…» queda a la vista; antes no se veía ninguna confirmación |
| Poner tu teléfono en la firma y elegir un tono | 27 | **80** | El rediseño de Firmas y estilo (#190): antes la firma solo se podía subir como imagen |
| Escribir el primer correo | 76 | **86** | En teléfono se completa: «Investigar N» está en el detalle del contacto |
| Crear y aprobar una campaña | 74 | 74 | 15 pasos en vez de 16: la audiencia queda marcada al buscar |
| Mover un negocio de etapa | 92 | 92 | — |
| Buscar el correo de un contacto | 87 | 87 | — |
| Encontrar 10 prospectos y guardarlos | 91 | 91 | — |
| Completar el perfil | 95 | 95 | — |
| Subir un archivo de contactos | 95 | 95 | — |
| Conectar el correo | 98 | 98 | — |
| Pedirle algo a Cowork | 97 | 97 | — |
| Ver las licitaciones | 100 | 100 | — |

Lo que más cuesta ahora:

- **Crear y aprobar una campaña (74):** 15 pasos frente a 8 ideales, y unos 2 minutos escribiendo el correo y el seguimiento.
- **Poner tu teléfono en la firma (80):** «Guardar firma» y «Guardar estilo» quedan bajo la vista previa y hay que desplazarse para verlos.
- **Escribir el primer correo (86):** espera de 1 a 3 minutos de investigación antes de poder escribir.
- **Buscar el correo de un contacto (87):** «Por completar» muestra 38 controles por pantalla.

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
| 2. Lenguaje del usuario | Campañas | «Antigüedad» y «Tamaño de empresa (separados por comas)» piden escribir valores sin decir cuáles | 2 | Pendiente: elegir de una lista |
| 3. Control y libertad | Campañas | Al buscar la audiencia había que «Seleccionar todos» antes de seguir | 2 | Arreglado: los resultados quedan marcados y se pueden quitar |
| 4. Consistencia | Buscar prospectos | «Búsquedas guardadas» abría un menú sin opciones de menú (lector de pantalla) | 2 | Arreglado: es una lista en un panel |
| 5. Prevención de errores | Buscar prospectos | Buscar solo con un cargo no corre, y el aviso quedaba fuera de la vista | 3 | Arreglado: el aviso queda junto al botón y el foco va al campo que falta |
| 5. Prevención de errores | Campañas | Exigía elegir la cantidad de seguimientos aunque ya escribiste el correo | 2 | Arreglado |
| 6. Reconocer antes que recordar | Campañas | El editor decía «Incluye tu firma en el mensaje», cuando la firma se agrega sola | 2 | Arreglado: dice que se agrega sola y desde dónde se cambia |
| 7. Flexibilidad y eficiencia | Campañas | Crear y aprobar una campaña toma 15 pasos, frente a 8 ideales | 3 | Mejorado (antes 16). Pendiente: partir de un estilo guardado para no escribir los correos desde cero |
| 7. Flexibilidad y eficiencia | Escribir el primer correo | Hay que investigar antes de escribir: de 1 a 3 minutos de espera | 2 | Pendiente: ofrecer «Escribir sin investigar» con el estilo predeterminado |
| 7. Flexibilidad y eficiencia | Escribir el primer correo, en teléfono | El detalle del contacto no mostraba cómo empezar a investigar | 3 | Arreglado: «Investigar N» está en el mismo detalle |
| 8. Diseño minimalista | Por completar | Hasta 80 controles a la vista (cuatro por fila) | 2 | Pendiente: notas y eliminar en el menú «Más» de cada fila |
| 8. Diseño minimalista | Conversaciones | Al abrir «Responder», el botón «Enviar respuesta» quedaba fuera de la vista | 2 | Arreglado: el editor entra completo a la vista, con el cursor en la respuesta |
| 9. Ayudar con los errores | Privacidad | Si no se puede comprobar el acceso, las filas de administración desaparecen sin aviso | 1 | Arreglado |
| 10. Ayuda y documentación | Toda la app | La ayuda era solo texto | 2 | Arreglado en la sección 7: un video por módulo en el Centro de ayuda y en «?», y un recorrido más corto |

## Arreglos ordenados por impacto y esfuerzo

Hechos en esta PR:

1. **Errores visibles.** El Pipeline, la Tabla de datos y Bajas y bloqueos dejan de mostrar «vacío» cuando no pueden leer, y el Pipeline conserva lo último que se vio si falla la actualización automática.
2. **Campañas.** La audiencia queda marcada al buscar y el correo escrito a mano cuenta como el primero. El editor dice que la firma se agrega sola.
3. **Teléfono.** «Investigar» está en el detalle del contacto.
4. **Conversaciones.** El editor de respuesta entra completo a la vista, con el cursor en la respuesta, y al enviar se ve la confirmación (antes no se veía ninguna).
5. **Buscar prospectos.** El aviso de filtro faltante queda junto al botón, «Búsquedas guardadas» es accesible y el aviso de marcas que no se pudieron leer.

Pendientes recomendados:

| Arreglo | Impacto | Esfuerzo |
|---|---|---|
| Campañas: partir de un estilo guardado (asunto y cuerpo ya escritos) | Alto: quita 4 de los 15 pasos | Medio |
| «Escribir sin investigar» con el estilo predeterminado | Alto: el primer correo sin esperar | Medio |
| Por completar: notas y eliminar en el menú «Más» de cada fila | Medio: de 80 a unos 40 controles a la vista | Bajo |
| Campañas: «Antigüedad» y «Tamaño» como listas | Medio | Bajo |
| Firmas y estilo: «Guardar» siempre a la vista (barra fija al pie del editor) | Medio: quita el desplazamiento en 4 de 6 pasos | Bajo |

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
