const labels = Object.freeze({
  observing: 'Locating target\u2026', thinking: 'Thinking\u2026', checking: 'Checking result\u2026',
  acting: 'Working\u2026', completed: 'Completed', blocked: 'Needs attention',
  failed: 'Unable to continue', uncertain: 'Result uncertain', cancelled: 'Cancelled',
  interrupted: 'Control interrupted', stopped: 'Stopped', paused: 'Paused',
  expired: 'Session expired', disconnected: 'Disconnected', off: 'Inactive',
  requesting_control: 'Waiting for permission\u2026'
});
const actions = Object.freeze({
  mouseMove: 'Moving mouse\u2026', click: 'Clicking target\u2026', doubleClick: 'Clicking target\u2026',
  drag: 'Dragging\u2026', typeText: 'Typing\u2026', pressKeys: 'Pressing keys\u2026',
  scroll: 'Scrolling\u2026', wait: 'Waiting\u2026'
});

// Only trusted vocabulary enters the overlay. Goals and typed text stay private.
export function activityLabel(phase, actionType = null) {
  const safePhase = Object.hasOwn(labels, phase) ? phase : 'stopped';
  return { phase: safePhase, text: safePhase === 'acting' && Object.hasOwn(actions, actionType)
    ? actions[actionType] : labels[safePhase] };
}
