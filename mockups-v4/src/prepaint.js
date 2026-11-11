// Runs in <head> before first paint: applies saved appearance to <html>.
// Unknown or missing values fall back to the defaults already in the markup.
(function () {
  var allowed = {
    theme: ['system', 'light', 'dark'],
    ink: ['ai', 'sakura', 'matcha', 'fuji', 'sora'],
    read: ['sans', 'serif'],
    size: ['standard', 'large'],
    density: ['comfortable', 'compact'],
    motion: ['system', 'reduced'],
  };
  var saved = null;
  try {
    saved = JSON.parse(window.localStorage.getItem('appearance') || 'null');
  } catch (e) {
    saved = null;
  }
  if (!saved || typeof saved !== 'object') return;
  var root = document.documentElement;
  for (var key in allowed) {
    if (allowed[key].indexOf(saved[key]) !== -1) {
      root.setAttribute('data-' + key, saved[key]);
    }
  }
})();
