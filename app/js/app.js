/* ============================================================
   app.js — boot, routing, and the split-screen demo mode.

   Every render swaps in a FRESH container, so delegated listeners
   can never accumulate on a node that outlives its content.
   ============================================================ */
(function (global) {
  'use strict';

  var VIEWS = {
    store:    function () { return global.CustomerView; },
    customer: function () { return global.CustomerView; },
    kitchen:  function () { return global.KitchenView; },
    dispatch: function () { return global.DispatchView; },
    driver:   function () { return global.DriverView; },
    admin:    function () { return global.AdminView; }
  };

  var App = {
    current: 'store',
    hosts: {},
    knownOrders: {},
    splitBuilt: false,

    boot: function () {
      return global.Data.load().then(function () {
        global.Store.init();
        App.snapshotOrders();
        App.bindChrome();
        App.route();
        global.addEventListener('hashchange', App.route);
        global.Store.sub(function () { App.onChange(); });
        setInterval(function () { App.render(); }, 30000);
      });
    },

    snapshotOrders: function () {
      App.knownOrders = {};
      global.Store.orders().forEach(function (o) { App.knownOrders[o.id] = o.status; });
    },

    bindChrome: function () {
      document.getElementById('roles').addEventListener('click', function (e) {
        var b = e.target.closest('[data-view]');
        if (b) location.hash = b.getAttribute('data-view');
      });
      document.getElementById('resetBtn').addEventListener('click', function () {
        if (confirm('Clear all demo orders and reseed?')) {
          global.Store.reset();
          App.snapshotOrders();
          UI.toast('Demo data reset');
        }
      });
      /* browsers block audio until the user interacts - unlock it early */
      document.addEventListener('click', function once() {
        try { UI.beep(0); } catch (e) {}
        document.removeEventListener('click', once);
      });
    },

    route: function () {
      var v = (location.hash || '').replace('#', '');
      App.current = (v === 'split' || VIEWS[v]) ? v : 'store';
      Array.prototype.forEach.call(document.querySelectorAll('.role'), function (b) {
        b.classList.toggle('is-active', b.getAttribute('data-view') === App.current);
      });
      App.render();
    },

    /* Render into a brand-new child node. Old listeners die with the old node. */
    renderInto: function (parent, fn) {
      var fresh = document.createElement('div');
      fresh.className = 'pane-inner';
      fn(fresh);
      parent.replaceChildren(fresh);
      return fresh;
    },

    render: function () {
      var host = document.getElementById('view');

      if (App.current === 'split') {
        if (!App.splitBuilt) { App.buildSplit(host); App.splitBuilt = true; }
        App.renderInto(App.hosts.main, global.CustomerView.render);
        App.renderInto(App.hosts.kitchen, global.KitchenView.render);
        return;
      }

      App.splitBuilt = false;
      host.replaceChildren();
      /* a render error must be visible, never a silent fallback */
      var pane = document.createElement('div');
      pane.className = 'pane';
      host.appendChild(pane);
      App.hosts = { main: pane };
      try {
        App.renderInto(pane, VIEWS[App.current]().render);
      } catch (e) {
        console.error(e);
        pane.innerHTML = '<div class="empty"><h3>This view failed to load</h3>' +
          '<p class="muted">' + UI.esc(e.message) + '</p></div>';
      }
    },

    /* The money shot: customer phone and kitchen side by side, so you can
       place an order and watch it land without switching tabs. */
    buildSplit: function (host) {
      host.replaceChildren();
      var wrap = document.createElement('div');
      wrap.className = 'split';
      wrap.innerHTML =
        '<div class="split__left">' +
          '<div style="width:100%;max-width:372px">' +
            '<div class="split__label">Customer &middot; phone</div>' +
            '<div class="phone"><div class="phone__screen" id="paneCustomer"></div></div>' +
            '<div class="tiny muted" style="text-align:center;margin-top:9px">' +
              'Place an order here &rarr; watch it land on the kitchen screen</div>' +
          '</div>' +
        '</div>' +
        '<div class="split__right">' +
          '<div class="split__label">Kitchen console</div>' +
          '<div class="pane" id="paneKitchen"></div>' +
        '</div>';
      host.appendChild(wrap);
      App.hosts = {
        main: wrap.querySelector('#paneCustomer'),
        kitchen: wrap.querySelector('#paneKitchen')
      };
    },

    /* Any store change: re-render, and alert the kitchen to new orders. */
    onChange: function () {
      var fresh = [];
      var seen = {};
      global.Store.orders().forEach(function (o) {
        seen[o.id] = o.status;
        if (!App.knownOrders[o.id]) fresh.push(o);
      });
      App.knownOrders = seen;

      App.render();

      if (fresh.length) {
        UI.beep(2);
        UI.toast('New order ' + fresh[0].code);
        fresh.forEach(function (o) {
          UI.flash(document.querySelector('[data-order="' + o.id + '"]'));
        });
      }
    }
  };

  global.App = App;

  document.addEventListener('DOMContentLoaded', function () {
    App.boot().catch(function (e) {
      console.error(e);
      /* A bad saved state is the usual cause. Offer a one-click reset
         instead of a dead end. */
      document.getElementById('view').innerHTML =
        '<div class="empty"><h3>Could not start</h3>' +
        '<p class="muted">' + UI.esc(e.message) + '</p>' +
        '<button class="btn btn--primary mt" id="hardReset">Reset demo and reload</button></div>';
      document.getElementById('hardReset').addEventListener('click', function () {
        try { localStorage.removeItem('boxhouse.state.v1'); } catch (x) {}
        location.reload();
      });
    });
  });
})(window);
