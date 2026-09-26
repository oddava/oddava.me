# Samsung note icons

The icon picker, Studio file icons, and public note explorer render Samsung
One UI 8.5 PNGs from [RealityRipple/oneui-emoji](https://github.com/RealityRipple/oneui-emoji)
at commit `d587ab50481ff2fd2cd48d27ced7489d2b2ecf6c` through jsDelivr. Images
are requested individually, with no referrer, rather than bundling the 61 MB
collection. This requires access to `cdn.jsdelivr.net` in the visitor's browser.

The collection includes an [SIL Open Font License with Samsung's copyright notice](https://github.com/RealityRipple/oneui-emoji/blob/d587ab50481ff2fd2cd48d27ced7489d2b2ecf6c/LICENSE).
This is the upstream distributor's license declaration, not an independent
verification of Samsung's licensing terms.

`src/lib/content/samsungEmoji.json` lists the filenames under `png/112/` at that
commit, without their extension. Keep this index and the URL revision in
`samsungEmoji.ts` together when updating the collection. Variation selectors
are normalized only for lookup; stored emoji characters remain unchanged.
Skin tones, flags, keycaps, and joined sequences use their complete sequence.
Unsupported emojis render natively. Studio also falls back to native rendering
if an image fails; the public explorer is static HTML and retains the emoji as
image alternative text. The paste field remains native text with a Samsung
preview beside it. Uploaded icons and emojis in note bodies are unaffected.
