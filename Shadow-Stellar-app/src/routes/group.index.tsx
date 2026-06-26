import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { AssetChip } from "@/components/AssetChip";
import { useGroupVaultStore } from "@/store/group-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSETS, formatAsset } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/group/")({
  head: () => ({
    meta: [
      { title: "Group Vaults — Shadow-Stellar" },
      { name: "description", content: "Collective commitment vaults on Shadow-Stellar." },
    ],
  }),
  component: GroupVaults,
});

const STATUS_STYLES: Record<string, string> = {
  funding:    "text-amber-core border-amber-core/40 bg-amber-core/8",
  active:     "text-success border-success/40 bg-success/8",
  settlement: "text-[oklch(0.72_0.14_240)] border-[oklch(0.55_0.14_240/0.4)] bg-[oklch(0.55_0.14_240/0.08)]",
  resolved:   "text-muted-foreground border-edge bg-surface-deep",
  cancelled:  "text-destructive border-destructive/40 bg-destructive/8",
};

const STATUS_LABELS: Record<string, string> = {
  funding: "Funding Open", active: "Active", settlement: "Settlement",
  resolved: "Resolved", cancelled: "Cancelled",
};

function GroupVaults() {
  const vaults = useGroupVaultStore((s) => s.vaults);
  const loading = useGroupVaultStore((s) => s.loading);
  const address = useWalletStore((s) => s.address);

  const active = vaults.filter((v) => v.status === "funding" || v.status === "active" || v.status === "settlement");
  const closed = vaults.filter((v) => v.status === "resolved" || v.status === "cancelled");

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-medium tracking-tight">Group Vaults</h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Collective commitment — lock together, stay accountable. Powered by the CCP + ZK contract.
            </p>
          </div>
          <Link
            to="/group/create"
            className="bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-3 rounded-sm hover:shadow-amber-glow transition-shadow"
          >
            + Create Group Vault
          </Link>
        </div>

        {loading && (
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse">
            Loading vaults…
          </div>
        )}

        {!loading && vaults.length === 0 && (
          <MachinedCard className="p-12 text-center">
            <div className="font-mono text-sm text-muted-foreground">
              No group vaults yet. Create one or ask someone to add you as a member.
            </div>
          </MachinedCard>
        )}

        {active.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Active / Funding <span className="text-foreground">/ {active.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {active.map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <MachinedCard className="hover:border-amber-core/40 transition-colors">
                    <Link to="/group/$vaultId" params={{ vaultId: v.id }} className="block p-6 flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AssetChip asset={v.token} />
                            <span className={cn("font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border rounded-sm", STATUS_STYLES[v.status])}>
                              {STATUS_LABELS[v.status]}
                            </span>
                          </div>
                          <h3 className="text-lg font-medium truncate">{v.name || `Group Vault #${v.id}`}</h3>
                          <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground mt-1">
                            {v.members.length} members · {v.depositedCount}/{v.members.length} deposited
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-lg tabular">{formatAsset(v.totalSize, v.token)}</div>
                          <div className={cn("font-mono text-[10px] uppercase tracking-[0.15em] mt-1", ASSETS[v.token].accent)}>
                            {v.token}
                          </div>
                        </div>
                      </div>
                      {/* Funding progress */}
                      {v.status === "funding" && (
                        <div className="flex flex-col gap-1">
                          <div className="h-1 bg-edge rounded-none overflow-hidden">
                            <div
                              className="h-full bg-amber-core transition-all"
                              style={{ width: `${(v.depositedCount / v.members.length) * 100}%` }}
                            />
                          </div>
                          <div className="font-mono text-[10px] text-muted-foreground">
                            {v.depositedCount} of {v.members.length} funded
                          </div>
                        </div>
                      )}
                      {/* Member indicator — is connected user a member? */}
                      {address && v.members.some((m) => m.address === address) && (
                        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core">
                          ✦ You are a member
                        </div>
                      )}
                    </Link>
                  </MachinedCard>
                </motion.div>
              ))}
            </div>
          </section>
        )}

        {closed.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Closed <span className="text-foreground">/ {closed.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {closed.map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <MachinedCard className="opacity-60 hover:opacity-100 transition-opacity">
                    <Link to="/group/$vaultId" params={{ vaultId: v.id }} className="block p-6 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AssetChip asset={v.token} />
                          <span className={cn("font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border rounded-sm", STATUS_STYLES[v.status])}>
                            {STATUS_LABELS[v.status]}
                          </span>
                        </div>
                        <h3 className="text-base font-medium truncate">{v.name || `Group Vault #${v.id}`}</h3>
                      </div>
                      <div className="font-mono text-sm tabular text-muted-foreground shrink-0">
                        {formatAsset(v.totalSize, v.token)} {v.token}
                      </div>
                    </Link>
                  </MachinedCard>
                </motion.div>
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}
