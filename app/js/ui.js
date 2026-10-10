/* ============================================================
   ui.js — shared helpers. No framework, no dependencies.
   ============================================================ */
(function (global) {
  'use strict';

  var toastTimer = null;

  var UI = {
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    /* Integer cents in, "R 94.99" out. Never a float in between. */
    money: function (cents) {
      var n = Math.round(cents || 0);
      var sign = n < 0 ? '-' : '';
      n = Math.abs(n);
      return sign + 'R ' + Math.floor(n / 100).toLocaleString('en-ZA') + '.' +
             String(n % 100).padStart(2, '0');
    },

    clock: function (ts) {
      var d = new Date(ts);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },

    ago: function (ts) {
      var m = Math.floor((Date.now() - ts) / 60000);
      if (m < 1) return 'just now';
      if (m < 60) return m + ' min ago';
      var h = Math.floor(m / 60);
      return h + 'h ' + (m % 60) + 'm ago';
    },

    eta: function (ts, mins) {
      var d = new Date(ts + mins * 60000);
      return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    },

    toast: function (msg, ms) {
      var el = document.getElementById('toast');
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.hidden = true; }, ms || 2200);
    },

    /* ---- modal ----
       The sheet node is recreated on every open, so listeners bound
       inside onMount can never accumulate across opens. */
    open: function (opts) {
      var m = document.getElementById('modal');
      var sheet = document.createElement('div');
      sheet.className = 'sheet';
      sheet.innerHTML =
        '<div class="sheet__head">' +
          '<div><h3 style="font-size:17px">' + UI.esc(opts.title || '') + '</h3>' +
          (opts.sub ? '<div class="sub">' + UI.esc(opts.sub) + '</div>' : '') + '</div>' +
          '<button class="iconbtn" data-close>&times;</button>' +
        '</div>' +
        '<div class="sheet__body">' + (opts.body || '') + '</div>' +
        (opts.footer ? '<div class="sheet__foot">' + opts.footer + '</div>' : '');
      m.replaceChildren(sheet);
      m.hidden = false;
      m.onclick = function (e) {
        if (e.target === m || e.target.hasAttribute('data-close')) UI.close();
      };
      if (opts.onMount) opts.onMount(sheet);
      return sheet;
    },

    close: function () {
      var m = document.getElementById('modal');
      m.hidden = true;
      m.innerHTML = '';
    },

    /* ---- audio alert (Web Audio, no asset needed) ---- */
    _ctx: null,
    beep: function (times) {
      try {
        if (!UI._ctx) UI._ctx = new (window.AudioContext || window.webkitAudioContext)();
        var ctx = UI._ctx;
        if (ctx.state === 'suspended') ctx.resume();
        var n = times || 2;
        for (var i = 0; i < n; i++) {
          var o = ctx.createOscillator(), g = ctx.createGain();
          o.type = 'square';
          o.frequency.value = 880;
          g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.22);
          g.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + i * 0.22 + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.22 + 0.18);
          o.connect(g); g.connect(ctx.destination);
          o.start(ctx.currentTime + i * 0.22);
          o.stop(ctx.currentTime + i * 0.22 + 0.2);
        }
      } catch (e) { /* audio is a nicety, never a failure */ }
    },

    /* flash an element to draw the eye in a demo */
    flash: function (el) {
      if (!el) return;
      el.classList.add('ocard--flash');
      setTimeout(function () { el.classList.remove('ocard--flash'); }, 1100);
    },

    delegate: function (root, selector, event, fn) {
      root.addEventListener(event, function (e) {
        var t = e.target.closest(selector);
        if (t && root.contains(t)) fn(e, t);
      });
    }
  };

  global.UI = UI;
})(window);
