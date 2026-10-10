/* ============================================================
   admin.js — back office. Tabs:
   Dashboard · CRM · Menu · Today's special · Events ·
   Delivery & promos · Hours & settings.
   Every change goes through Store, so the customer storefront,
   kitchen and cart read the same catalogue and prices.
   ============================================================ */
(function (global) {
  'use strict';

  var TABS = [
    { id: 'dash', label: 'Dashboard' },
    { id: 'crm', label: 'CRM' },
    { id: 'menu', label: 'Menu' },
    { id: 'special', label: "Today's special" },
    { id: 'events', label: 'Events' },
    { id: 'delivery', label: 'Delivery & promos' },
    { id: 'hours', label: 'Hours & settings' }
  ];
  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var TAGS = ['VIP', 'Repeat', 'New', 'Lapsed'];

  var state = { tab: 'dash', host: null, editItem: null, editCat: null, crmKey: null, crmQ: '', crmTag: '' };

  var $ = function (h, sel) { return h.querySelector(sel); };
  function esc(s) { return UI.esc(s); }
  function money(c) { return UI.money(c || 0); }
  function sastDate(ms) { return new Date(ms || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' }); }
  function phoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : d; }

  /* "R59.99", "59,99", "60" -> cents. NaN if unreadable. */
  function toCents(v) {
    var n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.,]/g, '').replace(',', '.'));
    return isNaN(n) ? NaN : Math.round(n * 100);
  }
  function rand(c) { return (c / 100).toFixed(2); }
  function fmtDate(ts) { return ts ? new Date(ts).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg' }) : '—'; }

  /* Attach a click handler to each matching element. Elements are fresh on every render,
     so listeners never stack up. */
  function on(host, sel, fn) {
    host.querySelectorAll(sel).forEach(function (el) {
      el.addEventListener('click', function (e) { fn(el, e); });
    });
  }

  function rerender() { if (state.host) render(state.host); }
  function ok(msg) { UI.toast(msg); rerender(); }
  function bad(msg) { UI.toast(msg); }

  function card(title, sub, body, extra) {
    return '<section class="card adm-card">' +
      '<div class="adm-card__head"><div><h3>' + title + '</h3>' +
      (sub ? '<div class="tiny muted">' + sub + '</div>' : '') + '</div>' + (extra || '') + '</div>' + body + '</section>';
  }
  function stat(label, value, sub) {
    return '<div class="stat"><div class="stat__l">' + label + '</div>' +
      '<div class="stat__v">' + value + '</div><div class="stat__s">' + sub + '</div></div>';
  }
  function bars(rows) {
    var max = Math.max.apply(null, [1].concat(rows.map(function (r) { return r.value; })));
    return '<div class="adm-bars">' + rows.map(function (r) {
      var pct = Math.round(r.value / max * 100);
      return '<div class="adm-bar"><div class="adm-bar__v">' + esc(r.money || r.value) + '</div>' +
        '<div class="adm-bar__track"><div class="adm-bar__fill" style="height:' + pct + '%"></div></div>' +
        '<div class="adm-bar__l">' + esc(r.label) + '</div></div>';
    }).join('') + '</div>';
  }
  function split(obj, labels) {
    var total = Object.keys(obj).reduce(function (s, k) { return s + (obj[k] || 0); }, 0) || 1;
    return Object.keys(labels).map(function (k) {
      var n = obj[k] || 0, pct = Math.round(n / total * 100);
      return '<div class="adm-split"><div class="row row--between tiny"><span>' + labels[k] + '</span>' +
        '<span>' + n + ' · ' + pct + '%</span></div>' +
        '<div class="adm-split__track"><div style="width:' + pct + '%"></div></div></div>';
    }).join('');
  }

  /* ---------------- shell ---------------- */
  function render(host) {
    state.host = host;
    var m = global.Data.menu;
    var br = Store.branch();
    var h = '<div class="page adm">' +
      '<div class="pagehead"><div><h1>Back office</h1>' +
      '<div class="sub">' + esc(br.name) + ' · ' + esc(sastDate()) + ' (SAST)</div></div>' +
      '<button class="btn btn--danger btn--sm" data-act="reset">Reset demo data</button></div>';

    h += '<nav class="adm-tabs" role="tablist">' + TABS.map(function (t) {
      return '<button role="tab" class="adm-tab' + (state.tab === t.id ? ' is-on' : '') + '" data-tab="' + t.id + '">' + esc(t.label) + '</button>';
    }).join('') + '</nav>';

    var body = { dash: dash, crm: crm, menu: menuTab, special: special, events: eventsTab,
                 delivery: delivery, hours: hours }[state.tab];
    h += '<div class="adm-body">' + body(m) + '</div></div>';
    host.innerHTML = h;

    on(host, '[data-tab]', function (el) { state.tab = el.getAttribute('data-tab'); state.editItem = null; state.editCat = null; rerender(); });
    on(host, '[data-act="reset"]', function () {
      if (confirm('Clear all demo orders, customers and catalogue edits, and reseed?')) { Store.reset(); ok('Demo data reset'); }
    });
    wire(host);
  }

  function wire(host) {
    var fn = { dash: wireDash, crm: wireCrm, menu: wireMenu, special: wireSpecial,
               events: wireEvents, delivery: wireDelivery, hours: wireHours }[state.tab];
    if (fn) fn(host);
  }

  /* ---------------- 1. dashboard ---------------- */
  function dash() {
    var a = Store.analytics(7);
    var waiting = Store.orders().filter(function (o) { return o.status === 'PAID'; }).length;
    var lapsed = Store.customers().filter(function (c) { return c.tags.indexOf('Lapsed') > -1; }).length;
    var sp = Store.todaysSpecial();
    var outs = Object.keys(Store.settings().soldOut).filter(function (k) { return Store.isSoldOut(k); });

    var alerts = [];
    if (waiting) alerts.push(['warn', waiting + ' order' + (waiting > 1 ? 's' : '') + ' waiting to be accepted in the kitchen']);
    if (outs.length) alerts.push(['warn', outs.length + ' item' + (outs.length > 1 ? 's are' : ' is') + ' sold out and hidden from ordering']);
    if (!sp) alerts.push(['info', "No today's special set. Add one in the Today's special tab."]);
    if (lapsed) alerts.push(['info', lapsed + ' customer' + (lapsed > 1 ? 's' : '') + ' not seen in 30+ days. Good candidates for a win-back offer.']);
    if (!Store.settings().promos.some(function (p) { return p.active !== false; })) alerts.push(['info', 'No promo code is active.']);
    if (!alerts.length) alerts.push(['ok', 'All clear. Nothing needs attention.']);

    var days = a.days.map(function (d) { return { label: d.label, value: d.revenue_cents, money: money(d.revenue_cents) }; });
    var top = a.top_dishes.length ? a.top_dishes.map(function (d, i) {
      return '<div class="adm-row"><span class="adm-rank">' + (i + 1) + '</span><span>' + esc(d.name) +
        '</span><span class="muted">' + d.qty + ' sold</span></div>';
    }).join('') : '<div class="tiny muted">No sales yet.</div>';

    var h = '<div class="grid grid--4 adm-kpis">' +
      stat("Today's revenue", money(a.today_revenue_cents), a.today_orders + ' orders today') +
      stat('7-day revenue', money(a.week_revenue_cents), 'completed, not cancelled') +
      stat('Avg order', money(a.aov_cents), 'incl. VAT and delivery') +
      stat('Repeat rate', a.repeat_rate + '%', a.repeat_customers + ' of ' + a.customers + ' customers') +
      '</div>';

    h += '<div class="grid adm-two">' +
      card('Sales, last 7 days', 'Revenue by day (SAST)', bars(days)) +
      card('Alerts', 'What needs you today', '<div class="adm-alerts">' + alerts.map(function (x) {
        return '<div class="adm-alert adm-alert--' + x[0] + '">' + esc(x[1]) + '</div>';
      }).join('') + '</div>') +
      '</div>';

    h += '<div class="grid adm-two">' +
      card('Top items', 'Units sold, last 7 days', top) +
      card('Channel &amp; payment', 'How orders come in and get paid',
        '<div class="tiny muted" style="margin-bottom:6px">Channel</div>' +
        split(a.fulfilment, { delivery: 'Delivery', pickup: 'Pickup' }) +
        '<div class="tiny muted" style="margin:14px 0 6px">Payment</div>' +
        split(a.payment, { card: 'Card', eft: 'Instant EFT', cod: 'Cash on delivery' })) +
      '</div>';
    h += '<div class="tiny muted adm-foot">Live now: ' + a.live + ' order' + (a.live === 1 ? '' : 's') +
      ' in progress. Figures are per device until the live backend is connected.</div>';
    return h;
  }
  function wireDash() {}

  /* ---------------- 2. CRM ---------------- */
  function crm() {
    var all = Store.customers();
    var list = all.filter(function (c) {
      if (state.crmTag && c.tags.indexOf(state.crmTag) < 0) return false;
      if (!state.crmQ) return true;
      var q = state.crmQ.toLowerCase();
      return c.name.toLowerCase().indexOf(q) > -1 || c.phone.replace(/\s/g, '').indexOf(q.replace(/\s/g, '')) > -1;
    });
    var sel = all.find(function (c) { return c.key === state.crmKey; });

    var head = '<div class="adm-toolbar">' +
      '<input id="crmQ" class="adm-input" type="search" placeholder="Search name or phone" value="' + esc(state.crmQ) + '">' +
      '<select id="crmTag" class="adm-input">' +
      '<option value="">All customers</option>' +
      TAGS.map(function (t) { return '<option' + (state.crmTag === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') +
      '</select>' +
      '<button class="btn btn--sm" data-act="csv">Export CSV</button></div>';

    var rows = list.length ? list.map(function (c) {
      return '<tr class="adm-tr' + (c.key === state.crmKey ? ' is-on' : '') + '" data-cust="' + c.key + '">' +
        '<td><strong>' + esc(c.name) + '</strong><div class="tiny muted">' + esc(c.phone) + '</div></td>' +
        '<td>' + c.tags.map(function (t) { return '<span class="adm-tag adm-tag--' + t.toLowerCase() + '">' + t + '</span>'; }).join(' ') + '</td>' +
        '<td class="num">' + c.orders + '</td>' +
        '<td class="num">' + money(c.spend_cents) + '</td>' +
        '<td class="num tiny hide-sm">' + fmtDate(c.last_at) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="tiny muted">No customers match.</td></tr>';

    var table = '<div class="adm-table-wrap"><table class="adm-table"><thead><tr>' +
      '<th>Customer</th><th>Tags</th><th class="num">Orders</th><th class="num">Spend</th><th class="num">Last order</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';

    var detail = '<div class="tiny muted">Select a customer to see orders and add a note.</div>';
    if (sel) {
      var orders = Store.orders().filter(function (o) { return phoneKey(o.customer && o.customer.phone) === sel.key; })
        .sort(function (a, b) { return b.created_at - a.created_at; }).slice(0, 5);
      detail = '<div class="adm-detail__name">' + esc(sel.name) + '</div>' +
        '<div class="tiny muted">' + esc(sel.phone) + ' · customer since ' + fmtDate(sel.first_at) + '</div>' +
        '<div class="grid grid--3 adm-mini">' +
        '<div><span class="tiny muted">Orders</span><strong>' + sel.orders + '</strong></div>' +
        '<div><span class="tiny muted">Avg order</span><strong>' + money(sel.aov_cents) + '</strong></div>' +
        '<div><span class="tiny muted">Favourite</span><strong>' + esc(sel.favourite || '—') + '</strong></div></div>' +
        '<div class="adm-subhead">Recent orders</div>' +
        (orders.length ? orders.map(function (o) {
          return '<div class="adm-row"><span>' + esc(o.code) + '</span><span class="muted">' + esc(o.fulfilment) +
            ' · ' + esc(o.payment_method.toUpperCase()) + '</span><span>' + money(o.total_cents) + '</span></div>';
        }).join('') : '<div class="tiny muted">None.</div>') +
        '<label class="adm-label" style="margin-top:12px">Staff note <span class="tiny muted">(internal only)</span></label>' +
        '<textarea id="crmNote" class="adm-input" rows="4" maxlength="500" placeholder="e.g. Allergic to sesame. Prefers pickup.">' + esc(sel.note) + '</textarea>' +
        '<div class="row" style="justify-content:flex-end;margin-top:8px"><button class="btn btn--primary btn--sm" data-act="note">Save note</button></div>' +
        '<div class="tiny muted" style="margin-top:10px">Tags: VIP (3+ orders or R1,000+ spent), Repeat (2+ orders), New (first order this week), Lapsed (no order in 30 days).</div>';
    }

    return '<div class="adm-crm">' +
      card('Customers', all.length + ' from orders · keyed by phone number', head + table) +
      card('Profile', '', '<div class="adm-detail">' + detail + '</div>') +
      '</div>';
  }
  function wireCrm(host) {
    var q = $(host, '#crmQ');
    if (q) q.addEventListener('input', function () { state.crmQ = q.value; rerender(); $(state.host, '#crmQ').focus(); });
    var t = $(host, '#crmTag');
    if (t) t.addEventListener('change', function () { state.crmTag = t.value; rerender(); });
    on(host, '[data-cust]', function (el) { state.crmKey = el.getAttribute('data-cust'); rerender(); });
    on(host, '[data-act="note"]', function () {
      var n = $(host, '#crmNote');
      if (state.crmKey && n) { Store.customerNote(state.crmKey, n.value); ok('Note saved'); }
    });
    on(host, '[data-act="csv"]', function () {
      var blob = new Blob(['\ufeff' + Store.customersCsv()], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'box-house-customers-' + sastDate() + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      UI.toast('CSV exported');
    });
  }

  /* ---------------- 3. menu ---------------- */
  function menuTab(m) {
    var cats = Store.categories();
    var items = Store.items();
    var h = '';

    /* item editor */
    var e = state.editItem;
    var isNew = e === 'new';
    var it = (e && !isNew) ? items.find(function (i) { return i.id === e; }) : null;
    if (e) {
      h += card(isNew ? 'Add item' : 'Edit item: ' + esc(it ? it.name : ''), 'Prices in rand, including VAT. Changes show on the storefront straight away.',
        '<div class="adm-form adm-form--item">' +
        field('Name', '<input id="fName" class="adm-input" maxlength="80" value="' + esc(it ? it.name : '') + '">') +
        field('Category', '<select id="fCat" class="adm-input">' + cats.map(function (c) {
          return '<option value="' + c.id + '"' + (it && it.category === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('') + '</select>') +
        field('Price (R)', '<input id="fPrice" class="adm-input" inputmode="decimal" value="' + (it ? rand(it.base_price_cents) : '') + '" placeholder="59.99">') +
        field('Prep time (min)', '<input id="fPrep" class="adm-input" type="number" min="1" max="120" value="' + (it ? it.prep_time_min || 10 : 10) + '">') +
        field('Description', '<textarea id="fDesc" class="adm-input" rows="2" maxlength="200">' + esc(it ? it.description : '') + '</textarea>', 'wide') +
        field('Options', '<div class="tiny muted">' + (it && it.groups && it.groups.length ? 'Uses option groups: ' + esc(it.groups.join(', ')) : 'No option groups. Customers add it as-is.') + '</div>') +
        field('', '<label class="adm-check"><input type="checkbox" id="fSig"' + (it && it.is_signature ? ' checked' : '') + '> Signature item (shown on the home page)</label>') +
        '<div class="adm-actions wide"><button class="btn btn--primary btn--sm" data-act="itemSave">' + (isNew ? 'Add item' : 'Save changes') + '</button>' +
        '<button class="btn btn--sm" data-act="itemCancel">Cancel</button></div>' +
        '</div>');
    } else {
      h += '<div class="adm-toolbar-row"><button class="btn btn--primary btn--sm" data-act="itemNew">+ Add item</button></div>';
    }

    /* categories */
    var catList = cats.map(function (c) {
      var n = items.filter(function (i) { return i.category === c.id; }).length;
      return '<div class="adm-row"><span><strong>' + esc(c.name) + '</strong> <span class="tiny muted">' + n + ' item' + (n === 1 ? '' : 's') + '</span></span>' +
        '<span class="adm-row__acts"><button class="btn btn--sm" data-cat-edit="' + c.id + '">Rename</button>' +
        '<button class="btn btn--sm" data-cat-del="' + c.id + '"' + (n ? ' disabled title="Move or delete its items first"' : '') + '>Delete</button></span></div>';
    }).join('');
    var catForm = '<div class="adm-form adm-form--inline">' +
      '<input id="cName" class="adm-input" maxlength="40" placeholder="New category name" value="' + esc(state.editCat && state.editCat !== 'new' ? (cats.find(function (c) { return c.id === state.editCat; }) || {}).name || '' : '') + '">' +
      '<button class="btn btn--sm" data-act="catSave">' + (state.editCat && state.editCat !== 'new' ? 'Save name' : 'Add category') + '</button></div>';
    h += card('Categories', 'Groups on the menu. A category with items cannot be deleted.', catList + catForm);

    /* items grouped by category */
    var body = cats.map(function (c) {
      var its = items.filter(function (i) { return i.category === c.id; });
      if (!its.length) return '';
      return '<div class="adm-subhead">' + esc(c.name) + '</div>' + its.map(function (i) {
        var out = Store.isSoldOut(i.id);
        return '<div class="adm-row adm-row--item"><div><strong>' + esc(i.name) + '</strong>' +
          (i.is_signature ? ' <span class="star">&#9733;</span>' : '') +
          '<div class="tiny muted">' + esc(i.description).slice(0, 90) + '</div></div>' +
          '<div class="adm-row__acts"><span class="num">' + money(i.base_price_cents) + '</span>' +
          '<button class="tag ' + (out ? 'tag--muted' : 'tag--ready') + '" data-so="' + i.id + '">' + (out ? 'Sold out' : 'Live') + '</button>' +
          '<button class="btn btn--sm" data-item-edit="' + i.id + '">Edit</button>' +
          '<button class="btn btn--sm" data-item-del="' + i.id + '">Delete</button></div></div>';
      }).join('');
    }).join('');
    h += card('Items', items.length + ' items · tap Live / Sold out to hide an item instantly', body || '<div class="tiny muted">No items yet.</div>');
    return h;
  }
  function field(label, html, cls) {
    return '<div class="adm-field' + (cls ? ' ' + cls : '') + '">' + (label ? '<label class="adm-label">' + label + '</label>' : '') + html + '</div>';
  }
  function wireMenu(host) {
    on(host, '[data-act="itemNew"]', function () { state.editItem = 'new'; rerender(); });
    on(host, '[data-act="itemCancel"]', function () { state.editItem = null; rerender(); });
    on(host, '[data-item-edit]', function (el) { state.editItem = el.getAttribute('data-item-edit'); rerender(); });
    on(host, '[data-item-del]', function (el) {
      var id = el.getAttribute('data-item-del');
      if (confirm('Delete this item? It will disappear from the menu.')) { Store.itemDelete(id); ok('Item deleted'); }
    });
    on(host, '[data-so]', function (el) { Store.toggleSoldOut(el.getAttribute('data-so')); rerender(); });
    on(host, '[data-act="itemSave"]', function () {
      var name = $(host, '#fName').value.trim();
      var price = toCents($(host, '#fPrice').value);
      if (!name) return bad('Give the item a name.');
      if (!(price >= 0) || isNaN(price)) return bad('Enter a price, e.g. 59.99.');
      var existing = state.editItem !== 'new' ? Store.items().find(function (i) { return i.id === state.editItem; }) : null;
      var saved = Store.itemSave({
        id: existing ? existing.id : null,
        name: name,
        category: $(host, '#fCat').value,
        base_price_cents: price,
        prep_time_min: $(host, '#fPrep').value,
        description: $(host, '#fDesc').value,
        is_signature: $(host, '#fSig').checked,
        groups: existing ? existing.groups : [],
        image: existing ? existing.image : null
      });
      if (!saved) return bad('Could not save. Check the category and price.');
      state.editItem = null;
      ok('Saved ' + saved.name);
    });
    on(host, '[data-cat-edit]', function (el) { state.editCat = el.getAttribute('data-cat-edit'); rerender(); });
    on(host, '[data-cat-del]', function (el) {
      if (!Store.categoryDelete(el.getAttribute('data-cat-del'))) return bad('Move or delete its items first.');
      state.editCat = null; ok('Category deleted');
    });
    on(host, '[data-act="catSave"]', function () {
      var name = $(host, '#cName').value.trim();
      if (!name) return bad('Enter a category name.');
      var c = state.editCat && state.editCat !== 'new' ? { id: state.editCat, name: name } : { name: name };
      if (!Store.categorySave(c)) return bad('Enter a category name.');
      state.editCat = null; ok('Category saved');
    });
  }

  /* ---------------- 4. today's special ---------------- */
  function special(m) {
    var cur = Store.todaysSpecial();
    var items = Store.items();
    var h = '';
    h += card("Today's special", 'One dish, for today only (SAST). Shown on the home page and charged at the special price in the cart.',
      cur ? '<div class="adm-special-now"><div class="tag tag--ready">Live today</div>' +
        '<div class="adm-special-now__name">' + esc(cur.item.name) + '</div>' +
        '<div class="adm-special-now__price"><strong>' + money(cur.price_cents) + '</strong>' +
        (cur.price_cents !== cur.item.base_price_cents ? ' <span class="muted"><s>' + money(cur.item.base_price_cents) + '</s></span>' : '') + '</div>' +
        (cur.note ? '<div class="tiny muted">' + esc(cur.note) + '</div>' : '') +
        '<button class="btn btn--sm" data-act="specialClear" style="margin-top:10px">Take off today</button></div>'
        : '<div class="tiny muted">No special set for today.</div>');

    var s = {};
    var opts = items.map(function (i) {
      return '<option value="' + i.id + '"' + (s.item_id === i.id || (!s.item_id && cur && cur.item.id === i.id) ? ' selected' : '') + '>' +
        esc(i.name) + ' (' + money(i.base_price_cents) + ')</option>';
    }).join('');
    h += card('Set today’s special', '',
      '<div class="adm-form">' +
      field('Dish', '<select id="spItem" class="adm-input">' + opts + '</select>') +
      field('Special price (R)', '<input id="spPrice" class="adm-input" inputmode="decimal" placeholder="blank = normal price" value="' + (cur && cur.price_cents != null && cur.price_cents !== cur.item.base_price_cents ? rand(cur.price_cents) : '') + '">') +
      field('Branch', '<select id="spBranch" class="adm-input"><option value="ALL">Both branches</option>' +
        m.branches.map(function (b) { return '<option value="' + b.code + '"' + (cur && cur.branch === b.code ? ' selected' : '') + '>' + esc(b.short) + ' only</option>'; }).join('') + '</select>') +
      field('Note for customers', '<input id="spNote" class="adm-input" maxlength="120" placeholder="e.g. Limited batch, while stocks last" value="' + esc(cur ? cur.note : '') + '">') +
      '<div class="adm-actions wide"><button class="btn btn--primary btn--sm" data-act="specialSave">Set as today’s special</button></div>' +
      '</div>');
    h += '<div class="tiny muted adm-foot">The special price is applied to the cart and checkout, so the total always matches the price on the site. It resets automatically at midnight SAST.</div>';
    return h;
  }
  function wireSpecial(host) {
    on(host, '[data-act="specialClear"]', function () { Store.clearSpecial(); ok('Special taken off'); });
    on(host, '[data-act="specialSave"]', function () {
      var id = $(host, '#spItem').value;
      var raw = $(host, '#spPrice').value.trim();
      var price = raw === '' ? null : toCents(raw);
      if (price !== null && (isNaN(price) || price < 0)) return bad('Price looks wrong.');
      Store.setSpecial({ item_id: id, price_cents: price, note: $(host, '#spNote').value, branch: $(host, '#spBranch').value });
      ok('Today’s special set');
    });
  }

  /* ---------------- 5. events ---------------- */
  function eventsTab() {
    return global.EventsAdmin.card();
  }
  function wireEvents(host) { global.EventsAdmin.bind(host); }

  /* ---------------- 6. delivery & promos ---------------- */
  function delivery(m) {
    var br = Store.branch();
    var zones = Store.zones();
    var zRows = zones.length ? zones.map(function (z) {
      return '<div class="adm-row"><div><strong>' + esc(z.name) + '</strong><div class="tiny muted">' + z.eta_minutes + ' min ETA</div></div>' +
        '<span class="adm-row__acts"><span>' + money(z.fee_cents) + '</span><span class="tiny muted">min ' + money(z.min_order_cents) + '</span>' +
        '<button class="btn btn--sm" data-zone-del="' + esc(z.name) + '" data-zone-br="' + z.branch + '">Remove</button></span></div>';
    }).join('') : '<div class="tiny muted">No zones for this branch.</div>';
    var zForm = '<div class="adm-form adm-form--zone">' +
      '<input id="zName" class="adm-input" maxlength="60" placeholder="Area name">' +
      '<input id="zFee" class="adm-input" inputmode="decimal" placeholder="Fee R">' +
      '<input id="zMin" class="adm-input" inputmode="decimal" placeholder="Min order R">' +
      '<input id="zEta" class="adm-input" type="number" min="5" max="180" placeholder="ETA min">' +
      '<button class="btn btn--primary btn--sm" data-act="zoneSave">Add / update zone</button></div>';

    var pRows = Store.settings().promos.map(function (p) {
      var on = p.active !== false;
      return '<div class="adm-row"><div><strong>' + esc(p.code) + '</strong><div class="tiny muted">' + p.value + '% off · min ' + money(p.min_order_cents) + '</div></div>' +
        '<span class="adm-row__acts"><button class="tag ' + (on ? 'tag--ready' : 'tag--muted') + '" data-promo-toggle="' + esc(p.code) + '">' + (on ? 'Active' : 'Off') + '</button>' +
        '<button class="btn btn--sm" data-promo-del="' + esc(p.code) + '">Delete</button></span></div>';
    }).join('') || '<div class="tiny muted">No promo codes yet.</div>';
    var pForm = '<div class="adm-form adm-form--zone">' +
      '<input id="pCode" class="adm-input" maxlength="20" placeholder="CODE">' +
      '<input id="pVal" class="adm-input" type="number" min="1" max="100" placeholder="% off">' +
      '<input id="pMin" class="adm-input" inputmode="decimal" placeholder="Min order R">' +
      '<button class="btn btn--primary btn--sm" data-act="promoSave">Add / update code</button></div>';

    return '<div class="grid adm-two">' +
      card('Delivery zones', 'For ' + esc(br.short) + '. Fee, minimum order and ETA per area.', zRows + zForm) +
      card('Promo codes', 'Percent-off codes. Turn off without deleting.', pRows + pForm) +
      '</div>';
  }
  function wireDelivery(host) {
    on(host, '[data-act="zoneSave"]', function () {
      var z = Store.zoneSave({ branch: Store.settings().branchCode, name: $(host, '#zName').value,
        fee_cents: toCents($(host, '#zFee').value) || 0, min_order_cents: toCents($(host, '#zMin').value) || 0,
        eta_minutes: $(host, '#zEta').value });
      if (!z) return bad('Enter an area name.');
      ok('Zone saved');
    });
    on(host, '[data-zone-del]', function (el) {
      if (confirm('Remove this delivery area?')) { Store.zoneDelete(el.getAttribute('data-zone-br'), el.getAttribute('data-zone-del')); ok('Zone removed'); }
    });
    on(host, '[data-act="promoSave"]', function () {
      var p = Store.promoSave({ code: $(host, '#pCode').value, value: $(host, '#pVal').value,
        min_order_cents: toCents($(host, '#pMin').value) || 0 });
      if (!p) return bad('Enter a code and a percentage from 1 to 100.');
      ok('Promo ' + p.code + ' saved');
    });
    on(host, '[data-promo-toggle]', function (el) { Store.promoToggle(el.getAttribute('data-promo-toggle')); rerender(); });
    on(host, '[data-promo-del]', function (el) {
      if (confirm('Delete this code?')) { Store.promoDelete(el.getAttribute('data-promo-del')); ok('Code deleted'); }
    });
  }

  /* ---------------- 7. hours & settings ---------------- */
  function hours(m) {
    var st = Store.settings();
    var rows = DAYS.map(function (d) {
      var r = (m.hours || []).find(function (x) { return x.day === d; }) || { open: '', close: '' };
      return '<div class="adm-hours-row"><span>' + d + '</span>' +
        '<input type="time" data-day="' + d + '" data-k="open" class="adm-input" value="' + r.open + '">' +
        '<input type="time" data-day="' + d + '" data-k="close" class="adm-input" value="' + r.close + '"></div>';
    }).join('');
    var hoursCard = card('Trading hours', 'Shown on the storefront and used to decide if the shop is open. Confirm with the client before go-live.',
      '<div class="adm-hours">' + rows + '</div>' +
      '<div class="adm-actions"><button class="btn btn--primary btn--sm" data-act="hoursSave">Save hours</button></div>' +
      (m.hours_assumed ? '<div class="tiny muted" style="margin-top:8px">These hours are placeholders, not supplied by the client.</div>' : ''));

    var settings = card('Store settings', '',
      '<div class="adm-kv"><span>Branch shown by default</span><select id="sBranch" class="adm-input">' +
        m.branches.map(function (b) { return '<option value="' + b.code + '"' + (st.branchCode === b.code ? ' selected' : '') + '>' + esc(b.name) + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="adm-kv"><span>Kitchen capacity</span><span><input id="sCap" type="number" min="1" max="60" class="adm-input adm-input--sm" value="' + st.capacityMax + '"> <span class="tiny muted">orders per ' + st.capacitySlotMin + ' min</span></span></div>' +
      '<div class="adm-kv"><span>Auto-accept orders</span><label class="adm-check"><input type="checkbox" id="sAuto"' + (st.autoAccept ? ' checked' : '') + '> Accept without kitchen tap</label></div>' +
      '<div class="adm-kv"><span>Theme</span><select id="sTheme" class="adm-input">' +
        '<option value="brand">Brand: yellow &amp; black</option><option value="logo">Logo: colours from artwork</option></select></div>' +
      '<div class="adm-actions"><button class="btn btn--primary btn--sm" data-act="settingsSave">Save settings</button></div>');
    return '<div class="grid adm-two">' + hoursCard + settings + '</div>';
  }
  function wireHours(host) {
    var th = $(host, '#sTheme');
    if (th) th.value = (global.Data.theme && global.Data.theme.theme.mode) || 'brand';
    on(host, '[data-act="hoursSave"]', function () {
      var rows = DAYS.map(function (d) {
        var o = host.querySelector('[data-day="' + d + '"][data-k="open"]').value;
        var c = host.querySelector('[data-day="' + d + '"][data-k="close"]').value;
        return { day: d, open: o, close: c };
      });
      if (!Store.setHours(rows)) return bad('Use times like 11:00 and 22:00.');
      ok('Hours saved');
    });
    on(host, '[data-act="settingsSave"]', function () {
      Store.setSetting('branchCode', $(host, '#sBranch').value);
      Store.setSetting('capacityMax', Math.max(1, parseInt($(host, '#sCap').value, 10) || 6));
      Store.setSetting('autoAccept', $(host, '#sAuto').checked);
      global.Data.setMode($(host, '#sTheme').value);
      ok('Settings saved');
    });
  }

  global.AdminView = { render: render };
})(window);
