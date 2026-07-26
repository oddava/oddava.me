import { useCallback, useEffect, useRef } from 'preact/hooks';
import { fetchSocialCards, uploadSocialCard } from './api';
import { renderSocialCard } from './socialCard';

// Long enough that a burst of autosaves settles into one pass, and that the
// sync never competes with the save it follows.
const SYNC_DELAY_MS = 8_000;
/**
 * A garden that has never been synced has one card to draw per note. Capping a
 * run keeps that first pass from holding the content mutation lock in a long
 * chain of writes while the author is trying to work; what is left over comes
 * back on the next pass.
 */
const CARDS_PER_RUN = 12;

/**
 * Keeps every note's social card drawn.
 *
 * Cards are raster images, because no social platform renders an SVG
 * `og:image` — and the browser Studio already runs in is the one place in this
 * stack with the site's fonts and a rasterizer, so it draws them and stores
 * them like any other note upload. The Worker never rasterizes anything.
 *
 * The server owns which notes need a card and what text each one shows;
 * this only draws and uploads. A failure is silent by design: a missing card
 * falls back to the default social image, which is not worth an error banner
 * over the note the author is writing.
 */
export function useSocialCardSync(enabled: boolean): () => void {
  const timer = useRef<number | null>(null);
  const running = useRef(false);
  const cancelled = useRef(false);

  const run = useCallback(async () => {
    if (running.current || cancelled.current) return;
    running.current = true;
    try {
      const { cards } = await fetchSocialCards();
      const pending = cards.filter((card) => !card.stored);

      for (const card of pending.slice(0, CARDS_PER_RUN)) {
        if (cancelled.current) return;
        const image = await renderSocialCard(card);
        if (!image) return;
        await uploadSocialCard(card, image);
      }
      if (pending.length > CARDS_PER_RUN) scheduleRef.current();
    } catch (error) {
      console.warn('[studio] Social card sync did not finish.', error);
    } finally {
      running.current = false;
    }
  }, []);

  const schedule = useCallback(() => {
    if (!enabled || cancelled.current) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      void run();
    }, SYNC_DELAY_MS);
  }, [enabled, run]);

  // `run` reschedules itself when it hits the per-run cap, and is defined
  // before `schedule` is.
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  useEffect(() => {
    cancelled.current = false;
    schedule();
    return () => {
      cancelled.current = true;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
    };
  }, [schedule]);

  return schedule;
}
