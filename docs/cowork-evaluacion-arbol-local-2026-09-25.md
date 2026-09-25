# Evaluación Cowork con el modelo real (25 sep 2026)

Corpus de 14 conversaciones (`scripts/fixtures/cowork-conversation-corpus.ts`) jugado con
el bucle y el contexto reales contra `gpt-6-luna`, con herramientas de utilería.
Comando:

```
OPENAI_API_KEY=... COWORK_MODEL=gpt-6-luna node --loader ./scripts/ts-test-loader.mjs \
  scripts/evaluate-cowork-conversations.ts --live --max-calls=120 --repeat=2
```

| | Repetición 1 | Repetición 2 | Total |
|---|---|---|---|
| Casos aprobados | 14 de 14 | 14 de 14 | **28 de 28** |
| Verificaciones aprobadas | 84 de 84 | 84 de 84 | **168 de 168** |
| Trabajos en error | 0 | 0 | 0 |
| Respuestas con problemas (verificador léxico) | 0 | 0 | 0 |
| Llamadas al modelo | 30 | 34 | 64 |

## Alcance y límites

- Las herramientas son de utilería copiadas de un workspace; no se tocó producción,
  la base de datos ni proveedores. Solo gasto: llamadas al modelo de evaluación.
- Las verificaciones son léxicas y estructurales (sin jerga, sin IDs, cierre con
  siguiente paso, propuesta bien formada); complementan, no reemplazan, la lectura
  humana de las respuestas.
- Estabilidad: dos repeticiones del corpus completo, ambas en 14/14. Variación entre
  corridas existe en modelos pequeños; los frenos deterministas del bucle
  (documento con propuesta, enriquecimiento repetido, presupuesto) acotan el daño.
- El JSON crudo de esta corrida no se commitea (salida local de gran tamaño);
  para repetirla usa el comando de arriba.
