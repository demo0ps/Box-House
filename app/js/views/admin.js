/* ============================================================
   admin.js — back office: menu, zones, capacity, promos, theme.
   Also where the pitch config switches live.
   ============================================================ */
(function (global) {
  'use strict';

  function render(host) {
    var m = global.Data.menu;
    var s = Store.stats();
    var st = Store.settings();

    var h = '<div class="page">' +
      '<div class="pagehead"><div><h1>Back office</h1>' +
      '<div class="sub">' + UI.esc(Store.branch().name) + '</div></div>' +
      '<button class="btn btn--danger btn--sm" data-act="reset">Reset demo data</button></div>';

    /* --- numbers --- */
    h += '<div class="grid grid--4" style="margin-bottom:14px">' +
      stat('Live orders', s.live, 'in the kitchen or on the road') +
      stat('Orders today', s.today, 'this session') +
      stat('Revenue', UI.money(s.revenue_cents), 'completed orders') +
      stat('Avg order', UI.money(s.aov_cents), s.cod_count + ' on cash/EFT') +
    '</div>';

    /* --- the pitch switchboard --- */
    h += '<div class="card" style="margin-bottom:14px;border-color:var(--primary)">' +
      '<h3 style="font-size:15px">Demo switches</h3>' +
      '<div class="tiny muted" style="margin:4px 0 10px">Every unanswered question from the ' +
      'client is a switch here — not a rewrite.</div>';

    h += '<div class="kv" style="align-items:center"><span>Branch</span><span>' +
      '<select id="branchSel" style="padding:6px 9px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">' +
      m.branches.map(function (b) {
        return '<option value="' + b.code + '" ' + (st.branchCode === b.code ? 'selected' : '') + '>' +
          UI.esc(b.name) + '</option>';
      }).join('') + '</select></span></div>';

    h += '<div class="kv" style="align-items:center"><span>Theme</span><span>' +
      '<select id="themeSel" style="padding:6px 9px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">' +
      '<option value="brand">Brand — yellow &amp; black</option>' +
      '<option value="logo">Logo — colours from artwork</option>' +
      '</select></span></div>';

    h += '<div class="kv" style="align-items:center"><span>Kitchen capacity</span><span>' +
      '<input type="number" id="capMax" min="1" max="60" value="' + st.capacityMax + '" ' +
      'style="width:78px;padding:6px 9px;border-radius:8px;background:var(--bg);border:1px solid var(--border)"> ' +
      '<span class="tiny muted">orders / ' + st.capacitySlotMin + ' min</span></span></div>';

    h += '</div>';

    /* --- menu --- */
    h += '<div class="card" style="margin-bottom:14px">' +
      '<div class="row row--between"><h3 style="font-size:15px">Menu</h3>' +
      '<span class="tiny muted">' + m.items.length + ' items</span></div>' +
      '<div class="tiny muted" style="margin:4px 0 10px">Tap an item to mark it sold out — ' +
      'the customer menu updates instantly.</div>';

    m.categories.forEach(function (c) {
      var its = m.items.filter(function (i) { return i.category === c.id; });
      if (!its.length) return;
      h += '<div class="tiny" style="font-weight:800;letter-spacing:.05em;margin:12px 0 6px">' +
        UI.esc(c.name).toUpperCase() + '</div>';
      its.forEach(function (i) {
        var out = Store.isSoldOut(i.id);
        h += '<div class="opt" data-so="' + i.id + '" style="cursor:pointer">' +
          '<div><div class="opt__name">' + UI.esc(i.name) +
            (i.is_signature ? ' <span class="star">&#9733;</span>' : '') + '</div>' +
          '<div class="tiny muted">' + (i.prep_time_min || 10) + ' min prep</div></div>' +
          '<div class="row" style="gap:9px"><span>' + UI.money(i.base_price_cents) + '</span>' +
          '<span class="tag ' + (out ? 'tag--muted' : 'tag--ready') + '">' +
            (out ? 'Sold out' : 'Live') + '</span></div></div>';
      });
    });
    h += '</div>';

    /* --- events --- */
    h += global.EventsAdmin.card();

    /* --- zones --- */
    h += '<div class="card" style="margin-bottom:14px">' +
      '<h3 style="font-size:15px">Delivery zones</h3>' +
      '<div class="tiny muted" style="margin:4px 0 10px">Fee, minimum and ETA per area for ' +
      UI.esc(Store.branch().name) + '.</div>' +
      '<table style="width:100%;border-collapse:collapse;font-size:13px">';
    Store.zones().forEach(function (z) {
      h += '<tr style="border-bottom:1px solid var(--border)">' +
        '<td style="padding:8px 0"><strong>' + UI.esc(z.name) + '</strong></td>' +
        '<td style="text-align:right">' + UI.money(z.fee_cents) + '</td>' +
        '<td style="text-align:right">min ' + UI.money(z.min_order_cents) + '</td>' +
        '<td style="text-align:right">' + z.eta_minutes + ' min</td></tr>';
    });
    h += '</table></div>';

    /* --- promos --- */
    h += '<div class="card">' +
      '<h3 style="font-size:15px">Promo codes</h3>';
    st.promos.forEach(function (p) {
      h += '<div class="opt"><div><div class="opt__name">' + UI.esc(p.code) + '</div>' +
        '<div class="tiny muted">' + p.value + '% off · min ' + UI.money(p.min_order_cents) + '</div></div>' +
        '<span class="tag tag--ready">Active</span></div>';
    });
    h += '</div>';

    h += '</div>';
    host.innerHTML = h;
    global.EventsAdmin.bind(host);

    UI.delegate(host, '[data-so]', 'click', function (e, el) {
      Store.toggleSoldOut(el.getAttribute('data-so'));
    });
    UI.delegate(host, '[data-act="reset"]', 'click', function () {
      if (confirm('Clear all demo orders and reseed?')) { Store.reset(); UI.toast('Demo data reset'); }
    });

    var bs = host.querySelector('#branchSel');
    if (bs) bs.addEventListener('change', function () { Store.setBranch(bs.value); });

    var ts = host.querySelector('#themeSel');
    if (ts) {
      ts.value = (global.Data.theme && global.Data.theme.theme.mode) || 'brand';
      ts.addEventListener('change', function () {
        global.Data.setMode(ts.value);
        UI.toast('Theme: ' + ts.value);
      });
    }

    var cm = host.querySelector('#capMax');
    if (cm) cm.addEventListener('change', function () {
      Store.setSetting('capacityMax', Math.max(1, parseInt(cm.value, 10) || 6));
    });
  }

  function stat(label, value, sub) {
    return '<div class="stat"><div class="stat__l">' + label + '</div>' +
      '<div class="stat__v">' + value + '</div>' +
      '<div class="stat__s">' + sub + '</div></div>';
  }

  global.AdminView = { render: render };
})(window);
