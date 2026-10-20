import React, { useState, useEffect, useRef } from 'react';
import { createIfzWorkModel, MASTER_PRESETS, EFFORT_LEVELS } from './ifz-work-model.js';
import IfzPromptBar from './ifz-prompt-bar.jsx';
import WakeSlider from './components/WakeSlider.jsx';
import GradientText from './components/GradientText.jsx';

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

function EffortSparkleIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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

function ShieldIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
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

/**
 * Isolated IFZ Work Page Component.
 *
 * Invariants:
 * - Default model is empty/unknown and never assumed running/connected without evidence.
 * - Developer fixture selector is hidden by default; exposed only through explicit devLab option.
 * - All controls use accessible inline SVGs with tooltips and aria-labels.
 * - Route suggestions populate draft but never auto-send.
 * - Live submit is visibly truthful (dry-run preview).
 * - Full 4-layer Master Prompt inspector (Charter, Worker Knowledge, Project Context, Task Package).
 */
export default function IfzWorkPage({
  initialFixture = null,
  initialDraft = null,
  devLab = false,
  modelInstance = null
}) {
  const [model] = useState(() => modelInstance || createIfzWorkModel({ initialFixture, initialDraft, devLab }));
  const [snapshot, setSnapshot] = useState(() => model.getSnapshot());
  const [showMasterPrompt, setShowMasterPrompt] = useState(false);
  const [activeMasterPromptTab, setActiveMasterPromptTab] = useState('charter');

  useEffect(() => {
    const unsubscribe = model.subscribe(newSnap => {
      setSnapshot(newSnap);
    });
    return unsubscribe;
  }, [model]);

  // Global Esc hotkey handler for modal
  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'Escape' && showMasterPrompt) {
        setShowMasterPrompt(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showMasterPrompt]);

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
    savedWorkflows
  } = snapshot;

  const isRunning = status === 'running';

  const currentEffortName = draft?.effort || 'High';
  const activeEffortIndex = Math.max(
    0,
    EFFORT_LEVELS.findIndex(
      lvl => lvl.name.toLowerCase() === currentEffortName.toLowerCase() || lvl.id === currentEffortName.toLowerCase()
    )
  );
  const activeEffortObj = EFFORT_LEVELS[activeEffortIndex] || EFFORT_LEVELS[2];

  return (
    <div
      className={`ifz-work-page ${events.length === 0 && !activeRun ? 'is-empty' : 'is-active'}`}
      data-status={status}
      data-connection={connection}
    >
      {/* Top Header Strip */}
      <header className={`ifz-work-header ${events.length === 0 && !activeRun ? 'empty-header' : 'active-header'}`}>
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

            {/* Master Prompt Inspector Pill Trigger */}
            <button
              type="button"
              className="header-master-prompt-pill"
              onClick={() => setShowMasterPrompt(true)}
              title="Open Master Prompt 4-layer inspector"
              aria-label="Open Master Prompt inspector"
            >
              <span className="shield-icon" aria-hidden="true"><ShieldIcon /></span>
              <span className="pill-label">Master Prompt:</span>
              <span className="pill-name">{routePreview.preset}</span>
              <span className="pill-ver">v1.2.0</span>
            </button>

            {activeRun && (
              <span className="run-id-pill" title={`Active run identifier: ${activeRun.runId}`}>
                Run #{activeRun.runId}
              </span>
            )}
          </div>

          {(events.length > 0 || activeRun) && (
            <div className="header-titles">
              <h1 className="header-title">{title}</h1>
              {subtitle && <p className="header-subtitle">{subtitle}</p>}
            </div>
          )}
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
              <option value="complete">Complete &amp; Verified</option>
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
            <h2 className="empty-startup-line">
              <GradientText
                colors={['#d9e9e6', 'var(--green, #8ce6b8)', '#a9c6ee', '#c7afe8']}
                animationSpeed={8}
                variant="flow"
                glow={0.24}
              >
                Evolve. Way Far Beyond.
              </GradientText>
            </h2>
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
      <div className="ifz-prompt-bar-footer" role="region" aria-label="Prompt composer">
        <IfzPromptBar
          draft={draft}
          effort={draft?.effort || 'High'}
          onSetEffort={eff => model.setEffort(eff)}
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
          onOpenMasterPrompt={() => setShowMasterPrompt(true)}
        />
      </div>

      {/* Master Prompt 4-Layer Modal Inspector */}
      {showMasterPrompt && (
        <MasterPromptModal
          activeTab={activeMasterPromptTab}
          onSelectTab={setActiveMasterPromptTab}
          onClose={() => setShowMasterPrompt(false)}
          activePresetId={draft.presetId}
          onSelectPreset={pId => model.setPreset(pId)}
          activeEffortObj={activeEffortObj}
          activeEffortIndex={activeEffortIndex}
          onSelectEffort={eff => model.setEffort(eff)}
          availablePresets={availablePresets}
          availableWorkers={availableWorkers}
          routePreview={routePreview}
          draft={draft}
        />
      )}
    </div>
  );
}

