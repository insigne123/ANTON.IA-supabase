# Fase 4 — medición disponible

Fecha: 21 de septiembre de 2026. Comando: `node scripts/benchmark-cowork-specialists.mjs`.

## Diseño

20 muestras por modalidad, alternando orden secuencial/paralelo. Dos especialistas reciben el mismo fixture; cada llamada simulada espera 40 ms. Se comprueba igualdad de resultados en cada muestra. 80 llamadas a fixtures, cero llamadas a modelos o producción.

| Modalidad | p50 | p95 |
|---|---:|---:|
| Secuencial | 93,21 ms | 96,27 ms |
| Paralelo | 46,80 ms | 49,46 ms |

Reducción de mediana observada: 49,79%. Es una medición del pool síncrono local, no de la cola del scheduler. La cola procesa una asignación por invocación; su latencia incluye espera entre ticks. No atribuir esta mejora al flujo desplegado.

## Presupuesto implementado

La migración `cowork_model_budget` limita por trabajo a siete reservas en total, cinco del coordinador y una por rol especialista. Reserva hasta 6.000 tokens de salida por llamada del coordinador y 1.800 por especialista, con techo conjunto de 33.600. Los reinicios no borran las reservas; una llamada fallida conserva su reserva.

Esto es un límite de llamadas y salida solicitada; no es un techo monetario, de tokens de entrada ni de consumo agregado entre todos los trabajos de un hilo. El proveedor puede devolver consumo desconocido: se registra `null`.

## Aceptación todavía pendiente

- Comparación de calidad factual con modelos reales, mismo corpus y presupuesto.
- Latencia completa incluyendo cola, scheduler, DB y proveedor, con tamaño de muestra declarado.
- Consumo agregado por conversación y política de costo.
- Evaluación de los adaptadores de dominio pendientes y recorridos autenticados.

El benchmark sintético no cierra F4-10.
