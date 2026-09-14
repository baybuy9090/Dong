const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CONFIG = require('../config');
const { htmlValue, languageText, safeFloorFileName, renderHyundaiFloorSvg } = require('../floor-crawler');

test('현대 공식 페이지의 공개 지도 설정값을 읽는다', () => {
  const html = '<input id="dabeeo_client_id" value="client"><input value="secret" id="dabeeo_client_secret">';
  assert.equal(htmlValue(html, 'dabeeo_client_id'), 'client');
  assert.equal(htmlValue(html, 'dabeeo_client_secret'), 'secret');
});

test('현대 벡터 도면을 안전한 SVG로 변환한다', () => {
  const mapData = {
    size: { width: 100, height: 100 },
    themes: [{ defaultYn: true, canvasColor: '#fff', objectStyles: [{ groupCode:'OB-SHOPPING', color:'#eee', lineColor:'#999', opacity:100 }] }],
  };
  const floor = {
    id: 'floor-1', name: [{ lang:'ko', text:'4F' }], sections: [],
    objects: [{ attributeCode:'OB-SHOPPING', style:{ groupCode:'OB-SHOPPING' }, coordinates:[{x:10,y:10},{x:90,y:10},{x:90,y:90},{x:10,y:90}] }],
    pois: [{ title:'브랜드 & 매장', position:{x:50,y:50} }],
  };
  const svg = renderHyundaiFloorSvg(mapData, floor, '본점');
  assert.match(svg, /<svg/);
  assert.match(svg, /브랜드 &amp; 매장/);
  assert.match(svg, /본점 · 4F/);
  assert.equal(languageText(floor.name), '4F');
  assert.equal(safeFloorFileName('B1/F'), 'B1_F');
});

test('현대 13개 지점의 생성된 SVG 도면이 데이터 파일과 연결된다', () => {
  const payload = require('../floor-images.json');
  const stores = CONFIG.storeRows.filter(store => store.company === '현대');
  assert.equal(stores.length, 13);
  stores.forEach(store => {
    const floors = payload.data[store.code];
    assert.ok(Array.isArray(floors) && floors.length > 0, `${store.name} 도면 없음`);
    floors.forEach(floor => {
      assert.equal(floor.source, 'hyundai-dabeeo');
      assert.ok(floor.url.startsWith(`floor-maps/hyundai/${store.code}/`));
      assert.ok(fs.existsSync(path.join(__dirname, '..', floor.url)), `${floor.url} 파일 없음`);
    });
  });
});
