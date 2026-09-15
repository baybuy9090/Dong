// 브랜드별 뉴스 크롤러 — 구글 뉴스 RSS + 네이버 뉴스 검색 API에서 브랜드별 최신 기사를
// 모아 news.json으로 저장. 매일 오전(KST) GitHub Actions로 자동 실행됨
// (.github/workflows/news.yml). 네이버는 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET
// 환경변수(GitHub Secrets)가 설정된 경우에만 수집하고, 없으면 구글만 사용.
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID || '';
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET || '';

// 실제 매장 리스트에 쓰이는 브랜드명 그대로 검색하면 결과가 안 나오거나(내부 표기용 이름)
// 너무 짧아 무관한 기사가 섞이는 브랜드가 있어, 그런 경우만 검색용 키워드를 따로 지정.
const NEWS_QUERY_OVERRIDES = {
  '아페쎄맨': '아페쎄 옴므',
  'DKNY맨': 'DKNY',
  '띠어리맨': '띠어리 옴므',
  '이로맨': '"IRO" 패션',
  '준지': 'JUUN.J',
  '이스트로그(프레이트)': '이스트로그 프레이트',
  '톰그레이하운드맨': '톰그레이하운드',
  'PAF': 'PAF 브랜드',
  'POTTERY': '포터리',
};

const EXPANDED_NEWS_QUERIES = {
  '\uC544\uD398\uC138\uB9E8': ['\uC544\uD398\uC138 \uC634\uBBF4 \uD328\uC158', 'A.P.C. \uB0A8\uC131 \uD328\uC158'],
  'DKNY\uB9E8': ['DKNY \uD328\uC158 \uBE0C\uB79C\uB4DC'],
  '\uB760\uC5B4\uB9AC\uB9E8': ['\uB760\uC5B4\uB9AC \uC634\uBBF4 \uD328\uC158', 'Theory \uB0A8\uC131 \uD328\uC158'],
  '\uC774\uB85C\uB9E8': ['IRO \uD328\uC158 \uBE0C\uB79C\uB4DC'],
  '\uC900\uC9C0': ['JUUN.J \uD328\uC158', '\uC900\uC9C0 \uD328\uC158'],
  '\uC774\uC2A4\uD2B8\uB85C\uADF8(\uD504\uB808\uC774\uD2B8)': ['\uC774\uC2A4\uD2B8\uB85C\uADF8 \uD328\uC158', '\uD504\uB808\uC774\uD2B8 \uD328\uC158'],
  '\uD1B0\uADF8\uB808\uC774\uD558\uC6B4\uB4DC\uB9E8': ['\uD1B0\uADF8\uB808\uC774\uD558\uC6B4\uB4DC \uD328\uC158'],
  'CP\uCEF4\uD37C\uB2C8': [
    'C.P. \uCEF4\uD37C\uB2C8 \uD328\uC158', 'CP\uCEF4\uD37C\uB2C8 \uD328\uC158',
    'C.P. COMPANY \uD328\uC158', 'CP COMPANY \uD328\uC158',
  ],
  'PAF': ['PAF \uD328\uC158 \uBE0C\uB79C\uB4DC', '\uD3EC\uC2A4\uD2B8\uC544\uCE74\uC774\uBE0C\uD329\uC158'],
  'POTTERY': ['POTTERY \uD328\uC158 \uBE0C\uB79C\uB4DC', '\uD3EC\uD130\uB9AC \uC758\uB958 \uBE0C\uB79C\uB4DC'],
  'TEN-C': ['TEN-C \uD328\uC158 \uBE0C\uB79C\uB4DC'],
  '\uD50C\uB7AB\uD3FC\uD50C\uB808\uC774\uC2A4': ['\uD50C\uB7AB\uD3FC\uD50C\uB808\uC774\uC2A4 \uD328\uC158'],
  '\uC5D0\uC787\uB514\uBE44\uC83C': ['\uC5D0\uC787\uB514\uBE44\uC83C \uD328\uC158', '8DIVISION \uD328\uC158'],
  '\uBAA8\uB4DC\uB9E8': ['\uBAA8\uB4DC\uB9E8 \uD3B8\uC9D1\uC20D'],
  '\uC2A4\uCEEC\uD504\uC2A4\uD1A0\uC5B4': ['\uC2A4\uCEEC\uD504\uC2A4\uD1A0\uC5B4 \uD328\uC158'],
  '\uC544\uC774\uC5E0\uC0F5': ['\uC544\uC774\uC5E0\uC0F5 \uD328\uC158 \uD3B8\uC9D1\uC20D'],
  '\uB9E8\uBA54\uC774\uB4DC\uCE74\uD398': ['\uB9E8\uBA54\uC774\uB4DC \uB3C4\uC0B0 \uD328\uC158'],
};

