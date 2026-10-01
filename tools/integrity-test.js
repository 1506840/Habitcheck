/* 数据导入与完整性加固验证：异常输入 / 空值 / 缺字段 / 孤儿记录 / 合法导入
 * 与 smoke-test.js 同样的运行方式：node tools/integrity-test.js */
global.window = {};
global.localStorage = (function () {
  var m = {};
  return {
    getItem: function (k) { return k in m ? m[k] : null; },
    setItem: function (k, v) { m[k] = String(v); },
    removeItem: function (k) { delete m[k]; }
  };
})();
require('../js/utils.js');
require('../js/logic.js');
require('../js/store.js');
var App = global.window.App;
var U = App.utils, L = App.logic, S = App.store;

var pass = 0, fail = 0;
function ok(name, cond, extra) {
  console.log((cond ? 'OK   ' : 'FAIL ') + name + (extra !== undefined ? '  ' + extra : ''));
  cond ? pass++ : fail++;
}
function throws(fn) {
  try { fn(); return false; } catch (e) { return true; }
}

S.init();

// 1) 非法 JSON
ok('非法 JSON 抛错', throws(function () { S.importJSON('not json{'); }));

// 2) 顶层非对象（数组）
ok('顶层为数组抛错', throws(function () { S.importJSON('[1,2,3]'); }));

// 3) 缺少必要数组
ok('缺数组抛错', throws(function () { S.importJSON(JSON.stringify({ foo: 'bar' })); }));

// 4) 脏数据导入后：字段被清洗、非法记录被丢弃、不崩溃
var dirty = {
  items: [
    { id: 'a', title: '好的', repeat: { type: 'weeklyzzz' }, startDate: '2026-02-30', endDate: 'bad' },
    { id: 'b' },                                   // 大量缺字段
    { repeat: {} }                                 // 缺 id（应生成新 id 并保留）
  ],
  checkins: [
    { itemId: 'a', date: '2026-01-01', status: 'done' },   // 合法
    { itemId: 'ghost', date: '2026-01-01', status: 'done' }, // 孤儿（引用不存在的 item）
    { itemId: 'a', date: 'xxx', status: 'done' },            // 非法日期
    { itemId: 'a', date: '2026-01-02', status: 'weird' }     // 非法状态
  ]
};
S.importJSON(JSON.stringify(dirty));
var st = S.getState();
var a = L.itemById(st, 'a');
ok('脏导入：items 保留 3 条（含补 id 的）', st.items.length === 3, 'len=' + st.items.length);
ok('脏导入：repeat.type 非法→daily', a && a.repeat.type === 'daily');
ok('脏导入：非法 startDate→合法今日', a && U.isValidKey(a.startDate), a && a.startDate);
ok('脏导入：非法 endDate→空串', a && a.endDate === '');
ok('脏导入：孤儿/非法记录被丢弃，仅剩 1 条 checkin', st.checkins.length === 1, 'len=' + st.checkins.length);
var ds = L.dayStats(st, '2026-01-05');
ok('脏导入：统计 rate 仍为有限数（无 NaN）', typeof ds.rate === 'number' && !isNaN(ds.rate), 'rate=' + ds.rate);

// 5) 合法完整导入
var clean = {
  items: [{ id: 'x', title: 'X', repeat: { type: 'daily' }, startDate: '2026-01-01' }],
  checkins: [{ itemId: 'x', date: '2026-01-05', status: 'done' }]
};
S.importJSON(JSON.stringify(clean));
st = S.getState();
ok('合法导入：items=1', st.items.length === 1);
ok('合法导入：checkins=1', st.checkins.length === 1);
ok('合法导入：repeat.type 保留 daily', st.items[0].repeat.type === 'daily');

// 6) 边界：完全空对象导入不崩溃
S.importJSON(JSON.stringify({ items: [], checkins: [], categories: [] }));
st = S.getState();
ok('空导入：至少有 other 分类', st.categories.some(function (c) { return c.id === 'other'; }));
ok('空导入：items=0 仍可统计', typeof L.globalStreak(st) === 'number');

console.log('\n结果: 通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
