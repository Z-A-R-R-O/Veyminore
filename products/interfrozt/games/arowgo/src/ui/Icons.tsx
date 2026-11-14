import { useId } from "react";
export type IconName =
  | "arrow"
  | "reset"
  | "bulb"
  | "analyze"
  | "erase"
  | "leaf"
  | "close"
  | "settings"
  | "home"
  | "gamepad"
  | "profile"
  | "shop";
export function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, string> = {
    profile: "M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3Z",
    shop: "M4 3h16l2 7H2l2-7Zm0 7v11h16V10M9 21v-7h6v7",
    gamepad:
      "M8 7h8c3 0 4 2 5 8s-2 6-5 2H8c-3 4-6 4-5-2s2-8 5-8Zm-1 3v6m-3-3h6m5-2h.01m3 3h.01",
    arrow: "M5 17V7h14m-5-5 5 5-5 5",
    reset: "M4 10a8 8 0 1 1 1 8M4 3v7h7",
    bulb: "M9 18h6m-5 4h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 4H9c0-2 0-3-1-4",
    analyze: "M3 20 20 3v17H3Zm7-4h6v-6Z",
    erase:
      "m4 13 10-10a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3L11 20H7l-4-4a2 2 0 0 1 1-3Zm4-4 8 8M12 21h10",
    leaf: "M20 3C7 1 2 10 7 16s15 0 13-13ZM5 21 16 8",
    close: "m6 6 12 12M6 18 18 6",
    settings:
      "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3Zm6 9a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z",
    home: "m3 11 9-8 9 8M5 10v11h5v-7h4v7h5V10",
  };
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function Heart({ filled }: { filled: boolean }) {
  const id = useId();
  return (
    <svg
      className={`heart-icon ${filled ? "" : "heart-empty"}`}
      viewBox="0 0 48 44"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x2=".35" y2="1">
          <stop stopColor={filled ? "#ffb7e1" : "#ded3f5"} />
          <stop offset=".48" stopColor={filled ? "#ff5ca7" : "#c7b9e3"} />
          <stop offset="1" stopColor={filled ? "#dc2882" : "#b4a5d4"} />
        </linearGradient>
      </defs>
      <path
        d="M24 39C18 33 3 24 3 13 3 1 18-1 24 9 30-1 45 1 45 13 45 24 30 33 24 39Z"
        fill={`url(#${id})`}
        stroke={filled ? "#e43b92" : "#bbaad8"}
        strokeWidth="1.3"
      />
      <path
        d="M8 12c1-6 8-7 11-2"
        fill="none"
        stroke="#fff"
        strokeOpacity=".65"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