const NEWS_BRAND_ALIASES = {
  '\uC544\uD398\uC138\uB9E8': ['\uC544\uD398\uC138', 'A.P.C.'],
  'DKNY\uB9E8': ['DKNY'],
  '\uB760\uC5B4\uB9AC\uB9E8': ['\uB760\uC5B4\uB9AC', 'THEORY'],
  '\uC774\uB85C\uB9E8': ['IRO'],
  '\uC900\uC9C0': ['\uC900\uC9C0', 'JUUN.J'],
  '\uC774\uC2A4\uD2B8\uB85C\uADF8(\uD504\uB808\uC774\uD2B8)': ['\uC774\uC2A4\uD2B8\uB85C\uADF8', '\uD504\uB808\uC774\uD2B8'],
  '\uD1B0\uADF8\uB808\uC774\uD558\uC6B4\uB4DC\uB9E8': ['\uD1B0\uADF8\uB808\uC774\uD558\uC6B4\uB4DC'],
  'CP\uCEF4\uD37C\uB2C8': [
    'CP\uCEF4\uD37C\uB2C8', 'C.P.\uCEF4\uD37C\uB2C8', 'C.P. \uCEF4\uD37C\uB2C8',
    'C.P. COMPANY', 'CP COMPANY', 'C.P.COMPANY',
  ],
  'PAF': ['PAF', '\uD3EC\uC2A4\uD2B8\uC544\uCE74\uC774\uBE0C\uD329\uC158'],
  'POTTERY': ['POTTERY', '\uD3EC\uD130\uB9AC'],
  '\uC5D0\uC787\uB514\uBE44\uC83C': ['\uC5D0\uC787\uB514\uBE44\uC83C', '8DIVISION'],
  '\uB9E8\uBA54\uC774\uB4DC\uCE74\uD398': ['\uB9E8\uBA54\uC774\uB4DC'],
};

const POTTERY_NOISE = ['\uC18D\uCD08', '\uB9DB\uC9D1', '\uB3C4\uC790\uAE30', '\uB3C4\uC608', '\uC694\uC7A5', '\uADF8\uB987', '\uC138\uB77C\uBBF9', '\uC5EC\uC8FC \uC5EC\uD589', '\uC5EC\uC8FC\uC2DC', '\uB7F0\uB358 \uD3EC\uD130\uB9AC', 'LONDON POTTERY', 'POTTERY BARN', '\uBA54\uB9AC\uC5B4\uD2B8', '\uD638\uD154', '\uBCA0\uD2B8\uB0A8 \uC804\uD1B5'];
const BRAND_NOISE_TERMS = {
  '\uBC14\uBC84': ['\uBC14\uBC84 \uC544\uB2E4\uC9C0\uC624', '\uC5D8\uB80C \uBC14\uBC84', '\uC721\uC0C1', '\uD5C8\uB4E4', '\uCF54\uCE58'],
  '\uC54C\uB808\uADF8\uB9AC': ['\uAC10\uB3C5', '\uB098\uD3F4\uB9AC', '\uC138\uB9AC\uC5D0', '\uCD95\uAD6C', '\uC720\uBCA4\uD22C\uC2A4', 'AC\uBC00\uB780'],
};
const AMBIGUOUS_BRAND_TITLE_CONTEXT = {
  '\uBC14\uBC84': ['\uD328\uC158', '\uBE0C\uB79C\uB4DC', '\uCEEC\uB809\uC158', '\uD611\uC5C5', '\uC218\uC785', 'FW', '\uB9E4\uC7A5', '\uC720\uD1B5', '\uBC31\uD654\uC810'],
};

const BRANDS = CONFIG.brands;

// 업계 전체 동향 카드 (특정 브랜드가 아닌 일반 검색어)
const INDUSTRY_QUERIES = ['남성 컨템포러리', '맨즈 컨템포러리'];

const ARTICLES_PER_BRAND = 8;
const INDUSTRY_ARTICLES = 8;
const NEWS_WINDOW_DAYS = 60;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, '');
}

