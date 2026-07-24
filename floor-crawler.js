// 신세계 지점별 층 안내도 이미지 크롤러 — floor.do 페이지에 CMS로 올라와 있는
// 실제 층별 안내도 이미지 URL을 모아 floor-images.json으로 저장.
// 롯데/현대는 자체 인터랙티브 지도(서드파티 SDK, 평면 이미지 없음)라 대상에서 제외.
const fs = require('fs');
const path = require('path');

const SHINSEGAE_STORES = {
  '강남': 'SC00002', '광주': 'SC00006', '김해': 'SC00011', '대구': 'SC00013', '대전': 'SC00060',
  '마산': 'SC00005', '본점': 'SC00001', '센텀': 'SC00008', '의정부': 'SC00010',
  '천안아산': 'SC00009', '타임스퀘어': 'SC00003', '하남': 'SC00012', '경기': 'SC00007',
};

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function extractFloorNum(label) {
  const m = label.match(/^\s*(B\d+|\d+)\s*F?/i);
  return m ? m[1].toUpperCase() + 'F' : '';
}

async function fetchStoreFloors(storeCode) {
  const url = `https://www.shinsegae.com/store/floor.do?storeCd=${storeCode}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
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

async function main() {
  const data = {};
  for (const [store, code] of Object.entries(SHINSEGAE_STORES)) {
    process.stdout.write(`수집 중: 신세계 ${store} ... `);
    try {
      data[code] = await fetchStoreFloors(code);
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
