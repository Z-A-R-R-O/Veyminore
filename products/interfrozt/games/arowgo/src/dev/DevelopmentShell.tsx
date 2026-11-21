import { useEffect, useRef, useState, type ReactNode } from "react";
import { Controller } from "../application/controller";
import { newSession } from "../application/session";
import { SaveStore } from "../storage/save";
import { levels, levelNames } from "../domain/campaign";
import { App } from "../ui/App";
import { clampDock, reportText, type Point } from "./report";
import { emailDraft, reportRecipient, screenshotError } from "./email";
import "./development.css";
const positionKey = "arowgo.dev.dock.v1";
function readPosition() {
  try {
    return clampDock(
      JSON.parse(localStorage.getItem(positionKey) ?? "null") ?? {
        x: innerWidth - 72,
        y: innerHeight - 164,
      },
      innerWidth,
      innerHeight,
    );
  } catch {
    return clampDock(
      { x: innerWidth - 72, y: innerHeight - 164 },
      innerWidth,
      innerHeight,
    );
  }
}
function makeSandbox(index: number) {
  const level = levels[index],
    key = "sandbox",
    data = new Map([
      [key, JSON.stringify(newSession(level, crypto.randomUUID(), "practice"))],
    ]);
  return new Controller(
    level,
    new SaveStore(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      level,
      key,
    ),
    () => crypto.randomUUID(),
    false,
  );
}
export function DevelopmentShell({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(() => {
    try {
      return localStorage.getItem("arowgo.dev.enabled") !== "0";
    } catch {
      return true;
    }
  });
  const [position, setPosition] = useState(readPosition),
    pos = useRef(position);
  const drag = useRef<{
      id: number;
      x: number;
      y: number;
      origin: Point;
      moved: boolean;
    } | null>(null),
    suppress = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<"tools" | "report">("tools");
  const [outlines, setOutlines] = useState(false),
    [level, setLevel] = useState(1),
    [sandbox, setSandbox] = useState<Controller | null>(null);
  const [summary, setSummary] = useState(""),
    [details, setDetails] = useState(""),
    [severity, setSeverity] = useState("minor"),
    [notice, setNotice] = useState("");
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  useEffect(() => {
    if (!screenshot) { setPreview(""); return; }
    const url = URL.createObjectURL(screenshot);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [screenshot]);
  async function draft() {
    try {
      const content = await emailDraft(summary, buildReport(), screenshot);
      const url = URL.createObjectURL(new Blob([content], { type: "message/rfc822" }));
      const a = document.createElement("a");
      a.href = url; a.download = "arowgo-bug-report.eml"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice("Email draft downloaded. Open it in your mail app, review and send. If your app opens it read-only, use Forward to the address above.");
    } catch { setNotice("Could not create the draft. Try again or use Copy report."); }
  }
  const [sandboxKey, setSandboxKey] = useState(0);
  const errorCount = useRef(0);
  function move(point: Point, save = false) {
    const p = clampDock(point, innerWidth, innerHeight);
    pos.current = p;
    setPosition(p);
    if (save)
      try {
        localStorage.setItem(positionKey, JSON.stringify(p));
      } catch {}
  }
  useEffect(() => {
    const resize = () => move(pos.current, true);
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    const error = () => {
      errorCount.current++;
    };
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", error);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", error);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle(
      "dev-layout-outlines",
      enabled && outlines,
    );
    return () =>
      document.documentElement.classList.remove("dev-layout-outlines");
  }, [enabled, outlines]);
  function mode(value: boolean) {
    setEnabled(value);
    if (!value) {
      setSandbox(null);
      setOutlines(false);
    }
    try {
      localStorage.setItem("arowgo.dev.enabled", value ? "1" : "0");
    } catch {}
  }
  function launch() {
    setSandbox(makeSandbox(level - 1));
    setSandboxKey((k) => k + 1);
    dialog.current?.close();
  }
  function buildReport() {
    const match = /^#\/?play\/(\d+)$/.exec(location.hash),
      current =
        sandbox?.level ?? (match ? levels[Number(match[1]) - 1] : undefined);
    return reportText({
      summary,
      details,
      severity,
      route: location.hash,
      width: innerWidth,
      height: innerHeight,
      scale: devicePixelRatio,
      reducedMotion: matchMedia("(prefers-reduced-motion: reduce)").matches,
      errors: errorCount.current,
      sandboxLevel: sandbox ? levels.indexOf(sandbox.level) + 1 : null,
      levelId: current?.levelId,
      contentVersion: current?.contentVersion,
      active: sandbox?.state.active,
    });
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(buildReport());
      setNotice("Report copied.");
    } catch {
      setNotice("Clipboard unavailable. Use Download report instead.");
    }
  }
  function download() {
    const url = URL.createObjectURL(
        new Blob([buildReport()], { type: "application/json" }),
      ),
      a = document.createElement("a");
    a.href = url;
    a.download = `arowgo-bug-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Report downloaded.");
  }
  return (
    <>
      {sandbox ? (
        <>
          <App
            key={sandboxKey}
            controller={sandbox}
            levelNumber={levels.indexOf(sandbox.level) + 1}
            devSandbox
            onHome={() => setSandbox(null)}
          />
          <button
            className="dev-sandbox-label"
            onClick={() => setSandbox(null)}
          >
            SANDBOX · No rewards or saves · Exit
          </button>
        </>
      ) : (
        children
      )}
      <button
        className="dev-dock"
        style={{ left: position.x, top: position.y }}
        aria-label="Developer tools and bug report"
        title="Drag to move. Arrow keys move this button."
        data-enabled={enabled}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = {
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            origin: pos.current,
            moved: false,
          };
          suppress.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const dx = e.clientX - d.x,
            dy = e.clientY - d.y;
          if (Math.hypot(dx, dy) > 6) d.moved = true;
          if (d.moved) move({ x: d.origin.x + dx, y: d.origin.y + dy });
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          suppress.current = d.moved;
          drag.current = null;
          move(pos.current, true);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          suppress.current = true;
        }}
        onKeyDown={(e) => {
          const offset = e.shiftKey ? 40 : 12;
          const delta: Record<string, Point> = {
            ArrowLeft: { x: -offset, y: 0 },
            ArrowRight: { x: offset, y: 0 },
            ArrowUp: { x: 0, y: -offset },
            ArrowDown: { x: 0, y: offset },
          };
          if (delta[e.key]) {
            e.preventDefault();
            move(
              {
                x: pos.current.x + delta[e.key].x,
                y: pos.current.y + delta[e.key].y,
              },
              true,
            );
          } else if (e.key === "Enter" || e.key === " ")
            suppress.current = false;
        }}
        onClick={() => {
          if (suppress.current) {
            suppress.current = false;
            return;
          }
          setNotice("");
          dialog.current?.showModal();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 5 7 2m8 3 2-3M4 9h3m10 0h3M3 15h4m10 0h4M6 22l3-4m9 4-3-4" />
          <rect x="7" y="5" width="10" height="15" rx="5" />
          <path d="M12 9v10M8 10h8" />
        </svg>
        <span>DEV</span>
      </button>
      <dialog ref={dialog} className="dev-panel" aria-labelledby="dev-title">
        <header>
          <div>
            <small>AROWGO · DEVELOPMENT ONLY</small>
            <h2 id="dev-title">Developer tools</h2>
          </div>
          <button
            aria-label="Close developer tools"
            onClick={() => dialog.current?.close()}
          >
            ×
          </button>
        </header>
        <nav aria-label="Developer sections">
          <button
            aria-pressed={tab === "tools"}
            onClick={() => setTab("tools")}
          >
            Tools
          </button>
          <button
            aria-pressed={tab === "report"}
            onClick={() => setTab("report")}
          >
            Bug report
          </button>
        </nav>
        {tab === "tools" ? (
          <section>
            <label className="dev-switch">
              <span>Development mode</span>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => mode(e.target.checked)}
              />
            </label>
            <p>
              Test any level in an isolated, in-memory Practice session.
              Campaign progress, wallets and cloud saves are not changed.
            </p>
            <label>
              Level
              <select
                aria-label="Sandbox level"
                value={level}
                disabled={!enabled}
                onChange={(e) => setLevel(Number(e.target.value))}
              >
                {levels.map((l, i) => (
                  <option key={l.levelId} value={i + 1}>
                    {i + 1} · {levelNames[i]}
                  </option>
                ))}
              </select>
            </label>
            <div className="dev-actions">
              <button disabled={!enabled} onClick={launch}>
                Open sandbox
              </button>
              {sandbox && (
                <button
                  onClick={() => {
                    setSandbox(null);
                    dialog.current?.close();
                  }}
                >
                  Exit sandbox
                </button>
              )}
            </div>
            {sandbox && (
              <button
                disabled={!enabled}
                onClick={() => {
                  sandbox.hint("analyze");
                  dialog.current?.close();
                }}
              >
                Show safe moves
              </button>
            )}
            <label className="dev-switch">
              <span>Show layout outlines</span>
              <input
                type="checkbox"
                checked={outlines}
                disabled={!enabled}
                onChange={(e) => setOutlines(e.target.checked)}
              />
            </label>
            <button
              onClick={() =>
                move({ x: innerWidth - 72, y: innerHeight - 164 }, true)
              }
            >
              Reset button position
            </button>
            <p className="dev-muted">
              Drag the bug button anywhere. Keyboard: arrow keys move it; Shift
              moves farther. Your position is remembered.
            </p>
          </section>
        ) : (
          <section>
            <p>
              Send your report to {reportRecipient}. Nothing is sent until you review and send it in your mail app.
            </p>
            <label>
              Summary
              <input
                value={summary}
                maxLength={120}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What went wrong?"
              />
            </label>
            <label>
              Severity
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
              >
                <option value="minor">Minor · visual or polish</option>
                <option value="major">Major · wrong behavior</option>
                <option value="blocker">Blocker · cannot continue</option>
              </select>
            </label>
            <label>
              Steps and expected behavior
              <textarea
                value={details}
                maxLength={4000}
                rows={5}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="1. Open… 2. Tap… Expected… Actual…"
              />
            </label>
            <label>
              Add screenshot (PNG, JPEG or WebP · up to 5 MB)
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                const error = screenshotError(file);
                if (error) { setNotice(error); return; }
                setScreenshot(file); setNotice("");
              }} />
            </label>
            {screenshot && <div className="dev-screenshot">
              <img src={preview} alt="Bug report screenshot preview" />
              <button onClick={() => setScreenshot(null)}>Remove screenshot</button>
            </div>}
            <p className="dev-muted">Review your screenshot for private information. It stays in memory until you download the email draft.</p>
            <div className="dev-actions">
              <button disabled={!summary.trim()} onClick={draft}>Download email with attachments</button>
              <button disabled={!summary.trim()} onClick={() => {
                location.href = `mailto:${reportRecipient}?subject=${encodeURIComponent("AROWGO bug: " + summary)}&body=${encodeURIComponent(buildReport())}`;
                setNotice("Email composer requested. Browser email links cannot attach screenshots; attach your image manually or use the downloaded email draft.");
              }}>Open email app</button>
            </div>
            <p className="dev-muted">
              Includes screen size, route, level version and error count. No
              account data, balances, tokens, save files or console messages are
              collected.
            </p>
            <div className="dev-actions">
              <button disabled={!summary.trim()} onClick={copy}>
                Copy report
              </button>
              <button disabled={!summary.trim()} onClick={download}>
                Download report
              </button>
            </div>
            <p role="status">{notice}</p>
          </section>
        )}
      </dialog>
    </>
  );
}
