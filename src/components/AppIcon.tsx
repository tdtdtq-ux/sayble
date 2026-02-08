export function AppIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* 麦克风主体 */}
      <rect x="9" y="2" width="6" height="11" rx="3" fill="currentColor" />
      {/* 麦克风支架弧线 */}
      <path
        d="M5 11a7 7 0 0 0 14 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* 麦克风底座竖线 */}
      <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      {/* 声波 - 右侧 */}
      <path
        d="M20 7.5a4.5 4.5 0 0 1 0 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.6"
      />
      <path
        d="M22.5 5.5a8 8 0 0 1 0 9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.35"
      />
    </svg>
  );
}
