// 브랜드별 뉴스 크롤러 — 구글 뉴스 RSS에서 브랜드별 최신 기사를 모아 news.json으로 저장.
// 매일 오전(KST) GitHub Actions로 자동 실행됨 (.github/workflows/news.yml).
const fs = require('fs');
const path = require('path');

// 실제 매장 리스트에 쓰이는 브랜드명 그대로 검색하면 결과가 안 나오거나(내부 표기용 이름)
// 너무 짧아 무관한 기사가 섞이는 브랜드가 있어, 그런 경우만 검색용 키워드를 따로 지정.
const NEWS_QUERY_OVERRIDES = {
  '아페쎄맨': '아페쎄 옴므',
  'DKNY맨': 'DKNY',
  '띠어리맨': '띠어리 옴므',
  '이로맨': '"IRO" 패션',
  '이스트로그(프레이트)': '이스트로그 프레이트',
  '톰그레이하운드맨': '톰그레이하운드',
  'PAF': 'PAF 브랜드',
  'TEN-C': 'TEN-C 브랜드',
};

const BRANDS = [
  '타임옴므', '띠어리맨', '솔리드옴므', '시스템옴므',
  '우영미', '준지', '송지오옴므',
  '스톤아일랜드', 'CP컴퍼니',
  '비이커', '톰그레이하운드맨', '플랫폼플레이스',
  '아페쎄맨', '이로맨', '지오송지오', '바버', '산드로옴므', '알레그리', '질스튜어트뉴욕', '아스페시', 'DKNY맨',
  '클럽모나코', '맨온더분', '수트서플라이', '슬로웨어',
  '지제로', 'POTTERY', '캡틴선샤인', 'PAF', 'TEN-C', '이스트로그(프레이트)', '헤리티지플로스',
  '에잇디비젼', '모드맨', '스컬프스토어', '아이엠샵',
  '맨메이드카페',
];

const ARTICLES_PER_BRAND = 6;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function parseItems(xml) {
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

async function fetchBrandNews(brand) {
  const query = NEWS_QUERY_OVERRIDES[brand] || brand;
  // 띄어쓰기 없는 단일 브랜드명은 따옴표로 감싸 정확히 일치하는 기사만 (노이즈 방지).
  // 여러 단어로 조합한 검색어(주로 위 오버라이드)는 따옴표를 걸면 그 문구 그대로 나온
  // 기사만 찾게 되어 결과가 0건에 가까워지므로 그대로 검색.
  const q = query.includes(' ') ? query : `"${query}"`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=ko&gl=KR&ceid=KR:ko`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const xml = await res.text();
    return parseItems(xml).slice(0, ARTICLES_PER_BRAND);
  } catch (e) {
    console.error(`[${brand}] 뉴스 수집 실패:`, e.message);
    return [];
  }
}

async function main() {
  const data = {};
  for (const brand of BRANDS) {
    process.stdout.write(`수집 중: ${brand} ... `);
    data[brand] = await fetchBrandNews(brand);
    console.log(`${data[brand].length}건`);
    await sleep(400);
  }

  const output = {
    lastUpdated: new Date().toISOString(),
    data,
  };
  fs.writeFileSync(path.join(__dirname, 'news.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log(`\n완료: news.json 저장 (브랜드 ${BRANDS.length}개)`);
}

main().catch(e => {
  console.error('뉴스 크롤러 실행 중 오류:', e);
  process.exit(1);
});
