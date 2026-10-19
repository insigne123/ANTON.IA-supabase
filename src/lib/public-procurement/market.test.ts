import assert from 'node:assert/strict';
import test from 'node:test';
import {
  agencyKeyVariants, agencyTokens, awardRatio, bestAgencyMatch, contractEndsOn, formatRut, likePatterns, marketStats, moneyLabel, normalizeRut,
  percentLabel, pickSimilar, searchWords, similarity, topicTokens, type MarketTender,
} from './market';

const tender = (values: Partial<MarketTender>): MarketTender => ({
  id: 1, code: '1-1-LE26', name: 'Servicio de aseo', agency: 'I MUNICIPALIDAD DE MAIPU', status: 'adjudicada', kind: 'LE', currency: 'CLP',
  estimatedAmount: 100_000_000, awardedAmount: 85_000_000, bidders: 4, publishedOn: '2026-03-01', awardedOn: '2026-04-01', durationMonths: 24,
  category: 'Servicios de limpieza', winners: [{ rut: '76020266-5', name: 'Aseo Norte SpA', amount: 85_000_000 }],
  bids: [{ rut: '76020266-5', name: 'Aseo Norte SpA', offered: 85_000_000, selected: true }], ...values,
});

test('a buyer is found however ChileCompra writes it', () => {
  assert.deepEqual(agencyKeyVariants('Municipalidad de Maipú'),
    ['municipalidad de maipu', 'i municipalidad de maipu', 'ilustre municipalidad de maipu']);
  assert.deepEqual(agencyKeyVariants('I MUNICIPALIDAD DE COQUIMBO'),
    ['i municipalidad de coquimbo', 'municipalidad de coquimbo', 'ilustre municipalidad de coquimbo']);
  assert.deepEqual(agencyKeyVariants('SS'), []);
  assert.deepEqual(agencyTokens('Hospital Clínico San Borja Arriarán'), ['hospital', 'clinico', 'san', 'borja', 'arriaran']);

  const rows = ['servicio de salud de talcahuano hospital', 'servicio de salud del maule hospital de talca', 'universidad de talca',
    'serv salud metropolitano central hospital clinico san borja arriaran', 'servicio de salud metropolitano sur',
    'servicio de salud metropolitano sur oriente'].map(name_key => ({ name_key }));
  assert.equal(bestAgencyMatch('Hospital de Talca', rows)?.name_key, 'servicio de salud del maule hospital de talca', 'not Talcahuano');
  assert.equal(bestAgencyMatch('Hospital Clínico San Borja Arriarán', rows)?.name_key, 'serv salud metropolitano central hospital clinico san borja arriaran');
  assert.equal(bestAgencyMatch('Servicio de Salud Metropolitano Sur', rows)?.name_key, 'servicio de salud metropolitano sur', 'the fewest other words');
  assert.equal(bestAgencyMatch('Hospital', rows), null, 'one word says too little');
  assert.equal(bestAgencyMatch('Hospital de Linares', rows), null);
});

test('tenders alike by what they buy, not by the words every tender says', () => {
  assert.deepEqual(topicTokens('Servicio de guardias de seguridad para dependencias municipales 2026'), ['vigilancia', 'seguridad', 'municipal']);
  assert.deepEqual(searchWords(['vigilancia', 'seguridad']), ['vigilancia', 'guardia', 'guardias', 'seguridad'], 'searched in every way of saying it');
  assert.equal(similarity(['guardia', 'seguridad'], ['guardia', 'seguridad']), 1);
  assert.equal(similarity([], ['guardia']), 0);
  const picked = pickSimilar('Servicio de guardias de seguridad', [
    tender({ id: 1, name: 'Contratación de servicio de guardias de seguridad', category: 'Seguridad y vigilancia' }),
    tender({ id: 2, name: 'Compra de resmas de papel', category: 'Artículos de oficina' }),
    tender({ id: 3, name: 'Guardias para el CESFAM', category: null }),
    tender({ id: 4, name: 'Convenio de servicios de vigilancia', category: 'SEGURIDAD, VIGILANCIA Y DETECCIÓN' }),
    tender({ id: 5, name: 'INSUMOS OPTICA COMUNAL', category: 'SEGURIDAD, VIGILANCIA Y DETECCIÓN' }),
    tender({ id: 6, name: 'PROPUESTA PÚBLICA N° 486-2023', category: 'SEGURIDAD, VIGILANCIA Y DETECCIÓN' }),
  ]);
  assert.deepEqual(picked.map(item => item.tender.id), [1, 4, 3, 6], 'a name that says otherwise is not alike for its category alone');
  const decided = pickSimilar('Conservación de caminos', [
    tender({ id: 1, name: 'Conservación camino Naupe', status: 'cerrada' }),
    tender({ id: 2, name: 'Conservación camino Ralico', status: 'adjudicada' }),
  ]);
  assert.deepEqual(decided.map(item => item.tender.id), [2, 1], 'as alike, what was already decided says more');
});

test('what the market paid: medians in pesos, deserted and winners', () => {
  const stats = marketStats([
    tender({ id: 1 }),
    tender({ id: 2, awardedAmount: 95_000_000, bidders: 2 }),
    tender({ id: 3, status: 'desierta', awardedAmount: null, winners: [], bidders: 1 }),
    tender({ id: 4, currency: 'UF', estimatedAmount: 3000, awardedAmount: 2900, bidders: 6, winners: [{ rut: '11111111-1', name: 'Limpia Sur Ltda', amount: 2900 }] }),
  ]);
  assert.equal(stats.tenders, 4);
  assert.equal(stats.awarded, 3);
  assert.equal(stats.deserted, 1);
  assert.equal(stats.medianBidders, 3, 'of 4, 2, 1 and 6');
  assert.equal(stats.medianAwardRatio, 0.9, 'only pesos count');
  assert.deepEqual(stats.winners.map(winner => [winner.name, winner.wins, winner.amount]), [['Aseo Norte SpA', 2, 170_000_000], ['Limpia Sur Ltda', 1, 0]]);
  assert.equal(awardRatio(tender({ awardedAmount: 900_000_000 })), null, 'nine times the estimate is a different unit');
});

test('dates, money and RUTs read the Chilean way', () => {
  assert.equal(contractEndsOn('2025-01-15', 24), '2027-01-15');
  assert.equal(contractEndsOn('2025-01-31', 1), '2025-02-28', 'the last day of a shorter month');
  assert.equal(contractEndsOn('2025-01-15', 1.5), '2025-03-02', 'half a month is 15 days');
  assert.equal(contractEndsOn('2025-01-15', null), null);
  assert.equal(contractEndsOn(null, 12), null);
  assert.equal(moneyLabel(1_234_000_000), '$1,2 mil millones');
  assert.equal(moneyLabel(85_400_000), '$85 millones');
  assert.equal(moneyLabel(950_000), '$950.000');
  assert.equal(moneyLabel(3400, 'UF'), 'UF 3.400');
  assert.equal(moneyLabel(null), null);
  assert.equal(percentLabel(0.876), '88 %');
  assert.equal(formatRut('76020266-5'), '76.020.266-5');
  assert.equal(normalizeRut('76.020.266-5'), '76020266-5');
  assert.deepEqual(likePatterns(['aseo', 'servicios', 'guardias de seguridad', 'TI', '50%']), ['%aseo%', '%guardias de seguridad%']);
});
