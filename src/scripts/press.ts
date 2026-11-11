/**
 * iOS Safari only applies `:active` to a tapped element when a touch listener
 * is registered on it or an ancestor. The portfolio's tap feedback (rows and
 * cards lighting on press, `.press` sinking a pixel) is all `:active`, so one
 * passive, empty listener on the document turns it on. It never blocks
 * scrolling and does nothing on its own.
 */
document.addEventListener('touchstart', () => {}, { passive: true });
