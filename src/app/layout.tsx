import type { Metadata } from 'next';

import './globals.css';
import '@/styles/design-tokens.css';
import { Toaster } from '@/components/ui/toaster';
import { cn } from '@/lib/utils';
import { ThemeProvider } from '@/components/providers/theme-provider';
import { AuthProvider } from '@/context/AuthContext';
import { PresenceProvider } from '@/context/PresenceContext';
import { ExtensionInitializer } from '@/components/extension-initializer';
import { Poppins, PT_Sans } from 'next/font/google';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-headline',
  display: 'swap',
});

const ptSans = PT_Sans({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ANTON.IA - Lead Automation',
  description: 'AI-powered lead search, research, and outreach.',
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
    apple: [{ url: '/icon.png', type: 'image/png' }],
    shortcut: ['/icon.png'],
  },
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body className={cn('font-body antialiased min-h-screen bg-background text-foreground', ptSans.variable, poppins.variable)} suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="system">
          <AuthProvider>
            <PresenceProvider>
              {children}
              <ExtensionInitializer />
              <Toaster />
            </PresenceProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
