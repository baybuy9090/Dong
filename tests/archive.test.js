const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildMonthlyArchive, previousMonthKey } = require('../monthly-archive');

test('비교 기준 월은 연도 경계에서도 바로 전월로 계산한다', () => {
  assert.equal(previousMonthKey('2026-09'), '2026-08');
  assert.equal(previousMonthKey('2026-01'), '2025-12');
});

test('기존 스냅샷으로 8월 월별 아카이브를 생성한다', () => {
  const archive = buildMonthlyArchive(path.join(__dirname, '..', 'history'));
  const august = archive.months.find(item => item.month === '2026-08');
  assert.ok(august);
  assert.equal(august.baselineSnapshot, '2026-07-31');
  assert.ok(Array.isArray(august.new));
  assert.ok(Array.isArray(august.exit));
  assert.equal(august.new.length, 6);
  assert.equal(august.exit.length, 4);
  const newKeys = new Set(august.new.map(row => `${row.storeId}|${row.brand}`));
  assert.ok(newKeys.has('롯데-0005|질스튜어트뉴욕'));
  assert.ok(!newKeys.has('롯데-0005|스톤아일랜드'));
});
