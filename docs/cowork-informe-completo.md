# Cowork lee el informe completo (Plan 6, PR-C1)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 6)

Puntos 12 y 13: informes «breves» y sin un informe individual por persona y empresa.

**Los informes no eran breves.** En producción (2 oct, solo lectura), los 2 informes escritos el 1 oct tienen 1511 y 1638 palabras, en siete secciones:
- resumen y decisión;
- la persona;
- la empresa;
- oportunidades;
- cómo abrir la conversación;
- preguntas;
- riesgos.

**Lo breve era lo que Cowork mostraba:**
- `research.get_existing` leía solo la evidencia cruda de la investigación (hasta 25 datos sueltos), nunca el informe escrito;
- el aviso de fin de investigación le pedía contar cada informe «en pocas líneas»;
- además, solo aceptaba contactos guardados: la investigación de un contacto de «Por escribir» (#105) no se podía leer, y el aviso lo nombraba «Contacto sin nombre».

## Qué cambia

- **`research.get_existing` trae el informe escrito** (`src/lib/server/cowork/research-read.ts`):
  - `report.sections`: cada sección en prosa completa, en orden de lectura, con su título;
  - tope de 3000 caracteres por sección y 16 000 en total; si algo se corta, `truncated` lo dice;
  - `report.caveats`: lo que la revisión retiró o no pudo confirmar, una vez;
  - solo el informe visible, de la persona y su organización;
  - si no hay informe, `reportStatus` dice por qué: se está escribiendo, falló o no existe. La evidencia sigue llegando igual, con sus fuentes.
- **Contactos de «Por escribir»:**
  - su investigación se lee igual que la de un guardado;
  - el aviso de fin y la tarjeta en vivo los nombran.
- **El aviso de fin de investigación** pide entregar los informes completos en un documento, una sección por persona, sin resumirlos. En el chat va una línea por persona con lo más útil para escribirle.
- **Instrucciones de Cowork:**
  - si el usuario pide ver el informe de una persona, se entrega completo, sección por sección;
  - para correos y seguimientos se usan sus secciones de oportunidades, cómo abrir la conversación y preguntas.

## Sin migración

La RLS de `research_report_documents` y `research_report_synthesis_states` ya deja a cada persona leer los suyos.

## Pruebas

- **`src/lib/server/cowork/research-read.test.ts`:**
  - el informe completo, en orden de lectura y sin los bloques que arma la app;
  - el tope por sección y total, con la decisión primero;
  - solo el informe visible, filtrado por persona y organización;
  - por qué no hay informe: se escribe, falló o no existe;
  - un contacto de «Por escribir» sí y uno ajeno no.
- **`scripts/test-cowork-research-notice.mjs`:** el aviso nombra a un contacto de «Por escribir» y pide el informe completo.
