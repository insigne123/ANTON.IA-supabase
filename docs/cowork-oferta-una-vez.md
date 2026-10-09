# Cowork: el siguiente paso se ofrece una sola vez (9 oct 2026)

## Problema

El barrido a ciegas de 20 casos de marketing e inicio marcó «oferta repetida» en 10 de 60 respuestas: el texto ofrecía el paso
siguiente y la pregunta final lo volvía a ofrecer («…4 tienen correo; puedo preparar una primera campaña para ellos.» y «¿Te preparo
una primera campaña pausada para tus 4 contactos con correo?»). Una regla en el prompt para evitarlo ya se había probado y empeoraba
(5 repeticiones contra 2).

## Cambio

`src/lib/cowork/answer-quality.ts`: `withoutRepeatedOffer`, en `polishCoworkAnswer`, quita del último párrafo la cláusula que ofrece
el paso («puedo…», «podemos…», «el próximo paso es…», sola o tras «;» o «así que») cuando la pregunta final la cubre: comparten al
menos dos palabras y todos los nombres de la cláusula están en la pregunta. No la quita cuando:

- es una recomendación («conviene…»), que suele ser la respuesta que el usuario pidió;
- lo que sigue depende de ella («…; después, si te sirve, …», «…; nada se envía hasta que la actives»);
- agrega a otra persona u otro paso;
- la respuesta quedaría vacía.

Las abreviaturas en mayúsculas («RR. HH.») no cortan la frase.

## Medición

Como el cambio es determinístico, se midió aplicándolo a respuestas reales de `gpt-6-luna` y comparando cada respuesta original con
su versión limpia, en pares y en orden al azar, con un lector independiente:

| | Pares | Prefiere la limpia | Prefiere la original |
|---|---|---|---|
| Primera lectura (186 respuestas con pregunta de mediciones anteriores) | 10 | 7 | 3 |
| Segunda lectura (30 respuestas nuevas, regla sin «conviene» ni conectores) | 7 | 5 | 2 |
| Regla final sobre los 17 pares | 11 que cambian | 11 | 0 |

Los ajustes («conviene», conectores, referente) salieron de las preferencias de esas lecturas. Con la regla final, las 5 respuestas
que el lector prefirió en su forma original ya no se tocan, y se pierde una limpieza que había preferido. Cambia cerca del 6 % de las
respuestas con pregunta final.

Sin migraciones ni flags.
