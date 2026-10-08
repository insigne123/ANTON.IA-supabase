# Plan 16: seguimientos de LinkedIn, una persona por empresa sin devolver la elección (8 oct)

## Problema

A «¿A quién le hago seguimiento por LinkedIn esta semana? Una persona por empresa», Cowork leía bien los candidatos, pero devolvía
la elección al usuario («¿Prefieres a Paula Ríos o a Hugo Mena para Transportes del Sur?») o le preguntaba qué novedad usar. El juez
lo marcaba como mala respuesta: Cowork podía elegir y dejar el siguiente paso listo. Como el segundo mensaje debe aportar algo nuevo,
lo que faltaba era usar una prueba de la oferta que ya está en el Perfil.

## Qué cambia

- Instrucciones de `linkedin.followups` (`agent-instructions.ts`):
  - si pide una persona por empresa, Cowork elige: con dos de la misma empresa, la de cargo más cercano a la decisión o la que lleva
    más días esperando;
  - nombra a la otra para otra semana, sin preguntar cuál;
  - en la pregunta final ofrece preparar los mensajes (con aprobación), con una prueba o un caso de la oferta que diga cuál usaría.
- Juez (`judge.ts`): revelar teléfonos se aprueba de a una persona (10 créditos cada uno). Ante varias, proponer la primera y decir que
  cada una lleva su aprobación es la regla del producto, no fricción.
- Banco: el check de Hugo acepta «otra semana» y el de Tomás acepta «su empresa no aparece».

## Medición

Se corrió `lectura-seguimiento-empresa` 3 veces con `gpt-6-luna`:

| | main | este PR |
|---|---|---|
| Elige una persona por empresa sin preguntar cuál | 1 de 3 | 3 de 3 |
| Deja a Hugo para otra semana | 0 de 3 | 3 de 3 |
| Ofrece preparar los mensajes con una prueba de AXIS («procesa 1.000 personas en unos 30 minutos») | 0 de 3 | 3 de 3 |
| Pasa sus checks | 0 de 3 | 1 de 3 (una lee también las fichas por perfil; otra no dice que no conoce la empresa de Tomás) |

`linkedin-seguimiento` (sin seguimientos elegibles) sigue igual: falla por su check de sincronización, que no toca este cambio.

Sin migraciones ni flags.