// ── 구글 뉴스 RSS ──
function parseGoogleItems(xml) {
  const items = [];
  const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  itemBlocks.forEach(block => {
    const titleMatch = block.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = block.match(/<link>([\s\S]*?)<\/link>/);
    const pubDateMatch = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const descriptionMatch = block.match(/<description>([\s\S]*?)<\/description>/);
    if (!titleMatch || !linkMatch) return;
    let title = decodeEntities(titleMatch[1]).trim();
    const source = sourceMatch ? decodeEntities(sourceMatch[1]).trim() : '';
    if (source && title.endsWith(' - ' + source)) {
      title = title.slice(0, title.length - (' - ' + source).length);
    }
    items.push({
      title,
      link: linkMatch[1].trim(),
      source,
      pubDate: pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : null,
      _desc: descriptionMatch ? decodeEntities(stripTags(descriptionMatch[1])).trim() : '',
    });
  });
  return items;
}

async function fetchGoogleNews(query) {
  // 띄어쓰기 없는 단일어는 따옴표로 감싸 정확히 일치하는 기사만 (노이즈 방지).
  // 여러 단어로 조합한 검색어는 따옴표를 걸면 그 문구 그대로 나온 기사만 찾게 되어
  // 결과가 0건에 가까워지므로 그대로 검색.
  const q = query.includes(' ') ? query : `"${query}"`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const xml = await res.text();
  return parseGoogleItems(xml);
}

// ── 네이버 뉴스 검색 API (공식, 키 필요) ──
function sourceFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return '네이버뉴스';
  }
}

async function fetchNaverNews(query) {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) return [];
  // 구글과 달리 따옴표 문구검색을 지원하지 않으므로 그대로 검색.
  const q = query.replace(/"/g, '');
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(q)}&display=20&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': NAVER_CLIENT_ID,
      'X-Naver-Client-Secret': NAVER_CLIENT_SECRET,
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  return (json.items || []).map(item => {
    const link = item.originallink || item.link;
    return {
      title: decodeEntities(stripTags(item.title || '')).trim(),
      link,
      source: sourceFromUrl(link),
      pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : null,
      // 관련성 필터링에만 쓰고 최종 저장 전에 제거하는 임시 필드
      _desc: decodeEntities(stripTags(item.description || '')).trim(),
    };
  });
}

