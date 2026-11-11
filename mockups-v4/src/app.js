// Appearance panel: six preferences, saved as JSON in localStorage.appearance.
(function () {
  var KEY = 'appearance';
  var DEFAULTS = {
    theme: 'system',
    ink: 'ai',
    read: 'sans',
    size: 'standard',
    density: 'comfortable',
    motion: 'system',
  };
  var root = document.documentElement;
  var toggle = document.getElementById('appearance-toggle');
  var panel = document.getElementById('appearance-panel');
  var form = document.getElementById('appearance-form');
  var resetBtn = document.getElementById('appearance-reset');
  var status = document.getElementById('appearance-status');
  if (!toggle || !panel || !form) return;

  var canSave = true;

  function current() {
    var out = {};
    for (var k in DEFAULTS) out[k] = root.getAttribute('data-' + k) || DEFAULTS[k];
    return out;
  }

  function save(prefs) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(prefs));
      canSave = true;
    } catch (e) {
      canSave = false;
    }
    status.textContent = canSave
      ? ''
      : "this browser isn't keeping settings, so they'll reset on reload.";
  }

  function syncForm(prefs) {
    for (var k in prefs) {
      var input = form.querySelector(
        'input[name="' + k + '"][value="' + prefs[k] + '"]',
      );
      if (input) input.checked = true;
    }
  }

  function apply(prefs) {
    for (var k in prefs) root.setAttribute('data-' + k, prefs[k]);
  }

  syncForm(current());

  // Storage can be blocked (private modes, site-data settings). The controls
  // still work for this page; say so instead of failing silently.
  try {
    window.localStorage.getItem(KEY);
  } catch (e) {
    canSave = false;
    status.textContent =
      "this browser isn't keeping settings, so they'll reset on reload.";
  }

  form.addEventListener('change', function () {
    var prefs = current();
    var data = new FormData(form);
    for (var k in DEFAULTS) prefs[k] = data.get(k) || prefs[k];
    apply(prefs);
    save(prefs);
  });

  resetBtn.addEventListener('click', function () {
    apply(DEFAULTS);
    syncForm(DEFAULTS);
    try {
      window.localStorage.removeItem(KEY);
      canSave = true;
      status.textContent = 'back to the defaults.';
    } catch (e) {
      status.textContent = 'back to the defaults for this visit.';
    }
  });

  // Motion: a short scale-and-fade from the trigger, only when motion is on.
  function motionOn() {
    return (
      root.getAttribute('data-motion') !== 'reduced' &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  var running = null;
  var tool = toggle.parentNode;
  var GAP = 8;
  var EDGE = 12;

  // Anchor the panel to the icon in document coordinates: right edges
  // aligned, clamped inside the viewport horizontally; below the icon unless
  // there is clearly more room above. Max height keeps it on screen.
  function place() {
    var r = toggle.getBoundingClientRect();
    var vw = document.documentElement.clientWidth;
    var vh = window.innerHeight;
    panel.style.maxHeight = '';
    var w = panel.offsetWidth;
    var h = panel.scrollHeight;
    var left = Math.min(Math.max(r.right - w, EDGE), vw - w - EDGE);
    var below = vh - r.bottom - GAP - EDGE;
    var above = r.top - GAP - EDGE;
    var up = h > below && above > below;
    var room = Math.max(160, up ? above : below);
    var shown = Math.min(h, room);
    panel.classList.toggle('above', up);
    panel.style.maxHeight = room + 'px';
    panel.style.left = left + window.scrollX + 'px';
    panel.style.top =
      (up ? r.top - GAP - shown : r.bottom + GAP) + window.scrollY + 'px';
  }

  function open() {
    if (running) running.cancel();
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    place();
    if (motionOn() && panel.animate) {
      running = panel.animate(
        [
          { opacity: 0, transform: 'scale(0.96) translateY(-4px)' },
          { opacity: 1, transform: 'none' },
        ],
        { duration: 170, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      );
    }
    var checked = form.querySelector('input:checked');
    if (checked) checked.focus({ preventScroll: true });
  }

  function close(restoreFocus) {
    if (panel.hidden) return;
    if (running) running.cancel();
    toggle.setAttribute('aria-expanded', 'false');
    var finish = function () {
      panel.hidden = true;
      running = null;
    };
    if (motionOn() && panel.animate) {
      running = panel.animate(
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'scale(0.98)' },
        ],
        { duration: 110, easing: 'ease-in' },
      );
      running.onfinish = finish;
    } else {
      finish();
    }
    if (restoreFocus) toggle.focus({ preventScroll: true });
  }

  toggle.addEventListener('click', function () {
    if (toggle.getAttribute('aria-expanded') === 'true') close(false);
    else open();
  });

  // Text size and density change the panel's own size, and the window can
  // change under it: re-anchor while open.
  form.addEventListener('change', function () {
    if (!panel.hidden) place();
  });
  window.addEventListener('resize', function () {
    if (!panel.hidden) place();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (toggle.getAttribute('aria-expanded') === 'true') {
      event.preventDefault();
      close(true);
      tool.classList.add('tip-off');
    } else if (tool.matches(':hover') || document.activeElement === toggle) {
      // WCAG 1.4.13: the tooltip can be dismissed without moving away.
      tool.classList.add('tip-off');
    }
  });

  // The tooltip comes back after the pointer or focus leaves and returns.
  tool.addEventListener('pointerleave', function () {
    tool.classList.remove('tip-off');
  });
  toggle.addEventListener('blur', function () {
    tool.classList.remove('tip-off');
  });

  document.addEventListener('pointerdown', function (event) {
    if (toggle.getAttribute('aria-expanded') !== 'true') return;
    if (panel.contains(event.target) || toggle.contains(event.target)) return;
    var hadFocus = panel.contains(document.activeElement);
    close(hadFocus);
  });

  // Tabbing past the panel closes it without moving focus back.
  panel.addEventListener('focusout', function (event) {
    var next = event.relatedTarget;
    if (next && !panel.contains(next) && next !== toggle) close(false);
  });

  // Lets :active fire on touch so the press response matches pointer use.
  document.addEventListener('touchstart', function () {}, { passive: true });
})();
