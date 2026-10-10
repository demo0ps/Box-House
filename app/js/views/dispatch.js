/* ============================================================
   dispatch.js — getting ready orders onto the right driver.
   Status-based tracking: the driver's taps ARE the tracking signal.
   ============================================================ */
(function (global) {
  'use strict';

  var STAGES = [
    { key: 'assign',  title: 'Ready · needs a driver', statuses: ['READY'], filter: 'delivery' },
    { key: 'assigned',title: 'Assigned',               statuses: ['ASSIGNED'] },
    { key: 'picked',  title: 'Collected from kitchen', statuses: ['PICKED_UP'] },
    { key: 'out',     title: 'Out for delivery',       statuses: ['OUT_FOR_DELIVERY'] }
  ];

  function card(o) {
    var st = Store.STATUS[o.status];
    var d = o.driver_id ? Store.drivers().find(function (x) { return x.id === o.driver_id; }) : null;
    var mins = Math.max(0, Math.round((Date.now() - o.created_at) / 60000));

    var h = '<div class="ocard" data-order="' + o.id + '">' +
      '<div class="ocard__top"><div class="ocard__code">' + o.code + '</div>' +
      '<span class="tag ' + st.tag + '">' + st.label + '</span></div>' +
      '<div class="tiny muted">' + UI.clock(o.created_at) + ' · ' + mins + ' min ago</div>';

    o.items.forEach(function (l) {
      h += '<div class="ocard__item" style="margin-top:6px">' + l.qty + '× ' + UI.esc(l.name) + '</div>';
    });

    h += '<div class="ocard__meta">' +
      '<div><strong>' + UI.esc(o.customer.name) + '</strong> · ' + UI.esc(o.customer.phone) + '</div>' +
      (o.address ? '<div>' + UI.esc(o.address.line1) + ', ' + UI.esc(o.address.suburb) + '</div>' : '') +
      (o.address && o.address.notes ? '<div style="color:var(--warn)">' + UI.esc(o.address.notes) + '</div>' : '') +
      '<div style="margin-top:5px">' + UI.money(o.total_cents) +
        (o.payment_method === 'cod' ? ' · <span style="color:var(--warn)">CASH ON DELIVERY</span>' : '') + '</div>' +
      (d ? '<div style="margin-top:5px;color:var(--primary)">Driver: ' + UI.esc(d.name) + '</div>' : '') +
    '</div>';

    if (o.status === 'READY') {
      h += '<div class="ocard__acts" style="flex-wrap:wrap">';
      Store.drivers().forEach(function (dv) {
        var load = Store.orders().filter(function (x) {
          return x.driver_id === dv.id && ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].indexOf(x.status) > -1;
        }).length;
        h += '<button class="btn btn--sm btn--primary" data-assign="' + o.id + '" data-driver="' + dv.id + '">' +
             UI.esc(dv.name.split(' ')[0]) + ' (' + load + ')</button>';
      });
      h += '</div>';
    } else {
      var next = (Store.ALLOWED[o.status] || []);
      if (next.length) {
        h += '<div class="ocard__acts">';
        next.forEach(function (s) {
          var label = { PICKED_UP: 'Collected', OUT_FOR_DELIVERY: 'Out for delivery',
                        DELIVERED: 'Delivered' }[s] || s;
          h += '<button class="btn btn--sm ' + (s === 'DELIVERED' ? 'btn--success' : 'btn--primary') +
               '" data-move="' + s + '" data-id="' + o.id + '">' + label + '</button>';
        });
        h += '</div>';
      }
    }
    h += '</div>';
    return h;
  }

  function render(host) {
    var h = '<div class="page">' +
      '<div class="pagehead">' +
        '<div><h1>Dispatch</h1><div class="sub">' + UI.esc(Store.branch().name) + '</div></div>' +
        '<div class="row"><button class="btn" data-act="sim">Simulate order</button>' +
        '<button class="btn" data-act="drivers">Drivers</button></div>' +
      '</div>';

    /* driver load */
    h += '<div class="grid grid--3" style="margin-bottom:14px">';
    Store.drivers().forEach(function (d) {
      var load = Store.orders().filter(function (x) {
        return x.driver_id === d.id && ['ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].indexOf(x.status) > -1;
      }).length;
      var done = Store.orders().filter(function (x) {
        return x.driver_id === d.id && ['DELIVERED', 'COMPLETED'].indexOf(x.status) > -1;
      }).length;
      h += '<div class="stat"><div class="stat__l">' + UI.esc(d.name) + '</div>' +
        '<div class="stat__v">' + load + ' <span style="font-size:13px;color:var(--muted)">on the road</span></div>' +
        '<div class="stat__s">' + done + ' delivered today · ' + UI.esc(d.phone) + '</div></div>';
    });
    h += '</div>';

    h += '<div class="ocols">';
    STAGES.forEach(function (s) {
      var list = Store.byStatus(s.statuses).filter(function (o) {
        return !s.filter || o.fulfilment === s.filter;
      });
      h += '<div class="ocol"><div class="ocol__h"><h3>' + s.title + '</h3>' +
        '<span class="ocol__n">' + list.length + '</span></div><div class="ocol__b">';
      h += list.length ? list.map(card).join('')
        : '<div class="tiny muted" style="text-align:center;padding:16px 0">Clear</div>';
      h += '</div></div>';
    });
    h += '</div></div>';

    host.innerHTML = h;

    UI.delegate(host, '[data-assign]', 'click', function (e, el) {
      if (Store.assignDriver(el.getAttribute('data-assign'), el.getAttribute('data-driver'))) {
        var d = Store.drivers().find(function (x) { return x.id === el.getAttribute('data-driver'); });
        UI.toast('Assigned to ' + d.name);
      }
    });
    UI.delegate(host, '[data-move]', 'click', function (e, el) {
      Store.setStatus(el.getAttribute('data-id'), el.getAttribute('data-move'), 'dispatch');
    });
    UI.delegate(host, '[data-act="sim"]', 'click', function () {
      var o = Store.simulate();
      if (o) { UI.toast('Incoming order ' + o.code); UI.beep(2); }
    });
    UI.delegate(host, '[data-act="drivers"]', 'click', openDrivers);
  }

  function openDrivers() {
    var h = '<div class="tiny muted" style="margin-bottom:10px">Drivers work from a link on their ' +
      'phone — no app install, no app store.</div>';
    Store.drivers().forEach(function (d) {
      h += '<div class="opt"><div><div class="opt__name">' + UI.esc(d.name) + '</div>' +
        '<div class="tiny muted">' + UI.esc(d.phone) + '</div></div>' +
        (d.active ? '<span class="tag tag--ready">On shift</span>' : '<span class="tag tag--muted">Off</span>') +
        '</div>';
    });
    h += '<div class="tiny muted mt">Each driver opens <strong>/app/#driver</strong>, picks their ' +
      'name, and taps their way through the delivery. Those taps are what the customer sees on ' +
      'the tracking page.</div>';
    UI.open({ title: 'Drivers', sub: 'No app install required', body: h });
  }

  global.DispatchView = { render: render };
})(window);
