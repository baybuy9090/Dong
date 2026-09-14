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
