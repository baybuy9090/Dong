/**
 * 남성 컨템포러리/디자이너 브랜드 37종 — 3사 45개 지점 입점 현황 크롤러 (Node.js판)
 * GitHub Actions에서 실행되며, GAS 버전과 동일한 매칭 로직을 그대로 씁니다.
 * GAS의 6분 실행 제한이 없어서 체크포인트/트리거 로직이 필요 없습니다.
 */

const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');
const { writeMonthlyArchive, isReliable, previousMonthKey } = require('./monthly-archive');

// 같은 cstrCd 안에 "백화점"(C00401) 말고 다른 관(town)이 별도로 있는 지점들.
// 남성 컨템포러리 브랜드가 있는지 직접 확인해서 있는 곳만 등록함
// (강남 더콘란샵·문화센터, 광복 아쿠아몰, 동탄 D.Avenue, 창원 영플라자,
// 평촌 문화홀은 확인해봤으나 남성 컨템포러리 브랜드가 없어 제외).
const LOTTE_EXTRA_TOWNS = {
  '부산본점': [{ townCd: 'C00402', floors: ['01', '02', 'M3F', 'MF'] }],
};

const BRAND_PATTERNS = {
  '아페쎄맨': ['A.P.C', '에이피씨', '아페쎄', 'APC맨'],
  'CP컴퍼니': ['CP컴퍼니', 'C.P. COMPANY', 'C.P.COMPANY', 'CP COMPANY', '씨피컴퍼니', '씨피 컴퍼니'],
  'DKNY맨': ['DKNY'],
  'PAF': ['PAF'],
  'POTTERY': ['포터리', 'POTTERY'],
  'TEN-C': ['TEN-C', '텐씨'],
  '띠어리맨': ['띠어리'],
  '맨메이드카페': ['맨메이드'],
  '맨온더분': ['맨온더분', 'MAN ON THE BOON'],
  '모드맨': ['모드맨'],
  '바버': ['바버', 'BARBOUR'],
  '비이커': ['비이커'],
  '산드로옴므': ['산드로 옴므', '산드로옴므'],
  '솔리드옴므': ['솔리드옴므', '솔리드 옴므'],
  '송지오옴므': ['송지오'],
  '수트서플라이': ['수트서플라이', '수트 서플라이', 'SUITSUPPLY'],
  '스컬프스토어': ['스컬프'],
  '스톤아일랜드': ['스톤아일랜드', '스톤 아일랜드'],
  '슬로웨어': ['슬로웨어'],
  '시스템옴므': ['시스템옴므', '시스템 옴므'],
  '아스페시': ['아스페시'],
  '아이엠샵': ['아이엠샵'],
  '알레그리': ['알레그리'],
  '에잇디비젼': ['에잇디비젼', '8DIVISION'],
  '우영미': ['우영미', 'WOOYOUNGMI'],
  '이로맨': ['이로맨', '이로 남성'],
  '이스트로그(프레이트)': ['이스트로그', '프레이트'],
  '준지': ['준지', 'JUUN.J', 'JUUNJ'],
  '지오송지오': ['지오송지오'],
  '지제로': ['지제로'],
  '질스튜어트뉴욕': ['질스튜어트뉴욕'],
  '캡틴선샤인': ['캡틴선샤인'],
  '클럽모나코': ['클럽모나코'],
  '타임옴므': ['타임옴므'],
  '톰그레이하운드맨': ['톰그레이하운드'],
  '플랫폼플레이스': ['플랫폼플레이스'],
  '헤리티지플로스': ['헤리티지플로스', '헤리티지 플로스'],
};

