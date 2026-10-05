const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyEvents, filterByBrandRelevance, hasBrandMention, newsQueriesForBrand } = require('../news-crawler');
const CONFIG = require('../config');
const { normalizeNewsDate, filterRecentAndSort, parseGoogleItems } = require('../news-crawler');

test('뉴스는 재사용 기사도 60일 경계와 미래·잘못된 날짜를 검사한다', () => {
  const now = Date.parse('2026-10-05T00:00:00Z');
  const cutoff = now - 60 * 86400000;
  const items = [cutoff - 1, cutoff, now, now + 1].map(timestamp => ({ pubDate: new Date(timestamp).toISOString() }));
  items.push({ pubDate: null }, { pubDate: 'invalid' }, {});
  assert.deepEqual(filterRecentAndSort(items, now).map(item => Date.parse(item.pubDate)), [now, cutoff]);
  assert.deepEqual(filterRecentAndSort([{ pubDate: '2005-01-01' }], now), []);
});

test('RSS의 잘못된 날짜 하나 때문에 전체 수집이 실패하지 않는다', () => {
  assert.equal(normalizeNewsDate('invalid'), null);
  assert.equal(normalizeNewsDate(null), null);
  const items = parseGoogleItems('<item><title>기사</title><link>https://example.com/news</link><pubDate>invalid</pubDate></item>');
  assert.equal(items.length, 1);
  assert.equal(items[0].pubDate, null);
  assert.deepEqual(filterRecentAndSort(items), []);
});

test('화면의 날짜 필터도 수집기의 60일 기준과 일치한다', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
  const source = html.match(/function recentNewsOnly\(items, now = Date.now\(\)\) \{[\s\S]*?\n    \}/)[0];
  const filter = require('node:vm').runInNewContext(`(${source})`);
  const now = Date.parse('2026-10-05T00:00:00Z');
  const items = ['2005-01-01', '2026-09-05', 'invalid', '2027-01-01'].map(pubDate => ({ pubDate }));
  assert.equal(JSON.stringify(filter(items, now)), JSON.stringify(filterRecentAndSort(items, now)));
});

test('뉴스를 실무 이벤트로 다중 분류한다', () => {
  assert.deepEqual(classifyEvents('성수 플래그십 신규 오픈으로 유통 확장'), ['신규 매장·팝업', '리뉴얼·확장']);
  assert.deepEqual(classifyEvents('백화점 철수 및 영업 종료'), ['철수·중단']);
});

test('포터리 패션 기사와 도자기·맛집 노이즈를 구분한다', () => {
  const items = [
    { title:'포터리, 시장 지배력 키운다', _desc:'남성복 패션 브랜드 POTTERY' },
    { title:'속초 로컬 맛집 5', _desc:'포터리 근처 여행' },
    { title:'런던 포터리 토트백 출시', _desc:'주방용품' },
  ];
  assert.deepEqual(filterByBrandRelevance(items, 'POTTERY').map(item => item.title), ['포터리, 시장 지배력 키운다']);
  assert.equal(hasBrandMention('포터리가 신규 매장을 열었다', '포터리'), true);
  assert.ok(newsQueriesForBrand('POTTERY').every(query => /POTTERY|포터리/.test(query)));
});

test('바버 인명과 알레그리 축구 감독 기사를 제외한다', () => {
  assert.deepEqual(filterByBrandRelevance([
    { title:'폴 스미스와 바버, 패션 협업 컬렉션' },
    { title:'엘렌 바버, 100m 허들 출전' },
    { title:'환율 하락에 수입 패션 전망 개선', _desc:'바버 등 해외 브랜드 수익성 개선' },
    { title:'트레이딩은 개인투자자의 부에 해롭다', _desc:'경제학자 바버 연구 결과' },
  ], '바버').map(item => item.title), ['폴 스미스와 바버, 패션 협업 컬렉션', '환율 하락에 수입 패션 전망 개선']);
  assert.deepEqual(filterByBrandRelevance([
    { title:'알레그리, 신규 시즌 남성복 공개' },
    { title:'알레그리 감독의 나폴리가 승리' },
  ], '알레그리').map(item => item.title), ['알레그리, 신규 시즌 남성복 공개']);
});

test('37개 전체 브랜드를 뉴스 수집 대상으로 삼는다', () => {
  assert.equal(CONFIG.brands.length, 37);
  assert.deepEqual(CONFIG.newsExcludedBrands, []);
  CONFIG.brands.forEach(brand => assert.ok(newsQueriesForBrand(brand).length >= 1));
});

test('CP컴퍼니는 영문 브랜드명으로도 검색하고 기사 연관성을 판정한다', () => {
  const queries = newsQueriesForBrand('CP컴퍼니');
  assert.ok(queries.some(query => query.includes('CP COMPANY')));
  assert.deepEqual(filterByBrandRelevance([
    { title:'CP COMPANY, 서울 신규 매장 오픈' },
    { title:'다른 패션 브랜드 신상품 공개' },
  ], 'CP컴퍼니').map(item => item.title), ['CP COMPANY, 서울 신규 매장 오픈']);
});
