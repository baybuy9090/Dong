// 지점별 층 안내도 크롤러 — 신세계는 공식 CMS 이미지와 층별 브랜드를 수집하고,
// 롯데/현대는 공식 페이지가 사용하는 다비오 벡터 데이터를 정적 SVG로 변환한다.
// 결과는 floor-images.json에 지점 코드 기준으로 병합한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CONFIG = require('./config');
const { matchBrands } = require('./crawler');

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
    floors.push({ floor: extractFloorNum(label), label, url: imgUrl, brands: [] });
  }
  const marker = 'var arrFloor = ';
  const jsonStart = html.indexOf(marker);
  if (jsonStart >= 0) {
    const valueStart = jsonStart + marker.length;
    const valueEnd = html.indexOf(';', valueStart);
    try {
      const payload = JSON.parse(html.slice(valueStart, valueEnd));
      (payload.floor || []).forEach(item => {
        if (!item.fa00019) return;
        const itemUrl = 'https://www.shinsegae.com' + item.fa00019;
        const floor = floors.find(entry => entry.url === itemUrl);
        if (!floor) return;
        const brandText = (item.category || []).flatMap(category => category.brand || []).flatMap(brand => [
          brand.shop_nm, brand.intg_bran_nm, brand.md_nm, brand.sh00002, brand.sh00025,
        ]).filter(Boolean).join(' ');
        floor.brands = matchBrands(brandText).sort((a,b) => a.localeCompare(b, 'ko'));
      });
    } catch (e) {
      console.error(`  [신세계 ${storeCode}] 층별 브랜드 JSON 파싱 실패:`, e.message);
    }
  }
  return floors;
}

// ── 롯데: 공식 페이지의 "층별안내도" JPG는 최신 쇼핑맵과 별도로 관리되는
// 구형 이미지일 수 있다. 실제 화면이 사용하는 shoppingMapAjax + Dabeeo API 4의
// 최신 층 SVG/POI/구획 데이터를 받아 일반·강조 SVG를 각각 만든다. ──
const LOTTE_STORES = Object.fromEntries(CONFIG.storeRows.filter(s => s.company === '롯데').map(s => [s.name, s.code]));
const HYUNDAI_STORES = Object.fromEntries(CONFIG.storeRows.filter(s => s.company === '현대').map(s => [s.name, s.code]));
const DABEEO4_DATA_BASE = 'https://data.maps.dabeeo.com/api';

// 현대 공식 층별 안내의 현재 남성 카테고리 층. 지도 POI에는 성별 정보가 없어서
// 여성층의 띠어리/DKNY/클럽모나코가 남성 브랜드로 오인될 수 있으므로 공식 층
// 카테고리를 지점별로 명시한다. 층 변경 시 auditFloorBrands가 미배치 건을 드러낸다.
const HYUNDAI_MANAGED_FLOORS = {
  B00142000: ['B1'], B00122000: ['7F'], B00141000: ['5F'], B00121000: ['4F'],
  B00127000: ['6F'], B00140000: ['2F', '3F'], B00129000: ['8F'], B00143000: ['5F'],
  B00126000: ['6F'], B00147000: ['4F'], B00145000: ['6F'], B00148000: ['6F', '7F'],
  B00146000: ['5F'],
};

const EXCLUDED_MANAGED_FLOORS = new Set([
  '신세계-SC00005|1F', // 마산 1F 여성 띠어리
  '신세계-SC00008|3F', // 센텀 3F 여성 컨템포러리/란제리
]);
const EXCLUDED_MANAGED_BRAND_LOCATIONS = new Set([
  '롯데-0399|02F|띠어리맨', // 동탄점 2F 여성 띠어리
  '롯데-0025|02F|띠어리맨', // 전주점 2F 여성 띠어리
]);

function isExcludedManagedBrand(store, floor, brand) {
  return EXCLUDED_MANAGED_BRAND_LOCATIONS.has(`${store.id}|${floor.floor}|${brand}`);
}

