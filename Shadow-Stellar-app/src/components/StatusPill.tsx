import { cn } from "@/lib/utils";

export function StatusPill({
  children,
  tone = "amber",
  className,
}: {
  children: React.ReactNode;
  tone?: "amber" | "success" | "danger" | "muted";
  className?: string;
}) {
  const toneMap = {
    amber: "border-amber-core/30 bg-amber-core/10 text-amber-core",
    success: "border-success/30 bg-success/10 text-success",
    danger: "border-destructive/30 bg-destructive/10 text-destructive",
    muted: "border-edge bg-surface-raised text-muted-foreground",
  } as const;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 px-3 py-1.5 border rounded-sm font-mono text-[10px] uppercase tracking-[0.18em]",
        toneMap[tone],
        className,
      )}
    >
      {tone === "amber" && (
        <span className="relative flex items-center justify-center">
          <span className="absolute size-3 rounded-full bg-amber-glow blur-[6px] animate-pulse-slow" />
          <span className="relative size-1.5 rounded-full bg-amber-core" />
        </span>
      )}
      {children}
    </div>
  );
}
