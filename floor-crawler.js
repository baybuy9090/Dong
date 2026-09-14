// 지점별 층 안내도 크롤러 — 신세계/롯데는 공식 이미지 URL을 수집하고,
// 현대는 공식 페이지가 사용하는 다비오 벡터 데이터를 정적 SVG로 변환한다.
// 결과는 floor-images.json에 지점 코드 기준으로 병합한다.
const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── 신세계: floor.do 페이지에 CMS로 올라온 층별 안내도 이미지가 그대로 있음 ──
const SHINSEGAE_STORES = Object.fromEntries(CONFIG.storeRows.filter(s => s.company === '신세계').map(s => [s.name, s.code]));

function extractFloorNum(label) {
  const m = label.match(/^\s*(B\d+|\d+)\s*F?/i);
  return m ? m[1].toUpperCase() + 'F' : '';
}

async function fetchShinsegaeFloors(storeCode) {
  const url = `https://www.shinsegae.com/store/floor.do?storeCd=${storeCode}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const imgRegex = /<img src="(\/cms12\/[^"]*__icsFiles[^"]*)" alt="([^"]*)"/g;
  const floors = [];
  const seen = new Set();
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    const imgUrl = 'https://www.shinsegae.com' + m[1];
    if (seen.has(imgUrl)) continue;
    seen.add(imgUrl);
    const label = m[2].trim();
    floors.push({ floor: extractFloorNum(label), label, url: imgUrl });
  }
  return floors;
}

// ── 롯데: 기본은 인터랙티브 쇼핑맵이지만, 그와 별개로 "층별안내도"라는 평면
// 이미지 기능이 병행 제공됨 (data-flrImgPathWeb/data-flrImgNmWeb). 지점 페이지에서
// 층 목록(town/floor 코드)을 얻은 뒤, 층마다 floorDetailAjax를 호출해 이미지 경로를 얻음. ──
const LOTTE_STORES = Object.fromEntries(CONFIG.storeRows.filter(s => s.company === '롯데').map(s => [s.name, s.code]));
const HYUNDAI_STORES = Object.fromEntries(CONFIG.storeRows.filter(s => s.company === '현대').map(s => [s.name, s.code]));

function extractLotteFloorItems(html) {
  const items = [];
  const seen = new Set();
  const blockRe = /<div floor-index="([^"]*)"[^>]*class="floor-item"[\s\S]{0,400}?>/g;
  let m;
  while ((m = blockRe.exec(html)) !== null) {
    const block = m[0];
    const townCd = (block.match(/data-cstrTownCd="([^"]*)"/i) || [])[1];
    const townNm = (block.match(/data-cstrTownNm="([^"]*)"/i) || [])[1];
    const flrCd = (block.match(/data-flrCd="([^"]*)"/i) || [])[1];
    // '백화점'은 일반 지점의 본관, '본동'은 잠실에비뉴엘처럼 별관 단독 지점의 본관 명칭
    if (!townCd || !flrCd || (townNm !== '백화점' && townNm !== '본동')) continue;
    const key = townCd + '|' + flrCd;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ townCd, flrCd });
  }
  return items;
}

async function fetchLotteFloorDetail(cstrCd, townCd, flrCd) {
  const url = `https://www.lotteshopping.com/store/floorDetailAjax?cstrCd=${cstrCd}&cstrTownCd=${townCd}&flrCd=${flrCd}`;
  const res = await fetch(url, { headers: { ...UA, 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const imgPath = (html.match(/data-flrImgPathWeb="([^"]*)"/i) || [])[1];
  const imgNm = (html.match(/data-flrImgNmWeb="([^"]*)"/i) || [])[1];
  const floorTitleM = html.match(/<b class="s-title6-b">([^<]*)<\/b>\s*<span[^>]*>([^<]*)<\/span>/);
  const label = floorTitleM ? `${floorTitleM[1].trim()} ${floorTitleM[2].trim()}` : flrCd;
  if (!imgPath || !imgNm) return null;
  return { floor: flrCd + 'F', label, url: `https://minfo.lotteshopping.com${imgPath}${imgNm}` };
}

async function fetchLotteFloors(cstrCd) {
  const listUrl = `https://www.lotteshopping.com/store/floor?cstrCd=${cstrCd}`;
  const res = await fetch(listUrl, { headers: UA });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const floorItems = extractLotteFloorItems(html);
  const floors = [];
  let failedPages = 0;
  for (const { townCd, flrCd } of floorItems) {
    try {
      const detail = await fetchLotteFloorDetail(cstrCd, townCd, flrCd);
      if (detail) floors.push(detail);
    } catch (e) {
      failedPages++;
      console.error(`  [롯데 ${cstrCd} ${flrCd}F] 실패:`, e.message);
    }
    await sleep(250);
  }
  return { floors, failedPages, expectedPages: floorItems.length };
}

// ── 현대: 공식 페이지에 평면 이미지 파일은 없지만, 공개된 다비오 Web SDK가
// OAuth 토큰으로 벡터 지도(매장 구획·층·POI)를 내려받는다. 인증값을 저장소에
// 하드코딩하지 않고 지점 공식 페이지에서 매번 읽어 같은 요청 흐름을 재현한다. ──
function htmlValue(html, id) {
  const input = (html.match(new RegExp(`<input[^>]*id=["']${id}["'][^>]*>`, 'i')) || [])[0] || '';
  return (input.match(/value=["']([^"']*)["']/i) || [])[1] || '';
}

function languageText(value, lang = 'ko') {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return (value.find(item => item.lang === lang) || value[0] || {}).text || '';
}

function xmlEscape(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' }[char]));
}

function safeFloorFileName(label) {
  return String(label || 'floor').replace(/[^0-9A-Za-z가-힣_-]/g, '_');
}

function styleMap(styles) {
  return new Map((styles || []).map(style => [style.groupCode, style]));
}

function svgPolygon(shape, styles, fallback) {
  const points = (shape.coordinates || []).map(point => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`).join(' ');
  if (!points) return '';
  const style = styles.get((shape.style || {}).groupCode) || styles.get(shape.attributeCode) || fallback;
  const fill = style.color || fallback.color;
  const stroke = style.lineColor || fallback.lineColor;
  const opacity = Number.isFinite(style.opacity) ? style.opacity / 100 : 1;
  return `<polygon points="${points}" fill="${xmlEscape(fill)}" fill-opacity="${opacity}" stroke="${xmlEscape(stroke)}" stroke-width="1.5"/>`;
}

function poiTitle(poi) {
  return languageText(poi.titleByLanguages) || languageText(poi.title) || String(poi.title || '');
}

function renderHyundaiFloorSvg(mapData, floor, storeName) {
  const theme = (mapData.themes || []).find(item => item.defaultYn) || (mapData.themes || [])[0] || {};
  const sectionStyles = styleMap(theme.sectionStyles);
  const objectStyles = styleMap(theme.objectStyles);
  const sectionFallback = { color:'#f4f4f1', lineColor:'#d3d6d4' };
  const objectFallback = { color:'#e9eceb', lineColor:'#a9adaa' };
  const shapes = [...(floor.sections || []), ...(floor.objects || [])];
  const coordinates = shapes.flatMap(shape => shape.coordinates || []);
  const width = Number((mapData.size || {}).width) || 1500;
  const height = Number((mapData.size || {}).height) || 1600;
  const minX = coordinates.length ? Math.min(...coordinates.map(point => point.x)) : 0;
  const minY = coordinates.length ? Math.min(...coordinates.map(point => point.y)) : 0;
  const maxX = coordinates.length ? Math.max(...coordinates.map(point => point.x)) : width;
  const maxY = coordinates.length ? Math.max(...coordinates.map(point => point.y)) : height;
  const padding = 55;
  const floorLabel = languageText(floor.name) || floor.id;
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(1, maxX - minX + padding * 2)} ${Math.max(1, maxY - minY + padding * 2)}`;
  const labels = (floor.pois || []).map(poi => {
    const title = poiTitle(poi).trim();
    const position = poi.position || {};
    if (!title || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    const compact = title.length > 18 ? `${title.slice(0, 17)}…` : title;
    return `<text x="${position.x}" y="${position.y}" text-anchor="middle" dominant-baseline="central">${xmlEscape(compact)}</text>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1200" height="1200" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(storeName)} ${xmlEscape(floorLabel)} 층 안내도</title>
  <desc id="desc">현대백화점 공식 층별 안내 벡터 데이터를 정적 도면으로 변환했습니다.</desc>
  <rect x="${minX - padding}" y="${minY - padding}" width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2}" fill="${xmlEscape(theme.canvasColor || '#f7f8f7')}"/>
  <g>${(floor.sections || []).map(shape => svgPolygon(shape, sectionStyles, sectionFallback)).join('')}</g>
  <g>${(floor.objects || []).map(shape => svgPolygon(shape, objectStyles, objectFallback)).join('')}</g>
  <g font-family="Arial, 'Noto Sans KR', sans-serif" font-size="12" font-weight="600" fill="#303633" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${labels}</g>
  <text x="${minX}" y="${minY - 18}" font-family="Arial, 'Noto Sans KR', sans-serif" font-size="20" font-weight="700" fill="#1a1f1d">${xmlEscape(storeName)} · ${xmlEscape(floorLabel)}</text>
</svg>\n`;
}

async function fetchHyundaiMap(branchCd) {
  const pageUrl = `https://www.ehyundai.com/newPortal/DP/FG/FG000000_V.do?branchCd=${branchCd}`;
  const pageRes = await fetch(pageUrl, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!pageRes.ok) throw new Error(`공식 페이지 HTTP ${pageRes.status}`);
  const html = await pageRes.text();
  if (htmlValue(html, 'dabeeo_enable') === '0') throw new Error('다비오 지도 비활성화 지점');
  const clientId = htmlValue(html, 'dabeeo_client_id');
  const clientSecret = htmlValue(html, 'dabeeo_client_secret');
  if (!clientId || !clientSecret) throw new Error('지도 인증값 없음');

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const tokenRes = await fetch('https://oauth.dabeeomaps.com/oauth/token', {
    method: 'POST',
    headers: { Authorization:`Basic ${basic}`, 'Content-Type':'application/x-www-form-urlencoded', Origin:'https://www.ehyundai.com', Referer:pageUrl },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(30000),
  });
  const token = await tokenRes.json();
  if (!tokenRes.ok || !token.access_token) throw new Error(`지도 인증 HTTP ${tokenRes.status}`);

  const mapRes = await fetch('https://api.dabeeomaps.com/v2/map?t=JS', {
    headers: { Authorization:`Bearer ${token.access_token}`, Origin:'https://www.ehyundai.com', Referer:pageUrl },
    signal: AbortSignal.timeout(30000),
  });
  const mapPayload = await mapRes.json();
  if (!mapRes.ok || !mapPayload.payload || !(mapPayload.payload.floors || []).length) throw new Error(`지도 데이터 HTTP ${mapRes.status}`);
  return mapPayload.payload;
}

async function fetchHyundaiFloors(storeName, branchCd, rootDir = __dirname) {
  const mapData = await fetchHyundaiMap(branchCd);
  const outputDir = path.join(rootDir, 'floor-maps', 'hyundai', branchCd);
  fs.mkdirSync(outputDir, { recursive: true });
  return (mapData.floors || []).map(floor => {
    const label = languageText(floor.name) || floor.id;
    const fileName = `${safeFloorFileName(label)}.svg`;
    fs.writeFileSync(path.join(outputDir, fileName), renderHyundaiFloorSvg(mapData, floor, storeName), 'utf8');
    return { floor: label, label: `${label} 층 안내도`, url: `floor-maps/hyundai/${branchCd}/${fileName}`, source: 'hyundai-dabeeo' };
  });
}

async function main() {
  const data = {};
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(path.join(__dirname, 'floor-images.json'), 'utf8')).data || {}; } catch (e) { previous = {}; }
  const diagnostics = [];

  for (const [store, code] of Object.entries(SHINSEGAE_STORES)) {
    process.stdout.write(`수집 중: 신세계 ${store} ... `);
    try {
      data[code] = await fetchShinsegaeFloors(code);
      if (data[code].length === 0 && (previous[code] || []).length) throw new Error('0개 층 응답');
      diagnostics.push({ storeId: `신세계-${code}`, store, status: 'ok', floors: data[code].length });
      console.log(`${data[code].length}개 층`);
    } catch (e) {
      console.error('실패:', e.message);
      data[code] = previous[code] || [];
      diagnostics.push({ storeId: `신세계-${code}`, store, status: 'stale', error: e.message, floors: data[code].length });
    }
    await sleep(400);
  }

  for (const [store, code] of Object.entries(LOTTE_STORES)) {
    process.stdout.write(`수집 중: 롯데 ${store} ... `);
    try {
      const result = await fetchLotteFloors(code);
      data[code] = result.floors;
      if (result.failedPages > 0 && (previous[code] || []).length) throw new Error(`${result.failedPages}/${result.expectedPages}개 층 호출 실패`);
      if (data[code].length === 0 && (previous[code] || []).length) throw new Error('0개 층 응답');
      diagnostics.push({ storeId: `롯데-${code}`, store, status: 'ok', floors: data[code].length });
      console.log(`${data[code].length}개 층`);
    } catch (e) {
      console.error('실패:', e.message);
      data[code] = previous[code] || [];
      diagnostics.push({ storeId: `롯데-${code}`, store, status: 'stale', error: e.message, floors: data[code].length });
    }
    await sleep(400);
  }

  for (const [store, code] of Object.entries(HYUNDAI_STORES)) {
    process.stdout.write(`수집 중: 현대 ${store} ... `);
    try {
      data[code] = await fetchHyundaiFloors(store, code);
      if (data[code].length === 0 && (previous[code] || []).length) throw new Error('0개 층 응답');
      diagnostics.push({ storeId: `현대-${code}`, store, status: 'ok', floors: data[code].length, format: 'svg' });
      console.log(`${data[code].length}개 층`);
    } catch (e) {
      console.error('실패:', e.message);
      data[code] = previous[code] || [];
      diagnostics.push({ storeId: `현대-${code}`, store, status: 'stale', error: e.message, floors: data[code].length, format: 'svg' });
    }
    await sleep(400);
  }

  const output = { lastUpdated: new Date().toISOString(), diagnostics, data };
  fs.writeFileSync(path.join(__dirname, 'floor-images.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log('\n완료: floor-images.json 저장');
}

if (require.main === module) {
  main().catch(e => {
    console.error('층 도면 크롤러 실행 중 오류:', e);
    process.exit(1);
  });
}

module.exports = {
  extractFloorNum, extractLotteFloorItems, htmlValue, languageText, safeFloorFileName,
  renderHyundaiFloorSvg, fetchHyundaiMap, fetchHyundaiFloors,
};
