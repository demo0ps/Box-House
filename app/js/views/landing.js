/* ============================================================
   landing.js — the storefront. This is what a customer lands on
   before they order: brand, branches, food, hours.
   ============================================================ */
(function (global) {
  'use strict';

  function img(name) { return '../assets/food/' + name; }
  function thumb(name) {
    if (!name) return '';
    return name.replace(/\.jpg$/, '-thumb.jpg');
  }

  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* Open/closed from the hours table. Township spots trade late, so this
     has to handle a close time that crosses midnight. */
  function openNow() {
    var hours = global.Data.menu.hours || [];
    var now = new Date();
    var today = DAYS[now.getDay()];
    var yesterday = DAYS[(now.getDay() + 6) % 7];
    var mins = now.getHours() * 60 + now.getMinutes();

    function toMins(t) { var p = t.split(':'); return (+p[0]) * 60 + (+p[1]); }

    var todayRow = hours.find(function (h) { return h.day === today; });
    var yestRow = hours.find(function (h) { return h.day === yesterday; });

    if (todayRow) {
      var o = toMins(todayRow.open), c = toMins(todayRow.close);
      if (c <= o) c += 24 * 60;                       // closes after midnight
      if (mins >= o && mins < c) return { open: true, until: todayRow.close };
      if (mins < o) return { open: false, next: today + ' ' + todayRow.open };
    }
    if (yestRow) {
      var yo = toMins(yestRow.open), yc = toMins(yestRow.close);
      if (yc <= yo) yc += 24 * 60;
      if (mins < yc - 24 * 60) return { open: true, until: yestRow.close };
    }
    return { open: false, next: null };
  }

  /* "Fri 23 Oct · 21:00" in Johannesburg time, whatever the viewer's zone. */
  function fmtWhen(iso) {
    try {
      var d = new Date(iso);
      var day = new Intl.DateTimeFormat('en-ZA', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Africa/Johannesburg' }).format(d);
      var time = new Intl.DateTimeFormat('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Johannesburg' }).format(d);
      return day + ' · ' + time;
    } catch (e) { return new Date(iso).toLocaleString(); }
  }

  /* Sections fade up as they enter the screen. Without IntersectionObserver
     (or with reduced motion) everything is simply visible. */
  function revealOnScroll(host) {
    var els = host.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
      Array.prototype.forEach.call(els, function (el) { el.classList.add('is-in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { root: host.closest('.pane') || null, threshold: 0.12 });
    Array.prototype.forEach.call(els, function (el) { io.observe(el); });
  }

  function render(host, actions) {
    var m = global.Data.menu;
    var r = m.restaurant;
    var status = openNow();
    var current = global.Store.settings().branchCode;
    var branch = global.Store.branch();

    var h = '';

    /* ---------- hero ---------- */
    h += '<div class="hero">' +
      '<img class="hero__img" src="' + img(r.hero_image) + '" alt="">' +
      '<div class="hero__scrim"></div>' +
      '<div class="hero__body">' +
        '<div class="hero__row">' +
          '<img class="hero__mark" src="../assets/brand/logo-512.png" alt="">' +
          '<span class="tag ' + (status.open ? 'tag--ready' : 'tag--muted') + '">' +
            (status.open ? 'Open · until ' + status.until : 'Closed' +
              (status.next ? ' · opens ' + status.next : '')) + '</span>' +
        '</div>' +
        '<div class="burst" aria-hidden="true"><span>THE CHEAPER<br>PRICE</span></div>' +
        '<div class="hero__title">EAT 4 LESS</div>' +
        '<div class="hero__sub">' + UI.esc(r.tagline) + '</div>' +
        '<div class="hero__actions">' +
          '<button class="btn btn--primary btn--lg" data-start>Order now</button>' +
          '<button class="btn btn--lg" data-start>View menu</button>' +
        '</div>' +
        '<div class="hero__where">Collecting from <strong>' + UI.esc(branch.short) + '</strong> · ' +
          UI.esc(branch.address) + '</div>' +
      '</div>' +
    '</div>';

    /* ---------- brand ticker ---------- */
    var words = ['EAT 4 LESS', 'SMASH BURGERS', 'ONE SMILE', 'ONE ADVENTURE', 'ONE FAMILY', 'EAT 4 LESS', 'THE CHEAPER PRICE', 'TEMBISA', 'GA-RANKUWA'];
    var strip = words.map(function (w) { return '<span>' + w + '</span><i>&#9733;</i>'; }).join('');
    h += '<div class="ticker" aria-hidden="true"><div class="ticker__track">' + strip + strip + '</div></div>';

    /* ---------- tonight banner ---------- */
    var special = m.items.find(function (i) { return i.id === 'family-meal-1'; });
    h += '<div class="tonight reveal">' +
      '<div><div class="tonight__k">' + (status.open ? 'Open now · until ' + status.until : 'Closed right now') + '</div>' +
      '<div class="tonight__t">Tonight at ' + UI.esc(branch.short) + '</div></div>' +
      (special ? '<div class="tonight__s"><span class="tag tag--new">Demo special</span> ' +
        '<strong>' + UI.esc(special.name) + '</strong> ' + UI.money(special.base_price_cents) + '</div>' : '') +
      '<button class="btn btn--primary" data-start>Order now</button></div>';

    /* ---------- events (admin-published; hidden when none are upcoming) ---------- */
    var evs = global.Store.upcomingEvents();
    if (evs.length) {
      h += '<div class="sect reveal events"><div class="sect__h"><h2>Nights &amp; events</h2>' +
        '<span class="tiny muted">Tickets link out to the ticket seller</span></div><div class="evgrid">';
      evs.slice(0, 6).forEach(function (ev) {
        var when = fmtWhen(ev.starts_at);
        var thumb = ev.image ? '../assets/events/' + ev.image.replace(/\.jpg$/, '-thumb.jpg') : '';
        h += '<article class="evcard">' +
          (thumb ? '<img class="evcard__img" src="' + thumb + '" alt="" loading="lazy">' : '') +
          '<div class="evcard__scrim"></div>' +
          '<div class="evcard__body">' +
            '<span class="evcard__kind">' + UI.esc(ev.kind) + '</span>' +
            '<h3 class="evcard__t">' + UI.esc(ev.title) + '</h3>' +
            '<div class="evcard__when">' + UI.esc(when) + '</div>' +
            '<div class="evcard__where">' + UI.esc(ev.venue) + '</div>' +
            '<p class="evcard__d">' + UI.esc(ev.blurb) + '</p>' +
            (ev.ticket_url ? '<a class="btn btn--primary btn--sm" href="' + UI.esc(ev.ticket_url) +
              '" target="_blank" rel="noopener">' + UI.esc(ev.ticket_label || 'Get tickets') + ' &rarr;</a>' : '') +
          '</div></article>';
      });
      h += '</div></div>';
    }

    /* ---------- choose branch ---------- */
    h += '<div class="wrap"><div class="sect">' +
      '<div class="sect__h"><h2>Choose your Box</h2>' +
      '<span class="tiny muted">Menu and delivery areas follow your branch</span></div>' +
      '<div class="branchgrid">';
    m.branches.forEach(function (b) {
      var on = b.code === current;
      h += '<button class="branchcard ' + (on ? 'is-on' : '') + '" data-branch="' + b.code + '">' +
        (b.is_original ? '<span class="tag tag--new">The original</span>' : '') +
        '<div class="branchcard__name">' + UI.esc(b.short) + '</div>' +
        '<div class="branchcard__blurb">' + UI.esc(b.blurb) + '</div>' +
        '<div class="branchcard__addr">' + UI.esc(b.address) + '</div>' +
        '<div class="branchcard__cta">' + (on ? 'Ordering from here &rarr;' : 'Order from here') + '</div>' +
      '</button>';
    });
    h += '</div></div>';

    /* ---------- signature ---------- */
    var sig = m.items.filter(function (i) { return i.is_signature; }).slice(0, 3);
    h += '<div class="sect reveal"><div class="sect__h"><h2>The ones people come back for</h2></div>' +
      '<div class="siggrid">';
    sig.forEach(function (i) {
      var out = global.Store.isSoldOut(i.id);
      h += '<div class="sigcard">' +
        '<img class="sigcard__img" src="' + img(thumb(i.image)) + '" alt="' + UI.esc(i.name) + '" loading="lazy">' +
        '<div class="sigcard__body">' +
          '<div class="sigcard__name">' + UI.esc(i.name) + '</div>' +
          '<div class="sigcard__desc">' + UI.esc(i.description) + '</div>' +
          '<div class="row row--between mt">' +
            '<span class="pricetag">' + UI.money(i.base_price_cents) + '</span>' +
            (out ? '<span class="tag tag--muted">Sold out</span>'
                 : '<button class="btn btn--primary btn--sm" data-quick="' + i.id + '">Add</button>') +
          '</div>' +
        '</div></div>';
    });
    h += '</div></div>';

    /* ---------- how it works ---------- */
    h += '<div class="sect reveal"><div class="sect__h"><h2>How it works</h2>' +
      '<span class="tiny muted">Four steps. No app to download.</span></div><div class="steps4">' +
      [['1','Pick your Box','Tembisa or Ga-Rankuwa. Your menu follows your branch.'],
       ['2','Build it your way','Patties, add-ons, sides. Tap and it is in your box.'],
       ['3','Pay how you like','Card, instant EFT or cash on delivery.'],
       ['4','Track it live','Watch it go from the kitchen to your door.']]
        .map(function (x) {
          return '<div class="stepcard"><div class="stepcard__n">' + x[0] + '</div>' +
            '<div class="stepcard__t">' + x[1] + '</div><div class="stepcard__d">' + x[2] + '</div></div>';
        }).join('') +
      '</div></div>';

    /* ---------- story ---------- */
    h += '<div class="sect story reveal">' +
      '<h2>' + UI.esc(r.story.heading) + '</h2>';
    r.story.body.forEach(function (p) { h += '<p>' + UI.esc(p) + '</p>'; });
    h += '</div>';

    /* ---------- follow the box: poster-style link to Instagram ---------- */
    var feedItems = (global.BOX_INSTAGRAM && global.BOX_INSTAGRAM.items) || [];
    h += '<div class="sect reveal"><a class="followband" href="' + UI.esc(r.instagram_url) +
      '" target="_blank" rel="noopener">' +
      '<div class="followband__k">Tag us. Get featured.</div>' +
      '<div class="followband__t">Follow ' + UI.esc(r.instagram) + '</div>' +
      '<div class="followband__s">Street food, late nights and everything in between. Scroll the feed &rarr;</div>' +
      '</a></div>';

    /* ---------- from the feed (only when the client has approved Instagram sync) ---------- */
    var feed = (global.BOX_INSTAGRAM && global.BOX_INSTAGRAM.items) || [];
    if (feed.length) {
      h += '<div class="sect"><div class="sect__h"><h2>From the feed</h2>' +
        '<a class="tiny" href="' + UI.esc(r.instagram_url) + '" target="_blank" rel="noopener">' +
        UI.esc(r.instagram) + ' &rarr;</a></div><div class="feedgrid">';
      feed.slice(0, 6).forEach(function (f) {
        h += '<a class="feedtile" href="' + UI.esc(f.permalink || r.instagram_url) + '" target="_blank" rel="noopener">' +
          '<img src="../' + UI.esc(f.file) + '" alt="' + UI.esc((f.caption || '').slice(0, 80)) + '" loading="lazy"></a>';
      });
      h += '</div></div>';
    }

    /* ---------- menu at a glance: photo carousel ---------- */
    h += '<div class="sect reveal"><div class="sect__h"><h2>Menu at a glance</h2>' +
      '<span class="tiny muted">Swipe &rarr;</span></div><div class="glance">';
    m.items.forEach(function (i) {
      var t = i.image ? img(thumb(i.image)) : '';
      h += '<button class="glance__card" data-quick="' + i.id + '"' + (global.Store.isSoldOut(i.id) ? ' disabled' : '') + '>' +
        (t ? '<img src="' + t + '" alt="" loading="lazy">' : '') +
        '<div class="glance__b"><div class="glance__n">' + UI.esc(i.name) + '</div>' +
        '<span class="pricetag">' + UI.money(i.base_price_cents) + '</span></div></button>';
    });
    h += '</div></div>';

    /* ---------- full menu teaser ---------- */
    h += '<div class="sect reveal"><div class="sect__h"><h2>The full menu</h2></div>' +
      '<div class="catgrid">';
    m.categories.filter(function (c) { return c.image; }).forEach(function (c) {
      var n = m.items.filter(function (i) { return i.category === c.id; }).length;
      h += '<button class="catcard" data-start>' +
        '<img src="' + img(thumb(c.image)) + '" alt="" loading="lazy">' +
        '<div class="catcard__body"><div class="catcard__name">' + UI.esc(c.name) + '</div>' +
        '<div class="tiny muted">' + n + ' item' + (n === 1 ? '' : 's') + '</div></div></button>';
    });
    h += '</div></div>';

    /* ---------- hours + branches ---------- */
    h += '<div class="sect reveal"><div class="sect__h"><h2>Find us</h2>' +
      (m.hours_assumed ? '<span class="tiny" style="color:var(--warn)">Hours are placeholders — to confirm</span>' : '') +
      '</div><div class="two">';

    h += '<div class="card"><div class="tiny muted" style="font-weight:800;letter-spacing:.05em;margin-bottom:8px">TRADING HOURS</div>';
    (m.hours || []).forEach(function (x) {
      var isToday = DAYS[new Date().getDay()] === x.day;
      h += '<div class="kv"' + (isToday ? ' style="color:var(--primary)"' : '') + '>' +
        '<span>' + (isToday ? '<strong>' + x.day + '</strong>' : x.day) + '</span>' +
        '<span>' + x.open + ' – ' + x.close + '</span></div>';
    });
    h += '</div><div class="card">';
    m.branches.forEach(function (b) {
      h += '<div style="margin-bottom:12px"><div style="font-weight:800">' + UI.esc(b.short) + '</div>' +
        '<div class="tiny muted">' + UI.esc(b.address) + '</div></div>';
    });
    h += '<a class="btn btn--block" href="' + UI.esc(r.instagram_url) + '" target="_blank" rel="noopener">' +
      UI.esc(r.instagram) + '</a></div>';

    h += '</div></div>';

    /* ---------- footer ---------- */
    h += '<footer class="foot">' +
      '<img class="foot__mark" src="../assets/brand/logo-512.png" alt="">' +
      '<div class="foot__brand">' + UI.esc(r.name).toUpperCase() + '</div>' +
      '<div class="foot__tag">' + UI.esc(r.tagline_commercial) + '</div>' +
      '<div class="foot__tag" style="margin-top:6px">' + UI.esc(r.tagline) + '</div>' +
      '<div class="foot__fine">Demo storefront · no real payments are taken</div>' +
    '</footer></div>';

    host.innerHTML = h;
    revealOnScroll(host);

    UI.delegate(host, '[data-start]', 'click', function () { actions.onStart(); });
    UI.delegate(host, '[data-branch]', 'click', function (e, el) {
      actions.onBranch(el.getAttribute('data-branch'));
    });
    UI.delegate(host, '[data-quick]', 'click', function (e, el) {
      actions.onQuickAdd(el.getAttribute('data-quick'));
    });
  }

  global.LandingView = { render: render, openNow: openNow };
})(window);
