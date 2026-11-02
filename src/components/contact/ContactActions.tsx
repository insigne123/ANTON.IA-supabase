'use client';

import { MessageCircle, Phone } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { telHref, whatsappHref, whatsappOpener, type CallContact } from '@/lib/contact-calls';
import { startCall } from '@/lib/contact-calls-client';
import { cn } from '@/lib/utils';

const action = 'inline-flex h-8 items-center gap-1 rounded-full border border-border/70 bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7 sm:px-2.5';

/**
 * A contact's mobile with «Llamar» and «WhatsApp» (src/lib/contact-calls.ts). The number stays selectable text, so it
 * can be copied when the device has no phone app; WhatsApp shows only when the number carries its country code.
 */
export function ContactActions({
  phone,
  contact,
  morePhones = 0,
  onScript,
  senderCompany,
  className,
}: {
  phone: string | null | undefined;
  contact: CallContact;
  /** Other numbers the contact has, shown as «+2». */
  morePhones?: number;
  /** Opens the call script, when the screen has one. */
  onScript?: () => void;
  senderCompany?: string | null;
  className?: string;
}) {
  const { user } = useAuth();
  const tel = telHref(phone);
  if (!tel) return null;
  const shown = String(phone || '').trim();
  const meta = (user?.user_metadata || {}) as Record<string, unknown>;
  const senderName = typeof meta.full_name === 'string' ? meta.full_name : typeof meta.name === 'string' ? meta.name : null;
  const whatsapp = whatsappHref(phone, whatsappOpener({ contactName: contact.name, senderName, senderCompany }));
  const who = contact.name || 'este contacto';

  return (
    <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs', className)}>
      <span className="select-all tabular-nums text-foreground">
        {shown}
        {morePhones > 0 ? <span className="ml-1 text-foreground/70">+{morePhones}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <a href={tel} className={action} onClick={() => startCall('call', contact)} aria-label={`Llamar a ${who} al ${shown}`}>
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />Llamar
        </a>
        {whatsapp ? (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={action} onClick={() => startCall('whatsapp', contact)} aria-label={`Escribir a ${who} por WhatsApp`}>
            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />WhatsApp
          </a>
        ) : null}
        {onScript ? (
          <button type="button" onClick={onScript} className="h-8 rounded-full px-2 text-xs font-medium text-foreground/70 underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-7">
            Guion
          </button>
        ) : null}
      </span>
    </div>
  );
}
