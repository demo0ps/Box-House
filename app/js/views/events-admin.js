/* ============================================================
   events-admin.js — the events card inside Back office.
   Staff add an event, choose whether it is live, and paste the
   ticket link. Nothing here takes payment; tickets sell elsewhere.
   ============================================================ */
(function (global) {
  'use strict';

  var KINDS = ['Club night', 'Artist night', 'Lifestyle', 'Launch', 'Block party'];
  var IMAGES = [
    { file: 'club-crowd.jpg', label: 'Club crowd' },
    { file: 'dj-booth.jpg', label: 'DJ booth' },
    { file: 'block-party.jpg', label: 'Block party' }
  ];

  var editing = null;   // id of the event being edited, or null for a new one

  /* datetime-local ("2026-10-23T21:00") -> ISO in SAST (+02:00, no DST in SA) */
  function toIso(local) { return local ? local + ':00+02:00' : ''; }
  function toLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var p = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Africa/Johannesburg'
    }).formatToParts(d).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
    return p.year + '-' + p.month + '-' + p.day + 'T' + (p.hour === '24' ? '00' : p.hour) + ':' + p.minute;
  }

  function fieldRow(label, html) {
    return '<div class="field"><label>' + label + '</label>' + html + '</div>';
  }

  function formHtml(ev) {
    ev = ev || {};
    var branches = global.Data.menu.branches;
    var kindOpts = KINDS.map(function (k) {
      return '<option ' + (ev.kind === k ? 'selected' : '') + '>' + k + '</option>';
    }).join('');
    var branchOpts = branches.map(function (b) {
      return '<option value="' + b.code + '" ' + (ev.branch === b.code ? 'selected' : '') + '>' + UI.esc(b.short) + '</option>';
    }).join('');
    var imgOpts = '<option value="">No image</option>' + IMAGES.map(function (i) {
      return '<option value="' + i.file + '" ' + (ev.image === i.file ? 'selected' : '') + '>' + i.label + '</option>';
    }).join('');

    return '<form id="evForm" class="evform">' +
      '<div class="tiny muted" style="font-weight:800;letter-spacing:.05em;margin-bottom:10px">' +
        (editing ? 'EDITING EVENT' : 'ADD AN EVENT') + '</div>' +
      fieldRow('Title', '<input name="title" required maxlength="80" value="' + UI.esc(ev.title || '') + '" placeholder="Amapiano Friday">') +
      '<div class="row" style="gap:9px">' +
        '<div class="field" style="flex:1"><label>Type</label><select name="kind">' + kindOpts + '</select></div>' +
        '<div class="field" style="flex:1"><label>Branch</label><select name="branch">' + branchOpts + '</select></div>' +
      '</div>' +
      '<div class="row" style="gap:9px">' +
        '<div class="field" style="flex:1"><label>Starts</label><input type="datetime-local" name="starts" required value="' + toLocalInput(ev.starts_at) + '"></div>' +
        '<div class="field" style="flex:1"><label>Ends</label><input type="datetime-local" name="ends" value="' + toLocalInput(ev.ends_at) + '"></div>' +
      '</div>' +
      fieldRow('What is it (one line)', '<input name="blurb" maxlength="240" value="' + UI.esc(ev.blurb || '') + '" placeholder="Log drums, late bass, doors at nine.">') +
      '<div class="row" style="gap:9px">' +
        '<div class="field" style="flex:1"><label>Image</label><select name="image">' + imgOpts + '</select></div>' +
        '<div class="field" style="flex:1"><label>Button text</label><input name="ticket_label" maxlength="30" value="' + UI.esc(ev.ticket_label || 'Get tickets') + '"></div>' +
      '</div>' +
      fieldRow('Ticket link (https)', '<input name="ticket_url" type="url" pattern="https://.*" value="' + UI.esc(ev.ticket_url || '') + '" placeholder="https://…">') +
      '<label class="tiny" style="display:flex;gap:8px;align-items:center;margin:6px 0 12px">' +
        '<input type="checkbox" name="published" ' + (ev.published !== false ? 'checked' : '') + '> Show on the storefront now</label>' +
      '<div class="row" style="gap:8px">' +
        '<button class="btn btn--primary" type="submit">' + (editing ? 'Save changes' : 'Add event') + '</button>' +
        (editing ? '<button class="btn btn--ghost" type="button" data-ev="cancel">Cancel</button>' : '') +
      '</div>' +
      '<div class="tiny" id="evErr" style="color:var(--danger);margin-top:8px"></div>' +
    '</form>';
  }

  function listHtml() {
    var all = global.Store.events();
    if (!all.length) return '<div class="tiny muted">No events yet.</div>';
    return all.map(function (e) {
      var past = new Date(e.ends_at || e.starts_at).getTime() < Date.now();
      var tag = !e.published ? '<span class="tag tag--muted">Hidden</span>'
              : (past ? '<span class="tag tag--muted">Past</span>' : '<span class="tag tag--ready">Live</span>');
      return '<div class="opt" style="cursor:default">' +
        '<div style="min-width:0"><div class="opt__name">' + UI.esc(e.title) + '</div>' +
        '<div class="tiny muted">' + UI.esc(e.kind) + ' · ' + UI.clock(new Date(e.starts_at).getTime()) +
        ' · ' + (e.branch === 'GRK' ? 'Ga-Rankuwa' : 'Tembisa') + '</div></div>' +
        '<div class="row" style="gap:6px;flex-wrap:wrap;justify-content:flex-end">' + tag +
        '<button class="btn btn--sm" data-ev="edit" data-id="' + e.id + '">Edit</button>' +
        '<button class="btn btn--sm" data-ev="toggle" data-id="' + e.id + '">' + (e.published ? 'Hide' : 'Show') + '</button>' +
        '<button class="btn btn--sm btn--danger" data-ev="delete" data-id="' + e.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
  }

  /* Returns the card HTML for the admin page. */
  function card() {
    return '<div class="card" style="margin-bottom:14px">' +
      '<div class="row row--between"><h3 style="font-size:15px">Nights &amp; events</h3>' +
      '<span class="tiny muted">Shown on the storefront while upcoming</span></div>' +
      '<div class="two" style="margin-top:12px;gap:16px;align-items:start">' +
        '<div>' + formHtml(editing ? global.Store.events().find(function (x) { return x.id === editing; }) : null) + '</div>' +
        '<div><div class="tiny muted" style="font-weight:800;letter-spacing:.05em;margin-bottom:8px">ALL EVENTS</div>' + listHtml() + '</div>' +
      '</div></div>';
  }

  /* Wires the card after the admin page has been drawn. */
  function bind(host) {
    var form = host.querySelector('#evForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var f = new FormData(form);
        var existing = editing ? global.Store.events().find(function (x) { return x.id === editing; }) : null;
        var saved = global.Store.eventSave({
          id: editing || undefined,
          title: f.get('title'),
          kind: f.get('kind'),
          branch: f.get('branch'),
          starts_at: toIso(f.get('starts')),
          ends_at: toIso(f.get('ends') || f.get('starts')),
          venue: (global.Data.menu.branches.find(function (b) { return b.code === f.get('branch'); }) || {}).name,
          blurb: f.get('blurb'),
          image: f.get('image'),
          ticket_label: f.get('ticket_label'),
          ticket_url: f.get('ticket_url'),
          published: !!f.get('published')
        });
        var err = host.querySelector('#evErr');
        if (!saved) {
          err.textContent = 'Check the title, start time and that the ticket link starts with https://';
          return;
        }
        editing = null;
        UI.toast(existing ? 'Event updated' : 'Event added');
      });
    }
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ev]');
      if (!b) return;
      var act = b.getAttribute('data-ev'), id = b.getAttribute('data-id');
      if (act === 'edit') { editing = id; }
      if (act === 'cancel') { editing = null; }
      if (act === 'toggle') { global.Store.eventToggle(id); }
      if (act === 'delete') {
        if (confirm('Delete this event?')) { global.Store.eventDelete(id); editing = null; }
      }
      if (act === 'edit' || act === 'cancel') { /* redraw via refresh below */ }
      if (global.App && global.App.render) global.App.render();
    });
  }

  global.EventsAdmin = { card: card, bind: bind };
})(window);
