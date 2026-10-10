/* ============================================================
   store.js — the order state machine.

   Deliberately built to the same shape the production system will
   use: append-only events per order, integer cents, an explicit
   transition table. The demo is not a mock-up of this, it IS this.
   ============================================================ */
(function (global) {
  'use strict';

  var KEY = 'boxhouse.state.v1';
  var CHANNEL = 'boxhouse.sync';

  /* ---- status catalogue ------------------------------------ */
  var STATUS = {
    PENDING_PAYMENT: { label: 'Awaiting payment', tag: 'tag--muted',   customer: 'Order received' },
    PAID:            { label: 'Paid · new',       tag: 'tag--new',     customer: 'Order received' },
    ACCEPTED:        { label: 'Accepted',         tag: 'tag--new',     customer: 'Kitchen accepted' },
    PREPARING:       { label: 'Preparing',        tag: 'tag--prep',    customer: 'Being prepared' },
    READY:           { label: 'Ready',            tag: 'tag--ready',   customer: 'Ready' },
    ASSIGNED:        { label: 'Driver assigned',  tag: 'tag--out',     customer: 'Driver on the way' },
    PICKED_UP:       { label: 'Collected',        tag: 'tag--out',     customer: 'Driver has your order' },
    OUT_FOR_DELIVERY:{ label: 'Out for delivery', tag: 'tag--out',     customer: 'On its way' },
    DELIVERED:       { label: 'Delivered',        tag: 'tag--done',    customer: 'Delivered' },
    COLLECTED:       { label: 'Collected',        tag: 'tag--done',    customer: 'Collected' },
    COMPLETED:       { label: 'Completed',        tag: 'tag--done',    customer: 'Completed' },
    CANCELLED:       { label: 'Cancelled',        tag: 'tag--muted',   customer: 'Cancelled' }
  };

  /* What each role is allowed to move an order to. */
  var ALLOWED = {
    PAID:             ['ACCEPTED', 'CANCELLED'],
    ACCEPTED:         ['PREPARING', 'CANCELLED'],
    PREPARING:        ['READY', 'CANCELLED'],
    READY:            ['ASSIGNED', 'COLLECTED'],
    ASSIGNED:         ['PICKED_UP'],
    PICKED_UP:        ['OUT_FOR_DELIVERY'],
    OUT_FOR_DELIVERY: ['DELIVERED'],
    DELIVERED:        ['COMPLETED'],
    COLLECTED:        ['COMPLETED']
  };

  var CUSTOMER_FLOW_DELIVERY = ['PAID', 'ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
  var CUSTOMER_FLOW_PICKUP   = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'COLLECTED'];

  function uid() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
  function now() { return Date.now(); }

  var state = null;
  var subs = [];
  var bc = null;

  function blankState() {
    return {
      seq: 1,
      orders: [],
      events: [],
      drivers: [
        { id: 'd1', name: 'Sipho M.', phone: '082 441 0192', active: true },
        { id: 'd2', name: 'Lerato K.', phone: '071 228 7734', active: true },
        { id: 'd3', name: 'Thabo N.', phone: '060 913 5567', active: true }
      ],
      settings: {
        branchCode: 'TEM',
        capacityMax: 6,        /* orders accepted per slot */
        capacitySlotMin: 15,
        autoAccept: false,
        soldOut: {},
        promos: [{ code: 'BOXFAM', type: 'percent', value: 10, min_order_cents: 15000 }]
      },
        cart: { branch: 'TEM', fulfilment: 'delivery', items: [], promo: null,
                tip_cents: 0, zone: null, payment_method: 'card',
                customer: { name: '', phone: '' }, address: { line1: '', notes: '' } }
    };
  }

  /* ---- persistence ---------------------------------------- */
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
    if (bc) { try { bc.postMessage('changed'); } catch (e) {} }
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      /* Only trust saved state that matches the CURRENT shape. Anything
         older or partial is discarded and the demo reseeds cleanly. */
      if (!s || !Array.isArray(s.orders) || !s.settings || !Array.isArray(s.drivers) ||
          typeof s.settings.branchCode !== 'string' || !s.settings.promos) return null;
      return s;
    } catch (e) { return null; }
  }

  function emit() { subs.forEach(function (fn) { try { fn(state); } catch (e) { console.error(e); } }); }

  /* ---- pricing -------------------------------------------- */
  function priceLine(menu, itemId, qty, selections, notes) {
    var item = menu.items.find(function (i) { return i.id === itemId; });
    if (!item) return null;
    var unit = item.base_price_cents;
    var opts = [];
    (selections || []).forEach(function (sel) {
      var g = menu.option_groups[sel.group];
      if (!g) return;
      var o = g.options.find(function (x) { return x.name === sel.option; });
      if (!o) return;
      unit += o.price_delta_cents;
      opts.push({ group: g.name, option: o.name, delta_cents: o.price_delta_cents });
    });
    return {
      itemId: item.id, name: item.name, qty: qty, unit_price_cents: unit,
      options: opts, notes: notes || '',
      prep_time_min: item.prep_time_min || 10
    };
  }

  /* ---- seed data so the demo looks alive on first load ---- */
  var SEED_NAMES = ['Palesa M.', 'Kagiso T.', 'Naledi S.', 'Bongani R.', 'Amahle D.', 'Tebogo L.'];
  var SEED_SUBURBS = ['Igqagqa', 'Tembisa Central', 'Birchleigh'];

  function seedEvents() {
    var src = (global.BOX_EMBEDDED && global.BOX_EMBEDDED.events && global.BOX_EMBEDDED.events.items) || [];
    return JSON.parse(JSON.stringify(src));
  }

  function seed() {
    var menu = global.Data.menu;
    if (!menu) return;
    state.events = seedEvents();
    var statuses = ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY'];
    var n = 6;
    for (var i = 0; i < n; i++) {
      var item = menu.items[Math.floor(Math.random() * menu.items.length)];
      var status = statuses[i % statuses.length];
      var minsAgo = 6 + i * 4;
      var created = now() - minsAgo * 60000;
      var o = {
        id: uid(), code: 'BX-' + (100 + i), branch: state.settings.branchCode,
        channel: 'web', fulfilment: i % 3 === 0 ? 'pickup' : 'delivery',
        status: status,
        items: [priceLine(menu, item.id, 1, [], '')],
        customer: { name: SEED_NAMES[i % SEED_NAMES.length], phone: '08' + Math.floor(1e8 + Math.random() * 9e7) },
        address: { line1: (12 + i) + ' Mokoena Street', suburb: SEED_SUBURBS[i % SEED_SUBURBS.length], notes: '' },
        zone: SEED_SUBURBS[i % SEED_SUBURBS.length],
        delivery_fee_cents: i % 3 === 0 ? 0 : 2500,
        discount_cents: 0, tip_cents: i % 2 ? 500 : 0,
        payment_method: i % 4 === 0 ? 'cod' : 'card',
        created_at: created, updated_at: created,
        driver_id: null,
        events: [{ from: null, to: status, actor: 'system', at: created }]
      };
      if (['OUT_FOR_DELIVERY', 'PICKED_UP', 'ASSIGNED'].indexOf(status) > -1) {
        o.driver_id = state.drivers[i % state.drivers.length].id;
      }
      recompute(o, menu);
      state.orders.push(o);
    }
    state.seq = 100 + n;
  }

  function recompute(o, menu) {
    var subtotal = o.items.reduce(function (s, l) { return s + l.unit_price_cents * l.qty; }, 0);
    var vat_rate = (menu.restaurant && menu.restaurant.vat_rate) || 0.15;
    var incl = menu.restaurant && menu.restaurant.prices_include_vat;
    var net = incl ? Math.round(subtotal / (1 + vat_rate)) : subtotal;
    o.subtotal_cents = subtotal;
    o.vat_cents = Math.round(net * vat_rate);
    o.total_cents = (incl ? subtotal : subtotal + o.vat_cents)
      + (o.delivery_fee_cents || 0) - (o.discount_cents || 0) + (o.tip_cents || 0);
  }

  /* ---- capacity (the Friday-night guard) ------------------ */
  function acceptedInSlot() {
    var slotMs = state.settings.capacitySlotMin * 60000;
    var cutoff = now() - slotMs;
    return state.orders.filter(function (o) {
      return o.created_at >= cutoff && ['PAID', 'ACCEPTED', 'PREPARING', 'READY'].indexOf(o.status) > -1;
    }).length;
  }

  /* ---- public API ----------------------------------------- */
  var Store = {
    STATUS: STATUS,
    ALLOWED: ALLOWED,
    CUSTOMER_FLOW_DELIVERY: CUSTOMER_FLOW_DELIVERY,
    CUSTOMER_FLOW_PICKUP: CUSTOMER_FLOW_PICKUP,

    init: function () {
      state = load();
      if (!state) { state = blankState(); seed(); save(); }
      if (!Array.isArray(state.events)) { state.events = seedEvents(); save(); }
      try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }
      if (bc) {
        bc.onmessage = function () {
          var fresh = load();
          if (fresh) { state = fresh; emit(); }
        };
      }
      /* another tab (or the driver view) changed something */
      window.addEventListener('storage', function (e) {
        if (e.key !== KEY) return;
        var fresh = load();
        if (fresh) { state = fresh; emit(); }
      });
      return state;
    },

    get: function () { return state; },
    save: save,
    sub: function (fn) { subs.push(fn); return function () { subs = subs.filter(function (f) { return f !== fn; }); }; },
    emit: emit,

    settings: function () { return state.settings; },
    drivers: function () { return state.drivers; },
    orders: function () { return state.orders; },

    byStatus: function (list) {
      return state.orders.filter(function (o) { return list.indexOf(o.status) > -1; })
        .sort(function (a, b) { return a.created_at - b.created_at; });
    },

    active: function () {
      return state.orders.filter(function (o) {
        return ['PAID', 'ACCEPTED', 'PREPARING', 'READY', 'ASSIGNED', 'PICKED_UP', 'OUT_FOR_DELIVERY'].indexOf(o.status) > -1;
      }).sort(function (a, b) { return a.created_at - b.created_at; });
    },

    order: function (id) { return state.orders.find(function (o) { return o.id === id; }); },

    branch: function () {
      var code = state.settings.branchCode;
      return global.Data.menu.branches.find(function (b) { return b.code === code; })
        || global.Data.menu.branches[0];
    },

    zones: function () {
      var code = state.settings.branchCode;
      return global.Data.menu.delivery_zones.filter(function (z) { return z.branch === code; });
    },

    zone: function (name) {
      return Store.zones().find(function (z) { return z.name === name; });
    },

    /* build one priced line — used by the item sheet and by simulate() */
    priceLine: function (itemId, qty, selections, notes) {
      return priceLine(global.Data.menu, itemId, qty, selections, notes);
    },

    /* --- cart --- */
    cart: function () {
      if (!state.cart) {
        state.cart = { branch: state.settings.branchCode, fulfilment: 'delivery',
                       items: [], promo: null, tip_cents: 0, zone: null };
      }
      return state.cart;
    },
    cartAdd: function (line) { Store.cart().items.push(line); save(); emit(); },
    cartRemove: function (i) { Store.cart().items.splice(i, 1); save(); emit(); },
    cartClear: function () { Store.cart().items = []; Store.cart().promo = null; save(); emit(); },
    cartSet: function (patch) { Object.assign(Store.cart(), patch); save(); emit(); },

    /* Update the cart WITHOUT notifying subscribers. Used for text inputs,
       so a re-render triggered elsewhere never wipes what someone typed. */
    cartPeek: function (patch) { Object.assign(Store.cart(), patch); save(); },

    cartTotals: function () {
      var c = Store.cart();
      var menu = global.Data.menu;
      var subtotal = c.items.reduce(function (s, l) { return s + l.unit_price_cents * l.qty; }, 0);
      var fee = c.fulfilment === 'delivery' && c.zone
        ? (Store.zone(c.zone) ? Store.zone(c.zone).fee_cents : 0) : 0;
      var discount = 0;
      if (c.promo && c.promo.type === 'percent') discount = Math.round(subtotal * c.promo.value / 100);
      var vat_rate = (menu.restaurant && menu.restaurant.vat_rate) || 0.15;
      var incl = menu.restaurant && menu.restaurant.prices_include_vat;
      var net = incl ? Math.round(subtotal / (1 + vat_rate)) : subtotal;
      var vat = Math.round(net * vat_rate);
      return {
        subtotal_cents: subtotal, delivery_fee_cents: fee, discount_cents: discount,
        tip_cents: c.tip_cents || 0, vat_cents: vat,
        total_cents: (incl ? subtotal : subtotal + vat) + fee - discount + (c.tip_cents || 0)
      };
    },

    applyPromo: function (code) {
      var p = state.settings.promos.find(function (x) { return x.code === code.toUpperCase(); });
      if (!p) return false;
      if (p.min_order_cents && Store.cartTotals().subtotal_cents < p.min_order_cents) return false;
      Store.cart().promo = p;
      save(); emit();
      return true;
    },

    /* --- orders --- */
    /* opts.silent skips the notification so the caller can update its own
       view state first, then emit once. */
    placeOrder: function (payload, opts) {
      var menu = global.Data.menu;
      var t = Store.cartTotals();
      var id = uid();
      var o = {
        id: id, code: 'BX-' + (state.seq++),
        branch: Store.cart().branch, channel: 'web',
        fulfilment: Store.cart().fulfilment,
        status: payload.payment_method === 'cod' ? 'PAID' : 'PAID',
        items: Store.cart().items.slice(),
        customer: payload.customer,
        address: payload.address || null,
        zone: Store.cart().zone,
        delivery_fee_cents: t.delivery_fee_cents,
        discount_cents: t.discount_cents,
        tip_cents: t.tip_cents,
        payment_method: payload.payment_method,
        created_at: now(), updated_at: now(),
        driver_id: null,
        events: [{ from: null, to: 'PAID', actor: 'customer', at: now() }]
      };
      recompute(o, menu);
      state.orders.push(o);
      state.cart = null;
      save();
      if (!(opts && opts.silent)) emit();
      return o;
    },

    canTransition: function (orderId, to) {
      var o = Store.order(orderId);
      if (!o) return false;
      return (ALLOWED[o.status] || []).indexOf(to) > -1;
    },

    setStatus: function (orderId, to, actor) {
      var o = Store.order(orderId);
      if (!o) return false;
      if (!Store.canTransition(orderId, to)) return false;
      o.events.push({ from: o.status, to: to, actor: actor || 'system', at: now() });
      o.status = to;
      o.updated_at = now();
      save(); emit();
      return true;
    },

    assignDriver: function (orderId, driverId) {
      var o = Store.order(orderId);
      if (!o) return false;
      if (o.status !== 'READY') return false;
      o.driver_id = driverId;
      return Store.setStatus(orderId, 'ASSIGNED', 'dispatch');
    },

    /* --- ops --- */
    toggleSoldOut: function (itemId) {
      state.settings.soldOut[itemId] = !state.settings.soldOut[itemId];
      save(); emit();
    },
    isSoldOut: function (itemId) { return !!state.settings.soldOut[itemId]; },

    setSetting: function (k, v) { state.settings[k] = v; save(); emit(); },
    setBranch: function (code) { state.settings.branchCode = code; state.cart = null; save(); emit(); },

    capacity: function () {
      var used = acceptedInSlot();
      var max = state.settings.capacityMax;
      return { used: used, max: max, pct: Math.min(100, Math.round(used / max * 100)), full: used >= max };
    },

    atCapacity: function () { return acceptedInSlot() >= state.settings.capacityMax; },

    /* simulate an order arriving — for demoing the kitchen without
       walking the whole customer flow */
    simulate: function () {
      var menu = global.Data.menu;
      var pool = menu.items.filter(function (i) { return !Store.isSoldOut(i.id); });
      if (!pool.length) return null;
      var item = pool[Math.floor(Math.random() * pool.length)];
      var isPickup = Math.random() < 0.3;
      var zone = Store.zones()[Math.floor(Math.random() * Store.zones().length)];
      var o = {
        id: uid(), code: 'BX-' + (state.seq++),
        branch: state.settings.branchCode, channel: 'web',
        fulfilment: isPickup ? 'pickup' : 'delivery',
        status: 'PAID',
        items: [priceLine(menu, item.id, 1, [], Math.random() < 0.25 ? 'No onions please' : '')],
        customer: { name: SEED_NAMES[Math.floor(Math.random() * SEED_NAMES.length)],
                    phone: '08' + Math.floor(1e8 + Math.random() * 9e7) },
        address: isPickup ? null : { line1: (5 + Math.floor(Math.random() * 80)) + ' Mokoena Street',
                                     suburb: zone ? zone.name : '', notes: '' },
        zone: zone ? zone.name : null,
        delivery_fee_cents: isPickup ? 0 : (zone ? zone.fee_cents : 0),
        discount_cents: 0, tip_cents: Math.random() < 0.3 ? 500 : 0,
        payment_method: Math.random() < 0.25 ? 'cod' : 'card',
        created_at: now(), updated_at: now(), driver_id: null,
        events: [{ from: null, to: 'PAID', actor: 'customer', at: now() }]
      };
      recompute(o, menu);
      state.orders.push(o);
      save(); emit();
      return o;
    },

    /* --- events (admin-managed, promoted on the storefront) --- */
    events: function (opts) {
      var list = state.events.slice();
      if (opts && opts.publishedOnly) list = list.filter(function (e) { return e.published; });
      if (opts && opts.branch) list = list.filter(function (e) { return e.branch === opts.branch || e.branch === 'ALL'; });
      return list.sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); });
    },

    /* Upcoming = not yet ended. Past events drop off the storefront automatically. */
    upcomingEvents: function (opts) {
      var nowMs = Date.now();
      return Store.events(Object.assign({ publishedOnly: true }, opts || {})).filter(function (e) {
        return new Date(e.ends_at || e.starts_at).getTime() > nowMs;
      });
    },

    eventSave: function (ev) {
      var clean = {
        id: ev.id || ('ev-' + uid().toLowerCase()),
        title: String(ev.title || '').trim().slice(0, 80),
        kind: String(ev.kind || 'Event').trim().slice(0, 30),
        branch: ev.branch || 'TEM',
        starts_at: ev.starts_at,
        ends_at: ev.ends_at || ev.starts_at,
        venue: String(ev.venue || '').trim().slice(0, 80),
        blurb: String(ev.blurb || '').trim().slice(0, 240),
        image: ev.image || '',
        ticket_url: String(ev.ticket_url || '').trim(),
        ticket_label: String(ev.ticket_label || 'Get tickets').trim().slice(0, 30),
        published: !!ev.published
      };
      if (!clean.title || !clean.starts_at) return null;
      if (clean.ticket_url && !/^https:\/\//i.test(clean.ticket_url)) return null;   // https only
      var i = state.events.findIndex(function (e) { return e.id === clean.id; });
      if (i > -1) state.events[i] = clean; else state.events.push(clean);
      save(); emit();
      return clean;
    },

    eventToggle: function (id) {
      var e = state.events.find(function (x) { return x.id === id; });
      if (!e) return false;
      e.published = !e.published; save(); emit();
      return e.published;
    },

    eventDelete: function (id) {
      state.events = state.events.filter(function (e) { return e.id !== id; });
      save(); emit();
    },

    stats: function () {
      var done = state.orders.filter(function (o) {
        return ['DELIVERED', 'COLLECTED', 'COMPLETED'].indexOf(o.status) > -1;
      });
      var revenue = done.reduce(function (s, o) { return s + o.total_cents; }, 0);
      var cod = state.orders.filter(function (o) { return o.payment_method === 'cod'; });
      return {
        live: Store.active().length,
        today: state.orders.length,
        completed: done.length,
        revenue_cents: revenue,
        aov_cents: done.length ? Math.round(revenue / done.length) : 0,
        cod_count: cod.length
      };
    },

    reset: function () {
      state = blankState();
      seed();
      save();
      emit();
    }
  };

  global.Store = Store;
})(window);
