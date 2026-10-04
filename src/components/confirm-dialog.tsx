'use client';

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  /** The verb of the action, e.g. «Eliminar 3 contactos». Defaults to «Confirmar». */
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` paints the action red: for what cannot be undone. */
  tone?: 'default' | 'danger';
};

type Pending = ConfirmOptions & { resolve: (accepted: boolean) => void };
const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * The app's confirmation dialog, in place of the browser's confirm(): it says what will happen, names the action on its
 * button and keeps focus inside. Mounted once in the root layout; pages ask through useConfirm().
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => {
    pendingRef.current?.resolve(false); // A new question replaces one left open.
    const next = { ...options, resolve };
    pendingRef.current = next;
    setPending(next);
  }), []);

  const settle = (accepted: boolean) => {
    pendingRef.current?.resolve(accepted);
    pendingRef.current = null;
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AlertDialog open={Boolean(pending)} onOpenChange={(open) => { if (!open) settle(false); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{pending?.title}</AlertDialogTitle>
            {pending?.description ? <AlertDialogDescription>{pending.description}</AlertDialogDescription> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => settle(false)}>{pending?.cancelLabel || 'Cancelar'}</AlertDialogCancel>
            <AlertDialogAction
              className={cn(pending?.tone === 'danger' && buttonVariants({ variant: 'destructive' }))}
              onClick={() => settle(true)}
            >
              {pending?.confirmLabel || 'Confirmar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext.Provider>
  );
}

/** `const confirm = useConfirm(); if (!(await confirm({ title: '¿Eliminar…?', tone: 'danger' }))) return;` */
export function useConfirm() {
  const confirm = useContext(ConfirmContext);
  if (!confirm) throw new Error('useConfirm necesita <ConfirmProvider> (src/app/layout.tsx).');
  return confirm;
}