function matchBrands(rawText) {
  // 공식 페이지가 브랜드명을 줄바꿈해서 내려주는 경우가 많다. 먼저 공백을
  // 정규화해야 "우치 포터리" 같은 제외 문구가 "포터리"로 잘못 잡히지 않는다.
  const upperText = String(rawText || '').replace(/\s+/g, ' ').toUpperCase();
  const MEN_MARKERS = ['남성', '맨즈', '옴므', "MEN'S", 'MENSWEAR', 'MENS', 'MEN'];
  const WOMEN_MARKERS = ['여성', '우먼즈', '팜므', "WOMEN'S", 'WOMENSWEAR', 'WOMENS', 'WOMEN', 'LADIES', '레이디스'];
  const EXCLUDE_PATTERNS = {
    '바버': ['바버샵', '바버숍', '마제스티바버샵', '마제스티 바버샵', '마제스티 바버숍'],
    'POTTERY': ['우치포터리', '우치 포터리', '포터리하우스', '포터리 하우스', 'POTTERY BARN'],
    '송지오옴므': ['송지오파리', '송지오 파리'],
    '아페쎄맨': [
      'A.P.C. 골프', 'A.P.C.골프', 'A.P.C골프', 'A.P.C 골프', '아페쎄골프', '아페쎄 골프',
      'CAFE A.P.C.', 'CAFE A.P.C',
    ],
    // 다른 브랜드 소개 문구에 "디자이너 우영미"처럼 이름만 언급되는 경우 (실제 매장 아님)
    '우영미': ['디자이너 우영미', '우영미의 하이앤드', '우영미의 하이엔드'],
  };

  function findAllMarkerPositions(text, markers, isMenSearch) {
    const positions = [];
    markers.forEach(marker => {
      let idx = text.indexOf(marker);
      while (idx !== -1) {
        const isInsideWomen = isMenSearch && (text.substring(Math.max(0, idx - 2), idx) === 'WO');
        if (!isInsideWomen) positions.push(idx);
        idx = text.indexOf(marker, idx + 1);
      }
    });
    return positions;
  }

  const menPositions = findAllMarkerPositions(upperText, MEN_MARKERS.map(m => m.toUpperCase()), true);
  const womenPositions = findAllMarkerPositions(upperText, WOMEN_MARKERS.map(m => m.toUpperCase()), false);

  const poisonedSpans = [];
  Object.values(EXCLUDE_PATTERNS).flat().forEach(excludeWord => {
    const upperExclude = excludeWord.toUpperCase();
    let idx = upperText.indexOf(upperExclude);
    while (idx !== -1) {
      poisonedSpans.push({ start: idx, end: idx + upperExclude.length });
      idx = upperText.indexOf(upperExclude, idx + 1);
    }
  });
  function isPoisoned(start, end) { return poisonedSpans.some(p => start < p.end && end > p.start); }

  const allMatches = [];
  Object.entries(BRAND_PATTERNS).forEach(([brand, patterns]) => {
    patterns.forEach(p => {
      const upperP = p.toUpperCase();
      let idx = upperText.indexOf(upperP);
      while (idx !== -1) {
        allMatches.push({ brand, start: idx, end: idx + upperP.length });
        idx = upperText.indexOf(upperP, idx + 1);
      }
    });
  });
  allMatches.sort((a, b) => (b.end - b.start) - (a.end - a.start));

  const claimed = [];
  function isOverlapping(start, end) { return claimed.some(c => start < c.end && end > c.start); }

  const MEN_MARKERS_UP = MEN_MARKERS.map(m => m.toUpperCase());
  const WOMEN_MARKERS_UP = WOMEN_MARKERS.map(m => m.toUpperCase());

  const found = new Set();
  allMatches.forEach(m => {
    if (isPoisoned(m.start, m.end)) return;
    if (isOverlapping(m.start, m.end)) return;
    claimed.push({ start: m.start, end: m.end });

    // 앞뒤가 둘 다 쉼표(사이 공백 허용)면 실제 매장 태그가 아니라 "관련/취급 브랜드 나열"
    // 목록(다른 편집숍의 소개 문구 등)에 이름만 섞여 나온 경우. 실제 매장 표기는 항상
    // 따옴표/태그로 감싸여 있어 양옆에 쉼표가 오지 않음.
    const beforeChar = upperText.substring(Math.max(0, m.start - 2), m.start).trimEnd().slice(-1);
    const afterChar = upperText.substring(m.end, m.end + 2).trimStart().slice(0, 1);
    if (beforeChar === ',' && afterChar === ',') return;

    // 브랜드명 바로 뒤에 성별 표기가 붙는 경우 (예: "DKNY(여성)") 최우선으로 반영.
    // 기존 로직은 마커가 브랜드명보다 "앞"에 있을 때만 인식해서 이런 케이스를 놓쳤음.
    const trailingWindow = upperText.substring(m.end, m.end + 10);
    const hasTrailingWomen = WOMEN_MARKERS_UP.some(w => trailingWindow.includes(w));
    if (hasTrailingWomen) return;
    const hasTrailingMen = MEN_MARKERS_UP.some(w => trailingWindow.includes(w));
    if (hasTrailingMen) { found.add(m.brand); return; }

    const lastMen = Math.max(-1, ...menPositions.filter(pos => pos <= m.start));
    const lastWomen = Math.max(-1, ...womenPositions.filter(pos => pos <= m.start));
    if (lastMen === -1 && lastWomen === -1) found.add(m.brand);
    else if (lastMen > lastWomen) found.add(m.brand);
  });
  return Array.from(found);
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchWithRetry(url, maxRetries) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (e) {
      lastError = e;
      console.log(`  재시도 ${attempt}/${maxRetries} (${url}): ${e.message}`);
      if (attempt < maxRetries) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function fetchLotteBrands(cstrCd, storeName) {
  const found = new Set();
  const candidateFlrCds = ['08', '07', '06', '05', '04', '03', '02', '01', 'B1', 'B2'];
  const townCd = 'C00401'; // ⚠️ 강남점 기준값, 다른 지점은 다를 수 있음
  let successfulPages = 0;
  let failedPages = 0;
  for (const flrCd of candidateFlrCds) {
    try {
      const url = `https://www.lotteshopping.com/store/floorDetailAjax?cstrCd=${cstrCd}&cstrTownCd=${townCd}&flrCd=${flrCd}`;
      const res = await fetchWithRetry(url, 2);
      const text = await res.text();
      successfulPages++;
      matchBrands(text).forEach(b => found.add(b));
      await sleep(300);
    } catch (e) {
      failedPages++;
      console.log(`롯데 ${cstrCd} ${flrCd}층 오류: ${e.message}`);
    }
  }

  // "백화점" 관 외에 에비뉴엘 등 별도 관이 있는 지점은 그 층들도 추가로 확인
  // (예: 부산본점은 cstrCd는 같고 cstrTownCd만 C00402로 다른 "에비뉴엘" 관에
  // 스톤아일랜드 등이 입점해 있는데, 기존엔 C00401만 봐서 놓치고 있었음)
  const extraTowns = LOTTE_EXTRA_TOWNS[storeName] || [];
  for (const { townCd: extraTownCd, floors } of extraTowns) {
    for (const flrCd of floors) {
      try {
        const url = `https://www.lotteshopping.com/store/floorDetailAjax?cstrCd=${cstrCd}&cstrTownCd=${extraTownCd}&flrCd=${flrCd}`;
        const res = await fetchWithRetry(url, 2);
        const text = await res.text();
        successfulPages++;
        matchBrands(text).forEach(b => found.add(b));
        await sleep(300);
      } catch (e) {
        failedPages++;
        console.log(`롯데 ${cstrCd} ${extraTownCd} ${flrCd}층 오류: ${e.message}`);
      }
    }
  }

  const expectedPages = candidateFlrCds.length + extraTowns.reduce((sum, town) => sum + town.floors.length, 0);
  if (successfulPages === 0) throw new Error(`모든 층 호출 실패 (${failedPages}/${expectedPages})`);
  return { found: Array.from(found), successfulPages, failedPages, expectedPages };
}

let lastHyundaiText = null;
let lastHyundaiStore = null;

async function fetchHyundaiBrands(storeName, branchCd) {
  const url = `https://www.ehyundai.com/newPortal/DP/FG/FG000000_V.do?branchCd=${branchCd}`;
  const res = await fetchWithRetry(url, 2);
  const text = await res.text();
  let suspiciousDuplicate = false;
  if (lastHyundaiText !== null && text.substring(0, 3000) === lastHyundaiText.substring(0, 3000)) {
    suspiciousDuplicate = true;
    console.log(`⚠ 현대 ${storeName}: 이전 지점(${lastHyundaiStore})과 내용이 의심스럽게 동일`);
  }
  lastHyundaiText = text;
  lastHyundaiStore = storeName;
  return { found: matchBrands(text), suspiciousDuplicate, successfulPages: 1, failedPages: 0, expectedPages: 1 };
}

async function fetchShinsegaeBrands(storeCd) {
  const url = `https://www.shinsegae.com/store/floor.do?storeCd=${storeCd}`;
  const res = await fetchWithRetry(url, 3);
  const text = await res.text();
  return { found: matchBrands(text), successfulPages: 1, failedPages: 0, expectedPages: 1 };
}

function buildJobList() {
  return CONFIG.storeRows.map(store => ({
    type: store.company === '롯데' ? 'lotte' : store.company === '현대' ? 'hyundai' : 'shinsegae',
    company: store.company, store: store.name, storeId: store.id, code: store.code,
  }));
}

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return fallback; }
}

