/* =============================================================
 * tools/smoke-test.js —— 纯逻辑冒烟测试（Node 环境，无需浏览器）
 *   node tools/smoke-test.js
 * 校验：种子数据 / 排期判定 / 打卡写入 / 连续天数 / 统计聚合 / 导出导入
 * ============================================================= */
global.window = {};
global.localStorage = {
  _s: {},
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(this._s, k) ? this._s[k] : null; },
  setItem: function (k, v) { this._s[k] = String(v); },
  removeItem: function (k) { delete this._s[k]; }
};

require('../js/utils.js');
require('../js/logic.js');
require('../js/store.js');

var App = global.window.App;
var U = App.utils, L = App.logic, S = App.store;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}

console.log('\n[1] 初始化 & 种子数据');
var state = S.init();
ok('清单项 6 条', state.items.length === 6, state.items.length);
ok('历史打卡记录 > 100', state.checkins.length > 100, state.checkins.length);
ok('分类 5 个', state.categories.length === 5);

console.log('\n[2] 排期判定');
var daily = state.items[0];   // 每天
var weekly = state.items[2];  // 每周一三五
ok('daily 天天排期', L.isScheduled(daily, U.todayKey()));
ok('daily 开始前不排期', !L.isScheduled(daily, U.addDays(daily.startDate, -1)));
var monKey = U.startOfWeek(U.todayKey(), 1);
ok('weekly 周一排期', L.isScheduled(weekly, monKey));
ok('weekly 周日不排期', !L.isScheduled(weekly, U.addDays(monKey, 6)));

console.log('\n[3] 打卡 / 撤销 / 补打卡');
var today = U.todayKey();
S.dispatch({ type: 'CHECKIN_SET', itemId: daily.id, date: today, status: 'done' });
ok('打卡后状态 done', L.itemStatus(S.getState(), daily.id, today) === 'done');
S.dispatch({ type: 'CHECKIN_SET', itemId: daily.id, date: today, status: null });
ok('撤销后状态 null', L.itemStatus(S.getState(), daily.id, today) === null);
var y2 = U.addDays(today, -2);
S.dispatch({ type: 'CHECKIN_SET', itemId: weekly.id, date: y2, status: 'done' });
var rec = null;
S.getState().checkins.forEach(function (c) { if (c.itemId === weekly.id && c.date === y2) rec = c; });
ok('补打卡标记 makeup', rec && rec.makeup === true);

console.log('\n[4] 连续天数');
var cur = L.itemStreak(S.getState(), daily);
var best = L.itemLongest(S.getState(), daily);
ok('daily 当前连续 >= 0', cur >= 0, cur);
ok('daily 最长 >= 当前', best >= cur, best + ' / ' + cur);
ok('全局全勤连续为数字', typeof L.globalStreak(S.getState()) === 'number');
ok('历史最长全勤 >= 1', L.globalLongest(S.getState()) >= 1, L.globalLongest(S.getState()));

console.log('\n[5] 统计聚合');
var ds = L.dayStats(S.getState(), today);
ok('今日应做项 > 0', ds.total > 0, ds.total);
ok('完成率 0~1', ds.rate >= 0 && ds.rate <= 1, ds.rate);
var wf = U.startOfWeek(today, 1);
var rs = L.rangeStats(S.getState(), wf, U.addDays(wf, 6));
ok('本周统计 total > 0', rs.total > 0, rs.total);
var tw = L.trend(S.getState(), 'week');
ok('周趋势 8 个点', tw.length === 8, tw.length);
var tm = L.trend(S.getState(), 'month');
ok('月趋势 6 个点', tm.length === 6, tm.length);
var hm = L.heatmap(S.getState(), 17, 1);
ok('热力图格子 = 119', hm.cells.length === 119, hm.cells.length);
ok('热力图首格对齐周起始', (U.weekday(hm.cells[0].key) === 1));
var cs = L.categoryStats(S.getState(), 30);
ok('分类统计非空', cs.length > 0, cs.length);

console.log('\n[6] 增删改 / 归档 / 持久化');
S.dispatch({ type: 'ITEM_CREATE', payload: { title: '单元测试项', color: '#000' } });
ok('新建成功', S.getState().items.length === 7);
var newId = S.getState().items[6].id;
S.dispatch({ type: 'ITEM_UPDATE', id: newId, patch: { title: '改名了' } });
ok('编辑成功', L.itemById(S.getState(), newId).title === '改名了');
S.dispatch({ type: 'ITEM_ARCHIVE', id: newId, value: true });
ok('归档成功', L.itemById(S.getState(), newId).archived === true);
ok('归档项不出现在应做列表', L.dueItems(S.getState(), today).every(function (i) { return i.id !== newId; }));
S.dispatch({ type: 'ITEM_DELETE', id: newId });
ok('删除成功', S.getState().items.length === 6);

console.log('\n[7] 导出 / 导入 / 重置');
S.flush();
var json = S.exportJSON();
ok('导出为合法 JSON', (function () { try { JSON.parse(json); return true; } catch (e) { return false; } })());
ok('localStorage 已写入', !!localStorage.getItem('habitcheck.v1'));
S.importJSON(json);
ok('导入后条数一致', S.getState().items.length === 6);
S.reset();
ok('重置后回到种子数据', S.getState().items.length === 6);

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
