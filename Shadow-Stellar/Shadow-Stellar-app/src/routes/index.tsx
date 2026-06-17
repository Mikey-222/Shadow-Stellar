import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { ProgressGroove } from "@/components/ProgressGroove";
import { StatusPill } from "@/components/StatusPill";
import { AssetChip } from "@/components/AssetChip";
import { useLockedByAsset, useVaultStore, type Vault } from "@/store/vaults";
import { useWalletStore } from "@/store/wallet";
import { useZkVaultStore } from "@/store/zk-vaults";
import { useGroupVaultStore, type GroupVault } from "@/store/group-vaults";
import { ASSET_CODES, ASSETS, formatAsset } from "@/lib/assets";
import { formatCountdown, formatUnlockDate, progressPercent } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Shadow-Stellar" },
      {
        name: "description",
        content: "Track your locked crypto, progress, and next unlock date.",
      },
      { property: "og:title", content: "Dashboard — Shadow-Stellar" },
    ],
  }),
  component: Dashboard,
});

function useTicker(intervalMs = 1000) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}

function Dashboard() {
  useTicker();
  const { active, locked, nextUnlock } = useLockedByAsset();
  const balances = useWalletStore((s) => s.balances);
  const vaults = useVaultStore((s) => s.vaults);
  const zkVaults = useZkVaultStore((s) => s.vaults);
  const zkActive = zkVaults.filter(v => !v.withdrawn);
  const groupVaults = useGroupVaultStore((s) => s.vaults);
  const groupActive = groupVaults.filter(v => v.status === "funding" || v.status === "active" || v.status === "settlement");

  const allLocked: Record<string, number> = { XLM: 0, USDC: 0, EURC: 0 };
  // Non-withdrawn TLV vaults
  for (const v of vaults) {
    if (v.status !== "withdrawn") allLocked[v.asset] = (allLocked[v.asset] ?? 0) + v.amount;
  }
  // Non-withdrawn ZK vaults (TLV-based ZK)
  for (const v of zkActive) {
    allLocked[v.token] = (allLocked[v.token] ?? 0) + v.amount;
  }
  // Active group vaults (CCP group vaults — standard and ZK)
  for (const v of groupActive) {
    allLocked[v.token] = (allLocked[v.token] ?? 0) + v.totalSize;
  }

  const avgProgress =
    active.length === 0
      ? 0
      : active.reduce(
          (sum, v) =>
            sum + progressPercent(new Date(v.createdAt), new Date(v.unlocksAt)),
          0,
        ) / active.length;

  const lockedAssets = ASSET_CODES.filter((c) => (allLocked[c] ?? 0) > 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        {/* Hero — fintech-style portfolio summary */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="relative overflow-hidden rounded-sm border border-edge bg-surface-deep"
            style={{ boxShadow: "0 0 0 1px oklch(0.5 0.05 85 / 0.08), 0 8px 32px oklch(0 0 0 / 0.4)" }}>
            {/* Subtle ambient gradient */}
            <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-amber-core/4 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-24 -left-24 w-80 h-80 rounded-full bg-amber-core/3 blur-3xl pointer-events-none" />

            <div className="relative p-8 md:p-10 flex flex-col gap-8">
              {/* Top row: total value + status */}
              <div className="flex items-start justify-between gap-6">
                <div className="min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/60 mb-1">
                    Portfolio Value
                  </p>
                  {lockedAssets.length === 0 ? (
                    <div className="text-3xl font-mono text-muted-foreground">—
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {lockedAssets.map((code) => (
                        <div key={code} className="flex items-baseline gap-2.5">
                          <span className={`text-xl md:text-2xl ${ASSETS[code].accent} font-mono`}>
                            {ASSETS[code].glyph}
                          </span>
                          <span className="text-4xl md:text-6xl font-mono font-medium text-foreground tracking-tight tabular leading-none">
                            {formatAsset(allLocked[code], code)}
                          </span>
                          <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">
                            {code}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <StatusPill tone={active.length + groupActive.length > 0 ? "amber" : "muted"}>
                  {active.length + groupActive.length > 0 ? "System Locked" : "No Active Vaults"}
                </StatusPill>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-x-8 gap-y-2 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-core/70" />
                  <span>{active.length + groupActive.length + zkActive.length} Active Vaults</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-core/40" />
                  <span>Wallet:{" "}
                    {ASSET_CODES.filter((c) => (balances[c] ?? 0) > 0)
                      .map((c) => `${formatAsset(balances[c], c)} ${c}`)
                      .join(" · ") || "0"}
                  </span>
                </div>
              </div>

              {/* Progress + next unlock row */}
              <div className="flex flex-col gap-5 pt-6 border-t border-edge/60">
                <div className="flex flex-col gap-2.5">
                  <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground/60">
                    <span>Aggregate Maturity Progress</span>
                    <span className="text-amber-core">{avgProgress.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-edge overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-core/70 to-amber-core transition-all duration-700"
                      style={{ width: `${avgProgress}%` }}
                    />
                  </div>
                  <p className="font-mono text-[10px] text-muted-foreground/50">
                    {avgProgress >= 75
                      ? "Almost there — you held the line."
                      : avgProgress >= 40
                        ? "Past halfway. Steady as she goes."
                        : avgProgress > 0
                          ? "Every vault compounds your commitment."
                          : "Create your first vault to get started."}
                  </p>
                </div>

                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-[0.18em]">
                      Next Unlock Sequence
                    </span>
                    {nextUnlock ? (
                      <div className="flex items-baseline gap-4 flex-wrap">
                        <span className="font-mono text-foreground text-xl tabular tracking-tight">
                          {formatUnlockDate(nextUnlock)}
                        </span>
                        <span className="font-mono text-amber-core text-sm tabular animate-tick">
                          {formatCountdown(nextUnlock)}
                        </span>
                      </div>
                    ) : (
                      <span className="font-mono text-muted-foreground text-sm">
                        No vaults pending.
                      </span>
                    )}
                  </div>

                  <Link
                    to="/create"
                    className="shrink-0 bg-amber-core/10 hover:bg-amber-core text-foreground hover:text-primary-foreground font-mono text-[10px] uppercase tracking-[0.18em] px-5 py-3 transition-all duration-300 inline-flex items-center gap-3 rounded-sm border border-amber-core/30 hover:border-amber-core"
                  >
                    + New Vault
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Vault grid */}
        <section className="flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Active Vaults <span className="text-foreground">/ {active.length + groupActive.length}</span>
            </h2>
            <Link
              to="/vaults"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-amber-core transition-colors"
            >
              View all →
            </Link>
          </div>

          {active.length === 0 && groupActive.length === 0 && zkActive.length === 0 ? (
            <MachinedCard className="p-12 text-center">
              <div className="font-mono text-sm text-muted-foreground">
                No active vaults. Create your first solo, group, or ZK vault.
              </div>
            </MachinedCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {active.slice(0, 6).map((v, i) => (
                <VaultSummaryCard key={v.id} vault={v} delay={i * 0.05} />
              ))}
              {groupActive.slice(0, 6 - active.length).map((v, i) => (
                <GroupVaultCard key={v.id} vault={v} delay={(active.length + i) * 0.05} />
              ))}
            </div>
          )}
        </section>

        {vaults.some((v) => v.status === "withdrawn") && (
          <div className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <Link to="/history" className="hover:text-foreground transition-colors">
              View transaction history →
            </Link>
          </div>
        )}

        {/* ZK Vaults quick-access */}
        <section className="flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              ZK Vaults <span className="text-foreground">/ {zkActive.length}</span>
            </h2>
            <Link to="/zk" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-amber-core transition-colors">
              View all →
            </Link>
          </div>

          {zkActive.length === 0 ? (
            <MachinedCard>
              <div className="p-8 flex flex-col md:flex-row md:items-center gap-6">
                <div className="text-4xl">🔏</div>
                <div className="flex-1">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-core mb-1">ZK Privacy Mode</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    Commit amounts privately via SHA-256 Pedersen commitments. Your deposit amount is never stored in plaintext on-chain.
                  </div>
                </div>
                <Link to="/zk/create"
                  className="shrink-0 bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-3 rounded-sm hover:shadow-amber-glow transition-shadow">
                  🔏 Create ZK Vault
                </Link>
              </div>
            </MachinedCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {zkActive.slice(0, 4).map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
                  <MachinedCard className="hover:border-amber-core/40 transition-colors">
                    <Link to="/zk/$entryId" params={{ entryId: v.id }} className="block p-5 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AssetChip asset={v.token} />
                            <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core">🔏 ZK</span>
                          </div>
                          <h3 className="text-sm font-medium truncate">{v.name || `ZK Entry #${v.id}`}</h3>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-base tabular">{formatAsset(v.amount, v.token)}</div>
                          <div className={`font-mono text-[10px] uppercase tracking-[0.15em] mt-0.5 ${ASSETS[v.token].accent}`}>{v.token}</div>
                        </div>
                      </div>
                      <div className="font-mono text-[9px] text-muted-foreground truncate">
                        {v.commitment.slice(0, 20)}…
                      </div>
                    </Link>
                  </MachinedCard>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Group Vaults quick-access */}
        <section className="flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Group Vaults <span className="text-foreground">/ {groupActive.length}</span>
            </h2>
            <Link to="/group" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-amber-core transition-colors">
              View all →
            </Link>
          </div>

          {groupActive.length === 0 ? (
            <MachinedCard>
              <div className="p-8 flex flex-col md:flex-row md:items-center gap-6">
                <div className="text-4xl">🤝</div>
                <div className="flex-1">
                  <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-amber-core mb-1">Collective Commitment</div>
                  <div className="text-sm text-muted-foreground leading-relaxed">
                    Lock together with a group. Members deposit before a deadline or the vault is cancelled.
                  </div>
                </div>
                <Link to="/group/create"
                  className="shrink-0 bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-3 rounded-sm hover:shadow-amber-glow transition-shadow">
                  + Create Group Vault
                </Link>
              </div>
            </MachinedCard>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {groupActive.slice(0, 4).map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: i * 0.05 }}>
                  <MachinedCard className="hover:border-amber-core/40 transition-colors">
                    <Link to="/group/$vaultId" params={{ vaultId: v.id }} className="block p-5 flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AssetChip asset={v.token} />
                            <span className="font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border rounded-sm border-amber-core/40 text-amber-core">
                              {v.isZk ? "🔏 ZK" : v.lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"}
                            </span>
                          </div>
                          <h3 className="text-sm font-medium truncate">{v.name || `Group Vault #${v.id}`}</h3>
                          <div className="font-mono text-[10px] text-muted-foreground mt-1">
                            {v.members.length} members · {v.depositedCount}/{v.members.length} deposited
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-base tabular">{formatAsset(v.totalSize, v.token)}</div>
                          <div className={`font-mono text-[10px] uppercase tracking-[0.15em] mt-0.5 ${ASSETS[v.token].accent}`}>{v.token}</div>
                        </div>
                      </div>
                    </Link>
                  </MachinedCard>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Contracts info strip */}
        <MachinedCard>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Time-Locked Vault", id: "CABGIDBEGTWZQLGVSZRLGR44PN3Q32QKV5PVD6BZLH4KGBLJDL7ZEZ3H" },
              { label: "CCP + ZK Contract", id: "CAL3RFT65X7GPLVTWSHYL3ODN6VPLE3M4BDZ5R7LABENLIGHSZQTYFIJ" },
              { label: "ZK Commitment Protocol", id: "CCFFMJCIIWTGE3VQT62VMNFUFQKI734Y4QBKFGKVEJ3QOVLLJIKJU525" },
            ].map(({ label, id }) => (
              <div key={id} className="flex flex-col gap-1">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</div>
                <a href={`https://stellar.expert/explorer/testnet/contract/${id}`} target="_blank" rel="noopener noreferrer"
                  className="font-mono text-[10px] text-amber-core hover:underline break-all">{id}</a>
              </div>
            ))}
          </div>
        </MachinedCard>
      </div>
    </AppShell>
  );
}

function VaultSummaryCard({ vault, delay = 0 }: { vault: Vault; delay?: number }) {
  const created = new Date(vault.createdAt);
  const unlocks = new Date(vault.unlocksAt);
  const pct = progressPercent(created, unlocks);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <MachinedCard className="hover:border-amber-core/40 transition-colors group">
        <Link
          to="/vaults/$vaultId"
          params={{ vaultId: vault.id }}
          className="block p-6 flex flex-col gap-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <AssetChip asset={vault.asset} />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  {vault.lockType === "strict"
                    ? "Strict"
                    : `Penalty ${vault.penaltyPercent}%`}
                </span>
              </div>
              <h3 className="text-lg font-medium text-foreground truncate">{vault.name}</h3>
              {vault.goal && (
                <div className="text-xs text-muted-foreground mt-1 truncate">
                  🎯 {vault.goal}
                </div>
              )}
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-xl text-foreground tabular tracking-tight">
                {formatAsset(vault.amount, vault.asset)}
              </div>
              <div className={`font-mono text-[10px] uppercase tracking-[0.15em] mt-1 ${ASSETS[vault.asset].accent}`}>
                {vault.asset}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core mt-1">
                {formatCountdown(unlocks)}
              </div>
            </div>
          </div>
          <ProgressGroove value={pct} />
          <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
            <span>Unlocks {formatUnlockDate(unlocks)}</span>
            <span className="text-foreground group-hover:text-amber-core transition-colors">
              View →
            </span>
          </div>
        </Link>
      </MachinedCard>
    </motion.div>
  );
}

function GroupVaultCard({ vault, delay = 0 }: { vault: GroupVault; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
    >
      <MachinedCard className="hover:border-amber-core/40 transition-colors group">
        <Link
          to="/group/$vaultId"
          params={{ vaultId: vault.id }}
          className="block p-6 flex flex-col gap-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <AssetChip asset={vault.token} />
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] px-2 py-0.5 border rounded-sm border-amber-core/40 text-amber-core">
                  {vault.isZk ? "🔏 ZK" : vault.lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"}
                </span>
              </div>
              <h3 className="text-lg font-medium text-foreground truncate">{vault.name || `Group Vault #${vault.id}`}</h3>
              <div className="font-mono text-[10px] text-muted-foreground mt-1">
                {vault.members.length} members · {vault.depositedCount}/{vault.members.length} deposited
              </div>
            </div>
            <div className="text-right shrink-0">
              <div className="font-mono text-xl text-foreground tabular tracking-tight">
                {formatAsset(vault.totalSize, vault.token)}
              </div>
              <div className={`font-mono text-[10px] uppercase tracking-[0.15em] mt-1 ${ASSETS[vault.token].accent}`}>
                {vault.token}
              </div>
            </div>
          </div>
        </Link>
      </MachinedCard>
    </motion.div>
  );
}
