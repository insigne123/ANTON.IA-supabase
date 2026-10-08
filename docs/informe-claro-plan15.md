# El informe dice primero qué hacer y no rellena (Plan 15, 8 oct)

Objetivo del dueño: que la investigación y el informe sean poderosos y creen material de calidad, fácil de entender.

## Problema

El editor del informe (`src/ai/flows/write-report-v2.ts`, `report-v2/editor/8`) pedía siempre de 1300 a 1900 palabras y «responder
todas las dimensiones», agrupando los datos ausentes «en una frase por tema». Con poca evidencia (lo habitual: el cargo, una línea de
la empresa y una señal), el modelo llenaba el largo con salvedades.

Medido con el caso AXIS de retail (Valentina Fuentes, Tiendas Andinas, búsqueda de 150 vendedores para Navidad; 3 afirmaciones):
- 2149 y 1916 palabras;
- de 7 a 14 salvedades repetidas («no está confirmado», «no equivale a», «no permite inferir», «no corresponde trasladar…»);
- una lista de lo que el perfil no trae («no especifica su seniority, antigüedad, ubicación, correo, teléfono ni LinkedIn»);
- la idea de primer correo empezaba con «Me gustaría entender…», la fórmula que el generador de borradores prohíbe.

## Qué cambia (`report-v2/editor/9`)

- **El largo sigue a la evidencia** (`reportV2WordRange`): hasta 6 afirmaciones, de 600 a 1000 palabras; hasta 15, de 900 a 1400; con
  más, de 1200 a 1700. Nunca se rellena.
- **La decisión primero**: verdict abre con una frase que dice si conviene escribirle ahora, después de qué, o no, y por qué.
- **Salvedades una sola vez**: lo que falta confirmar va en «Límites» y en el «Qué no afirmar» de la guía para escribirle. En el resto,
  las hipótesis van en condicional o como pregunta, sin repetir la advertencia ni enumerar lo que no hay.
- **Ticket, monto y conversión**: si no hay datos, una frase en «Límites» con lo que permitiría estimarlos.
- **La guía para escribirle**: de 2 a 5 ángulos según lo que haya (antes, de 3 a 5 siempre), y el primer correo abre con el dato o la
  señal del contacto, dice en presente qué hace la oferta y pregunta por su proceso, sin «me gustaría» ni presentaciones.

Las reglas de veracidad no cambian: no inventar experiencia, clientes ni resultados del vendedor; las hipótesis siguen siendo hipótesis.

## Medición

`scripts/review-report-v2.ts --replay` con el modelo real (`gpt-6-luna`), sin escrituras. Dos casos AXIS armados desde
`scripts/fixtures/outreach-eval-axis.json` (3 fuentes cada uno: sitio, señal y perfil).

| | editor/8 (main) | editor/9 |
|---|---|---|
| Palabras (retail, 2 corridas) | 2149 · 1916 | 1056 · 886 |
| Palabras (construcción) | 1936 | 1000 |
| Salvedades repetidas | 14 · 7 · 4 | 2 · 2 · 2 |
| «Me gustaría» en el primer correo | 3 de 3 | 0 de 3 |
| Estado | completo en 3 de 3, revisión con aviso en 3 | completo en 3 de 3, revisión aprobada en 2 |
| Tiempo | 61 a 69 s | 46 a 64 s |
| Costo | US$ 0,0049 a 0,0053 | US$ 0,0039 a 0,0057 |

Cómo abre ahora: «Conviene escribirle ahora a Patricio Soto con una pregunta exploratoria: Constructora Pehuén contratará 300
trabajadores para dos obras nuevas en Biobío…». Antes: «Constructora Pehuén presenta un encaje potencial para explorar…».

Primer correo sugerido ahora: «Vi que Tiendas Andinas busca 150 vendedores para Navidad. Yago automatiza consultas judiciales en el
Poder Judicial para revisar antecedentes laborales. ¿Realizan hoy este tipo de verificación para candidatos a tienda y, si es así,
cómo es el proceso?».

Los informes ya escritos no se regeneran; aplica a los nuevos. Sin migraciones ni flags.
