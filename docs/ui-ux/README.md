# UI/UX Operating System

Esta carpeta define como mejorar interfaces en este proyecto sin caer en UI generica.

## Objetivos

- usar referencias reales antes de rediseñar
- mantener consistencia entre modo dia y modo noche
- revisar responsive, jerarquia y accesibilidad antes de release
- documentar decisiones visuales para que futuras iteraciones no partan desde cero

## Documentos

- `docs/ui-ux/apple-inspired-methodology.md`: metodologia anterior (tipo Apple). Queda como referencia historica; ya no es la direccion por defecto
- `docs/ui-ux/visual-system.md`: reglas visuales base de la app
- `docs/ui-ux/motion.md`: cuando y como se anima Cowork; cada animacion explica un cambio, nunca decora
- `docs/ui-ux/reference-workflow.md`: flujo obligatorio antes de tocar UI
- `docs/ui-ux/release-audit-checklist.md`: checklist de revision visual antes de deploy
- `docs/ui-ux/auditoria-visual.md`: banco de pruebas que recorre cada pantalla con sesion iniciada (`npm run audit:visual`) y el recorrido base contra el que se compara cada cambio
- `scripts/visual-audit/README.md` (seccion «Recorrido de interacciones»): `npm run audit:interactions` usa cada pantalla (menus, dialogos, pestañas, teclado) y la prueba con lecturas que fallan, lentas y textos largos
- `scripts/usability/README.md`: `npm run audit:simplicity`, el indice de sencillez de 12 tareas clave en escritorio y telefono
- `docs/ui-ux/email-studio-notes.md`: referencias y decisiones especificas de Email Studio
- `docs/ui-ux/tutorial-guiado.md`: recorrido guiado para cuentas nuevas, como omitirlo, volver a verlo y cambiarlo
- `docs/ui-ux/ayuda-y-manual.md`: recorrido v3 por toda la app, boton «?» de cada pantalla, «Preguntale a la IA» y Centro de ayuda (`/ayuda`)

## Fuentes de referencia prioritarias

- `https://www.unsection.com/` para estructura, ritmo vertical y hero sections
- `https://www.figcomponents.com/` para dashboards, sidebars, settings y componentes
- `https://screensdesign.com/` para flujos de producto y experiencia de app
- `https://toolfolio.io/` para descubrir mas recursos, tooling y librerias

## Skills instaladas en este repo

- `premium-layout-composer`
- `form-ux-patterns`
- `empty-states-microcopy`
- `component-api-consistency`
- `wcag-remediator`

## Referencias externas validadas

- `uipro-cli`: CLI comunitaria que instala UI/UX Pro Max para OpenCode y otros asistentes
- `ui-skills`: pack comunitario con baseline UI, accesibilidad y motion
- `onemore-design`: pack comunitario centrado en patrones HIG

## Regla principal

La interfaz se disena para lo mas intuitivo y util para el objetivo del usuario, con la paleta de colores actual. Se agregan tablas, tarjetas, graficos o acciones cuando acercan al usuario a su objetivo, y se quita lo decorativo. El estilo Apple-like dejo de ser una restriccion (decision del dueno, 26 sep 2026).
