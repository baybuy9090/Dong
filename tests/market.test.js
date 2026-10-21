const test = require('node:test');
const assert = require('node:assert/strict');
const { buildComparison } = require('../market');
const config = require('../config');
const stores = [config.getStore('롯데', '본점'), config.getStore('신세계', '본점'), config.getStore('현대', '본점')];
const brands = ['타임옴므', '바버', 'POTTERY', '이로맨'];
function compare(rows, options = {}) {
  return buildComparison({ stores, brands, baseId: stores[0].id, peerIds: [stores[1].id],
    payload: { data: rows, diagnostics: stores.map(store => ({ storeId: store.id, status: 'ok' })) }, ...options });
}
function row(store, brand, fields = {}) { return { company: store.company, store: store.name, storeId: store.id, brand, note: '확인', ...fields }; }

test('동일 이름 본점도 회사별 ID로 구분하고 브랜드 수를 중복 집계하지 않는다', () => {
  const result = compare([row(stores[0], '타임옴므'), row(stores[0], '타임옴므'), row(stores[1], '타임옴므'), row(stores[0], '바버'), row(stores[1], 'POTTERY')]);
  assert.deepEqual(result.counts, { base: 2, common: 1, exclusive: 1, candidate: 1, uncertain: 0 });
});

test('기준점 수집 지연·누락 재확인은 유치 후보로 분류하지 않는다', () => {
  for (const fields of [{ dataQuality: 'stale' }, { note: '퇴점 재확인 중' }, { note: '신규 입점 재확인 중' }]) {
    const result = compare([row(stores[0], 'POTTERY', fields), row(stores[1], 'POTTERY')]);
    assert.equal(result.counts.candidate, 0);
    assert.equal(result.items.find(item => item.brand === 'POTTERY').category, 'uncertain');
  }
});

test('진단 누락 또는 점포 수집 오류를 미입점으로 단정하지 않는다', () => {
  const result = compare([], { payload: { data: [row(stores[1], '바버')], diagnostics: [{ storeId: stores[1].id, status: 'ok' }] } });
  assert.equal(result.counts.candidate, 0);
  assert.equal(result.items.find(item => item.brand === '바버').cells[0].state, 'unknown');
});

test('일부 비교 점포가 미확인이면 기준점 단독 보유로 집계하지 않는다', () => {
  const result = compare([row(stores[0], '바버'), row(stores[1], '바버', { dataQuality: 'stale' })]);
  assert.equal(result.counts.exclusive, 0);
});

test('수동 정상·삭제 결정을 반영하며 삭제 브랜드는 입점 수에서 제외한다', () => {
  const result = compare([row(stores[0], '바버')], { decisions: { [`${stores[0].id}|바버`]: 'reject', [`${stores[0].id}|POTTERY`]: 'confirm' } });
  assert.equal(result.counts.base, 1);
  assert.equal(result.items.some(item => item.brand === '바버'), false);
});

test('중복 비교 점포와 기준 점포를 제외하고 후보 정렬은 경쟁점 입점 수를 따른다', () => {
  const result = compare([row(stores[1], '바버'), row(stores[1], 'POTTERY'), row(stores[2], 'POTTERY')], { peerIds: [stores[0].id, stores[1].id, stores[1].id, stores[2].id] });
  assert.equal(result.selected.length, 3);
  assert.equal(result.items[0].brand, 'POTTERY');
  assert.equal(result.items[0].peerCount, 2);
});

test('비교 점포가 없으면 단독 보유나 유치 후보로 오해하지 않는다', () => {
  const result = compare([row(stores[0], '바버')], { peerIds: [] });
  assert.equal(result.counts.exclusive, 0);
  assert.equal(result.counts.candidate, 0);
});

test('퇴점 후 모든 점포에서 사라진 브랜드도 월간 변화 근거를 보존한다', () => {
  const result = compare([row(stores[0], '바버', { note: '이번 달 퇴점' })]);
  assert.equal(result.items[0].category, 'exit');
  assert.equal(result.counts.base, 0);
});

test('현재 전체 점포 조합에서 집계가 관리 브랜드 수를 넘지 않는다', () => {
  const payload = require('../data.json');
  for (const base of config.storeRows) {
    const result = buildComparison({ stores: config.storeRows, brands: config.brands, payload, baseId: base.id,
      peerIds: config.storeRows.filter(store => store.company !== base.company && store.region === base.region).map(store => store.id) });
    assert.ok(result.counts.base <= config.brands.length);
    assert.ok(result.counts.exclusive + result.counts.common <= result.counts.base);
  }
});
