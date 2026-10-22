# Oportunidades: calcular el precio

En «Cómo postular», bajo la oferta, hay una sección cerrada **«Calcular el precio»**. La ven los administradores y quien quedó a cargo de
la oportunidad (los mismos que pueden fijar los precios de la oferta). Tiene dos cálculos, los que más pesaron en las revisiones de
licitaciones reales (Las Condes, San Carlos): cuánto cuesta y a cuánto cotizar la hora, y cuánto vale el precio en puntos frente a un rival.

## Costo y valor hora

Por perfil (guardia, supervisor, auxiliar…): personas, sueldo base, bonos fijos, colación y movilización, uniforme y EPP, otros.

```
gratificación        = sueldo base × % (con tope mensual si se escribe uno)
imponible            = sueldo base + gratificación + bonos fijos
cargas del empleador = imponible × suma de las cargas
costo por persona    = imponible + cargas + colación y movilización + uniforme y EPP + otros
horas trabajadas     = horas pagadas × (1 − ausentismo)
precio por persona   = costo por persona ÷ (1 − (gastos generales + margen))
valor hora (neto)    = precio por persona ÷ horas trabajadas
```

- **Gastos generales y margen son un porcentaje del precio**, igual que en el escenario financiero que ya existe en el workspace.
- **El ausentismo** es lo que se paga y no se trabaja (vacaciones, licencias) y que el precio tiene que cubrir.
- Resultado: costo y valor hora por perfil, precio mensual (neto, con IVA), total del contrato y valor hora promedio ponderado.
- **Avisos**: si el ausentismo, los gastos generales o el margen están en 0, o falta el sueldo base de un perfil, la pantalla lo dice. Esos tres
  valores empiezan vacíos a propósito: son decisiones del negocio, no un dato.
- «Copiar el cálculo» deja un resumen de texto con cada cifra y el supuesto detrás.

### Tasas de partida (octubre de 2026)

Vienen precargadas y se pueden cambiar, quitar o agregar. **Hay que confirmarlas con contabilidad antes de ofertar**; la pantalla lo dice.

| Concepto | Valor de partida | Fuente |
|---|---|---|
| Jornada | 42 horas semanales → 182 horas pagadas al mes (42 × 52 ÷ 12) | Ley 21.561: 42 horas desde el 26-04-2026 ([24horas](https://www.24horas.cl/te-sirve/reduccion-jornada-laboral-abril-fecha-42-horas)). La cifra mensual es un cálculo, no un dato oficial |
| Cotización adicional del empleador | 3,5 % | Ley 21.735: 1 % desde agosto de 2025, 3,5 % desde agosto de 2026 hasta julio de 2027, y luego escalonada ([BioBioChile](https://www.biobiochile.cl/noticias/economia/actualidad-economica/2026/07/30/a-partir-de-agosto-sube-la-cotizacion-previsional-quien-paga-el-aumento-y-que-cambia-con-la-reforma.shtml), [24horas](https://www.24horas.cl/actualidad/nacional/reforma-previsional-cambia-agosto-nuevo-aporte-empleador)) |
| Seguro de invalidez y sobrevivencia (SIS) | 1,5 % | [Superintendencia de Pensiones](https://www.spensiones.cl/portal/institucional/594/w3-propertyvalue-10906.html) habla de 1,5 %; la presentación del Ministerio de Previsión Social menciona 1,78 %. Se dejó 1,5 % y se puede cambiar |
| Seguro de cesantía (empleador, contrato indefinido) | 2,4 % | Régimen general; no se verificó en esta revisión |
| Mutual, cotización básica | 0,93 % | La adicional depende de la empresa y no está incluida |
| Gratificación | 25 % del sueldo base | Sin tope: se escribe uno si corresponde |

## Puntaje por precio

Para una licitación donde **el precio más bajo se lleva todos los puntos del criterio y los demás reciben
*precio más bajo ÷ su precio × puntos***. La pantalla pide: cuánto vale el precio, tus puntos en todo lo demás, los de un rival típico
(si dudas, el máximo posible) y tu precio total. Entrega:

- La frase clave: *«Un rival con 22 puntos más que tú en lo demás te gana si cobra menos de $6.428.571 (78,6 % más que tú)»*. Puede decir también que un rival te gana a cualquier precio, o que no te alcanza ni cobrando casi nada.
- Una tabla con rivales entre 30 % más baratos y 40 % más caros que tú, con los puntos de cada uno y quién gana.
- Qué pasa con tus puntos si cambias tu precio.

La prueba de la fórmula reproduce las cifras de la revisión de la Compra Ágil de San Carlos (precio de 50 puntos, oferta de $3,6 MM, rival con 50 puntos
en lo demás): el rival gana si cobra menos de $6,43 MM, $5,29 MM, $5,00 MM o $4,29 MM según los compromisos técnicos que se suman (28, 34, 36 y 42 puntos).
**Confirma en las bases que esa sea la fórmula**; si el criterio de precio se evalúa de otro modo, este cálculo no aplica.

## Límites de esta primera versión

- Lo que se escribe queda **en el navegador**, para esa persona y esa oportunidad (son los costos de la empresa). No se comparte con el equipo todavía.
- No llena la planilla del cliente: cuando llegue la calculadora usada en la licitación privada de Sodimac, los campos y la salida se ajustan a ese formato, sin cambiar el formato del cliente.
- Un solo rival típico por vez, y solo la fórmula de «menor precio ÷ su precio».
