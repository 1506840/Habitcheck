/* =============================================================
 * app.js —— 启动入口：初始化 store、绑定渲染、提醒调度、跨天刷新
 * ============================================================= */
(function (App) {
  'use strict';
  var U = App.utils, L = App.logic, S = App.store, UI = App.ui;

  /* =============================================================
   * 计时组件目标时间（⚠️ 修改此处即可调整计时目标，避免硬编码散落各处）
   * targetTs  : 目标时间点（毫秒时间戳）。到达后倒计时自动切换为正计时并进入结束态。
   *   · 固定某天某刻： new Date('2026-12-31T23:59:59').getTime()
   *   · 每日某刻（下方默认 = 今日 23:59:59）
   * label     : 倒计时阶段前缀文案（“距” + label）
   * endedText : 到达目标后显示的结束态文案（同时开始正计时）
   * ============================================================= */
  var _timerDefault = new Date();
  _timerDefault.setHours(23, 59, 59, 0);   // 默认：今日 23:59:59
  App.timerConfig = {
    targetTs: _timerDefault.getTime(),
    label: '今日目标',
    endedText: '今日目标已达成'
  };

  /* ---------- 极简 hash 路由：视图(view) ↔ location.hash 双向同步 ----------
   * 支持「带日期参数」的深层链接：#/day/YYYY-MM-DD → 当天任务页 */
  var VIEWS = ['today', 'calendar', 'stats', 'manage', 'me', 'day'];
  /** 解析 hash：返回 { view, date }；date 仅 day 视图携带 */
  function parseHash() {
    var h = (location.hash || '').replace(/^#\/?/, '').trim();
    if (!h) return null;
    var seg = h.split('/');
    if (seg[0] === 'day') {
      // 日期非法或缺失时回退到今天，避免进入空白页
      var d = (seg[1] && U.isValidKey(seg[1])) ? seg[1] : U.todayKey();
      return { view: 'day', date: d };
    }
    if (VIEWS.indexOf(seg[0]) >= 0) return { view: seg[0], date: null };
    return null;
  }
  function syncViewFromHash() {
    var p = parseHash();
    if (p) {
      var changed = p.view !== UI.state.view || (p.date && p.date !== UI.state.date);
      if (changed) {
        UI.state.view = p.view;
        if (p.date) UI.state.date = p.date;
        UI.render();
      }
    }
  }

  /* ---------- 启动 ---------- */
  var state = S.init();
  // 初始视图优先级：URL hash（深层链接）> 本地记忆 > 默认 today
  var savedView = null;
  try { savedView = localStorage.getItem('habitcheck.ui.view'); } catch (e) { }
  var ph = parseHash();
  UI.state.view = (ph ? ph.view : null) || savedView || 'today';
  if (ph && ph.date) UI.state.date = ph.date;

  S.subscribe(function () { UI.render(); });
  UI.render();

  // 记住当前页签（兼容无 hash 的旧习惯）
  var origRender = UI.render;
  UI.render = function () {
    origRender();
    try { localStorage.setItem('habitcheck.ui.view', UI.state.view); } catch (e) { }
  };

  // 浏览器前进/后退、手动改地址栏 hash → 同步视图
  window.addEventListener('hashchange', syncViewFromHash);

  /* ---------- 每天零点自动切到新的一天 ---------- */
  var lastDay = U.todayKey();
  setInterval(function () {
    var t = U.todayKey();
    if (t !== lastDay) {
      lastDay = t;
      UI.state.date = t;
      UI.render();
      UI.toast('新的一天，开始打卡吧');
    }
  }, 30000);

  /* ---------- 提醒调度 ---------- */
  var fired = {};

  function inDnd(mins, dnd) {
    var s = U.toMinutes(dnd.start), e = U.toMinutes(dnd.end);
    if (s === e) return false;
    if (s < e) return mins >= s && mins < e;
    return mins >= s || mins < e; // 跨夜时段
  }

  function fire(item) {
    var title = '⏰ ' + item.title;
    var body = item.note || '该打卡啦';
    if (App.notify.canUse()) {
      try {
        var n = new Notification(title, { body: body, tag: item.id });
        n.onclick = function () { window.focus(); };
        return;
      } catch (e) { /* 降级到应用内提示 */ }
    }
    UI.toast(title + ' · ' + body);
  }

  function checkReminders() {
    var st = S.getState();
    var set = st.settings;
    if (!set.notify || !set.notify.enabled) return;
    var mins = U.nowMinutes();
    if (set.dnd && set.dnd.enabled && inDnd(mins, set.dnd)) return; // 免打扰

    var key = U.todayKey();
    for (var i = 0; i < st.items.length; i++) {
      var it = st.items[i];
      if (it.archived) continue;
      var r = it.reminder;
      if (!r || !r.enabled) continue;
      if (!L.isScheduled(it, key)) continue;
      if (L.itemStatus(st, it.id, key)) continue;      // 已打卡不再提醒
      var rm = U.toMinutes(r.time);
      if (mins < rm || mins > rm + 2) continue;        // 命中提醒时刻（容差 2 分钟）
      var token = it.id + '@' + key + '@' + r.time;
      if (fired[token]) continue;
      fired[token] = 1;
      fire(it);
    }
  }

  App.notify = {
    canUse: function () {
      return ('Notification' in window) && Notification.permission === 'granted';
    },
    request: function (cb) {
      if (!('Notification' in window)) { cb && cb('unsupported'); return; }
      if (Notification.permission === 'granted') { cb && cb('granted'); return; }
      Notification.requestPermission().then(function (p) { cb && cb(p); });
    }
  };

  // 若用户已开启通知但未授权，尝试静默申请（浏览器要求用户手势，失败则忽略）
  if (state.settings.notify && state.settings.notify.enabled && 'Notification' in window &&
    Notification.permission === 'default') {
    // 不做自动弹窗，避免打扰；用户可在设置里开启
  }

  setInterval(checkReminders, 30000);
  checkReminders();

  /* ---------- 其他 ---------- */
  window.addEventListener('beforeunload', function () { S.flush(); });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) S.flush(); else { UI.render(); UI.updateTimer(); }
  });

  /* ---------- 计时组件：每秒刷新；基于真实时间差，后台返回即准确 ---------- */
  setInterval(function () { UI.updateTimer(); }, 1000);

  // 暴露调试入口
  window.HabitCheck = { store: S, logic: L, ui: UI, utils: U };
})(window.App);
