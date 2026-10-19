import assert from 'node:assert/strict';
import test from 'node:test';

import { findSupplier, readSupplierProfile } from './market';

/** public_procurement_suppliers and its bids in memory, with the query methods the lookups use. */
function memory() {
  const tables: Record<string, any[]> = {
    public_procurement_suppliers: [{ id: 277942, rut: '76200391-0', name: 'SERVICIOS DE ASEO INDUSTRIAL ANDES LIMITADA' }, { id: 27794, rut: '27794-2', name: 'OTRA' }],
    public_procurement_bids: [{ supplier_id: 277942, selected: true, offered_amount: 90, awarded_amount: 90,
      tender: { code: '2018-41-LQ25', name: 'Servicio de aseo', status: 'adjudicada', currency: 'CLP', estimated_amount: 100, published_on: '2025-10-01', category: 'Aseo', agency: { name: 'DGAC' } } }],
  };
  const from = (name: string) => {
    const filters: Array<(row: any) => boolean> = [];
    const chain: any = {
      select: () => chain,
      eq: (key: string, value: any) => { filters.push(row => row[key] === value); return chain; },
      limit: () => chain,
      then: (resolve: any) => resolve({ data: tables[name].filter(row => filters.every(filter => filter(row))), error: null }),
    };
    return chain;
  };
  return { from } as any;
}

test('a supplier id is never read as a RUT, so the profile opens', async () => {
  const client = memory();
  assert.equal((await findSupplier(client, 277942))?.name, 'SERVICIOS DE ASEO INDUSTRIAL ANDES LIMITADA', 'by id');
  assert.equal((await findSupplier(client, '76.200.391-0'))?.id, 277942, 'by RUT');
  const profile = await readSupplierProfile(client, 277942);
  assert.equal(profile?.supplier.rut, '76200391-0');
  assert.deepEqual([profile?.bids, profile?.wins, profile?.medianOfferRatio], [1, 1, 0.9]);
});
