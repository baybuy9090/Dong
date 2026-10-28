(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Market = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function buildComparison({ stores, brands, payload, baseId, peerIds, decisions = {} }) {
    const selected = [baseId, ...new Set(peerIds.filter(id => id !== baseId))]
      .map(id => stores.find(store => store.id === id)).filter(Boolean);
    const diagnostics = new Map((payload.diagnostics || []).map(item => [item.storeId, item]));
    const rows = new Map();
    (payload.data || []).forEach(row => {
      const store = stores.find(store => store.id === row.storeId || (store.company === row.company && [store.name, ...(store.aliases || [])].includes(row.store)));
      if (store && brands.includes(row.brand)) rows.set(`${store.id}|${row.brand}`, row);
    });
    function cell(store, brand) {
      const key = `${store.id}|${brand}`;
      const row = rows.get(key);
      if (decisions[key] === 'reject') return { state: 'absent', reason: '검토 후 삭제 확정', row };
      if (decisions[key] === 'confirm') return { state: 'present', reason: '사용자 입점 확인', row };
      const note = row?.note || '';
      if (row?.dataQuality === 'manual') return { state: 'present', reason: '수동 검토 확인', row };
      if (row && (row.dataQuality === 'stale' || /재확인|수집 오류|수집 지연|캐시 의심|확인 필요/.test(note))) return { state: 'unknown', reason: note || '수집 지연', row };
      if (diagnostics.get(store.id)?.status !== 'ok') return { state: 'unknown', reason: '점포 정상 수집 확인 불가', row };
      if (!row || /퇴점|누락/.test(note)) return { state: 'absent', reason: row ? note : '현재 수집 자료에 없음', row };
      return { state: 'present', reason: note || '수집 확인', row };
    }
    const items = brands.map(brand => {
      const cells = selected.map(store => cell(store, brand));
      const base = cells[0];
      const peers = cells.slice(1);
      const peerCount = peers.filter(item => item.state === 'present').length;
      let category = 'uncertain';
      if (!peers.length) category = base?.state === 'present' ? 'base' : 'uncertain';
      else if (base?.state === 'present' && peerCount) category = 'common';
      else if (base?.state === 'present' && peers.every(item => item.state === 'absent')) category = 'exclusive';
      else if (base?.state === 'absent' && peerCount) category = 'candidate';
      else if (cells.every(item => item.state === 'absent')) category = cells.some(item => /이번 달 퇴점/.test(item.row?.note || '')) ? 'exit' : 'empty';
      return { brand, cells, category, peerCount, uncertain: cells.some(item => item.state === 'unknown') };
    }).filter(item => item.category !== 'empty');
    items.sort((left, right) => right.peerCount - left.peerCount || left.brand.localeCompare(right.brand, 'ko'));
    return { selected, items, counts: {
      base: items.filter(item => item.cells[0]?.state === 'present').length,
      common: items.filter(item => item.category === 'common').length,
      exclusive: items.filter(item => item.category === 'exclusive').length,
      candidate: items.filter(item => item.category === 'candidate').length,
      uncertain: items.filter(item => item.uncertain).length,
    } };
  }

  function marketStores(stores) {
    return stores.filter(store => store.id !== '롯데-0015');
  }

  function createUI(config, hooks) {
    config = { ...config, storeRows: marketStores(config.storeRows) };
    const container = document.getElementById('marketView');
    const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const label = store => `${store.company} ${store.name === '수원점' ? '수원' : store.name}`;

    const stateLabels = { present: '● 입점', absent: '— 자료 없음', unknown: '? 수집 미확정' };
    let baseId = config.getStore('롯데', '본점').id;
    let peers = [];
    let snapshot = 'latest';
    let payload = null;
    let reviews = [];
    let history = [];
    let section = 'all';
    let tier = '';
    let query = '';
    let loading = true;
    let error = '';
    let supportWarning = '';
    let generation = 0;
    let model;
    const base = () => config.storeRows.find(store => store.id === baseId);
    const automaticPeers = () => config.storeRows.filter(store => store.id !== baseId && store.region === base().region).map(store => store.id);
    peers = automaticPeers();
    async function json(url) {
      const response = await fetch(`${url}?_=${Date.now()}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    }
    async function load() {
      const request = ++generation;
      loading = true; error = ''; payload = null; render();
      try {
        const result = await json(snapshot === 'latest' ? 'data.json' : `history/${snapshot}.json`);
        if (!Array.isArray(result.data)) throw new Error('입점 데이터 형식 오류');
        if (request !== generation) return;
        payload = result;
      } catch (failure) {
        if (request !== generation) return;
        error = `자료를 불러오지 못했습니다 (${failure.message}). 다시 시도해 주세요.`;
      }
      if (request === generation) { loading = false; render(); }
    }
    function decisions() {
      if (snapshot !== 'latest') return {};
      const result = {};
      reviews.forEach(review => { result[review.key || `${review.storeId || config.storeId(review.company, review.store)}|${review.brand}`] = review.decision; });
      return { ...result, ...hooks.overrides() };
    }
    function visibleItems() {
      return model.items.filter(item => (!tier || hooks.tier(item.brand) === tier) && item.brand.toLowerCase().includes(query.toLowerCase()) &&
        (section === 'all' || (section === 'uncertain' ? item.uncertain : section === 'changes' ? item.cells.some(cell => /이번 달 신규 입점|이번 달 퇴점/.test(cell.row?.note || '')) : item.category === section)));
    }
    function render() {
      if (payload) model = buildComparison({ stores: config.storeRows, brands: config.brands, payload, baseId, peerIds: peers, decisions: decisions() });
      const auto = automaticPeers();
      const custom = peers.length !== auto.length || peers.some(id => !auto.includes(id));
      const options = config.storeRows.filter(store => store.company === '롯데').map(store => `<option value="${escape(store.id)}" ${store.id === baseId ? 'selected' : ''}>${escape(label(store))} · ${escape(store.region)}</option>`).join('');
      container.innerHTML = `
        <header class="market-hero"><div><div class="market-eyebrow">STORE-BY-STORE COMPARISON</div><h2>점별 비교 <span>기준 점포 vs 비교 점포 브랜드 구성</span></h2><p>공통·단독 보유 브랜드와 비교 점포에만 있는 브랜드를 한눈에 확인하세요.</p></div><div class="market-actions"><button data-action="export" ${!payload ? 'disabled' : ''}>엑셀 내보내기</button><button data-action="print" ${!payload ? 'disabled' : ''}>보고용 인쇄</button></div></header>
        <section class="market-controls"><div class="market-selects"><label>기준 점포<select id="marketBase">${options}</select></label><label>기준 시점<select id="marketSnapshot"><option value="latest">최신 수집</option>${history.map(key => `<option value="${key}" ${key === snapshot ? 'selected' : ''}>${key} 기록</option>`).join('')}</select></label><button data-action="auto">같은 상권 자동 선택</button></div>
        <div class="market-context"><b>${escape(base().region)}</b><span>${custom ? '사용자 지정 비교' : '동일 상권 · 점포 비교'} · 비교 점포 ${peers.length}곳</span></div>
        <details class="market-picker"><summary>비교 점포 편집 · 같은 회사 또는 다른 상권도 추가할 수 있습니다</summary><div class="market-store-grid">${config.storeRows.filter(store => store.id !== baseId).map(store => `<label><input type="checkbox" data-peer="${escape(store.id)}" ${peers.includes(store.id) ? 'checked' : ''}><span>${escape(label(store))}<small>${escape(store.region)}</small></span></label>`).join('')}</div></details>
        <div class="market-chips">${peers.map(id => config.storeRows.find(store => store.id === id)).map(store => `<button data-remove="${escape(store.id)}" aria-label="${escape(label(store))} 비교 제외">${escape(label(store))} ×</button>`).join('') || '<span>비교 점포가 없습니다. 위에서 비교할 점포를 선택하세요.</span>'}</div></section>
        <div aria-live="polite" class="market-status">${loading ? '비교 자료를 불러오는 중입니다…' : error ? `${escape(error)} <button data-action="retry">재시도</button>` : `수집 기준: ${escape(new Date(payload.lastUpdated).toLocaleString('ko-KR'))} · 월간 비교: ${escape(payload.comparisonAsOf || payload.monthStartSnapshot || '기준 없음')} ${snapshot !== 'latest' ? '· 과거 기록에는 현재 검토 결정을 소급 적용하지 않습니다.' : ''}`} ${escape(supportWarning)}</div>
        ${!payload ? '' : content()}`;
    }
    function content() {
      const cards = [['base', '기준 점포 입점', '브랜드', '기준 점포에서 확인된 전체 브랜드'], ['common', '공통 보유', '브랜드', '기준 점포와 비교 점포 모두 보유'],
        ['exclusive', '기준 점포에만', '브랜드', '비교 점포에는 자료 없음'], ['candidate', '비교 점포에만', '브랜드', '기준 점포에는 자료 없음 · 검토 대상']];
      const items = visibleItems();
      const tabs = [['all', '입점 구성'], ['changes', '월간 변화']];
      const tierNames = Object.keys(config.brandTiers);
      const totals = model.selected.map((store, index) => {
        const present = model.items.filter(item => item.cells[index].state === 'present');
        return { store, count: present.length, uncertain: model.items.filter(item => item.cells[index].state === 'unknown').length,
          tiers: tierNames.map(name => ({ name, count: present.filter(item => hooks.tier(item.brand) === name).length })).filter(entry => entry.count) };
      });
      const max = Math.max(1, ...totals.map(item => item.count));
      const tierColor = name => (hooks.tierColor ? hooks.tierColor(name) : '#7d8f99');
      const categoryLabels = { common: '공통', exclusive: '기준점 단독', candidate: '비교점에만', base: '', uncertain: '미확정', exit: '퇴점' };
      return `<div class="market-kpis">${cards.map(([key, title, unit, hint]) => `<button type="button" class="market-kpi market-kpi-${key}" data-section="${key === 'base' ? 'all' : key}" aria-pressed="${section === key || (key === 'base' && section === 'all')}"><span>${title}</span><strong>${key !== 'base' && !peers.length ? '—' : model.counts[key]}<small>${unit}</small></strong><em>${hint}</em></button>`).join('')}</div>
        <div class="market-note">선택한 비교 점포 내 결과입니다. ‘자료 없음’은 미입점 확정이 아닙니다. 수집 미확정 ${model.counts.uncertain}개 브랜드는 집계에서 구분합니다. 매출·면적·계약 조건은 별도 검토가 필요합니다.</div>
        <section class="market-panel"><h3>점포별 브랜드 구성 <small>확인된 브랜드 수 · 막대 색은 티어</small></h3><div class="market-bars">${totals.map(({ store, count, uncertain, tiers }, index) => `<div class="market-bar-row${index === 0 ? ' is-base' : ''}"><span><i class="market-company-dot" style="background:${hooks.color(store.company)}"></i>${escape(label(store))}${index === 0 ? '<em>기준</em>' : ''}</span><div class="market-track" style="width:${count / max * 100}%">${tiers.map(entry => `<i style="width:${entry.count / count * 100}%;background:${tierColor(entry.name)}" title="${escape(entry.name)} ${entry.count}개"></i>`).join('')}</div><b>${count}개</b><small>${uncertain ? `수집 미확정 ${uncertain}` : ''}</small></div>`).join('')}</div>
        <div class="market-tier-legend">${tierNames.filter(name => totals.some(t => t.tiers.some(entry => entry.name === name))).map(name => `<span><i style="background:${tierColor(name)}"></i>${escape(name)}</span>`).join('')}</div></section>
        <section class="market-panel"><div class="market-toolbar"><div class="market-sections" role="group" aria-label="비교 결과 유형">${tabs.map(([key, name]) => `<button data-section="${key}" aria-pressed="${section === key}">${name}</button>`).join('')}</div><div class="market-search"><label>티어<select id="marketTier"><option value="">전체</option>${Object.keys(config.brandTiers).map(name => `<option ${name === tier ? 'selected' : ''}>${escape(name)}</option>`).join('')}</select></label><label>브랜드 검색<input id="marketQuery" value="${escape(query)}" placeholder="브랜드명 입력"></label></div></div>
        <p class="market-result-count">${items.length}개 브랜드${['common', 'exclusive', 'candidate'].includes(section) ? ` · ${escape(cards.find(card => card[0] === section)[1])}만 보는 중` : ''} · 요약 카드는 전체 비교 기준이며, 카드를 누르면 해당 브랜드만 표로 볼 수 있습니다.${section === 'changes' ? ' 선택 기록의 월간 확정 변화만 표시합니다.' : ''}</p>
        <div class="market-table-wrap" tabindex="0" aria-label="점포별 브랜드 비교표, 가로 스크롤 가능"><table class="market-table"><thead><tr><th>브랜드 / 점포</th>${model.selected.map((store, index) => `<th${index === 0 ? ' class="market-base-col"' : ''}>${index === 0 ? '기준 · ' : ''}${escape(label(store))}<small>${escape(store.region)}</small></th>`).join('')}</tr></thead><tbody>${items.map(item => `<tr><th>${escape(item.brand)}<small>${escape(hooks.tier(item.brand))}${categoryLabels[item.category] ? ` · <span class="market-cat market-cat-${item.category}">${categoryLabels[item.category]}</span>` : ''}</small></th>${item.cells.map((cell, index) => `<td class="market-cell-${cell.state}${index === 0 ? ' market-base-col' : ''}" title="${escape(cell.reason)}">${stateLabels[cell.state]}${section === 'changes' ? `<small>${escape(cell.row?.note || '')}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${!items.length ? '<div class="market-empty">해당 조건의 브랜드가 없습니다. 비교 점포 또는 필터를 변경해 주세요.</div>' : ''}</section>`;
    }
    container.addEventListener('change', event => {
      const element = event.target;
      if (element.id === 'marketBase') {
        if (!config.storeRows.some(store => store.id === element.value && store.company === '롯데')) return;
        baseId = element.value; peers = automaticPeers(); render();
      }
      else if (element.id === 'marketSnapshot') { snapshot = element.value; load(); }
      else if (element.id === 'marketTier') { tier = element.value; render(); }
      else if (element.dataset.peer) {
        peers = element.checked ? [...new Set([...peers, element.dataset.peer])] : peers.filter(id => id !== element.dataset.peer);
        const peerId = element.dataset.peer;
        render(); container.querySelector('.market-picker').open = true;
        [...container.querySelectorAll('[data-peer]')].find(input => input.dataset.peer === peerId)?.focus();
      }
    });
    container.addEventListener('input', event => {
      if (event.target.id !== 'marketQuery' || event.isComposing) return;
      query = event.target.value;
      const position = event.target.selectionStart;
      render(); const input = container.querySelector('#marketQuery'); input.focus(); input.setSelectionRange(position, position);
    });
    container.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.remove) { peers = peers.filter(id => id !== button.dataset.remove); render(); }
      else if (button.dataset.section) { section = button.dataset.section; render(); }
      else if (button.dataset.action === 'auto') { peers = automaticPeers(); render(); }
      else if (button.dataset.action === 'retry') load();
      else if (button.dataset.action === 'print' && payload) window.print();
      else if (button.dataset.action === 'export' && payload) {
        hooks.export([['점별 비교', label(base()), snapshot, payload.lastUpdated], ['비교 범위', ...model.selected.map(label)], ['브랜드', '구분', ...model.selected.map(label)], ...visibleItems().map(item => [item.brand, ({ common: '공통', exclusive: '기준점 단독', candidate: '비교점에만' })[item.category] || '', ...item.cells.map(cell => `${stateLabels[cell.state]} (${cell.reason})`)])], '점별비교_입점현황.xls');
      }
    });
    Promise.allSettled([json('history/index.json'), json('review-decisions.json')]).then(results => {
      if (results[0].status === 'fulfilled') history = results[0].value.filter(key => /^\d{4}-\d{2}(-\d{2})?$/.test(key)).sort().reverse();
      if (results[1].status === 'fulfilled') reviews = results[1].value.decisions || [];
      supportWarning = [results[0].status === 'rejected' ? '과거 기록 목록 조회 실패: 최신 자료만 선택 가능합니다.' : '', results[1].status === 'rejected' ? '검토 결정 조회 실패: 저장된 수집 자료와 이 기기의 검토 결과로 비교합니다.' : ''].filter(Boolean).join(' ');
      render();
    });
    load();
    return { refresh: render };
  }
  return { buildComparison, createUI, marketStores };
}));
