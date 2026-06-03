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

  const avgProgress =
    active.length === 0
      ? 0
      : active.reduce(
          (sum, v) =>
            sum + progressPercent(new Date(v.createdAt), new Date(v.unlocksAt)),
          0,
        ) / active.length;

  const lockedAssets = ASSET_CODES.filter((c) => (locked[c] ?? 0) > 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-10">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <MachinedCard>
            <div className="p-8 md:p-12 flex flex-col gap-12">
              <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                <div className="min-w-0">
                  <h1 className="text-muted-foreground font-mono text-[11px] uppercase tracking-[0.2em] mb-4">
                    Total Locked
                  </h1>
                  {lockedAssets.length === 0 ? (
                    <div className="font-mono text-3xl text-muted-foreground">
                      Nothing locked yet
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      {lockedAssets.map((code) => (
                        <div key={code} className="flex items-baseline gap-3">
                          <span className={`text-3xl ${ASSETS[code].accent} font-mono`}>
                            {ASSETS[code].glyph}
                          </span>
                          <span className="text-4xl md:text-6xl font-mono font-medium text-foreground tracking-tighter tabular leading-none">
                            {formatAsset(locked[code], code)}
                          </span>
                          <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">
                            {code}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="mt-5 flex items-center flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
                    <span>
                      Vaults:{" "}
                      <span className="text-foreground tabular">{active.length}</span>
                    </span>
                    <span>·</span>
                    <span>
                      Wallet:{" "}
                      {ASSET_CODES.filter((c) => (balances[c] ?? 0) > 0)
                        .map((c) => `${formatAsset(balances[c], c)} ${c}`)
                        .join("  ·  ") || "0"}
                    </span>
                  </div>
                </div>
                <StatusPill tone={active.length > 0 ? "amber" : "muted"}>
                  {active.length > 0 ? "System Locked" : "No Active Vaults"}
                </StatusPill>
              </div>

              <div
                className="flex flex-col gap-5 bg-surface-deep p-6 border border-edge rounded-sm"
                style={{ boxShadow: "inset 0 2px 10px oklch(0 0 0 / 0.6)" }}
              >
                <ProgressGroove
                  value={avgProgress}
                  label="Aggregate Maturity Progress"
                  rightLabel={`${avgProgress.toFixed(0)}%`}
                />
                <div className="text-sm text-muted-foreground font-mono">
                  {avgProgress >= 75
                    ? "Almost there — ZK mode or standard, you held the line."
                    : avgProgress >= 40
                      ? "Past halfway. Keep it locked."
                      : avgProgress > 0
                        ? "Every vault compounds your commitment."
                        : "Create your first vault."}
                </div>
              </div>

              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pt-6 border-t border-edge">
                <div className="flex flex-col gap-2">
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
                  className="bg-surface-raised border border-edge hover:border-amber-core hover:bg-surface-deep text-foreground font-mono text-xs uppercase tracking-[0.18em] px-8 py-4 transition-all duration-300 inline-flex items-center gap-4 group rounded-sm"
                >
                  Create Solo Vault
                  <span className="text-amber-core font-bold bg-amber-core/10 px-2 py-0.5 border border-amber-core/30 group-hover:bg-amber-core group-hover:text-primary-foreground transition-colors">
                    [ + ]
                  </span>
                </Link>
              </div>
            </div>
          </MachinedCard>
        </motion.div>

        {/* Vault grid */}
        <section className="flex flex-col gap-5">
          <div className="flex items-end justify-between">
            <h2 className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Active Vaults <span className="text-foreground">/ {active.length}</span>
            </h2>
            <Link
              to="/vaults"
              className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-amber-core transition-colors"
            >
              View all →
            </Link>
          </div>

          {active.length === 0 ? (
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

        {/* Contracts info strip */}
        <MachinedCard>
          <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { label: "Time-Locked Vault", id: "CDGFAVUTIX56JKSQYXF2OYYNLAOWORAMKMUNQTM6Z5NKVF6ZUBUS6T4M" },
              { label: "CCP + ZK Contract", id: "CAOER4YOQ7V7H77AWGUZVYL75QB5ZBKO6UUYGPATBO6AEDTBUQ2ZS4EZ" },
              { label: "ZK Commitment Protocol", id: "CAV4N6PWTHGLM5FA6XFM6VN2B6OOO7I5HDLHFQ5OQWJ6SEA7S4QVCKV7" },
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
