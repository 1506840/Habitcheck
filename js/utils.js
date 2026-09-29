/* =============================================================
 * utils.js —— 基础工具：日期计算、字符串处理、随机 ID
 * 全局命名空间 window.App.utils
 * ============================================================= */
window.App = window.App || {};
(function (App) {
  'use strict';
  var U = (App.utils = {});

  U.pad2 = function (n) { return (n < 10 ? '0' : '') + n; };

  /** Date -> 'YYYY-MM-DD'（本地时区，避免 toISOString 的 UTC 偏移问题） */
  U.dateKey = function (d) {
    return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
  };
  U.todayKey = function () { return U.dateKey(new Date()); };
  /** 'YYYY-MM-DD' -> Date（本地零点） */
  U.parseKey = function (k) {
    var p = String(k).split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]);
  };
  U.addDays = function (k, n) {
    var d = U.parseKey(k);
    d.setDate(d.getDate() + n);
    return U.dateKey(d);
  };
  /** b - a，单位天 */
  U.diffDays = function (a, b) {
    return Math.round((U.parseKey(b) - U.parseKey(a)) / 86400000);
  };
  U.weekday = function (k) { return U.parseKey(k).getDay(); }; // 0=周日

  U.WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六'];
  U.MONTH_SHORT = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];

  /** 按周起始日（0=周日 / 1=周一）取所在周的起始日 */
  U.startOfWeek = function (k, start) {
    var off = (U.weekday(k) - start + 7) % 7;
    return U.addDays(k, -off);
  };

  /** 月视图 6×7 = 42 天网格（含上下月补齐） */
  U.monthGrid = function (k, start) {
    var first = U.parseKey(k);
    var firstKey = U.dateKey(new Date(first.getFullYear(), first.getMonth(), 1));
    var off = (U.weekday(firstKey) - start + 7) % 7;
    var gridStart = U.addDays(firstKey, -off);
    var cells = [];
    for (var i = 0; i < 42; i++) cells.push(U.addDays(gridStart, i));
    return cells;
  };

  U.monthTitle = function (k) {
    var d = U.parseKey(k);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月';
  };
  U.weekTitle = function (k, start) {
    var s = U.startOfWeek(k, start);
    var e = U.addDays(s, 6);
    var a = U.parseKey(s), b = U.parseKey(e);
    if (a.getFullYear() === b.getFullYear()) {
      return a.getFullYear() + '年' + (a.getMonth() + 1) + '月' + a.getDate() + '日 - ' +
        (b.getMonth() + 1) + '月' + b.getDate() + '日';
    }
    return s + ' ~ ' + e;
  };
  U.prettyDate = function (k) {
    var d = U.parseKey(k);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + U.WEEK_SHORT[d.getDay()];
  };
  U.relLabel = function (k) {
    var diff = U.diffDays(U.todayKey(), k);
    if (diff === 0) return '今天';
    if (diff === -1) return '昨天';
    if (diff === 1) return '明天';
    return U.prettyDate(k);
  };

  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  U.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  /** 安全百分比：0 ~ 1 */
  U.pct = function (a, b) {
    if (!b) return 0;
    return Math.max(0, Math.min(1, a / b));
  };

  /** 时间 'HH:MM' 转分钟数，便于比较 */
  U.toMinutes = function (hhmm) {
    var p = String(hhmm || '00:00').split(':');
    return (+p[0] || 0) * 60 + (+p[1] || 0);
  };
  U.nowMinutes = function () {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  };
  U.nowKey = function () {
    var d = new Date();
    return U.pad2(d.getHours()) + ':' + U.pad2(d.getMinutes());
  };

  /** 日期 key 合法性：YYYY-MM-DD 且真实存在（拒绝 2026-02-30 这类被 JS 自动滚动的日期） */
  U.isValidKey = function (k) {
    if (typeof k !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
    var d = U.parseKey(k);
    if (isNaN(d.getTime())) return false;
    var y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    return k === (y + '-' + U.pad2(m) + '-' + U.pad2(dd));
  };

  /** 时间合法性：HH:MM，范围 00:00 ~ 23:59 */
  U.isValidTime = function (t) {
    if (typeof t !== 'string') return false;
    if (!/^\d{2}:\d{2}$/.test(t)) return false;
    var p = t.split(':'), h = +p[0], m = +p[1];
    return h >= 0 && h <= 23 && m >= 0 && m <= 59;
  };

  /** 简单数组去重 */
  U.uniq = function (arr) {
    var out = [], seen = {};
    for (var i = 0; i < arr.length; i++) {
      if (!seen[arr[i]]) { seen[arr[i]] = 1; out.push(arr[i]); }
    }
    return out;
  };

  U.clamp = function (v, min, max) { return Math.max(min, Math.min(max, v)); };
})(window.App);
