// Almacenamiento local (localStorage) de la firma por canal.
// TODO: permitir persistencia en Supabase si el proyecto lo requiere.
export type EmailChannel = 'gmail' | 'outlook';

export type SignatureConfig = {
  channel: EmailChannel;
  enabled: boolean;
  html: string; // HTML ya saneado en el momento de guardar
  text?: string; // opcional (versión plano); si falta se deriva al enviar
  separatorPlaintext?: boolean; // "-- " antes de la firma en texto plano
  updatedAt: string; // ISO
};

const KEY = 'email.signature.v1';

type SignatureState = {
  byChannel: Partial<Record<EmailChannel, SignatureConfig>>;
};

function readState(): SignatureState {
  if (typeof window === 'undefined') return { byChannel: {} };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { byChannel: {} };
    const parsed = JSON.parse(raw) as SignatureState;
    return parsed?.byChannel ? parsed : { byChannel: {} };
  } catch {
    return { byChannel: {} };
  }
}

function writeState(s: SignatureState) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export const emailSignatureStorage = {
  get(channel: EmailChannel): SignatureConfig | null {
    const s = readState();
    return s.byChannel?.[channel] ?? null;
  },
  save(cfg: SignatureConfig) {
    const s = readState();
    s.byChannel = s.byChannel || {};
    s.byChannel[cfg.channel] = { ...cfg, updatedAt: new Date().toISOString() };
    writeState(s);
  },
  enable(channel: EmailChannel, enabled: boolean) {
    const curr = emailSignatureStorage.get(channel) ?? {
      channel,
      enabled,
      html: '',
      text: '',
      separatorPlaintext: true,
      updatedAt: new Date().toISOString(),
    };
    curr.enabled = enabled;
    emailSignatureStorage.save(curr);
  },
  isEnabled(channel: EmailChannel): boolean {
    return !!emailSignatureStorage.get(channel)?.enabled;
  },
};
