/* 「我的」页 + FAQ 手风琴：jsdom 真机验证
 * 校验：viewMe 渲染（hero/功能亮点/技巧/FAQ/设置入口）、nav 切到 me、faq 展开态切换、版本号 1.0.1 */
const path = require('path');
const MOD = path.join(process.execPath, '..', '..', '..', 'workspace', 'node_modules');
const { JSDOM } = require(path.join(MOD, 'jsdom'));

const file = path.resolve(__dirname, '../index.html');
JSDOM.fromFile(file, {
  runScripts: 'outside-only',
  resources: 'usable',
  url: 'file://' + path.resolve(__dirname, '../index.html'),
  pretendToBeVisual: true
}).then(async dom => {
  const { window } = dom;
  const doc = window.document;
  const files = ['utils', 'logic', 'store', 'ui', 'app'];
  for (const f of files) {
    const code = require('fs').readFileSync(path.resolve(__dirname, '../js/' + f + '.js'), 'utf8');
    new window.Function(code).call(window);
  }
  await new Promise(r => setTimeout(r, 100));

  const view = doc.getElementById('view');
  const HC = window.HabitCheck;
  let pass = 0, fail = 0;
  function ok(name, cond) { if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name); } }

  // 默认视图应为 today
  ok('默认视图 today', HC.ui.state.view === 'today');

  // 通过底部 Tab 切到「我的」
  const meTab = doc.querySelector('#tabbar button[data-view="me"]');
  ok('存在第5个 Tab「我的」', !!meTab);
  meTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok('点击后切到 me 视图', HC.ui.state.view === 'me');
  ok('URL hash = #/me', (window.location.hash || '').replace(/^#\/?/, '') === 'me');

  const v = view.innerHTML;
  ok('me hero 含应用名', /HabitCheck/.test(v));
  ok('me 版本号 1.0.1', /v1\.0\.1/.test(v));
  ok('功能亮点 4 张卡', (v.match(/class="feat"/g) || []).length === 4);
  ok('功能卡可跳转(today/calendar/stats/manage)',
    /data-view="today"/.test(v) && /data-view="calendar"/.test(v) && /data-view="stats"/.test(v) && /data-view="manage"/.test(v));
  ok('使用技巧区块', /使用技巧/.test(v) && (v.match(/class="tip"/g) || []).length >= 3);
  ok('FAQ 至少 3 条', (v.match(/class="faq"/g) || []).length >= 3);
  ok('设置入口', /data-act="open-settings"/.test(v));

  // FAQ 手风琴：第一条默认展开，点击第二条应展开且第一条收起
  const faqs = view.querySelectorAll('.faq');
  ok('首条 FAQ 默认 open', faqs[0] && faqs[0].classList.contains('open'));
  const q2 = faqs[1] && faqs[1].querySelector('.faq-q');
  q2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 20));
  ok('点击第2条后其展开', faqs[1].classList.contains('open'));
  ok('点击第2条后第1条收起', !faqs[0].classList.contains('open'));
  ok('FAQ 展开不触发整页重渲染(视图仍为 me)', HC.ui.state.view === 'me');

  // 返回「今天」Tab 仍正常
  const todayTab = doc.querySelector('#tabbar button[data-view="today"]');
  todayTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok('可从 me 返回 today', HC.ui.state.view === 'today');

  console.log('\nme-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('测试异常:', e); process.exit(2); });