function normalizeRow(row) {
  const store = CONFIG.normalizeStoreName(row.company, row.store);
  return { ...row, store, storeId: row.storeId || CONFIG.storeId(row.company, store) };
}

function isObserved(row) {
  return !['(확인된 브랜드 없음)', '(오류)'].includes(row.brand) &&
    !/(퇴점|누락)/.test(row.note || '') && row.dataQuality !== 'stale';
}

function observedSet(rows) {
  return new Set(rows.filter(isObserved).map(CONFIG.rowKey));
}

function isPresent(row) {
  return !['(확인된 브랜드 없음)', '(오류)'].includes(row.brand) && !/(퇴점|누락)/.test(row.note || '');
}

function presenceSet(rows) {
  return new Set(rows.filter(isPresent).map(CONFIG.rowKey));
}

function additionNote(key, monthStartSet, previousObserved) {
  if (monthStartSet.has(key)) return '확인';
  return previousObserved.has(key) ? '이번 달 신규 입점' : '신규 입점 재확인 중';
}

function exitNote(key, previousObserved) {
  return previousObserved.has(key) ? '퇴점 재확인 중' : '이번 달 퇴점';
}

function companyQualityIssue(company, prevCount, freshCount, staleStores, companyStores) {
  if (prevCount > 0 && freshCount < prevCount * 0.7 && staleStores >= 2) {
    return `${company} 수집 품질 게이트 실패: 정상 ${freshCount}/${prevCount}, 이상 지점 ${staleStores}/${companyStores}`;
  }
  return '';
}

