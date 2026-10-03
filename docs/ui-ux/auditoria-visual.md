# Auditoría visual: banco de pruebas y recorrido base

`npm run audit:visual` recorre las 52 pantallas de la app con sesión iniciada contra un Supabase simulado, sin `.env`, sin red externa y sin enviar nada. Toma capturas y anota lo que falla. Cómo correrlo, sus opciones y cómo se aísla: `scripts/visual-audit/README.md`.

## Para qué se usa

- **En cada PR que toca pantallas:** corre el recorrido en `main` y en tu rama, y compara con `--baseline`. El PR no agrega hallazgos y adjunta las capturas antes y después.
- **Al cerrar un plan:** recorrido completo, comparado con el recorrido base de abajo.

```bash
git switch main && npm run audit:visual -- --routes=/search --out=.visual-audit/antes
git switch claude/mi-rama && npm run audit:visual -- --routes=/search --baseline=.visual-audit/antes
```

## Recorrido base (3 oct 2026, `main` en 6427d23)

- **Alcance:** 145 visitas: el owner con datos completos y vacíos, el miembro y una visita sin sesión.
- **Variantes:** cada visita a 390 y 1440 px, en claro y oscuro. En total, 580 capturas.
- **Duración:** 12 minutos.

| Tipo | Hallazgos | Dónde | Lo arregla |
|---|---|---|---|
| Errores de página | 0 | — | — |
| Respuestas ≥ 500 | 0 | — | — |
| No terminó de cargar | 0 | — | — |
| Hosts externos | 0 | — | — |
| Acceso indebido | 9 | El miembro, que no está en ninguna lista, ve Administración (5 pantallas), `/debug` y Privacidad (3) | PR-2 (`/debug`) y PR-6 (guardas de servidor) |
| Desborde a 390 px | 10 | «Bajas»: el botón «Actualizar» sobra 85 px. «Probar envíos»: 43 px | PR-18 y PR-2 |
| Escritura al cargar | 5 | La invitación se acepta sola al abrirla. Búsqueda guarda su punto de control al entrar | PR-6 y PR-11 |
| `console.error` | 11 | 403 de las APIs de Administración y Privacidad para el miembro (consecuencia del acceso indebido). La aceptación bloqueada de la invitación. `/api/debug/logs` | PR-6 y PR-2 |
| Accesibilidad (axe, serias y críticas) | 274 | Ver abajo | PR-4, PR-5 y los PR de cada sección |

**Accesibilidad**
- **Contraste insuficiente (156, casi todos en modo claro):** en 46 pantallas.
  - La causa más repetida son las etiquetas de grupo del menú («Centro de mando», «Prospectar»…), que aparecen en cada pantalla. Lo arregla PR-5.
  - Lo demás: texto atenuado de 12 px, pestañas y cabeceras ordenables de tablas. Lo arreglan PR-4 y los PR de cada sección.
- **Botones sin nombre (68):** en Importar contactos, Solicitudes e Incidentes de privacidad, Bajas, la analítica y el planificador (los dos últimos se retiran en PR-2).
- **Atributos ARIA no permitidos (28):** los ejes del gráfico de Inicio, Créditos y Administración.
- **Otros:**
  - SVG sin texto alternativo (8) y campos sin etiqueta (8), en pantallas que se retiran;
  - zonas con desplazamiento que no se alcanzan con teclado (6), en Bajas y el planificador.

**Qué muestran las capturas**
- **Inicio:**
  - la lista de preparación ya completa sigue ocupando la columna derecha;
  - «Campañas activas» dice 0 con una campaña aprobada en curso;
  - el gráfico y los créditos quedan al final.
- **Búsqueda:** un formulario largo en una sola columna, sin un lugar fijo para los resultados.
- **Menú:**
  - la tarjeta «Versión v0.1.0» ocupa espacio;
  - «Cerrar Sesión» va en mayúsculas de título.

El rediseño de PR-9 a PR-15 parte de estas capturas.

**Datos de prueba**
- La app leyó 20 tablas sin datos de prueba. Responden vacías, y el reporte las lista en «Del servidor». Si una pantalla nueva depende de una, agrega sus filas en `scripts/visual-audit/fixtures/`.
- Ninguna conexión salió de la máquina.
- El servidor no registró errores.
