import { cn } from "@/lib/utils";
import { ASSETS, type AssetCode } from "@/lib/assets";

interface Props {
  asset: AssetCode;
  size?: "sm" | "md";
  className?: string;
}

export function AssetChip({ asset, size = "sm", className }: Props) {
  const meta = ASSETS[asset];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border rounded-sm font-mono uppercase tracking-[0.15em]",
        meta.ring,
        meta.accent,
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-1",
        className,
      )}
    >
      <span className="font-bold">{meta.glyph}</span>
      {meta.code}
    </span>
  );
}
