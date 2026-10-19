import React, { useState, useEffect } from 'react';
import { createIfzWorkModel } from './ifz-work-model.js';
import IfzPromptBar from './ifz-prompt-bar.jsx';

/* Clean Accessible Inline SVG Icons */
function AlertTriangleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
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

function ChevronRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/**
 * Isolated IFZ Work Page Component.
 *
 * Invariants:
 * - Default model is empty/unknown and never assumed running/connected without evidence.
 * - Developer fixture selector is hidden by default; exposed only through explicit devLab option.
 * - All controls use accessible inline SVGs with tooltips and aria-labels.
 * - Route suggestions populate draft but never auto-send.
 * - Live submit is visibly truthful (dry-run preview).
 */
export default function IfzWorkPage({
  initialFixture = null,
  initialDraft = null,
  devLab = false,
  modelInstance = null
}) {
  const [model] = useState(() => modelInstance || createIfzWorkModel({ initialFixture, initialDraft, devLab }));
  const [snapshot, setSnapshot] = useState(() => model.getSnapshot());

  useEffect(() => {
    const unsubscribe = model.subscribe(newSnap => {
      setSnapshot(newSnap);
    });
    return unsubscribe;
  }, [model]);

  const {
    fixtureKey,
    devLab: isDevLabActive,
    status,
    connection,
    title,
    subtitle,
    error,
    activeRun,
    events,
    expandedBranches,
    draft,
    routePreview,
    availablePresets,
    availableWorkers,
    savedWorkflows,
    stats
  } = snapshot;

  const isRunning = status === 'running';

  const handlePresetPrompt = promptText => {
    // Route suggestions populate the prompt bar; they NEVER auto-send!
    model.setDraft({ text: promptText });
  };

  return (
    <div className="ifz-work-page" data-status={status} data-connection={connection}>
      {/* Top Header */}
      <header className="ifz-work-header">
        <div className="header-meta">
          <div className="header-status-row">
            <span
              className={`connection-indicator ${connection}`}
              title={`Gateway status: ${connection}`}
            >
              <span className="conn-dot" />
              {connection === 'connected'
                ? 'IFZ Gateway Online'
                : connection === 'offline'
                  ? 'Gateway Offline'
                  : 'Connection Unknown · No Evidence'}
            </span>

            <span
              className={`run-status-badge ${status}`}
              title={`Session status: ${status}`}
            >
              {status.toUpperCase()}
            </span>

            {activeRun && (
              <span className="run-id-pill" title={`Active run identifier: ${activeRun.runId}`}>
                Run #{activeRun.runId}
              </span>
            )}
          </div>

          <h1 className="header-title">{title}</h1>
          <p className="header-subtitle">{subtitle}</p>
        </div>

        {/* Developer / Fixture Controls: EXPOSED ONLY WHEN devLab === true. Hidden in product UI. */}
        {isDevLabActive && (
          <div className="header-fixture-tools" role="region" aria-label="Development lab fixture tools">
            <label htmlFor="ifz-fixture-select" className="fixture-label">
              Dev Lab Fixture:
            </label>
            <select
              id="ifz-fixture-select"
              className="fixture-select"
              value={fixtureKey || 'unknown'}
              onChange={e => model.switchFixture(e.target.value)}
              title="Switch honest state fixture for development inspection"
              aria-label="Select honest state fixture"
            >
              <option value="unknown">Default (Unverified)</option>
              <option value="empty">Empty State</option>
              <option value="loading">Loading Context</option>
              <option value="disconnected">Disconnected Gateway</option>
              <option value="running">Running Execution</option>
              <option value="partial_failure">Partial Failure</option>
              <option value="uncertain">Uncertain Delivery</option>
              <option value="cancelled">Cancelled Run</option>
              <option value="complete">Complete & Verified</option>
            </select>
          </div>
        )}
      </header>

      {/* Disconnected / Error Alert Banner */}
      {error && (
        <div className="ifz-alert-banner error" role="alert">
          <div className="alert-icon" aria-hidden="true">
            <AlertTriangleIcon />
          </div>
          <div className="alert-body">
            <strong>Gateway Unreachable</strong>
            <p>{error}</p>
          </div>
        </div>
      )}

      {/* Main Conversation Stream */}
      <main className="ifz-conversation-stream" role="feed" aria-label="IFZ Conversation Stream">
        {status === 'loading' ? (
          <div className="ifz-loading-state" aria-live="polite">
            <div className="loading-spinner" aria-hidden="true" />
            <p>Hydrating worker manifests and context package…</p>
          </div>
        ) : events.length === 0 ? (
          <div className="ifz-empty-state">
            <div className="empty-glyph-icon" aria-hidden="true">
              <SparkleIcon />
            </div>
            <h2 className="empty-heading">Ready for instruction</h2>
            <p className="empty-sub">
              Every request routes through IFZ. Select an example prompt or enter instructions into the composer below.
            </p>
            <div className="empty-prompts-grid" role="region" aria-label="Example prompt templates">
              <button
                type="button"
                className="empty-prompt-card"
                onClick={() => handlePresetPrompt('Refactor dock-island.jsx to mount unified Work destination')}
                title="Load example prompt for dock refactor into composer"
                aria-label="Load example prompt: Refactor navigation dock"
              >
                <span className="card-tag">EXAMPLE TEMPLATE · UI</span>
                <strong>Refactor navigation dock</strong>
                <small>Example prompt · Routing planned by IFZ upon dispatch</small>
              </button>
              <button
                type="button"
                className="empty-prompt-card"
                onClick={() => handlePresetPrompt('Verify pointer lease mechanics on Windows desktop')}
                title="Load example prompt for pointer lease into composer"
                aria-label="Load example prompt: Verify pointer lease"
              >
                <span className="card-tag">EXAMPLE TEMPLATE · DESKTOP</span>
                <strong>Verify pointer lease</strong>
                <small>Example prompt · Routing planned by IFZ upon dispatch</small>
              </button>
              <button
                type="button"
                className="empty-prompt-card"
                onClick={() => handlePresetPrompt('Run independent RCT verification on smart status controller')}
                title="Load example prompt for review chain into composer"
                aria-label="Load example prompt: Independent review chain"
              >
                <span className="card-tag">EXAMPLE TEMPLATE · VERIFICATION</span>
                <strong>Independent review chain</strong>
                <small>Example prompt · Routing planned by IFZ upon dispatch</small>
              </button>
            </div>
          </div>
        ) : (
          <div className="ifz-events-list">
            {events.map((ev, index) => (
              <ConversationEventCard
                key={ev.id || index}
                event={ev}
                expandedBranches={expandedBranches}
                onToggleBranch={branchId => model.toggleBranch(branchId)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Floating Prompt Bar Composer at bottom */}
      <footer className="ifz-prompt-bar-footer">
        <IfzPromptBar
          draft={draft}
          routePreview={routePreview}
          availablePresets={availablePresets}
          availableWorkers={availableWorkers}
          savedWorkflows={savedWorkflows}
          isRunning={isRunning}
          onSetDraft={partial => model.setDraft(partial)}
          onSetRouteMode={mode => model.setRouteMode(mode)}
          onToggleManualWorker={wId => model.toggleManualWorker(wId)}
          onSetPreset={pId => model.setPreset(pId)}
          onSetSavedWorkflow={wfId => model.setSavedWorkflow(wfId)}
          onAddAttachment={att => model.addAttachment(att)}
          onRemoveAttachment={id => model.removeAttachment(id)}
          onSubmitPrompt={() => model.submitPrompt()}
          onStopActiveRun={() => model.stopActiveRun()}
        />
      </footer>
    </div>
  );
}

/**
 * Event card within the unified conversation stream.
 */
function ConversationEventCard({ event, expandedBranches, onToggleBranch }) {
  const { type, source, target, timestamp, content, details, branchId, subEvents, verified } = event;
  const isBranchExpanded = branchId ? expandedBranches.includes(branchId) : false;

  return (
    <article className={`ifz-event-card type-${type}`} aria-label={`${type} from ${source}`}>
      <div className="event-header">
        <div className="event-source-tag">
          <span className="source-name">{source}</span>
          {target && (
            <>
              <span className="route-arrow-icon" aria-hidden="true">
                <ArrowRightIcon />
              </span>
              <span className="target-name">{target}</span>
            </>
          )}
        </div>
        <span className="event-type-badge">{type.replace('_', ' ')}</span>
        {timestamp && (
          <time className="event-time" dateTime={timestamp}>
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </time>
        )}
      </div>

      <div className="event-content">
        <p className="content-text">{content}</p>
        {details && <p className="content-details">{details}</p>}
      </div>

      {/* Independent Verification Stamp */}
      {type === 'verification_result' && (
        <div
          className={`verification-stamp ${verified ? 'verified' : 'failed'}`}
          title={verified ? 'Independently checked and proven' : 'Verification failed'}
        >
          <span className="stamp-icon" aria-hidden="true">
            {verified ? <CheckCircleIcon /> : <XCircleIcon />}
          </span>
          <span>{verified ? 'INDEPENDENTLY VERIFIED & ACCEPTED' : 'VERIFICATION FAILED'}</span>
        </div>
      )}

      {/* Expandable Worker Branch (without exposing private reasoning) */}
      {branchId && subEvents && subEvents.length > 0 && (
        <div className="worker-branch-section">
          <button
            type="button"
            className="branch-toggle-btn"
            onClick={() => onToggleBranch(branchId)}
            aria-expanded={isBranchExpanded}
            title={`${isBranchExpanded ? 'Collapse' : 'Expand'} worker sub-task branch`}
            aria-label={`${isBranchExpanded ? 'Collapse' : 'Expand'} worker branch ${branchId}`}
          >
            <span className="branch-chevron-icon" aria-hidden="true">
              {isBranchExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            </span>
            <span className="branch-label">Worker Sub-task Branch</span>
            <span className="branch-count">({subEvents.length} public updates)</span>
          </button>

          {isBranchExpanded && (
            <div className="branch-subevents-list" role="region" aria-label="Worker branch updates">
              {subEvents.map(sub => (
                <div key={sub.id} className={`branch-subevent type-${sub.type}`}>
                  <div className="subevent-meta">
                    <span className="subevent-source">{sub.source}</span>
                    <span className="subevent-type">{sub.type.replace('_', ' ')}</span>
                  </div>
                  <div className="subevent-content">{sub.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
