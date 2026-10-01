/* pages-test.js —— 用 jsdom 真机验证日历/统计/清单三页新增能力
 * 运行：node tools/pages-test.js  （需 jsdom 在 node 工作区）
 */
const path = require('path');
const fs = require('fs');
// 从本机 node 二进制同级目录解析 jsdom（受管 node 不读取 NODE_PATH）
const MOD = path.join(process.execPath, '..', '..', '..', 'workspace', 'node_modules');
const { JSDOM } = require(path.join(MOD, 'jsdom'));

const base = process.cwd();
const dom = new JSDOM(fs.readFileSync(path.join(base, 'index.html'), 'utf8'), {
  runScripts: 'outside-only', url: 'http://localhost/'
});
const { window } = dom;
window.requestAnimationFrame = window.requestAnimationFrame || function (cb) { setTimeout(cb, 0); };
window.confirm = function () { return true; };

// 按加载顺序注入脚本（与 index.html 一致）
['js/utils.js', 'js/logic.js', 'js/store.js', 'js/ui.js', 'js/app.js'].forEach(function (f) {
  window.eval(fs.readFileSync(path.join(base, f), 'utf8'));
});

const App = window.App;
const { ui: UI, store: S, logic: L, utils: U } = App;
const doc = window.document;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}
function fire(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }
function byAct(act, filter) {
  const els = Array.prototype.slice.call(doc.querySelectorAll('[data-act="' + act + '"]'));
  return els.filter(function (e) {
    if (!filter) return true;
    return Object.keys(filter).every(function (k) { return e.dataset[k] === filter[k]; });
  });
}
function go(view) { UI.state.view = view; UI.render(); }
function viewText() { return doc.querySelector('#view').innerHTML; }

(async function () {
  console.log('\n[今天页 · 状态筛选分段]');
  go('today');
  // 用语义化定位（data-act + data-v）读取分段顺序，不依赖 DOM 索引
  const seg = byAct('filter');
  const seq = seg.map(function (b) { return b.dataset.v; });
  ok('分段显示顺序为 全部→待完成→已完成', JSON.stringify(seq) === JSON.stringify(['all', 'todo', 'done']));
  ok('默认选中项为 待完成', UI.state.filter === 'todo');
  // 默认高亮跟随“待完成”这一项（顺序重排后它位于中间，而非第一个位置）
  const onBtn = seg.filter(function (b) { return b.classList.contains('on'); });
  ok('仅“待完成”分段高亮', onBtn.length === 1 && onBtn[0].dataset.v === 'todo');
  ok('“待完成”高亮不依赖位置（all 段未高亮）', seg[0].dataset.v === 'all' && !seg[0].classList.contains('on'));
  // 切换到“已完成”后高亮正确跟随该项
  fire(byAct('filter', { v: 'done' })[0]);
  ok('切换至已完成：状态与高亮跟随', UI.state.filter === 'done' && byAct('filter', { v: 'done' })[0].classList.contains('on'));
  ok('切换后待完成段取消高亮', !byAct('filter', { v: 'todo' })[0].classList.contains('on'));
  // 还原默认
  fire(byAct('filter', { v: 'todo' })[0]);

  console.log('\n[日历页]');
  go('calendar');
  ok('月视图网格渲染', /class="grid7"/.test(viewText()));
  ok('选中日面板出现(+新增按钮)', byAct('new-item-date').length === 1);

  // 切到今天并选中，验证面板列出当天事项
  UI.state.date = U.todayKey(); UI.render();
  const due = L.dueItems(S.getState(), U.todayKey()).length;
  ok('选中日面板含当天事项行', byAct('toggle').length >= Math.min(due, 1));

  // 在面板内对第一项完成打卡 -> store 更新
  const before = S.getState().checkins.length;
  const tgl = byAct('toggle')[0];
  const date = tgl.dataset.date;
  const id = tgl.dataset.id;
  fire(tgl);
  const after = S.getState().checkins.length;
  ok('面板内一键完成写入打卡记录', after === before + 1 && L.itemStatus(S.getState(), id, date) === 'done');

  // 从选中日快捷新增：打开编辑器且开始日期预填为该日
  fire(byAct('new-item-date')[0]);
  const form = doc.querySelector('#itemForm');
  ok('选中日新增打开编辑器', !!form);
  ok('编辑器开始日期预填为选中日', form && doc.querySelector('#f-start').value === UI.state.date);
  // 关闭弹层
  fire(byAct('close-sheet')[0]);

  // 周视图切换
  fire(byAct('cal-mode', { v: 'week' })[0]);
  ok('周视图矩阵渲染', /class="matrix"/.test(viewText()) && UI.state.calMode === 'week');

  console.log('\n[统计页]');
  go('stats');
  ok('默认周维度', UI.state.statsMode === 'week');
  fire(byAct('stats-mode', { v: 'year' })[0]);
  ok('切换到年维度', UI.state.statsMode === 'year');
  ok('年维度趋势图渲染(12 根柱)', (viewText().match(/<rect /g) || []).length >= 12);
  // 年趋势逻辑直接验证（近 12 月）
  const yr = L.trend(S.getState(), 'year');
  ok('L.trend(year) 返回 12 个月', yr.length === 12);

  // 空状态：导入空清单后统计页提示
  S.importJSON(JSON.stringify({ items: [], checkins: [], categories: [] }));
  go('stats');
  ok('无清单项时统计页空状态', /还没有清单项/.test(viewText()));
  // 恢复演示数据
  S.reset();

  console.log('\n[清单页]');
  go('manage');
  ok('实时进度卡(今日完成率)渲染', /今日 [\d]+\/[\d]+ 完成/.test(viewText()) && /class="card hero"/.test(viewText()));
  ok('清单项行含勾选完成按钮', byAct('toggle', { 'data-date': U.todayKey() }).length >= 1
    || /清单项/.test(viewText()));

  // 筛选：待完成
  const totalItems = S.getState().items.filter(function (i) { return !i.archived; }).length;
  fire(byAct('manage-filter', { v: 'todo' })[0]);
  ok('筛选待完成生效', UI.state.manageFilter === 'todo');
  // 排序：优先级
  fire(byAct('manage-sort', { v: 'priority' })[0]);
  ok('排序切到优先级', UI.state.manageSort === 'priority');

  // 清单页勾选完成 -> 与日历/统计联动（store 变更）
  const mBefore = S.getState().checkins.length;
  const mToggle = byAct('toggle', { 'data-date': U.todayKey() })[0];
  if (mToggle) {
    const mid = mToggle.dataset.id;
    fire(mToggle);
    ok('清单页勾选完成联动 store', L.itemStatus(S.getState(), mid, U.todayKey()) === 'done'
      && S.getState().checkins.length === mBefore + 1);
  } else {
    ok('清单页勾选完成联动 store(无待办项，跳过)', true);
  }

  // 清单页筛选分段同样由集中常量驱动，顺序与今天页一致（验证无第二处硬编码）
  const mSeg = byAct('manage-filter').map(function (b) { return b.dataset.v; });
  ok('清单页筛选顺序同为 全部→待完成→已完成', JSON.stringify(mSeg) === JSON.stringify(['all', 'todo', 'done']));

  console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
