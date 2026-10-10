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

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  /* The seed catalogue, captured once before any admin edit, so Reset can restore it. */
  var PRISTINE = null;
  function pristine() {
    if (!PRISTINE) {
      var m = global.Data.menu;
      PRISTINE = { items: clone(m.items), zones: clone(m.delivery_zones),
                   hours: clone(m.hours || []), categories: clone(m.categories) };
    }
    return PRISTINE;
  }

  /* Make the editable catalogue the live one: Data.menu points at state, so every
     view (customer, landing, kitchen, admin) reads the same edited menu. */
  function applyCatalogue() {
    var m = global.Data.menu;
    if (!Array.isArray(state.items)) state.items = clone(pristine().items);
    if (!Array.isArray(state.zones)) state.zones = clone(pristine().zones);
    if (!Array.isArray(state.hours)) state.hours = clone(pristine().hours);
    if (!Array.isArray(state.categories)) state.categories = clone(pristine().categories);
    if (state.special === undefined) state.special = null;
    if (!state.customerNotes) state.customerNotes = {};
    m.items = state.items;
    m.delivery_zones = state.zones;
    m.hours = state.hours;
    m.categories = state.categories;
  }

  /* Calendar date in Johannesburg, YYYY-MM-DD. */
  function sastDate(ms) {
    return new Date(ms || Date.now()).toLocaleDateString('en-CA', { timeZone: 'Africa/Johannesburg' });
  }
  function slug(t) { return String(t).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30); }
  function phoneKey(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : d; }
  function validHM(t) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(t || ''); }

  /* The special in effect right now, or null. Used by pricing and the storefront. */
  function activeSpecial() {
    var sp = state && state.special;
    if (!sp || sp.date !== sastDate()) return null;
    if (sp.branch && sp.branch !== 'ALL' && sp.branch !== state.settings.branchCode) return null;
    var item = (state.items || []).find(function (i) { return i.id === sp.item_id; });
    if (!item) return null;
    return { item: item, price_cents: sp.price_cents != null ? sp.price_cents : item.base_price_cents,
             note: sp.note || '', date: sp.date };
  }
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
    var sp = activeSpecial();
    if (sp && sp.item.id === itemId && sp.price_cents != null) unit = sp.price_cents;
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
      pristine();
      applyCatalogue();
      save();
      try { bc = new BroadcastChannel(CHANNEL); } catch (e) { bc = null; }
      if (bc) {
        bc.onmessage = function () {
          var fresh = load();
          if (fresh) { state = fresh; applyCatalogue(); emit(); }
        };
      }
      /* another tab (or the driver view) changed something */
      window.addEventListener('storage', function (e) {
        if (e.key !== KEY) return;
        var fresh = load();
        if (fresh) { state = fresh; applyCatalogue(); emit(); }
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
      if (!p || p.active === false) return false;
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

    /* --- catalogue: menu items & categories --- */
    items: function () { return state.items; },
    categories: function () { return state.categories; },

    itemSave: function (it) {
      var name = String(it.name || '').trim().slice(0, 80);
      var price = Math.round(Number(it.base_price_cents));
      if (!name || !(price >= 0)) return null;
      if (!state.categories.some(function (c) { return c.id === it.category; })) return null;
      var clean = {
        id: it.id || (slug(name) + '-' + uid().toLowerCase().slice(0, 3)),
        category: it.category,
        name: name,
        description: String(it.description || '').trim().slice(0, 200),
        base_price_cents: price,
        prep_time_min: Math.max(1, Math.min(120, parseInt(it.prep_time_min, 10) || 10)),
        is_signature: !!it.is_signature,
        image: it.image || null,
        groups: Array.isArray(it.groups) ? it.groups : []
      };
      var i = state.items.findIndex(function (x) { return x.id === clean.id; });
      if (i > -1) state.items[i] = clean; else state.items.push(clean);
      applyCatalogue(); save(); emit();
      return clean;
    },

    itemDelete: function (id) {
      state.items = state.items.filter(function (i) { return i.id !== id; });
      delete state.settings.soldOut[id];
      if (state.special && state.special.item_id === id) state.special = null;
      applyCatalogue(); save(); emit();
    },

    categorySave: function (c) {
      var name = String(c.name || '').trim().slice(0, 40);
      if (!name) return null;
      var clean = { id: c.id || slug(name), name: name,
                    sort: parseInt(c.sort, 10) || (state.categories.length + 1), image: c.image || null };
      var i = state.categories.findIndex(function (x) { return x.id === clean.id; });
      if (i > -1) state.categories[i] = clean; else state.categories.push(clean);
      applyCatalogue(); save(); emit();
      return clean;
    },

    categoryDelete: function (id) {
      if (state.items.some(function (i) { return i.category === id; })) return false;   // never orphan items
      state.categories = state.categories.filter(function (c) { return c.id !== id; });
      applyCatalogue(); save(); emit();
      return true;
    },

    /* --- today's special (applies to the price in the cart) --- */
    todaysSpecial: function () { return activeSpecial(); },

    setSpecial: function (sp) {
      var item = state.items.find(function (i) { return i.id === sp.item_id; });
      if (!item) return false;
      var price = (sp.price_cents === '' || sp.price_cents == null) ? null : Math.round(Number(sp.price_cents));
      if (price !== null && !(price >= 0)) return false;
      state.special = { item_id: item.id, price_cents: price,
                        note: String(sp.note || '').trim().slice(0, 120),
                        branch: sp.branch || 'ALL', date: sastDate() };
      save(); emit();
      return true;
    },

    clearSpecial: function () { state.special = null; save(); emit(); },

    /* --- hours, delivery zones, promo codes --- */
    setHours: function (rows) {
      if (!rows.every(function (r) { return validHM(r.open) && validHM(r.close); })) return false;
      state.hours = rows.map(function (r) { return { day: r.day, open: r.open, close: r.close }; });
      applyCatalogue(); save(); emit();
      return true;
    },

    zoneSave: function (z) {
      var name = String(z.name || '').trim().slice(0, 60);
      if (!name || !z.branch) return null;
      var clean = { branch: z.branch, name: name,
                    fee_cents: Math.max(0, Math.round(Number(z.fee_cents) || 0)),
                    min_order_cents: Math.max(0, Math.round(Number(z.min_order_cents) || 0)),
                    eta_minutes: Math.max(5, parseInt(z.eta_minutes, 10) || 30) };
      var i = state.zones.findIndex(function (x) { return x.branch === clean.branch && x.name === clean.name; });
      if (i > -1) state.zones[i] = clean; else state.zones.push(clean);
      applyCatalogue(); save(); emit();
      return clean;
    },

    zoneDelete: function (branch, name) {
      state.zones = state.zones.filter(function (z) { return !(z.branch === branch && z.name === name); });
      applyCatalogue(); save(); emit();
    },

    promoSave: function (p) {
      var code = String(p.code || '').trim().toUpperCase().slice(0, 20);
      var value = Math.round(Number(p.value));
      if (!code || !(value > 0 && value <= 100)) return null;
      var clean = { code: code, type: 'percent', value: value,
                    min_order_cents: Math.max(0, Math.round(Number(p.min_order_cents) || 0)),
                    active: p.active !== false };
      var i = state.settings.promos.findIndex(function (x) { return x.code === code; });
      if (i > -1) state.settings.promos[i] = clean; else state.settings.promos.push(clean);
      save(); emit();
      return clean;
    },

    promoToggle: function (code) {
      var p = state.settings.promos.find(function (x) { return x.code === code; });
      if (!p) return false;
      p.active = p.active === false; save(); emit();
      return p.active;
    },

    promoDelete: function (code) {
      state.settings.promos = state.settings.promos.filter(function (x) { return x.code !== code; });
      save(); emit();
    },

    /* --- CRM: customers are built from orders, keyed by phone --- */
    customers: function () {
      var map = {};
      state.orders.forEach(function (o) {
        var k = phoneKey(o.customer && o.customer.phone);
        if (!k) return;
        var c = map[k] || (map[k] = { key: k, name: '', phone: o.customer.phone, orders: 0, cancelled: 0,
                                      spend_cents: 0, first_at: null, last_at: null, dishes: {},
                                      branches: {}, cod: 0 });
        if (o.status === 'CANCELLED') { c.cancelled++; return; }
        c.orders++;
        c.spend_cents += o.total_cents;
        if (!c.first_at || o.created_at < c.first_at) c.first_at = o.created_at;
        if (!c.last_at || o.created_at > c.last_at) {
          c.last_at = o.created_at; c.name = o.customer.name; c.phone = o.customer.phone;
        }
        o.items.forEach(function (l) { c.dishes[l.name] = (c.dishes[l.name] || 0) + l.qty; });
        c.branches[o.branch || ''] = true;
        if (o.payment_method === 'cod') c.cod++;
      });
      var week = 7 * 86400000, month = 30 * 86400000, nowMs = Date.now();
      return Object.keys(map).map(function (k) {
        var c = map[k];
        var fav = Object.keys(c.dishes).sort(function (a, b) { return c.dishes[b] - c.dishes[a]; })[0] || '';
        var tags = [];
        if (c.orders >= 3 || c.spend_cents >= 100000) tags.push('VIP');
        if (c.orders >= 2) tags.push('Repeat');
        if (c.orders === 1 && c.last_at && nowMs - c.last_at < week) tags.push('New');
        if (c.orders >= 1 && c.last_at && nowMs - c.last_at > month) tags.push('Lapsed');
        return { key: k, name: c.name || 'Guest', phone: c.phone, orders: c.orders, cancelled: c.cancelled,
                 spend_cents: c.spend_cents, aov_cents: c.orders ? Math.round(c.spend_cents / c.orders) : 0,
                 first_at: c.first_at, last_at: c.last_at, favourite: fav, cod: c.cod, tags: tags,
                 note: state.customerNotes[k] || '' };
      }).sort(function (a, b) { return b.spend_cents - a.spend_cents; });
    },

    customerNote: function (key, text) {
      state.customerNotes[key] = String(text || '').trim().slice(0, 500);
      save(); emit();
    },

    /* Export for the client's own marketing use. Marketing consent is NOT captured yet,
       so the column says so honestly rather than implying anyone opted in (POPIA). */
    customersCsv: function () {
      var rows = [['name', 'phone', 'orders', 'spend_rand', 'avg_order_rand', 'favourite', 'last_order', 'tags', 'marketing_consent']];
      Store.customers().forEach(function (c) {
        rows.push([c.name, c.phone, c.orders, (c.spend_cents / 100).toFixed(2), (c.aov_cents / 100).toFixed(2),
                   c.favourite, c.last_at ? sastDate(c.last_at) : '', c.tags.join(' '), 'not captured']);
      });
      return rows.map(function (r) {
        return r.map(function (v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      }).join('\n');
    },

    /* --- dashboard numbers --- */
    analytics: function (days) {
      days = days || 7;
      var buckets = [], idx = {}, i;
      for (i = days - 1; i >= 0; i--) {
        var d = sastDate(Date.now() - i * 86400000);
        var b = { date: d, label: new Date(d + 'T12:00:00+02:00').toLocaleDateString('en-ZA', { weekday: 'short', timeZone: 'Africa/Johannesburg' }),
                  revenue_cents: 0, orders: 0 };
        buckets.push(b); idx[d] = b;
      }
      var dishes = {}, fulfil = { delivery: 0, pickup: 0 }, pay = { card: 0, eft: 0, cod: 0 }, valid = 0, spend = 0;
      state.orders.forEach(function (o) {
        if (o.status === 'CANCELLED') return;
        valid++; spend += o.total_cents;
        var d = sastDate(o.created_at);
        if (idx[d]) { idx[d].orders++; idx[d].revenue_cents += o.total_cents; }
        o.items.forEach(function (l) { dishes[l.name] = (dishes[l.name] || 0) + l.qty; });
        fulfil[o.fulfilment] = (fulfil[o.fulfilment] || 0) + 1;
        pay[o.payment_method] = (pay[o.payment_method] || 0) + 1;
      });
      var custs = Store.customers();
      var repeat = custs.filter(function (c) { return c.orders >= 2; }).length;
      var today = idx[sastDate()] || { revenue_cents: 0, orders: 0 };
      return {
        days: buckets,
        today_revenue_cents: today.revenue_cents,
        today_orders: today.orders,
        week_revenue_cents: buckets.reduce(function (s, b) { return s + b.revenue_cents; }, 0),
        aov_cents: valid ? Math.round(spend / valid) : 0,
        top_dishes: Object.keys(dishes).map(function (n) { return { name: n, qty: dishes[n] }; })
                      .sort(function (a, b) { return b.qty - a.qty; }).slice(0, 6),
        fulfilment: fulfil, payment: pay,
        customers: custs.length, repeat_customers: repeat,
        repeat_rate: custs.length ? Math.round(repeat / custs.length * 100) : 0,
        sold_out: Object.keys(state.settings.soldOut).filter(function (k) { return state.settings.soldOut[k]; }).length,
        live: Store.active().length
      };
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
      var base = pristine();
      state.items = clone(base.items);
      state.zones = clone(base.zones);
      state.hours = clone(base.hours);
      state.categories = clone(base.categories);
      state.special = null;
      applyCatalogue();   /* point Data.menu at the seed copy before seeding orders */
      seed();
      save();
      emit();
    }
  };

  global.Store = Store;
})(window);
