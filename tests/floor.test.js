const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const CONFIG = require('../config');
const {
  htmlValue, languageText, safeFloorFileName, renderHyundaiFloorSvg,
  isManagedFloor, isExcludedManagedBrand, activeBrandsByStore, verifyFloorEntries, trackedPois,
  sanitizeOfficialSvg, addSvgClassById, renderLotteFloorSvg,
  lottePoiMetadata, lotteFloorViewBox, scopeLotteFloorData,
  buildBrandFloorIndex, detectFloorChanges,
} = require('../floor-crawler');

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

test('현대 도면에서 관리 브랜드 라벨과 구획을 강조한다', () => {
  const mapData = {
    size: { width: 100, height: 100 },
    themes: [{ defaultYn: true, objectStyles: [{ groupCode:'SHOP', color:'#eee', lineColor:'#999', opacity:100 }] }],
  };
  const floor = {
    id:'4F', name:[{ lang:'ko', text:'4F' }], sections:[],
    objects:[{ attributeCode:'SHOP', style:{ groupCode:'SHOP' }, coordinates:[{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100}] }],
    pois:[{ title:'타임옴므', position:{x:50,y:50} }],
  };
  const svg = renderHyundaiFloorSvg(mapData, floor, '본점');
  assert.match(svg, /data-managed-brands="타임옴므"/);
  assert.match(svg, /class="managed-brand"/);
  assert.match(svg, /★ 타임옴므/);
  const normalSvg = renderHyundaiFloorSvg(mapData, floor, '본점', { showHighlights:false });
  assert.doesNotMatch(normalSvg, /managed-brand|★ 타임옴므|data-managed-brands/);
});

test('롯데 최신 SVG는 매장 구획과 POI 위치를 강조하고 일반판에는 남기지 않는다', () => {
  const rawSvg = '<svg xmlns="http://www.w3.org/2000/svg"><path id="object-1" class="" onload="bad()"/><g id="poi-1" class=""><text>타임옴므</text></g><script>bad()</script></svg>';
  const poi = { id:'poi-1', objectId:'object-1', title:'타임옴므', position:{ x:500, y:400 } };
  const floor = { size:{ width:1000, height:800 }, pois:[poi] };
  const tracked = [{ poi, brands:['타임옴므'] }];
  const normal = renderLotteFloorSvg(rawSvg, floor, '잠실점', '05F', tracked, false);
  const highlighted = renderLotteFloorSvg(rawSvg, floor, '잠실점', '05F', tracked, true);
  assert.doesNotMatch(normal, /class="tracked-object"|★|<script|onload=/);
  assert.match(highlighted, /class="tracked-object"/);
  assert.match(highlighted, /class="lotte-poi-label managed-brand"/);
  assert.match(highlighted, />★ /);
  assert.equal(addSvgClassById('<svg><path id="x"/></svg>', 'x', 'marked'), '<svg><path id="x" class="marked"/></svg>');
  assert.equal(sanitizeOfficialSvg('<svg onclick="x()"><script>x()</script></svg>'), '<svg></svg>');
});

test('Lotte labels use the Korean API translation instead of the raw SVG locale', () => {
  const rawSvg = '<svg><g ds-type="poi"><text>TIME HOMME</text></g></svg>';
  const poi = {
    id:'poi-ko', title:'TIME HOMME', position:{ x:100, y:100 },
    titleByLanguages:[{ lang:'en', text:'TIME HOMME' }, { lang:'ko', text:'\uD0C0\uC784\uC634\uBBC0' }],
  };
  const svg = renderLotteFloorSvg(rawSvg, { size:{ width:200, height:200 }, pois:[poi] }, 'store', '5F', [], false);
  assert.match(svg, />\uD0C0\uC784\uC634\uBBC0<\/text>/);
  assert.match(svg, /\[ds-type="poi"\].*display:none/);
});

test('롯데 복합점 도면은 해당 점포와 층의 POI만 선별해 크롭한다', () => {
  const definitions = [
    { fieldKey:'cstrCd' }, { fieldKey:'cstrTownCd' }, { fieldKey:'cstrFlrCd' },
  ];
  const poi = (id, x, store, floor) => ({
    id, objectId:`object-${id}`, title:id, position:{ x, y:500 },
    metadatas:[
      { fieldRef:0, valueSingle:store },
      { fieldRef:1, valueSingle:'TOWN' },
      { fieldRef:2, valueSingle:floor },
    ],
  });
  const floorData = {
    size:{ width:10000, height:5000 }, metadataFieldDefs:definitions,
    pois:[poi('target', 2000, '0002', '05'), poi('other', 8000, '0348', '05')],
    objects:[
      { id:'object-target', position:{ x:2000, y:500 }, size:{ width:200, height:100 } },
      { id:'object-other', position:{ x:8000, y:500 }, size:{ width:200, height:100 } },
    ],
  };
  assert.equal(lottePoiMetadata(floorData.pois[0], floorData).cstrCd, '0002');
  const scoped = scopeLotteFloorData(floorData, '0002', '05', 'TOWN');
  assert.deepEqual(scoped.pois.map(item => item.id), ['target']);
  assert.ok(scoped.viewBox.x < 2000 && scoped.viewBox.x + scoped.viewBox.width < 8000);
  assert.deepEqual(lotteFloorViewBox(floorData, [], { pcXcnts:7000, pcYcnts:2000 }), {
    x:4900, y:500, width:4200, height:3000,
  });
});

