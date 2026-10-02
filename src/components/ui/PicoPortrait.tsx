/** Pico's portrait for the dialogue box: the same amber robot as the 3D one, with a screen face. */
export function PicoPortrait({ className = "", face = "happy" }: { className?: string; face?: "happy" | "wow" }) {
  return (
    <svg viewBox="0 0 96 96" className={className} aria-hidden>
      <line x1="48" y1="10" x2="48" y2="22" stroke="#3b3654" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="9" r="5" fill="#ffd36b" />
      <rect x="14" y="20" width="68" height="52" rx="16" fill="#f5b324" />
      <rect x="14" y="62" width="68" height="10" rx="5" fill="#c98a0c" opacity="0.55" />
      <rect x="22" y="28" width="52" height="34" rx="9" fill="#1d1b2e" />
      {face === "happy" ? (
        <>
          <path d="M33 45 q5 -7 10 0" stroke="#7ff0dc" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M53 45 q5 -7 10 0" stroke="#7ff0dc" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M40 52 q8 6 16 0" stroke="#7ff0dc" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="34" y="37" width="7" height="13" rx="3.5" fill="#7ff0dc" />
          <rect x="55" y="37" width="7" height="13" rx="3.5" fill="#7ff0dc" />
          <circle cx="48" cy="55" r="3.5" fill="#7ff0dc" />
        </>
      )}
      <rect x="8" y="38" width="8" height="20" rx="4" fill="#c98a0c" />
      <rect x="80" y="38" width="8" height="20" rx="4" fill="#c98a0c" />
      <rect x="26" y="74" width="44" height="12" rx="6" fill="#f5b324" />
      <circle cx="34" cy="88" r="6" fill="#3b3654" />
      <circle cx="62" cy="88" r="6" fill="#3b3654" />
    </svg>
  );
}
