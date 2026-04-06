'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Moon, Sun } from 'lucide-react';

export default function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const current = (theme ?? resolvedTheme ?? 'system') as 'light'|'dark'|'system';
  const next = current === 'light' ? 'dark' : 'light';

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Cambiar a tema ${next}`}
      onClick={() => setTheme(next)}
      className="rounded-2xl"
    >
      {current === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
