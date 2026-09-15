const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../config');

test('수원 명칭은 같은 점포 ID와 수원점 표시명으로 정규화된다', () => {
  for (const name of ['수원', '수원점', '타임빌라스 수원']) {
    assert.equal(config.normalizeStoreName('롯데', name), '수원점');
    assert.equal(config.storeId('롯데', name), '롯데-0349');
  }
});

test('공통 설정에는 3사 45개 지점과 37개 브랜드가 있다', () => {
  assert.equal(config.storeRows.length, 45);
  assert.equal(new Set(config.brands).size, 37);
});

test('현대 중동점은 EAST와 WEST 공식 지점 코드를 함께 조회한다', () => {
  assert.deepEqual(config.hyundaiBranches('중동', 'B00143000'), [
    { code:'B00143000', label:'' },
    { code:'B00143100', label:'WEST' },
  ]);
  assert.deepEqual(config.hyundaiBranches('판교', 'B00148000'), [
    { code:'B00148000', label:'' },
  ]);
});
