# Oportunidades · la IA elige las licitaciones (Plan 15, 4)

## El problema

Antes solo se miraban las licitaciones cuyo nombre decía una de las palabras del perfil. De unas 4.500 abiertas al día, aparecían 0 a 2 nuevas, y el filtro fallaba en los dos sentidos:
- «suministro de personal» nunca encontraba «Servicio de digitación con dotación de 8 operadores»;
- «personal» sí encontraba «Elementos de protección personal».

## Qué cambia

1. **Se trae la lista completa** de licitaciones abiertas de Mercado Público, en una consulta, como antes.
2. **La IA la lee completa** contra lo que vendes según el Perfil (`tender-ai.ts`, `gpt-6-luna`):
   - lotes de 450 nombres, 5 a la vez, por un máximo de 80 s;
   - devuelve solo las licitaciones a las que la empresa podría postular, con su encaje («alta» o «media») y una frase que dice por qué.
3. **Compra Ágil** se consulta con las palabras generadas del Perfil, y la IA también lee sus resultados.
4. **Mientras la IA lee, se consulta Compra Ágil**: la lectura usa el modelo, no el ticket, así que se hacen en paralelo. Después se pide el detalle de lo que la IA dejó: primero las de encaje alto y luego las de plazo más cercano.
5. **Puntaje:** 55 puntos por encaje alto y 35 por encaje medio. Se suman, como antes, el monto, los días que quedan y la región, más 5 si además nombra una palabra del perfil. El motivo de la IA va primero en la tarjeta («Muy afín: …»).
6. **Respaldo:** lo que la IA no alcanzó a leer, porque falló un lote o se acabó el tiempo, se decide por palabras, como antes. La búsqueda lo indica («La IA revisó X de Y…»). Una falla del modelo nunca oculta lo que antes se encontraba.
7. **Códigos UNSPSC:** una licitación con uno de los códigos del perfil entra igual, porque la persona los eligió a propósito.
8. **Reutilización:** lo que la IA ya dijo de una licitación guardada se reutiliza mientras la oferta no cambie (`profileKey`). Con otra oferta, se vuelve a leer todo.

## Medición

`gpt-6-luna` sobre un lote de 450 nombres con la oferta de GrupoExpro (15 pertinentes, 9 trampas y el resto de otros rubros):

| | Resultado |
|---|---|
| Tiempo y costo | 7,7 s y US$0,0014 |
| Pertinentes que encontró | 13 de 15 |
| Trampas que dejó entrar | 0 de 9 |
| Otros rubros que dejó entrar | 0 |

- Las trampas incluían «elementos de protección personal», «capacitación del personal» y «software de remuneraciones».
- Las dos pertinentes que no encontró son de aseo y de guardias con dotación: dudosas para un proveedor de servicios transitorios.
- Para las ~4.500 del día: unos 16 s y cerca de US$0,014 diarios. El costo queda registrado en la búsqueda.

## Archivos

- `src/lib/server/commercial-opportunities/tender-ai.ts`: nuevo, con su prueba.
- `tenders.ts`: `matchScreenedTender`.
- `records.ts`: `data.ai`.
- `tender-sync.ts`: nuevo orden y respaldo, con su prueba.
- `store.ts`: `storedVerdicts`.
- La tarjeta y los textos de Licitaciones, y el manual.
