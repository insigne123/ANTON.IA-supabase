// Almacenamiento en Supabase (via profileService) de la firma por canal.
import { profileService } from '@/lib/services/profile-service';
export type EmailChannel = 'gmail' | 'outlook';

export type SignatureConfig = {
  channel: EmailChannel;
  enabled: boolean;
  html: string; // HTML ya saneado en el momento de guardar
  text?: string; // opcional (versión plano); si falta se deriva al enviar
  separatorPlaintext?: boolean; // "-- " antes de la firma en texto plano
  updatedAt: string; // ISO
};

// Removed local storage helpers


export const emailSignatureStorage = {
  async get(channel: EmailChannel): Promise<SignatureConfig | null> {
    const sigs = await profileService.getSignatures();
    return (sigs[channel] as SignatureConfig) ?? null;
  },

  async save(cfg: SignatureConfig) {
    const sigs = await profileService.getSignatures();
    sigs[cfg.channel] = { ...cfg, updatedAt: new Date().toISOString() };
    await profileService.setSignatures(sigs);
  },

  async enable(channel: EmailChannel, enabled: boolean) {
    const curr = (await this.get(channel)) ?? {
      channel,
      enabled,
      html: '',
      text: '',
      separatorPlaintext: true,
      updatedAt: new Date().toISOString(),
    };
    curr.enabled = enabled;
    await this.save(curr);
  },

  async isEnabled(channel: EmailChannel): Promise<boolean> {
    return !!(await this.get(channel))?.enabled;
  },
};
