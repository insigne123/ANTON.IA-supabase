import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Crear contraseña nueva' };

export default function ResetPasswordLayout({ children }: { children: ReactNode }) {
  return children;
}
