-- AXIS Outbound - tablas de tracking de prospeccion y campanas
-- Prefijo axis_* para no colisionar con otras tablas del proyecto.

-- =====================================================================
-- 1. axis_rondas - metadata de cada campana / ronda
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.axis_rondas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre          text NOT NULL UNIQUE,
  descripcion     text,
  filtros_apollo  jsonb,
  creditos_consumidos integer DEFAULT 0,
  total_leads     integer DEFAULT 0,
  fecha_inicio    date,
  fecha_fin       date,
  notas           text,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- =====================================================================
-- 2. axis_empresas - catalogo de cuentas
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.axis_empresas (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_org_id    text UNIQUE,
  nombre           text NOT NULL,
  dominio          text,
  sector           text,
  perfil_comercial text CHECK (perfil_comercial IN ('alta_rotacion','monitoreo_continuo','outsourcing_intermediario') OR perfil_comercial IS NULL),
  empleados        integer,
  ciudad           text,
  pais             text DEFAULT 'Chile',
  excluida         boolean DEFAULT false,
  razon_exclusion  text,
  notas             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_axis_empresas_nombre ON public.axis_empresas (lower(nombre));
CREATE INDEX IF NOT EXISTS idx_axis_empresas_dominio ON public.axis_empresas (lower(dominio));
CREATE INDEX IF NOT EXISTS idx_axis_empresas_sector ON public.axis_empresas (sector);
CREATE INDEX IF NOT EXISTS idx_axis_empresas_excluida ON public.axis_empresas (excluida) WHERE excluida = true;

-- =====================================================================
-- 3. axis_leads - personas
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.axis_leads (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  apollo_person_id  text UNIQUE,
  empresa_id        uuid REFERENCES public.axis_empresas(id) ON DELETE SET NULL,
  nombre            text,
  apellido          text,
  nombre_completo   text,
  cargo             text,
  tipo_cargo        text,
  seniority         text,
  email             text,
  email_status      text,
  linkedin_url      text,
  telefono          text,
  ronda             text,
  segmento_axis     text,
  angulo_outreach   text,
  razon_encaje      text,
  prioridad         text CHECK (prioridad IN ('alta','media','baja') OR prioridad IS NULL),
  score             numeric,
  estado            text DEFAULT 'nuevo' CHECK (estado IN ('nuevo','calificado','borrador','enviado','respondio','cerrado','no_contactar','rebotado')),
  fuente            text,
  notas             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_axis_leads_email_unique ON public.axis_leads (lower(email)) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_axis_leads_empresa ON public.axis_leads (empresa_id);
CREATE INDEX IF NOT EXISTS idx_axis_leads_ronda ON public.axis_leads (ronda);
CREATE INDEX IF NOT EXISTS idx_axis_leads_estado ON public.axis_leads (estado);
CREATE INDEX IF NOT EXISTS idx_axis_leads_tipo_cargo ON public.axis_leads (tipo_cargo);

-- =====================================================================
-- 4. axis_toques - cada correo enviado/programado por lead
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.axis_toques (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id           uuid NOT NULL REFERENCES public.axis_leads(id) ON DELETE CASCADE,
  ronda_id          uuid REFERENCES public.axis_rondas(id) ON DELETE SET NULL,
  tipo              text NOT NULL CHECK (tipo IN ('toque_1','fu_1','fu_2','manual')),
  canal             text DEFAULT 'email' CHECK (canal IN ('email','linkedin','wsp','telefono')),
  email_from        text,
  email_to          text,
  asunto            text,
  cuerpo            text,
  cuerpo_html       text,
  framework         text,
  angulo_usado      text,
  gmail_draft_id    text,
  gmail_thread_id   text,
  gmail_message_id  text,
  estado            text DEFAULT 'borrador' CHECK (estado IN ('borrador','enviado','rebotado','respondido','cancelado')),
  fecha_programada  date,
  fecha_enviada     timestamptz,
  fecha_respuesta   timestamptz,
  tracking_label    text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_axis_toques_lead ON public.axis_toques (lead_id);
CREATE INDEX IF NOT EXISTS idx_axis_toques_ronda ON public.axis_toques (ronda_id);
CREATE INDEX IF NOT EXISTS idx_axis_toques_thread ON public.axis_toques (gmail_thread_id);
CREATE INDEX IF NOT EXISTS idx_axis_toques_estado ON public.axis_toques (estado);
CREATE INDEX IF NOT EXISTS idx_axis_toques_fecha_programada ON public.axis_toques (fecha_programada);

-- =====================================================================
-- 5. axis_respuestas - interacciones de vuelta
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.axis_respuestas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  toque_id        uuid REFERENCES public.axis_toques(id) ON DELETE SET NULL,
  lead_id         uuid NOT NULL REFERENCES public.axis_leads(id) ON DELETE CASCADE,
  tipo            text CHECK (tipo IN ('interesado','no_interesado','objecion','otro_momento','fuera_oficina','rebote','consulta','otro') OR tipo IS NULL),
  resumen         text,
  cuerpo          text,
  fecha           timestamptz DEFAULT now(),
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_axis_respuestas_lead ON public.axis_respuestas (lead_id);
CREATE INDEX IF NOT EXISTS idx_axis_respuestas_toque ON public.axis_respuestas (toque_id);

-- =====================================================================
-- Trigger generico de updated_at
-- =====================================================================
CREATE OR REPLACE FUNCTION public.axis_set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['axis_rondas','axis_empresas','axis_leads','axis_toques']) LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_updated_at ON public.%I; CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.axis_set_updated_at();',
      t, t, t, t
    );
  END LOOP;
END$$;

-- =====================================================================
-- RLS - activado en las 5 tablas, politicas permisivas para authenticated
-- y service_role. El usuario es el unico operador por ahora.
-- =====================================================================
ALTER TABLE public.axis_rondas      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.axis_empresas    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.axis_leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.axis_toques      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.axis_respuestas  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['axis_rondas','axis_empresas','axis_leads','axis_toques','axis_respuestas']) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I_authenticated_all ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY %I_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);', t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_service_role_all ON public.%I;', t, t);
    EXECUTE format('CREATE POLICY %I_service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END$$;
