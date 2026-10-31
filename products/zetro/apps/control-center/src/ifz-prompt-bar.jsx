import React, { useEffect } from 'react';
import PromptBar from './components/PromptBar.jsx';
import { ROUTE_MODES } from './ifz-work-model.js';

/**
 * Minimalist Codex-style composer bar for the IFZ Work page.
 * Powered by React Bits PromptBar with SlingButton elastic send/stop physics.
 * All auxiliary function buttons removed per design specification:
 * only the prompt textarea and the <SlingButton /> send control remain.
 *
 * Invariants:
 * - All prompts target IFZ
 * - Preserves draft text and attachments across renders
 * - Escape hotkey halts active runs
 * - Live submit remains truthful dry-run preview until authenticated mutation API exists
 */
export default function IfzPromptBar({
  draft,
  isRunning = false,
  effort = 'High',
  onSetEffort,
  onSetDraft,
  onSubmitPrompt,
  onStopActiveRun,
  onRemoveAttachment
}) {
  // Global Esc hotkey handler to halt active run
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        if (isRunning && onStopActiveRun) {
          onStopActiveRun();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRunning, onStopActiveRun]);

  return (
    <div className="ifz-prompt-bar-wrap" role="region" aria-label="IFZ master prompt composer">
      <PromptBar
        value={draft?.text ?? ''}
        onChange={text => onSetDraft?.({ text })}
        placeholder="Ask IFZ to plan, execute, or coordinate work…"
        sources={[]}
        commands={[]}
        models={[]}
        efforts={['Low', 'Medium', 'High', 'Strict', 'Max']}
        defaultEffort={draft?.effort || effort || 'High'}
        onEffortChange={eff => onSetEffort?.(eff)}
        busy={isRunning}
        onSend={() => {
          if (draft?.routeMode === ROUTE_MODES.MANUAL && (!draft?.manualWorkers || draft.manualWorkers.length === 0)) {
            return;
          }
          onSubmitPrompt?.();
        }}
        onStop={onStopActiveRun}
        attachments={draft?.attachments}
        onRemoveAttachment={id => onRemoveAttachment?.(id)}
        headerSlot={null}
        sparkColor="var(--accent, #8ce6b8)"
        width={860}
        radius={18}
        maxRows={6}
      />
    </div>
  );
}
