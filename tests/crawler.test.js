const test = require('node:test');
const assert = require('node:assert/strict');
const { matchBrands, normalizeRow, observedSet, presenceSet, additionNote, exitNote, companyQualityIssue, koreaDateKey, buildJobList } = require('../crawler');

test('남성 브랜드는 찾고 명시된 여성 브랜드는 제외한다', () => {
  assert.deepEqual(matchBrands('남성 패션 타임옴므 시스템옴므').sort(), ['시스템옴므', '타임옴므']);
  assert.deepEqual(matchBrands('DKNY(여성)'), []);
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
