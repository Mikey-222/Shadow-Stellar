import { cn } from "@/lib/utils";

export function MachinedCard({
  children,
  className,
  as: Comp = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: React.ElementType;
}) {
  return (
    <Comp
      className={cn(
        "edge-highlight relative bg-surface-base border border-edge rounded-sm overflow-hidden shadow-vault",
        className,
      )}
    >
      {children}
    </Comp>
  );
}
