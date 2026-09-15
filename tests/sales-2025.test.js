const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const payload = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'sales-2025.json'), 'utf8'));

test('2025년 백화점 매출 순위 65개를 순서대로 보관한다', () => {
  assert.equal(payload.unit, '억원');
  assert.equal(payload.vatIncluded, true);
  assert.equal(payload.data.length, 65);
  assert.deepEqual(payload.data.map(row => row.rank), Array.from({ length: 65 }, (_, index) => index + 1));
});

test('첨부 표의 상위권과 마지막 순위 값을 정확히 반영한다', () => {
  assert.deepEqual(payload.data[0], { rank: 1, store: '신세계 강남점', sales: 36717, growth: 10.4 });
  assert.deepEqual(payload.data[1], { rank: 2, store: '롯데 잠실점', sales: 33010, growth: 8.0 });
  assert.deepEqual(payload.data[4], { rank: 5, store: '현대 판교점', sales: 20291, growth: 17.2 });
  assert.deepEqual(payload.data[64], { rank: 65, store: '롯데 관악점', sales: 1065, growth: -7.8 });
});

test('매출 순위는 내림차순이고 신장률은 숫자로 저장한다', () => {
  payload.data.forEach((row, index) => {
    assert.equal(typeof row.sales, 'number');
    assert.equal(typeof row.growth, 'number');
    if (index > 0) assert.ok(payload.data[index - 1].sales >= row.sales);
  });
});
