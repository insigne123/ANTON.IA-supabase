# Perfil comercial y «Complétalo con IA» (1 oct)

«Perfil» es lo que la IA sabe de la persona y su empresa: con eso busca prospectos, investiga y redacta. Esta revisión agrega lo que faltaba para que la IA escriba y busque mejor, y rehace el rellenado con IA, que antes podía proponer un perfil equivocado.

## Lo que había (medido)

- **Campos:** nombre, cargo, empresa, sitio, sector, descripción, servicios, propuesta de valor y pruebas.
- **Faltaba a quién le vende la persona**, y con eso «Buscar prospectos» no tenía de dónde partir.
- **Uso en producción (solo lectura):**
  - GrupoExpro: 28 personas; 26 con nombre, 3 con empresa y oferta, ninguna con pruebas.
  - PSOL: 3 personas con todo vacío.
  - Sin oferta, el borrador se bloquea (`seller_profile_incomplete`).
- **Los servicios se partían en cada coma:** «personal temporal para retail, logística y agroindustria» llegaba a los borradores como tres «servicios» sueltos.
- **El rellenado leía solo la portada del sitio:**
  - GrupoExpro, el cliente principal, tiene una portada que solo pide elegir país, así que la IA proponía «acceso a información según la región».
  - La lectura no comprobaba la dirección resuelta, de modo que un dominio público que apuntara a una IP interna se habría leído igual. Ahora usa el lector seguro de la investigación (`fetchCompanyProfileSite`).

## Campos nuevos

Se guardan en `profiles.signatures.profile_extended`, sin migración. Si un perfil no los usa, se escribe exactamente igual que antes.

| Sección | Campo | Lo usa |
|---|---|---|
| Tu oferta | Problemas que resuelves (uno por línea) | Borradores (problemas resueltos), orden de la evidencia y mensajes de LinkedIn |
| Tu oferta | Por qué elegirte (uno por línea) | Borradores (diferenciador, que el validador acepta como afirmación del vendedor), LinkedIn y Cowork |
| Tu oferta | Clientes que puedes nombrar (separados por coma) | Borradores, como respaldo que el validador acepta |
| Tu cliente ideal | Cargos, industrias, tamaño de empresa y países | «Tu cliente ideal», el primer punto de partida en «Buscar prospectos»; Cowork; orden de la evidencia |

- **Medidor «Tu perfil: N de 10»:** marca primero lo que destraba la redacción (servicios o propuesta de valor) y explica en una línea qué gana la persona con cada campo.
- **Tono, firma y llamada a la acción:** siguen en «Firmas y estilo», con un enlace desde «Perfil».

## «Complétalo con IA»

1. **Sitio:** se usa el escrito o, si no hay, el dominio del correo corporativo (ana@grupoexpro.com → grupoexpro.com). Los correos personales (Gmail, Outlook, etc.) nunca se usan.
2. **Lectura** (`fetchCompanyProfileSite` en `native-research.ts` y `src/lib/profile/site-pages.ts`). Es el mismo lector seguro de la investigación: DNS público, redirecciones dentro de la empresa y 14 s como máximo. Además:
   - si la portada solo pide el país, entra a la página de ese país;
   - si el dominio se mudó (psol.cl → psol-latam.com), sigue esa primera redirección;
   - lee hasta 8 páginas: una de la empresa, una de pruebas (clientes, casos o certificaciones) y las de oferta, con máximo 4 de la misma sección. Nunca lee blog, empleos, contacto ni páginas legales;
   - el texto se lee como lo ve un visitante, sin menús, código ni enlaces. Solo se descartan las páginas de verificación o bloqueo.
3. **Búsqueda (Serper):** solo si el sitio da menos de 3 páginas, o si no hay sitio.
4. **Propuesta:** el modelo propone los 13 campos y dice qué página respalda cada uno. Después se descarta lo que no está respaldado:
   - una prueba con una cifra que no aparece en lo leído;
   - un cliente que no se nombra en lo leído;
   - un sitio web que no salió de una página oficial leída.
