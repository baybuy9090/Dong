const fs = require('fs');
const path = require('path');
const CONFIG = require('./config');

function readJson(filePath, fallback = null) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch (e) { return fallback; }
}

function normalizeRow(row) {
  const store = CONFIG.normalizeStoreName(row.company, row.store);
  return { company: row.company, store, storeId: row.storeId || CONFIG.storeId(row.company, store), brand: row.brand };
}

function isActive(row) {
  return !['(확인된 브랜드 없음)', '(오류)'].includes(row.brand) && !/(퇴점|누락)/.test(row.note || '');
}

function isReliable(payload) {
  if (!payload || !Array.isArray(payload.data)) return false;
  if (payload.health && payload.health.status === 'degraded') return false;
  const emptyStores = payload.data.filter(row => row.brand === '(확인된 브랜드 없음)').length;
  const errors = payload.data.filter(row => row.brand === '(오류)').length;
  return emptyStores <= 2 && errors <= 1;
}

function activeMap(payload) {
  const map = new Map();
  (payload.data || []).filter(isActive).map(normalizeRow).forEach(row => map.set(`${row.storeId}|${row.brand}`, row));
  return map;
}

function previousMonthKey(monthKey) {
  const [year, month] = monthKey.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return previous.toISOString().slice(0, 7);
}

function buildMonthlyArchive(historyDir) {
  const indexed = readJson(path.join(historyDir, 'index.json'), []) || [];
  const files = fs.readdirSync(historyDir).filter(name => /^\d{4}-\d{2}(-\d{2})?\.json$/.test(name)).map(name => name.replace(/\.json$/, ''));
  const keys = [...new Set([...indexed, ...files])].sort();
  const latestByMonth = new Map();
  keys.forEach(key => {
    const payload = readJson(path.join(historyDir, `${key}.json`));
    if (!isReliable(payload)) return;
    latestByMonth.set(key.slice(0, 7), { snapshot: key, payload });
  });

  const months = [...latestByMonth.keys()].sort();
  const archive = [];
  for (const month of months) {
    const previous = latestByMonth.get(previousMonthKey(month));
    if (!previous) continue;
    const current = latestByMonth.get(month);
    const before = activeMap(previous.payload);
    const after = activeMap(current.payload);
    const additions = [...after].filter(([key]) => !before.has(key)).map(([,row]) => row);
    const exits = [...before].filter(([key]) => !after.has(key)).map(([,row]) => row);
    archive.push({
      month,
      baselineSnapshot: previous.snapshot,
      endSnapshot: current.snapshot,
      new: additions.sort(sortRows),
      exit: exits.sort(sortRows),
    });
  }
  return { generatedAt: new Date().toISOString(), months: archive };
}

function sortRows(a, b) {
  return a.company.localeCompare(b.company, 'ko') || a.store.localeCompare(b.store, 'ko') || a.brand.localeCompare(b.brand, 'ko');
}

function writeMonthlyArchive(historyDir, outputPath) {
  const archive = buildMonthlyArchive(historyDir);
  fs.writeFileSync(outputPath, JSON.stringify(archive, null, 2) + '\n');
  return archive;
}

if (require.main === module) {
  const root = __dirname;
  const archive = writeMonthlyArchive(path.join(root, 'history'), path.join(root, 'monthly-archive.json'));
  console.log(`월별 아카이브 생성: ${archive.months.map(item => item.month).join(', ')}`);
}

module.exports = { normalizeRow, isActive, isReliable, activeMap, previousMonthKey, buildMonthlyArchive, writeMonthlyArchive };
