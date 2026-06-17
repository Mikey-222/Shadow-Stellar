import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { AssetChip } from "@/components/AssetChip";
import { StatusPill } from "@/components/StatusPill";
import { useGroupVaultStore, type GroupVault, type MemberEntry } from "@/store/group-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSETS, formatAsset } from "@/lib/assets";
import { formatUnlockDate, formatUnlockTimezones } from "@/lib/format";
import { cn } from "@/lib/utils";
import { deriveSecretFromAddress, computeZkDepositCommitment, getZkMemberRecord } from "@/lib/ccp-contract";

export const Route = createFileRoute("/group/$vaultId")({
  head: () => ({ meta: [{ title: "Group Vault — Shadow-Stellar" }] }),
  component: GroupVaultDetail,
});

const MEMBER_STATE_STYLE: Record<string, string> = {
  Committed:  "text-muted-foreground border-edge",
  Deposited:  "text-amber-core border-amber-core/40",
  Active:     "text-success border-success/40",
  Exited:     "text-destructive border-destructive/40",
  Withdrawn:  "text-muted-foreground border-edge",
  Claimed:    "text-[oklch(0.72_0.14_240)] border-[oklch(0.55_0.14_240/0.4)]",
};

const MEMBER_STATE_ICON: Record<string, string> = {
  Committed: "⏳", Deposited: "✓", Active: "✦", Exited: "✗", Withdrawn: "↩", Claimed: "★",
};

