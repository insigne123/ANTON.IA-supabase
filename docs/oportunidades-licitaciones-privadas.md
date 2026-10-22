# Oportunidades · licitaciones privadas

Desde la demo del 21 de octubre de 2026 (GrupoExpro) las licitaciones privadas que llegan de plataformas externas (Coupa, SAP Ariba, WEX) se cargan con «Cargar oportunidad» y reciben el mismo análisis que las públicas. Esta página dice en qué se diferencian y qué cambia en el informe y en «Cómo postular».

## En qué se diferencia una licitación privada

Se vio en un proceso real de solicitud de propuestas, por invitación directa a través de una plataforma de compras:

- **No hay código ni portal público.** La invitación lleva a una plataforma que fija el cliente; la plataforma puede no estar nombrada en los documentos (solo en el correo de la invitación).
- **El cronograma es del proceso:** invitación, confirmación de participación, consultas, respuestas, entrega de ofertas, negociación, adjudicación e inicio del servicio. El cierre es la entrega de ofertas.
- **Los formularios son fijos** (por ejemplo A.1 y A.2 de antecedentes, B.1 y B.2 de la propuesta técnica) y la cotización va en un Excel sin protección en el formato del cliente. Cambiar el formato o dejar una partida vacía puede descalificar.
- **Se firma con el representante legal** y, además de subir los documentos, la plataforma pide ingresar un resumen de la propuesta económica.
- **El contrato marco no se negocia.** Lo que se negocia es el precio, en rondas posteriores a la entrega.
- **Garantías y seguros** del contrato (por ejemplo una boleta de fiel cumplimiento como porcentaje del monto anual, en UF, con vigencia de plazo más 180 días, y un seguro de responsabilidad civil con el cliente como asegurado adicional), reajuste por IPC y vigencia mínima de la propuesta.
- **El precio puede ser por hora** (estructura de sueldos y turnos), no un monto total.

## Cómo se carga

Ver `docs/oportunidades-resumenes-y-carga.md`: se suben varios archivos o el ZIP completo, y la descripción trae la plataforma, el administrador y el cronograma. Conviene **pegar también el correo de la invitación** en «Invitación o contexto recibido»: suele nombrar la plataforma y lo que hay que ingresar en ella.

## Qué cambia para una oportunidad cargada (`kind = private`)

- **Informe** (`report-generation.ts`): no aplica Mercado Público, la Ley 19.886 ni el Registro de Proveedores salvo que los documentos los pidan (`PRIVATE_PROCESS_RULE`). Sus secciones (`PRIVATE_OUTLINE`) ponen el cronograma y cómo se presenta antes de los requisitos, y cierran con la propuesta económica.
- **Equipo que lo revisa** (`workspace-specialists.ts`, `PRIVATE_TEAM`): requisitos y documentos (con el código de cada formulario y lo que descalifica), evaluación, contrato y condiciones no negociables, y propuesta económica y estrategia. La ruta de postulación incluye, si existen, la confirmación de participación, las consultas, la entrega por la plataforma y la negociación posterior.
- **«Cómo postular»** (`submission-kit.ts`, `submissionRoute`): en vez de la ruta de Mercado Público muestra la de la plataforma de la invitación (confirmar participación, consultas, formularios, cotización en el formato pedido, subir a la plataforma, comprobante) y lo que sigue (negociación, firma del contrato marco, garantía y seguro). La guía que lee la IA nombra la plataforma y lo que se ingresa en ella cuando los documentos lo dicen.

Una compra pública (`tender`, `compra_agil`) sigue exactamente igual.

## Qué no hace (todavía)

- **No arma la cotización.** El informe dice qué piden (por ejemplo un precio por hora hombre y una estructura de sueldos por zona y turno); la calculadora la sigue armando el equipo.
- **No usa la matriz de decisión de la empresa.** Se acordó que Victor Espinoza comparta el Excel con los criterios críticos para descartar licitaciones, para adaptarlo.
- **No sabe nada de Colombia ni de Perú.** Los documentos y requisitos legales son distintos y queda por decidir cómo se hará.
- Lo escrito aquí viene de un solo proceso real; las bases de otro cliente pueden pedir otra cosa y el informe se lee de los documentos de cada una.
