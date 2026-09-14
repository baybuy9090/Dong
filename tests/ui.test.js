const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('입퇴점 변화와 월별 아카이브는 한 줄 접힘 패널로 통합된다', () => {
  assert.match(html, /id="monthlyOverviewToggle"[^>]*aria-expanded="false"/);
  assert.match(html, /id="monthlyOverviewDetails" hidden/);
  assert.ok(html.indexOf('id="monthlyOverviewDetails"') < html.indexOf('id="brandRanking"'));
  assert.doesNotMatch(html, /id="monthlyChangeMore"/);
});
