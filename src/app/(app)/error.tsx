'use client';

import { ErrorView } from '@/components/error-view';

/** Inside the app shell: the menu stays, so the person can go elsewhere. */
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