test('공식 남성층과 현재 입점 브랜드를 교차 검증한다', () => {
  const hyundai = CONFIG.getStore('현대', '목동');
  assert.equal(isManagedFloor(hyundai, { floor:'4F', label:'4F 층 안내도' }), false);
  assert.equal(isManagedFloor(hyundai, { floor:'B1', label:'B1 층 안내도' }), true);
  const jungdongWest = { ...CONFIG.getStore('현대', '중동'), code:'B00143100' };
  assert.equal(isManagedFloor(jungdongWest, { floor:'1F', label:'1F Trend' }), true);
  const lotte = CONFIG.getStore('롯데', '잠실점');
  assert.equal(isManagedFloor(lotte, { floor:'08F', label:'8F 아동ㆍ유아' }), false);
  const dongtan = CONFIG.getStore('롯데', '동탄점');
  const jeonju = CONFIG.getStore('롯데', '전주점');
  assert.equal(isExcludedManagedBrand(dongtan, { floor:'02F' }, '띠어리맨'), true);
  assert.equal(isExcludedManagedBrand(dongtan, { floor:'04F' }, '띠어리맨'), false);
  assert.equal(isExcludedManagedBrand(jeonju, { floor:'02F' }, '띠어리맨'), true);
  assert.equal(isExcludedManagedBrand(jeonju, { floor:'04F' }, '띠어리맨'), false);
  const nowon = CONFIG.getStore('롯데', '노원점');
  const pyeongchon = CONFIG.getStore('롯데', '평촌점');
  assert.equal(isExcludedManagedBrand(nowon, { floor:'03F' }, '띠어리맨'), true);
  assert.equal(isExcludedManagedBrand(nowon, { floor:'03F' }, '클럽모나코'), true);
  assert.equal(isExcludedManagedBrand(pyeongchon, { floor:'02F' }, '클럽모나코'), true);
  const active = activeBrandsByStore([
    { company:'현대', store:'목동', brand:'띠어리맨', note:'' },
    { company:'롯데', store:'울산점', brand:'(확인된 브랜드 없음)', note:'확인' },
  ]);
  assert.equal(active.get('롯데-0015').size, 0);
  const floors = verifyFloorEntries(hyundai, [
    { floor:'4F', label:'4F 층 안내도', brands:['띠어리맨'] },
    { floor:'B1', label:'B1 층 안내도', brands:['띠어리맨','POTTERY'] },
  ], active.get(hyundai.id));
  assert.deepEqual(floors[0].brands, []);
  assert.deepEqual(floors[1].brands, ['띠어리맨']);
});

test('질스튜어트 단독 POI는 공식 남성층에서만 뉴욕 매장으로 보완한다', () => {
  const floor = { pois:[{ title:'질스튜어트', position:{ x:10, y:10 } }] };
  assert.deepEqual(trackedPois(floor, new Set(['질스튜어트뉴욕']), { floorLabel:'5F 남성패션' })[0].brands, ['질스튜어트뉴욕']);
  assert.deepEqual(trackedPois(floor, new Set(['질스튜어트뉴욕']), { floorLabel:'3F 여성패션' }), []);
});

test('브랜드별 정확한 층 인덱스와 도면 변경 이력을 만든다', () => {
  const store = CONFIG.storeRows[0];
  const data = { [store.code]: [{ floor:'4F', label:'4F 안내도', url:'map.svg', brands:['타임옴므'] }] };
  const index = buildBrandFloorIndex(data);
  assert.equal(index[`${store.id}|타임옴므`][0].floor, '4F');

  const base = { [`${store.id}|4F`]: { company:store.company, store:store.name, storeId:store.id, floor:'4F', brands:['타임옴므'], signature:'a' } };
  const moved = { [`${store.id}|5F`]: { company:store.company, store:store.name, storeId:store.id, floor:'5F', brands:['타임옴므'], signature:'b' } };
  const changes = detectFloorChanges(base, moved, '2026-09-14T00:00:00.000Z');
  assert.ok(changes.some(change => change.type === '층 이동' && change.before[0] === '4F' && change.after[0] === '5F'));
});

