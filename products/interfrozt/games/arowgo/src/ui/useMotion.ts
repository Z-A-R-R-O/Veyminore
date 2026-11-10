import { useEffect, useState } from "react";

export const MOTION_KEY = "arowgo.motion.v1";
type Preferences = { reduced: boolean; rich: boolean };
function load(): Preferences {
  try {
    const raw = JSON.parse(localStorage.getItem(MOTION_KEY) ?? "null");
    if (
      raw &&
      typeof raw.reduced === "boolean" &&
      typeof raw.rich === "boolean"
    )
      return raw;
  } catch {
    /* Storage is optional. */
  }
  return { reduced: false, rich: true };
}
export function useMotion() {
  const [preferences, setPreferences] = useState(load);
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hidden, setHidden] = useState(document.hidden);
  useEffect(() => {
    const query = matchMedia("(prefers-reduced-motion: reduce)");
    const change = () => setSystemReduced(query.matches);
    const visibility = () => setHidden(document.hidden);
    const sync = () => setPreferences(load());
    window.addEventListener("arowgo-preferences", sync);
    query.addEventListener("change", change);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("arowgo-preferences", sync);
      query.removeEventListener("change", change);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  function update(next: Partial<Preferences>) {
    const value = { ...preferences, ...next };
    setPreferences(value);
    try {
      localStorage.setItem(MOTION_KEY, JSON.stringify(value));
      window.dispatchEvent(new Event("arowgo-preferences"));
    } catch {
      /* Keep the preference for this session. */
    }
  }
  return {
    reduced: preferences.reduced || systemReduced,
    rich: preferences.rich,
    hidden,
    systemReduced,
    update,
  };
}
