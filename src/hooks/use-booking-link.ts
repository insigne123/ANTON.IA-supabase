'use client';

import { useEffect, useState } from 'react';
import { profileService } from '@/lib/services/profile-service';
import { readBookingPreference } from '@/lib/booking-link';

/** The person's booking link for «Insertar mi agenda»: null without one or with «Nunca» (Firmas y estilo › Agenda). */
export function useBookingLink() {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    profileService.getSignatures()
      .then((signatures: unknown) => {
        const preference = readBookingPreference(signatures);
        if (!cancelled) setUrl(preference && preference.mode !== 'never' && preference.url ? preference.url : null);
      })
      .catch(() => { if (!cancelled) setUrl(null); });
    return () => { cancelled = true; };
  }, []);
  return url;
}
