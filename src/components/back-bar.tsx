'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

type BackBarProps = {
  fallbackHref: string;      // a dónde ir si no hay history (p. ej. "/saved/leads")
  label?: string;
  className?: string;
};

export function BackBar({ fallbackHref, label = 'Volver', className }: BackBarProps) {
  const router = useRouter();

  const handleBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  };

  return (
    <div className={className}>
      <Button variant="ghost" size="sm" onClick={handleBack}>
        <ArrowLeft className="mr-1 h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}
