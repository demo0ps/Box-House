/* ============================================================
   kitchen.js — the console the kitchen works orders from.
   ============================================================ */
(function (global) {
  'use strict';

  var COLS = [
    { key: 'incoming', title: 'New',   statuses: ['PAID'] },
    { key: 'accepted', title: 'Accepted', statuses: ['ACCEPTED'] },
    { key: 'prepping', title: 'Preparing', statuses: ['PREPARING'] },
    { key: 'ready',    title: 'Ready', statuses: ['READY', 'COLLECTED'] }
  ];

  function card(o, showActions, host) {
    var st = Store.STATUS[o.status];
    var mins = Math.max(0, Math.round((Date.now() - o.created_at) / 60000));
    var late = mins > 15 && ['READY', 'COLLECTED'].indexOf(o.status) === -1;

    var h = '<div class="ocard" data-order="' + o.id + '">' +
      '<div class="ocard__top">' +
        '<div class="ocard__code">' + o.code + '</div>' +
        '<div class="row" style="gap:6px">' +
          (o.fulfilment === 'pickup' ? '<span class="tag tag--muted">Pickup</span>' : '') +
          '<span class="tag ' + st.tag + '">' + st.label + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="tiny muted">' + UI.clock(o.created_at) + ' · ' + mins + ' min ago' +
        (late ? ' · <span style="color:var(--warn)">running late</span>' : '') + '</div>';

    o.items.forEach(function (l) {
      h += '<div class="ocard__item" style="margin-top:7px">' + l.qty + '× <strong>' + UI.esc(l.name) + '</strong></div>';
      if (l.options && l.options.length) {
        h += '<div class="ocard__opt">' + l.options.map(function (x) { return UI.esc(x.option); }).join(' · ') + '</div>';
      }
      if (l.notes) h += '<div class="ocard__notes">' + UI.esc(l.notes) + '</div>';
    });

    h += '<div class="ocard__meta">' +
      '<div>' + UI.esc(o.customer.name) + ' · ' + UI.esc(o.customer.phone) + '</div>' +
      (o.fulfilment === 'delivery' && o.address
        ? '<div>' + UI.esc(o.address.line1) + ', ' + UI.esc(o.address.suburb) + '</div>' : '') +
      '<div style="margin-top:4px"><strong>' + UI.money(o.total_cents) + '</strong> · ' +
        (o.payment_method === 'cod' ? '<span style="color:var(--warn)">cash on delivery</span>' : 'paid online') + '</div>' +
    '</div>';

    if (showActions) {
      var next = (Store.ALLOWED[o.status] || []).filter(function (s) { return s !== 'CANCELLED'; });
      if (next.length) {
        h += '<div class="ocard__acts">';
        next.forEach(function (s) {
          var label = { ACCEPTED: 'Accept', PREPARING: 'Start prep', READY: 'Ready',
                        COLLECTED: 'Handed over', ASSIGNED: 'Assign driver' }[s] || s;
          var cls = (s === 'READY' || s === 'COLLECTED') ? 'btn--success' : 'btn--primary';
          h += '<button class="btn btn--sm ' + cls + '" data-move="' + s + '" data-id="' + o.id + '">' + label + '</button>';
        });
        h += '</div>';
      }
    }
    h += '</div>';
    return h;
  }

  function render(host) {
    var cap = Store.capacity();
    var active = Store.active();

    var h = '<div class="page">';

    /* header + capacity meter */
    h += '<div class="pagehead">' +
      '<div><h1>Kitchen</h1><div class="sub">' + UI.esc(Store.branch().name) + ' · ' +
        active.length + ' live order' + (active.length === 1 ? '' : 's') + '</div></div>' +
      '<div class="row">' +
        '<button class="btn" data-act="sim">Simulate order</button>' +
        '<button class="btn" data-act="soldout">Sold out</button>' +
      '</div></div>';

    h += '<div class="card" style="margin-bottom:14px">' +
      '<div class="row row--between" style="margin-bottom:7px">' +
        '<div class="tiny muted" style="font-weight:800;letter-spacing:.05em">KITCHEN LOAD · NEXT ' +
          Store.settings().capacitySlotMin + ' MIN</div>' +
        '<div class="tiny" style="font-weight:800">' + cap.used + ' / ' + cap.max + '</div>' +
      '</div>' +
      '<div class="meter ' + (cap.full ? 'meter--full' : (cap.pct > 65 ? 'meter--warn' : '')) + '">' +
        '<i style="width:' + cap.pct + '%"></i></div>' +
      (cap.full ? '<div class="tiny mt" style="color:var(--danger)">At capacity — new orders will be held back.</div>' : '') +
    '</div>';

    /* board */
    h += '<div class="ocols">';
    COLS.forEach(function (c) {
      var list = Store.byStatus(c.statuses);
      h += '<div class="ocol">' +
        '<div class="ocol__h"><h3>' + c.title + '</h3><span class="ocol__n">' + list.length + '</span></div>' +
        '<div class="ocol__b" data-col="' + c.key + '">';
      h += list.length ? list.map(function (o) { return card(o, true, host); }).join('')
                       : '<div class="tiny muted" style="text-align:center;padding:16px 0">Nothing here</div>';
      h += '</div></div>';
    });
    h += '</div></div>';

    host.innerHTML = h;

    UI.delegate(host, '[data-act="sim"]', 'click', function () {
      var o = Store.simulate();
      if (o) { UI.toast('Incoming order ' + o.code); UI.beep(2); }
    });

    UI.delegate(host, '[data-act="soldout"]', 'click', function () { openSoldOut(host); });

    UI.delegate(host, '[data-move]', 'click', function (e, el) {
      var id = el.getAttribute('data-id'), to = el.getAttribute('data-move');
      if (to === 'ASSIGNED') { UI.toast('Assign from the Dispatch board'); return; }
      if (Store.setStatus(id, to, 'kitchen')) {
        UI.toast(Store.STATUS[to].label);
      }
    });
  }

  function openSoldOut(host) {
    var m = global.Data.menu;
    var h = '<div class="tiny muted" style="margin-bottom:10px">Tap to mark an item sold out. ' +
            'It disappears from the customer menu immediately.</div>';
    m.categories.forEach(function (c) {
      var its = m.items.filter(function (i) { return i.category === c.id; });
      if (!its.length) return;
      h += '<div class="tiny" style="font-weight:800;letter-spacing:.05em;margin:14px 0 7px">' +
           UI.esc(c.name).toUpperCase() + '</div>';
      its.forEach(function (i) {
        var out = Store.isSoldOut(i.id);
        h += '<div class="opt ' + (out ? 'is-on' : '') + '" data-so="' + i.id + '">' +
          '<div class="opt__name">' + UI.esc(i.name) + '</div>' +
          '<div class="opt__delta">' + (out ? 'SOLD OUT' : 'available') + '</div></div>';
      });
    });
    UI.open({
      title: 'Sold out',
      sub: 'Shown on the customer menu in real time',
      body: h,
      onMount: function (mod) {
        UI.delegate(mod, '[data-so]', 'click', function (e, el) {
          Store.toggleSoldOut(el.getAttribute('data-so'));
          openSoldOut(host);
        });
      }
    });
  }

  global.KitchenView = {
    render: render,
    /* called by app.js when a brand-new order lands */
    onNewOrder: function (id) {
      var el = document.querySelector('[data-order="' + id + '"]');
      UI.flash(el);
    }
  };
})(window);
