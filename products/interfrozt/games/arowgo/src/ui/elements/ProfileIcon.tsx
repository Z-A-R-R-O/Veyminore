import type { ReactNode } from "react";
type Kind =
  | "account"
  | "pencil"
  | "avatar"
  | "frame"
  | "levels"
  | "star"
  | "perfect";
const star =
  "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z";
export function ProfileIcon({ kind }: { kind: Kind }) {
  const shapes: Record<Kind, ReactNode> = {
    account: (
      <>
        <path
          d="M12 3 20 6v6c0 4-4 7-8 9-4-2-8-5-8-9V6Z"
          fill="currentColor"
          fillOpacity=".12"
        />
        <circle cx="12" cy="10" r="2.3" />
        <path d="M8 16c1-3 7-3 8 0" />
      </>
    ),
    pencil: (
      <>
        <path
          d="m5 15 10-10a2.1 2.1 0 0 1 4 4L9 19l-5 1Z"
          fill="currentColor"
          fillOpacity=".13"
        />
        <path d="m13 7 4 4M5 15l4 4M4 20l2-1" />
      </>
    ),
    avatar: (
      <>
        <rect
          x="3"
          y="3"
          width="18"
          height="18"
          rx="6"
          fill="currentColor"
          fillOpacity=".12"
        />
        <circle cx="12" cy="9" r="3" />
        <path d="M6.5 18c.7-5.5 10.3-5.5 11 0" />
      </>
    ),
    frame: (
      <>
        <circle cx="12" cy="12" r="8" fill="currentColor" fillOpacity=".1" />
        <circle cx="12" cy="12" r="5.3" />
        <path d="m12 1 2.5 3L12 7 9.5 4Z" fill="currentColor" />
        <path d="m12 17 2 3-2 3-2-3Z" fill="currentColor" />
      </>
    ),
    levels: (
      <>
        <path
          d="M6 21V4m0 1c4-5 8 4 13-1v10c-5 5-9-4-13 1"
          fill="currentColor"
          fillOpacity=".16"
        />
        <path d="m9 9 2 2 4-4M3 21h6" />
      </>
    ),
    star: <path d={star} fill="currentColor" fillOpacity=".25" />,
    perfect: (
      <>
        <path
          d="M7 16 5 22l7-3 7 3-2-6"
          fill="currentColor"
          fillOpacity=".12"
        />
        <circle cx="12" cy="9" r="7" fill="currentColor" fillOpacity=".12" />
        <path d="m8.5 9 2.3 2.3 4.7-4.6" />
      </>
    ),
  };
  return (
    <svg
      className={`profile-icon profile-icon-${kind}`}
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shapes[kind]}
    </svg>
  );
}
