/* ============================================================
   driver.js — what the driver sees on their phone.
   Deliberately a mobile web page, not an app: no install, no
   app store, no GPS streaming, no battery drain.
   ============================================================ */
(function (global) {
  'use strict';

  var D = { driverId: null };

  function render(host) {
    if (!D.driverId) return renderPicker(host);

    var d = Store.drivers().find(function (x) { return x.id === D.driverId; });
    var mine = Store.orders().filter(function (o) {
      return o.driver_id === D.driverId &&
        ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].indexOf(o.status) > -1;
    }).sort(function (a, b) { return a.created_at - b.created_at; });

    var done = Store.orders().filter(function (o) {
      return o.driver_id === D.driverId && ['DELIVERED', 'COMPLETED'].indexOf(o.status) > -1;
    });

    var h = '<div class="page page--narrow">' +
      '<div class="pagehead"><div><h1>' + UI.esc(d.name) + '</h1>' +
      '<div class="sub">' + mine.length + ' active · ' + done.length + ' delivered</div></div>' +
      '<button class="btn btn--ghost btn--sm" data-act="switch">Switch</button></div>';

    if (!mine.length) {
      h += '<div class="empty"><h3>Nothing on the road</h3>' +
        '<p class="muted">Dispatch will send your next order here.</p></div>';
    }

    mine.forEach(function (o) {
      var st = Store.STATUS[o.status];
      var next = Store.ALLOWED[o.status] || [];
      h += '<div class="card" style="margin-bottom:12px">' +
        '<div class="row row--between" style="margin-bottom:8px">' +
          '<strong style="font-size:17px">' + o.code + '</strong>' +
          '<span class="tag ' + st.tag + '">' + st.label + '</span></div>';

      o.items.forEach(function (l) {
        h += '<div style="font-size:13px">' + l.qty + '× ' + UI.esc(l.name) + '</div>';
      });

      h += '<div style="margin-top:11px;padding-top:11px;border-top:1px solid var(--border)">' +
        '<div style="font-weight:800">' + UI.esc(o.customer.name) + '</div>' +
        '<a href="tel:' + UI.esc(o.customer.phone.replace(/\s/g, '')) + '" style="font-size:14px">' +
          UI.esc(o.customer.phone) + '</a>' +
        (o.address ? '<div class="muted" style="margin-top:5px">' + UI.esc(o.address.line1) + '<br>' +
          UI.esc(o.address.suburb) + '</div>' : '') +
        (o.address && o.address.notes ? '<div style="color:var(--warn);margin-top:4px;font-size:13px">' +
          UI.esc(o.address.notes) + '</div>' : '') +
      '</div>';

      h += '<div class="row" style="margin-top:11px;gap:7px">' +
        (o.payment_method === 'cod'
          ? '<div style="flex:1;padding:9px;border:1px solid var(--warn);border-radius:8px;text-align:center;font-weight:800;color:var(--warn)">COLLECT ' + UI.money(o.total_cents) + '</div>'
          : '<div style="flex:1;padding:9px;border:1px solid var(--border);border-radius:8px;text-align:center;color:var(--muted)">Paid online</div>') +
      '</div>';

      if (next.length) {
        h += '<div class="row mt" style="gap:7px">';
        next.forEach(function (s) {
          var label = { PICKED_UP: 'I have collected it', OUT_FOR_DELIVERY: 'On my way',
                        DELIVERED: 'Delivered' }[s] || s;
          h += '<button class="btn ' + (s === 'DELIVERED' ? 'btn--success' : 'btn--primary') +
               '" style="flex:1" data-move="' + s + '" data-id="' + o.id + '">' + label + '</button>';
        });
        h += '</div>';
      }
      h += '</div>';
    });

    h += '</div>';
    host.innerHTML = h;

    UI.delegate(host, '[data-act="switch"]', 'click', function () {
      D.driverId = null; render(host);
    });
    UI.delegate(host, '[data-move]', 'click', function (e, el) {
      Store.setStatus(el.getAttribute('data-id'), el.getAttribute('data-move'), 'driver');
      UI.toast(Store.STATUS[el.getAttribute('data-move')].label);
    });
  }

  function renderPicker(host) {
    var h = '<div class="page page--narrow"><div class="pagehead">' +
      '<div><h1>Driver</h1><div class="sub">Pick your name</div></div></div>';
    Store.drivers().forEach(function (d) {
      h += '<button class="card btn--block" data-pick="' + d.id + '" ' +
        'style="text-align:left;margin-bottom:9px;width:100%">' +
        '<strong>' + UI.esc(d.name) + '</strong>' +
        '<div class="tiny muted">' + UI.esc(d.phone) + '</div></button>';
    });
    h += '<div class="tiny muted mt" style="text-align:center">This is the page a driver opens ' +
      'from a WhatsApp link. No install.</div></div>';
    host.innerHTML = h;
    UI.delegate(host, '[data-pick]', 'click', function (e, el) {
      D.driverId = el.getAttribute('data-pick'); render(host);
    });
  }

  global.DriverView = { render: render };
})(window);
