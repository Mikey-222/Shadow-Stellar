import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { ProgressGroove } from "@/components/ProgressGroove";
import { StatusPill } from "@/components/StatusPill";
import { AssetChip } from "@/components/AssetChip";
import { useVaultStore } from "@/store/vaults";
import { ASSETS, formatAsset } from "@/lib/assets";
import { formatCountdown, formatUnlockDate, formatUnlockTimezones, progressPercent } from "@/lib/format";

export const Route = createFileRoute("/vaults/$vaultId")({
  head: () => ({
    meta: [
      { title: "Vault — Shadow-Stellar" },
      { property: "og:title", content: "Vault — Shadow-Stellar" },
    ],
  }),
  component: VaultDetail,
  notFoundComponent: () => (
    <AppShell>
      <div className="max-w-2xl mx-auto text-center py-20">
        <h1 className="text-2xl">Vault not found</h1>
        <Link to="/" className="mt-4 inline-block font-mono text-xs text-amber-core">
          ← Back to dashboard
        </Link>
      </div>
    </AppShell>
  ),
});

function VaultDetail() {
  const { vaultId } = Route.useParams();
  const navigate = useNavigate();
  const vault = useVaultStore((s) => s.vaults.find((v) => v.id === vaultId));
  const withdraw = useVaultStore((s) => s.withdraw);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const [confirmEarly, setConfirmEarly] = useState(false);
  const [confirmMature, setConfirmMature] = useState(false);
  const [signing, setSigning] = useState(false);

  if (!vault) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto text-center py-20">
          <h1 className="text-2xl">Vault not found</h1>
          <Link
            to="/vaults"
            className="mt-4 inline-block font-mono text-xs text-amber-core"
          >
            ← All vaults
          </Link>
        </div>
      </AppShell>
    );
  }

  const created = new Date(vault.createdAt);
  const unlocks = new Date(vault.unlocksAt);
  const now = new Date();
  const matured = now >= unlocks;
  const pct =
    vault.status === "withdrawn" ? 100 : progressPercent(created, unlocks, now);
  const penaltyAmount =
    vault.lockType === "penalty"
      ? Number(((vault.amount * vault.penaltyPercent) / 100).toFixed(ASSETS[vault.asset].displayDecimals))
      : 0;
  const youReceiveEarly = Number((vault.amount - penaltyAmount).toFixed(ASSETS[vault.asset].displayDecimals));

  const doWithdraw = async (early: boolean) => {
    setSigning(true);
    try {
      await withdraw(vault.id, { early });
      setConfirmEarly(false);
      setConfirmMature(false);
      navigate({ to: "/history" });
    } catch (e) {
      console.error("Withdraw failed:", e);
    } finally {
      setSigning(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <Link
          to="/vaults"
          className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
        >
          ← All vaults
        </Link>

        <MachinedCard>
          <div className="p-8 md:p-10 flex flex-col gap-10">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <AssetChip asset={vault.asset} size="md" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    📦 Vault
                  </span>
                </div>
                <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
                  {vault.name}
                </h1>
                {vault.goal && (
                  <div className="text-sm text-muted-foreground mt-2">🎯 {vault.goal}</div>
                )}
                <div className="mt-6 flex items-baseline gap-3 flex-wrap">
                  <span className={`text-3xl md:text-4xl font-mono ${ASSETS[vault.asset].accent}`}>
                    {ASSETS[vault.asset].glyph}
                  </span>
                  <span className="text-5xl md:text-6xl font-mono text-foreground tabular tracking-tighter">
                    {formatAsset(vault.amount, vault.asset)}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">
                    {vault.asset}
                  </span>
                </div>
              </div>
              <StatusPill
                tone={
                  vault.status === "withdrawn" ? "muted" : matured ? "success" : "amber"
                }
              >
                {vault.status === "withdrawn"
                  ? "Withdrawn"
                  : matured
                    ? "Matured"
                    : "Locked"}
              </StatusPill>
            </div>

            <div
              className="flex flex-col gap-4 bg-surface-deep p-6 border border-edge rounded-sm"
              style={{ boxShadow: "inset 0 2px 10px oklch(0 0 0 / 0.6)" }}
            >
              <ProgressGroove
                value={pct}
                label="Maturity Progress"
                rightLabel={`${pct.toFixed(0)}%`}
              />
              {vault.status === "active" && !matured && (
                <div className="font-mono text-amber-core text-lg tabular animate-tick">
                  {formatCountdown(unlocks, now)}{" "}
                  <span className="text-muted-foreground text-xs">until unlock</span>
                </div>
              )}
              {vault.status === "active" && matured && (
                <div className="font-mono text-success text-sm">
                  ✓ Vault has matured. You can withdraw your funds now.
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-edge">
              <Stat label="Asset" value={`${ASSETS[vault.asset].glyph} ${vault.asset}`} />
              <Stat
                label="Lock Type"
                value={vault.lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"}
              />
              <Stat
                label="Penalty"
                value={vault.lockType === "strict" ? "—" : `${vault.penaltyPercent}%`}
              />
              <Stat label="Unlocks" value={formatUnlockDate(unlocks)} />
            </div>

            {/* Unlock time in UTC / GMT / WAT */}
            <div className="bg-surface-deep border border-edge rounded-sm p-5 flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                Unlock Time
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {formatUnlockTimezones(unlocks).map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">
                      {label}
                    </span>
                    <span className="font-mono text-xs text-foreground tabular whitespace-nowrap">
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {vault.status === "withdrawn" ? (
              <div className="bg-surface-deep border border-edge p-5 rounded-sm font-mono text-sm text-muted-foreground">
                Withdrawn on {formatUnlockDate(new Date(vault.withdrawnAt!))}.
                {vault.penaltyPaid && vault.penaltyPaid > 0 && (
                  <span className="text-destructive ml-2">
                    Penalty paid: {formatAsset(vault.penaltyPaid, vault.asset)} {vault.asset}
                  </span>
                )}
              </div>
            ) : matured ? (
              <button
                onClick={() => setConfirmMature(true)}
                className="bg-success text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm transition-shadow hover:shadow-amber-glow flex items-center justify-center gap-3"
              >
                ✓ Withdraw {vault.asset}
              </button>
            ) : (
              <div className="flex flex-col md:flex-row gap-3">
                <button
                  disabled
                  className="flex-1 bg-surface-deep border border-edge text-muted-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm cursor-not-allowed flex items-center justify-center gap-3"
                >
                  ⏳ Wait for unlock
                </button>
                {vault.lockType === "penalty" ? (
                  <button
                    onClick={() => setConfirmEarly(true)}
                    className="flex-1 bg-transparent border border-destructive/40 text-destructive font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm hover:bg-destructive/10 transition-colors flex items-center justify-center gap-3"
                  >
                    ✗ Withdraw Early
                  </button>
                ) : (
                  <div className="flex-1 bg-transparent border border-edge text-muted-foreground font-mono text-[10px] uppercase tracking-[0.18em] px-6 py-4 rounded-sm flex items-center justify-center gap-3 text-center">
                    🔒 Strict lock — no early exit
                  </div>
                )}
              </div>
            )}
          </div>
        </MachinedCard>

        <Link
          to="/history"
          className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
        >
          View transaction history →
        </Link>
      </div>

      <AnimatePresence>
        {confirmEarly && (
          <Modal onClose={() => !signing && setConfirmEarly(false)}>
            <div className="text-4xl mb-3">⚠️</div>
            <h2 className="text-2xl font-medium tracking-tight">Are you sure?</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              You will lose{" "}
              <span className="text-destructive font-mono tabular">
                {formatAsset(penaltyAmount, vault.asset)} {vault.asset}
              </span>{" "}
              as penalty. You'll receive only{" "}
              <span className="text-foreground font-mono tabular">
                {formatAsset(youReceiveEarly, vault.asset)} {vault.asset}
              </span>
              .
            </p>
            {vault.goal && (
              <div className="mt-5 p-4 bg-surface-deep border border-edge rounded-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                  This vault was meant for
                </div>
                <div className="text-foreground">🎯 {vault.goal}</div>
              </div>
            )}
            <div className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              You're {pct.toFixed(0)}% of the way there.
            </div>
            <div className="mt-8 flex flex-col-reverse sm:flex-row gap-3">
              <button
                onClick={() => doWithdraw(true)}
                disabled={signing}
                className="flex-1 bg-transparent border border-destructive/40 text-destructive font-mono text-xs uppercase tracking-[0.18em] px-5 py-4 rounded-sm hover:bg-destructive/10 transition-colors disabled:opacity-60"
              >
                {signing ? "Awaiting signature…" : "Withdraw Anyway"}
              </button>
              <button
                onClick={() => setConfirmEarly(false)}
                disabled={signing}
                className="flex-1 bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-4 rounded-sm hover:shadow-amber-glow transition-shadow disabled:opacity-60"
              >
                Stay Disciplined
              </button>
            </div>
          </Modal>
        )}

        {confirmMature && (
          <Modal onClose={() => !signing && setConfirmMature(false)}>
            <div className="text-4xl mb-3">✓</div>
            <h2 className="text-2xl font-medium tracking-tight">You did it.</h2>
            <p className="text-muted-foreground mt-3 leading-relaxed">
              You're about to receive{" "}
              <span className="text-foreground font-mono tabular">
                {formatAsset(vault.amount, vault.asset)} {vault.asset}
              </span>
              {vault.goal && <> for your goal: 🎯 {vault.goal}</>}.
            </p>
            <div className="mt-8 flex flex-col-reverse sm:flex-row gap-3">
              <button
                onClick={() => setConfirmMature(false)}
                disabled={signing}
                className="flex-1 bg-transparent border border-edge text-muted-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-4 rounded-sm disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => doWithdraw(false)}
                disabled={signing}
                className="flex-1 bg-success text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-4 rounded-sm hover:shadow-amber-glow transition-shadow disabled:opacity-60"
              >
                {signing
                  ? "Awaiting signature…"
                  : `Withdraw ${formatAsset(vault.amount, vault.asset)} ${vault.asset}`}
              </button>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
        {label}
      </div>
      <div className="font-mono text-sm text-foreground tabular">{value}</div>
    </div>
  );
}

function Modal({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-deep/90 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 8 }}
        transition={{ duration: 0.2 }}
        onClick={(e) => e.stopPropagation()}
        className="edge-highlight relative w-full max-w-md bg-surface-base border border-edge rounded-sm shadow-vault p-8"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}
