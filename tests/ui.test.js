const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('입퇴점 변화와 월별 아카이브는 한 줄 접힘 패널로 통합된다', () => {
  assert.match(html, /id="monthlyOverviewToggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="monthlyOverviewDetails" hidden/);
  assert.ok(html.indexOf('id="monthlyOverviewDetails"') < html.indexOf('id="brandRanking"'));
  assert.doesNotMatch(html, /id="monthlyChangeMore"/);
});

test('랭킹은 상위 10개만 먼저 보여주고 전체 보기로 확장한다', () => {
  assert.match(html, /let rankingExpanded = false/);
  assert.match(html, /rankedRows\.slice\(0, 10\)/);
  assert.match(html, /전체 \$\{rankedRows\.length\}개 보기/);
  assert.match(html, /const TIER_ORDER = \[/);
  assert.match(html, /TIER_ORDER\.forEach\(tier =>/);
  assert.doesNotMatch(html, /(?<![A-Z_])tierOrder\.forEach/);
});

test('브랜드 상세는 해당 층 도면 버튼과 공통 디자인 토큰을 사용한다', () => {
  assert.match(html, /해당 층 도면 보기/);
  assert.match(html, /function openFloorAt/);
  assert.match(html, /--company-lotte:/);
  assert.match(html, /--status-new:/);
  assert.match(html, /\.btn-floor/);
});

test('도면의 관리 브랜드 강조를 켜고 끌 수 있다', () => {
  assert.match(html, /id="floorHighlightToggle"[^>]*aria-pressed="true"/);
  assert.match(html, /function toggleFloorHighlights/);
  assert.match(html, /data-normal-url=/);
  assert.match(html, /data-highlight-url=/);
});
