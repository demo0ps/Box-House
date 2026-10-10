/* ============================================================
   data.js — loads menu + theme, with an embedded fallback so the
   app still runs if fetch fails (e.g. opened straight off disk).
   ============================================================ */
(function (global) {
  'use strict';

  var FALLBACK_MENU = {
    restaurant: {
      name: 'The Box House', trading_as: 'Eat4less',
      tagline: 'One smile. One adventure. One family at a time',
      tagline_commercial: 'Eat 4 Less With The Cheaper Price',
      instagram: '@the_boxhouse_', instagram_url: 'https://instagram.com/the_boxhouse_',
      currency: 'ZAR', vat_rate: 0.15, prices_include_vat: true,
      hero_image: 'hero-container.jpg',
      story: {
        heading: 'Built out of a container. Built for the kasi.',
        body: ['The Box House started in Tembisa with one shipping container, one grill and one idea.',
               'One smile. One adventure. One family at a time.']
      }
    },
    branches: [
      { code: 'TEM', name: 'The Box House Tembisa', short: 'Tembisa',
        address: '268 Bram Masuku Street, Igqagqa, Tembisa', city: 'Tembisa',
        is_original: true, blurb: 'Where it started. The original container.' },
      { code: 'GRK', name: 'The Box House Ga-Rankuwa', short: 'Ga-Rankuwa',
        address: 'Zone 2, next to Cassandra Park, Ga-Rankuwa', city: 'Pretoria',
        is_original: false, blurb: 'Bigger space, bigger events.' }
    ],
    delivery_zones: [
      { branch: 'TEM', name: 'Igqagqa', fee_cents: 2000, min_order_cents: 8000, eta_minutes: 25 },
      { branch: 'TEM', name: 'Tembisa Central', fee_cents: 2500, min_order_cents: 10000, eta_minutes: 30 },
      { branch: 'GRK', name: 'Zone 2', fee_cents: 2000, min_order_cents: 8000, eta_minutes: 25 }
    ],
    hours_assumed: true,
    hours: [
      { day: 'Monday', open: '11:00', close: '22:00' },
      { day: 'Friday', open: '11:00', close: '01:00' },
      { day: 'Saturday', open: '11:00', close: '01:00' },
      { day: 'Sunday', open: '12:00', close: '21:00' }
    ],
    categories: [
      { id: 'smash', name: 'Smash Burgers', sort: 1, image: 'smash-burger.jpg' },
      { id: 'chopped', name: 'Chopped Sandwiches', sort: 2, image: 'chopped-sandwich.jpg' },
      { id: 'combos', name: 'Combos & Sharing', sort: 3, image: 'family-spread.jpg' }
    ],
    option_groups: {
      patty: { name: 'Patties', selection_type: 'single', is_required: true, options: [
        { name: 'Single', price_delta_cents: 0 }, { name: 'Double', price_delta_cents: 2500 } ] },
      addons: { name: 'Load it up', selection_type: 'multi', min_select: 0, max_select: 6, options: [
        { name: 'Bacon', price_delta_cents: 1800 }, { name: 'Extra cheese', price_delta_cents: 1200 } ] }
    },
    items: [
      { id: 'smash-burger', category: 'smash', name: 'Smash Burger',
        description: 'The one that built the Box.', base_price_cents: 5999, prep_time_min: 10,
        is_signature: true, image: 'smash-burger.jpg', groups: ['patty', 'addons'] },
      { id: 'bacon-smash', category: 'smash', name: 'Bacon Smash Burger',
        description: 'Smashed patty, streaky bacon, double cheese.', base_price_cents: 9499,
        prep_time_min: 14, is_signature: true, image: 'smash-burger.jpg', groups: ['patty', 'addons'] },
      { id: 'og-grilled-cheese', category: 'chopped', name: 'OG Chopped Grilled Cheese',
        description: 'The original. Chopped, griddled, molten cheese.', base_price_cents: 6250,
        prep_time_min: 10, is_signature: true, image: 'chopped-sandwich.jpg', groups: ['addons'] }
    ]
  };

  var FALLBACK_THEME = {
    theme: {
      mode: 'brand',
      modes: {
        brand: { bg:'#0A0A0A', surface:'#141414', surface_2:'#1E1E1E', border:'#2A2A2A',
          text:'#F5F1E8', text_muted:'#9A9488', primary:'#FFD100', primary_text:'#0A0A0A',
          accent:'#E4572E', success:'#2E9E5B', warn:'#E8A33D', danger:'#D64545' }
      }
    }
  };

  function getJSON(url) {
    return fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); });
  }

  var Data = {
    menu: null,
    theme: null,

    load: function () {
      /* Embedded data first: works in sandboxed frames where fetch() is blocked. */
      if (global.BOX_EMBEDDED && global.BOX_EMBEDDED.menu) {
        Data.menu = global.BOX_EMBEDDED.menu;
        Data.theme = global.BOX_EMBEDDED.theme || FALLBACK_THEME;
        Data.applyTheme(Data.theme);
        return Promise.resolve(Data);
      }
      var menuP = getJSON('../data/seed/menu.json').catch(function (e) {
        console.warn('menu.json unavailable, using fallback:', e.message);
        return FALLBACK_MENU;
      });
      var themeP = getJSON('../assets/brand/theme.json').catch(function () {
        return FALLBACK_THEME;
      });
      return Promise.all([menuP, themeP]).then(function (res) {
        Data.menu = res[0];
        Data.theme = res[1];
        Data.applyTheme(res[1]);
        return Data;
      });
    },

    /* Paint the CSS custom properties from the chosen theme mode. */
    applyTheme: function (theme) {
      var mode = (theme.theme && theme.theme.mode) || 'brand';
      var modes = (theme.theme && theme.theme.modes) || {};
      var t = modes[mode] || modes.brand || {};
      var root = document.documentElement;
      var map = {
        '--bg': t.bg, '--surface': t.surface, '--surface-2': t.surface_2,
        '--border': t.border, '--text': t.text, '--muted': t.text_muted,
        '--primary': t.primary, '--primary-text': t.primary_text,
        '--accent': t.accent, '--success': t.success, '--warn': t.warn, '--danger': t.danger
      };
      Object.keys(map).forEach(function (k) {
        if (map[k]) root.style.setProperty(k, map[k]);
      });
      if (theme.typography) {
        if (theme.typography.display) root.style.setProperty('--display', theme.typography.display);
        if (theme.typography.body) root.style.setProperty('--body', theme.typography.body);
      }
      if (theme.shape && theme.shape.radius) root.style.setProperty('--r', theme.shape.radius);
    },

    setMode: function (mode) {
      if (!Data.theme) return;
      Data.theme.theme.mode = mode;
      Data.applyTheme(Data.theme);
    }
  };

  global.Data = Data;
})(window);
