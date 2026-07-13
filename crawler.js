/**
 * 남성 컨템포러리/디자이너 브랜드 37종 — 3사 45개 지점 입점 현황 크롤러 (Node.js판)
 * GitHub Actions에서 실행되며, GAS 버전과 동일한 매칭 로직을 그대로 씁니다.
 * GAS의 6분 실행 제한이 없어서 체크포인트/트리거 로직이 필요 없습니다.
 */

const fs = require('fs');
const path = require('path');

const LOTTE_STORES = {
  '강남점': '0013', '광복점': '0333', '광주점': '0007', '노원점': '0022',
  '대구점': '0023', '동탄점': '0399', '본점': '0001', '부산본점': '0005',
  '수원점': '0349', '영등포': '0010', '울산점': '0015', '인천점': '0344',
  '일산': '0011', '잠실점': '0002', '잠실에비뉴엘': '0348', '전주점': '0025',
  '창원점': '0017', '청량리': '0004', '평촌점': '0341',
};

const HYUNDAI_STORES = {
  '목동': 'B00142000', '무역센터': 'B00122000', '미아': 'B00141000',
  '본점': 'B00121000', '신촌': 'B00127000', '여의도': 'B00140000',
  '울산': 'B00129000', '중동': 'B00143000', '천호': 'B00126000',
  '충청': 'B00147000', '킨텍스': 'B00145000', '판교': 'B00148000',
  '대구': 'B00146000',
};

const SHINSEGAE_STORES = {
  '강남': 'SC00002', '광주': 'SC00006', '김해': 'SC00011',
  '대구': 'SC00013', '대전': 'SC00060', '마산': 'SC00005',
  '본점': 'SC00001', '센텀': 'SC00008', '의정부': 'SC00010',
  '천안아산': 'SC00009', '타임스퀘어': 'SC00003', '하남': 'SC00012',
  '경기': 'SC00007',
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
  '수트서플라이': ['수트서플라이', 'SUITSUPPLY'],
  '스컬프스토어': ['스컬프'],
  '스톤아일랜드': ['스톤아일랜드'],
  '슬로웨어': ['슬로웨어'],
  '시스템옴므': ['시스템옴므', '시스템 옴므'],
  '아스페시': ['아스페시'],
  '아이엠샵': ['아이엠샵'],
  '알레그리': ['알레그리'],
  '에잇디비젼': ['에잇디비젼', '8DIVISION'],
  '우영미': ['우영미', 'WOOYOUNGMI'],
  '이로맨': ['이로맨'],
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
  '헤리티지플로스': ['헤리티지플로스'],
};

function matchBrands(rawText) {
  const upperText = rawText.toUpperCase();
  const MEN_MARKERS = ['남성', '맨즈', '옴므', "MEN'S", 'MENSWEAR', 'MENS', 'MEN'];
  const WOMEN_MARKERS = ['여성', '우먼즈', '팜므', "WOMEN'S", 'WOMENSWEAR', 'WOMENS', 'WOMEN', 'LADIES', '레이디스'];
  const EXCLUDE_PATTERNS = {
    '바버': ['바버샵', '마제스티바버샵', '마제스티 바버샵'],
    'POTTERY': ['우치포터리', '포터리하우스'],
    '아페쎄맨': [
      'A.P.C. 골프', 'A.P.C.골프', 'A.P.C골프', 'A.P.C 골프', '아페쎄골프', '아페쎄 골프',
      'CAFE A.P.C.', 'CAFE A.P.C',
    ],
    // 다른 브랜드 소개 문구에 "디자이너 우영미"처럼 이름만 언급되는 경우 (실제 매장 아님)
    '우영미': ['디자이너 우영미', '우영미의 하이앤드', '우영미의 하이엔드'],
  };

  // 남성/여성 라인이 같이 있어서 문서 전체 범위의 "가장 가까운 마커" 방식으로는
  // 오탐이 잦은 브랜드. 이 브랜드들은 매칭 지점 바로 근처(전후 NEAR_WINDOW자)에
  // 남성 마커가 확실히 있을 때만 인정하고, 없으면 포함하지 않는다 (기존 브랜드들의
  // "문서 전체에서 가장 가까운 마커" 로직은 그대로 유지).
  const AMBIGUOUS_BRANDS = new Set(['아페쎄맨', 'POTTERY', 'DKNY맨', '아스페시', 'CP컴퍼니']);
  const NEAR_WINDOW = 400;

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

    if (AMBIGUOUS_BRANDS.has(m.brand)) {
      const nearBefore = upperText.substring(Math.max(0, m.start - NEAR_WINDOW), m.start);
      const nearAfter = upperText.substring(m.end, m.end + NEAR_WINDOW);
      const nearHasWomen = WOMEN_MARKERS_UP.some(w => nearBefore.includes(w) || nearAfter.includes(w));
      if (nearHasWomen) return;
      const nearHasMen = MEN_MARKERS_UP.some(w => nearBefore.includes(w) || nearAfter.includes(w));
      if (nearHasMen) found.add(m.brand);
      return;
    }

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
      return res;
    } catch (e) {
      lastError = e;
      console.log(`  재시도 ${attempt}/${maxRetries} (${url}): ${e.message}`);
      if (attempt < maxRetries) await sleep(1500 * attempt);
    }
  }
  throw lastError;
}

