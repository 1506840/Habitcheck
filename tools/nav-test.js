/* 真机点击验证：jsdom 加载 index.html，模拟导航（Tab 点击 / 点 SVG 子元素 / 改 hash）
 * 校验：视图切换 + URL hash 变化 + 前进/后退 + 深层链接 */
const path = require('path');
// 从本机 node 二进制同级目录解析 jsdom（受管 node 不读取 NODE_PATH）
const MOD = path.join(process.execPath, '..', '..', '..', 'workspace', 'node_modules');
const { JSDOM } = require(path.join(MOD, 'jsdom'));

const file = path.resolve(__dirname, '../index.html');
const markers = {
  today: /class="hero-ring"|今天完成/,
  calendar: /本月|本周|data-act="cal-/,
  stats: /完成率|趋势|热力/,
  manage: /进行中|新建清单项/
};

JSDOM.fromFile(file, {
  runScripts: 'outside-only',
  resources: 'usable',
  url: 'file://' + path.resolve(__dirname, '../index.html'),
  pretendToBeVisual: true
}).then(async dom => {
  const { window } = dom;
  const doc = window.document;

  // 依次注入 5 个脚本（outside-only 模式下手动按顺序执行，模拟浏览器加载）
  const files = ['utils', 'logic', 'store', 'ui', 'app'];
  for (const f of files) {
    const code = require('fs').readFileSync(path.resolve(__dirname, '../js/' + f + '.js'), 'utf8');
    const fn = new window.Function(code);
    fn.call(window);
  }
  // 触发 app.js 中依赖 load 事件的逻辑（本脚本无 load 依赖，这里仅等待微任务）
  await new Promise(r => setTimeout(r, 100));

  const view = doc.getElementById('view');
  const HC = window.HabitCheck;
  console.log('HabitCheck 全局对象:', HC ? '已挂载' : '未挂载');
  if (!HC) { console.log('脚本未初始化，无法测试'); process.exit(2); }

  let pass = 0, fail = 0;
  function check(name, cond, extra) {
    console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : ''));
    cond ? pass++ : fail++;
  }
  function clickTab(v, useSvg) {
    const btn = doc.querySelector('#tabbar button[data-view="' + v + '"]');
    const target = useSvg && btn.querySelector('svg') ? btn.querySelector('svg') : btn;
    target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  // 1) 初始 hash 应为空或 today
  check('初始视图=today', UI_state(window).view === 'today', 'view=' + UI_state(window).view);

  // 2) 依次点 Tab：视图切换 + hash 变化
  for (const v of ['calendar', 'stats', 'manage', 'today']) {
    const before = view.innerHTML;
    clickTab(v, false);
    await new Promise(r => setTimeout(r, 30)); // 等 hashchange 异步
    const html = view.innerHTML;
    const viewOk = html !== before && markers[v].test(html);
    const hashOk = window.location.hash === '#/' + v;
    check('点 Tab→' + v + ' 视图更新', viewOk);
    check('   URL hash = #/' + v, hashOk, 'actual=' + window.location.hash);
  }

  // 3) 点图标内部 SVG 子元素也应命中导航（验证 closest 在 SVG 上可用）
  const calBtn = doc.querySelector('#tabbar button[data-view="calendar"]');
  const svgChild = calBtn.querySelector('path') || calBtn.querySelector('svg');
  const beforeHtml = view.innerHTML;
  svgChild.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
  await new Promise(r => setTimeout(r, 30));
  check('点 SVG 子元素也能切到日历', view.innerHTML !== beforeHtml && markers.calendar.test(view.innerHTML) && window.location.hash === '#/calendar');

  // 4) 直接改 hash（深层链接 / 前进后退）→ 视图同步
  window.location.hash = '#/stats';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 30));
  check('直接改 #/stats 同步视图', UI_state(window).view === 'stats' && markers.stats.test(view.innerHTML));

  // 5) 非法 hash 不应导致空白页
  window.location.hash = '#/unknown';
  window.dispatchEvent(new window.Event('hashchange'));
  await new Promise(r => setTimeout(r, 30));
  check('非法 hash 不破坏视图', view.innerHTML.length > 100 && view.innerHTML !== '');

  console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
  process.exit(fail ? 1 : 0);
}).catch(err => {
  console.error('测试运行异常:', err && err.stack ? err.stack : err);
  process.exit(2);
});

function UI_state(window) { return window.HabitCheck.ui.state; }
