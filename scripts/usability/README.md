# Índice de sencillez

Mide qué tan fácil es usar la app: hace 12 tareas clave como lo haría una persona nueva, en escritorio (1440 px) y en teléfono (390 px), sobre el banco de la auditoría visual (Supabase simulado, sin red, sin envíos reales).

```bash
npm run audit:simplicity                                   # las 12 tareas
npm run audit:simplicity -- --tasks=perfil,importar --viewports=desktop
npm run audit:simplicity -- --skip-build --out=.visual-audit/sencillez-antes
```

Es una medición experta y automática: no reemplaza una prueba con personas.

La última medición, con el antes y el después y la evaluación heurística, está en `docs/ui-ux/sencillez.md`.

## Las tareas

`tasks.mjs` describe cada tarea como la haría alguien que no conoce la app: los pasos nombran el control por lo que la persona lee en pantalla («Buscar empresas», «Nombre de campaña»), con nombres exactos, y en teléfono abren antes el menú cuando hace falta. Cada tarea tiene:

- `ideal`: los pasos del camino más corto posible, según el diseño.
- `steps`: `target` (rol y nombre, etiqueta, texto o CSS) y la acción: clic, `fill`, `choose`, `upload`, `optional` o `wait`. `skipIf` salta un paso que la pantalla ya hizo por la persona (por ejemplo, una selección hecha de antemano).
- `mocks`: las pocas llamadas que el banco bloquea (búsqueda, envío, IA), respondidas por el navegador con la forma real.
- `done`: cómo se comprueba que se logró (un texto en pantalla, una llamada o una escritura).
- `pending`: pasos que el banco no puede correr (después de una investigación de 1 a 3 minutos), contados desde el diseño.

## Cómo se puntúa

De 0 a 100 por tarea; el índice es el promedio.

| Parte | Peso | Cómo se mide |
|---|---:|---|
| Logra hacerlo | 30 | Escritorio 20 + teléfono 10 |
| Pasos | 20 | Pasos ideales / pasos hechos |
| Tiempo | 10 | Modelo KLM (Card, Moran y Newell): 30 s o menos es completo, 150 s o más es cero |
| Decisiones | 15 | Controles a la vista por pantalla: 12 o menos es completo, 60 o más es cero |
| A la vista | 15 | El siguiente control se ve sin desplazarse: escritorio 10 + teléfono 5 |
| Claridad | 10 | Una o dos acciones principales por pantalla (5) y 150 palabras o menos por pantalla (5; 500 es cero) |

Operadores KLM: K 0,28 s por tecla, P 1,1 s apuntar, BB 0,2 s clic, H 0,4 s mano al teclado, M 1,35 s pensar, 1,5 s desplazarse y 3 s el diálogo de archivos.

## Salida

En `--out` (o `.visual-audit/sencillez-<fecha>/`): `simplicity.md` con el índice por módulo y por tarea, las partes de cada índice y el paso a paso (espera real, controles, acciones principales, palabras y si estaba a la vista); `simplicity.json` con todo; y en `shots/` la última pantalla de cada tarea (`-fallo.png` si no se logró).
