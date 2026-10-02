# Cowork que explica y orienta (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- **«¿Qué puedes hacer?»** se respondía con tres puntos, porque las instrucciones pedían «tres puntos».
- **«Revisa mis leads»** listaba los 20 más recientes (16) en vez de separar por estado.
- **Respuestas cortas:** la regla de «máximo 5 líneas» dejaba cortas las explicaciones de un plan o una campaña.

## Qué cambia

1. **Guía «¿Qué puedes hacer?»** (`src/lib/cowork/capabilities-guide.ts`, `CoworkGuide`).
   - **Siete grupos:** buscar prospectos, tus contactos, investigar, correos y campañas, LinkedIn, seguimiento, y cifras e informes. Cada uno dice qué hace y qué necesita tu aprobación.
   - **Ejemplos:** uno o dos por grupo, con botón «Probar», que deja el mensaje en el cuadro para enviarlo o ajustarlo.
   - **Ayuda:** un enlace «Ver en Ayuda» a la página del Centro de ayuda.
   - **En la portada de Cowork:** un botón «¿Qué puedes hacer?» la abre y la cierra, y así la portada sigue corta.
   - **Pregunta escrita:** si alguien pregunta con sus palabras, el modelo recibe la misma guía (`coworkGuideForModel`) y responde con los siete grupos, un ejemplo por grupo adaptado a su oferta.
2. **«Revisa mis leads»: resumen por estado** (lectura `leads.summary`).
   - **Grupos:** cada contacto guardado va en un solo grupo, el más avanzado:
     - respondieron;
     - contactados sin respuesta;
     - investigados con correo y sin contactar;
     - con correo sin investigar ni contactar;
     - sin correo.
   - **Cifras:** exactas hasta 5.000 contactos. Si son más, son mínimos.
   - **Cada grupo trae su siguiente paso.** Cowork los muestra en una tarjeta de cifras y propone empezar por el grupo más avanzado que tenga gente.
   - **Datos que lee:** solo ids, correos y fechas, nunca nombres.
3. **Explicaciones más largas cuando hace falta.**
   - **La charla corriente** sigue breve.
   - **Más largo:** al explicar un plan, una propuesta o una campaña (qué pasa, a quiénes y cuánto cuesta), al resumir contactos o al presentar lo que hace, Cowork usa el largo necesario, con listas de hasta 8 puntos.

## Pruebas

- `src/lib/cowork/capabilities-guide.test.ts`: los siete grupos en orden, sus ejemplos y su página de ayuda, y la misma guía para el modelo.
- `src/lib/cowork/leads-summary.test.ts`: cada contacto en un solo grupo, cifras que suman el total, LinkedIn personal y lista recortada.
- `src/lib/server/cowork/lead-tools.test.ts`: la lectura solo toca filas propias, con tres listas acotadas y sin nombres.
- `scripts/test-cowork-guide-ui.mjs` (DOM): la guía se abre desde la portada, con los siete grupos; un ejemplo llena el cuadro; y están los enlaces a Ayuda.
