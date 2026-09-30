/* =============================================================
 * ui.js —— 视图渲染层（字符串模板 + 事件委托）
 *  UI 局部状态与业务数据分离：UI.state 只存"当前看什么"
 * 全局命名空间 window.App.ui
 * ============================================================= */
window.App = window.App || {};
(function (App) {
  'use strict';
  var U = App.utils, L = App.logic, S = App.store;
  var UI = (App.ui = {});

  /** UI 局部状态（不持久化到业务数据，仅记忆当前视图） */
  var st = (UI.state = {
    view: 'today',
    date: U.todayKey(),
    calMode: 'month',   // month | week
    statsMode: 'week',  // week | month | year
    filter: 'todo',     // all | todo | done（今天页筛选；默认选中“待完成”，重排顺序不影响默认项）
    showArchived: false,
    manageSort: 'created',   // created | priority | time（清单页排序）
    manageFilter: 'all'      // all | todo | done（清单页筛选）
  });

  var $ = function (s) { return document.querySelector(s); };
  var PALETTE = ['#4f46e5', '#22c55e', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'];

  /**
   * 任务状态筛选分段的「显示顺序」——集中定义，便于后续调整（无需改动各页面渲染代码）。
   * 元素值对应 st.filter / st.manageFilter 的取值；渲染文案见 FILTER_META。
   * TODO: 如需改变展示顺序，只改此数组即可（例如改成 ['todo','done','all']）。
   *       默认选中项由 st.filter / st.manageFilter 决定，跟随“值”而非“位置”，重排不会影响默认选中。
   */
  var FILTER_ORDER = ['all', 'todo', 'done'];

  /** 分段文案（key → 显示名），与 FILTER_ORDER 一一对应：all=全部 / todo=待完成 / done=已完成 */
  var FILTER_META = { all: '全部', todo: '待完成', done: '已完成' };

  function hexA(hex, a) {
    var h = String(hex || '#4f46e5').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ================= Toast ================= */
  function toast(msg, actionLabel, cb) {
    var wrap = $('#toastWrap');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span>' + U.esc(msg) + '</span>';
    if (actionLabel) {
      var b = document.createElement('button');
      b.textContent = actionLabel;
      b.onclick = function () { cb && cb(); el.remove(); };
      el.appendChild(b);
    }
    wrap.appendChild(el);
    setTimeout(function () { el.remove(); }, actionLabel ? 3200 : 2000);
  }
  UI.toast = toast;

  /* ================= 底部弹层 ================= */
  function openSheet(title, html) {
    var root = $('#sheetRoot');
    root.hidden = false;
    root.innerHTML =
      '<div class="sheet-mask" data-act="close-sheet"></div>' +
      '<div class="sheet"><div class="sheet-head"><h3>' + U.esc(title) + '</h3>' +
      '<button class="icon-btn" data-act="close-sheet">✕</button></div>' +
      '<div class="sheet-body">' + html + '</div></div>';
    requestAnimationFrame(function () { root.classList.add('show'); });
  }
  function closeSheet() {
    var root = $('#sheetRoot');
    root.classList.remove('show');
    setTimeout(function () { root.hidden = true; root.innerHTML = ''; }, 220);
  }
  UI.openSheet = openSheet;
  UI.closeSheet = closeSheet;

  /* ================= 通用片段 ================= */
  function ring(pct) {
    var r = 30, c = 2 * Math.PI * r;
    return '<div class="hero-ring"><svg viewBox="0 0 72 72">' +
      '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="7"/>' +
      '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="var(--accent)" stroke-width="7" stroke-linecap="round" ' +
      'stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - pct)).toFixed(1) + '"/></svg>' +
      '<div class="val">' + Math.round(pct * 100) + '%</div></div>';
  }

  function sortItems(list, state, key) {
    var P = { high: 0, medium: 1, low: 2 };
    return list.slice().sort(function (a, b) {
      var sa = L.itemStatus(state, a.id, key) === 'done' ? 1 : 0;
      var sb = L.itemStatus(state, b.id, key) === 'done' ? 1 : 0;
      if (sa !== sb) return sa - sb;
      var pa = P[a.priority] == null ? 1 : P[a.priority];
      var pb = P[b.priority] == null ? 1 : P[b.priority];
      if (pa !== pb) return pa - pb;
      return a.createdAt - b.createdAt;
    });
  }

  function itemMeta(state, item, key) {
    var out = [];
    out.push('<span class="tag" style="background:' + hexA(L.categoryColor(state, item.category), .14) +
      ';color:' + L.categoryColor(state, item.category) + '">' + U.esc(L.categoryName(state, item.category)) + '</span>');
    out.push('<span>' + U.esc(L.repeatLabel(item)) + '</span>');
    if (item.priority === 'high') out.push('<span class="tag" style="background:rgba(239,68,68,.12);color:#ef4444">高优先</span>');
    var wp = L.weeklyProgress(state, item, key);
    if (wp) out.push('<span>本周 ' + wp.done + '/' + wp.target + '</span>');
    if (item.reminder && item.reminder.enabled) out.push('<span>⏰ ' + item.reminder.time + '</span>');
    if (item.repeat && item.repeat.type === 'once' && key > item.startDate) out.push('<span style="color:var(--warn)">待处理</span>');
    if (item.note) out.push('<span>📝</span>');
    return out.join('<span style="opacity:.4">·</span>');
  }

  function itemRow(state, item, key) {
    var status = L.itemStatus(state, item.id, key);
    var cls = status === 'done' ? ' done' : (status === 'skipped' ? ' skipped' : '');
    return '<div class="item' + cls + '" style="border-left-color:' + item.color + '">' +
      '<div class="i-main" data-act="open-item" data-id="' + item.id + '">' +
      '<div class="i-title">' + U.esc(item.title) + '</div>' +
      '<div class="i-meta">' + itemMeta(state, item, key) + '</div></div>' +
      '<div class="i-actions">' +
      '<button class="circle' + (status === 'done' ? ' is-done' : '') + '" data-act="toggle" data-id="' + item.id +
      '" data-date="' + key + '" aria-label="完成">' + (status === 'done' ? '✓' : '') + '</button>' +
      '<button class="icon-btn' + (status === 'skipped' ? ' on' : '') + '" data-act="skip" data-id="' + item.id +
      '" data-date="' + key + '" aria-label="跳过">↷</button>' +
      '</div></div>';
  }

  function barChart(data) {
    var W = 320, H = 150, padL = 12, padB = 22, padT = 16;
    var n = data.length;
    var bw = (W - padL * 2) / n;
    var maxV = 1;
    var s = '';
    for (var i = 0; i < n; i++) {
      var v = data[i].value || 0;
      var h = Math.max(2, v * (H - padB - padT));
      var x = padL + i * bw + bw * 0.18;
      var w = bw * 0.64;
      var y = H - padB - h;
      s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
        '" rx="4" fill="' + (v >= 1 ? 'var(--ok)' : 'var(--accent)') + '" opacity="' + (v > 0 ? .95 : .25) + '"/>';
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (y - 4).toFixed(1) + '" font-size="9" fill="var(--text-3)" text-anchor="middle">' +
        Math.round(v * 100) + '</text>';
      s += '<text x="' + (x + w / 2).toFixed(1) + '" y="' + (H - 7) + '" font-size="9" fill="var(--text-3)" text-anchor="middle">' +
        U.esc(data[i].label) + '</text>';
    }
    s += '<line x1="' + padL + '" y1="' + (H - padB) + '" x2="' + (W - padL) + '" y2="' + (H - padB) + '" stroke="var(--line)" stroke-width="1"/>';
    return '<svg class="bars" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">' + s + '</svg>';
  }

  /* ================= 计时组件（倒计时 → 到达后正计时 + 结束态） ================= */
  // 秒数 → HH:MM:SS（小时可超过 24，宽度恒定，配合 tabular-nums 不抖动）
  function fmtHMS(total) {
    total = Math.max(0, Math.floor(total));
    var s = total % 60, m = Math.floor(total / 60) % 60, h = Math.floor(total / 3600);
    function p2(n) { return (n < 10 ? '0' : '') + n; }
    return p2(h) + ':' + p2(m) + ':' + p2(s);
  }
  // 初始占位态：结构与进行中/结束态完全一致，仅文案与配色不同 → 切换无抖动
  function timerBarHtml() {
    return '<div class="timer-bar is-init" id="timerBar" role="status" aria-live="polite">' +
      '<span class="timer-dot"></span>' +
      '<span class="timer-label">计时中</span>' +
      '<span class="timer-val">--:--:--</span></div>';
  }
  // 基于真实时间差刷新；目标到达后自动切为正计时 + 结束态文案（不归零静止）
  function updateTimer() {
    var el = document.getElementById('timerBar');
    if (!el) return;                         // 仅“今天”视图存在该元素
    var cfg = App.timerConfig;
    if (!cfg || !isFinite(cfg.targetTs)) return;
    var diff = cfg.targetTs - Date.now();    // >0 倒计时；<=0 正计时（已结束）
    if (diff > 0) {
      el.className = 'timer-bar is-counting';
      el.querySelector('.timer-label').textContent = '距' + (cfg.label || '目标');
      el.querySelector('.timer-val').textContent = fmtHMS(diff / 1000);
    } else {
      el.className = 'timer-bar is-ended';
      el.querySelector('.timer-label').textContent = cfg.endedText || '已结束';
      el.querySelector('.timer-val').textContent = '+' + fmtHMS(-diff / 1000);
    }
  }
  UI.updateTimer = updateTimer;

  /* ================= 视图：今天 ================= */
  function viewToday(state) {
    var key = st.date;
    var d = L.dayStats(state, key);
    var items = sortItems(L.dueItems(state, key), state, key);
    if (st.filter === 'todo') items = items.filter(function (i) { return L.itemStatus(state, i.id, key) !== 'done'; });
    if (st.filter === 'done') items = items.filter(function (i) { return L.itemStatus(state, i.id, key) === 'done'; });

    var weekFrom = U.startOfWeek(key, state.settings.weekStart);
    var w = L.rangeStats(state, weekFrom, key);

    var html = '<section class="card hero">' + ring(d.rate) +
      '<div class="hero-info">' +
      '<div class="big">' + U.esc(U.relLabel(key)) + ' · ' + d.done + '/' + d.total + '</div>' +
      '<div class="row"><span>连续全勤 <b>' + L.globalStreak(state) + '</b> 天</span>' +
      '<span>本周 <b>' + Math.round(w.rate * 100) + '%</b></span>' +
      '<span>跳过 <b>' + d.skipped + '</b></span></div>' +
      '</div></section>';

    // 计时组件：首屏主视觉下方（倒计时→到达后正计时+结束态，详见 app.js App.timerConfig）
    html += timerBarHtml();

    html += '<div class="chips">' +
      FILTER_ORDER.map(function (key) {
        return '<button class="chip' + (st.filter === key ? ' on' : '') + '" data-act="filter" data-v="' + key + '">' + FILTER_META[key] + '</button>';
      }).join('') + '</div>';

    html += items.length
      ? '<div class="list">' + items.map(function (i) { return itemRow(state, i, key); }).join('') + '</div>'
      : '<div class="empty">🎉 这一天没有待办，点右下角 + 新建清单项</div>';
    return html;
  }

  /* ================= 视图：日历 ================= */
  function shiftMonth(k, n) {
    var d = U.parseKey(k);
    var target = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var maxDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return U.dateKey(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), maxDay)));
  }

  function viewCalendar(state) {
    var ws = state.settings.weekStart;
    var isMonth = st.calMode === 'month';
    var title = isMonth ? U.monthTitle(st.date) : U.weekTitle(st.date, ws);

    var html = '<section class="card">' +
      '<div class="cal-head">' +
      '<div><div class="cal-title">' + title + '</div>' +
      '<div class="small muted">点任意日期进入「当天任务页」</div></div>' +
      '<div class="cal-nav">' +
      '<button data-act="cal-prev">‹</button>' +
      '<button data-act="cal-today" style="width:auto;padding:0 8px;font-size:12px">今天</button>' +
      '<button data-act="cal-next">›</button>' +
      '</div></div>' +
      '<div style="display:flex;justify-content:flex-end;margin-bottom:10px">' +
      '<div class="seg"><button class="' + (isMonth ? 'on' : '') + '" data-act="cal-mode" data-v="month">月</button>' +
      '<button class="' + (!isMonth ? 'on' : '') + '" data-act="cal-mode" data-v="week">周</button></div></div>';

    if (!state.items.length) {
      html += '<div class="empty" style="padding:22px">还没有清单项，点右下角 + 开始记录</div>';
    }

    if (isMonth) {
      var cells = U.monthGrid(st.date, ws);
      var wd = [];
      for (var i = 0; i < 7; i++) wd.push(U.WEEK_SHORT[(ws + i) % 7]);
      html += '<div class="wd-row">' + wd.map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</div>';
      html += '<div class="grid7">' + cells.map(function (k) {
        var s = L.dayStats(state, k);
        var lv = L.dayLevel(state, k);
        var cur = U.parseKey(k).getMonth() === U.parseKey(st.date).getMonth();
        var cls = 'day l' + lv + (cur ? '' : ' out') + (k === U.todayKey() ? ' today' : '') + (k === st.date ? ' sel' : '');
        var dots = '';
        if (s.total) {
          var dueList = L.dueItems(state, k).slice(0, 4);
          dots = '<div class="dots">' + dueList.map(function (it) {
            var done = L.itemStatus(state, it.id, k) === 'done';
            return '<i style="background:' + (done ? it.color : 'var(--line-2)') + '"></i>';
          }).join('') + '</div>';
        }
        return '<button class="' + cls + '" data-act="day-open" data-date="' + k + '">' +
          '<span class="num">' + U.parseKey(k).getDate() + '</span>' + dots + '</button>';
      }).join('') + '</div>';

      var mFrom = U.dateKey(new Date(U.parseKey(st.date).getFullYear(), U.parseKey(st.date).getMonth(), 1));
      var mTo = U.dateKey(new Date(U.parseKey(st.date).getFullYear(), U.parseKey(st.date).getMonth() + 1, 0));
      if (mTo > U.todayKey()) mTo = U.todayKey();
      var ms = L.rangeStats(state, mFrom, mTo);
      html += '<div class="stat-row" style="margin:14px 0 0">' +
        '<div class="stat"><div class="v">' + Math.round(ms.rate * 100) + '%</div><div class="k">本月完成率</div></div>' +
        '<div class="stat"><div class="v">' + ms.done + '</div><div class="k">完成次数</div></div>' +
        '<div class="stat"><div class="v">' + L.globalStreak(state) + '</div><div class="k">连续全勤(天)</div></div>' +
        '</div>';
    } else {
      var from = U.startOfWeek(st.date, ws);
      var days = [];
      for (var j = 0; j < 7; j++) days.push(U.addDays(from, j));
      var rows = state.items.filter(function (it) {
        if (it.archived) return false;
        for (var t = 0; t < 7; t++) if (L.isScheduled(it, days[t])) return true;
        return false;
      });
      html += '<table class="matrix"><thead><tr><th style="text-align:left">清单</th>' +
        days.map(function (k) {
          return '<th class="' + (k === U.todayKey() ? 'today' : '') + '">' + U.WEEK_SHORT[U.weekday(k)] + '<br>' + U.parseKey(k).getDate() + '</th>';
        }).join('') + '</tr></thead><tbody>';
      if (!rows.length) {
        html += '<tr><td colspan="8" class="empty">本周没有排期项</td></tr>';
      }
      rows.forEach(function (it) {
        html += '<tr><td class="m-name" data-act="open-item" data-id="' + it.id + '">' + U.esc(it.title) + '</td>';
        days.forEach(function (k) {
          var scheduled = L.isScheduled(it, k);
          var s = L.itemStatus(state, it.id, k);
          if (!scheduled) { html += '<td><span class="mcell na"></span></td>'; return; }
          var cls = s === 'done' ? ' done' : (s === 'skipped' ? ' skip' : '');
          html += '<td><button class="mcell' + cls + '" data-act="mtoggle" data-id="' + it.id + '" data-date="' + k + '">' +
            (s === 'done' ? '✓' : (s === 'skipped' ? '–' : '')) + '</button></td>';
        });
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</section>';
    html += viewDayPanel(state);   // 选中日详情面板（月/周通用）
    return html;
  }

  /* ================= 视图：统计 ================= */
  function viewStats(state) {
    // 空状态：尚未创建任何清单项
    if (!state.items.length) {
      return '<section class="card"><div class="empty">还没有清单项，去「清单」新建一个开始打卡吧 🚀</div></section>';
    }
    var today = U.todayKey();
    var ws = state.settings.weekStart;
    var d = L.dayStats(state, today);
    var wFrom = U.startOfWeek(today, ws), wTo = U.addDays(wFrom, 6);
    if (wTo > today) wTo = today;
    var w = L.rangeStats(state, wFrom, wTo);
    var mFrom = U.dateKey(new Date(U.parseKey(today).getFullYear(), U.parseKey(today).getMonth(), 1));
    var m = L.rangeStats(state, mFrom, today);
    var yStart = U.dateKey(new Date(U.parseKey(today).getFullYear(), 0, 1));
    var y = L.rangeStats(state, yStart, today);

    var html = '<div class="stat-row">' +
      '<div class="stat"><div class="v" style="color:var(--accent)">' + Math.round(d.rate * 100) + '%</div><div class="k">今日完成率</div></div>' +
      '<div class="stat"><div class="v">' + Math.round(w.rate * 100) + '%</div><div class="k">本周</div></div>' +
      '<div class="stat"><div class="v">' + Math.round(m.rate * 100) + '%</div><div class="k">本月</div></div>' +
      '<div class="stat"><div class="v">' + Math.round(y.rate * 100) + '%</div><div class="k">本年</div></div>' +
      '</div>';

    html += '<section class="card"><div class="card-title">完成率趋势' +
      '<span class="seg"><button class="' + (st.statsMode === 'week' ? 'on' : '') + '" data-act="stats-mode" data-v="week">周</button>' +
      '<button class="' + (st.statsMode === 'month' ? 'on' : '') + '" data-act="stats-mode" data-v="month">月</button>' +
      '<button class="' + (st.statsMode === 'year' ? 'on' : '') + '" data-act="stats-mode" data-v="year">年</button></span></div>' +
      (state.checkins.length ? barChart(L.trend(state, st.statsMode)) : '<div class="empty" style="padding:30px">暂无打卡记录</div>') +
      '</section>';

    var hm = L.heatmap(state, 17, ws);
    html += '<section class="card"><div class="card-title">打卡热力图 <span class="small muted">近 ' + hm.weeks + ' 周</span></div>' +
      '<div class="heat">' + hm.cells.map(function (c) {
        return '<i class="l' + c.level + (c.future ? ' future' : '') + '" title="' + c.key +
          (c.future ? ' · 未到来' : ' · 完成 ' + c.done + '/' + c.total) + '"></i>';
      }).join('') + '</div>' +
      '<div class="heat-legend"><span>少</span>' +
      [0, 1, 2, 3, 4].map(function (l) { return '<i class="l' + l + '" style="background:' + legendBg(l) + '"></i>'; }).join('') +
      '<span>多</span></div></section>';

    var longest = state.items.filter(function (i) { return !i.archived; }).map(function (i) {
      return { item: i, cur: L.itemStreak(state, i), best: L.itemLongest(state, i) };
    }).sort(function (a, b) { return b.best - a.best || b.cur - a.cur; }).slice(0, 5);

    html += '<section class="card"><div class="card-title">连续记录</div>' +
      '<div class="kv"><span class="k">当前连续全勤</span><b>' + L.globalStreak(state) + ' 天</b></div>' +
      '<div class="kv"><span class="k">历史最长全勤</span><b>' + L.globalLongest(state) + ' 天</b></div>' +
      '<div class="kv"><span class="k">累计完成</span><b>' + state.checkins.filter(function (c) { return c.status === 'done'; }).length + ' 次</b></div>' +
      '<div style="margin-top:10px">' + longest.map(function (x, i) {
        return '<div class="rank"><span class="n">' + (i + 1) + '</span>' +
          '<span class="t">' + U.esc(x.item.title) + '</span>' +
          '<span class="v" style="color:' + x.item.color + '">最长 ' + x.best + ' · 当前 ' + x.cur + '</span></div>';
      }).join('') + '</div></section>';

    var cs = L.categoryStats(state, 30);
    var hasCat = cs.length && cs.some(function (c) { return c.done > 0; });
    var max = Math.max.apply(null, cs.map(function (c) { return c.done; }).concat([1]));
    html += '<section class="card"><div class="card-title">分类分布 <span class="small muted">近 30 天</span></div>' +
      (hasCat ? cs.map(function (c) {
        return '<div class="bar-line"><span class="lb">' + U.esc(c.name) + '</span>' +
          '<span class="track"><span class="fill" style="width:' + (c.done / max * 100) + '%;background:' + c.color + '"></span></span>' +
          '<span class="vv">' + c.done + '</span></div>';
      }).join('') : '<div class="empty" style="padding:24px">近 30 天暂无完成记录</div>') +
      '</section>';
    return html;
  }
  function legendBg(l) {
    if (l === 0) return 'var(--line)';
    return 'color-mix(in srgb, var(--ok) ' + (l * 25) + '%, var(--bg-elev))';
  }

  /* ================= 视图：清单管理 ================= */
  function viewManage(state) {
    var today = U.todayKey();
    var active = state.items.filter(function (i) { return !i.archived; });
    var archived = state.items.filter(function (i) { return i.archived; });

    // 实时进度（今日完成率）
    var dp = L.dayStats(state, today);
    var html = '<section class="card hero">' + ring(dp.rate) +
      '<div class="hero-info"><div class="big">今日 ' + dp.done + '/' + dp.total + ' 完成</div>' +
      '<div class="row"><span>进行中 <b>' + active.length + '</b></span>' +
      '<span>已归档 <b>' + archived.length + '</b></span>' +
      '<span>连续 <b>' + L.globalStreak(state) + '</b> 天</span></div></div></section>';

    // 排序 / 筛选控制
    html += '<div class="toolbar">' +
      '<div class="chips">' +
      FILTER_ORDER.map(function (key) {
        return '<button class="chip' + (st.manageFilter === key ? ' on' : '') + '" data-act="manage-filter" data-v="' + key + '">' + FILTER_META[key] + '</button>';
      }).join('') + '</div>' +
      '<div class="seg"><button class="' + (st.manageSort === 'priority' ? 'on' : '') + '" data-act="manage-sort" data-v="priority">优先级</button>' +
      '<button class="' + (st.manageSort === 'time' ? 'on' : '') + '" data-act="manage-sort" data-v="time">时间</button>' +
      '<button class="' + (st.manageSort === 'created' ? 'on' : '') + '" data-act="manage-sort" data-v="created">创建</button></div>' +
      '</div>';

    // 过滤 + 排序
    var list = active.slice();
    if (st.manageFilter === 'todo') list = list.filter(function (i) { return L.itemStatus(state, i.id, today) !== 'done'; });
    else if (st.manageFilter === 'done') list = list.filter(function (i) { return L.itemStatus(state, i.id, today) === 'done'; });
    list = sortManage(list);

    html += '<section class="card"><div class="card-title">清单项 <span class="small muted">' + list.length + ' 项</span></div>';
    if (!list.length) {
      html += '<div class="empty">' + (active.length ? '当前筛选下没有事项' : '还没有清单项，点右下角 + 新建') + '</div>';
    } else {
      html += '<div class="list">' + list.map(function (i) { return manageItemRow(state, i, today); }).join('') + '</div>';
    }
    html += '</section>';

    html += '<section class="card"><div class="card-title" style="cursor:pointer" data-act="toggle-archived">' +
      '已归档 <span class="small muted">' + archived.length + ' 项 · ' + (st.showArchived ? '收起' : '展开') + '</span></div>';
    if (st.showArchived) {
      html += archived.length ? '<div class="list">' + archived.map(function (i) {
        return '<div class="item" style="opacity:.7;border-left-color:' + i.color + '">' +
          '<div class="i-main"><div class="i-title">' + U.esc(i.title) + '</div>' +
          '<div class="i-meta">' + U.esc(L.repeatLabel(i)) + dueInfo(i) + '</div></div>' +
          '<div class="i-actions">' +
          '<button class="icon-btn" data-act="restore-item" data-id="' + i.id + '" title="恢复">↩</button>' +
          '<button class="icon-btn" data-act="delete-item" data-id="' + i.id + '" title="删除">🗑</button>' +
          '</div></div>';
      }).join('') + '</div>' : '<div class="empty" style="padding:18px">暂无归档</div>';
    }
    html += '</section>';

    html += '<section class="card"><div class="card-title">分类标签</div>' +
      state.categories.map(function (c) {
        return '<div class="kv"><span class="k"><span class="tag" style="background:' + hexA(c.color, .14) + ';color:' + c.color + '">' +
          U.esc(c.name) + '</span></span>' +
          '<span><span class="small muted">' + state.items.filter(function (i) { return i.category === c.id; }).length + ' 项</span></span></div>';
      }).join('') +
      '<button class="btn ghost" style="margin-top:10px" data-act="add-category">+ 新建分类</button></section>';

    html += '<section class="card"><div class="card-title">设置</div>' +
      '<div class="kv" data-act="open-settings"><span class="k">提醒 · 免打扰 · 外观 · 数据</span><span class="muted">›</span></div></section>';
    return html;
  }

  /* ================= 我的（帮助 / 关于 / 数据 · 手机 App 卡片排版） ================= */
  function viewMe(state) {
    var feat = [
      { v: 'today', icon: '✅', t: '今日打卡', d: '一眼看清今天待办，圆圈一点即完成' },
      { v: 'calendar', icon: '📅', t: '日历补卡', d: '月/周回顾轨迹，错过也能补打卡' },
      { v: 'stats', icon: '📊', t: '数据统计', d: '完成率、趋势、连续天数一目了然' },
      { v: 'manage', icon: '📋', t: '清单管理', d: '分类、优先级、重复与提醒随心配' }
    ];
    var tips = [
      '点底部「+」快速新增；圆圈=完成，↷=跳过，可随时撤销',
      '日历里点任意日期即可补打卡或新增当日事项',
      '长按「清单」顶部可切换排序（优先级/时间/创建）与筛选',
      '开启提醒后，到点会在通知栏与 App 内轻轻提示你'
    ];
    var faqs = [
      { q: '我的数据存在哪里？', a: '全部保存在本机浏览器（localStorage），不上传任何服务器，离线也能用。' },
      { q: '如何备份 / 迁移数据？', a: '在「清单」页底部打开设置 → 导出 JSON；换设备后导入同一份 JSON 即可恢复。' },
      { q: '错过打卡还能补吗？', a: '可以。日历点任意日期会进入「当天任务页」，按已完成 / 未完成分组显示，并可直接补打卡或「+ 在 X 新增事项」。' },
      { q: '支持深色模式吗？', a: '支持。设置里切换浅色 / 深色 / 跟随系统即可。' }
    ];

    var html = '';
    // Hero：应用标识
    html += '<section class="card me-hero">' +
      '<div class="me-avatar">✓</div>' +
      '<div class="me-id"><div class="me-name">HabitCheck</div>' +
      '<div class="me-sub">极简清单打卡 · 让坚持看得见</div>' +
      '<div class="me-ver">v1.0.2</div></div></section>';

    // 功能亮点（点按直接跳转对应页）
    html += '<div class="me-sec-title">功能亮点</div><div class="feat-grid">';
    html += feat.map(function (f) {
      return '<button class="feat" data-act="nav" data-view="' + f.v + '">' +
        '<div class="feat-ic">' + f.icon + '</div>' +
        '<div class="feat-t">' + f.t + '</div>' +
        '<div class="feat-d">' + f.d + '</div></button>';
    }).join('');
    html += '</div>';

    // 使用技巧
    html += '<div class="me-sec-title">使用技巧</div><section class="card me-tips">';
    html += tips.map(function (t) { return '<div class="tip">' + t + '</div>'; }).join('');
    html += '</section>';

    // 常见问题（手风琴折叠）
    html += '<div class="me-sec-title">常见问题</div><section class="card faq-wrap">';
    html += faqs.map(function (f, i) {
      return '<div class="faq' + (i === 0 ? ' open' : '') + '">' +
        '<div class="faq-q" data-act="faq"><span>' + f.q + '</span><span class="faq-ar">⌄</span></div>' +
        '<div class="faq-a"><div class="faq-a-in">' + f.a + '</div></div></div>';
    }).join('');
    html += '</section>';

    // 数据说明 + 设置入口
    html += '<section class="card me-foot">' +
      '<div class="kv" data-act="open-settings"><span class="k">设置 · 提醒 · 外观 · 数据</span><span class="muted">›</span></div>' +
      '<div class="me-note">本地优先 · 隐私安全 · 无广告</div></section>';

    return html;
  }

  /* ================= 视图：当天任务（点日历日期跳转，按完成态分组） ================= */
  /**
   * 当天任务页：展示所选日期的全部任务，按「已完成 / 未完成」明确分组。
   * 数据来源：logic.dueItems(state, key) 取该日应做/逾期项；logic.itemStatus 判定单条完成态。
   * 字段保证：每条任务都带 title（标题）+ status（完成状态 'done'/其它），与日期通过 checkins[itemId@date] 正确关联。
   */
  function viewDay(state) {
    var key = st.date;
    var d = L.dayStats(state, key);
    var items = sortItems(L.dueItems(state, key), state, key);
    // 按完成状态分类：done = 已完成；其余（待完成 / 已跳过）归入未完成
    var done = [], todo = [];
    items.forEach(function (it) {
      (L.itemStatus(state, it.id, key) === 'done' ? done : todo).push(it);
    });
    var makeup = key !== U.todayKey();

    var html = '';
    // 顶部概览：已完成 / 未完成 / 完成率
    html += '<section class="card day-summary">' +
      '<div class="stat-row" style="margin:0">' +
      '<div class="stat"><div class="v" style="color:var(--ok)">' + done.length + '</div><div class="k">已完成</div></div>' +
      '<div class="stat"><div class="v">' + todo.length + '</div><div class="k">未完成</div></div>' +
      '<div class="stat"><div class="v">' + Math.round(d.rate * 100) + '%</div><div class="k">完成率</div></div>' +
      '</div></section>';

    // 分组 1：已完成
    html += dayGroup('已完成', done, state, key, true);
    // 分组 2：未完成（含待完成与已跳过）
    html += dayGroup('未完成', todo, state, key, false);

    // 在所选日期新增事项
    html += '<button class="btn ghost" style="width:100%;margin-top:6px" data-act="new-item-date" data-date="' + key + '">' +
      '+ 在 ' + U.prettyDate(key) + ' 新增事项</button>';
    return html;
  }

  /** 单一分组区块：标题带计数 + 列表（空状态友好提示） */
  function dayGroup(label, list, state, key, isDone) {
    var color = isDone ? 'var(--ok)' : 'var(--text-2)';
    var html = '<section class="card day-group">' +
      '<div class="card-title group-head" style="color:' + color + '">' +
      '<span class="gh-dot" style="background:' + color + '"></span>' + label +
      ' <span class="muted">' + list.length + '</span></div>';
    if (!list.length) {
      html += '<div class="empty" style="padding:14px">' +
        (isDone ? '这一天还没有已完成的任务' : '这一天没有待办，享受轻松时光 🎉') + '</div>';
    } else {
      html += '<div class="list">' + list.map(function (i) { return dayItemRow(state, i, key); }).join('') + '</div>';
    }
    html += '</section>';
    return html;
  }

  /* ================= 头部 ================= */
  function headerHtml(state) {
    var titles = { today: '今天', calendar: '日历', stats: '统计', manage: '清单', me: '我的', day: U.prettyDate(st.date) };
    var subs = {
      today: U.prettyDate(st.date),
      calendar: '点日期进入当天任务页',
      stats: '完成率 · 趋势 · 连续记录',
      manage: '共 ' + state.items.filter(function (i) { return !i.archived; }).length + ' 项进行中',
      me: '使用指南 · 关于 · 数据',
      day: U.relLabel(st.date)
    };
    var back = st.view === 'day'
      ? '<button class="icon-btn nav-back" data-act="back-cal" aria-label="返回日历">‹</button>'
      : '';
    var streak = st.view === 'day' ? '' : '<span class="streak-chip">🔥 连续 ' + L.globalStreak(state) + ' 天</span>';
    return '<div class="appbar-row">' + back + '<div><h1>' + titles[st.view] + '</h1>' +
      '<div class="sub">' + subs[st.view] + '</div></div>' + streak + '</div>';
  }

  /* ================= 渲染入口 ================= */
  function render() {
    var state = S.getState();
    if (!state) return;
    document.body.setAttribute('data-theme', resolveTheme(state.settings.theme));
    $('#appHeader').innerHTML = headerHtml(state);
    var html = st.view === 'today' ? viewToday(state)
      : st.view === 'calendar' ? viewCalendar(state)
        : st.view === 'stats' ? viewStats(state)
          : st.view === 'me' ? viewMe(state)
            : st.view === 'day' ? viewDay(state)
              : viewManage(state);
    $('#view').innerHTML = html;
    UI.updateTimer();
    var fab = $('#fab');
    if (st.view === 'stats' || st.view === 'me') {
      fab.style.display = 'none';
    } else {
      fab.style.display = 'flex';
      if (st.view === 'day') { fab.dataset.act = 'new-item-date'; fab.dataset.date = st.date; }
      else { fab.dataset.act = 'new-item'; delete fab.dataset.date; }
    }
    var tabs = document.querySelectorAll('#tabbar button');
    for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle('on', tabs[i].dataset.view === st.view);
  }
  UI.render = render;

  function resolveTheme(t) {
    if (t === 'auto') {
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return t || 'light';
  }

  /* ================= 弹层内容 ================= */

  /* ================= 日历：选中日详情面板 + 清单页辅助 ================= */

  /** 清单页排序：优先级 / 时间 / 创建 */
  function sortManage(list) {
    var P = { high: 0, medium: 1, low: 2 };
    return list.slice().sort(function (a, b) {
      if (st.manageSort === 'priority') {
        var pa = P[a.priority] == null ? 1 : P[a.priority];
        var pb = P[b.priority] == null ? 1 : P[b.priority];
        if (pa !== pb) return pa - pb;
      }
      if (st.manageSort === 'time') {
        if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
      }
      return a.createdAt - b.createdAt;
    });
  }

  /** 截止 / 结束日期提示（任务=截止日，习惯=结束日） */
  function dueInfo(item) {
    if (item.repeat && item.repeat.type === 'once') return ' · 截止 ' + item.startDate;
    if (item.endDate) return ' · 至 ' + item.endDate;
    return '';
  }

  /** 日历选中日：单行事项（完成 / 跳过 / 编辑 / 删除） */
  function dayItemRow(state, item, key) {
    var status = L.itemStatus(state, item.id, key);
    var cls = status === 'done' ? ' done' : (status === 'skipped' ? ' skipped' : '');
    return '<div class="item' + cls + '" style="border-left-color:' + item.color + '">' +
      '<div class="i-main" data-act="edit-item" data-id="' + item.id + '">' +
      '<div class="i-title">' + U.esc(item.title) + '</div>' +
      '<div class="i-meta">' + itemMeta(state, item, key) + '</div></div>' +
      '<div class="i-actions">' +
      '<button class="circle' + (status === 'done' ? ' is-done' : '') + '" data-act="toggle" data-id="' + item.id +
      '" data-date="' + key + '" aria-label="完成">' + (status === 'done' ? '✓' : '') + '</button>' +
      '<button class="icon-btn' + (status === 'skipped' ? ' on' : '') + '" data-act="skip" data-id="' + item.id +
      '" data-date="' + key + '" aria-label="跳过">↷</button>' +
      '<button class="icon-btn" data-act="edit-item" data-id="' + item.id + '" title="编辑">✎</button>' +
      '<button class="icon-btn" data-act="delete-item" data-id="' + item.id + '" title="删除">🗑</button>' +
      '</div></div>';
  }

  /** 日历选中日：详情面板（与网格联动，点日期即切换；支持补打卡/撤销/新增/编辑/删除） */
  function viewDayPanel(state) {
    var key = st.date;
    var d = L.dayStats(state, key);
    var items = sortItems(L.dueItems(state, key), state, key);
    var makeup = key !== U.todayKey();
    var html = '<section class="card"><div class="card-title">' + U.prettyDate(key) + ' · ' + U.relLabel(key) +
      (makeup ? ' <span class="small muted">补打卡</span>' : '') + '</div>';
    html += '<div class="stat-row" style="margin:0 0 10px">' +
      '<div class="stat"><div class="v">' + d.done + '/' + d.total + '</div><div class="k">已完成</div></div>' +
      '<div class="stat"><div class="v">' + Math.round(d.rate * 100) + '%</div><div class="k">完成率</div></div>' +
      '<div class="stat"><div class="v">' + d.skipped + '</div><div class="k">跳过</div></div></div>';
    if (!items.length) {
      html += '<div class="empty">这一天没有排期项' + (makeup ? '' : '，点下方按钮新增') + '</div>';
    } else {
      html += '<div class="list">' + items.map(function (i) { return dayItemRow(state, i, key); }).join('') + '</div>';
    }
    html += '<button class="btn ghost" style="width:100%;margin-top:10px" data-act="new-item-date" data-date="' + key + '">+ 在 ' + U.prettyDate(key) + ' 新增事项</button>';
    html += '</section>';
    return html;
  }

  /** 清单页：单行事项（勾选完成 / 编辑 / 归档 / 删除） */
  function manageItemRow(state, item, key) {
    var status = L.itemStatus(state, item.id, key);
    var cls = status === 'done' ? ' done' : (status === 'skipped' ? ' skipped' : '');
    var meta = itemMeta(state, item, key) + dueInfo(item);
    return '<div class="item' + cls + '" style="border-left-color:' + item.color + '">' +
      '<div class="i-main" data-act="edit-item" data-id="' + item.id + '">' +
      '<div class="i-title">' + U.esc(item.title) + '</div>' +
      '<div class="i-meta">' + meta + '</div></div>' +
      '<div class="i-actions">' +
      '<button class="circle' + (status === 'done' ? ' is-done' : '') + '" data-act="toggle" data-id="' + item.id +
      '" data-date="' + key + '" aria-label="完成">' + (status === 'done' ? '✓' : '') + '</button>' +
      '<button class="icon-btn" data-act="edit-item" data-id="' + item.id + '" title="编辑">✎</button>' +
      '<button class="icon-btn" data-act="archive-item" data-id="' + item.id + '" title="归档">📥</button>' +
      '<button class="icon-btn" data-act="delete-item" data-id="' + item.id + '" title="删除">🗑</button>' +
      '</div></div>';
  }

  /** 清单项详情 */
  function sheetItem(id) {
    var state = S.getState();
    var it = L.itemById(state, id);
    if (!it) return;
    var key = st.date;
    var stt = L.itemStatus(state, it.id, key);
    var html = '<div class="kv"><span class="k">分类</span><b>' + U.esc(L.categoryName(state, it.category)) + '</b></div>' +
      '<div class="kv"><span class="k">重复规则</span><b>' + U.esc(L.repeatLabel(it)) + '</b></div>' +
      '<div class="kv"><span class="k">优先级</span><b>' + ({ high: '高', medium: '中', low: '低' }[it.priority] || '中') + '</b></div>' +
      '<div class="kv"><span class="k">提醒</span><b>' + (it.reminder && it.reminder.enabled ? it.reminder.time : '未开启') + '</b></div>' +
      '<div class="kv"><span class="k">生效区间</span><b>' + it.startDate + (it.endDate ? ' ~ ' + it.endDate : ' 起') + '</b></div>' +
      '<div class="kv"><span class="k">连续 / 最长</span><b>' + L.itemStreak(state, it) + ' / ' + L.itemLongest(state, it) + '</b></div>' +
      (it.note ? '<div class="kv"><span class="k">备注</span><b style="font-weight:400;text-align:right;max-width:60%">' + U.esc(it.note) + '</b></div>' : '');

    html += '<div class="card-title" style="margin:16px 0 8px">近 7 天</div><div class="chips" style="padding:0">';
    for (var i = 6; i >= 0; i--) {
      var k = U.addDays(U.todayKey(), -i);
      var s = L.itemStatus(state, it.id, k);
      var bg = s === 'done' ? 'var(--ok)' : (s === 'skipped' ? 'var(--line-2)' : 'transparent');
      html += '<div style="flex:1;text-align:center">' +
        '<div style="height:26px;border-radius:8px;border:1px solid var(--line-2);background:' + bg + '"></div>' +
        '<div class="small muted" style="margin-top:4px">' + U.WEEK_SHORT[U.weekday(k)] + '</div></div>';
    }
    html += '</div>';

    html += '<div class="btn-row"><button class="btn ghost" data-act="edit-item" data-id="' + it.id + '">编辑</button>' +
      '<button class="btn ghost" data-act="archive-item" data-id="' + it.id + '">归档</button></div>' +
      '<div class="btn-row"><button class="btn danger" data-act="delete-item" data-id="' + it.id + '">删除此项</button></div>';
    if (stt) {
      html += '<div class="btn-row"><button class="btn ghost" data-act="set" data-id="' + it.id +
        '" data-date="' + key + '" data-status="">撤销' + U.relLabel(key) + '打卡</button></div>';
    }
    openSheet(it.title, html);
  }

  /** 新建 / 编辑表单。presetDate 可选，用于"在某天新增事项"预设开始日期 */
  function sheetEditor(item, presetDate) {
    var state = S.getState();
    presetDate = U.isValidKey(presetDate) ? presetDate : null;
    var it = item || S.newItem(Object.assign(
      { category: state.categories[0] ? state.categories[0].id : 'other' },
      presetDate ? { startDate: presetDate } : {}
    ));
    var r = it.repeat || { type: 'daily', days: [], times: 3 };
    var cats = state.categories.map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === it.category ? ' selected' : '') + '>' + U.esc(c.name) + '</option>';
    }).join('');
    var daysHtml = [1, 2, 3, 4, 5, 6, 0].map(function (d) {
      return '<label><input type="checkbox" name="f-days" value="' + d + '"' + ((r.days || []).indexOf(d) >= 0 ? ' checked' : '') +
        '><span>' + U.WEEK_SHORT[d] + '</span></label>';
    }).join('');

    var html = '<form id="itemForm" data-act="save-item" data-id="' + (item ? it.id : '') + '">' +
      '<div class="field"><label>名称</label><input class="input" id="f-title" value="' + U.esc(it.title) + '" placeholder="例如：晨间阅读 30 分钟" required></div>' +
      '<div class="field frow">' +
      '<div><label>类型</label><select class="select" id="f-type">' +
      '<option value="habit"' + (it.type === 'habit' ? ' selected' : '') + '>习惯（可重复）</option>' +
      '<option value="task"' + (it.type === 'task' ? ' selected' : '') + '>任务（单次）</option></select></div>' +
      '<div><label>优先级</label><select class="select" id="f-priority">' +
      ['high|高', 'medium|中', 'low|低'].map(function (x) {
        var p = x.split('|');
        return '<option value="' + p[0] + '"' + (it.priority === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div></div>' +
      '<div class="field"><label>分类标签</label><select class="select" id="f-category">' + cats + '</select></div>' +
      '<div class="field"><label>重复规则</label><select class="select" id="f-repeat">' +
      ['daily|每天', 'weekly|自定义星期', 'times|每周指定次数', 'once|单次（指定日期）'].map(function (x) {
        var p = x.split('|');
        return '<option value="' + p[0] + '"' + (r.type === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="field" id="wrap-days" style="display:' + (r.type === 'weekly' ? 'block' : 'none') + '"><label>星期</label><div class="days">' + daysHtml + '</div></div>' +
      '<div class="field" id="wrap-times" style="display:' + (r.type === 'times' ? 'block' : 'none') + '"><label>每周次数</label>' +
      '<input class="input" id="f-times" type="number" min="1" max="7" value="' + (r.times || 3) + '"></div>' +
      '<div class="field frow"><div><label>开始日期</label><input class="input" id="f-start" type="date" value="' + it.startDate + '"></div>' +
      '<div><label>结束日期（可选）</label><input class="input" id="f-end" type="date" value="' + (it.endDate || '') + '"></div></div>' +
      '<div class="field"><label>颜色</label><div class="swatches">' + PALETTE.map(function (c) {
        return '<label style="color:' + c + '"><input type="radio" name="f-color" value="' + c + '"' + (it.color === c ? ' checked' : '') +
          '><span style="background:' + c + '"></span></label>';
      }).join('') + '</div></div>' +
      '<div class="field"><div class="switch"><span class="lb">提醒通知</span>' +
      '<button type="button" class="toggle' + (it.reminder && it.reminder.enabled ? ' on' : '') + '" data-act="switch" data-target="f-remind"></button>' +
      '<input type="hidden" id="f-remind" value="' + (it.reminder && it.reminder.enabled ? '1' : '0') + '"></div>' +
      '<input class="input" id="f-time" type="time" value="' + ((it.reminder && it.reminder.time) || '08:00') + '"></div>' +
      '<div class="field"><label>备注</label><textarea class="textarea" id="f-note" placeholder="补充说明、执行标准…">' + U.esc(it.note || '') + '</textarea></div>' +
      '<button class="btn" type="submit">' + (item ? '保存修改' : '创建清单项') + '</button>' +
      (item ? '<div class="btn-row"><button type="button" class="btn danger" data-act="delete-item" data-id="' + it.id + '">删除</button></div>' : '') +
      '</form>';
    openSheet(item ? '编辑清单项' : '新建清单项', html);
  }

  /** 设置 */
  function sheetSettings() {
    var s = S.getState().settings;
    var html = '<div class="card" style="padding:12px 14px">' +
      '<div class="field"><label>每周起始日</label><select class="select" id="s-weekstart">' +
      '<option value="1"' + (s.weekStart === 1 ? ' selected' : '') + '>周一</option>' +
      '<option value="0"' + (s.weekStart === 0 ? ' selected' : '') + '>周日</option></select></div>' +
      '<div class="field"><label>外观</label><select class="select" id="s-theme">' +
      ['light|浅色', 'dark|深色', 'auto|跟随系统'].map(function (x) {
        var p = x.split('|');
        return '<option value="' + p[0] + '"' + (s.theme === p[0] ? ' selected' : '') + '>' + p[1] + '</option>';
      }).join('') + '</select></div>' +
      '<div class="switch"><span class="lb">系统通知</span>' +
      '<button class="toggle' + (s.notify.enabled ? ' on' : '') + '" data-act="switch" data-target="s-notify"></button>' +
      '<input type="hidden" id="s-notify" value="' + (s.notify.enabled ? '1' : '0') + '"></div>' +
      '<div class="small muted" id="notify-hint">' + notifyHint() + '</div>' +
      '</div>';

    html += '<div class="card" style="padding:12px 14px">' +
      '<div class="switch"><span class="lb">免打扰时段</span>' +
      '<button class="toggle' + (s.dnd.enabled ? ' on' : '') + '" data-act="switch" data-target="s-dnd"></button>' +
      '<input type="hidden" id="s-dnd" value="' + (s.dnd.enabled ? '1' : '0') + '"></div>' +
      '<div class="frow"><div class="field"><label>开始</label><input class="input" id="s-dnd-start" type="time" value="' + s.dnd.start + '"></div>' +
      '<div class="field"><label>结束</label><input class="input" id="s-dnd-end" type="time" value="' + s.dnd.end + '"></div></div>' +
      '<div class="small muted">免打扰时段内不推送提醒，仅保留应用内记录。</div></div>';

    html += '<div class="card" style="padding:12px 14px"><div class="card-title">数据</div>' +
      '<div class="btn-row"><button class="btn ghost" data-act="export">导出 JSON</button>' +
      '<button class="btn ghost" data-act="import">导入 JSON</button></div>' +
      '<div class="btn-row"><button class="btn danger" data-act="reset">清空并恢复演示数据</button></div>' +
      '<div class="small muted" style="margin-top:8px">数据全部保存在本机 localStorage，可离线使用。</div></div>';

    html += '<div class="btn-row"><button class="btn" data-act="save-settings">保存设置</button></div>';
    openSheet('设置', html);
  }
  function notifyHint() {
    if (!('Notification' in window)) return '当前环境不支持系统通知，将使用应用内提示。';
    if (Notification.permission === 'granted') return '已授权系统通知。';
    if (Notification.permission === 'denied') return '通知已被浏览器拒绝，请在站点设置中开启。';
    return '开启后首次会请求通知权限。';
  }

  /** 新建分类 */
  function sheetCategory() {
    var html = '<div class="field"><label>名称</label><input class="input" id="c-name" placeholder="例如：阅读"></div>' +
      '<div class="field"><label>颜色</label><div class="swatches">' + PALETTE.map(function (c, i) {
        return '<label style="color:' + c + '"><input type="radio" name="c-color" value="' + c + '"' + (i === 0 ? ' checked' : '') +
          '><span style="background:' + c + '"></span></label>';
      }).join('') + '</div></div>' +
      '<button class="btn" data-act="save-category">创建</button>';
    openSheet('新建分类', html);
  }

  /* ================= 事件 ================= */
  function setStatus(itemId, date, status, label) {
    var state = S.getState();
    var it = L.itemById(state, itemId);
    S.dispatch({ type: 'CHECKIN_SET', itemId: itemId, date: date, status: status });
    if (!status) { toast('已撤销：' + (it ? it.title : '')); return; }
    toast((status === 'done' ? '已完成 · ' : '已跳过 · ') + (it ? it.title : ''), '撤销', function () {
      S.dispatch({ type: 'CHECKIN_SET', itemId: itemId, date: date, status: null });
    });
  }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.dataset.act;
    var id = el.dataset.id;
    var date = el.dataset.date || st.date;

    switch (act) {
      case 'nav':
        // 改 hash 即可：hashchange 由 app.js 监听并同步视图（支持前进/后退、深层链接）
        location.hash = '#/' + el.dataset.view;
        break;
      case 'back-cal':
        // 当天任务页 → 返回日历（保留已选日期）
        location.hash = '#/calendar';
        break;
      case 'filter':
        st.filter = el.dataset.v; render(); break;
      case 'cal-mode':
        st.calMode = el.dataset.v; render(); break;
      case 'stats-mode':
        st.statsMode = el.dataset.v; render(); break;
      case 'cal-prev':
        st.date = st.calMode === 'month' ? shiftMonth(st.date, -1) : U.addDays(st.date, -7); render(); break;
      case 'cal-next':
        st.date = st.calMode === 'month' ? shiftMonth(st.date, 1) : U.addDays(st.date, 7); render(); break;
      case 'cal-today':
        st.date = U.todayKey(); render(); break;
      case 'manage-filter':
        st.manageFilter = el.dataset.v; render(); break;
      case 'manage-sort':
        st.manageSort = el.dataset.v; render(); break;
      case 'new-item-date':
        sheetEditor(null, el.dataset.date); break;
      case 'day-open':
        // 点任意日期 → 跳转到【当天任务页】（支持浏览器前进/后退与深层链接）
        location.hash = '#/day/' + el.dataset.date;
        break;
      case 'faq': {   // 常见问题手风琴：单开模式（展开一条即收起其余），不触发整页重渲染
        var fq = el.closest('.faq');
        if (!fq) break;
        var opening = !fq.classList.contains('open');
        var sibs = fq.parentNode.querySelectorAll('.faq');
        for (var k = 0; k < sibs.length; k++) sibs[k].classList.remove('open');
        if (opening) fq.classList.add('open');
        break;
      }
      case 'toggle': { // 圆圈：未打卡 -> 完成 -> 撤销
        var cur = L.itemStatus(S.getState(), id, date);
        setStatus(id, date, cur === 'done' ? null : 'done');
        break;
      }
      case 'skip': {
        var c2 = L.itemStatus(S.getState(), id, date);
        setStatus(id, date, c2 === 'skipped' ? null : 'skipped');
        break;
      }
      case 'mtoggle': { // 周矩阵：完成 -> 跳过 -> 清除
        var c3 = L.itemStatus(S.getState(), id, date);
        setStatus(id, date, c3 === 'done' ? 'skipped' : (c3 === 'skipped' ? null : 'done'));
        break;
      }
      case 'set':
        setStatus(id, date, el.dataset.status || null);
        break;
      case 'open-item':
        sheetItem(id); break;
      case 'new-item':
        sheetEditor(null); break;
      case 'edit-item':
        sheetEditor(L.itemById(S.getState(), id)); break;
      case 'delete-item': {
        var it = L.itemById(S.getState(), id);
        if (!it) break;
        if (confirm('确定删除「' + it.title + '」？相关打卡记录也会一并删除。')) {
          S.dispatch({ type: 'ITEM_DELETE', id: id });
          closeSheet();
          toast('已删除');
        }
        break;
      }
      case 'archive-item':
        S.dispatch({ type: 'ITEM_ARCHIVE', id: id, value: true });
        closeSheet(); toast('已归档，可在「清单」中恢复');
        break;
      case 'restore-item':
        S.dispatch({ type: 'ITEM_ARCHIVE', id: id, value: false });
        toast('已恢复');
        break;
      case 'toggle-archived':
        st.showArchived = !st.showArchived; render(); break;
      case 'add-category':
        sheetCategory(); break;
      case 'save-category': {
        var n = $('#c-name').value.trim();
        if (!n) { toast('请填写名称'); break; }
        var col = document.querySelector('input[name=c-color]:checked');
        S.dispatch({
          type: 'CATEGORY_CREATE',
          payload: { id: U.uid('cat'), name: n, color: col ? col.value : PALETTE[0] }
        });
        closeSheet(); toast('分类已创建');
        break;
      }
      case 'open-settings':
        sheetSettings(); break;
      case 'save-settings': {
        var notifyOn = $('#s-notify').value === '1';
        if (notifyOn && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        S.dispatch({
          type: 'SETTINGS_UPDATE',
          patch: {
            weekStart: +$('#s-weekstart').value,
            theme: $('#s-theme').value,
            notify: { enabled: notifyOn },
            dnd: { enabled: $('#s-dnd').value === '1', start: $('#s-dnd-start').value || '22:30', end: $('#s-dnd-end').value || '07:00' }
          }
        });
        closeSheet(); toast('设置已保存');
        break;
      }
      case 'export': {
        var blob = new Blob([S.exportJSON()], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'habitcheck-' + U.todayKey() + '.json';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('已导出');
        break;
      }
      case 'import':
        $('#importFile').click();
        break;
      case 'reset':
        if (confirm('将清空全部数据并恢复演示数据，确定继续？')) {
          S.reset(); closeSheet(); toast('已重置');
        }
        break;
      case 'close-sheet':
        closeSheet();
        break;
      case 'switch': // 表单内的通用开关
        var target = document.getElementById(el.dataset.target);
        if (target) {
          var on = target.value !== '1';
          target.value = on ? '1' : '0';
          el.classList.toggle('on', on);
        }
        break;
    }
  });

  document.addEventListener('change', function (e) {
    if (e.target.id === 'f-repeat') {
      var v = e.target.value;
      var wd = document.getElementById('wrap-days');
      var wt = document.getElementById('wrap-times');
      if (wd) wd.style.display = v === 'weekly' ? 'block' : 'none';
      if (wt) wt.style.display = v === 'times' ? 'block' : 'none';
    }
    if (e.target.id === 'importFile' && e.target.files[0]) {
      var f = e.target.files[0];
      var reader = new FileReader();
      reader.onload = function () {
        try { S.importJSON(reader.result); toast('导入成功'); closeSheet(); }
        catch (err) { toast('导入失败：' + (err && err.message ? err.message : '文件格式不正确')); }
      };
      reader.readAsText(f);
      e.target.value = '';
    }
  });

  document.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-act="save-item"]');
    if (!form) return;
    e.preventDefault();
    var title = $('#f-title').value.trim();
    if (!title) { toast('请填写名称'); return; }
    // 防重复提交：同一表单在已提交后忽略后续点击（避免快速双击创建重复项）
    if (e.target.dataset.locked) return;
    e.target.dataset.locked = '1';
    var days = [];
    var boxes = document.querySelectorAll('input[name=f-days]:checked');
    for (var i = 0; i < boxes.length; i++) days.push(+boxes[i].value);
    var colorEl = document.querySelector('input[name=f-color]:checked');
    var patch = {
      title: title,
      type: $('#f-type').value,
      priority: $('#f-priority').value,
      category: $('#f-category').value,
      note: $('#f-note').value.trim(),
      color: colorEl ? colorEl.value : PALETTE[0],
      startDate: $('#f-start').value || U.todayKey(),
      endDate: $('#f-end').value || '',
      repeat: { type: $('#f-repeat').value, days: days, times: Math.max(1, +$('#f-times').value || 1) },
      reminder: { enabled: $('#f-remind').value === '1', time: $('#f-time').value || '08:00' }
    };
    if (form.dataset.id) S.dispatch({ type: 'ITEM_UPDATE', id: form.dataset.id, patch: patch });
    else S.dispatch({ type: 'ITEM_CREATE', payload: patch });
    closeSheet();
    toast(form.dataset.id ? '已保存' : '已创建');
  });

  UI.sheetItem = sheetItem;
})(window.App);