/**
 * Master Prompt 4-Layer Inspector Modal Component.
 * Implements the four constitutional layers from docs/IFZ-UNIFIED-APP-ARCHITECTURE.md:
 * 1. ZETRO Charter
 * 2. Worker Knowledge
 * 3. Project Context
 * 4. Task Package
 */
function MasterPromptModal({
  activeTab,
  onSelectTab,
  onClose,
  activePresetId,
  onSelectPreset,
  activeEffortObj,
  activeEffortIndex,
  onSelectEffort,
  availablePresets,
  availableWorkers,
  routePreview,
  draft
}) {
  return (
    <div
      className="master-prompt-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Master Prompt and Authority Inspector"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="master-prompt-modal-container">
        {/* Modal Header */}
        <div className="mp-modal-header">
          <div className="mp-header-left">
            <span className="mp-shield-icon" aria-hidden="true"><ShieldIcon /></span>
            <div>
              <div className="mp-header-title-row">
                <h3 className="mp-modal-title">Master Prompt &amp; Authority Inspector</h3>
                <span className="mp-version-tag">Version 1.2.0</span>
                <span className="mp-preset-badge">{routePreview.preset}</span>
              </div>
              <p className="mp-modal-subtitle">
                Inspect the four constitutional prompt layers and select guidance presets.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mp-close-btn"
            onClick={onClose}
            title="Close inspector (Esc)"
            aria-label="Close inspector"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="mp-modal-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'charter'}
            className={`mp-tab-btn ${activeTab === 'charter' ? 'active' : ''}`}
            onClick={() => onSelectTab('charter')}
          >
            <span className="tab-num">1</span>
            <span>ZETRO Charter</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'knowledge'}
            className={`mp-tab-btn ${activeTab === 'knowledge' ? 'active' : ''}`}
            onClick={() => onSelectTab('knowledge')}
          >
            <span className="tab-num">2</span>
            <span>Worker Knowledge</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'context'}
            className={`mp-tab-btn ${activeTab === 'context' ? 'active' : ''}`}
            onClick={() => onSelectTab('context')}
          >
            <span className="tab-num">3</span>
            <span>Project Context</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'task'}
            className={`mp-tab-btn ${activeTab === 'task' ? 'active' : ''}`}
            onClick={() => onSelectTab('task')}
          >
            <span className="tab-num">4</span>
            <span>Task Package</span>
          </button>
        </div>

        {/* Modal Body / Tab Content */}
        <div className="mp-modal-body">
          {activeTab === 'charter' && (
            <div className="mp-layer-pane">
              <div className="layer-intro-card">
                <h4>Layer 1: Constitutional Authority</h4>
                <p>
                  The Charter defines product purpose, IFZ authority, verification rules, privacy rules,
                  and delegation limits. Only the user can replace the Charter.
                </p>
              </div>

              <div className="charter-principles-grid">
                <div className="principle-card">
                  <span className="p-num">01</span>
                  <h5>Central Orchestration</h5>
                  <p>All worker assignments and inter-worker requests flow through IFZ. Workers do not communicate directly.</p>
                </div>
                <div className="principle-card">
                  <span className="p-num">02</span>
                  <h5>Independent Verification</h5>
                  <p>Completion requires external evidence, receipts, and check passes. Self-reported completion is strictly rejected.</p>
                </div>
                <div className="principle-card">
                  <span className="p-num">03</span>
                  <h5>Zero Secret Leakage</h5>
                  <p>Credentials, auth tokens, and raw private model reasoning are strictly prohibited in context packages.</p>
                </div>
                <div className="principle-card">
                  <span className="p-num">04</span>
                  <h5>Strict Authority Ceilings</h5>
                  <p>Sub-delegation and presets may narrow work but can never expand authority, scopes, or token budgets.</p>
                </div>
                <div className="principle-card">
                  <span className="p-num">05</span>
                  <h5>Exact Workspace Admittance</h5>
                  <p>All tool effects and file modifications are constrained to canonical project workspace boundaries.</p>
                </div>
                <div className="principle-card">
                  <span className="p-num">06</span>
                  <h5>Bounded Delegation</h5>
                  <p>Maximum delegation depth is capped at 2. No circular routes or repeated worker-task pairs are admitted.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'knowledge' && (
            <div className="mp-layer-pane">
              <div className="layer-intro-card">
                <h4>Layer 2: Worker Knowledge &amp; Capability Contracts</h4>
                <p>
                  ZETRO dynamically generates this layer from the worker registry. It informs fresh workers
                  of admitted peer identities, tool contracts, message protocols, and receipt formats.
                </p>
              </div>

              <div className="workers-knowledge-grid">
                {availableWorkers.map(w => (
                  <div key={w.id} className="worker-knowledge-card">
                    <div className="w-card-header">
                      <span className="w-name">{w.name}</span>
                      <span className={`w-status-tag ${w.available ? 'online' : 'offline'}`}>
                        {w.available ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <div className="w-role">{w.role}</div>
                    <div className="w-meta">
                      <span>Adapter: <strong>{w.adapter}</strong></span>
                      <span>Envelopes: <strong>IFZ v1.2</strong></span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'context' && (
            <div className="mp-layer-pane">
              <div className="layer-intro-card">
                <h4>Layer 3: Bounded Project Context</h4>
                <p>
                  Versioned and bounded repository context. A fresh worker does not receive an uncontrolled
                  full transcript. Maximum 50 items per category with exact workspace verification.
                </p>
              </div>

              <div className="context-sections">
                <div className="context-item-card">
                  <span className="c-label">CANONICAL WORKSPACE:</span>
                  <code>{routePreview.authorityScope || 'zetro-workspace (Canonical Admittance)'}</code>
                </div>
                <div className="context-item-card">
                  <span className="c-label">CURRENT MILESTONE:</span>
                  <p>IFZ Unified App Architecture · Work Page &amp; Master Prompt System Refactor</p>
                </div>
                <div className="context-item-card">
                  <span className="c-label">ACCEPTED BOUNDARIES:</span>
                  <p>Six canonical routes (work, workers, runs, computer, evidence, settings), fixed floating dock navigation, 100% zero-overlap layout.</p>
                </div>
                <div className="context-item-card">
                  <span className="c-label">VERIFICATION MANDATE:</span>
                  <p>All modifications require automated test verification, zero lint regressions, and independent receipt records.</p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'task' && (
            <div className="mp-layer-pane">
              <div className="layer-intro-card">
                <h4>Layer 4: Task Package Envelope</h4>
                <p>
                  The exact dispatch envelope packaging the request, route position, allowed actions,
                  limits, checks, and required output format.
                </p>
              </div>

              <div className="task-envelope-box">
                <div className="envelope-row">
                  <span className="e-key">Active Preset:</span>
                  <span className="e-val highlight">{routePreview.preset}</span>
                </div>
                <div className="envelope-row">
                  <span className="e-key">Route Strategy:</span>
                  <span className="e-val">{routePreview.strategy}</span>
                </div>
                <div className="envelope-row">
                  <span className="e-key">Dispatch Chain:</span>
                  <span className="e-val">{routePreview.chips.join('  ➔  ')}</span>
                </div>
                <div className="envelope-row">
                  <span className="e-key">Draft Objective:</span>
                  <span className="e-val">{draft.text.trim() || '(No draft content entered yet)'}</span>
                </div>
                <div className="envelope-row effort-envelope-row">
                  <span className="e-key">Reasoning Effort:</span>
                  <div className="envelope-effort-inline">
                    <div className="envelope-effort-head">
                      <span className="e-val highlight">{activeEffortObj.name} ({activeEffortObj.label})</span>
                      <span className="envelope-effort-desc">{activeEffortObj.desc}</span>
                    </div>
                    <div className="envelope-wakeslider-box">
                      <WakeSlider
                        value={activeEffortIndex}
                        min={0}
                        max={4}
                        step={1}
                        bars={30}
                        height={42}
                        restHeight={9}
                        gap={3}
                        fillColor="var(--accent, #8ce6b8)"
                        trackColor="rgba(255, 255, 255, 0.08)"
                        crestColor="#c4ffdf"
                        sensitivity={1.1}
                        reach={5}
                        onChange={val => {
                          const lvl = EFFORT_LEVELS[Math.round(val)];
                          if (lvl) onSelectEffort?.(lvl.name);
                        }}
                        ariaLabel="Master Prompt Reasoning Effort"
                      />
                    </div>
                  </div>
                </div>
                <div className="envelope-row">
                  <span className="e-key">Budget Ceilings:</span>
                  <span className="e-val">Max Depth: 2 · Max Parallel Branches: 4 · Timeout: 300s</span>
                </div>
                <div className="envelope-row">
                  <span className="e-key">Receipt Requirement:</span>
                  <span className="e-val">Markdown execution receipt with focused test command output</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer: Preset Switcher */}
        <div className="mp-modal-footer">
          <div className="preset-switcher-header">
            <span className="switcher-title">Switch Master Prompt Preset:</span>
            <span className="switcher-desc">Presets alter task guidance without weakening authority or security policy.</span>
          </div>

          <div className="presets-cards-row">
            {(availablePresets || MASTER_PRESETS).map(preset => {
              const isSelected = activePresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={`preset-select-card ${isSelected ? 'active' : ''}`}
                  onClick={() => onSelectPreset(preset.id)}
                  title={`${preset.name}: ${preset.desc}`}
                  aria-pressed={isSelected}
                >
                  <div className="p-card-top">
                    <span className="p-card-name">{preset.name}</span>
                    {isSelected && <span className="p-active-badge">ACTIVE</span>}
                  </div>
                  <div className="p-card-desc">{preset.desc}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
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