function koreaDateKey(date) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function loadMonthStartRows(now, fallbackRows) {
  const monthKey = koreaDateKey(now).slice(0, 7);
  const comparisonMonth = previousMonthKey(monthKey);
  const historyDir = path.join(__dirname, 'history');
  const snapshots = readJson(path.join(historyDir, 'index.json'), [])
    .filter(key => key.slice(0, 7) === comparisonMonth && /^\d{4}-\d{2}(-\d{2})?$/.test(key))
    .sort()
    .reverse();
  for (const snapshot of snapshots) {
    const payload = readJson(path.join(historyDir, `${snapshot}.json`), null);
    if (isReliable(payload)) return { source: snapshot, rows: (payload.data || []).map(normalizeRow) };
  }
  return { source: `${comparisonMonth} 비교자료 없음`, rows: fallbackRows };
}

function loadReviewDecisions() {
  const payload = readJson(path.join(__dirname, 'review-decisions.json'), { decisions: [] });
  const decisions = new Map();
  (payload.decisions || []).forEach(item => {
    const normalized = normalizeRow(item);
    decisions.set(item.key || CONFIG.rowKey(normalized), { ...item, ...normalized });
  });
  return decisions;
}

async function main() {
  const jobs = buildJobList();
  const now = new Date();
  const monthKey = koreaDateKey(now).slice(0, 7);
  const dataPath = path.join(__dirname, 'data.json');
  const previousPayload = readJson(dataPath, { data: [] });
  const previousRows = (previousPayload.data || []).map(normalizeRow);
  const previousObserved = observedSet(previousRows);
  const reviews = loadReviewDecisions();
  const diagnostics = [];
  let results = [];

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const previousStoreRows = previousRows.filter(r => r.storeId === job.storeId && isPresent(r));
    try {
      let crawlResult;
      if (job.type === 'lotte') crawlResult = await fetchLotteBrands(job.code, job.store);
      else if (job.type === 'hyundai') crawlResult = await fetchHyundaiBrands(job.store, job.code);
      else crawlResult = await fetchShinsegaeBrands(job.code);

      const note = crawlResult.suspiciousDuplicate ? '캐시 의심 - 수동 재확인 필요' : '확인';
      const suspiciousEmpty = crawlResult.found.length === 0 && previousStoreRows.length > 0;
      const partialFailure = crawlResult.failedPages > 0;
      const preservePrevious = previousStoreRows.length > 0 && (suspiciousEmpty || partialFailure || crawlResult.suspiciousDuplicate);
      diagnostics.push({
        storeId: job.storeId, company: job.company, store: job.store,
        status: preservePrevious ? 'stale' : partialFailure ? 'partial' : 'ok', brands: crawlResult.found.length,
        successfulPages: crawlResult.successfulPages, failedPages: crawlResult.failedPages,
        expectedPages: crawlResult.expectedPages,
      });

      if (preservePrevious) {
        previousStoreRows.forEach(r => results.push({
          ...r, store: job.store, storeId: job.storeId,
          note: '수집 지연 - 직전 정상값 유지', dataQuality: 'stale',
        }));
      } else if (crawlResult.found.length === 0) {
        results.push({ company: job.company, store: job.store, storeId: job.storeId, brand: '(확인된 브랜드 없음)', sales: '', note });
      } else {
        crawlResult.found.forEach(brand => results.push({ company: job.company, store: job.store, storeId: job.storeId, brand, sales: '', note }));
      }
      console.log(`[${i + 1}/${jobs.length}] ${job.company} ${job.store}: ${crawlResult.found.length}개 브랜드 확인`);
    } catch (e) {
      diagnostics.push({ storeId: job.storeId, company: job.company, store: job.store, status: 'error', error: String(e.message) });
      if (previousStoreRows.length) {
        previousStoreRows.forEach(r => results.push({ ...r, store: job.store, storeId: job.storeId, note: '수집 오류 - 직전 정상값 유지', dataQuality: 'stale' }));
      } else {
        results.push({ company: job.company, store: job.store, storeId: job.storeId, brand: '(오류)', sales: '', note: String(e.message) });
      }
      console.log(`[${i + 1}/${jobs.length}] ${job.company} ${job.store} 오류: ${e.message}`);
    }
    await sleep(500);
  }

  // 사이트 구조상 자동 매칭이 어려운, 사람이 직접 확인한 상시 예외.
  const MANUAL_CONFIRMED = [
    { company: '롯데', store: '본점', brand: '바버' },
    { company: '신세계', store: '강남', brand: 'POTTERY' },
  ].map(normalizeRow);
  MANUAL_CONFIRMED.forEach(row => {
    if (!results.some(r => CONFIG.rowKey(r) === CONFIG.rowKey(row))) results.push({ ...row, sales: '', note: '확인' });
  });

  const legacyRejected = [
    ['신세계','대전','이로맨'], ['현대','천호','POTTERY'], ['현대','목동','POTTERY'], ['현대','울산','POTTERY'],
    ['신세계','대구','아스페시'], ['신세계','강남','아스페시'], ['신세계','본점','아스페시'], ['현대','목동','아스페시'],
    ['신세계','하남','우영미'], ['롯데','동탄점','아페쎄맨'], ['롯데','잠실점','아페쎄맨'], ['신세계','광주','아페쎄맨'],
    ['현대','본점','아페쎄맨'], ['신세계','대전','아페쎄맨'], ['현대','여의도','아페쎄맨'], ['현대','미아','DKNY맨'],
    ['롯데','잠실점','CP컴퍼니'],
  ].map(([company, store, brand]) => CONFIG.rowKey(normalizeRow({ company, store, brand })));
  const rejected = new Set(legacyRejected);
  reviews.forEach((decision, key) => { if (decision.decision === 'reject') rejected.add(key); });
  results = results.map(normalizeRow).filter(row => !rejected.has(CONFIG.rowKey(row)));

  // 한 회사가 통째로 비거나 급락한 날은 직전 정상값을 유지하고 저하 상태로 게시한다.
  const qualityIssues = [];
  for (const company of ['롯데', '현대', '신세계']) {
    const prevCount = previousRows.filter(r => r.company === company && isObserved(r)).length;
    const freshCount = results.filter(r => r.company === company && isObserved(r)).length;
    const staleStores = diagnostics.filter(d => d.company === company && d.status !== 'ok').length;
    const companyStores = jobs.filter(j => j.company === company).length;
    const issue = companyQualityIssue(company, prevCount, freshCount, staleStores, companyStores);
    if (issue) qualityIssues.push(issue);
  }

  const monthStart = loadMonthStartRows(now, previousRows);
  const monthStartRows = monthStart.rows.map(normalizeRow);
  const monthStartSet = observedSet(monthStartRows);
  const currentSet = presenceSet(results);

  results = results.map(row => {
    const key = CONFIG.rowKey(row);
    const review = reviews.get(key);
    // 사용자가 실제 입점을 확인한 조합은 외부 사이트가 일시적으로 지연돼도
    // 다시 수집 지연/재확인 대상으로 되돌리지 않는다.
    if (review && review.decision === 'confirm' && isPresent(row)) {
      return { ...row, note: '확인됨(검토)', dataQuality: 'manual', reviewedAt: review.reviewedAt || '' };
    }
    if (!isObserved(row)) return row;
    if (!monthStartSet.has(key)) {
      return { ...row, note: additionNote(key, monthStartSet, previousObserved), changeMonth: monthKey };
    }
    return row;
  });

  monthStartSet.forEach(key => {
    if (currentSet.has(key) || rejected.has(key)) return;
    const source = monthStartRows.find(row => CONFIG.rowKey(row) === key);
    if (!source) return;
    const review = reviews.get(key);
    if (review && review.decision === 'confirm') {
      results.push({ ...source, sales: '', note: '확인됨(검토)', dataQuality: 'manual', reviewedAt: review.reviewedAt || '' });
      return;
    }
    results.push({
      company: source.company, store: source.store, storeId: source.storeId, brand: source.brand, sales: '',
      note: exitNote(key, previousObserved), changeMonth: monthKey,
    });
  });

  const finalResults = results.map(r => {
    if (['(확인된 브랜드 없음)', '(오류)'].includes(r.brand)) return r;
    const comparisonCheck = monthStartSet.has(CONFIG.rowKey(r))
      ? `${monthStart.source} 입점`
      : `${monthStart.source} 미입점`;
    const { baselineCheck, ...clean } = r;
    return { ...clean, comparisonCheck };
  });

  const output = {
    lastUpdated: now.toISOString(),
    comparisonAsOf: monthStart.source,
    monthKey,
    monthStartSnapshot: monthStart.source,
    monthlySummary: {
      new: finalResults.filter(r => r.note === '이번 달 신규 입점').length,
      exit: finalResults.filter(r => r.note === '이번 달 퇴점').length,
      pending: finalResults.filter(r => (r.note || '').includes('재확인 중')).length,
      stale: finalResults.filter(r => r.dataQuality === 'stale').length,
    },
    health: { status: qualityIssues.length ? 'degraded' : 'ok', issues: qualityIssues },
    diagnostics,
    data: finalResults,
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(output, null, 2), 'utf8');

  // 일별 스냅샷 저장 (history/YYYY-MM-DD.json + 목록 파일).
  // 예전엔 월별(YYYY-MM) 키였지만 크롤러가 매일 도는데 같은 달엔 계속 같은
  // 파일에 덮어써져 일별 변화가 히스토리에 안 남는 문제가 있어 일별로 변경.
  // 기존 월별 스냅샷 파일은 그대로 두고(과거 기록 보존), 새로 쌓이는 것부터 일별로 저장.
  const historyDir = path.join(__dirname, 'history');
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir);
  const dayKey = koreaDateKey(now);
  fs.writeFileSync(path.join(historyDir, `${dayKey}.json`), JSON.stringify(output, null, 2), 'utf8');

  const indexPath = path.join(historyDir, 'index.json');
  let snapshots = [];
  if (fs.existsSync(indexPath)) {
    try { snapshots = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) { snapshots = []; }
  }
  if (!snapshots.includes(dayKey)) snapshots.push(dayKey);
  snapshots.sort();
  fs.writeFileSync(indexPath, JSON.stringify(snapshots, null, 2), 'utf8');
  writeMonthlyArchive(historyDir, path.join(__dirname, 'monthly-archive.json'));

  console.log(`\n완료: ${finalResults.length}건 저장 (data.json, history/${dayKey}.json, monthly-archive.json)`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('크롤러 실행 중 오류:', e);
    process.exit(1);
  });
}

module.exports = { matchBrands, normalizeRow, isObserved, isPresent, observedSet, presenceSet, additionNote, exitNote, companyQualityIssue, koreaDateKey, loadMonthStartRows, buildJobList };
