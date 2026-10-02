# La investigación muestra sus pasos y su tiempo (Plan 6, PR-C3)

## Problema (prueba del 1 oct, `Pruebas_de_app.docx`, pág. 10)

Punto 24: la investigación manual era lenta y fallaba.

#94 (integrado, pendiente de despliegue) resolvió la falla: el informe se entrega con salvedades en vez de perderse, y la búsqueda es más paralela. Faltaban dos cosas mientras se espera:
- **qué está haciendo:** la pantalla decía solo «Preparando el informe completo», con una barra estimada;
- **cuánto falta:** prometía «unos 2 minutos» y avisaba «más de lo estimado» a los 2 minutos, aunque la mitad de las investigaciones tarda más que eso.

## Tiempos medidos en producción (2 oct, últimos 30 días, solo lectura)

| Etapa | La mitad tarda menos de | 9 de cada 10 tardan menos de |
|---|---|---|
| Buscar y leer fuentes (trabajo de investigación, 36 trabajos) | 7 s | 14 s |
| Escribir y revisar el informe (21 informes escritos) | 2 min 31 s | 6 min 18 s |
| Todo | 2 min 37 s | 8 min 25 s |

En esos 30 días:
- **De 36 investigaciones,** 34 terminaron (3 completas y 31 con salvedades) y 2 quedaron sin datos suficientes.
- **De 24 informes,** se escribieron 21 y fallaron 3. Una de esas fallas fue el 1 oct; #94, ya integrado y pendiente de despliegue, entrega con salvedades en ese caso.

## Qué cambia

- **Pasos** (`ResearchReportProgress`), en la pantalla de investigación y en el informe:
  1. Buscar y leer fuentes;
  2. Escribir y revisar el informe;
  3. Listo para escribirle.

  Cada paso dice si está hecho, en curso o pendiente, también para lectores de pantalla. El paso en curso se anuncia («Paso 2 de 3: Escribir y revisar el informe»).
- **Solo los pasos que la app sabe distinguir:** el trabajo de investigación y luego el informe escrito (`researchReportPhase`). Dentro de la escritura no hay más detalle mientras corre, así que no se inventa.
- **Cuánto lleva:** «Lleva 2 min 30 s», con los tiempos medidos: «La mitad de las investigaciones tarda menos de 3 minutos y 9 de cada 10, menos de 9». El reloj no está en la región que se anuncia, para no repetirlo cada segundo.
- **El aviso de demora** sale solo cuando supera lo habitual de verdad, desde los 8 min 30 s: «Está tardando más que 9 de cada 10 investigaciones». Antes salía a los 2 minutos.
- **La barra** sigue siendo una estimación y lo dice. Ahora se calibra con la mediana medida, 160 s en vez de 120 s.

## Pruebas

- **`src/lib/research-report-loading.test.ts`:**
  - la estimación con los tiempos medidos;
  - el paso según el trabajo y el informe;
  - el tiempo en segundos y minutos.
- **`src/components/research/research-report-loading-ui.test.ts`:**
  - los pasos y su estado, también en texto;
  - el paso anunciado sin el reloj;
  - el aviso de demora solo después de lo habitual.
