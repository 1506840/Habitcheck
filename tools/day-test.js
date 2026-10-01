/* 「日历 → 当天任务页」：jsdom 真机验证
 * 校验：
 *   1) 点日历任意日期 → 路由跳转到 #/day/YYYY-MM-DD 当天任务页
 *   2) 页面按完成态明确分组「已完成 / 未完成」两类
 *   3) 分组与数据源(logic.dueItems + itemStatus)严格一致（标题+完成状态字段、日期正确关联）
 *   4) 补打卡后任务实时在两组间迁移；点返回按钮回到日历 */
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
  const U = HC.utils, L = HC.logic;
  let pass = 0, fail = 0;
  function ok(name, cond, extra) {
    if (cond) { pass++; } else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
  }

  // 进入日历
  const calTab = doc.querySelector('#tabbar button[data-view="calendar"]');
  ok('存在「日历」Tab', !!calTab);
  calTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 30));
  ok('切到 calendar 视图', HC.ui.state.view === 'calendar');

  // 点「今天」对应的日期格 → 应跳转到当天任务页
  const todayCell = view.querySelector('.day.today');
  ok('日历含今天日期格', !!todayCell);
  const dateStr = todayCell && todayCell.dataset.date;
  ok('日期格带 data-date', !!dateStr);
  todayCell.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));

  ok('点日期后切到 day 视图', HC.ui.state.view === 'day');
  ok('URL 深层链接 = #/day/' + dateStr, (window.location.hash || '').replace(/^#\/?/, '') === 'day/' + dateStr);

  // 分组标题：已完成 / 未完成
  const heads = view.querySelectorAll('.day-group .group-head');
  ok('恰好两个分组', heads.length === 2, heads.length);
  const headText = Array.prototype.map.call(heads, h => h.textContent).join('|');
  ok('分组含「已完成」', /已完成/.test(headText));
  ok('分组含「未完成」', /未完成/.test(headText));

  // 与数据源严格比对：dueItems 按 itemStatus 分成 done/todo
  const state = HC.store.getState();
  const due = L.dueItems(state, dateStr);
  let expDone = 0, expTodo = 0;
  due.forEach(it => { (L.itemStatus(state, it.id, dateStr) === 'done' ? expDone++ : expTodo++); });

  const groups = view.querySelectorAll('.day-group');
  const doneGroup = groups[0], todoGroup = groups[1];
  const doneRows = doneGroup.querySelectorAll('.item');
  const todoRows = todoGroup.querySelectorAll('.item');
  ok('已完成组数量 = 预期', doneRows.length === expDone, doneRows.length + ' vs ' + expDone);
  ok('未完成组数量 = 预期', todoRows.length === expTodo, todoRows.length + ' vs ' + expTodo);

  // 每条任务都含「标题」字段；且分组与完成状态一致
  function idsOf(rows) {
    return Array.prototype.map.call(rows, r => r.querySelector('.i-main').dataset.id);
  }
  const doneIds = idsOf(doneRows), todoIds = idsOf(todoRows);
  ok('已完成组任务均 status=done', doneIds.every(id => L.itemStatus(state, id, dateStr) === 'done'));
  ok('未完成组任务均 status≠done', todoIds.every(id => L.itemStatus(state, id, dateStr) !== 'done'));
  ok('两组 ID 不重叠且覆盖全部 due',
    new Set(doneIds.concat(todoIds)).size === due.length && doneIds.length + todoIds.length === due.length);
  // 标题字段非空
  ok('每个任务都有标题文本',
    doneRows.length + todoRows.length > 0 &&
    Array.prototype.every.call(view.querySelectorAll('.day-group .item .i-title'), t => t.textContent.trim().length > 0));

  // 交互：在未完成组点一个任务的圆圈 → 标记为已完成 → 重渲染后迁移到已完成组
  if (todoRows.length) {
    const firstTodo = todoIds[0];
    // 用 data-id 精确定位该任务的 toggle 按钮（store dispatch 后会替换 state 对象，需重新取最新 state）
    const toggle = view.querySelector('.day-group .item .circle[data-id="' + firstTodo + '"]');
    ok('找到未完成任务的 toggle 按钮', !!toggle);
    toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 40));
    ok('补打卡后该任务 status=done', L.itemStatus(HC.store.getState(), firstTodo, dateStr) === 'done');
    const doneIds2 = Array.prototype.map.call(view.querySelectorAll('.day-group')[0].querySelectorAll('.item'),
      r => r.querySelector('.i-main').dataset.id);
    ok('补打卡后任务进入已完成组', doneIds2.indexOf(firstTodo) >= 0);
  } else {
    console.log('  (跳过补打卡迁移测试：当天无未完成项)');
  }

  // 返回按钮 → 回到日历（返回按钮在 #appHeader，不在 #view 内）
  const back = doc.querySelector('.nav-back');
  ok('当天任务页含返回按钮', !!back);
  back.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 40));
  ok('点返回后回到 calendar', HC.ui.state.view === 'calendar');

  console.log('\nday-test: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('测试异常:', e); process.exit(2); });
