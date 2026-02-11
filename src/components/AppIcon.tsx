export function AppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 麦克风主体 */}
      <rect x="10" y="4" width="7" height="12" rx="3.5" fill="currentColor" />
      {/* 麦克风支架弧线 */}
      <path
        d="M7 14a6.5 6.5 0 0 0 13 0"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
      {/* 麦克风底座竖线 */}
      <line x1="13.5" y1="20.5" x2="13.5" y2="27" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      {/* 声波 - 近 */}
      <path
        d="M23 9a5 5 0 0 1 0 8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.55"
      />
      {/* 声波 - 远 */}
      <path
        d="M26.5 6a9.5 9.5 0 0 1 0 14"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.3"
      />
    </svg>
  );
}
