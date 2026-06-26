interface ProgressGrooveProps {
  value: number; // 0-100
  label?: string;
  rightLabel?: string;
}

export function ProgressGroove({ value, label, rightLabel }: ProgressGrooveProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div className="flex flex-col gap-3">
      {(label || rightLabel) && (
        <div className="flex justify-between items-end">
          {label && (
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {label}
            </span>
          )}
          {rightLabel && (
            <span className="font-mono text-sm tabular text-foreground">{rightLabel}</span>
          )}
        </div>
      )}
      <div
        className="relative h-3 bg-surface-sunken border-b border-edge rounded-none"
        style={{ boxShadow: "inset 0 1px 3px oklch(0 0 0 / 0.8)" }}
      >
        <div
          className="absolute top-0 left-0 h-full bg-gradient-to-r from-amber-glow to-amber-core transition-[width] duration-1000 ease-out"
          style={{
            width: `${clamped}%`,
            boxShadow: "0 0 12px oklch(0.74 0.18 65 / 0.5)",
          }}
        />
        <div className="groove-ticks absolute inset-0 pointer-events-none" />
      </div>
    </div>
  );
}
