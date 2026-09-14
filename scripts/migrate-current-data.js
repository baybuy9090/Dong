const fs = require('fs');
const path = require('path');
const CONFIG = require('../config');
const { classifyEvents } = require('../news-crawler');

const root = path.join(__dirname, '..');
const dataPath = path.join(root, 'data.json');
const current = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const monthKey = (current.lastUpdated || new Date().toISOString()).slice(0, 7);
const historyIndex = JSON.parse(fs.readFileSync(path.join(root, 'history/index.json'), 'utf8'));
const monthStartSnapshot = historyIndex.filter(key => key < monthKey).sort().at(-1);
const monthStart = JSON.parse(fs.readFileSync(path.join(root, `history/${monthStartSnapshot}.json`), 'utf8'));

function normalize(row) {
  const store = CONFIG.normalizeStoreName(row.company, row.store);
  return { ...row, store, storeId: CONFIG.storeId(row.company, store) };
}
function active(row) {
  return !['(확인된 브랜드 없음)', '(오류)'].includes(row.brand) && !/(누락|퇴점)/.test(row.note || '');
}
const startSet = new Set((monthStart.data || []).map(normalize).filter(active).map(CONFIG.rowKey));
const seen = new Set();
const rows = [];
(current.data || []).map(normalize).forEach(row => {
  if (!active(row) && !['(확인된 브랜드 없음)', '(오류)'].includes(row.brand)) return;
  const key = CONFIG.rowKey(row);
  if (seen.has(key)) return;
  seen.add(key);
  if (active(row) && !startSet.has(key)) row = { ...row, note: '이번 달 신규 입점', changeMonth: monthKey };
  else if (active(row) && /(신규|누락|퇴점)/.test(row.note || '')) row = { ...row, note: '확인' };
  rows.push(row);
});

const migrated = {
  lastUpdated: current.lastUpdated,
  baselineAsOf: current.baselineAsOf || '',
  monthKey,
  monthStartSnapshot,
  monthlySummary: {
    new: rows.filter(row => row.note === '이번 달 신규 입점').length,
    exit: rows.filter(row => row.note === '이번 달 퇴점').length,
    pending: rows.filter(row => (row.note || '').includes('재확인 중')).length,
    stale: rows.filter(row => row.dataQuality === 'stale').length,
  },
  health: current.health || { status: 'ok', issues: [] },
  diagnostics: current.diagnostics || [],
  data: rows,
};
fs.writeFileSync(dataPath, JSON.stringify(migrated, null, 2) + '\n');
const latestHistoryPath = path.join(root, `history/${(current.lastUpdated || '').slice(0, 10)}.json`);
if (fs.existsSync(latestHistoryPath)) fs.writeFileSync(latestHistoryPath, JSON.stringify(migrated, null, 2) + '\n');

const baselinePath = path.join(root, 'baseline.json');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
baseline.data = (baseline.data || []).map(row => {
  const store = CONFIG.normalizeStoreName(row.company, row.store);
  return { ...row, store };
});
fs.writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + '\n');

const newsPath = path.join(root, 'news.json');
const news = JSON.parse(fs.readFileSync(newsPath, 'utf8'));
function addEvents(article) { return { ...article, events: classifyEvents(article.title || '') }; }
news.industry = (news.industry || []).map(addEvents);
Object.keys(news.data || {}).forEach(brand => { news.data[brand] = news.data[brand].map(addEvents); });
fs.writeFileSync(newsPath, JSON.stringify(news, null, 2) + '\n');

console.log(`마이그레이션 완료: ${monthKey} 신규 ${migrated.monthlySummary.new}건, 퇴점 ${migrated.monthlySummary.exit}건, 총 ${rows.length}행`);
