const test = require('node:test');
const assert = require('node:assert/strict');
const { matchBrands, normalizeRow, observedSet, presenceSet, additionNote, exitNote, companyQualityIssue, koreaDateKey, buildJobList } = require('../crawler');

test('남성 브랜드는 찾고 명시된 여성 브랜드는 제외한다', () => {
  assert.deepEqual(matchBrands('남성 패션 타임옴므 시스템옴므').sort(), ['시스템옴므', '타임옴므']);
  assert.deepEqual(matchBrands('DKNY(여성)'), []);
});

test('줄바꿈된 유사 브랜드와 여성 송지오 라인은 관리 브랜드로 잡지 않는다', () => {
  assert.deepEqual(matchBrands('우치\n포터리'), []);
  assert.deepEqual(matchBrands('포터리 하우스'), []);
  assert.deepEqual(matchBrands('송지오파리'), []);
  assert.deepEqual(matchBrands('송지오 파리'), []);
  assert.deepEqual(matchBrands('마제스티 (바버숍)'), []);
  assert.deepEqual(matchBrands('송지오옴므 / 남성캐주얼'), ['송지오옴므']);
});

test('질스튜어트뉴욕의 도면 표기 변형은 찾고 액세서리 매장은 제외한다', () => {
  assert.deepEqual(matchBrands('질스튜어트 뉴욕'), ['질스튜어트뉴욕']);
  assert.deepEqual(matchBrands('질스튜어트 뉴옥'), ['질스튜어트뉴욕']);
  assert.deepEqual(matchBrands('JILL STUART NEW YORK'), ['질스튜어트뉴욕']);
  assert.deepEqual(matchBrands('질스튜어트 핸드백'), []);
  assert.deepEqual(matchBrands('JILLSTUART ACC'), []);
});

test('CP컴퍼니 남성 매장은 찾고 잠실 아동 매장은 제외한다', () => {
  assert.deepEqual(matchBrands('5F C.P. COMPANY'), ['CP컴퍼니']);
  assert.deepEqual(matchBrands('6F 수입&컨템포러리 C.P.컴퍼니'), ['CP컴퍼니']);
  assert.deepEqual(matchBrands('1F Trend CP 컴퍼니'), ['CP컴퍼니']);
  assert.deepEqual(matchBrands('여성 <strong class="brand">CP 컴퍼니</strong>'), ['CP컴퍼니']);
  assert.deepEqual(matchBrands('8F CP컴퍼니 언더식스틴'), []);
  assert.deepEqual(matchBrands('CP컴퍼니 언더식스틴 / 5F C.P. COMPANY'), ['CP컴퍼니']);
});

test('수집 지연 행은 변화 확정에는 쓰지 않지만 현재 점포 존재는 유지한다', () => {
  const row = normalizeRow({ company: '롯데', store: '수원점', brand: '타임옴므', note: '수집 지연 - 직전 정상값 유지', dataQuality: 'stale' });
  assert.equal(observedSet([row]).size, 0);
  assert.equal(presenceSet([row]).size, 1);
});

test('작업 목록의 점포 ID는 유일하다', () => {
  const jobs = buildJobList();
  assert.equal(new Set(jobs.map(job => job.storeId)).size, jobs.length);
});

test('잠실점 신규 오픈 브랜드는 과거 오탐 제외 목록에 남아 있지 않는다', () => {
  const source = require('node:fs').readFileSync(require.resolve('../crawler'), 'utf8');
  assert.doesNotMatch(source, /\['롯데','잠실점','아페쎄맨'\]/);
  assert.doesNotMatch(source, /\['롯데','잠실점','CP컴퍼니'\]/);
});

test('월간 변화는 정상 수집 2회째에 확정된다', () => {
  const key = '롯데-0013|타임옴므';
  assert.equal(additionNote(key, new Set(), new Set()), '신규 입점 재확인 중');
  assert.equal(additionNote(key, new Set(), new Set([key])), '이번 달 신규 입점');
  assert.equal(exitNote(key, new Set([key])), '퇴점 재확인 중');
  assert.equal(exitNote(key, new Set()), '이번 달 퇴점');
});

test('복수 지점 이상과 30% 이상 급락은 품질 저하로 판정한다', () => {
  assert.match(companyQualityIssue('롯데', 150, 0, 19, 19), /품질 게이트 실패/);
  assert.equal(companyQualityIssue('롯데', 150, 145, 1, 19), '');
});

test('월과 일 경계는 한국 시간 기준으로 계산한다', () => {
  assert.equal(koreaDateKey(new Date('2026-08-31T16:00:00.000Z')), '2026-09-01');
});
