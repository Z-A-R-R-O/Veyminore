# Generated production art — 10 November 2026

Generated with the built-in `image_gen` tool (not the API/CLI fallback). All three outputs requested true transparency. Original generated PNG files were copied unchanged into `public/assets/generated`; alpha is preserved. Source references provide the visual mood, but these are newly generated assets. Text, accessible buttons, hit targets and puzzle arrow geometry remain live UI.

## Assets and use

| Asset                 | Usage                                                 | Layout                      |
| --------------------- | ----------------------------------------------------- | --------------------------- |
| `bloom-island-v1.png` | Home hero and world-map backdrop                      | Transparent floating island |
| `game-icons-v1.png`   | Worlds, Modes, trophy, Story, Hint, Erase             | 3 columns × 2 rows          |
| `rewards-v1.png`      | Coin HUD/results, heart break fragments, title emblem | 3 columns × 1 row           |

`GameArt.tsx` selects atlas cells with CSS background positions. The atlas images are not cut apart or repainted. Reusable `Coin` and `HeartToken` use the reward atlas; two CSS-clipped copies of the generated heart retain the existing break animation. Practice reuses the controller illustration. Source PNG dimensions and SHA-256 hashes are in [the manifest](generated-art-manifest.json).

## Final prompts

### Island

Use case: stylized-concept. Asset type: premium mobile puzzle game decorative hero cutout. Create one original enchanting floating garden island, on a truly transparent background. Polished high-end soft 3D game illustration, beautifully detailed pink cherry blossom tree on the left, warm tiny lantern, soft grass and flowers, small ivory ruined twin arches on the right, crystalline waterfall spilling over a gently faceted lavender rock island. A tiny sleeping white cat nestled at the tree roots. Front three-quarter camera, harmonious wide silhouette, full island entirely visible, centered, generous transparent margin. Pastel lilac, blossom pink, sky blue and soft mint, warm sunlight, luminous but not blown out, tactile detailed materials, sophisticated casual game asset. No sky or backdrop, no text, no UI, no frame, no letters, no logos, no watermark. Landscape composition roughly 3:2. This will replace a flat vector illustration in the AROWGO Bloom Valley app.

### Game icon atlas

Use case: stylized-concept. Asset type: one production sprite atlas, six premium mobile game UI item illustrations in a precisely aligned THREE COLUMNS by TWO ROWS regular grid on a truly transparent background. Landscape canvas 3:2. Each cell is square and contains exactly one isolated icon, centered with generous identical transparent padding, objects must not overlap adjacent cells. Top-left: miniature floating grassy island with a purple pennant and pink blossom flowers (Worlds). Top-middle: glossy lavender game controller with white highlights and purple buttons (Modes). Top-right: radiant golden trophy cup with star emblem (Progress). Bottom-left: flowing purple story flag on a short gold pole (Story). Bottom-middle: glowing warm golden lightbulb, lavender base (Hint). Bottom-right: pink and white bevelled eraser tilted diagonally (Erase). All six in one consistent high-end softly sculpted 3D game asset style, rounded forms, rich material detail, lilac/pink/gold palette, soft studio lighting, crisp smooth silhouettes and controlled highlights. No labels, text, numbers, dividing lines, panels, borders, watermark, background scene or shadows spanning cells. Treat as an aligned sprite atlas, not a presentation sheet.

### Reward atlas

Use case: stylized-concept. Asset type: one transparent mobile game rewards sprite atlas, exactly THREE equal square cells horizontally, overall 3:1 landscape layout. Left cell: one plump golden coin, front three-quarter view, embossed four-point sparkle, polished gold with warm highlights. Middle cell: one plump glossy hot-pink heart, beautiful rounded 3D form, soft white specular highlight, no outline. Right cell: one elegant golden arrowhead/paper-plane emblem pointing UP, three dimensional sculpted gold. Each object completely isolated and centered in its own square cell with at least 15 percent empty transparent padding, consistent high-end soft 3D casual puzzle game art, crisp smooth edges, tactile materials, pastel purple ambient bounce light. Same scale across objects. Genuinely transparent background, no scenery, no floor, no ground shadow, no text, no numerals, no watermarks, no borders or grid lines. This is a reusable sprite texture for AROWGO's coin counter, animated heart loss, and title emblem.

## Presentation and verification

The UI also receives more consistent glossy card borders, compact headings, a circular progress display and clearer current/locked map stops. Original vector island/icon drafts were replaced in runtime by generated assets. Native generated files are kept unchanged for provenance. Browser tests cover small-screen button bounds, campaign flow, heart break, rewards, and victory; captures are under `docs/verification/generated-*`. No physical-device or 8K-performance result is implied.
