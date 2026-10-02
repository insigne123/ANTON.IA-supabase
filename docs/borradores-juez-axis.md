# Borradores del caso AXIS medidos con el juez (Plan 6, PR-D3)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 6)

Punto 14: los borradores eran pobres.
- #95 y #97 cambiaron cómo se escriben: el primer correo sale de la investigación de cada persona, con la oferta en juego y el nombre de pila.
- Faltaba medirlos con el juez en el caso AXIS.

## Cómo se midió (2 oct)

- **Conjunto** `scripts/fixtures/outreach-eval-axis.json`, con datos de prueba, como el banco AXIS:
  - la oferta AXIS de Yago SpA;
  - Valentina Fuentes, Jefa de Reclutamiento y Selección en Tiendas Andinas (retail), cuya señal es que busca 150 vendedores para Navidad (aviso de empleo);
  - Patricio Soto, Gerente de Personas en Constructora Pehuén (construcción), cuya señal es que contratará 300 trabajadores para dos obras en el Biobío (nota de prensa).
- **Secuencia completa por persona:** el primer correo y 3 seguimientos (Respaldo, Segundo ángulo y Cierre).
  - Usa el generador de producción (`native-draft/v17`) con su revisión previa y un reintento, como la app.
  - Va de tú, como el pedido del estilo por defecto.
- **El juez** (`outreach-judge/v1`) pone de 1 a 5 en suena humano, especificidad, un solo pedido, tono y tratamiento, y veracidad.
  - El código calcula el veredicto: enviar, corregir o revisión humana.
  - Cualquier hecho sin respaldo manda el correo a revisión humana.
- **Corridas:** 3, en total 24 correos. Sin escrituras ni envíos.
- **Costo:** US$ 0,043 la generación, más el juez.

```bash
OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json OUTREACH_EVAL_OUT=<carpeta> \
  node --loader ./scripts/ts-test-loader.mjs scripts/evaluate-outreach-set.ts
OUTREACH_EVAL_SET=scripts/fixtures/outreach-eval-axis.json \
  node --loader ./scripts/ts-test-loader.mjs scripts/judge-outreach-set.ts <carpeta>/outreach-eval/<fecha>
```

Sin las variables, los dos scripts usan el conjunto ServiPro y la carpeta de siempre.

## Lo que el juez necesitaba saber

**En una primera corrida, el juez marcaba como inventadas 3 cosas que el generador debe escribir.** Esa corrida tuvo 0 de 8 para enviar.
- **El pedido del estilo aprobado:** «¿Te parece si lo conversamos 15 minutos esta semana?».
- **El aviso del último correo:** «Esta es la última vez que te escribo sobre esto». Lo pide el paso Cierre.
- **El producto del vendedor:** «En Yago usamos AXIS» se leía como algo no dicho.

**Ahora `judge-outreach-set.ts` le da al juez:**
- el pedido aprobado (`cta_aprobado`);
- en una secuencia, el paso y lo que pide (`paso`);
- la descripción del vendedor;
- cada servicio como «Yago SpA ofrece: …»;
- sus pruebas (`proofPoints`).

`evaluate-outreach-set.ts` guarda el pedido aprobado en `results.json`, y un resultado anterior sin él se juzga como antes.

**Para comparar con una línea base anterior, hay que volver a juzgarla** con esta versión del juez.

## Resultados

| Paso | Enviar | Corregir | Revisión humana |
|---|---|---|---|
| Primer correo | 3 de 6 | 0 | 3 |
| Seguimiento 1, Respaldo | 0 de 6 | 2 | 4 |
| Seguimiento 2, Segundo ángulo | 0 de 6 | 2 | 4 |
| Cierre | 4 de 6 | 2 | 0 |
| **Total** | **7 de 24** | **6** | **11** |

**Promedios** (de 1 a 5):

| Criterio | Promedio |
|---|---|
| Suena humano | 3,6 |
| Especificidad | 4,3 |
| Un solo pedido | 4,9 |
| Tono y tratamiento | 4,7 |
| Veracidad | 3,7 |

**Lo que funciona:**
- Saludo con el nombre de pila en los 24: «Hola Valentina,» y «Hola Patricio,».
- La oferta en juego en los 24, con el nombre «AXIS» en 15. Los otros nombran el servicio: «consultas judiciales automáticas».
- La señal de cada persona, como los 150 vendedores o las 300 contrataciones, en casi todos (especificidad 4,3).
- Un solo pedido por correo (4,9).
- La revisión previa aprobó 23 de 24. El que no pasó, ni con el reintento, es un cierre que terminaba en «¿te parece que lo dejemos aquí?»: la revisión no lo aceptó como pregunta de sí o no.

**Lo que el juez manda a revisión, 11 correos** (en 2 de ellos, por otras inferencias):
1. **«En Yago SpA usamos AXIS»**, en el primer correo de retail, en las 3 corridas. El juez lo lee como un uso interno de Yago. Decir «AXIS, de Yago, …» lo evita.
2. **Límites del servicio sin respaldo** en los seguimientos 1 y 2, en 6 correos. Ejemplos:
   - «la decisión de contratación sigue en manos de tu equipo», en 3;
   - «su alcance es esa consulta, no otras verificaciones»;
   - «podrían dejar la revisión para la etapa final».

   El paso Respaldo pide: «si no hay prueba nueva, precisa el alcance (qué incluye y qué queda fuera)». Eso empuja a decir límites que el perfil no declara.

**Suena humano (3,6) es el criterio más bajo.** Las frases que el juez marca son de plantilla, por ejemplo «vale mirar cómo funciona esta verificación en la práctica».

## Siguiente paso: un ajuste probado, todavía sin integrar

**La rama `claude/seguimientos-sin-alcances` (`native-draft/v18`) ajusta el generador:**
- el paso Respaldo precisa el alcance solo con lo que el vendedor declara;
- no se afirman límites ni garantías del servicio que el vendedor no declara: qué no hace, qué no reemplaza, quién decide;
- lo que se ofrece se dice como de la empresa del vendedor, no como algo que la empresa usa.

**Medido con este mismo conjunto (3 corridas, 24 correos):**
- «usamos AXIS» baja de 3 correos a 0;
- los límites del servicio (quién decide, qué no hace, en qué etapa se usa) bajan de 6 correos a 0;
- el juez marca otras inferencias, por ejemplo «150 vendedores podría implicar muchas consultas»;
- el total queda igual: 7 para enviar, 7 para corregir y 10 a revisión humana;
- la veracidad sube de 3,7 a 3,9.

**Falta compararlo con el conjunto ServiPro** para descartar que empeore otros correos. Esa corrida no se pudo hacer: la cuenta de OpenAI de este entorno se quedó sin créditos (`credit_balance_exhausted`). Con créditos, se corren los dos scripts sin `OUTREACH_EVAL_SET`, una vez en `main` y otra en la rama, y se juzgan con este juez.
