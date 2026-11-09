'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { ToastAction } from '@/components/ui/toast';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { AUTO_IMPORT_RETRY_MS, autoImportSignature } from '@/lib/email-studio/signature-auto-import';
import { prepareSignature } from '@/lib/email-studio/signature-upload';
import { emailSignatureStorage } from '@/lib/email-signature-storage';
import { profileService } from '@/lib/services/profile-service';
import { buildSenderInfo } from '@/lib/signature-placeholders';

const nextCheckKey = (userId: string) => `anton.signature-auto.v1:${userId}`;
/** After the screen settles, so it never competes with what the person opened. */
const START_AFTER_MS = 4_000;

function readNextCheck(userId: string) {
  try {
    return Number(window.localStorage.getItem(nextCheckKey(userId)) || 0);
  } catch {
    return 0;
  }
}

function writeNextCheck(userId: string, at: number) {
  try {
    window.localStorage.setItem(nextCheckKey(userId), String(at));
  } catch {
    // Without storage it is asked again on the next visit, which only costs one read.
  }
}

/**
 * Brings the signature the person uses in Outlook or Gmail and turns it on, once, for someone who has none (9 Nov 2026).
 * «Firmas y estilo» does its own bringing with a preview, so it is left alone there.
 */
export function SignatureAutoImport() {
  const { user } = useAuth();
  const userId = user?.id;
  const pathname = usePathname();
  const router = useRouter();
  const { toast } = useToast();
  const onSignatureScreen = Boolean(pathname?.startsWith('/settings/email-studio'));

  useEffect(() => {
    if (!userId || onSignatureScreen || readNextCheck(userId) > Date.now()) return;
    let active = true;
    const timer = window.setTimeout(() => {
      // Claimed before it starts: a second tab, or a later screen, does not ask the mailbox again meanwhile.
      writeNextCheck(userId, Date.now() + AUTO_IMPORT_RETRY_MS.unavailable);
      void autoImportSignature({
        readSignatures: async () => ((await profileService.getCurrentProfile())?.signatures as Record<string, unknown> | undefined) || {},
        readMailbox: async () => {
          const response = await fetch('/api/email-studio/mailbox-signature', { cache: 'no-store' });
          return response.ok ? response.json() : null;
        },
        prepare: async html => {
          const prepared = await prepareSignature(html, window);
          return prepared.ok ? prepared.html : null;
        },
        sender: async () => buildSenderInfo(await profileService.getCurrentProfile()),
        save: configs => emailSignatureStorage.saveAll(configs),
      }).then(outcome => {
        writeNextCheck(userId, Date.now() + AUTO_IMPORT_RETRY_MS[outcome.kind]);
        if (!active || outcome.kind !== 'imported') return;
        const account = outcome.provider === 'gmail' ? 'Gmail' : 'Outlook';
        toast({
          title: 'Tu firma ya va en tus correos',
          description: `Trajimos la firma que usas en ${account}. Puedes cambiarla en Firmas y estilo.`,
          action: <ToastAction altText="Revisar la firma en Firmas y estilo" onClick={() => router.push('/settings/email-studio')}>Revisar</ToastAction>,
        });
      }).catch(() => {
        // Nothing to show: the email goes as before, and it is tried again tomorrow.
      });
    }, START_AFTER_MS);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [userId, onSignatureScreen, router, toast]);

  return null;
}
