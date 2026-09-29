/* =============================================================
 * logic.js —— 领域逻辑（纯函数）：排期判定、打卡查询、连续天数、统计聚合
 * 全局命名空间 window.App.logic
 * 所有函数均为纯函数，输入 state，输出派生数据，便于测试与复用
 * ============================================================= */
window.App = window.App || {};
(function (App) {
  'use strict';
  var U = App.utils;
  var L = (App.logic = {});

  /* ---------------- 排期判定 ---------------- */

  /** 某天是否"应该"出现该清单项（纯日期规则，不看打卡状态） */
  L.isScheduled = function (item, key) {
    if (!item || item.archived) return false;
    if (key < item.startDate) return false;
    if (item.endDate && key > item.endDate) return false;
    var r = item.repeat || { type: 'daily' };
    if (r.type === 'daily') return true;
    if (r.type === 'weekly') return (r.days || []).indexOf(U.weekday(key)) >= 0;
    if (r.type === 'times') return true;          // 每周 N 次：每天都可做，按周统计
    if (r.type === 'once') return key === item.startDate;
    return false;
  };

  /** 单次任务逾期未完成：一直出现在清单里直到被处理 */
  L.isOverdue = function (item, key, checkinsIndex) {
    if (!item || item.archived) return false;
    if ((item.repeat || {}).type !== 'once') return false;
    if (key < item.startDate) return false;
    var rec = checkinsIndex[item.id + '@' + key] || L.findCheckin(checkinsIndex, item.id);
    return !rec; // 没有任何打卡记录即视为待处理
  };

  L.buildIndex = function (state) {
    var idx = {};
    var list = state.checkins || [];
    for (var i = 0; i < list.length; i++) idx[list[i].itemId + '@' + list[i].date] = list[i];
    return idx;
  };

  L.findCheckin = function (index, itemId) {
    for (var k in index) {
      if (index[k] && index[k].itemId === itemId) return index[k];
    }
    return null;
  };

  /** 取某清单项在某天的打卡状态：'done' | 'skipped' | null */
  L.itemStatus = function (state, itemId, key) {
    var list = state.checkins || [];
    for (var i = list.length - 1; i >= 0; i--) {
      var c = list[i];
      if (c.itemId === itemId && c.date === key) return c.status;
    }
    return null;
  };

  /** 某天的应做清单（含逾期单次任务） */
  L.dueItems = function (state, key) {
    var idx = L.buildIndex(state);
    var out = [];
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      if (it.archived) continue;
      if (L.isScheduled(it, key) || L.isOverdue(it, key, idx)) out.push(it);
    }
    return out;
  };

  /** 打卡记录的不可变更新：status 为 null 表示撤销 */
  L.withStatus = function (checkins, itemId, date, status) {
    var out = [];
    for (var i = 0; i < checkins.length; i++) {
      var c = checkins[i];
      if (c.itemId === itemId && c.date === date) continue;
      out.push(c);
    }
    if (status) {
      out.push({
        id: U.uid('ck'),
        itemId: itemId,
        date: date,
        status: status,               // 'done' | 'skipped'
        makeup: date !== U.todayKey(),// 非今天 => 补打卡
        ts: Date.now()
      });
    }
    return out;
  };

  /* ---------------- 统计 ---------------- */

  L.dayStats = function (state, key) {
    var items = L.dueItems(state, key);
    var done = 0, skipped = 0;
    for (var i = 0; i < items.length; i++) {
      var st = L.itemStatus(state, items[i].id, key);
      if (st === 'done') done++;
      else if (st === 'skipped') skipped++;
    }
    return { total: items.length, done: done, skipped: skipped, pending: items.length - done - skipped, rate: U.pct(done, items.length) };
  };

  L.rangeStats = function (state, fromKey, toKey) {
    var total = 0, done = 0, skipped = 0, days = 0, activeDays = 0;
    var key = fromKey, guard = 0;
    while (key <= toKey && guard++ < 4000) {
      var s = L.dayStats(state, key);
      if (s.total > 0) { activeDays++; total += s.total; done += s.done; skipped += s.skipped; }
      days++;
      key = U.addDays(key, 1);
    }
    return { from: fromKey, to: toKey, days: days, activeDays: activeDays, total: total, done: done, skipped: skipped, rate: U.pct(done, total) };
  };

  /** 单个清单项当前连续完成次数（按"应完成日"序列计算，非自然日） */
  L.itemStreak = function (state, item) {
    var key = U.todayKey();
    var n = 0, guard = 0, empty = 0;
    while (guard++ < 3000 && empty < 400) {
      if (key < item.startDate) break;
      if (L.isScheduled(item, key)) {
        empty = 0;
        var st = L.itemStatus(state, item.id, key);
        if (st === 'done') n++;
        else if (key === U.todayKey()) { /* 今天尚未完成，宽容跳过，不中断连续 */ }
        else break;
      } else {
        empty++;
      }
      key = U.addDays(key, -1);
    }
    return n;
  };

  /** 单个清单项历史最长连续 */
  L.itemLongest = function (state, item) {
    var key = item.startDate;
    var end = U.todayKey();
    var best = 0, cur = 0, guard = 0;
    while (key <= end && guard++ < 5000) {
      if (L.isScheduled(item, key)) {
        if (L.itemStatus(state, item.id, key) === 'done') { cur++; if (cur > best) best = cur; }
        else cur = 0;
      }
      key = U.addDays(key, 1);
    }
    return best;
  };

  /** 全局"全勤"连续天数：连续每天应做项 100% 完成 */
  L.globalStreak = function (state) {
    var key = U.todayKey();
    var t = L.dayStats(state, key);
    if (t.total > 0 && t.done === 0 && t.skipped === 0) key = U.addDays(key, -1); // 今天还没开始
    var streak = 0, guard = 0, empty = 0;
    while (guard++ < 3000 && empty < 120) {
      var s = L.dayStats(state, key);
      if (s.total > 0) {
        empty = 0;
        if (s.done === s.total) streak++;
        else break;
      } else {
        empty++;
      }
      if (key <= state.settings.minDate) break;
      key = U.addDays(key, -1);
    }
    return streak;
  };

  /** 历史最长全勤连续 */
  L.globalLongest = function (state) {
    var start = state.settings.minDate || U.addDays(U.todayKey(), -365);
    var key = start, end = U.todayKey();
    var best = 0, cur = 0, guard = 0;
    while (key <= end && guard++ < 5000) {
      var s = L.dayStats(state, key);
      if (s.total > 0) {
        if (s.done === s.total) { cur++; if (cur > best) best = cur; }
        else cur = 0;
      }
      key = U.addDays(key, 1);
    }
    return best;
  };

  /** 某天打卡等级 0~4，用于日历 / 热力图着色 */
  L.dayLevel = function (state, key) {
    var s = L.dayStats(state, key);
    if (!s.total) return 0;
    var r = s.done / s.total;
    if (r <= 0) return 0;
    if (r < 0.34) return 1;
    if (r < 0.67) return 2;
    if (r < 1) return 3;
    return 4;
  };

  /** 热力图数据：固定 weeks × 7 格，末列为当前周（含未来日期，标记为 future） */
  L.heatmap = function (state, weeks, weekStart) {
    var curWeekStart = U.startOfWeek(U.todayKey(), weekStart);
    var start = U.addDays(curWeekStart, -(weeks - 1) * 7);
    var cells = [], max = 1;
    var key = start;
    for (var i = 0; i < weeks * 7; i++, key = U.addDays(key, 1)) {
      var future = key > U.todayKey();
      if (future) {
        cells.push({ key: key, done: 0, total: 0, level: 0, future: true });
        continue;
      }
      var s = L.dayStats(state, key);
      if (s.done > max) max = s.done;
      cells.push({ key: key, done: s.done, total: s.total, level: L.dayLevel(state, key), future: false });
    }
    return { cells: cells, start: start, end: U.addDays(start, weeks * 7 - 1), max: max, weeks: weeks };
  };

  /** 趋势数据：mode = 'week'（近 8 周） | 'month'（近 6 月） */
  L.trend = function (state, mode) {
    var out = [];
    var i, from, to, s;
    if (mode === 'month') {
      var now = U.parseKey(U.todayKey());
      for (i = 5; i >= 0; i--) {
        var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        from = U.dateKey(d);
        var last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        to = U.dateKey(last);
        if (to > U.todayKey()) to = U.todayKey();
        s = L.rangeStats(state, from, to);
        out.push({ label: (d.getMonth() + 1) + '月', value: s.rate, done: s.done, total: s.total });
      }
    } else if (mode === 'year') {
      // 近 12 个月：每月完成率（跨年用 YY/MM 标注）
      var base = U.parseKey(U.todayKey());
      for (i = 11; i >= 0; i--) {
        var md = new Date(base.getFullYear(), base.getMonth() - i, 1);
        from = U.dateKey(md);
        var last = new Date(md.getFullYear(), md.getMonth() + 1, 0);
        to = U.dateKey(last);
        if (to > U.todayKey()) to = U.todayKey();
        s = L.rangeStats(state, from, to);
        out.push({ label: (md.getFullYear() % 100) + '/' + U.pad2(md.getMonth() + 1), value: s.rate, done: s.done, total: s.total });
      }
    } else {
      var ws = state.settings.weekStart;
      for (i = 7; i >= 0; i--) {
        from = U.addDays(U.startOfWeek(U.todayKey(), ws), -7 * i);
        to = U.addDays(from, 6);
        if (to > U.todayKey()) to = U.todayKey();
        s = L.rangeStats(state, from, to);
        var dd = U.parseKey(from);
        out.push({ label: (dd.getMonth() + 1) + '/' + dd.getDate(), value: s.rate, done: s.done, total: s.total });
      }
    }
    return out;
  };

  /** 分类维度统计（近 30 天完成数） */
  L.categoryStats = function (state, days) {
    var from = U.addDays(U.todayKey(), -(days || 30));
    var map = {};
    for (var i = 0; i < state.items.length; i++) {
      var it = state.items[i];
      map[it.category] = map[it.category] || { total: 0, done: 0 };
    }
    var list = state.checkins || [];
    for (var j = 0; j < list.length; j++) {
      var c = list[j];
      if (c.date < from) continue;
      var item = L.itemById(state, c.itemId);
      if (!item) continue;
      var m = map[item.category] || (map[item.category] = { total: 0, done: 0 });
      if (c.status === 'done') m.done++;
      m.total++;
    }
    var out = [];
    for (var k in map) out.push({ id: k, name: L.categoryName(state, k), color: L.categoryColor(state, k), done: map[k].done, total: map[k].total });
    out.sort(function (a, b) { return b.done - a.done; });
    return out;
  };

  L.itemById = function (state, id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  };
  L.categoryName = function (state, id) {
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i].name;
    return '未分类';
  };
  L.categoryColor = function (state, id) {
    for (var i = 0; i < state.categories.length; i++) if (state.categories[i].id === id) return state.categories[i].color;
    return '#94a3b8';
  };

  /* ---------------- 展示文案 ---------------- */

  L.repeatLabel = function (item) {
    var r = item.repeat || { type: 'daily' };
    if (r.type === 'daily') return '每天';
    if (r.type === 'weekly') {
      var d = (r.days || []).slice().sort();
      if (d.length === 7) return '每天';
      if (!d.length) return '未设置星期';
      return '每周 ' + d.map(function (x) { return U.WEEK_SHORT[x]; }).join('');
    }
    if (r.type === 'times') return '每周 ' + (r.times || 1) + ' 次';
    if (r.type === 'once') return '单次 · ' + item.startDate.slice(5);
    return '';
  };
  /** 每周 N 次：本周已完成次数 */
  L.weeklyProgress = function (state, item, key) {
    var r = item.repeat || {};
    if (r.type !== 'times') return null;
    var from = U.startOfWeek(key, state.settings.weekStart);
    var to = U.addDays(from, 6);
    var n = 0;
    var list = state.checkins || [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (c.itemId === item.id && c.status === 'done' && c.date >= from && c.date <= to) n++;
    }
    return { done: n, target: r.times || 1 };
  };
})(window.App);