function isManagedFloor(store, floor) {
  if (store.company === '현대') return (HYUNDAI_MANAGED_FLOORS[store.code] || []).includes(floor.floor);
  if (EXCLUDED_MANAGED_FLOORS.has(`${store.id}|${floor.floor}`)) return false;
  const label = String(floor.label || '').replace(/\s+/g, ' ');
  const hasMens = /(남성|맨즈|MEN'S|MENSWEAR)/i.test(label);
  const hasNonMens = /(여성|우먼|란제리|아동|유아)/i.test(label);
  return !hasNonMens || hasMens;
}

function activeBrandsByStore(rows) {
  const result = new Map();
  (rows || []).forEach(row => {
    if (!row) return;
    const storeId = row.storeId || CONFIG.storeId(row.company, row.store);
    if (!result.has(storeId)) result.set(storeId, new Set());
    if (!row.brand || row.brand.startsWith('(') || /(퇴점|누락)/.test(row.note || '')) return;
    result.get(storeId).add(row.brand);
  });
  return result;
}

function verifyFloorEntries(store, floors, activeBrands) {
  return (floors || []).map(floor => ({
    ...floor,
    brands: isManagedFloor(store, floor)
      ? (floor.brands || []).filter(brand => (!activeBrands || activeBrands.has(brand))
        && !isExcludedManagedBrand(store, floor, brand))
      : [],
  }));
}

async function fetchLotteShoppingMapConfig(cstrCd) {
  const url = `https://www.lotteshopping.com/service/shoppingMapAjax?cstrCd=${cstrCd}`;
  const res = await fetch(url, {
    headers: { ...UA, 'X-Requested-With':'XMLHttpRequest', Referer:`https://www.lotteshopping.com/store/floor?cstrCd=${cstrCd}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`쇼핑맵 설정 HTTP ${res.status}`);
  const payload = await res.json();
  if (payload.resultCode !== '0000' || !payload.shpgMap?.clientId || !payload.shpgMap?.secret) {
    throw new Error(payload.resultMsg || '쇼핑맵 인증값 없음');
  }
  return payload;
}

async function fetchDabeeo4Token(clientId, clientSecret) {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch('https://oauth.dabeeomaps.com/oauth/token?studioVersion=4', {
    method:'POST',
    headers: { Authorization:`Basic ${basic}`, 'Content-Type':'application/x-www-form-urlencoded' },
    body:'grant_type=client_credentials',
    signal: AbortSignal.timeout(30000),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) throw new Error(`쇼핑맵 인증 HTTP ${res.status}`);
  return payload.access_token;
}

async function fetchDabeeo4Floor(floorId, token) {
  const res = await fetch(`${DABEEO4_DATA_BASE}/v2/map/floors?floors=${encodeURIComponent(floorId)}`, {
    headers: { 'X-Authorization':`Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const payload = await res.json();
  if (!res.ok || !Array.isArray(payload.payload) || !payload.payload[0]) throw new Error(`층 지도 HTTP ${res.status}`);
  return payload.payload[0];
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length:Math.min(limit, items.length) }, run));
  return results;
}

function dabeeoMetadataValue(metadata) {
  if (metadata?.valueSingle != null) return String(metadata.valueSingle);
  const values = Array.isArray(metadata?.value) ? metadata.value : [];
  return String((values.find(item => item.lang === 'ko') || values.find(item => !item.lang) || values[0] || {}).value || '');
}

function lottePoiMetadata(poi, floorData) {
  const definitions = floorData.metadataFieldDefs || [];
  return Object.fromEntries((poi.metadatas || []).flatMap(metadata => {
    const key = definitions[metadata.fieldRef]?.fieldKey;
    return key ? [[key, dabeeoMetadataValue(metadata)]] : [];
  }));
}

function lotteFloorViewBox(floorData, pois, info = {}) {
  const canvasWidth = Number((floorData.size || {}).width) || 1200;
  const canvasHeight = Number((floorData.size || {}).height) || 900;
  const objectMap = new Map((floorData.objects || []).map(object => [object.id, object]));
  const bounds = [];
  (pois || []).forEach(poi => {
    const position = poi.position || {};
    if (Number.isFinite(position.x) && Number.isFinite(position.y)) bounds.push([position.x, position.y, position.x, position.y]);
    const object = objectMap.get(poi.objectId);
    if (!object) return;
    const center = object.position || {};
    const size = object.size || {};
    if (![center.x, center.y, size.width, size.height].every(Number.isFinite)) return;
    bounds.push([
      center.x - size.width / 2, center.y - size.height / 2,
      center.x + size.width / 2, center.y + size.height / 2,
    ]);
  });
  if (bounds.length === 0) {
    const cropWidth = Math.min(canvasWidth, 4200);
    const cropHeight = Math.min(canvasHeight, 3000);
    const centerX = Number(info.pcXcnts) || canvasWidth / 2;
    const centerY = Number(info.pcYcnts) || canvasHeight / 2;
    return {
      x:Math.max(0, Math.min(canvasWidth - cropWidth, centerX - cropWidth / 2)),
      y:Math.max(0, Math.min(canvasHeight - cropHeight, centerY - cropHeight / 2)),
      width:cropWidth, height:cropHeight,
    };
  }
  const minX = Math.min(...bounds.map(value => value[0]));
  const minY = Math.min(...bounds.map(value => value[1]));
  const maxX = Math.max(...bounds.map(value => value[2]));
  const maxY = Math.max(...bounds.map(value => value[3]));
  const padding = Math.max(320, Math.min(620, Math.max(maxX - minX, maxY - minY) * 0.12));
  const x = Math.max(0, minX - padding);
  const y = Math.max(0, minY - padding);
  return {
    x, y,
    width:Math.max(1, Math.min(canvasWidth, maxX + padding) - x),
    height:Math.max(1, Math.min(canvasHeight, maxY + padding) - y),
  };
}

function scopeLotteFloorData(floorData, cstrCd, floorCode, townCode, info = {}) {
  const annotated = (floorData.pois || []).map(poi => ({ poi, metadata:lottePoiMetadata(poi, floorData) }));
  const exact = annotated.filter(({ metadata }) => metadata.cstrCd === cstrCd
    && (!townCode || metadata.cstrTownCd === townCode)
    && (!floorCode || metadata.cstrFlrCd === floorCode));
  const storeOnly = annotated.filter(({ metadata }) => metadata.cstrCd === cstrCd
    && (!townCode || metadata.cstrTownCd === townCode));
  const scopedPois = (exact.length ? exact : storeOnly.length ? storeOnly : annotated).map(item => item.poi);
  return { ...floorData, pois:scopedPois, viewBox:lotteFloorViewBox(floorData, scopedPois, info) };
}

async function fetchLotteFloors(storeName, cstrCd, rootDir = __dirname, activeBrands = new Set()) {
  const config = await fetchLotteShoppingMapConfig(cstrCd);
  const townKey = Object.keys(config.townFloorInfo || {}).find(key => key.startsWith(`${cstrCd}_`)) || config.locationInfo?.town;
  const townFloors = config.townFloorInfo?.[townKey] || {};
  const floorCodes = config.floorSelect?.[townKey] || Object.keys(townFloors);
  if (!townKey || floorCodes.length === 0) throw new Error('쇼핑맵 층 정보 없음');
  const token = await fetchDabeeo4Token(config.shpgMap.clientId, config.shpgMap.secret);
  const store = CONFIG.getStore('롯데', storeName);
  const outputDir = path.join(rootDir, 'floor-maps', 'lotte', cstrCd);
  fs.mkdirSync(outputDir, { recursive:true });
  let failedPages = 0;
  const floors = await mapWithConcurrency(floorCodes, 4, async floorCode => {
    const info = townFloors[floorCode];
    if (!info?.flrId) return null;
    try {
      const floorData = await fetchDabeeo4Floor(info.flrId, token);
      if (!floorData.svgUrl) throw new Error('최신 SVG 주소 없음');
      const svgRes = await fetch(floorData.svgUrl, { signal:AbortSignal.timeout(30000) });
      if (!svgRes.ok) throw new Error(`최신 SVG HTTP ${svgRes.status}`);
      const rawSvg = await svgRes.text();
      const floor = `${floorCode}F`;
      const label = `${info.cstrFlrCdNm || floorCode} ${info.cstrFlrCtegryNm || ''}`.trim();
      const allowedBrands = isManagedFloor(store, { floor, label })
        ? new Set([...activeBrands].filter(brand => !isExcludedManagedBrand(store, { floor }, brand)))
        : new Set();
      const scopedFloorData = scopeLotteFloorData(floorData, cstrCd, floorCode, info.cstrTownCd, info);
      const managedPois = trackedPois(scopedFloorData, allowedBrands);
      const brands = uniqueBrands(managedPois.flatMap(item => item.brands));
      const fileName = `${safeFloorFileName(floor)}.svg`;
      const managedFileName = `${safeFloorFileName(floor)}-managed.svg`;
      fs.writeFileSync(path.join(outputDir, fileName), renderLotteFloorSvg(rawSvg, scopedFloorData, storeName, floor, managedPois, false), 'utf8');
      fs.writeFileSync(path.join(outputDir, managedFileName), renderLotteFloorSvg(rawSvg, scopedFloorData, storeName, floor, managedPois, true), 'utf8');
      return {
        floor, label, url:`floor-maps/lotte/${cstrCd}/${fileName}`,
        highlightUrl:`floor-maps/lotte/${cstrCd}/${managedFileName}`,
        source:'lotte-dabeeo', sourceUrl:floorData.svgUrl, brands,
      };
    } catch (error) {
      failedPages++;
      console.error(`  [롯데 ${cstrCd} ${floorCode}F] 실패:`, error.message);
      return null;
    }
  });
  return { floors:floors.filter(Boolean), failedPages, expectedPages:floorCodes.length };
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

function pointInPolygon(point, coordinates) {
  if (!point || !Array.isArray(coordinates) || coordinates.length < 3) return false;
  let inside = false;
  for (let i = 0, j = coordinates.length - 1; i < coordinates.length; j = i++) {
    const xi = Number(coordinates[i].x), yi = Number(coordinates[i].y);
    const xj = Number(coordinates[j].x), yj = Number(coordinates[j].y);
    const crosses = ((yi > point.y) !== (yj > point.y))
      && (point.x < (xj - xi) * (point.y - yi) / ((yj - yi) || Number.EPSILON) + xi);
    if (crosses) inside = !inside;
  }
  return inside;
}

function uniqueBrands(values) {
  return [...new Set(values.flatMap(value => matchBrands(String(value || ''))))]
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

function trackedPois(floor, allowedBrands = null) {
  return (floor.pois || []).map(poi => ({
    poi,
    brands: uniqueBrands([poiTitle(poi)]).filter(brand => !allowedBrands || allowedBrands.has(brand)),
  }))
    .filter(item => item.brands.length > 0);
}

function svgPolygon(shape, styles, fallback, tracked = []) {
  const points = (shape.coordinates || []).map(point => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`).join(' ');
  if (!points) return '';
  const style = styles.get((shape.style || {}).groupCode) || styles.get(shape.attributeCode) || fallback;
  const fill = style.color || fallback.color;
  const matched = uniqueBrands(tracked.filter(item => pointInPolygon(item.poi.position, shape.coordinates)).flatMap(item => item.brands));
  const highlighted = matched.length > 0;
  const stroke = highlighted ? '#f59e0b' : (style.lineColor || fallback.lineColor);
  const opacity = Number.isFinite(style.opacity) ? style.opacity / 100 : 1;
  const metadata = highlighted ? ` data-managed-brands="${xmlEscape(matched.join(', '))}"` : '';
  return `<polygon points="${points}" fill="${xmlEscape(fill)}" fill-opacity="${opacity}" stroke="${xmlEscape(stroke)}" stroke-width="${highlighted ? 6 : 1.5}"${metadata}/>`;
}

function poiTitle(poi) {
  return (languageText(poi.titleByLanguages) || languageText(poi.title) || String(poi.title || ''))
    .replace(/多樂/g, '다락')
    .replace(/外/g, '외')
    .replace(/\s+/g, ' ').trim();
}

function sanitizeOfficialSvg(rawSvg) {
  return String(rawSvg || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
}

function addSvgClassById(svg, id, className) {
  const token = `id="${id}"`;
  const idIndex = svg.indexOf(token);
  if (idIndex < 0) return svg;
  const tagStart = svg.lastIndexOf('<', idIndex);
  const tagEnd = svg.indexOf('>', idIndex);
  if (tagStart < 0 || tagEnd < 0) return svg;
  let tag = svg.slice(tagStart, tagEnd + 1);
  if (/\sclass="[^"]*"/.test(tag)) {
    tag = tag.replace(/\sclass="([^"]*)"/, (_, classes) => ` class="${`${classes} ${className}`.trim()}"`);
  } else {
    tag = tag.replace(/\s*\/?\>$/, match => ` class="${className}"${match}`);
  }
  return svg.slice(0, tagStart) + tag + svg.slice(tagEnd + 1);
}

function renderLotteFloorSvg(rawSvg, floorData, storeName, floorLabel, managedPois = [], showHighlights = true) {
  const canvasWidth = Number((floorData.size || {}).width) || Number(floorData.canvasWidth) || 1200;
  const canvasHeight = Number((floorData.size || {}).height) || Number(floorData.canvasHeight) || 900;
  const viewBox = floorData.viewBox || { x:0, y:0, width:canvasWidth, height:canvasHeight };
  const outputHeight = Math.max(1, Math.round(1200 * viewBox.height / viewBox.width));
  let svg = sanitizeOfficialSvg(rawSvg);
  svg = svg.replace(/<svg\b([^>]*)>/i, (_, rawAttributes) => {
    const attributes = rawAttributes.replace(/\s(?:viewBox|width|height|role|aria-labelledby)="[^"]*"/gi, '');
    return `<svg${attributes} viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" width="1200" height="${outputHeight}" role="img" aria-labelledby="title desc">`;
  });
  const description = `<title id="title">${xmlEscape(storeName)} ${xmlEscape(floorLabel)} 최신 쇼핑맵</title><desc id="desc">롯데백화점 공식 다비오 쇼핑맵의 최신 벡터 데이터입니다.</desc>`;
  svg = svg.replace(/(<svg\b[^>]*>)/i, `$1${description}`);
  const managedIds = new Set(showHighlights ? managedPois.map(item => item.poi.id) : []);
  if (showHighlights) managedPois.forEach(item => {
    if (item.poi.objectId) svg = addSvgClassById(svg, item.poi.objectId, 'tracked-object');
  });
  // The official SVG can contain labels saved in English or Chinese. Hide its
  // POI layer and redraw compact labels from titleByLanguages.ko, matching the
  // density and highlight treatment used by the Hyundai renderer.
  const labels = (floorData.pois || []).map(poi => {
    const position = poi.position || {};
    const title = poiTitle(poi).replace(/\s+/g, ' ').trim();
    if (!title || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    const compact = title.length > 18 ? `${title.slice(0, 17)}…` : title;
    const managed = managedIds.has(poi.id);
    return `<text class="lotte-poi-label${managed ? ' managed-brand' : ''}" x="${position.x}" y="${position.y}" text-anchor="middle" dominant-baseline="central">${xmlEscape(managed ? `★ ${compact}` : compact)}</text>`;
  }).join('');
  const mapMarkup = `<style>
[ds-type="poi"], [group-type="POI_GROUP"] { display:none !important; }
.lotte-poi-label { fill:#303633; font-family:Arial,'Noto Sans KR',sans-serif; font-size:20px; font-weight:600; stroke:#fff; stroke-width:3; paint-order:stroke; stroke-linejoin:round; }
.tracked-object { stroke:#f59e0b !important; stroke-width:8 !important; filter:drop-shadow(0 0 6px #f59e0b); }
.lotte-poi-label.managed-brand { fill:#9a5300; font-size:24px; font-weight:800; stroke:#fff7df; stroke-width:5; }
</style><g class="lotte-poi-labels">${labels}</g>`;
  return svg.replace(/\s*<\/svg>\s*$/, `${mapMarkup}</svg>\n`);
}

function renderHyundaiFloorSvg(mapData, floor, storeName, options = {}) {
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
  const showHighlights = options.showHighlights !== false;
  const managedPois = trackedPois(floor, options.allowedBrands || null);
  const managedBrands = uniqueBrands(managedPois.flatMap(item => item.brands));
  const managedLegend = managedBrands.length
    ? `<text x="${maxX}" y="${minY - 18}" text-anchor="end" font-family="Arial, 'Noto Sans KR', sans-serif" font-size="13" font-weight="700" fill="#9a5300">★ 관리 브랜드 ${managedBrands.length}개 강조</text>`
    : '';
  const viewBox = `${minX - padding} ${minY - padding} ${Math.max(1, maxX - minX + padding * 2)} ${Math.max(1, maxY - minY + padding * 2)}`;
  const labels = (floor.pois || []).map(poi => {
    const title = poiTitle(poi).trim();
    const position = poi.position || {};
    if (!title || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return '';
    const compact = title.length > 18 ? `${title.slice(0, 17)}…` : title;
    const isManaged = showHighlights && managedPois.some(item => item.poi === poi);
    return `<text x="${position.x}" y="${position.y}" text-anchor="middle" dominant-baseline="central"${isManaged ? ' class="managed-brand"' : ''}>${xmlEscape(isManaged ? `★ ${compact}` : compact)}</text>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="1200" height="1200" role="img" aria-labelledby="title desc">
  <title id="title">${xmlEscape(storeName)} ${xmlEscape(floorLabel)} 층 안내도</title>
  <desc id="desc">현대백화점 공식 층별 안내 벡터 데이터를 정적 도면으로 변환했습니다.</desc>
  <rect x="${minX - padding}" y="${minY - padding}" width="${maxX - minX + padding * 2}" height="${maxY - minY + padding * 2}" fill="${xmlEscape(theme.canvasColor || '#f7f8f7')}"/>
  <g>${(floor.sections || []).map(shape => svgPolygon(shape, sectionStyles, sectionFallback)).join('')}</g>
  <g>${(floor.objects || []).map(shape => svgPolygon(shape, objectStyles, objectFallback, showHighlights ? managedPois : [])).join('')}</g>
  <g font-family="Arial, 'Noto Sans KR', sans-serif" font-size="12" font-weight="600" fill="#303633" stroke="#fff" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${labels}</g>
${showHighlights ? `  <style>.managed-brand { fill:#9a5300; font-size:15px; font-weight:800; stroke:#fff7df; stroke-width:5; }</style>` : ''}
  <text x="${minX}" y="${minY - 18}" font-family="Arial, 'Noto Sans KR', sans-serif" font-size="20" font-weight="700" fill="#1a1f1d">${xmlEscape(storeName)} · ${xmlEscape(floorLabel)}</text>
${showHighlights ? managedLegend : ''}
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

async function fetchHyundaiFloors(storeName, branchCd, rootDir = __dirname, activeBrands = null) {
  const mapData = await fetchHyundaiMap(branchCd);
  const outputDir = path.join(rootDir, 'floor-maps', 'hyundai', branchCd);
  fs.mkdirSync(outputDir, { recursive: true });
  return (mapData.floors || []).map(floor => {
    const label = languageText(floor.name) || floor.id;
    const store = CONFIG.getStore('현대', storeName);
    const allowedBrands = isManagedFloor(store, { floor:label, label })
      ? new Set([...activeBrands].filter(brand => !isExcludedManagedBrand(store, { floor:label }, brand)))
      : new Set();
    const brands = uniqueBrands((floor.pois || []).map(poiTitle)).filter(brand => !allowedBrands || allowedBrands.has(brand));
    const fileName = `${safeFloorFileName(label)}.svg`;
    const managedFileName = `${safeFloorFileName(label)}-managed.svg`;
    fs.writeFileSync(path.join(outputDir, fileName), renderHyundaiFloorSvg(mapData, floor, storeName, { showHighlights:false, allowedBrands }), 'utf8');
    fs.writeFileSync(path.join(outputDir, managedFileName), renderHyundaiFloorSvg(mapData, floor, storeName, { showHighlights:true, allowedBrands }), 'utf8');
    return {
      floor: label, label: `${label} 층 안내도`, url: `floor-maps/hyundai/${branchCd}/${fileName}`,
      highlightUrl: `floor-maps/hyundai/${branchCd}/${managedFileName}`, source: 'hyundai-dabeeo', brands,
    };
  });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function buildBrandFloorIndex(data) {
  const index = {};
  CONFIG.storeRows.forEach(store => {
    (data[store.code] || []).forEach(floor => {
      (floor.brands || []).forEach(brand => {
        const key = `${store.id}|${brand}`;
        (index[key] ||= []).push({
          company: store.company, store: store.name, storeId: store.id,
          floor: floor.floor, label: floor.label, floorKey: `${floor.floor}|${floor.label}`, url: floor.url,
        });
      });
    });
  });
  Object.values(index).forEach(items => items.sort((a, b) => String(a.floor).localeCompare(String(b.floor), 'ko')));
  return index;
}

function buildFloorManifest(data, rootDir = __dirname) {
  const manifest = {};
  CONFIG.storeRows.forEach(store => {
    (data[store.code] || []).forEach(floor => {
      const brands = [...new Set(floor.brands || [])].sort((a, b) => a.localeCompare(b, 'ko'));
      let sourceValue = floor.url || '';
      if (String(floor.source || '').endsWith('-dabeeo')) {
        try { sourceValue = fs.readFileSync(path.join(rootDir, floor.url), 'utf8'); } catch (e) { /* URL 서명으로 대체 */ }
      }
      const key = `${store.id}|${floor.floor}|${floor.label}`;
      manifest[key] = {
        company: store.company, store: store.name, storeId: store.id,
        floor: floor.floor, label: floor.label, url: floor.url, brands,
        signature: sha256(`${sourceValue}\n${brands.join('|')}`),
      };
    });
  });
  return manifest;
}

function brandLocations(manifest) {
  const result = {};
  Object.values(manifest || {}).forEach(floor => {
    (floor.brands || []).forEach(brand => {
      const key = `${floor.storeId}|${brand}`;
      const entry = result[key] ||= { company: floor.company, store: floor.store, storeId: floor.storeId, brand, floors: [] };
      entry.floors.push(floor.floor);
    });
  });
  Object.values(result).forEach(entry => entry.floors.sort((a, b) => String(a).localeCompare(String(b), 'ko')));
  return result;
}

function detectFloorChanges(previous, current, detectedAt = new Date().toISOString()) {
  const changes = [];
  const add = event => changes.push({ detectedAt, ...event });
  const previousKeys = new Set(Object.keys(previous || {}));
  const currentKeys = new Set(Object.keys(current || {}));
  currentKeys.forEach(key => {
    const item = current[key];
    if (!previousKeys.has(key)) add({ type:'층 추가', company:item.company, store:item.store, storeId:item.storeId, floor:item.floor });
    else if (previous[key].signature !== item.signature
      && JSON.stringify(previous[key].brands || []) === JSON.stringify(item.brands || [])) {
      add({ type:'도면 변경', company:item.company, store:item.store, storeId:item.storeId, floor:item.floor });
    }
  });
  previousKeys.forEach(key => {
    if (!currentKeys.has(key)) {
      const item = previous[key];
      add({ type:'층 삭제', company:item.company, store:item.store, storeId:item.storeId, floor:item.floor });
    }
  });

  const oldLocations = brandLocations(previous);
  const newLocations = brandLocations(current);
  new Set([...Object.keys(oldLocations), ...Object.keys(newLocations)]).forEach(key => {
    const before = oldLocations[key];
    const after = newLocations[key];
    const meta = after || before;
    if (!before) add({ type:'브랜드 추가', ...meta, before:[], after:after.floors });
    else if (!after) add({ type:'브랜드 삭제', ...meta, before:before.floors, after:[] });
    else if (before.floors.join('|') !== after.floors.join('|')) {
      add({ type:'층 이동', ...meta, before:before.floors, after:after.floors });
    }
  });
  return changes;
}

async function main() {
  const data = {};
  let previous = {};
  try { previous = JSON.parse(fs.readFileSync(path.join(__dirname, 'floor-images.json'), 'utf8')).data || {}; } catch (e) { previous = {}; }
  let previousHistory = {};
  try { previousHistory = JSON.parse(fs.readFileSync(path.join(__dirname, 'floor-history.json'), 'utf8')); } catch (e) { previousHistory = {}; }
  let currentRows = [];
  try {
    const currentPayload = JSON.parse(fs.readFileSync(path.join(__dirname, 'data.json'), 'utf8'));
    currentRows = currentPayload.data || currentPayload;
  } catch (e) { currentRows = []; }
  const activeBrandMap = activeBrandsByStore(currentRows);
  const diagnostics = [];

  for (const [store, code] of Object.entries(SHINSEGAE_STORES)) {
    process.stdout.write(`수집 중: 신세계 ${store} ... `);
    try {
      const storeConfig = CONFIG.getStore('신세계', store);
      data[code] = verifyFloorEntries(storeConfig, await fetchShinsegaeFloors(code), activeBrandMap.get(storeConfig.id) || new Set());
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
      const storeConfig = CONFIG.getStore('롯데', store);
      const result = await fetchLotteFloors(store, code, __dirname, activeBrandMap.get(storeConfig.id) || new Set());
      data[code] = result.floors;
      if (result.failedPages > 0 && (previous[code] || []).length) throw new Error(`${result.failedPages}/${result.expectedPages}개 층 호출 실패`);
      if (data[code].length === 0 && (previous[code] || []).length) throw new Error('0개 층 응답');
      diagnostics.push({ storeId: `롯데-${code}`, store, status: 'ok', floors: data[code].length, format:'svg' });
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
      const storeConfig = CONFIG.getStore('현대', store);
      data[code] = await fetchHyundaiFloors(store, code, __dirname, activeBrandMap.get(storeConfig.id) || new Set());
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

  const lastUpdated = new Date().toISOString();
  const output = { lastUpdated, diagnostics, data };
  fs.writeFileSync(path.join(__dirname, 'floor-images.json'), JSON.stringify(output, null, 2), 'utf8');
  const brandIndex = buildBrandFloorIndex(data);
  fs.writeFileSync(path.join(__dirname, 'brand-floor-index.json'), JSON.stringify({ lastUpdated, data: brandIndex }, null, 2), 'utf8');
  const currentManifest = buildFloorManifest(data);
  const historySchemaVersion = 5;
  const sameHistorySchema = previousHistory.schemaVersion === historySchemaVersion;
  const newEvents = previousHistory.current && sameHistorySchema
    ? detectFloorChanges(previousHistory.current, currentManifest, lastUpdated)
    : [];
  const floorHistory = {
    schemaVersion: historySchemaVersion,
    lastUpdated,
    events: sameHistorySchema ? [...newEvents, ...(previousHistory.events || [])].slice(0, 500) : [],
    current: currentManifest,
  };
  fs.writeFileSync(path.join(__dirname, 'floor-history.json'), JSON.stringify(floorHistory, null, 2), 'utf8');
  console.log(`\n완료: floor-images.json, brand-floor-index.json, floor-history.json 저장 (변경 ${newEvents.length}건)`);
}

if (require.main === module) {
  main().catch(e => {
    console.error('층 도면 크롤러 실행 중 오류:', e);
    process.exit(1);
  });
}

module.exports = {
  extractFloorNum, htmlValue, languageText, safeFloorFileName,
  pointInPolygon, uniqueBrands, isManagedFloor, isExcludedManagedBrand, activeBrandsByStore, verifyFloorEntries,
  sanitizeOfficialSvg, addSvgClassById, renderLotteFloorSvg, fetchLotteFloors,
  dabeeoMetadataValue, lottePoiMetadata, lotteFloorViewBox, scopeLotteFloorData,
  renderHyundaiFloorSvg, fetchHyundaiMap, fetchHyundaiFloors,
  buildBrandFloorIndex, buildFloorManifest, detectFloorChanges,
};
