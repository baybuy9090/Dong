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
  assert.match(html, /월별 입·퇴점 아카이브 · \$\{monthLabel\} 신규/);
  assert.match(html, /const months = current \? \[current, \.\.\.past\] : past/);
  assert.doesNotMatch(html, /id="monthlyChangeList"/);
});

test('랭킹은 상위 10개만 먼저 보여주고 전체 보기로 확장한다', () => {
  assert.match(html, /let rankingExpanded = false/);
  assert.match(html, /rankedRows\.slice\(0, 10\)/);
  assert.match(html, /전체 \$\{rankedRows\.length\}개 보기/);
  assert.match(html, /const TIER_ORDER = \[/);
  assert.match(html, /regionRankedRows\.forEach\(\(r, index\) =>/);
  assert.match(html, /class="total-col">\$\{r\.total\}/);
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
  assert.doesNotMatch(html, /floor-map-overlay/);
  assert.match(html, /f\.highlightUrl \? \(f\.brands \|\| \[\]\)/);
  assert.match(html, /hasHighlightableFloor = floorSub === 'store'/);
  assert.match(html, /floorHighlightControls'\)\.style\.display = hasHighlightableFloor/);
  assert.match(html, /도면 웹페이지로 이동/);
});

test('뉴스 화면에 전체 브랜드 수집 범위와 미수집 브랜드를 투명하게 표시한다', () => {
  assert.match(html, /기사 있는 브랜드 \$\{newsCoverage\}\/\$\{ALL_BRANDS_ORDERED\.length\}/);
  assert.match(html, /news-card news-card-coverage/);
  assert.match(html, /최근 \$\{newsWindowDays\}일 내 관련 기사가 없는 브랜드/);
});