async function fetchLotteBrands(cstrCd) {
  const found = new Set();
  const candidateFlrCds = ['08', '07', '06', '05', '04', '03', '02', '01', 'B1', 'B2'];
  const townCd = 'C00401'; // ⚠️ 강남점 기준값, 다른 지점은 다를 수 있음
  for (const flrCd of candidateFlrCds) {
    try {
      const url = `https://www.lotteshopping.com/store/floorDetailAjax?cstrCd=${cstrCd}&cstrTownCd=${townCd}&flrCd=${flrCd}`;
      const res = await fetchWithRetry(url, 2);
      if (!res.ok) continue;
      const text = await res.text();
      matchBrands(text).forEach(b => found.add(b));
      await sleep(300);
    } catch (e) {
      console.log(`롯데 ${cstrCd} ${flrCd}층 오류: ${e.message}`);
    }
  }
  return found;
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
  return { found: matchBrands(text), suspiciousDuplicate };
}

async function fetchShinsegaeBrands(storeCd) {
  const url = `https://www.shinsegae.com/store/floor.do?storeCd=${storeCd}`;
  const res = await fetchWithRetry(url, 3);
  const text = await res.text();
  return matchBrands(text);
}

function buildJobList() {
  const jobs = [];
  Object.entries(LOTTE_STORES).forEach(([name, code]) => jobs.push({ type: 'lotte', company: '롯데', store: name, code }));
  Object.entries(HYUNDAI_STORES).forEach(([name, code]) => jobs.push({ type: 'hyundai', company: '현대', store: name, code }));
  Object.entries(SHINSEGAE_STORES).forEach(([name, code]) => jobs.push({ type: 'shinsegae', company: '신세계', store: name, code }));
  return jobs;
}

