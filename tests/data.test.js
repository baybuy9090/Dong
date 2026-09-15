const test = require('node:test');
const assert = require('node:assert/strict');
const data = require('../data.json');

test('현재 데이터는 월간 변화 스키마와 수원점 고유 ID를 사용한다', () => {
  assert.match(data.monthKey, /^\d{4}-\d{2}$/);
  assert.ok(data.monthStartSnapshot);
  const suwon = data.data.filter(row => row.storeId === '롯데-0349');
  assert.ok(suwon.length > 0);
  assert.ok(suwon.every(row => row.store === '수원점'));
  assert.ok(suwon.every(row => !/(신규|퇴점|누락)/.test(row.note || '')));
});

test('현재 비교 기준은 직전 월이고 6월 baseline 경고가 없다', () => {
  const [year, month] = data.monthKey.split('-').map(Number);
  const previousMonth = new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
  assert.equal(data.comparisonAsOf, data.monthStartSnapshot);
  assert.equal(data.comparisonAsOf.slice(0, 7), previousMonth);
  assert.equal('baselineAsOf' in data, false);
  assert.ok(data.data.every(row => !('baselineCheck' in row)));
});

test('사용자가 입점을 확인한 3개 조합은 재확인이나 수집 지연으로 표시되지 않는다', () => {
  const confirmed = new Set(['롯데-0001|POTTERY', '롯데-0002|지제로', '현대-B00143000|지오송지오']);
  const rows = data.data.filter(row => confirmed.has(`${row.storeId}|${row.brand}`));
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.note === '확인됨(검토)'));
  assert.ok(rows.every(row => row.dataQuality === 'manual'));
});

test('잠실점 9월 신규 오픈 2개 브랜드가 확정 상태로 반영된다', () => {
  const brands = new Set(['아페쎄맨', 'CP컴퍼니']);
  const rows = data.data.filter(row => row.storeId === '롯데-0002' && brands.has(row.brand));
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.note === '이번 달 신규 입점'));
  assert.ok(rows.every(row => row.changeMonth === '2026-09'));
  assert.ok(rows.every(row => row.comparisonCheck === '2026-08-31 미입점'));
  assert.ok(rows.every(row => row.dataQuality === 'manual'));
});

test('현대 중동과 판교 CP컴퍼니는 직전 월부터 입점 상태로 유지된다', () => {
  const storeIds = new Set(['현대-B00143000', '현대-B00148000']);
  const rows = data.data.filter(row => storeIds.has(row.storeId) && row.brand === 'CP컴퍼니');
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.note === '확인'));
  assert.ok(rows.every(row => row.comparisonCheck === '2026-08-31 입점'));
});
