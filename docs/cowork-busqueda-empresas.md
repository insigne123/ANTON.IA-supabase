# Cowork: búsqueda «empresas primero» (1 oct)

**Problema (prueba del 1 oct, `Pruebas_de_app.docx`):** Cowork propuso buscar 25 personas y trajo 2.
- Hacía una sola búsqueda de personas, con un máximo de 25.
- Usaba cargos exactos (`include_similar_titles: false`).
- El rubro, los cargos y el lugar acotaban la misma consulta.

## Qué cambia

1. **Estrategia «empresas primero»** (`strategy: companies_first`). Es la estrategia por defecto cuando hay rubros y cargos.
   1. Busca hasta 100 empresas de los rubros que compran la oferta. Filtra por tamaño, y por los lugares de empresa pedidos o, si no hay, por el país de la persona: «Antofagasta, Chile» busca empresas de Chile.
   2. Busca a las personas con esos cargos, o parecidos, dentro de esas empresas: 50 empresas por llamada al proveedor.
   3. Ordena por quién puede decidir la compra, según la `rolePolicy` que la IA escribe al proponer y que la tarjeta muestra. Se ven unos pocos por empresa antes de repetir empresa, y los resultados se agrupan por empresa.
     - Nadie se descarta.
     - Cada persona trae su motivo, por ejemplo «Posible comprador: cargo con «gerente de personas» · outsourcing, 120 empleados».
   - La búsqueda de una sola consulta (`strategy: people`) sigue disponible para cargos sin rubro, empresas concretas o filiales locales de multinacionales.
2. **Cantidad:** trae lo pedido.
   - 25 por defecto.
   - Hasta 100 si se pide «todos los que puedas».
3. **«Traer más»:** el resultado trae `next`, y el botón «Traer más» del panel lo pide.
   - Con los mismos criterios, primero siguen las personas de las mismas empresas (`offset`) y después las empresas de la página siguiente (`page`).
   - Cada vuelta se aprueba y usa una búsqueda del cupo.
4. **Tarjeta:** dice cómo busca, cuántas personas trae y que usa 1 búsqueda del cupo diario.
5. **Historial:** si un turno anterior trae una lista demasiado larga para el contexto, el siguiente turno recibe sus primeras filas y cuántas quedaron fuera (`itemsOmitted`), en vez de fallar.

## Costo

| Qué | Cupo diario de la app | Proveedor (según su tarifa) |
|---|---|---|
| Búsqueda «empresas primero» | 1 búsqueda | 1 búsqueda de empresas (≈1 crédito) + 1 o 2 de personas (0 créditos) |
| Búsqueda de personas | 1 búsqueda | 1 búsqueda de personas (0 créditos) |
| «Traer más» | 1 búsqueda por vuelta | Igual que la búsqueda original |

El costo real del proveedor se mide con el script de abajo antes de cambiar cómo cuenta el cupo.

## Medición real (la corre el mantenedor)

```bash
APOLLO_API_KEY=... node scripts/measure-cowork-search.mjs --live --usage
```

- **Ofertas:** antecedentes (la prueba del 1 oct), outsourcing de GrupoExpro y evaluaciones psicolaborales de PSOL.
- **Compara** la búsqueda de antes (una consulta, cargos exactos) con «empresas primero».
- **Muestra:** personas, posibles compradores, empresas con personas, llamadas, segundos y los créditos antes y después.
- **No hace:** no lee archivos `.env`, no guarda contactos, no revela correos y no escribe nada.
- **Meta:** 20 o más personas por oferta con `limit` 25.

## Piezas

- **Reglas puras:**
  - `src/lib/cowork/search-proposal.ts`: criterios, estrategia y pedidos al proveedor.
  - `src/lib/cowork/search-ranking.ts`: orden, motivo y agrupación.
- **Servidor:**
  - `src/lib/server/cowork/external-search.ts`: ejecuta la estrategia y arma el resultado.
  - Proveedor (`apollo.ts` y `validation.ts`): la búsqueda de personas acepta las empresas elegidas y su página.
  - `conversation-context.ts`: acorta listas largas del turno anterior.
- **Pantallas:**
  - `CoworkApproval.tsx`: tarjeta.
  - `ContactResults.tsx`: empresas, motivo y «Traer más».
  - `presentation.ts`: qué pasa al aprobar.
- **Instrucciones:** `agent-instructions.ts`.
- **Continuación:** el mensaje de `admitSearchContinuation`.

## Pruebas

- `src/lib/cowork/search-proposal.test.ts`: estrategia, pedidos, país de las empresas, páginas y topes.
- `src/lib/cowork/search-ranking.test.ts`: compradores primero, tres por empresa, agrupación, `offset` y motivo.
- `scripts/test-cowork-external-search.mjs`:
  - 60 empresas y sus personas en dos llamadas, con 1 búsqueda de cupo;
  - «Traer más»;
  - un grupo que no responde;
  - sin empresas.
- `scripts/test-cowork-search-results-ui.mjs`: tarjeta y resultados (DOM).
- **Proveedor:** `apollo.test.ts` y `validation.test.ts`.
- **Otras:**
  - `lead-export.test.ts`: 100 personas con motivo;
  - `conversation-context.test.ts`: lista larga del turno anterior.