async function main() {
  const jobs = buildJobList();
  const results = [];

  // 직전 크롤링 결과 (신규 입점 / 누락·철수 후보 판정용)
  const dataPath = path.join(__dirname, 'data.json');
  const prevSet = new Set();
  if (fs.existsSync(dataPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
      (prev.data || []).forEach(r => {
        if (r.brand !== '(확인된 브랜드 없음)' && r.brand !== '(오류)') {
          prevSet.add(`${r.company}|${r.store}|${r.brand}`);
        }
      });
    } catch (e) {
      console.log(`이전 data.json 읽기 실패 (신규/누락 비교 생략): ${e.message}`);
    }
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    try {
      let brands = [];
      let note = '확인';

      if (job.type === 'lotte') {
        brands = Array.from(await fetchLotteBrands(job.code));
      } else if (job.type === 'hyundai') {
        const r = await fetchHyundaiBrands(job.store, job.code);
        brands = r.found;
        if (r.suspiciousDuplicate) note = '캐시 의심 - 수동 재확인 필요';
      } else if (job.type === 'shinsegae') {
        brands = await fetchShinsegaeBrands(job.code);
      }

      if (brands.length === 0) {
        results.push({ company: job.company, store: job.store, brand: '(확인된 브랜드 없음)', sales: '', note });
      } else {
        brands.forEach(b => {
          let brandNote = note;
          if (brandNote === '확인' && !prevSet.has(`${job.company}|${job.store}|${b}`)) {
            brandNote = '신규 입점 가능성';
          }
          results.push({ company: job.company, store: job.store, brand: b, sales: '', note: brandNote });
        });
      }
      console.log(`[${i + 1}/${jobs.length}] ${job.company} ${job.store}: ${brands.length}개 브랜드 확인`);
    } catch (e) {
      results.push({ company: job.company, store: job.store, brand: '(오류)', sales: '', note: String(e.message) });
      console.log(`[${i + 1}/${jobs.length}] ${job.company} ${job.store} 오류: ${e.message}`);
    }
    await sleep(500);
  }

  // 직전엔 있었는데 이번엔 발견되지 않은 조합 → 누락/철수 후보로 추가
  const newSet = new Set(
    results
      .filter(r => r.brand !== '(확인된 브랜드 없음)' && r.brand !== '(오류)')
      .map(r => `${r.company}|${r.store}|${r.brand}`)
  );
  prevSet.forEach(key => {
    if (!newSet.has(key)) {
      const [company, store, brand] = key.split('|');
      results.push({ company, store, brand, sales: '', note: '누락/철수 가능성' });
    }
  });

  // baseline.json 대비 비교. baseline.json은 "정답"이 아니라 특정 시점(asOf)에
  // 수기로 확인해둔 스냅샷일 뿐이며, 시간이 지날수록 실제 현황과 자연히 벌어질 수 있음.
  const baselinePath = path.join(__dirname, 'baseline.json');
  let baselineSet = null;
  let baselineAsOf = '';
  if (fs.existsSync(baselinePath)) {
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    baselineAsOf = baseline.asOf || '';
    baselineSet = new Set((baseline.data || []).map(t => `${t.company}|${t.store}|${t.brand}`));
  }

  const finalResults = results.map(r => {
    let baselineCheck = '';
    if (baselineSet) {
      const key = `${r.company}|${r.store}|${r.brand}`;
      if (r.brand !== '(확인된 브랜드 없음)' && r.brand !== '(오류)') {
        baselineCheck = baselineSet.has(key) ? '일치' : `⚠ ${baselineAsOf} 데이터엔 없음`;
      }
    } else {
      baselineCheck = '비교불가(baseline.json 없음)';
    }
    return { ...r, baselineCheck };
  });

  const output = {
    lastUpdated: new Date().toISOString(),
    baselineAsOf,
    data: finalResults,
  };

  fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify(output, null, 2), 'utf8');

  // 월별 스냅샷 저장 (history/YYYY-MM.json + 목록 파일)
  const historyDir = path.join(__dirname, 'history');
  if (!fs.existsSync(historyDir)) fs.mkdirSync(historyDir);
  const monthKey = output.lastUpdated.slice(0, 7);
  fs.writeFileSync(path.join(historyDir, `${monthKey}.json`), JSON.stringify(output, null, 2), 'utf8');

  const indexPath = path.join(historyDir, 'index.json');
  let months = [];
  if (fs.existsSync(indexPath)) {
    try { months = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch (e) { months = []; }
  }
  if (!months.includes(monthKey)) months.push(monthKey);
  months.sort();
  fs.writeFileSync(indexPath, JSON.stringify(months, null, 2), 'utf8');

  console.log(`\n완료: ${finalResults.length}건 저장 (data.json, history/${monthKey}.json)`);
}

main().catch(e => {
  console.error('크롤러 실행 중 오류:', e);
  process.exit(1);
});
