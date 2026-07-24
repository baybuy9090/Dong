// 지점별 층 안내도 이미지 크롤러 — 신세계/롯데 지점의 실제 층별 안내도 이미지
// URL을 모아 floor-images.json으로 저장 (지점 코드 기준, 회사 구분 없이 한 파일에 병합).
// 현대는 다비오(Dabeeo) 서드파티 SDK로만 지도를 렌더링하고 평면 이미지가 없어 제외.
const fs = require('fs');
const path = require('path');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ── 신세계: floor.do 페이지에 CMS로 올라온 층별 안내도 이미지가 그대로 있음 ──
const SHINSEGAE_STORES = {
  '강남': 'SC00002', '광주': 'SC00006', '김해': 'SC00011', '대구': 'SC00013', '대전': 'SC00060',
  '마산': 'SC00005', '본점': 'SC00001', '센텀': 'SC00008', '의정부': 'SC00010',
  '천안아산': 'SC00009', '타임스퀘어': 'SC00003', '하남': 'SC00012', '경기': 'SC00007',
};

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
const LOTTE_STORES = {
  '강남점': '0013', '광복점': '0333', '광주점': '0007', '노원점': '0022', '대구점': '0023',
  '동탄점': '0399', '본점': '0001', '부산본점': '0005', '수원점': '0349', '영등포': '0010',
  '울산점': '0015', '인천점': '0344', '일산': '0011', '잠실점': '0002', '잠실에비뉴엘': '0348',
  '전주점': '0025', '창원점': '0017', '청량리': '0004', '평촌점': '0341',
};

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
  for (const { townCd, flrCd } of floorItems) {
    try {
      const detail = await fetchLotteFloorDetail(cstrCd, townCd, flrCd);
      if (detail) floors.push(detail);
    } catch (e) {
      console.error(`  [롯데 ${cstrCd} ${flrCd}F] 실패:`, e.message);
    }
    await sleep(250);
  }
  return floors;
}

async function main() {
  const data = {};

  for (const [store, code] of Object.entries(SHINSEGAE_STORES)) {
    process.stdout.write(`수집 중: 신세계 ${store} ... `);
    try {
      data[code] = await fetchShinsegaeFloors(code);
      console.log(`${data[code].length}개 층`);
    } catch (e) {
      console.error('실패:', e.message);
      data[code] = [];
    }
    await sleep(400);
  }

  for (const [store, code] of Object.entries(LOTTE_STORES)) {
    process.stdout.write(`수집 중: 롯데 ${store} ... `);
    try {
      data[code] = await fetchLotteFloors(code);
      console.log(`${data[code].length}개 층`);
    } catch (e) {
      console.error('실패:', e.message);
      data[code] = [];
    }
    await sleep(400);
  }

  const output = { lastUpdated: new Date().toISOString(), data };
  fs.writeFileSync(path.join(__dirname, 'floor-images.json'), JSON.stringify(output, null, 2), 'utf8');
  console.log('\n완료: floor-images.json 저장');
}

main().catch(e => {
  console.error('층 도면 크롤러 실행 중 오류:', e);
  process.exit(1);
});
