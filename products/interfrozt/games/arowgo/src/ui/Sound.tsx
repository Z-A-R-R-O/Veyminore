import { useSyncExternalStore } from "react";

const key = "arowgo.sound.v1";
let enabled = false;
try {
  enabled = localStorage.getItem(key) === "on";
} catch {
  /* Memory-only preference. */
}
const listeners = new Set<() => void>();
let context: AudioContext | undefined;
const clips = {
  click: new Audio("/audio/arrow-collapse.mp3"),
  win: new Audio("/audio/victory.mp3"),
  defeat: new Audio("/audio/defeat.mp3"),
};
Object.values(clips).forEach((clip) => {
  clip.preload = "auto";
  clip.volume = 0.45;
});
function stopClips() {
  Object.values(clips).forEach((clip) => {
    clip.pause();
    clip.currentTime = 0;
  });
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};
export async function playSound(
  kind: "click" | "blocked" | "win" | "hint" | "defeat",
) {
  if (!enabled || document.hidden) return;
  try {
    if (
      kind === "click" ||
      kind === "win" ||
      kind === "defeat"
    ) {
      const clip = clips[kind];
      clip.currentTime = 0;
      void clip.play().catch(() => {});
      return;
    }
    context ??= new AudioContext();
    await context.resume();
    if (!enabled || document.hidden) return;
    const notes = kind === "blocked" ? [180, 130] : [659, 880];
    notes.forEach((frequency, i) => {
      const oscillator = context!.createOscillator();
      const gain = context!.createGain();
      const start = context!.currentTime + i * 0.09;
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.045, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.17);
      oscillator.connect(gain).connect(context!.destination);
      oscillator.start(start);
      oscillator.stop(start + 0.18);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
    });
  } catch {
    /* Audio support must never block a move. */
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopClips();
    void context?.suspend().catch(() => {});
  }
});
export function SoundSetting() {
  const active = useSyncExternalStore(subscribe, () => enabled);
  return (
    <label className="setting">
      <span>
        <strong>Sound effects</strong>
        <small>Arrow pops and reward tones</small>
      </span>
      <input
        type="checkbox"
        checked={active}
        onChange={(event) => {
          enabled = event.target.checked;
          try {
            localStorage.setItem(key, enabled ? "on" : "off");
          } catch {
            /* Keep preference in memory. */
          }
          listeners.forEach((fn) => fn());
          if (enabled) void playSound("click");
          else {
            stopClips();
            void context?.suspend().catch(() => {});
          }
        }}
      />
    </label>
  );
}
