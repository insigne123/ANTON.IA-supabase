'use client';

import { useState } from 'react';

import { DefaultSenderCard } from '@/components/settings/DefaultSenderCard';
import { MailConnectionsCard } from '@/components/settings/MailConnectionsCard';
import { MercadoPublicoConnectionCard } from '@/components/settings/MercadoPublicoConnectionCard';

/**
 * The mailboxes and the default sender (after a disconnection the sender card reads its state again), and the Mercado
 * Público ticket for whoever can open «Oportunidades».
 */
export function ConnectionsPanel() {
  const [version, setVersion] = useState(0);
  return (
    <>
      <MailConnectionsCard onChanged={() => setVersion((current) => current + 1)} />
      <DefaultSenderCard key={version} />
      <MercadoPublicoConnectionCard />
    </>
  );
}
