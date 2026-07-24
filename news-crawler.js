// 브랜드별 뉴스 크롤러 — 구글 뉴스 RSS + 네이버 뉴스 검색 API에서 브랜드별 최신 기사를
// 모아 news.json으로 저장. 매일 오전(KST) GitHub Actions로 자동 실행됨
// (.github/workflows/news.yml). 네이버는 NAVER_CLIENT_ID/NAVER_CLIENT_SECRET
// 환경변수(GitHub Secrets)가 설정된 경우에만 수집하고, 없으면 구글만 사용.
const fs = require('fs');
const path = require('path');

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

const BRANDS = [
  '타임옴므', '띠어리맨', '솔리드옴므', '시스템옴므',
  '우영미', '준지', '송지오옴므',
  '스톤아일랜드', 'CP컴퍼니',
  '비이커', '톰그레이하운드맨',
  '아페쎄맨', '이로맨', '지오송지오', '바버', '산드로옴므', '질스튜어트뉴욕', '아스페시', 'DKNY맨',
  '클럽모나코', '맨온더분', '수트서플라이', '슬로웨어',
  'POTTERY', '캡틴선샤인', 'PAF', '이스트로그(프레이트)',
  '에잇디비젼', '스컬프스토어', '아이엠샵',
  '맨메이드카페',
];

// 업계 전체 동향 카드 (특정 브랜드가 아닌 일반 검색어)
const INDUSTRY_QUERIES = ['남성 컨템포러리', '맨즈 컨템포러리'];

const ARTICLES_PER_BRAND = 8;
const INDUSTRY_ARTICLES = 8;
const MAX_AGE_DAYS = 14; // 최근 14일 이내 기사만 수집

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
    };
  });
}

async function fetchAllSources(query) {
  const all = [];
  try {
    all.push(...await fetchGoogleNews(query));
  } catch (e) {
    console.error(`  [구글: ${query}] 수집 실패:`, e.message);
  }
  try {
    all.push(...await fetchNaverNews(query));
  } catch (e) {
    console.error(`  [네이버: ${query}] 수집 실패:`, e.message);
  }
  // 같은 기사가 두 소스에 다 걸리는 경우가 있어 제목 기준으로 중복 제거
  const seen = new Set();
  return all.filter(a => {
    const key = a.title.replace(/\s+/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 최근 MAX_AGE_DAYS 이내 기사만 남기고 최신순 정렬 (검색 결과는 관련도순이라 재정렬 필요)
function filterRecentAndSort(items) {
  const cutoff = Date.now() - MAX_AGE_DAYS * 86400000;
  return items
    .filter(a => a.pubDate && new Date(a.pubDate).getTime() >= cutoff)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
}

// 네이버 검색은 본문(description)에도 매칭되는데, "OO아울렛엔 우영미, 렉토,
// 포터리 등이 입점" 식으로 여러 브랜드명을 나열한 기사가 전혀 무관한 브랜드
// 카드에마다 똑같이 걸리는 문제가 있었음. 또 "클럽모나코"처럼 검색어가 두
// 단어로 쪼개져 "클럽"+"모나코"(축구) 기사가 걸리는 경우도 있어, 검색어
// 핵심어가 실제 "제목"에 나오는 기사만 남김.
function filterByTitleRelevance(items, query) {
  const core = query.replace(/"/g, '').split(' ')[0].toUpperCase();
  if (!core) return items;
  return items.filter(a => a.title.toUpperCase().includes(core));
}

async function fetchBrandNews(brand) {
  const query = NEWS_QUERY_OVERRIDES[brand] || brand;
  const items = filterByTitleRelevance(await fetchAllSources(query), query);
  return filterRecentAndSort(items).slice(0, ARTICLES_PER_BRAND);
}

async function fetchIndustryNews() {
  const seen = new Set();
  const all = [];
  for (const query of INDUSTRY_QUERIES) {
    const items = await fetchAllSources(query);
    items.forEach(item => {
      const key = item.title.replace(/\s+/g, '');
      if (!seen.has(key)) { seen.add(key); all.push(item); }
    });
    await sleep(400);
  }
  return filterRecentAndSort(all).slice(0, INDUSTRY_ARTICLES);
}

async function main() {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    console.log('(참고: NAVER_CLIENT_ID/NAVER_CLIENT_SECRET이 없어 구글 뉴스만 수집합니다)');
  }

  const data = {};
  for (const brand of BRANDS) {
    process.stdout.write(`수집 중: ${brand} ... `);
    data[brand] = await fetchBrandNews(brand);
    console.log(`${data[brand].length}건`);
    await sleep(400);
  }

  process.stdout.write('수집 중: [업계 전체] 남성/맨즈 컨템포러리 ... ');
  const industry = await fetchIndustryNews();
  console.log(`${industry.length}건`);

  const output = {
    lastUpdated: new Date().toISOString(),
    industry,
    data,
  };
  fs.writeFileSync(path.join(__dirname, 'news.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n완료: news.json 저장 (브랜드 ${BRANDS.length}개 + 업계 전체)`);
}

main().catch(e => {
  console.error('뉴스 크롤러 실행 중 오류:', e);
  process.exit(1);
});
