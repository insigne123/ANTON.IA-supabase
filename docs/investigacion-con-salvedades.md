# Investigación: el informe llega con salvedades y más rápido (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):**
- La investigación manual falló a los 303 s. El revisor editorial rechazó dos veces un párrafo que citaba un dato discutido (`REPORT_V2_EVIDENCE_REVIEW_REQUIRED`), y se perdió todo el informe.
- Las investigaciones de Cowork tardaron entre 22 y 162 s.

## Qué cambia

1. **Informe con salvedades en vez de fallar** (`src/ai/flows/synthesize-report-v2.ts`). Si, tras la única reparación, la revisión sigue rechazando un párrafo que cita evidencia:
   - **Qué sale del informe:**
     - la afirmación discutida y toda afirmación derivada de ella;
     - los párrafos que se apoyan en ellas, aunque no fueran el párrafo rechazado;
     - sus señales;
     - sus referencias en el análisis: comité, ajuste por producto, preguntas, objeciones y riesgos. Un modelo de volumen basado en ella también sale.
   - **Qué queda:** el resto del informe se entrega como `partial`, con la advertencia «Informe con salvedades: se retiraron N afirmaciones que la revisión no pudo confirmar…» y los pendientes que deja la cobertura.
   - **Lo que no cambia:** un dato discutido nunca llega al grafo publicado ni a los borradores, como antes. Antes eso costaba el informe completo.
2. **Más rápido** (`src/lib/server/research-report-v2-research.ts`):
   - **Extracción de afirmaciones:** sigue en grupos de 3 fuentes, ahora hasta 3 grupos a la vez y no uno tras otro. Con 18 páginas son 2 rondas en vez de 6 llamadas seguidas al modelo, que eran la parte más larga.
   - **Búsquedas web:** hasta 5 a la vez.
   - **Lectura de páginas:** sigue con 3 a la vez, por cuidado con los sitios.
   - Los resultados conservan el orden de las fuentes.

## Pruebas

- `src/ai/flows/synthesize-report-v2.test.ts`: con un dato discutido dos veces, el informe se entrega:
  - el dato y su derivado salen del grafo, de los párrafos, de las señales y del análisis;
  - el resto queda;
  - la advertencia aparece;
  - la cobertura y los pendientes siguen consistentes.
- `src/lib/server/research-report-v2-research.test.ts`:
  - extracciones simultáneas (más de 1 y hasta 3), con 3 fuentes cada una y cada fuente leída una vez;
  - búsquedas simultáneas, hasta 5.

## Pendiente

- **Pasos visibles en la investigación manual** (buscando, leyendo, escribiendo): la tarea de investigación todavía no informa su fase. Se deja para un cambio aparte.
- **Medición real:** cobertura y tiempos antes y después, con 3 empresas. Necesita las claves de los proveedores, así que la corre el mantenedor.
