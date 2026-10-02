# Cowork explicativo (Plan 8, fase 1)

## Qué cambia

Cowork deja de ser breve por regla y pasa a explicar lo que hace, siempre:
1. **Primero la conclusión,** en una o dos frases, con sus cifras.
2. **Qué revisó y cuánto,** en palabras del usuario y sin nombres de herramientas: «Revisé tus 406 contactos y los envíos de los últimos 30 días».
3. **Qué encontró y por qué importa,** con cifras y su período.
4. **Qué propone y por qué:** qué pasa al aprobar (costo o créditos, que nada sale sin aprobación) y la alternativa si la hay.

**Preguntas del usuario** («¿qué es…?», «¿cómo…?», «¿por qué…?»): contexto, un ejemplo de su cuenta o de su oferta y los límites.

**Largo:**
- de 120 a 350 palabras en el chat cuando hay algo que explicar;
- párrafos de hasta 4 líneas, con viñetas o subtítulos cuando ayudan;
- lo que pasa de 350 palabras va al documento;
- un saludo o una confirmación simple pueden ser más cortos.

**Se mantiene:**
- sin jerga, códigos ni identificadores;
- una sola pregunta al final;
- las tarjetas y bloques;
- la Redactora escribe correos breves; lo que cambia es su `reply`, que explica qué escribió y qué ángulo usó.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/lib/cowork/agent-instructions.ts` | La personalidad explicativa, la regla 8 nueva en lugar de «Chat breve», y las recetas, bloques, documento y métricas con su explicación |
| `src/lib/cowork/writer.ts` | `reply` de la Redactora: qué escribió, para quién y por qué ese ángulo |
| `src/lib/cowork/agent-loop.ts` | El aviso de «correos en el chat» pide explicar en `reply` sin repetir los correos |
| `src/lib/cowork/answer-quality.ts` | Los chequeos del chat: muletilla o saludo al abrir, más de 400 palabras, o un párrafo de más de 110 palabras sin cortar |
| `src/lib/cowork/judge.ts` | El juez puntúa «explica» (qué hizo, qué encontró, qué propone y por qué), fuera del veredicto |
| `scripts/judge-cowork-conversations.ts` | El informe del juez incluye «explica» |

## Medición con el modelo real (2 oct 2026)

Banco AXIS: 44 operaciones × 3, con el juez. Antes es `main` (66cea69); después, esta rama.

| Qué | Antes | Después |
|---|---|---|
| Verificaciones | 68,6 % (1.290 de 1.881) | 69,6 % (1.310 de 1.881) |
| «Explica» (1 a 5) | 3,22 | 3,61 |
| «Explica» de 4 o más | 39 de 132 | 71 de 132 |
| Veredicto «buena» del juez | 18 de 132 | 22 de 132 |
| Comprensión / claridad | 4,08 / 4,48 | 4,30 / 4,52 |
| Palabras del chat (p50 / p95) | 64 / 98 | 94 / 168 |
| Duración de la decisión (p50 / p95) | 5,5 s / 11,9 s | 6,9 s / 16,0 s |
| Tokens de salida (p95) | 1.063 | 1.177 |
| Cortes por tiempo | 0 | 0 |

**Lectura:**
- explica más sin perder verificaciones, y la claridad no baja;
- la duración p95 queda en 16 s, bajo los 20 s fijados: el límite de 30 s del coordinador no cambia;
- la meta de «explica» de 4 o más en todas no se alcanza: la mayor parte de lo que falta son las propuestas, donde la tarjeta de aprobación ya explica el efecto.

**Una regla más estricta no mejoró:** se probó una regla 8 en orden fijo (conclusión, qué revisé, qué encontré, qué propongo) y propuestas de 2 a 5 frases. En las 48 corridas de los grupos 2, 5 y 7:

| Versión | Verificaciones | «Explica» | Utilidad | Muros de texto |
|---|---|---|---|---|
| `main` | 66,8 % | 3,15 | 3,08 | 0 |
| Esta rama | 69,3 % | 3,50 | 3,15 | 0 |
| Regla estricta | 68,1 % | 3,48 | 2,96 | 2 |

Por eso queda la regla de esta rama.

## Cómo repetir la medición

```bash
# Por bloque (axis-a*, axis-b*… hasta axis-h*), para no pasar el tope de llamadas
node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-cowork-conversations.ts \
  --live --stream --writer --cases='axis-a*' --repeat=3 --max-calls=400 --output=axis-a.json
node --loader ./scripts/ts-test-loader.mjs scripts/judge-cowork-conversations.ts \
  --live --judge-model=gpt-6-sol --input=axis-a.json --output=axis-a-juez.json
```

Usa las claves de `.env.test.local`. No escribe en la base ni envía correos. El informe del juez trae «explica» junto a las notas de siempre.
