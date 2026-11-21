import { it, expect } from "vitest";
import { clampDock, reportText, safeRoute } from "../src/dev/report";
import { Controller } from "../src/application/controller";
import { SaveStore } from "../src/storage/save";
import { newSession } from "../src/application/session";
import { levels } from "../src/domain/campaign";
it("keeps the draggable button in view including corrupt stored coordinates", () => {
  expect(clampDock({ x: 999, y: -99 }, 320, 568)).toEqual({ x: 256, y: 8 });
  expect(clampDock({ x: NaN, y: Infinity }, 320, 568)).toEqual({ x: 8, y: 8 });
});
it("reports only explicit safe context and strips unrecognized routes", () => {
  expect(safeRoute("#play/60")).toBe("play/60");
  expect(safeRoute("#account?token=SECRET")).toBe("unrecognized");
  const report = reportText({
    summary: " Bug ",
    details: "Steps",
    severity: "major",
    route: "#account?token=SECRET",
    width: 390,
    height: 844,
    scale: 2,
    reducedMotion: true,
    errors: 2,
    sandboxLevel: null,
  });
  expect(report).not.toContain("SECRET");
  expect(JSON.parse(report).summary).toBe("Bug");
});
it("sandbox practice never awards currency or writes campaign storage", () => {
  const level = levels[0],
    data = new Map([
      ["sandbox", JSON.stringify(newSession(level, "dev", "practice"))],
    ]);
  const c = new Controller(
    level,
    new SaveStore(
      {
        getItem: (k) => data.get(k) ?? null,
        setItem: (k, v) => {
          data.set(k, v);
        },
      },
      level,
      "sandbox",
    ),
    () => crypto.randomUUID(),
    false,
  );
  for (const id of level.solution) c.select(id);
  expect(c.state.status).toBe("complete");
  expect(c.state.coins).toBe(0);
  expect(c.state.bestStars).toBe(0);
  expect([...data.keys()].every((k) => k.startsWith("sandbox"))).toBe(true);
});
import { emailDraft, screenshotError } from "../src/dev/email";
it("creates an addressed draft with UTF-8 report and exact screenshot bytes", async () => {
  const bytes = new Uint8Array([137,80,78,71]);
  const file = {type:"image/png",size:4,arrayBuffer:async()=>bytes.buffer} as File;
  const draft = await emailDraft("Broken → arrow\r\nBcc: evil", "Details →", file);
  expect(draft).toContain("To: interfrozt.vym@gmail.com\r\n");
  expect(draft).toContain("X-Unsent: 1");
  expect(draft).toContain('filename="screenshot.png"');
  expect(draft).toContain("iVBORw==");
  expect(draft).not.toContain("\r\nBcc:");
  expect(screenshotError({type:"image/svg+xml",size:4})).toBeTruthy();
  expect(screenshotError({type:"image/png",size:6*1024*1024})).toBeTruthy();
  expect(await emailDraft("Bug", "Report", null)).not.toContain("screenshot.");
});
