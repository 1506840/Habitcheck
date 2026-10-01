/* timer-test.js —— 验证计时组件：三态覆盖 + 基于真实时间差 + 刷新/后台返回准确
 * 运行：node tools/timer-test.js
 */
const path = require('path');
const fs = require('fs');
const MOD = path.join(process.execPath, '..', '..', '..', 'workspace', 'node_modules');
const { JSDOM } = require(path.join(MOD, 'jsdom'));

const base = process.cwd();
const dom = new JSDOM(fs.readFileSync(path.join(base, 'index.html'), 'utf8'), {
  runScripts: 'outside-only', url: 'http://localhost/'
});
const { window } = dom;
window.requestAnimationFrame = window.requestAnimationFrame || function (cb) { setTimeout(cb, 0); };
window.confirm = function () { return true; };

['js/utils.js', 'js/logic.js', 'js/store.js', 'js/ui.js', 'js/app.js'].forEach(function (f) {
  window.eval(fs.readFileSync(path.join(base, f), 'utf8'));
});

const App = window.App;
const S = App.store, UI = App.ui;
const doc = window.document;

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

function bar() { return doc.getElementById('timerBar'); }
function setTarget(ts) { App.timerConfig.targetTs = ts; }
function refresh() { UI.updateTimer(); }

// 1) 初始化占位态（updateTimer 被临时禁用时，渲染应保持 is-init 占位）
const realUpdate = UI.updateTimer;
UI.updateTimer = function () {};          // 阻断自动刷新，观察占位态
UI.render();                              // 触发一次 render（占位态留在 DOM）
ok('存在计时条元素', !!bar());
ok('初始化占位态 is-init', bar() && bar().classList.contains('is-init'));
ok('占位文案为 --:--:--', bar() && bar().querySelector('.timer-val').textContent === '--:--:--');
UI.updateTimer = realUpdate;

// 2) 计时进行中（倒计时，目标在未来）
setTarget(Date.now() + (3 * 3600 + 25 * 60 + 9) * 1000); // 03:25:09 后
refresh();
ok('未来目标 → is-counting', bar().classList.contains('is-counting'));
ok('倒计时前缀“距”+label', /^距/.test(bar().querySelector('.timer-label').textContent));
ok('倒计时格式 HH:MM:SS', /^\d{2}:\d{2}:\d{2}$/.test(bar().querySelector('.timer-val').textContent));
ok('倒计时值等于目标差', bar().querySelector('.timer-val').textContent === '03:25:09');

// 3) 已结束（目标已过 → 正计时 + 结束态文案，不归零静止）
setTarget(Date.now() - (1 * 3600 + 2 * 60 + 3) * 1000); // 已过 01:02:03
refresh();
ok('过期目标 → is-ended', bar().classList.contains('is-ended'));
ok('结束态文案 = endedText', bar().querySelector('.timer-label').textContent === App.timerConfig.endedText);
ok('正计时有“+”前缀', /^\+\d{2}:\d{2}:\d{2}$/.test(bar().querySelector('.timer-val').textContent));
ok('正计时值 = 已过时长', bar().querySelector('.timer-val').textContent === '+01:02:03');

// 4) 基于真实时间差：刷新/后台返回均准确（改回未来目标，再即时刷新应反映新差值）
setTarget(Date.now() + 5 * 1000);   // 5 秒后
refresh();
ok('临近目标倒计时 = 00:00:0X', /^\d{2}:\d{2}:0[0-5]$/.test(bar().querySelector('.timer-val').textContent));
// 模拟后台返回：直接再次刷新（真实 Date.now 驱动，无需依赖间隔）
setTarget(Date.now() + 65 * 1000);  // 改成 65 秒后
refresh();
ok('改目标后立即刷新仍准确', bar().querySelector('.timer-val').textContent === '00:01:05');

// 5) 非今天视图不应渲染计时条（无元素 → updateTimer 安全返回）
UI.state.view = 'stats';
UI.render();
ok('非今天视图无计时条（updateTimer 不报错）', !bar());

console.log('\n计时组件：' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail ? 1 : 0);