async function fetchAllSources(query) {
  const all = [];
  const sources = { google: false, naver: NAVER_CLIENT_ID && NAVER_CLIENT_SECRET ? false : null };
  try {
    all.push(...await fetchGoogleNews(query));
    sources.google = true;
  } catch (e) {
    console.error(`  [구글: ${query}] 수집 실패:`, e.message);
  }
  try {
    all.push(...await fetchNaverNews(query));
    if (sources.naver !== null) sources.naver = true;
  } catch (e) {
    console.error(`  [네이버: ${query}] 수집 실패:`, e.message);
  }
  // 같은 기사가 두 소스에 다 걸리는 경우가 있어 제목 기준으로 중복 제거
  const seen = new Set();
  const items = all.filter(a => {
    const key = a.title.replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { items, sources, succeeded: Object.values(sources).some(value => value === true) };
}

// 최근 수집 기간 이내 기사만 남기고 최신순 정렬한다.
function filterRecentAndSort(items) {
  const cutoff = Date.now() - NEWS_WINDOW_DAYS * 86400000;
  return items
    .filter(a => a.pubDate && new Date(a.pubDate).getTime() >= cutoff)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// 한글 완성형 음절 또는 영문자/숫자는 "단어를 구성하는 문자"로 취급.
// 예: "바버숍페라"에서 "바버" 뒤에 오는 "숍"은 단어 구성 문자이므로 그 자리는
// 매칭에서 제외 → "바버"가 더 큰 단어의 일부로 쓰인 경우를 걸러냄.
function isWordChar(ch) {
  if (!ch) return false;
  const code = ch.codePointAt(0);
  return (code >= 0xAC00 && code <= 0xD7A3) || /[A-Za-z0-9]/.test(ch);
}

// 검색어가 더 큰 단어에 파묻힌 채로만 등장하면(예: "클럽모나코" 검색인데
// "축구 클럽"+"모나코 그랑프리"처럼 따로 등장, 또는 "바버숍페라"처럼 다른
// 단어에 섞여 등장) 매칭으로 치지 않고, 앞뒤가 단어 경계인 "독립된 문자열"로
// 등장할 때만 매칭으로 인정.
function hasWordBoundaryMatch(haystack, core) {
  const upperHaystack = haystack.toUpperCase();
  let idx = upperHaystack.indexOf(core);
  while (idx !== -1) {
    if (!isWordChar(haystack[idx - 1]) && !isWordChar(haystack[idx + core.length])) return true;
    idx = upperHaystack.indexOf(core, idx + 1);
  }
  return false;
}

// 네이버는 검색어를 내부적으로 형태소 단위로 쪼개 매칭하기 때문에, 예를 들어
// "클럽모나코"를 붙여서 검색해도 "클럽"+"모나코"(축구 클럽·모나코 F1 등)처럼
// 전혀 무관한 기사가 걸리는 경우가 있음. 검색어 핵심 단어가 실제로 제목+본문에
// 독립된 단어로 등장하는 기사만 남겨서 이 문제를 막음 (본문 매칭은 허용).
function filterByContentRelevance(items, query) {
  const core = query.replace(/"/g, '').split(' ')[0].toUpperCase();
  if (!core) return items;
  return items.filter(a => hasWordBoundaryMatch(a.title + ' ' + (a._desc || ''), core));
}

function newsQueriesForBrand(brand) {
  const configured = EXPANDED_NEWS_QUERIES[brand] || NEWS_QUERY_OVERRIDES[brand] || brand;
  const queries = Array.isArray(configured) ? configured : [configured];
  if (!EXPANDED_NEWS_QUERIES[brand]) queries.push(`${brand} 패션 브랜드`);
  return [...new Set(queries)];
}

function hasBrandMention(text, alias) {
  const haystack = String(text || '').toUpperCase();
  const core = String(alias || '').toUpperCase();
  if (!core) return false;
  let index = haystack.indexOf(core);
  const koreanParticle = /^[가-힣]/.test(core) ? /[가이은는을를과와의에로도만]/ : null;
  while (index !== -1) {
    const before = haystack[index - 1];
    const after = haystack[index + core.length];
    const validBefore = !isWordChar(before);
    const validAfter = !isWordChar(after) || (koreanParticle && koreanParticle.test(after));
    if (validBefore && validAfter) return true;
    index = haystack.indexOf(core, index + 1);
  }
  return false;
}

function filterByBrandRelevance(items, brand) {
  const aliases = NEWS_BRAND_ALIASES[brand] || [brand];
  return items.filter(item => {
    const text = `${item.title} ${item._desc || ''}`;
    if (!aliases.some(alias => hasBrandMention(text, alias))) return false;
    const upper = text.toUpperCase();
    const titleUpper = String(item.title || '').toUpperCase();
    const titleMentionsBrand = aliases.some(alias => hasBrandMention(item.title, alias));
    if ((BRAND_NOISE_TERMS[brand] || []).some(term => upper.includes(term.toUpperCase()))) return false;
    const titleContext = AMBIGUOUS_BRAND_TITLE_CONTEXT[brand];
    if (titleContext && !titleMentionsBrand
      && !titleContext.some(term => titleUpper.includes(term.toUpperCase()))) return false;
    if (brand === 'POTTERY') {
      if (!titleMentionsBrand) return false;
      if (POTTERY_NOISE.some(term => upper.includes(term.toUpperCase()))) return false;
    }
    return true;
  });
}

// 보도자료가 여러 매체에 조금씩 다른 제목으로 실리는 경우("트레몰로, 상반기
// 남성복 성장" / "세정그룹 트레몰로, '에센셜 라인' 상반기 실적 견인" 등)가
// 많아서 제목이 완전히 같을 때만 걸러내는 것으로는 부족함. 제목을 2글자
// 단위로 쪼갠 뒤(자모 분리 없이 문자 그대로) 겹치는 비율(자카드 유사도)이
// 높으면 사실상 같은 기사로 보고 먼저 나온(더 최신인) 것만 남김.
function charBigrams(str) {
  const s = str.replace(/[^\p{L}\p{N}]/gu, '');
  const grams = new Set();
  for (let i = 0; i < s.length - 1; i++) grams.add(s.slice(i, i + 2));
  return grams;
}
function titleSimilarity(a, b) {
  const setA = charBigrams(a);
  const setB = charBigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter(g => setB.has(g)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}
const DUP_TITLE_SIMILARITY_THRESHOLD = 0.22;
function dedupSimilarTitles(items) {
  const kept = [];
  items.forEach(item => {
    const isDup = kept.some(k => titleSimilarity(k.title, item.title) >= DUP_TITLE_SIMILARITY_THRESHOLD);
    if (!isDup) kept.push(item);
  });
  return kept;
}

async function fetchBrandCandidates(brand) {
  const queries = newsQueriesForBrand(brand);
  const combined = [];
  const sources = { google:false, naver:NAVER_CLIENT_ID && NAVER_CLIENT_SECRET ? false : null };
  let succeeded = false;
  for (const query of queries) {
    const batch = await fetchAllSources(query);
    combined.push(...batch.items);
    succeeded ||= batch.succeeded;
    sources.google ||= batch.sources.google === true;
    if (sources.naver !== null) sources.naver ||= batch.sources.naver === true;
  }
  const seen = new Set();
  const unique = combined.filter(item => {
    const key = item.title.replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const items = filterByBrandRelevance(unique, brand);
  return { items: dedupSimilarTitles(filterRecentAndSort(items)), sources, succeeded, queries };
}

// "OO아울렛엔 우영미, 렉토, 포터리 등이 입점" 식으로 여러 브랜드명을 단순
// 나열한 기사는 특정 브랜드를 다루는 기사가 아닌데도, 언급된 브랜드마다
// 전부 걸려서 서로 다른 브랜드 카드에 똑같은 기사가 중복 노출됨. 같은
// 기사가 우리가 추적하는 브랜드 2개 이상의 후보 목록에 동시에 걸리면
// 이런 나열식 기사로 보고 모든 브랜드에서 제외.
function dropCrossBrandNoise(rawByBrand) {
  const titleCount = {};
  Object.values(rawByBrand).forEach(items => {
    const seen = new Set();
    items.forEach(a => {
      const key = a.title.replace(/\s+/g, '');
      if (seen.has(key)) return;
      seen.add(key);
      titleCount[key] = (titleCount[key] || 0) + 1;
    });
  });
  const result = {};
  Object.entries(rawByBrand).forEach(([brand, items]) => {
    result[brand] = items.filter(a => titleCount[a.title.replace(/\s+/g, '')] < 3);
  });
  return result;
}

// 키워드 기반 간단 감성 분석 — 별도 API 없이 제목+본문에 긍정/부정 단어가
// 얼마나 나오는지 세어서 판정. 보도자료 특성상 긍정 어투가 많아 애매한
// 경우(둘 다 0개거나 동률)는 중립으로 처리. 미묘한 뉘앙스까지는 못 잡지만
// 대략적인 톤 파악용으로 사용.
const POSITIVE_KEYWORDS = [
  '성장', '호조', '호평', '인기', '흥행', '수상', '선정', '확장', '완판', '화제',
  '극찬', '1위', '베스트', '유치', '도약', '강세', '견인', '최대', '역대급',
  '대박', '인기몰이', '신기록', '순항', '가속', '주목', '기대', '협업', '리뉴얼',
  '신규 오픈', '단독', '수혜', '반등', '흑자',
];
const NEGATIVE_KEYWORDS = [
  // '사고'는 뺌 — "~하고 싶은"의 '사고'(사다) 활용형과 겹쳐서 상품 구매 후기류
  // 기사("사고 싶은 재킷")가 죄다 부정으로 잘못 잡히는 오탐이 너무 잦았음.
  '철수', '폐점', '부진', '하락', '감소', '적자', '논란', '위기', '리콜', '소송',
  '불매', '비판', '결함', '파산', '구설', '침체', '저조', '단종', '중단',
  '취소', '해지', '갑질', '불만', '한파', '역풍', '급감', '곤두박질', '몸살',
  '휘청', '폭락', '먹구름', '악화', '리스크',
];
// "내수 부진을 극복/메운다" 같이 부정적 단어가 있어도 전체 맥락은 "이겨내는 중"이라는
// 긍정적 서사인 기사가 많음. 이런 반전 표현이 있으면 부정 판정을 취소함.
const REVERSAL_KEYWORDS = ['극복', '메운다', '메워', '메꿔', '이겨내', '벗어나', '탈출', '만회', '회복', '뛰어넘'];
function classifySentiment(text) {
  let pos = 0;
  let neg = 0;
  POSITIVE_KEYWORDS.forEach(w => { if (text.includes(w)) pos++; });
  NEGATIVE_KEYWORDS.forEach(w => { if (text.includes(w)) neg++; });
  if (neg > 0 && REVERSAL_KEYWORDS.some(w => text.includes(w))) {
    neg = 0;
    pos += 1;
  }
  if (pos === 0 && neg === 0) return 'neutral';
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'neutral';
}

const EVENT_KEYWORDS = {
  '신규 매장·팝업': ['신규 매장','신규점','오픈','개점','팝업','플래그십'],
  '입점·유통': ['입점','유통 계약','독점 유통','라이선스','론칭'],
  '철수·중단': ['철수','폐점','사업 중단','영업 종료','라이선스 종료'],
  '리뉴얼·확장': ['리뉴얼','확장','증축','이전 오픈'],
  '협업·신제품': ['협업','콜라보','신제품','신상품','컬렉션'],
  '실적·성장': ['실적','매출','성장','흑자','적자','호조','부진'],
  '경영·계약 변경': ['인수','매각','경영권','계약 해지','대표 선임'],
};
function classifyEvents(text) {
  return Object.entries(EVENT_KEYWORDS)
    .filter(([, keywords]) => keywords.some(keyword => text.includes(keyword)))
    .map(([event]) => event);
}

function finalizeArticle(item) {
  const text = item.title + ' ' + (item._desc || '');
  const sentiment = classifySentiment(text);
  const events = classifyEvents(text);
  const { _desc, ...rest } = item;
  return { ...rest, sentiment, events };
}

async function fetchIndustryNews() {
  const seen = new Set();
  const all = [];
  let succeeded = false;
  for (const query of INDUSTRY_QUERIES) {
    const batch = await fetchAllSources(query);
    succeeded ||= batch.succeeded;
    batch.items.forEach(item => {
      const key = item.title.replace(/\s+/g, '');
      if (!seen.has(key)) { seen.add(key); all.push(item); }
    });
    await sleep(400);
  }
  const deduped = dedupSimilarTitles(filterRecentAndSort(all));
  return { items: deduped.slice(0, INDUSTRY_ARTICLES).map(finalizeArticle), succeeded };
}

async function main() {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.log('(참고: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 없어 구글 뉴스만 수집합니다)');
  }

  let previous = { data: {}, industry: [] };
  try { previous = JSON.parse(fs.readFileSync(path.join(__dirname, 'news.json'), 'utf8')); } catch (e) { /* 최초 실행 */ }
  const rawByBrand = {};
  const diagnostics = [];
  for (const brand of BRANDS) {
    process.stdout.write(`수집 중: ${brand} ... `);
    const batch = await fetchBrandCandidates(brand);
    rawByBrand[brand] = batch.succeeded ? batch.items : (previous.data[brand] || []);
    diagnostics.push({ brand, queries:batch.queries, candidates:batch.items.length, sources: batch.sources, status: batch.succeeded ? 'ok' : 'stale' });
    console.log(`${rawByBrand[brand].length}건 (중복 브랜드 필터 전)`);
    await sleep(400);
  }

  const cleanedByBrand = dropCrossBrandNoise(rawByBrand);
  const data = {};
  BRANDS.forEach(brand => {
    data[brand] = cleanedByBrand[brand].slice(0, ARTICLES_PER_BRAND).map(finalizeArticle);
  });

  process.stdout.write('수집 중: [업계 전체] 남성/맨즈 컨템포러리 ... ');
  const industryBatch = await fetchIndustryNews();
  const industry = industryBatch.succeeded ? industryBatch.items : (previous.industry || []);
  console.log(`${industry.length}건`);

  const output = {
    lastUpdated: new Date().toISOString(),
    windowDays: NEWS_WINDOW_DAYS,
    coverage: { total:BRANDS.length, withNews:BRANDS.filter(brand => data[brand].length > 0).length },
    diagnostics,
    industry,
    data,
  };
  fs.writeFileSync(path.join(__dirname, 'news.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n완료: news.json 저장 (브랜드 ${BRANDS.length}개 + 업계 전체)`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('뉴스 크롤러 실행 중 오류:', e);
    process.exit(1);
  });
}

module.exports = {
  classifySentiment, classifyEvents, titleSimilarity, dedupSimilarTitles,
  filterByContentRelevance, hasBrandMention, filterByBrandRelevance, newsQueriesForBrand,
};
