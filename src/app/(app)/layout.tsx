import { AppShell } from '@/components/app-shell';
import { CreditPricesProvider } from '@/context/CreditPricesContext';

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CreditPricesProvider><AppShell>{children}</AppShell></CreditPricesProvider>;
}