function GroupVaultDetail() {
  const { vaultId } = Route.useParams();
  const rawVault = useGroupVaultStore((s) => s.vaults.find((v) => v.id === vaultId));
  const fetchVaults = useGroupVaultStore((s) => s.fetchVaults);
  const fetchVaultById = useGroupVaultStore((s) => s.fetchVaultById);
  const fetchZkVaultById = useGroupVaultStore((s) => s.fetchZkVaultById);
  const loading = useGroupVaultStore((s) => s.loading);
  const deposit = useGroupVaultStore((s) => s.deposit);
  const depositZk = useGroupVaultStore((s) => s.depositZk);
  const withdraw = useGroupVaultStore((s) => s.withdraw);
  const withdrawZk = useGroupVaultStore((s) => s.withdrawZk);
  const cancel = useGroupVaultStore((s) => s.cancel);
  const claimPool = useGroupVaultStore((s) => s.claimPool);
  const claimPoolZk = useGroupVaultStore((s) => s.claimPoolZk);
  const saveMemberSecret = useGroupVaultStore((s) => s.saveMemberSecret);
  const address = useWalletStore((s) => s.address);

  const [signing, setSigning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"deposit" | "withdraw" | "cancel" | "claim" | null>(null);
  const [freshLoaded, setFreshLoaded] = useState(false);
  const [zkSecret, setZkSecret] = useState("");
  const [zkSecretError, setZkSecretError] = useState<string | null>(null);
  const [autoRevealed, setAutoRevealed] = useState(false);

  // Reset ZK membership state when wallet address changes (switching between member wallets)
  const prevAddressRef = useRef(address);
  useEffect(() => {
    if (prevAddressRef.current !== address) {
      prevAddressRef.current = address;
      setAutoRevealed(false);
      setZkSecret("");
      setZkSecretError(null);
      // Clear stale ZK membership from previous wallet
      saveMemberSecret(vaultId, "", "", -1);
    }
  }, [address]);

  // Auto-detect member slot using memberSecrets (browser-local) or address-derived secret
  useEffect(() => {
    if (!rawVault?.isZk || rawVault.memberSecret || autoRevealed || !address) return;
    (async () => {
      // 1. memberSecrets (fast — creator's localStorage)
      const entry = rawVault.memberSecrets?.find(s => s.address === address);
      if (entry) {
        setAutoRevealed(true);
        saveMemberSecret(vaultId, entry.secret, entry.commitment, entry.slot);
        return;
      }
      // 2. Address-derived secret — try each slot's amount to find matching commitment
      try {
        const derived = await deriveSecretFromAddress(address);
        for (let i = 0; i < rawVault.members.length; i++) {
          const m = rawVault.members[i];
          if (m.obligationStroops && m.commitment) {
            const expected = await computeZkDepositCommitment(BigInt(m.obligationStroops), derived);
            if (expected === m.commitment) {
              setAutoRevealed(true);
              saveMemberSecret(vaultId, derived, expected, i);
              return;
            }
          }
        }
      } catch { /* fall through — manual input */ }
    })();
  }, [rawVault?.isZk, rawVault?.memberSecret, autoRevealed, address, rawVault?.memberSecrets, rawVault?.members]);

  // Always fetch fresh data from chain on mount — never trust stale localStorage
  useEffect(() => {
    setFreshLoaded(false);
    const mode = rawVault?.isZk;
    if (mode === true) {
      fetchZkVaultById(vaultId).then(() => setFreshLoaded(true)).catch(() => setFreshLoaded(true));
    } else if (mode === false) {
      fetchVaultById(vaultId).then(() => setFreshLoaded(true)).catch(() => setFreshLoaded(true));
    } else {
      // Unknown mode — try ZK first, fall back to standard
      fetchZkVaultById(vaultId).then(() => setFreshLoaded(true)).catch(() => {
        fetchVaultById(vaultId).then(() => setFreshLoaded(true)).catch(() => setFreshLoaded(true));
      });
    }
  }, [vaultId, rawVault?.isZk]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show loading spinner until fresh data arrives
  const vault = freshLoaded ? rawVault : null;

  if (!vault) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto text-center py-20 flex flex-col gap-6">
          {!freshLoaded ? (
            <>
              <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse">
                Loading vault from chain…
              </div>
            </>
          ) : (
            <>
              <h1 className="text-2xl">Group vault not found</h1>
              <p className="text-sm text-muted-foreground">
                This vault doesn't exist or couldn't be loaded.
              </p>
              <button
                onClick={() => { setFreshLoaded(false); fetchVaultById(vaultId).then(() => setFreshLoaded(true)); }}
                className="mx-auto bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-3 rounded-sm hover:shadow-amber-glow transition-shadow"
              >
                ↻ Try Again
              </button>
            </>
          )}
          <Link to="/group" className="font-mono text-xs text-amber-core">← Group Vaults</Link>
        </div>
      </AppShell>
    );
  }

  const myMember = address
    ? vault.isZk
      ? vault.memberSecret && vault.slotIndex !== undefined
        ? vault.members[vault.slotIndex] ?? null
        : null
      : vault.members.find((m) => m.address.trim() === address.trim())
    : null;
  const myState = myMember?.state ?? null;
  const unlockDate = new Date(vault.unlockTime * 1000);
  const deadlineDate = new Date(vault.fundingDeadline * 1000);
  const now = Date.now();
  const isPastDeadline = now > vault.fundingDeadline * 1000;
  const isPastUnlock = now > vault.unlockTime * 1000;

  const statusTone = vault.status === "resolved" ? "muted"
    : vault.status === "cancelled" ? "muted"
    : vault.status === "settlement" ? "success"
    : vault.status === "active" ? "amber"
    : "amber";

  const statusLabel = {
    funding: "Funding Open", active: "Active Locked",
    settlement: "Settlement Ready", resolved: "Resolved", cancelled: "Cancelled",
  }[vault.status];

  const doAction = async (action: typeof confirmAction) => {
    if (!action) return;
    setSigning(true);
    setActionError(null);
    try {
      if (vault?.isZk) {
        if (action === "deposit") await depositZk(vaultId);
        else if (action === "withdraw") await withdrawZk(vaultId);
        else if (action === "cancel") await cancel(vaultId);
        else if (action === "claim") await claimPoolZk(vaultId);
      } else {
        if (action === "deposit") await deposit(vaultId);
        else if (action === "withdraw") await withdraw(vaultId);
        else if (action === "cancel") await cancel(vaultId);
        else if (action === "claim") await claimPool(vaultId);
      }
      setConfirmAction(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setSigning(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <Link to="/group" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
          ← Group Vaults
        </Link>

        {/* Header */}
        <MachinedCard>
          <div className="p-8 md:p-10 flex flex-col gap-8">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <AssetChip asset={vault.token} size="md" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Group Vault</span>
                  {vault.isZk && (
                    <span className="font-mono text-[9px] uppercase tracking-[0.2em] px-2 py-0.5 border border-amber-core/40 text-amber-core rounded-sm bg-amber-core/5">
                      ZK Privacy
                    </span>
                  )}
                </div>
                <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
                  {vault.name || `Group Vault #${vault.id}`}
                </h1>
                <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                  <span className={cn("text-3xl font-mono", ASSETS[vault.token].accent)}>{ASSETS[vault.token].glyph}</span>
                  <span className="text-4xl md:text-5xl font-mono text-foreground tabular tracking-tighter">
                    {formatAsset(vault.totalSize, vault.token)}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">{vault.token}</span>
                </div>
              </div>
              <StatusPill tone={statusTone}>{statusLabel}</StatusPill>
            </div>

            {/* Funding progress */}
            {vault.status === "funding" && (
              <div className="bg-surface-deep border border-edge p-5 rounded-sm flex flex-col gap-3" style={{ boxShadow: "inset 0 2px 10px oklch(0 0 0 / 0.6)" }}>
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  <span>Funding Progress</span>
                  <span className="text-foreground">{vault.depositedCount} / {vault.members.length}</span>
                </div>
                <div className="h-1.5 bg-edge rounded-none overflow-hidden">
                  <div className="h-full bg-amber-core transition-all" style={{ width: `${(vault.depositedCount / vault.members.length) * 100}%` }} />
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  Deadline: <span className="text-foreground">{deadlineDate.toLocaleString()}</span>
                  {isPastDeadline && <span className="text-destructive ml-2">— Deadline passed</span>}
                </div>
              </div>
            )}

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-6 border-t border-edge">
              <Stat label="Members" value={`${vault.members.length}`} />
              <Stat label="Lock Type" value={vault.lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"} />
              <Stat label="Penalty" value={vault.lockType === "strict" ? "—" : `${vault.penaltyPercent}%`} />
              <Stat label="Unlocks" value={formatUnlockDate(unlockDate)} />
            </div>

            {/* Unlock timezone display */}
            <div className="bg-surface-deep border border-edge rounded-sm p-5 flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Unlock Time</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {formatUnlockTimezones(unlockDate).map(({ label, value }) => (
                  <div key={label} className="flex flex-col gap-1">
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">{label}</span>
                    <span className="font-mono text-xs text-foreground tabular whitespace-nowrap">{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Community pool */}
            {vault.poolBalance > 0 && (
              <div className="bg-surface-deep border border-amber-core/30 p-5 rounded-sm flex items-center justify-between">
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">Community Pool</div>
                  <div className="font-mono text-lg text-amber-core tabular">
                    {formatAsset(vault.poolBalance, vault.token)} {vault.token}
                  </div>
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">Penalty redistribution</div>
              </div>
            )}

            {/* Member grid */}
            <div className="flex flex-col gap-3">
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Members</div>
              <div className="grid grid-cols-1 gap-2">
                {vault.members.map((m, idx) => {
                  const isMe = vault.isZk
                    ? vault.slotIndex === idx
                    : m.address === address;
                  const label = vault.isZk
                    ? `Slot ${idx}`
                    : m.address;
                  return (
                    <div key={vault.isZk ? `slot-${idx}` : m.address} className={cn(
                      "flex items-center justify-between gap-4 p-3 border rounded-sm",
                      isMe ? "border-amber-core/40 bg-amber-core/5" : "border-edge bg-surface-deep",
                    )}>
                      <div className="flex items-center gap-3 min-w-0">
                        <span className={cn("font-mono text-[10px] px-2 py-0.5 border rounded-sm shrink-0", MEMBER_STATE_STYLE[m.state] ?? "text-muted-foreground border-edge")}>
                          {MEMBER_STATE_ICON[m.state] ?? "?"} {m.state}
                        </span>
                        <span className="font-mono text-xs text-foreground truncate">{label}</span>
                        {isMe && <span className="font-mono text-[10px] text-amber-core shrink-0">You</span>}
                      </div>
                      <div className="font-mono text-sm tabular text-foreground shrink-0">
                        {formatAsset(m.amount, vault.token)} {vault.token}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Your status banner */}
            {address && (
              <div className="bg-surface-deep border border-amber-core/30 p-5 rounded-sm flex flex-col gap-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">Your Status</div>
                    {myMember ? (
                      <div className="flex items-center gap-3 flex-wrap">
                        <span className={cn("font-mono text-[10px] px-2 py-0.5 border rounded-sm", MEMBER_STATE_STYLE[myMember.state] ?? "text-muted-foreground border-edge")}>
                          {MEMBER_STATE_ICON[myMember.state] ?? "?"} {myMember.state}
                        </span>
                        <span className="font-mono text-sm text-foreground">
                          {formatAsset(myMember.amount, vault.token)} {vault.token} obligation
                        </span>
                      </div>
                    ) : vault.isZk ? (
                      <div className="font-mono text-sm text-muted-foreground">Enter your member secret to prove membership</div>
                    ) : (
                      <div className="font-mono text-sm text-muted-foreground">Not a member — or refresh to load your status</div>
                    )}
                  </div>
                  <button
                    onClick={() => {
                      setFreshLoaded(false);
                      const fetcher = vault.isZk ? fetchZkVaultById : fetchVaultById;
                      fetcher(vaultId).then(() => setFreshLoaded(true));
                    }}
                    disabled={loading}
                    className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core hover:underline disabled:opacity-50 shrink-0"
                  >
                    {loading ? "Loading…" : "↻ Refresh"}
                  </button>
                </div>

                {/* ZK member secret */}
                {vault.isZk && !vault.memberSecret && !autoRevealed && (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <input
                        value={zkSecret}
                        onChange={(e) => setZkSecret(e.target.value)}
                        placeholder="Paste your member secret (64 hex chars)"
                        className="flex-1 bg-surface-deep border border-edge px-3 py-2 font-mono text-xs text-foreground rounded-sm outline-none focus:border-amber-core transition-colors"
                      />
                      <button
                        onClick={async () => {
                          setZkSecretError(null);
                          if (!zkSecret || zkSecret.length !== 64) return setZkSecretError("Invalid secret — must be 64 hex chars");
                          try {
                            // Find slot by trying each cached amount
                            const memberCount = vault.memberCount ?? vault.members.length;
                            let matchedSlot: number | undefined;
                            for (let s = 0; s < memberCount; s++) {
                              const m = vault.members[s];
                              if (m.obligationStroops && (m.commitment || true)) {
                                const expected = await computeZkDepositCommitment(BigInt(m.obligationStroops), zkSecret);
                                const onChainCommitment = vault.members[s].commitment
                                  ?? (await getZkMemberRecord(BigInt(vaultId), s))?.member_commitment;
                                if (onChainCommitment === expected) {
                                  matchedSlot = s;
                                  break;
                                }
                              }
                            }
                            if (matchedSlot === undefined) {
                              return setZkSecretError("Secret doesn't match any member slot in this vault");
                            }
                            // Recompute the matching commitment for the found slot
                            const foundMember = vault.members[matchedSlot];
                            const foundCommitment = foundMember?.obligationStroops
                              ? await computeZkDepositCommitment(BigInt(foundMember.obligationStroops), zkSecret)
                              : matchedSlot < vault.members.length ? vault.members[matchedSlot].commitment ?? "" : "";
                            saveMemberSecret(vaultId, zkSecret, foundCommitment, matchedSlot);
                            setZkSecret("");
                            setAutoRevealed(true);
                          } catch (e) {
                            setZkSecretError(String(e));
                          }
                        }}
                        className="bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.15em] px-4 py-2 rounded-sm hover:shadow-amber-glow transition-shadow shrink-0"
                      >
                        Unlock
                      </button>
                    </div>
                    {zkSecretError && (
                      <div className="font-mono text-[10px] text-destructive">{zkSecretError}</div>
                    )}
                    <div className="font-mono text-[9px] text-muted-foreground">
                      Ask the vault creator for your member secret. It proves you belong to this vault.
                    </div>
                  </div>
                )}
                {/* Auto-revealed secret — shown once when auto-detected */}
                {vault.isZk && autoRevealed && address && vault.memberSecrets?.find(s => s.address === address) && (
                  <div className="bg-amber-core/5 border border-amber-core/30 p-3 rounded-sm">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core mb-1">Your Member Secret</div>
                    <div className="font-mono text-[11px] text-foreground break-all select-all">
                      {vault.memberSecrets.find(s => s.address === address)?.secret}
                    </div>
                    <div className="font-mono text-[9px] text-muted-foreground mt-2">
                      {vault.memberSecret ? "✓ Membership confirmed — you can deposit." : "Auto-detected. Saving..."}
                    </div>
                  </div>
                )}
                {/* Confirmed membership — show obligation amount and actions */}
                {vault.isZk && vault.memberSecret && vault.slotIndex !== undefined && (
                  <div className="bg-success/5 border border-success/30 p-3 rounded-sm flex flex-col gap-2">
                    <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-success">✓ Membership Confirmed</div>
                    <div className="font-mono text-sm text-foreground">
                      Slot {vault.slotIndex} — Obligation: {formatAsset(vault.members[vault.slotIndex]?.amount ?? 0, vault.token)} {vault.token}
                    </div>
                    {vault.lockType === "penalty" && (
                      <div className="font-mono text-[10px] text-muted-foreground">
                        Early exit penalty: {vault.penaltyPercent}%
                      </div>
                    )}
                  </div>
                )}

                {/* Debug: show connected address vs member addresses */}
                <div className="font-mono text-[9px] text-muted-foreground bg-surface-deep border border-edge p-2 rounded-sm break-all">
                  <div>Connected: <span className="text-foreground">{address}</span></div>
                  <div>In member list: <span className={vault.members.some((m) => m.address.trim() === address.trim()) ? "text-success" : "text-destructive"}>
                    {vault.members.some((m) => m.address.trim() === address.trim()) ? "YES ✓" : "NO ✗"}
                  </span></div>
                  <div>Vault status: <span className="text-foreground">{vault.status}</span></div>
                  <div>Past deadline: <span className={isPastDeadline ? "text-destructive" : "text-success"}>{isPastDeadline ? "YES" : "NO"}</span></div>
                  <div>My state: <span className="text-foreground">{myMember?.state ?? "null"}</span></div>
                </div>

                {/* Deposit button — always show if member is in list (or ZK member confirmed) and vault is funding open */}
                {vault.status === "funding" && !isPastDeadline && address &&
                  (vault.isZk
                    ? vault.memberSecret && vault.slotIndex !== undefined
                    : vault.members.some((m) => m.address.trim() === address.trim())) && (
                  <button
                    onClick={() => setConfirmAction("deposit")}
                    className="w-full bg-amber-core text-primary-foreground font-mono text-sm uppercase tracking-[0.18em] px-6 py-4 rounded-sm hover:shadow-amber-glow transition-shadow flex items-center justify-center gap-3"
                  >
                    ✦ Deposit {formatAsset(myMember?.amount ?? 0, vault.token)} {vault.token}
                  </button>
                )}
              </div>
            )}

            {/* Action buttons */}
            {actionError && (
              <div className="bg-destructive/5 border border-destructive/30 p-3 rounded-sm font-mono text-xs text-destructive">{actionError}</div>
            )}

            <div className="flex flex-col gap-3">
              {/* Withdraw — mature or early exit */}
              {myState === "Active" && (vault.status === "settlement" || vault.status === "active") && (
                <button onClick={() => setConfirmAction("withdraw")}
                  className={cn("font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm flex items-center justify-center gap-3 transition-colors",
                    vault.status === "settlement"
                      ? "bg-success text-primary-foreground hover:shadow-amber-glow"
                      : vault.lockType === "penalty"
                        ? "bg-transparent border border-destructive/40 text-destructive hover:bg-destructive/10"
                        : "bg-surface-deep border border-edge text-muted-foreground cursor-not-allowed")}>
                  {vault.status === "settlement" ? "✓ Withdraw Funds" : vault.lockType === "penalty" ? "✗ Exit Early (Penalty)" : "🔒 Strict — No Early Exit"}
                </button>
              )}

              {/* Refund — cancelled vault */}
              {myState === "Deposited" && vault.status === "cancelled" && (
                <button onClick={() => setConfirmAction("withdraw")}
                  className="bg-surface-raised border border-edge hover:border-amber-core text-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm flex items-center justify-center gap-3 transition-colors">
                  ↩ Claim Refund
                </button>
              )}

              {/* Cancel — anyone can cancel after deadline */}
              {vault.status === "funding" && isPastDeadline && (
                <button onClick={() => setConfirmAction("cancel")}
                  className="bg-transparent border border-destructive/40 text-destructive font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm hover:bg-destructive/10 transition-colors flex items-center justify-center gap-3">
                  ✕ Cancel Vault (Deadline Passed)
                </button>
              )}

              {/* Claim pool */}
              {(myState === "Active" || myState === "Withdrawn") && vault.status === "settlement" && (
                <button onClick={() => setConfirmAction("claim")}
                  className="bg-surface-raised border border-amber-core/40 text-amber-core font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm hover:bg-amber-core/10 transition-colors flex items-center justify-center gap-3">
                  ★ Claim Pool Share {vault.poolBalance > 0 ? `(~${formatAsset(vault.poolBalance / Math.max(1, vault.members.filter(m => m.state === "Active" || m.state === "Withdrawn").length), vault.token)} ${vault.token})` : ""}
                </button>
              )}
            </div>
          </div>
        </MachinedCard>
      </div>

      {/* Confirm modal */}
      <AnimatePresence>
        {confirmAction && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-deep/90 backdrop-blur-sm"
            onClick={() => !signing && setConfirmAction(null)}>
            <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md bg-surface-base border border-edge rounded-sm shadow-vault p-8 flex flex-col gap-6">
              <div className="text-3xl">
                {confirmAction === "deposit" ? "✦" : confirmAction === "withdraw" ? "↩" : confirmAction === "cancel" ? "✕" : "★"}
              </div>
              <h2 className="text-xl font-medium tracking-tight">
                {confirmAction === "deposit" ? "Confirm Deposit" :
                 confirmAction === "withdraw" ? vault.status === "cancelled" ? "Claim Refund" : vault.status === "settlement" ? "Withdraw Funds" : "Exit Early" :
                 confirmAction === "cancel" ? "Cancel Vault" : "Claim Pool Share"}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {confirmAction === "deposit" && `You will deposit ${formatAsset(myMember?.amount ?? 0, vault.token)} ${vault.token} into the group vault.`}
                {confirmAction === "withdraw" && vault.status === "settlement" && `You will receive your full deposit of ${formatAsset(myMember?.amount ?? 0, vault.token)} ${vault.token}.`}
                {confirmAction === "withdraw" && vault.status === "active" && `You will exit early and forfeit ${vault.penaltyPercent}% as penalty to the community pool.`}
                {confirmAction === "withdraw" && vault.status === "cancelled" && `You will receive your full deposit back.`}
                {confirmAction === "cancel" && "The vault will be cancelled. All depositors can then claim their refunds."}
                {confirmAction === "claim" && "You will claim your equal share of the community pool."}
              </p>
              <div className="flex gap-3">
                <button onClick={() => !signing && setConfirmAction(null)} disabled={signing}
                  className="flex-1 bg-transparent border border-edge text-muted-foreground font-mono text-xs uppercase tracking-[0.18em] px-4 py-3 rounded-sm disabled:opacity-60">
                  Cancel
                </button>
                <button onClick={() => doAction(confirmAction)} disabled={signing}
                  className="flex-1 bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-4 py-3 rounded-sm hover:shadow-amber-glow transition-shadow disabled:opacity-60">
                  {signing ? "Awaiting signature…" : "Confirm"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">{label}</div>
      <div className="font-mono text-sm text-foreground tabular">{value}</div>
    </div>
  );
}