test('동탄점과 전주점 띠어리는 여성 2F를 제외하고 남성 4F만 연결한다', () => {
  const images = require('../floor-images.json').data;
  const index = require('../brand-floor-index.json').data;
  [['0399', '동탄점'], ['0025', '전주점']].forEach(([code, store]) => {
    const theoryFloors = (images[code] || [])
      .filter(floor => (floor.brands || []).includes('띠어리맨'))
      .map(floor => floor.floor);
    assert.deepEqual(theoryFloors, ['04F'], `${store} 도면의 띠어리 층이 잘못됨`);
    assert.deepEqual((index[`롯데-${code}|띠어리맨`] || []).map(item => item.floor), ['04F']);
  });
});

test('관리 브랜드는 같은 점포에서 남성층 한 곳에만 연결한다', () => {
  const index = require('../brand-floor-index.json').data;
  const duplicates = Object.entries(index)
    .filter(([, locations]) => new Set(locations.map(item => item.floor)).size > 1)
    .map(([key, locations]) => ({ key, floors:locations.map(item => item.floor) }));
  assert.deepEqual(duplicates, []);
});

test('질스튜어트뉴욕은 액세서리 전용 본점을 제외한 현재 19개 점포 도면에 연결한다', () => {
  const rows = require('../data.json').data.filter(row => row.brand === '질스튜어트뉴욕' && !/(퇴점|누락)/.test(row.note || ''));
  const index = require('../brand-floor-index.json').data;
  const missing = rows.filter(row => row.storeId !== '롯데-0001' && !(index[`${row.storeId}|질스튜어트뉴욕`] || []).length);
  assert.deepEqual(missing, []);
  assert.equal(rows.length, 20);
  assert.equal(Object.keys(index).filter(key => key.endsWith('|질스튜어트뉴욕')).length, 19);
  assert.deepEqual((index['롯데-0005|질스튜어트뉴욕'] || []).map(item => item.floor), ['04F']);
});

test('잠실점 신규 오픈 2개 브랜드는 공식 5F POI와 강조 도면에 연결한다', () => {
  const images = require('../floor-images.json').data['0002'];
  const index = require('../brand-floor-index.json').data;
  const floor = images.find(item => item.floor === '05F');
  assert.ok(floor);
  assert.ok(floor.brands.includes('아페쎄맨'));
  assert.ok(floor.brands.includes('CP컴퍼니'));
  assert.equal('pendingPoiBrands' in floor, false);
  assert.deepEqual((index['롯데-0002|아페쎄맨'] || []).map(item => item.floor), ['05F']);
  assert.deepEqual((index['롯데-0002|CP컴퍼니'] || []).map(item => item.floor), ['05F']);
  const svg = fs.readFileSync(path.join(__dirname, '..', floor.highlightUrl), 'utf8');
  assert.match(svg, /★ A\.P\.C맨/);
  assert.match(svg, /★ C\.P\. Company/);
});

test('현대 중동과 판교 CP컴퍼니는 각 공식 남성 도면에 연결한다', () => {
  const index = require('../brand-floor-index.json').data;
  assert.deepEqual((index['현대-B00143000|CP컴퍼니'] || []).map(item => item.floor), ['WEST 1F']);
  assert.deepEqual((index['현대-B00148000|CP컴퍼니'] || []).map(item => item.floor), ['6F']);
  const middleSvg = fs.readFileSync(path.join(__dirname, '..', 'floor-maps/hyundai/B00143100/1F-managed.svg'), 'utf8');
  const pangyoSvg = fs.readFileSync(path.join(__dirname, '..', 'floor-maps/hyundai/B00148000/6F-managed.svg'), 'utf8');
  assert.match(middleSvg, /★ CP 컴퍼니/);
  assert.match(pangyoSvg, /★ C\.P\.컴퍼니/);
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
      assert.ok(floor.url.startsWith('floor-maps/hyundai/'));
      assert.ok(fs.existsSync(path.join(__dirname, '..', floor.url)), `${floor.url} 파일 없음`);
    });
  });
});

test('롯데 19개 지점의 최신 일반·강조 SVG가 모두 연결된다', () => {
  const payload = require('../floor-images.json');
  const stores = CONFIG.storeRows.filter(store => store.company === '롯데');
  assert.equal(stores.length, 19);
  stores.forEach(store => {
    const floors = payload.data[store.code];
    assert.ok(Array.isArray(floors) && floors.length > 0, `${store.name} 도면 없음`);
    floors.forEach(floor => {
      assert.equal(floor.source, 'lotte-dabeeo');
      assert.ok(floor.url.startsWith(`floor-maps/lotte/${store.code}/`));
      assert.ok(floor.highlightUrl.startsWith(`floor-maps/lotte/${store.code}/`));
      assert.ok(fs.existsSync(path.join(__dirname, '..', floor.url)), `${floor.url} 파일 없음`);
      assert.ok(fs.existsSync(path.join(__dirname, '..', floor.highlightUrl)), `${floor.highlightUrl} 파일 없음`);
    });
  });
});
