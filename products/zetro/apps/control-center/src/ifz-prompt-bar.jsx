import React, { useState, useEffect, useRef } from 'react';
import { ROUTE_MODES } from './ifz-work-model.js';

/* Accessible Inline SVG Icons */
function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function StopSquareIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

function WorkflowIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

/**
 * Compact Codex-style composer bar for the IFZ Work page.
 *
 * Invariants:
 * - All prompts always target IFZ
 * - Manual routing constrains IFZ without bypassing IFZ
 * - Route suggestions never auto-send
 * - Shows route chips and route preview before send
 * - All icon controls have accessible labels and tooltips
 * - Live submit remains dry-run until authenticated mutation API exists
 * - Preserves draft text across renders
 */
export default function IfzPromptBar({
  draft,
  routePreview,
  availablePresets = [],
  availableWorkers = [],
  savedWorkflows = [],
  isRunning = false,
  onSetDraft,
  onSetRouteMode,
  onToggleManualWorker,
  onSetPreset,
  onSetSavedWorkflow,
  onAddAttachment,
  onRemoveAttachment,
  onSubmitPrompt,
  onStopActiveRun
}) {
  const [showRoutePreview, setShowRoutePreview] = useState(false);
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [showPresetMenu, setShowPresetMenu] = useState(false);

  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const routeBtnRef = useRef(null);
  const presetBtnRef = useRef(null);

  // Auto-resize textarea to fit multiline content gracefully
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      const scrollHeight = el.scrollHeight;
      el.style.height = `${Math.min(Math.max(scrollHeight, 40), 220)}px`;
    }
  }, [draft.text]);

  // Global Esc hotkey handler with clean focus return
  useEffect(() => {
    const onKeyDown = event => {
      if (event.key === 'Escape') {
        if (showRouteMenu) {
          setShowRouteMenu(false);
          routeBtnRef.current?.focus();
        } else if (showPresetMenu) {
          setShowPresetMenu(false);
          presetBtnRef.current?.focus();
        } else if (showRoutePreview) {
          setShowRoutePreview(false);
        } else if (isRunning && onStopActiveRun) {
          onStopActiveRun();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showRouteMenu, showPresetMenu, showRoutePreview, isRunning, onStopActiveRun]);

  const isManualEmpty = draft.routeMode === ROUTE_MODES.MANUAL && (!draft.manualWorkers || draft.manualWorkers.length === 0);
  const isSendDisabled = !draft.text.trim() || isManualEmpty;

  const handleKeyDown = event => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSendDisabled) {
        onSubmitPrompt();
      }
    }
  };

  const handleFileChange = event => {
    const files = event.target.files;
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        onAddAttachment({
          name: file.name,
          size: file.size,
          type: file.type || 'text/plain'
        });
      }
      event.target.value = '';
    }
  };

  return (
    <div className="ifz-prompt-bar-wrap" role="region" aria-label="IFZ master prompt composer">
      {/* Route Preview Card Popover */}
      {showRoutePreview && (
        <div
          className="ifz-route-preview-card"
          role="dialog"
          aria-modal="false"
          aria-label="Public route preview"
        >
          <div className="preview-header">
            <div className="preview-title-wrap">
              <span className="preview-badge">ORCHESTRATION</span>
              <h4 className="preview-title">IFZ Route Plan</h4>
            </div>
            <button
              type="button"
              className="preview-close-btn"
              onClick={() => setShowRoutePreview(false)}
              title="Close route preview"
              aria-label="Close route preview"
            >
              <CloseIcon />
            </button>
          </div>

          <div className="preview-body">
            <div className="preview-row">
              <span className="preview-label">Target Destination:</span>
              <span className="preview-val highlight">{routePreview.target}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">Route Mode:</span>
              <span className="preview-val">{routePreview.modeLabel}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">Strategy:</span>
              <span className="preview-val">{routePreview.strategy}</span>
            </div>
            <div className="preview-row">
              <span className="preview-label">Master Preset:</span>
              <span className="preview-val">{routePreview.preset}</span>
            </div>
            <div className="preview-row desc-row">
              <span className="preview-label">Description:</span>
              <span className="preview-desc">{routePreview.description}</span>
            </div>
            <div className="preview-chips-section">
              <span className="preview-label">Dispatch Chain:</span>
              <div className="preview-chips">
                {routePreview.chips.map((chip, idx) => (
                  <span key={idx} className="preview-hop-item">
                    <span className="preview-hop-chip">{chip}</span>
                    {idx < routePreview.chips.length - 1 && (
                      <span className="hop-arrow-icon" aria-hidden="true">
                        <ArrowRightIcon />
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
            <div className="preview-footer-note">
              <span>Authority: {routePreview.authorityScope || 'Unavailable (no admitted workspace)'}</span>
              <span>· Verification: Required</span>
            </div>
          </div>
        </div>
      )}

      {/* Top Bar: Route Chips & Context Badges */}
      <div className="ifz-prompt-chips-bar" aria-label="Active route and context badges">
        <div className="chips-left">
          <span className="route-target-pill" title="All prompts dispatch through IFZ">
            To: IFZ
          </span>

          {routePreview.isConstrained && (
            <span className="route-constraint-tag" title="User manually constrained IFZ worker destinations">
              Constrained
            </span>
          )}

          {draft.routeMode === ROUTE_MODES.MANUAL && (
            draft.manualWorkers && draft.manualWorkers.length > 0 ? (
              draft.manualWorkers.map(wId => (
                <span key={wId} className="worker-route-chip">
                  <span className="chip-worker-name">{wId}</span>
                  <button
                    type="button"
                    className="chip-remove-btn"
                    onClick={() => onToggleManualWorker(wId)}
                    title={`Remove worker constraint ${wId}`}
                    aria-label={`Remove worker constraint ${wId}`}
                  >
                    <CloseIcon />
                  </button>
                </span>
              ))
            ) : (
              <span
                className="route-invalid-tag"
                title="At least one worker must be selected in manual constraint mode"
              >
                No worker selected
              </span>
            )
          )}

          {draft.routeMode === ROUTE_MODES.SAVED_WORKFLOW && (
            <span className="workflow-route-chip">
              <span className="workflow-icon" aria-hidden="true"><WorkflowIcon /></span>
              <span>{routePreview.strategy}</span>
            </span>
          )}

          {draft.attachments.map(att => (
            <span key={att.id} className="attachment-chip">
              <span className="att-icon" aria-hidden="true"><PaperclipIcon /></span>
              <span className="att-name">{att.name}</span>
              <button
                type="button"
                className="chip-remove-btn"
                onClick={() => onRemoveAttachment(att.id)}
                title={`Remove attachment ${att.name}`}
                aria-label={`Remove attachment ${att.name}`}
              >
                <CloseIcon />
              </button>
            </span>
          ))}
        </div>

        <div className="chips-right">
          <button
            type="button"
            className={`route-preview-toggle-btn ${showRoutePreview ? 'active' : ''}`}
            onClick={() => setShowRoutePreview(prev => !prev)}
            aria-expanded={showRoutePreview}
            title="Inspect public route preview and execution chain"
            aria-label="Inspect public route preview"
          >
            <span>Route Preview</span>
            <span className="chip-count">({routePreview.chips.length})</span>
          </button>
        </div>
      </div>

      {/* Main Composer Box */}
      <div className="ifz-composer-box">
        <textarea
          ref={textareaRef}
          className="ifz-composer-input"
          value={draft.text}
          onChange={e => onSetDraft({ text: e.target.value })}
          onKeyDown={handleKeyDown}
          placeholder="Ask IFZ to plan, execute, or coordinate work across workers… (Enter to send, Shift+Enter for newline)"
          rows={1}
          aria-label="Master prompt to IFZ"
        />

        {/* Controls Row */}
        <div className="ifz-composer-footer">
          {/* Left Controls */}
          <div className="footer-left">
            <input
              ref={fileInputRef}
              type="file"
              className="hidden-file-input"
              multiple
              onChange={handleFileChange}
              tabIndex={-1}
              aria-hidden="true"
            />
            <button
              type="button"
              className="footer-btn icon-btn"
              onClick={() => fileInputRef.current?.click()}
              title="Add context file attachment"
              aria-label="Add context file attachment"
            >
              <PaperclipIcon />
            </button>

            {/* Routing Mode Menu */}
            <div className="menu-container">
              <button
                ref={routeBtnRef}
                type="button"
                className={`footer-btn selector-btn ${showRouteMenu ? 'active' : ''}`}
                onClick={() => {
                  setShowRouteMenu(prev => !prev);
                  setShowPresetMenu(false);
                }}
                aria-expanded={showRouteMenu}
                aria-haspopup="menu"
                title="Select routing mode"
                aria-label="Select routing mode"
              >
                <span className="btn-label">Route:</span>
                <span className="btn-val">{routePreview.modeLabel}</span>
                <span className="btn-chevron" aria-hidden="true"><ChevronDownIcon /></span>
              </button>

              {showRouteMenu && (
                <div className="ifz-dropdown-menu" role="menu">
                  <div className="menu-heading">Routing Mode</div>
                  <button
                    type="button"
                    className={`menu-item ${draft.routeMode === ROUTE_MODES.AUTOMATIC ? 'selected' : ''}`}
                    onClick={() => {
                      onSetRouteMode(ROUTE_MODES.AUTOMATIC);
                      setShowRouteMenu(false);
                      routeBtnRef.current?.focus();
                    }}
                    role="menuitem"
                  >
                    <div className="item-title">Automatic</div>
                    <div className="item-desc">IFZ plans and selects compatible workers</div>
                  </button>
                  <button
                    type="button"
                    className={`menu-item ${draft.routeMode === ROUTE_MODES.MANUAL ? 'selected' : ''}`}
                    onClick={() => {
                      onSetRouteMode(ROUTE_MODES.MANUAL);
                      setShowRouteMenu(false);
                      routeBtnRef.current?.focus();
                    }}
                    role="menuitem"
                  >
                    <div className="item-title">Manual Constraint</div>
                    <div className="item-desc">Select exact workers; IFZ routes only to them</div>
                  </button>
                  <button
                    type="button"
                    className={`menu-item ${draft.routeMode === ROUTE_MODES.SAVED_WORKFLOW ? 'selected' : ''}`}
                    onClick={() => {
                      onSetRouteMode(ROUTE_MODES.SAVED_WORKFLOW);
                      setShowRouteMenu(false);
                      routeBtnRef.current?.focus();
                    }}
                    role="menuitem"
                  >
                    <div className="item-title">Saved Workflow</div>
                    <div className="item-desc">Reusable execution strategy template</div>
                  </button>

                  {/* Manual Worker Selection Checkboxes/Chips */}
                  {draft.routeMode === ROUTE_MODES.MANUAL && (
                    <div className="menu-sub-section">
                      <div className="sub-heading">Constrain IFZ to:</div>
                      <div className="worker-chips-grid">
                        {availableWorkers.length === 0 ? (
                          <div className="no-workers-msg">No admitted workers registered</div>
                        ) : (
                          availableWorkers.map(w => {
                            const isSelected = draft.manualWorkers.includes(w.id);
                            return (
                              <button
                                key={w.id}
                                type="button"
                                className={`worker-toggle-chip ${isSelected ? 'selected' : ''} ${!w.available ? 'offline' : ''}`}
                                onClick={() => onToggleManualWorker(w.id)}
                                aria-pressed={isSelected}
                                title={`${w.name}: ${w.role}`}
                              >
                                <span className={`status-dot ${w.available ? 'online' : 'offline'}`} />
                                <span>{w.name}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  )}

                  {/* Saved Workflow Sub-menu */}
                  {draft.routeMode === ROUTE_MODES.SAVED_WORKFLOW && (
                    <div className="menu-sub-section">
                      <div className="sub-heading">Select Template:</div>
                      {savedWorkflows.map(wf => (
                        <button
                          key={wf.id}
                          type="button"
                          className={`menu-item ${draft.savedWorkflowId === wf.id ? 'selected' : ''}`}
                          onClick={() => {
                            onSetSavedWorkflow(wf.id);
                            setShowRouteMenu(false);
                            routeBtnRef.current?.focus();
                          }}
                          role="menuitem"
                        >
                          <div className="item-title">{wf.name}</div>
                          <div className="item-desc">{wf.desc}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Master Preset Selector */}
            <div className="menu-container">
              <button
                ref={presetBtnRef}
                type="button"
                className={`footer-btn selector-btn ${showPresetMenu ? 'active' : ''}`}
                onClick={() => {
                  setShowPresetMenu(prev => !prev);
                  setShowRouteMenu(false);
                }}
                aria-expanded={showPresetMenu}
                aria-haspopup="menu"
                title="Select Master Prompt preset"
                aria-label="Select Master Prompt preset"
              >
                <span className="btn-label">Preset:</span>
                <span className="btn-val">{routePreview.preset}</span>
                <span className="btn-chevron" aria-hidden="true"><ChevronDownIcon /></span>
              </button>

              {showPresetMenu && (
                <div className="ifz-dropdown-menu" role="menu">
                  <div className="menu-heading">Master Prompt Presets</div>
                  {availablePresets.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`menu-item ${draft.presetId === preset.id ? 'selected' : ''}`}
                      onClick={() => {
                        onSetPreset(preset.id);
                        setShowPresetMenu(false);
                        presetBtnRef.current?.focus();
                      }}
                      role="menuitem"
                    >
                      <div className="item-title">{preset.name}</div>
                      <div className="item-desc">{preset.desc}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Right Controls */}
          <div className="footer-right">
            <span
              className="dry-run-status-text"
              title="Live mutations require an authenticated IFZ API token. Currently in dry-run preview."
            >
              Dry-run preview
            </span>

            {isRunning && (
              <button
                type="button"
                className="footer-btn stop-btn"
                onClick={onStopActiveRun}
                title="Stop active execution (Esc)"
                aria-label="Stop active execution"
              >
                <span className="stop-square-icon" aria-hidden="true"><StopSquareIcon /></span>
                <span>Stop</span>
                <kbd className="stop-kbd">esc</kbd>
              </button>
            )}

            <button
              type="button"
              className="send-btn"
              onClick={onSubmitPrompt}
              disabled={isSendDisabled}
              title={
                isManualEmpty
                  ? 'Select at least one worker in manual mode to send'
                  : !draft.text.trim()
                    ? 'Enter a prompt to send'
                    : 'Send master prompt to IFZ (Enter)'
              }
              aria-label={
                isManualEmpty
                  ? 'Cannot send: No worker selected in manual mode'
                  : 'Send master prompt to IFZ'
              }
            >
              <span className="send-text">Send</span>
              <span className="send-arrow-icon" aria-hidden="true"><ArrowUpIcon /></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
