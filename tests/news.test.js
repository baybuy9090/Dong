const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvents } = require('../news-crawler');

test('뉴스를 실무 이벤트로 다중 분류한다', () => {
  assert.deepEqual(classifyEvents('성수 플래그십 신규 오픈으로 유통 확장'), ['신규 매장·팝업', '리뉴얼·확장']);
  assert.deepEqual(classifyEvents('백화점 철수 및 영업 종료'), ['철수·중단']);
});
