import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { ProgressGroove } from "@/components/ProgressGroove";
import { AssetChip } from "@/components/AssetChip";
import { useVaultStore } from "@/store/vaults";
import { ASSETS, formatAsset } from "@/lib/assets";
import { formatUnlockDate, progressPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/vaults/")({
  head: () => ({
    meta: [
      { title: "Solo Vaults — Shadow-Stellar" },
      { name: "description", content: "All your solo time-locked vaults on Shadow-Stellar." },
      { property: "og:title", content: "Solo Vaults — Shadow-Stellar" },
    ],
  }),
  component: MyVaults,
});

type Filter = "all" | "active" | "withdrawn";

function MyVaults() {
  const vaults = useVaultStore((s) => s.vaults);
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = vaults.filter((v) => filter === "all" || v.status === filter);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-medium tracking-tight">Solo Vaults</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              {vaults.length} total · {vaults.filter((v) => v.status === "active").length}{" "}
              active
            </p>
          </div>
          <Link
            to="/create"
            className="bg-surface-raised border border-edge hover:border-amber-core text-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-3 transition-all rounded-sm"
          >
            + New Vault
          </Link>
        </div>

        <div className="flex gap-2">
          {(["all", "active", "withdrawn"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] border rounded-sm transition-colors",
                filter === f
                  ? "border-amber-core text-amber-core bg-amber-core/10"
                  : "border-edge text-muted-foreground hover:text-foreground",
              )}
            >
              {f}
            </button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <MachinedCard className="p-12 text-center font-mono text-sm text-muted-foreground">
            No vaults to show.
          </MachinedCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {filtered.map((v, i) => {
              const created = new Date(v.createdAt);
              const unlocks = new Date(v.unlocksAt);
              const pct =
                v.status === "withdrawn" ? 100 : progressPercent(created, unlocks);

              return (
                <motion.div
                  key={v.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: i * 0.04 }}
                >
                  <MachinedCard className="hover:border-amber-core/40 transition-colors group">
                    <Link
                      to="/vaults/$vaultId"
                      params={{ vaultId: v.id }}
                      className="block p-6 flex flex-col gap-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AssetChip asset={v.asset} />
                            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                              {v.status === "withdrawn"
                                ? "Closed"
                                : v.lockType === "strict"
                                  ? "Strict"
                                  : `Penalty ${v.penaltyPercent}%`}
                            </span>
                          </div>
                          <h3 className="text-lg font-medium truncate">{v.name}</h3>
                          {v.goal && (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              🎯 {v.goal}
                            </div>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-lg tabular">
                            {formatAsset(v.amount, v.asset)}
                          </div>
                          <div
                            className={cn(
                              "font-mono text-[10px] uppercase tracking-[0.15em]",
                              ASSETS[v.asset].accent,
                            )}
                          >
                            {v.asset}
                          </div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1">
                            {v.status === "withdrawn"
                              ? "Withdrawn"
                              : `${formatUnlockDate(unlocks)}`}
                          </div>
                        </div>
                      </div>
                      <ProgressGroove value={pct} />
                    </Link>
                  </MachinedCard>
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
