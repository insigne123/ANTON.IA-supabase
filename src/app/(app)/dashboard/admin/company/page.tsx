import { CompanyProfileEditor } from '@/components/admin/CompanyProfileEditor';
import { OpenTrackingCard } from '@/components/admin/OpenTrackingCard';

/** «Empresa»: the «Ficha de la empresa» (APP-06) the whole team writes from, and how its emails are measured (M4). */
export default function AdminCompanyPage() {
  return <>
    <CompanyProfileEditor />
    <OpenTrackingCard />
  </>;
}
