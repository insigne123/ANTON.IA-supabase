# Visual System

## Direccion

La app debe sentirse como una herramienta SaaS premium y sobria, con una disciplina de simpleza inspirada en Apple: clara, precisa, silenciosa y facil de usar.

## Principios

- una sola accion principal por superficie
- profundidad por capas, no por ruido
- fondos con atmosfera sutil, no planos sin intencion
- cards y paneles con radios amplios y sombras suaves
- estados claros en hover, focus, loading y disabled
- eliminar cualquier bloque que no aporte decision, lectura o accion
- el contenido visible debe hablar como producto para usuario final, no como nota interna del equipo

## Light / Dark

- todo bloque nuevo debe tener variante `dark:` real
- evitar blancos y grises fijos sin contraparte en dark mode
- bordes en light: `slate-200` aprox; en dark: `slate-800`
- superficies en dark deben separar bien fondo, card y panel interno
- textos secundarios en dark nunca deben caer por debajo de contraste util

## Layout

- preferir composicion tipo workspace para pantallas complejas
- hero superior para contexto, rail lateral para estado, panel central para trabajo
- evitar paginas infinitas cuando un panel puede tener scroll interno
- en mobile, priorizar lectura y acciones sobre densidad visual
- cuando una pantalla funcione mejor con menos secciones, reducir primero antes de adornar

## Componentes

- badges: informativos, no decorativos por defecto
- cards: deben comunicar rol claro (editor, contexto, preview, accion)
- selects e inputs: encapsulados dentro de surfaces, no flotando solos
- previews: deben parecer producto real, no placeholder tecnico
- si una card no tiene valor directo para el usuario, debe fusionarse o desaparecer

## Tipografia

- titulares con peso y tracking ajustado
- cuerpo en 14-16px con line-height comodo
- labels en uppercase solo para metadatos o micro jerarquia

## Color

- indigo y sky para inteligencia, flujo y sistema
- amber para warning o criterio de calidad
- emerald para exito o validacion
- no usar colores fuertes sin una funcion clara
