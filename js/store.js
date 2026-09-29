/* =============================================================
 * store.js —— 单一数据源 + 单向数据流（类 Redux）
 *   state ──dispatch(action)──> reducer ──> newState ──> persist & notify
 * 全局命名空间 window.App.store
 * ============================================================= */
window.App = window.App || {};
(function (App) {
  'use strict';
  var U = App.utils;
  var KEY = 'habitcheck.v1';
  var VERSION = 1;

  var S = (App.store = {});
  var listeners = [];
  var state = null;
  var saveTimer = null;

  /* ---------------- 默认值 / 演示数据 ---------------- */

  function defaultCategories() {
    return [
      { id: 'health', name: '健康', color: '#22c55e' },
      { id: 'study', name: '学习', color: '#4f46e5' },
      { id: 'work', name: '工作', color: '#f59e0b' },
      { id: 'life', name: '生活', color: '#06b6d4' },
      { id: 'other', name: '其他', color: '#94a3b8' }
    ];
  }
  function defaultSettings() {
    return {
      weekStart: 1,                 // 1 = 周一为一周起点
      theme: 'light',               // light | dark | auto
      notify: { enabled: false },   // 系统通知开关
      dnd: { enabled: true, start: '22:30', end: '07:00' }, // 免打扰时段
      minDate: U.addDays(U.todayKey(), -60)
    };
  }
  function defaultItem(patch) {
    var today = U.todayKey();
    var base = {
      id: U.uid('it'),
      title: '',
      type: 'habit',                       // habit | task
      category: 'other',
      priority: 'medium',                  // high | medium | low
      note: '',
      color: '#4f46e5',
      repeat: { type: 'daily', days: [1, 2, 3, 4, 5], times: 3 },
      startDate: today,
      endDate: '',
      reminder: { enabled: false, time: '08:00' },
      archived: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    for (var k in (patch || {})) base[k] = patch[k];
    return base;
  }

  /** 首次启动的演示数据（含 45 天历史，便于直接查看统计效果） */
  function seed() {
    var today = U.todayKey();
    var start = U.addDays(today, -45);
    var items = [
      defaultItem({ id: 'it_demo_read', title: '晨间阅读 30 分钟', type: 'habit', category: 'study', priority: 'high', color: '#4f46e5', repeat: { type: 'daily', days: [], times: 3 }, startDate: start, note: '每天早起后先读 30 分钟', reminder: { enabled: true, time: '07:30' } }),
      defaultItem({ id: 'it_demo_water', title: '喝水 2L', type: 'habit', category: 'health', priority: 'medium', color: '#22c55e', repeat: { type: 'daily', days: [], times: 3 }, startDate: start }),
      defaultItem({ id: 'it_demo_gym', title: '力量训练', type: 'habit', category: 'health', priority: 'high', color: '#ef4444', repeat: { type: 'weekly', days: [1, 3, 5], times: 3 }, startDate: start, note: '推 / 拉 / 腿 循环', reminder: { enabled: true, time: '19:00' } }),
      defaultItem({ id: 'it_demo_review', title: '当日工作复盘', type: 'habit', category: 'work', priority: 'medium', color: '#f59e0b', repeat: { type: 'weekly', days: [1, 2, 3, 4, 5], times: 5 }, startDate: start, reminder: { enabled: true, time: '21:30' } }),
      defaultItem({ id: 'it_demo_meditate', title: '冥想 10 分钟', type: 'habit', category: 'life', priority: 'low', color: '#06b6d4', repeat: { type: 'daily', days: [], times: 3 }, startDate: start }),
      defaultItem({ id: 'it_demo_once', title: '预约年度体检', type: 'task', category: 'health', priority: 'high', color: '#8b5cf6', repeat: { type: 'once', days: [], times: 1 }, startDate: U.addDays(today, -2) })
    ];
    var checkins = [];
    var s = 20260929; // 固定种子，保证演示数据稳定
    function rnd() { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.id === 'it_demo_once') continue;
      var key = it.startDate;
      var guard = 0;
      while (key <= today && guard++ < 200) {
        var scheduled = App.logic.isScheduled(it, key);
        if (scheduled) {
          var r = rnd();
          if (r > 0.28) {
            checkins.push({ id: U.uid('ck'), itemId: it.id, date: key, status: 'done', makeup: false, ts: Date.parse(key) });
          } else if (r > 0.18) {
            checkins.push({ id: U.uid('ck'), itemId: it.id, date: key, status: 'skipped', makeup: false, ts: Date.parse(key) });
          }
        }
        key = U.addDays(key, 1);
      }
    }
    // 保证"今天"有几项待办，体现未完成态
    checkins = checkins.filter(function (c) {
      return !(c.date === today && (c.itemId === 'it_demo_read' || c.itemId === 'it_demo_meditate'));
    });
    return { version: VERSION, items: items, checkins: checkins, categories: defaultCategories(), settings: defaultSettings() };
  }

  /* ---------------- 持久化 ---------------- */

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: VERSION,
        items: state.items,
        checkins: state.checkins,
        categories: state.categories,
        settings: state.settings
      }));
    } catch (e) {
      console.warn('[store] 持久化失败', e);
    }
  }
  function schedulePersist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 150);
  }

  /* ---------------- 字段清洗（防御异常输入 / 空值 / 缺字段） ----------------
   * 任何进入 state 的 item / checkin 都先经过这里，保证下游逻辑不会因脏数据崩溃。 */

  function sanitizeRepeat(r) {
    r = r && typeof r === 'object' ? r : {};
    var type = (r.type === 'weekly' || r.type === 'times' || r.type === 'once') ? r.type : 'daily';
    var days = Array.isArray(r.days) ? r.days.filter(function (d) { return d >= 0 && d <= 6; }) : [];
    var times = Math.max(1, Math.min(7, parseInt(r.times, 10) || 3));
    return { type: type, days: days, times: times };
  }
  function sanitizeReminder(rem) {
    rem = rem && typeof rem === 'object' ? rem : {};
    return { enabled: !!rem.enabled, time: U.isValidTime(rem.time) ? rem.time : '08:00' };
  }
  function sanitizeItem(it) {
    if (!it || typeof it !== 'object') return null;
    return {
      id: typeof it.id === 'string' && it.id ? it.id : U.uid('it'),
      title: typeof it.title === 'string' ? it.title : '',
      type: it.type === 'task' ? 'task' : 'habit',
      category: typeof it.category === 'string' && it.category ? it.category : 'other',
      priority: (it.priority === 'high' || it.priority === 'low') ? it.priority : 'medium',
      note: typeof it.note === 'string' ? it.note : '',
      color: typeof it.color === 'string' ? it.color : '#4f46e5',
      repeat: sanitizeRepeat(it.repeat),
      startDate: U.isValidKey(it.startDate) ? it.startDate : U.todayKey(),
      endDate: U.isValidKey(it.endDate) ? it.endDate : '',
      reminder: sanitizeReminder(it.reminder),
      archived: !!it.archived,
      createdAt: typeof it.createdAt === 'number' ? it.createdAt : Date.now(),
      updatedAt: typeof it.updatedAt === 'number' ? it.updatedAt : Date.now()
    };
  }
  function sanitizeCheckin(c, validIds) {
    if (!c || typeof c !== 'object') return null;
    if (typeof c.itemId !== 'string' || !c.itemId) return null;     // 缺 itemId
    if (validIds && !validIds[c.itemId]) return null;                // 孤儿记录（引用了不存在的清单项）
    if (!U.isValidKey(c.date)) return null;                          // 非法日期
    var status = c.status === 'skipped' ? 'skipped' : (c.status === 'done' ? 'done' : null);
    if (!status) return null;                                        // 非法状态
    return {
      id: typeof c.id === 'string' && c.id ? c.id : U.uid('ck'),
      itemId: c.itemId,
      date: c.date,
      status: status,
      makeup: !!c.makeup,
      ts: typeof c.ts === 'number' ? c.ts : (Date.parse(c.date) || Date.now())
    };
  }

  function migrate(data) {
    data = data || {};
    // 清单项：逐个清洗 + 去重
    var rawItems = Array.isArray(data.items) ? data.items : [];
    var items = [], idSet = {};
    for (var i = 0; i < rawItems.length; i++) {
      var s = sanitizeItem(rawItems[i]);
      if (!s || idSet[s.id]) continue;
      idSet[s.id] = true;
      items.push(s);
    }
    // 分类：保证存在且含 'other'
    var rawCats = Array.isArray(data.categories) && data.categories.length ? data.categories : defaultCategories();
    var catIds = {};
    rawCats.forEach(function (c) { if (c && c.id) catIds[c.id] = true; });
    if (!catIds['other']) rawCats = rawCats.concat([{ id: 'other', name: '其他', color: '#94a3b8' }]);
    var categories = rawCats.map(function (c) {
      return {
        id: typeof c.id === 'string' && c.id ? c.id : U.uid('cat'),
        name: typeof c.name === 'string' && c.name ? c.name : '未命名',
        color: typeof c.color === 'string' ? c.color : '#94a3b8'
      };
    });
    // 打卡记录：仅保留引用有效 item 且字段合法的
    var rawCk = Array.isArray(data.checkins) ? data.checkins : [];
    var checkins = [];
    for (var j = 0; j < rawCk.length; j++) {
      var ck = sanitizeCheckin(rawCk[j], idSet);
      if (ck) checkins.push(ck);
    }
    // 设置：保留既有合并逻辑并兜底嵌套对象
    var settings = Object.assign(defaultSettings(), data.settings || {});
    settings.dnd = Object.assign(defaultSettings().dnd, settings.dnd || {});
    settings.notify = Object.assign({ enabled: false }, settings.notify || {});
    return { version: VERSION, items: items, checkins: checkins, categories: categories, settings: settings };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return seed();
      return migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('[store] 读取失败，回退演示数据', e);
      return seed();
    }
  }

  /* ---------------- reducer ---------------- */

  /** 每次变更后重算派生字段（minDate 等） */
  function touch(next) {
    var min = U.todayKey();
    for (var i = 0; i < next.items.length; i++) {
      if (next.items[i].startDate < min) min = next.items[i].startDate;
    }
    next.settings.minDate = U.addDays(min, -1);
    return next;
  }

  function reduce(prev, action) {
    var items, checkins, i;
    switch (action.type) {
      case 'ITEM_CREATE':
        items = prev.items.concat([sanitizeItem(action.payload) || defaultItem()]);
        return touch(Object.assign({}, prev, { items: items }));

      case 'ITEM_UPDATE':
        items = prev.items.map(function (it) {
          return it.id === action.id ? Object.assign({}, it, action.patch, { updatedAt: Date.now() }) : it;
        });
        return touch(Object.assign({}, prev, { items: items }));

      case 'ITEM_DELETE':
        items = prev.items.filter(function (it) { return it.id !== action.id; });
        checkins = prev.checkins.filter(function (c) { return c.itemId !== action.id; });
        return touch(Object.assign({}, prev, { items: items, checkins: checkins }));

      case 'ITEM_ARCHIVE':
        items = prev.items.map(function (it) {
          return it.id === action.id ? Object.assign({}, it, { archived: !!action.value, updatedAt: Date.now() }) : it;
        });
        return Object.assign({}, prev, { items: items });

      case 'CHECKIN_SET':
        checkins = App.logic.withStatus(prev.checkins, action.itemId, action.date, action.status);
        return Object.assign({}, prev, { checkins: checkins });

      case 'CATEGORY_CREATE':
        return Object.assign({}, prev, { categories: prev.categories.concat([action.payload]) });
      case 'CATEGORY_UPDATE':
        return Object.assign({}, prev, {
          categories: prev.categories.map(function (c) {
            return c.id === action.id ? Object.assign({}, c, action.patch) : c;
          })
        });
      case 'CATEGORY_DELETE':
        items = prev.items.map(function (it) {
          return it.category === action.id ? Object.assign({}, it, { category: 'other' }) : it;
        });
        return Object.assign({}, prev, {
          items: items,
          categories: prev.categories.filter(function (c) { return c.id !== action.id; })
        });

      case 'SETTINGS_UPDATE':
        return touch(Object.assign({}, prev, { settings: Object.assign({}, prev.settings, action.patch) }));

      case 'DATA_IMPORT':
        return touch(migrate(action.payload));

      case 'DATA_RESET':
        return touch(seed());

      default:
        return prev;
    }
  }

  /* ---------------- 对外 API ---------------- */

  S.init = function () {
    state = touch(load());
    schedulePersist();
    return state;
  };
  S.getState = function () { return state; };
  S.subscribe = function (fn) {
    listeners.push(fn);
    return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
  };
  S.dispatch = function (action) {
    var next = reduce(state, action);
    if (next !== state) {
      state = next;
      schedulePersist();
      for (var i = 0; i < listeners.length; i++) listeners[i](state, action);
    }
    return state;
  };
  S.flush = function () { clearTimeout(saveTimer); persist(); };

  S.newItem = function (patch) { return defaultItem(patch); };
  S.exportJSON = function () {
    return JSON.stringify({
      app: 'HabitCheck', version: VERSION, exportedAt: new Date().toISOString(),
      items: state.items, checkins: state.checkins, categories: state.categories, settings: state.settings
    }, null, 2);
  };
  S.importJSON = function (text) {
    var data;
    try { data = JSON.parse(text); }
    catch (e) { throw new Error('JSON 解析失败：' + (e && e.message ? e.message : e)); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('文件格式不正确：顶层应为对象');
    }
    if (!Array.isArray(data.items) && !Array.isArray(data.checkins) && !Array.isArray(data.categories)) {
      throw new Error('文件格式不正确：缺少 items / checkins / categories 数组');
    }
    S.dispatch({ type: 'DATA_IMPORT', payload: data });
  };
  S.reset = function () { S.dispatch({ type: 'DATA_RESET' }); };
})(window.App);
