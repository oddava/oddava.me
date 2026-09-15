# Interactive note graph

The same Preact island renders a one-hop neighborhood above the sidebar outline
and the full graph at `/notes/graph`. Expanding the sidebar uses a native modal
without remounting the canvas or losing its camera. The old landscape renderer
has been replaced.

## Reference and decisions

[Obsidian's graph documentation](https://obsidian.md/help/plugins/graph) describes
incoming-link node sizing, hover connections, click navigation, zoom-dependent
labels, local neighborhoods, and centering/repulsion/link forces. The implementation
follows those behaviors, with the site's rounded face, monochrome surfaces, and
blue accent. Physics constants are tuned approximations, not Obsidian internals.

[D3 force simulation](https://d3js.org/d3-force/simulation) supplies damped springs,
Barnes–Hut repulsion, collision, and cooling. Custom canvas rendering owns label
priority/collision, hit testing, gestures, and camera behavior. It avoids Preact
renders during animation, batches edge strokes, caches text measurements, caps
pixel density at 2, and sleeps when stable/offscreen. Physics stays on the main
thread; very large collections may justify a worker after profiling.

`deriveNoteGraph` consumes the existing public GardenIndex. Only resolved links
produce edges; reciprocal and repeated links collapse into one undirected edge.
Unlinked notes stay visible in the full graph. Folder membership and shared tags
do not create artificial links. Redis read/write paths are unchanged.

## Interaction and accessibility

- Drag a node to pull its neighborhood; drag empty space to pan.
- Wheel/pinch zoom around the pointer/midpoint; `+`/`−` also zoom.
- Arrow keys pan, Shift accelerates, `[`/`]` select, Enter opens, `0` fits.
- Escape closes the modal and restores the expand button's focus.
- Keyboard selection announces the note title inside the active dialog.
- Reduced motion disables animated settling; direct manipulation still works.

## Validation and refinement

| Critic pass | Fidelity | Physics | Interaction | Readability | Integration | Polish |
| ----------- | -------- | ------- | ----------- | ----------- | ----------- | ------ |
| Initial     | 7.5      | 8       | 7           | 5.5         | 7           | 6.5    |
| Refined     | 8.5      | 8.5     | 8.5         | 8           | 9           | 8.5    |

First refinement improved edge contrast, fullscreen labels, modal Escape,
responsive padding, sidebar scrolling, and mobile camera restoration. The next
refinement removed a disappearing status link, added touch help, and corrected
offscreen detection on tab return. The critic judged further changes marginal.

Unit checks cover resolved-link derivation and physics settling/elasticity.
Playwright checks cover desktop dragging/panning/zoom, idle rendering, mobile
pinch, modal focus/camera restoration, and keyboard navigation. The fixture
at `tests/browser/graph.html?full&count=120` exercises denser constellations without
changing content. Live Redis pages were rendered at desktop and mobile widths;
DOM-only outline/explorer injection checked sidebar overflow with an actual Astro
island wrapper.

## Motion polish, September 2026

The user-refined framed canvas and two corner controls remain the visual baseline.
Neutral nodes use site text tokens; the larger current note stays neutral at rest.
The primary blue appears only with hover/focus intent. No extra toolbar or footer
was restored. Force constants and the data path are unchanged.

- Camera easing is time-based: 65ms response for wheel input, 110ms for fit.
  Direct dragging and pinching remain one-to-one. Final settling fits smoothly.
- Hover emphasis uses 65ms attack and 110ms release; labels fade over 70ms.
  These are exponential time constants, not total animation durations.
- Pan release decays over 70ms, capped to 8% of the smaller viewport dimension
  and at most 28px. New input stops the coast immediately.
- Modals open without a size animation and fade out over 120ms. On closing,
  miniature circles gently pop to full size over 260ms with a small spring impulse.
  Escape/close buttons return focus to their opener.
- Reduced motion bypasses animated camera, hover, settling, and modal transitions.
  The global graph mounts only when opened. Controls wait for local hydration.

| Polish pass | Smoothness | Motion | Visual cohesion | Nativeness | Interaction feel | Responsiveness | Delight |
| ----------- | ---------- | ------ | --------------- | ---------- | ---------------- | -------------- | ------- |
| First       | 8          | 7.5    | 9               | 8.5        | 8                | 8.5            | 8       |
| Refined     | 9          | 9      | 9               | 9          | 9                | 9              | 8.5     |

The critic identified delayed desktop dismissal and excessive sidebar coast.
Independent rechecks measured dismissal at 226ms including browser-test overhead
and coast at 19px after the same 50px pan, down from 55.6px. Landscape layout,
focus restoration, and reduced motion passed; further refinement was marginal.

The sidebar slot remains in flow throughout modal transitions. A frozen canvas
frame preserves the miniature while its interactive canvas is in the top layer;
following sections keep their exact positions. Canvas focus no longer lights the
miniature's border. A small one-shot velocity impulse on graph arrival settles
through the existing springs; reduced motion bypasses the impulse.
