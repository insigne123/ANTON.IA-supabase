# Oportunidades: calcular el precio

En «Cómo postular», bajo la oferta, hay una sección cerrada **«Calcular el precio»**. La ven los administradores y quien quedó a cargo de
la oportunidad (los mismos que pueden fijar los precios de la oferta). Tiene dos cálculos, los que más pesaron en las revisiones de
licitaciones reales (Las Condes, San Carlos y una licitación privada de guardias): cuánto cuesta y a cuánto cotizar la hora (por perfil, por puesto en turnos y por sitio), y cuánto vale el precio en puntos frente a un rival.

## Costo y valor hora

Por perfil (guardia, supervisor, auxiliar…): personas, sueldo base, bonos fijos, colación y movilización, uniforme y EPP, otros.

```
gratificación        = sueldo base × % (con tope: el que se escribe o, si hay ingreso mínimo, 4,75 ingresos mínimos al año ÷ 12)
imponible            = sueldo base + gratificación + bonos fijos
cargas del empleador = imponible × suma de las cargas (cotizaciones y provisiones)
aguinaldos           = aguinaldos y bonos al año ÷ 12
festivos             = festivos al año × horas de cada uno × valor de la hora extra ÷ 12
                       (hora extra = sueldo base ÷ 30 × 28 ÷ (jornada semanal × 4) × 1,5)
costo por persona    = imponible + cargas + colación y movilización + uniforme y EPP + otros
                       + aguinaldos + festivos + gastos por persona (supervisor y prevencionista repartidos, radio, curso…)
precio por persona   = costo por persona ÷ (1 − (gastos generales + margen))     [base: el precio]
                     = costo por persona × (1 + (gastos generales + utilidad))   [base: el costo]
                       + costos sin utilidad (bono de asistencia, boleta de garantía, seguros)
horas por persona    = horas pagadas        (o las horas del puesto ÷ personas por puesto, si el perfil tiene puesto)
horas trabajadas     = horas por persona × (1 − ausentismo)
valor hora (neto)    = precio por persona ÷ horas trabajadas
```

- **La utilidad se calcula sobre el precio o sobre el costo**, a elección. Por defecto es **sobre el precio** (10 % de margen = costo ÷ 0,90), igual que en el escenario financiero del workspace. Algunos formularios de clientes la definen **sobre el costo** (10 % de utilidad = costo × 1,10): con el mismo 10 %, el precio sale distinto, y usar la regla equivocada es error de precio. Lo **sin utilidad** (asistencia, boleta, seguros) se suma después, en ambos casos.
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

## Puestos en turnos y precio por sitio

Cuando el servicio se cotiza por **puesto** (guardias en turno 4x4, por ejemplo) el cálculo cambia de unidad: el puesto lo cubren varias personas, y el valor hora del formulario es el del puesto.

- **Puesto de un perfil:** «Personas por puesto» (4x4 son 2) y «Horas del puesto al mes» (11 horas al día son 11 × 365 ÷ 12 = 334,58). Cada persona cubre las horas del puesto ÷ las personas (167,29). El precio del puesto es el de **todas** sus personas juntas, y el valor hora es el precio del puesto ÷ las horas del puesto.
- **Precio por sitio:** una tabla con los puestos de cada sitio. Cada puesto cuesta lo mismo en todos; el valor hora cambia si los puestos de un sitio cubren otras horas (por ejemplo 309,6 en vez de 334,58). Si el cliente **fija las horas al mes del sitio** en su formulario (3 puestos son 1.003,75, no 3 × 334,58), se escriben y el precio mensual sale con ellas, al peso. Da precio mensual y anual por sitio, el total y la **garantía de fiel cumplimiento** (un % del monto anual). Usa el puesto del primer perfil que tenga uno.
- **El error más caro:** llenar la planilla del cliente con el monto de **una** persona cuando divide por las horas del **puesto**. El valor hora queda en la mitad. La pantalla y «Copiar el cálculo» lo advierten y piden el total por puesto.

### Líquido, festivos y gastos

- **Líquido estimado** = imponible × (1 − descuentos del trabajador) + colación y movilización. Si las bases piden un líquido mínimo (por ejemplo $670.000 para un guardia), avisa cuando el sueldo base no lo alcanza.
- **Gratificación con tope por ingreso mínimo:** con el ingreso mínimo escrito, el tope sale solo (art. 50: 4,75 ingresos mínimos al año); un tope escrito a mano manda sobre él.
- **Aguinaldos y festivos trabajados** entran al costo mensual (festivos pagados como horas extra, con 50 % más).
- **Gastos por persona** con nombre (uniformes, curso, supervisor y prevencionista repartidos, radio, transporte), en vez de un solo «Otros».
- **Provisiones** de vacaciones e indemnización por años de servicio: dos cargas que empiezan **vacías**. Si ya cubres las vacaciones con el ausentismo, no las repitas.

### Comprobación con la planilla original

Las pruebas (`labor-cost.test.ts`) reproducen, celda por celda, la calculadora en planilla que se hizo para una licitación privada de guardias: un guardia 4x4 con sueldo base de $604.000 da un costo de $1.124.782, un precio de $1.245.260 por persona, **$2.490.520 por puesto y $7.443,72 por hora**, un líquido de $670.795, nueve sitios con sus precios mensuales (suma $74.716.259 al mes y $896.595.108 al año) y una garantía del 10 % de $89.659.511. Esa planilla es de la empresa y trae datos del cliente: no está en el repositorio, solo sus cifras como caso de prueba, sin nombres.

### Dónde difiere esa planilla de los valores de partida

La planilla usó las tasas de referencia del formulario del cliente (SIS 1,78 %, expectativa de vida 0,72 %, capitalización individual 0,1 %, rentabilidad protegida 0,9 %; con vacaciones 5,75 % e indemnización 8,33 % suman 20,91 % sobre el imponible). Los valores de partida de esta pantalla son otros (SIS 1,5 % y cotización adicional 3,5 % de la Ley 21.735, sin provisiones). No se unificaron: **cada licitación manda en sus tasas** y la contadora confirma cuáles. Todas se pueden cambiar.

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
- No llena la planilla del cliente: da los montos (por puesto, por sitio, valor hora) y «Copiar el cálculo» los deja listos para pasarlos; cada formulario tiene su forma de pedirlos.
- La tabla por sitio usa el puesto de un solo perfil.
- Un solo rival típico por vez, y solo la fórmula de «menor precio ÷ su precio».