5. **Revisión:** los campos llegan agrupados (Empresa, Oferta, Cliente ideal), cada uno con su fuente.
   - Los cargos, industrias y tamaño sin fuente se marcan «Sugerencia de la IA según tu oferta».
   - Solo vienen marcados los campos vacíos.
   - Nada se guarda hasta «Guardar cambios».

## Medición con sitios reales

Comando: `scripts/evaluate-profile-autofill.ts --live`. Usa el modelo de producción; no lee la base de datos ni envía nada.

| Empresa | Antes: campos de contenido | Antes (s) | Ahora: campos | Páginas leídas | Campos con fuente | Ahora (s) |
|---|---|---|---|---|---|---|
| grupoexpro.com | 3 de 4, **equivocados** | 6,5 | 11 de 13, correctos | 6 | 9 | 21,1 |
| psol.cl | 4 de 4 | 3,4 | 9 de 13 | 1 | 7 | 9,7 |
| yago.cl | 4 de 4 | 2,4 | 11 de 13 | 8 | 9 | 10,7 |
| buk.cl | 4 de 4 | 3,6 | 10 de 13 | 8 | 8 | 9,2 |
| defontana.com | 4 de 4 | 3,2 | 8 de 13 | 1 | 6 | 6,8 |
| bsale.cl | 4 de 4 | 3,8 | 12 de 13 | 5 | 11 | 10,7 |
| fintoc.com | 4 de 4 | 3,3 | 11 de 13 | 5 | 10 | 9,3 |
| rankmi.com | 4 de 4 | 10,1 | 12 de 13 | 8 | 10 | 12,4 |
| grupoexpro.com, solo el sitio (como al detectarlo por el correo) | — | — | 11 de 13 | 6 | 9 | 18,3 |

- **«Antes»** contaba sector, descripción, servicios y propuesta de valor.
- **«Ahora»** suma problemas, diferenciadores, pruebas, clientes y cliente ideal.
- **Cifras y clientes:** las pruebas y los clientes que aparecen son textuales del sitio, por ejemplo «12.132 empresas usando Bsale» o «+1200 empresas confían en Fintoc». Cuando el sitio no los da, quedan vacíos.
- **Más tiempo:** la propuesta tarda más porque lee más páginas. La tarjeta muestra en qué paso va y avisa que puede tardar hasta 30 segundos.

## Límites

- **Sitios armados con JavaScript** (Defontana): se lee una sola página. En producción lo completa la búsqueda (Serper), que este entorno no tiene.
- **Tamaño de empresa:** la IA casi nunca lo propone, porque los sitios rara vez lo dicen.
- **Sin sitio y sin búsqueda:** el resultado queda vacío y explica qué hacer.
- **Cowork:** lee los campos nuevos, pero su propuesta de perfil todavía no los escribe.

## Código y pruebas

- **Módulos:**
  - `src/lib/profile/profile-mappings.ts` (campos, medidor y sitio desde el correo);
  - `src/lib/profile/profile-lists.ts` (listas);
  - `src/lib/profile/site-pages.ts` (qué páginas leer y cómo);
  - `src/ai/flows/generate-company-profile.ts` y `src/lib/profile/autofill-suggestion.ts`.
- **Pantalla:** `src/app/(app)/profile/page.tsx` y `src/components/profile/*`.
- **Uso de los campos:**
  - `seller-profile.ts`, `draft-context-v2.ts`, `draft-preflight-v2.ts`;
  - `draft-message-brief.ts`, `generate-outreach-from-report.ts`, `outreach-evidence-ranking.ts`;
  - `linkedin-message-writer.ts`, `suplia-context.ts`, `cowork/user-context.ts`, `cowork/profile-read.ts`;
  - `search-guidance.ts`.
- **Pruebas:**
  - `generate-company-profile.test.ts`, `site-pages.test.ts`, `profile-lists.test.ts`;
  - `profile-mappings.test.ts`, `autofill-suggestion.test.ts`, `search-guidance.test.ts`, `seller-profile-fallback.test.ts`;
  - `scripts/test-profile-page.mjs` (jsdom, incluida en `test:unit`).
