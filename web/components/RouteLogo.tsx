import Link from "next/link";

/**
 * PROVISIONAL Route identity, implemented for owner/legal review only. It is not cleared as the final
 * mark. The geometry and colors are the owner brief's File B (small icon) exactly; the adjacent wordmark
 * names the link, so the icon itself is decorative.
 */
export function RouteIcon({ size }: { size: number }) {
  return (
    <svg className="route-icon" viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="48" height="48" rx="11" fill="#123B55" />
      <g transform="translate(10 10) scale(0.28)">
        <path d="M18,82 L40,64 L58,40 L84,20" fill="none" stroke="#FBF9F4" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="84" cy="20" r="10" fill="#E8875B" />
      </g>
    </svg>
  );
}

/** Icon + Epilogue wordmark lockup. Epilogue is used for this wordmark only. */
export default function RouteLockup({ variant }: { variant: "header" | "footer" }) {
  return (
    <Link className={`brand brand-${variant}`} href="/" aria-label="Campus Passage home">
      <RouteIcon size={variant === "header" ? 36 : 28} />
      <span className="brand-wordmark">Campus Passage</span>
    </Link>
  );
}
