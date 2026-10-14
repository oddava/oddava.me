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
thread; see _Performance, October 2026_ for where that stops being enough.

`deriveNoteGraph` consumes the existing public GardenIndex. Only resolved links
produce edges; reciprocal and repeated links collapse into one undirected edge.
Unlinked notes stay visible in the full graph, gathered as a loose cloud around
the connected core by a stronger centring pull. Folder membership and shared
tags do not create artificial links. Redis read/write paths are unchanged.

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
- Modals open without a size animation and fade out over 120ms. Escape/close
  buttons return focus to their opener. (Superseded below: _Arrival and
  presence, October 2026_.)
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

The native visual treatment uses an open black canvas with a fine bottom rule,
borderless controls, and a blue open-center current-note marker. Labels retain
the site's rounded face. Physics, camera response, and return motion are unchanged.

Below the 78rem sidebar breakpoint, note pages replace the inline graph with an
“Explore connections” link to the full graph, which returns to the source note.
The notes browser starts collapsed and remembers a separate narrow-screen choice.
Its expanded tree scrolls with the page instead of trapping touch gestures in a
height-capped inner scroller. Wide screens retain the graph and bounded explorer.

## Arrival and presence, October 2026

The spring-driven shared-element morph, its reprojected overlay canvas, the
formation release and the momentum hand-back to the sidebar were removed. Each
stopped motion with a hard cap (a 500ms formation cut-off, a 250ms/3px settle
wall), and the hand-back kicked the sidebar's physics after every close: the
jiggle. Following Obsidian, surface and content now move independently.

- **Presence** (`graph-presence.ts`): the modal fades in over 260ms while rising
  from 96.5% scale (expo-out), growing from the sidebar graph's side, and fades
  out over 160ms. Web Animations, reversible mid-flight from what is on screen;
  a deadline lands it even if frames stall.
- **Bloom** (`graph-bloom.ts`): every arrival — sidebar, expanded, global, full
  page — unfurls the constellation from the current note (else the layout's
  centre) with a slight unwinding twist. Each note decelerates on its own
  expo-out curve, outer notes leave slightly later, and all land together at
  760ms. It is presentation over the live layout: physics never receives an
  impulse, so nothing overshoots. Edges draw in with the release and labels
  fade up as notes land. Any direct input lands it at once.
- **Closing moves nothing.** The sidebar snapshot is repainted from the resting
  layout, with label fades settled, before the fade-out; the live canvas then
  returns pixel-identical.
- Reduced motion: no presence animation, no bloom, layout settled up front.

## Performance, October 2026

Profiled with the browser fixture (`?full&count=N`), headless Chromium.

| Notes | Load long task, before → after | Pan frame p95 | Dropped frames (pan/zoom/hover/drag) |
| ----- | ------------------------------ | ------------- | ------------------------------------ |
| 100   | 137ms → 51–69ms                | 1.5 → 0.8ms   | 0                                    |
| 500   | 612ms → 76ms                   | 3.0 → 1.5ms   | 0                                    |
| 1000  | — → 90–103ms                   | 2.3ms         | 0                                    |
| 2000  | 2537ms → 131–163ms             | 6.7 → 22ms\*  | pan 38/115, drag 68/138              |

\*At 2000 notes physics ticks now run inside the measured frame; before, d3's
own timer ran them outside it, so the old figure undercounted.

- **Warm-up is time-budgeted** (40ms) instead of a fixed tick count. Small
  graphs still arrive at rest; larger ones finish cooling live. d3's tick
  sequence is deterministic, so the final layout is identical either way.
- **Physics runs inside the paint loop**: one frame callback ticks, then draws,
  so a frame never shows a stale layout. During a bloom, cooling may
  fast-forward within 4ms per frame so mid-size graphs land with it; otherwise,
  and always while a note is held, it is one tick per frame. While the layout
  cools on its own the camera keeps it framed every frame instead of snapping
  to a new fit at the end.
- **Repulsion is bounded** (`distanceMax(400)`, `theta(1.2)`): 20–35% cheaper
  per tick, and 2–2.4× lower edge-length error at 500–2000 notes, because
  unbounded repulsion piles up across a large graph and overstretches links.
- **Frames allocate nothing**: positions, fades and label state live in typed
  arrays indexed like the nodes; label occupancy is a typed grid; labels that
  are hidden and staying hidden are never measured; edges wholly beside the
  viewport never reach the path.

Many-body repulsion is the whole remaining cost (13.8ms/tick at 2000 notes;
collision 5.5ms; everything else under 0.2ms). Main-thread physics therefore
holds 60fps with zero dropped frames to about 1000 notes. Beyond that, move the
simulation into a worker, as Obsidian does: the render loop already reads
positions once per frame, which is the seam a worker would feed.

Every note page also inlines the global graph's data for the lazily mounted
global modal. At today's size that is negligible; past a few hundred notes,
fetch it on first open instead.
