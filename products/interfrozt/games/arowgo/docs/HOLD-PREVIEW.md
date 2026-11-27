# Neutral hold preview

Hold an arrow for 400 ms to inspect it. The selected body gains a soft outline; a dashed line shows its forward route, with an amber stop marker at a physical obstruction. Key and anchor relationships are highlighted. A mechanically blocked arrow can still show its physical route, without implying that it can move now.

For a currently legal removal, affected countdowns, ice seals and phase markers are outlined. The caption explains their immediate changes and any released links. This is a rules inspection, not a hint: it never reads the stored solution or invokes the solver. Both strategically winning and losing legal choices say “Path open.” No future solvability verdict is shown.

Release dismisses the preview without moving. Tap separately to commit. Dragging more than 10 px, pointer cancellation, lost capture, window blur, resizing and hiding the page cancel the gesture. Keyboard users focus an arrow and hold P; releasing P or pressing Escape dismisses it. Enter cannot commit while the preview is held.

The overlay fades in over 180 ms and out over 150 ms. Only the dashed route moves while held. Reduced Motion disables these animations. The preview does not write saves, consume hearts, spend currency or change arrow state. Existing elapsed-time scoring continues normally.

Implementation: `src/domain/preview.ts` derives geometry and immediate effects without mutation; `src/game/Board.tsx` renders the overlay and handles gestures. Unit coverage checks neutral labels for both safe and unsafe legal choices, exact immediate effects, immutability and no solver calls. Browser coverage exercises pointer, keyboard and touch interaction, narrow layouts, reduced motion and unchanged local storage in isolated test contexts.

## Foundry linked switches

Content 15 previews active matching switches for a gate and matching gates for a switch. Legal switch previews list each gate's immediate open/closed change. Ordinary moves do not toggle linked gates. No solver or stored solution is consulted; a shown open path does not guarantee a winning continuation.
