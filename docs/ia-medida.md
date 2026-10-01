# IA medida como usuario real (1 oct)

Recorrido de investigación y borradores medido con lecturas agregadas de producción (solo lectura, 60 a 90 días). Debajo, lo que se arregló y la consulta para medir el efecto una semana después del despliegue.

## Lo que se midió

| Pieza | Resultado | Causa encontrada |
|---|---|---|
| Borradores con IA | 58 intentos, 55 pasan la validación, **1 sola persona** los generó | El borrador se bloquea sin oferta en «Perfil» (`seller_profile_incomplete`). En GrupoExpro, 25 de 28 personas no la tienen; en PSOL, ninguna de 3 |
| Investigación (`native-research-v1`) | 41 «parciales», 26 completas, 14 fallidas, 2 sin datos | Ver las dos filas siguientes |
| «Parcial» desde el 7 sep | Le falta perfil de empresa, noticias y señales de empleo (23 a 24 informes cada uno) | Las búsquedas web exigen una reserva de crédito de Cowork que la investigación no traía (`RESEARCH_CREDIT_RESERVATION_REQUIRED`). El error se tragaba, así que la búsqueda fallaba siempre, salvo que hubiera caché |
| Fallidas (24-30 ago) | `Duplicate claims ID` / `Duplicate evidence ID` | El grafo público repetía afirmaciones que ya venían del sitio oficial |

## Lo que cambia

1. **La oferta de la organización cubre a quien no tiene una.**
   - Si tu perfil no tiene oferta, el borrador usa la del primer owner o admin de tu organización que sí la tenga.
   - Tu nombre y tu cargo siguen siendo los tuyos.
   - Completar «Perfil» reemplaza la oferta prestada.
   - Nunca se usa la oferta de otra organización.
   
   Está en `src/lib/server/seller-profile.ts` y aplica a investigación, borradores, seguimientos y la extensión.
   - GrupoExpro: su admin tiene oferta, así que las 25 personas sin oferta pueden redactar.
   - PSOL: sigue bloqueado hasta que su owner complete «Perfil». «Hoy» y el panel de administración lo muestran como pendiente.
2. **La investigación busca en la web con el crédito que ya pagó.**
   - La cuota diaria de investigación se consume antes de que el trabajo corra (`consumeLeadResearchRequestQuota`). Por eso sus búsquedas no reservan un segundo crédito (`src/lib/server/native-research-search-context.ts`).
   - Cada fuente que no responde deja en el log su motivo (`[native-research] optional source unavailable`), sin datos del contacto.
3. **El grafo público ya no duplica ids.** Se conserva una afirmación, evidencia y fuente por id.

## Pruebas

- `src/lib/server/seller-profile-fallback.test.ts`: oferta prestada sin cambiar quién firma; la oferta propia gana; nunca se toma de otra organización.
- `src/lib/server/suplia-research-tools.test.ts`: con el contexto de investigación, la búsqueda llega al proveedor; sin él, se rechaza antes, como pasaba en producción.

## Medir el efecto (una semana después del despliegue)

```sql
-- Personas que generan borradores y estado de las investigaciones, por semana (solo lectura).
select date_trunc('week', a.created_at)::date semana, o.name, count(distinct a.user_id) personas, count(*) intentos,
       count(*) filter (where a.passed) aprobados
from messaging_draft_generation_attempts a join organizations o on o.id = a.organization_id
where a.created_at > now() - interval '30 days' group by 1, 2 order by 1, 2;

select date_trunc('week', created_at)::date semana, status, count(*),
       count(*) filter (where result_payload->'warnings' ? 'company_news_unavailable') sin_noticias
from lead_research_jobs where provider = 'native-research-v1' and created_at > now() - interval '30 days'
group by 1, 2 order by 1, 2;
```

**Esperado:**
- más de 1 persona por semana generando borradores en GrupoExpro;
- `sin_noticias` cerca de 0;
- menos informes «parciales». Siguen existiendo cuando la persona no tiene huella pública, y eso es correcto.

## Pendiente

- **Banco de recorrido automatizado**, de la búsqueda al borrador con los jueces existentes. Necesita llaves de modelo en `.env.test.local`, que este entorno no tiene. Queda como siguiente paso.
- **PSOL:** su owner debe completar «Perfil» con la oferta de evaluaciones psicolaborales. El borrador de catálogo está en los puntos de partida de búsqueda (`src/lib/search/search-guidance.ts`).
