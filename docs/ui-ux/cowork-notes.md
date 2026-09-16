# Cowork — composición inicial

Referencia: cinco capturas entregadas por el usuario en la conversación de planificación. Problema: flujo, layout y componente. Patrones rescatados: inicio centrado, historial colapsable, respuesta sin tarjetas redundantes, progreso/resultados/contexto y documento que ocupa el lateral al abrirse.

Se adapta a componentes y tokens de ANTON.IA. No se copian logotipos, assets ni tipografías de Claude. El shell existente permanece; el workspace usa `Button`, `Textarea`, `Label` y colores semánticos de ambos temas. En móvil, el documento reemplaza temporalmente la conversación y Cerrar devuelve el foco a Abrir.

Estado implementado: inicio, recientes, solicitud con continuación enlazada, actividad persistida, consultas de contactos propios, exportación CSV y documento Markdown como texto descargable. No se muestran controles de ejecución de código, adjuntos o autonomía todavía inexistentes. Continuar abre un nuevo trabajo que recibe el contexto del anterior; no se presenta como edición in situ del mismo artefacto.

Revisión DOM automatizada: abrir/cerrar documento, recuperación de foco, contenido no ejecutable, carga de resultados con metadata y eliminación del resultado ante 403. Pendientes: capturas en navegador, contraste calculado, tamaños 360/768/1440, light/dark y teclado completo. No certificar checklist visual hasta completar esa revisión.

Incremento de resultados: contactos observados en lista filtrable con scroll interno y columnas que colapsan en móvil. Menú de descarga compartido: Excel/CSV para contactos, PDF/Markdown para documento. La descarga incluye todo el resultado observado, no el filtro visual; se explica junto al input. Loading y errores de descarga preservan contexto, mientras 401/403 retiran resultados privados. DOM de filtro y revocación verificado; auditoría renderizada sigue pendiente.
