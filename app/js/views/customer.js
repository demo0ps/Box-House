/* ============================================================
   customer.js — the storefront journey:
   landing -> menu -> cart -> payment -> live tracking

   Card details are held in memory only for the length of the step
   and are never written to localStorage, logs or the order record.
   ============================================================ */
(function (global) {
  'use strict';

  var C = {
    cat: null,
    step: 'landing',
    tracking: null,
    pay: { method: 'card', bank: '', processing: false, error: '',
           card: { number: '', exp: '', cvv: '', name: '' } }
  };

  function menu() { return global.Data.menu; }

  /* ================= shared: sticky cart bar ================= */
  function cartBarHtml() {
    var cart = Store.cart();
    var n = cart.items.length;
    if (!n) return '';
    var t = Store.cartTotals();
    return '<div class="cartbar">' +
      '<div><strong>' + n + ' item' + (n > 1 ? 's' : '') + '</strong>' +
      '<div class="tiny muted">' + UI.money(t.subtotal_cents) + '</div></div>' +
      '<button class="btn btn--primary" data-act="cart">View order</button>' +
    '</div>';
  }

  function attachCartBar(host, html) {
    var el = document.createElement('div');
    el.innerHTML = html;
    while (el.firstChild) host.appendChild(el.firstChild);
  }

  /* ================= landing ================= */
  function renderLanding(host) {
    global.LandingView.render(host, {
      onStart: function () { C.step = 'menu'; render(host); },
      onBranch: function (code) {
        /* set the step FIRST: setBranch notifies subscribers, and the
           re-render it triggers must already know we are heading to the
           menu - otherwise we redraw into a stale container */
        C.step = 'menu'; C.cat = null;
        if (code !== Store.settings().branchCode) {
          Store.setBranch(code);        // this re-renders with step = 'menu'
        } else {
          render(host);                 // no store change, redraw ourselves
        }
      },
      onQuickAdd: function (itemId) { openItem(host, itemId); }
    });
    attachCartBar(host, cartBarHtml());
    bindCommon(host);
  }

  /* ================= menu ================= */
  function renderList(host) {
    var m = menu();
    var cats = m.categories.slice().sort(function (a, b) { return a.sort - b.sort; });

    var html = '<div class="wrap page">';

    /* back + branch + fulfilment */
    html += '<div class="row row--between" style="margin-bottom:12px">' +
      '<button class="btn btn--ghost btn--sm" data-act="home">&larr; Home</button>' +
      '<span class="tiny muted">' + UI.esc(Store.branch().short) + '</span>' +
    '</div>';

    html += '<div class="seg" id="fulfilSeg" style="width:100%;margin-bottom:12px">' +
      '<button data-ful="delivery" style="flex:1" class="' +
        (Store.cart().fulfilment === 'delivery' ? 'is-active' : '') + '">Delivery</button>' +
      '<button data-ful="pickup" style="flex:1" class="' +
        (Store.cart().fulfilment === 'pickup' ? 'is-active' : '') + '">Collection</button>' +
    '</div>';

    html += '<div class="cats">' +
      '<button class="cat ' + (C.cat ? '' : 'is-active') + '" data-cat="">All</button>' +
      cats.map(function (c) {
        return '<button class="cat ' + (C.cat === c.id ? 'is-active' : '') + '" data-cat="' + c.id + '">' +
               UI.esc(c.name) + '</button>';
      }).join('') +
    '</div>';

    var list = m.items.filter(function (i) { return !C.cat || i.category === C.cat; });
    if (!list.length) {
      html += '<div class="empty"><h3>Nothing here yet</h3><p class="muted">Try another category.</p></div>';
    }
    list.forEach(function (it) {
      var out = global.Store.isSoldOut(it.id);
      var t = it.image ? '../assets/food/' + it.image.replace(/\.jpg$/, '-thumb.jpg') : '';
      html += '<div class="item ' + (out ? 'item--out' : '') + '">' +
        (t ? '<img class="item__img" src="' + t + '" alt="" loading="lazy">' : '') +
        '<div class="item__body">' +
          '<div class="item__name">' + UI.esc(it.name) +
            (it.is_signature ? ' <span class="star">&#9733;</span>' : '') +
            (out ? ' <span class="tag tag--muted">Sold out</span>' : '') +
          '</div>' +
          '<div class="item__desc">' + UI.esc(it.description || '') + '</div>' +
          '<div class="item__price">' + UI.money(it.base_price_cents) + '</div>' +
        '</div>' +
        (out ? '<button class="btn btn--sm" disabled>—</button>'
             : '<button class="btn btn--primary btn--sm" data-add="' + it.id + '">Add</button>') +
      '</div>';
    });

    html += '</div>';
    host.innerHTML = html;
    attachCartBar(host, cartBarHtml());
    bindCommon(host);

    UI.delegate(host, '[data-cat]', 'click', function (e, el) {
      C.cat = el.getAttribute('data-cat') || null;
      renderList(host);
    });
    UI.delegate(host, '[data-ful]', 'click', function (e, el) {
      Store.cartSet({ fulfilment: el.getAttribute('data-ful') });
      renderList(host);
    });
    UI.delegate(host, '[data-add]', 'click', function (e, el) {
      openItem(host, el.getAttribute('data-add'));
    });
    UI.delegate(host, '[data-act="home"]', 'click', function () {
      C.step = 'landing'; render(host);
    });
  }

  function bindCommon(host) {
    UI.delegate(host, '[data-act="cart"]', 'click', function () {
      C.step = 'cart'; render(host);
    });
  }

  /* ================= item sheet ================= */
  function openItem(host, itemId) {
    var it = menu().items.find(function (i) { return i.id === itemId; });
    if (!it) return;
    var picked = {};
    var qty = 1;
    var notes = '';

    (it.groups || []).forEach(function (gid) {
      var g = menu().option_groups[gid];
      if (!g) return;
      picked[gid] = (g.selection_type === 'single') ? g.options[0].name : [];
    });

    function body() {
      var h = '';
      if (it.image) {
        h += '<img src="../assets/food/' + it.image.replace(/\.jpg$/, '-thumb.jpg') + '" ' +
             'style="width:100%;height:150px;object-fit:cover;border-radius:10px;margin-bottom:12px" alt="">';
      }
      h += '<p class="muted" style="margin-top:0">' + UI.esc(it.description || '') + '</p>';
      (it.groups || []).forEach(function (gid) {
        var g = menu().option_groups[gid];
        if (!g) return;
        h += '<div class="mt"><div class="tiny muted" style="font-weight:800;letter-spacing:.05em">' +
             UI.esc(g.name).toUpperCase() +
             (g.is_required ? ' · REQUIRED' : ' · OPTIONAL') + '</div>';
        g.options.forEach(function (o) {
          var on = g.selection_type === 'single'
            ? picked[gid] === o.name
            : picked[gid].indexOf(o.name) > -1;
          h += '<div class="opt ' + (on ? 'is-on' : '') + '" data-g="' + gid + '" data-o="' + UI.esc(o.name) + '">' +
                 '<div class="opt__name">' + UI.esc(o.name) + '</div>' +
                 '<div class="opt__delta">' + (o.price_delta_cents ? '+' + UI.money(o.price_delta_cents) : '—') + '</div>' +
               '</div>';
        });
        h += '</div>';
      });
      h += '<div class="field mt"><label>Anything else?</label>' +
           '<textarea id="itemNotes" rows="2" placeholder="No onions, extra sauce…">' + UI.esc(notes) + '</textarea></div>';
      return h;
    }

    function priceNow() {
      var total = it.base_price_cents;
      (it.groups || []).forEach(function (gid) {
        var g = menu().option_groups[gid];
        if (!g) return;
        var names = (g.selection_type === 'single') ? [picked[gid]] : picked[gid];
        names.forEach(function (n) {
          var o = g.options.find(function (x) { return x.name === n; });
          if (o) total += o.price_delta_cents;
        });
      });
      return total * qty;
    }

    function footer() {
      return '<div class="qty">' +
               '<button data-q="-1">−</button><span>' + qty + '</span><button data-q="1">+</button>' +
             '</div>' +
             '<button class="btn btn--primary" data-confirm>Add · ' + UI.money(priceNow()) + '</button>';
    }

    UI.open({
      title: it.name,
      sub: UI.money(it.base_price_cents) + ' · ' + (it.prep_time_min || 10) + ' min',
      body: body(), footer: footer(),
      onMount: function (m) {
        UI.delegate(m, '.opt', 'click', function (e, el) {
          var gid = el.getAttribute('data-g'), on = el.getAttribute('data-o');
          var g = menu().option_groups[gid];
          if (g.selection_type === 'single') picked[gid] = on;
          else {
            var arr = picked[gid], i = arr.indexOf(on);
            if (i > -1) arr.splice(i, 1);
            else if (arr.length < (g.max_select || 99)) arr.push(on);
            else { UI.toast('Max ' + g.max_select + ' choices'); return; }
          }
          m.querySelector('.sheet__body').innerHTML = body();
          m.querySelector('.sheet__foot').innerHTML = footer();
        });
        UI.delegate(m, '[data-q]', 'click', function (e, el) {
          qty = Math.max(1, Math.min(20, qty + parseInt(el.getAttribute('data-q'), 10)));
          m.querySelector('.sheet__foot').innerHTML = footer();
        });
        UI.delegate(m, '[data-confirm]', 'click', function () {
          notes = (m.querySelector('#itemNotes') || {}).value || '';
          var sel = [];
          (it.groups || []).forEach(function (gid) {
            var g = menu().option_groups[gid];
            if (!g) return;
            if (g.selection_type === 'single') sel.push({ group: gid, option: picked[gid] });
            else picked[gid].forEach(function (n2) { sel.push({ group: gid, option: n2 }); });
          });
          var line = Store.priceLine(it.id, qty, sel, notes);
          if (line) { Store.cartAdd(line); UI.toast(it.name + ' added'); }
          UI.close();
          render(host);
        });
      }
    });
  }

  /* ================= cart ================= */
  function renderCart(host) {
    var cart = Store.cart();
    var t = Store.cartTotals();

    var h = '<div class="wrap page"><div class="pagehead">' +
      '<div><h1>Your box</h1><div class="sub">' + UI.esc(Store.branch().name) + '</div></div>' +
      '<button class="btn btn--ghost btn--sm" data-act="menu">+ Add more</button></div>';

    if (!cart.items.length) {
      h += '<div class="empty"><h3>Empty box</h3><p class="muted">Add something good.</p>' +
           '<button class="btn btn--primary mt" data-act="menu">Browse the menu</button></div></div>';
      host.innerHTML = h;
      UI.delegate(host, '[data-act="menu"]', 'click', function () { C.step = 'menu'; render(host); });
      return;
    }

    h += '<div class="card">';
    cart.items.forEach(function (l, i) {
      h += '<div class="line"><div class="line__body">' +
        '<div class="line__name">' + l.qty + '× ' + UI.esc(l.name) + '</div>' +
        (l.options.length ? '<div class="line__opts">' +
          l.options.map(function (o) { return UI.esc(o.option); }).join(' · ') + '</div>' : '') +
        (l.notes ? '<div class="line__opts" style="color:var(--warn)">' + UI.esc(l.notes) + '</div>' : '') +
        '</div><div class="line__right">' +
        '<div>' + UI.money(l.unit_price_cents * l.qty) + '</div>' +
        '<button class="btn btn--ghost btn--sm" data-rm="' + i + '" style="color:var(--danger)">Remove</button>' +
        '</div></div>';
    });
    h += '</div>';

    h += '<div class="card"><div class="row">' +
      '<input id="promoCode" placeholder="Promo code" value="' + UI.esc(cart.promo ? cart.promo.code : '') + '" ' +
      'style="flex:1;padding:10px 12px;border-radius:8px;background:var(--bg);border:1px solid var(--border)">' +
      '<button class="btn" data-act="promo">Apply</button></div>' +
      (cart.promo ? '<div class="tiny mt" style="color:var(--success)">' + UI.esc(cart.promo.code) +
        ' applied · −' + UI.money(t.discount_cents) + '</div>' : '') +
      '</div>';

    h += '<div class="card"><div class="tiny muted" style="font-weight:800;letter-spacing:.05em">TIP YOUR CREW</div>' +
      '<div class="row mt">' + [0, 500, 1000, 2000].map(function (v) {
        return '<button class="btn btn--sm ' + (cart.tip_cents === v ? 'btn--primary' : '') + '" data-tip="' + v + '">' +
               (v ? UI.money(v) : 'No tip') + '</button>';
      }).join('') + '</div></div>';

    var zones = Store.zones();
    if (cart.fulfilment === 'delivery') {
      h += '<div class="card"><div class="tiny muted" style="font-weight:800;letter-spacing:.05em;margin-bottom:8px">DELIVERY AREA</div>' +
        '<div class="field"><select id="zoneSel">' +
          '<option value="">Choose your area…</option>' +
          zones.map(function (z) {
            return '<option value="' + UI.esc(z.name) + '" ' + (cart.zone === z.name ? 'selected' : '') + '>' +
              UI.esc(z.name) + ' · ' + UI.money(z.fee_cents) + ' · ' + z.eta_minutes + ' min' +
              (z.min_order_cents ? ' · min ' + UI.money(z.min_order_cents) : '') + '</option>';
          }).join('') +
        '</select></div>' +
        '<div class="field"><label>Street address</label><input id="addr1" value="' +
          UI.esc((cart.address && cart.address.line1) || '') + '" placeholder="12 Mokoena Street"></div>' +
        '<div class="field" style="margin:0"><label>Notes for the driver</label>' +
          '<input id="addrNote" value="' + UI.esc((cart.address && cart.address.notes) || '') +
          '" placeholder="Yellow container, gate on the left"></div></div>';
    } else {
      h += '<div class="card"><strong>Collection</strong>' +
        '<div class="tiny muted mt">' + UI.esc(Store.branch().address) + '</div></div>';
    }

    h += '<div class="card">' +
      '<div class="kv"><span>Subtotal</span><span>' + UI.money(t.subtotal_cents) + '</span></div>' +
      (t.delivery_fee_cents ? '<div class="kv"><span>Delivery</span><span>' + UI.money(t.delivery_fee_cents) + '</span></div>' : '') +
      (t.discount_cents ? '<div class="kv"><span>Discount</span><span>−' + UI.money(t.discount_cents) + '</span></div>' : '') +
      (t.tip_cents ? '<div class="kv"><span>Tip</span><span>' + UI.money(t.tip_cents) + '</span></div>' : '') +
      '<div class="kv"><span>VAT (15%, incl.)</span><span>' + UI.money(t.vat_cents) + '</span></div>' +
      '<div class="kv kv--total"><span>Total</span><span>' + UI.money(t.total_cents) + '</span></div>' +
      '</div>';

    h += '<div class="card">' +
      '<div class="field"><label>Name</label><input id="custName" value="' + UI.esc((cart.customer && cart.customer.name) || '') + '" placeholder="Your name"></div>' +
      '<div class="field" style="margin:0"><label>Phone (for order updates)</label><input id="custPhone" value="' + UI.esc((cart.customer && cart.customer.phone) || '') + '" placeholder="082 000 0000"></div>' +
      '</div>';

    var cap = Store.capacity();
    if (cap.full) {
      h += '<div class="card" style="border-color:var(--warn)">' +
        '<strong>Kitchen is at capacity</strong><div class="tiny muted mt">We can take your order in about ' +
        Store.settings().capacitySlotMin + ' minutes.</div></div>';
    }

    h += '<button class="btn btn--primary btn--block btn--lg mt" data-act="pay">Continue to payment</button>';
    h += '<div style="height:30px"></div></div>';

    host.innerHTML = h;

    UI.delegate(host, '[data-act="menu"]', 'click', function () { C.step = 'menu'; render(host); });
    UI.delegate(host, '[data-rm]', 'click', function (e, el) {
      Store.cartRemove(parseInt(el.getAttribute('data-rm'), 10)); render(host);
    });
    UI.delegate(host, '[data-tip]', 'click', function (e, el) {
      Store.cartSet({ tip_cents: parseInt(el.getAttribute('data-tip'), 10) }); render(host);
    });
    UI.delegate(host, '[data-act="promo"]', 'click', function () {
      var v = (host.querySelector('#promoCode') || {}).value || '';
      if (!v) return;
      if (Store.applyPromo(v.trim())) UI.toast('Promo applied');
      else UI.toast('That code does not apply');
      render(host);
    });

    var zs = host.querySelector('#zoneSel');
    if (zs) zs.addEventListener('change', function () { Store.cartSet({ zone: zs.value }); render(host); });

    keepTyped(host);

    UI.delegate(host, '[data-act="pay"]', 'click', function () {
      if (!validateDetails(host)) return;
      C.step = 'pay'; C.pay.error = ''; C.pay.processing = false;
      render(host);
    });
  }

  function validateDetails(host) {
    var cart = Store.cart();
    var t = Store.cartTotals();
    var name = (host.querySelector('#custName') || {}).value || '';
    var phone = (host.querySelector('#custPhone') || {}).value || '';
    var addr1 = (host.querySelector('#addr1') || {}).value || '';

    if (!name.trim()) { UI.toast('We need a name for the order'); return false; }
    if (phone.replace(/\D/g, '').length < 10) { UI.toast('Enter a valid phone number'); return false; }
    if (cart.fulfilment === 'delivery') {
      if (!cart.zone) { UI.toast('Choose your delivery area'); return false; }
      if (!addr1.trim()) { UI.toast('We need a street address'); return false; }
      var z = Store.zone(cart.zone);
      if (z && z.min_order_cents && t.subtotal_cents < z.min_order_cents) {
        UI.toast('Minimum for ' + z.name + ' is ' + UI.money(z.min_order_cents)); return false;
      }
    }

    var addrNote = (host.querySelector('#addrNote') || {}).value || '';
    Store.cartPeek({
      customer: { name: name.trim(), phone: phone.trim() },
      address: { line1: addr1.trim(), suburb: cart.zone || '', notes: addrNote.trim() }
    });
    Store.save();
    return true;
  }

  /* keep typed values through any re-render */
  function keepTyped(host) {
    [['#custName', 'customer', 'name'], ['#custPhone', 'customer', 'phone'],
     ['#addr1', 'address', 'line1'], ['#addrNote', 'address', 'notes']].forEach(function (t) {
      var el = host.querySelector(t[0]);
      if (!el) return;
      el.addEventListener('input', function () {
        var patch = {}, cur = Store.cart()[t[1]] || {};
        patch[t[1]] = Object.assign({}, cur);
        patch[t[1]][t[2]] = el.value;
        Store.cartPeek(patch);
      });
    });
  }

  /* ================= payment ================= */
  var BANKS = ['Capitec', 'FNB', 'Standard Bank', 'Absa', 'Nedbank', 'African Bank', 'TymeBank'];

  function renderPay(host) {
    var t = Store.cartTotals();
    var p = C.pay;

    var h = '<div class="wrap page page--narrow">' +
      '<div class="pagehead"><div><h1>Payment</h1>' +
      '<div class="sub">' + UI.money(t.total_cents) + ' · ' + UI.esc(Store.branch().short) + '</div></div>' +
      '<button class="btn btn--ghost btn--sm" data-act="back">Back</button></div>';

    /* total summary */
    h += '<div class="card">' +
      '<div class="kv"><span>Subtotal</span><span>' + UI.money(t.subtotal_cents) + '</span></div>' +
      (t.delivery_fee_cents ? '<div class="kv"><span>Delivery</span><span>' + UI.money(t.delivery_fee_cents) + '</span></div>' : '') +
      (t.discount_cents ? '<div class="kv"><span>Discount</span><span>−' + UI.money(t.discount_cents) + '</span></div>' : '') +
      (t.tip_cents ? '<div class="kv"><span>Tip</span><span>' + UI.money(t.tip_cents) + '</span></div>' : '') +
      '<div class="kv kv--total"><span>Total</span><span>' + UI.money(t.total_cents) + '</span></div></div>';

    /* method tabs */
    h += '<div class="paytabs">' +
      paytab('card', 'Card', p.method) +
      paytab('eft', 'Instant EFT', p.method) +
      paytab('cod', 'Cash on delivery', p.method) +
    '</div>';

    if (p.method === 'card') {
      h += '<div class="card">' +
        '<div class="field"><label>Card number</label>' +
          '<input id="pNum" inputmode="numeric" placeholder="4242 4242 4242 4242" value="' + UI.esc(p.card.number) + '"></div>' +
        '<div class="row" style="gap:9px">' +
          '<div class="field" style="flex:1"><label>Expiry</label>' +
            '<input id="pExp" inputmode="numeric" placeholder="MM/YY" value="' + UI.esc(p.card.exp) + '"></div>' +
          '<div class="field" style="flex:1"><label>CVV</label>' +
            '<input id="pCvv" inputmode="numeric" placeholder="123" value="' + UI.esc(p.card.cvv) + '"></div>' +
        '</div>' +
        '<div class="field" style="margin:0"><label>Name on card</label>' +
          '<input id="pName" placeholder="P MOLOI" value="' + UI.esc(p.card.name) + '"></div>' +
      '</div>';
    } else if (p.method === 'eft') {
      h += '<div class="card"><div class="field" style="margin:0"><label>Your bank</label>' +
        '<select id="pBank"><option value="">Choose your bank…</option>' +
        BANKS.map(function (b) {
          return '<option value="' + UI.esc(b) + '" ' + (p.bank === b ? 'selected' : '') + '>' + UI.esc(b) + '</option>';
        }).join('') + '</select></div>' +
        '<div class="tiny muted mt">You will be redirected to approve the payment in your banking app. ' +
        'No card details needed, and no waiting for a proof of payment.</div></div>';
    } else {
      h += '<div class="card"><strong>Pay when your order arrives</strong>' +
        '<div class="tiny muted mt">Have <strong>' + UI.money(t.total_cents) + '</strong> ready. ' +
        'Our driver carries card machines too, so you can tap on the door.</div></div>';
    }

    if (p.error) {
      h += '<div class="card" style="border-color:var(--danger)">' +
        '<div class="tiny" style="color:var(--danger)">' + UI.esc(p.error) + '</div></div>';
    }

    var label = p.method === 'cod' ? 'Place order'
              : (p.method === 'eft' ? 'Pay ' + UI.money(t.total_cents)
                                    : 'Pay ' + UI.money(t.total_cents));

    h += '<button class="btn btn--primary btn--block btn--lg mt" data-submit ' +
         (p.processing ? 'disabled' : '') + '>' +
         (p.processing ? 'Processing…' : label) + '</button>';

    h += '<div class="tiny muted mt" style="text-align:center;display:flex;align-items:center;gap:6px;justify-content:center">' +
      '<span class="tag tag--muted">Demo</span> No real money moves. Card details are not stored anywhere.</div>';

    h += '<div style="height:30px"></div></div>';
    host.innerHTML = h;

    UI.delegate(host, '[data-method]', 'click', function (e, el) {
      capturePayInputs(host);
      p.method = el.getAttribute('data-method'); p.error = '';
      render(host);
    });
    UI.delegate(host, '[data-act="back"]', 'click', function () {
      capturePayInputs(host); C.step = 'cart'; render(host);
    });
    UI.delegate(host, '[data-submit]', 'click', function () { submitPay(host); });

    var num = host.querySelector('#pNum');
    if (num) num.addEventListener('input', function () {
      var v = num.value.replace(/\D/g, '').slice(0, 16);
      num.value = v.replace(/(.{4})/g, '$1 ').trim();
    });
    var exp = host.querySelector('#pExp');
    if (exp) exp.addEventListener('input', function () {
      var v = exp.value.replace(/\D/g, '').slice(0, 4);
      exp.value = v.length > 2 ? v.slice(0, 2) + '/' + v.slice(2) : v;
    });
    var cvv = host.querySelector('#pCvv');
    if (cvv) cvv.addEventListener('input', function () {
      cvv.value = cvv.value.replace(/\D/g, '').slice(0, 4);
    });
  }

  function paytab(id, label, current) {
    return '<button class="paytab ' + (current === id ? 'is-active' : '') + '" data-method="' + id + '">' +
      '<span class="paytab__dot"></span>' + label + '</button>';
  }

  function capturePayInputs(host) {
    var g = function (id) { var e = host.querySelector(id); return e ? e.value : ''; };
    if (g('#pNum') !== undefined) {
      C.pay.card.number = g('#pNum'); C.pay.card.exp = g('#pExp');
      C.pay.card.cvv = g('#pCvv'); C.pay.card.name = g('#pName');
    }
    if (host.querySelector('#pBank')) C.pay.bank = host.querySelector('#pBank').value;
  }

  function submitPay(host) {
    capturePayInputs(host);
    var p = C.pay;

    if (p.method === 'card') {
      var digits = p.card.number.replace(/\D/g, '');
      if (digits.length !== 16) { p.error = 'Card number must be 16 digits.'; render(host); return; }
      if (!/^\d{2}\/\d{2}$/.test(p.card.exp)) { p.error = 'Enter the expiry as MM/YY.'; render(host); return; }
      var mm = parseInt(p.card.exp.slice(0, 2), 10), yy = parseInt(p.card.exp.slice(3), 10);
      if (mm < 1 || mm > 12) { p.error = 'That month is not valid.'; render(host); return; }
      if (p.card.cvv.replace(/\D/g, '').length < 3) { p.error = 'CVV must be 3 or 4 digits.'; render(host); return; }
      if (!p.card.name.trim()) { p.error = 'Enter the name on the card.'; render(host); return; }
    } else if (p.method === 'eft') {
      if (!p.bank) { p.error = 'Choose your bank.'; render(host); return; }
    }

    p.error = '';
    p.processing = true;
    render(host);

    /* Simulated gateway round-trip. Swap this one call for the real PSP. */
    setTimeout(function () {
      var cart = Store.cart();
      /* Order of operations matters. Place the order WITHOUT notifying,
         point the UI at the tracking step, then emit once. Notifying first
         would render against a container that is about to be replaced. */
      var o = Store.placeOrder({
        customer: cart.customer,
        address: cart.fulfilment === 'delivery' ? cart.address : null,
        payment_method: p.method
      }, { silent: true });
      C.step = 'track';
      C.tracking = o.id;
      /* card details never leave this object and are dropped immediately */
      C.pay.card = { number: '', exp: '', cvv: '', name: '' };
      C.pay.bank = '';
      C.pay.processing = false;
      Store.emit();
      UI.toast(p.method === 'cod' ? 'Order ' + o.code + ' placed' : 'Payment approved · ' + o.code);
    }, p.method === 'cod' ? 200 : 1200);
  }

  /* ================= tracking ================= */
  function renderTrack(host) {
    var o = Store.order(C.tracking);
    if (!o) { C.step = 'landing'; render(host); return; }
    var flow = o.fulfilment === 'pickup' ? Store.CUSTOMER_FLOW_PICKUP : Store.CUSTOMER_FLOW_DELIVERY;
    var idx = flow.indexOf(o.status);
    if (idx < 0 && ['ASSIGNED', 'PICKED_UP'].indexOf(o.status) > -1) idx = 3;
    var prep = o.items.reduce(function (m, l) { return Math.max(m, l.prep_time_min || 10); }, 10);
    var zoneEta = o.zone && Store.zone(o.zone) ? Store.zone(o.zone).eta_minutes : 20;
    var totalMins = o.fulfilment === 'pickup' ? prep : prep + zoneEta;
    var done = ['DELIVERED', 'COLLECTED', 'COMPLETED'].indexOf(o.status) > -1;

    var h = '<div class="wrap page page--narrow">';
    h += '<div class="card" style="text-align:center;padding:22px">' +
      '<div class="tiny muted" style="letter-spacing:.09em;font-weight:800">ORDER</div>' +
      '<div style="font-family:var(--display);font-size:30px;margin:4px 0">' + o.code + '</div>' +
      (done ? '<span class="tag tag--ready">Done</span>'
            : '<span class="tag tag--prep">Arriving ~' + UI.eta(o.created_at, totalMins) + '</span>') +
    '</div>';

    h += '<div class="card mt"><div class="steps">';
    flow.forEach(function (s, i) {
      var cls = i < idx ? 'step is-done' : (i === idx ? 'step is-current' : 'step is-pending');
      h += '<li class="' + cls + '"><span class="dot"></span><div>' +
        '<div class="step__t">' + Store.STATUS[s].customer + '</div>' +
        '<div class="step__d">' +
          (i <= idx ? UI.clock(o.created_at + i * Math.round(totalMins / flow.length) * 60000) : 'pending') +
        '</div></div></li>';
    });
    h += '</div></div>';

    if (o.driver_id) {
      var d = Store.drivers().find(function (x) { return x.id === o.driver_id; });
      if (d) {
        h += '<div class="card mt"><div class="row row--between">' +
          '<div><strong>' + UI.esc(d.name) + '</strong><div class="tiny muted">Your driver</div></div>' +
          '<a class="btn btn--sm" href="tel:' + d.phone.replace(/\s/g, '') + '">Call</a></div></div>';
      }
    }

    h += '<div class="card mt"><div class="tiny muted" style="font-weight:800;letter-spacing:.05em;margin-bottom:8px">YOUR ORDER</div>';
    o.items.forEach(function (l) {
      h += '<div class="line"><div class="line__body"><div class="line__name">' + l.qty + '× ' + UI.esc(l.name) + '</div>' +
        (l.options.length ? '<div class="line__opts">' + l.options.map(function (x) { return UI.esc(x.option); }).join(' · ') + '</div>' : '') +
        '</div><div class="line__right">' + UI.money(l.unit_price_cents * l.qty) + '</div></div>';
    });
    h += '<div class="kv kv--total"><span>' +
      (o.payment_method === 'cod' ? 'Pay on delivery' : 'Paid') + '</span><span>' +
      UI.money(o.total_cents) + '</span></div></div>';

    h += '<button class="btn btn--block mt" data-act="new">Back to the Box</button>';
    h += '<div style="height:30px"></div></div>';

    host.innerHTML = h;
    UI.delegate(host, '[data-act="new"]', 'click', function () {
      C.step = 'landing'; C.tracking = null; render(host);
    });
  }

  /* ================= router ================= */
  function render(host) {
    if (C.step === 'landing') renderLanding(host);
    else if (C.step === 'cart') renderCart(host);
    else if (C.step === 'pay') renderPay(host);
    else if (C.step === 'track') renderTrack(host);
    else renderList(host);
  }

  global.CustomerView = { render: render, state: C };
})(window);
