import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { useGroupVaultStore } from "@/store/group-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSET_CODES, ASSETS, formatAsset, type AssetCode } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/group/create")({
  head: () => ({ meta: [{ title: "Create Group Vault — Shadow-Stellar" }] }),
  component: CreateGroupVault,
});

const STEPS = ["Asset", "Members", "Duration", "Lock Type", "Penalty", "Confirm"] as const;

const DURATION_PRESETS = [
  { label: "7 Days", days: 7 },
  { label: "30 Days", days: 30 },
  { label: "90 Days", days: 90 },
  { label: "6 Months", days: 180 },
  { label: "1 Year", days: 365 },
] as const;

function CreateGroupVault() {
  const navigate = useNavigate();
  const createGroupVault = useGroupVaultStore((s) => s.createGroupVault);
  const balances = useWalletStore((s) => s.balances);
  const address = useWalletStore((s) => s.address);

  const [step, setStep] = useState(0);
  const [asset, setAsset] = useState<AssetCode>("XLM");
  const [memberRows, setMemberRows] = useState<{ address: string; amount: string }[]>([
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
    { address: "", amount: "" },
  ]);
  const [durationDays, setDurationDays] = useState(30);
  const [customDuration, setCustomDuration] = useState("");
  const [fundingHours, setFundingHours] = useState(168); // 7 days default
  const [lockType, setLockType] = useState<"strict" | "penalty">("penalty");
  const [penaltyPercent, setPenaltyPercent] = useState(10);
  const [vaultName, setVaultName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const unlockDate = useMemo(() => new Date(Date.now() + durationDays * 86_400_000), [durationDays]);
  const deadlineDate = useMemo(() => new Date(Date.now() + fundingHours * 3_600_000), [fundingHours]);

  const validMembers = memberRows.filter(
    (r) => r.address.trim().length > 0 && Number(r.amount) > 0,
  );
  const totalSize = validMembers.reduce((s, r) => s + Number(r.amount), 0);

  const next = () => {
    setError(null);
    if (step === 1) {
      if (validMembers.length < 5) return setError("Minimum 5 members required");
      if (validMembers.length > 100) return setError("Maximum 100 members allowed");
      for (const r of validMembers) {
        if (!r.address.startsWith("G") || r.address.length !== 56)
          return setError(`Invalid Stellar address: ${r.address.slice(0, 10)}…`);
      }
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const back = () => { setError(null); setStep((s) => Math.max(0, s - 1)); };

  const submit = async () => {
    setError(null);
    if (validMembers.length < 5) return setError("Minimum 5 members required");
    setSigning(true);
    try {
      const vault = await createGroupVault({
        name: vaultName.trim() || undefined,
        token: asset,
        members: validMembers.map((r) => ({ address: r.address.trim(), amount: Number(r.amount) })),
        durationDays,
        fundingHours,
        lockType,
        penaltyPercent,
      });
      navigate({ to: "/group/$vaultId", params: { vaultId: vault.id } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setSigning(false);
    }
  };

  const addRow = () => setMemberRows((r) => [...r, { address: "", amount: "" }]);
  const removeRow = (i: number) => setMemberRows((r) => r.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: "address" | "amount", val: string) =>
    setMemberRows((r) => r.map((row, idx) => idx === i ? { ...row, [field]: val } : row));

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto flex flex-col gap-8">
        <div>
          <Link to="/group" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
            ← Group Vaults
          </Link>
          <h1 className="mt-3 text-3xl md:text-4xl font-medium tracking-tight">Create Group Vault</h1>
          <p className="text-muted-foreground mt-2 text-sm">Lock together. Stay accountable.</p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {STEPS.map((_, i) => (
            <div key={i} className="flex-1">
              <div className={cn("h-1 rounded-none transition-colors", i <= step ? "bg-amber-core" : "bg-edge")} />
            </div>
          ))}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-4">
          Step {step + 1} / {STEPS.length} · {STEPS[step]}
        </div>

        <MachinedCard>
          <div className="p-8 md:p-10 min-h-[360px]">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex flex-col gap-6">

                {/* Step 0 — Asset */}
                {step === 0 && (
                  <>
                    <Label>Select asset for the group vault</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_CODES.map((code) => (
                        <button key={code} type="button" onClick={() => setAsset(code)}
                          className={cn("p-4 border rounded-sm flex flex-col items-center gap-1 transition-colors",
                            asset === code ? "border-amber-core bg-amber-core/5" : "border-edge bg-surface-deep hover:border-edge-strong")}>
                          <div className={cn("text-2xl font-mono", ASSETS[code].accent)}>{ASSETS[code].glyph}</div>
                          <div className="font-mono text-sm text-foreground tracking-[0.15em] uppercase">{code}</div>
                          <div className="font-mono text-[10px] text-muted-foreground tabular">{formatAsset(balances[code] ?? 0, code)}</div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Step 1 — Members */}
                {step === 1 && (
                  <>
                    <Label>Add members (5–100) and their obligation amounts</Label>
                    <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
                      {memberRows.map((row, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <span className="font-mono text-[10px] text-muted-foreground w-5 shrink-0">{i + 1}</span>
                          <input
                            value={row.address}
                            onChange={(e) => updateRow(i, "address", e.target.value)}
                            placeholder="G... Stellar address"
                            className="flex-1 bg-surface-deep border border-edge px-3 py-2 font-mono text-xs text-foreground rounded-sm outline-none focus:border-amber-core transition-colors min-w-0"
                          />
                          <input
                            type="number"
                            value={row.amount}
                            onChange={(e) => updateRow(i, "amount", e.target.value)}
                            placeholder="Amount"
                            className="w-24 bg-surface-deep border border-edge px-3 py-2 font-mono text-xs text-foreground rounded-sm outline-none focus:border-amber-core transition-colors"
                          />
                          <span className="font-mono text-[10px] text-muted-foreground w-10 shrink-0">{asset}</span>
                          {memberRows.length > 5 && (
                            <button onClick={() => removeRow(i)} className="text-destructive text-xs hover:text-destructive/70 shrink-0">✕</button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <button onClick={addRow} className="font-mono text-[11px] uppercase tracking-[0.15em] text-amber-core hover:underline">
                        + Add member
                      </button>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        Total: <span className="text-foreground">{formatAsset(totalSize, asset)} {asset}</span>
                        {" · "}{validMembers.length} valid members
                      </div>
                    </div>
                    {address && (
                      <div className="font-mono text-[10px] text-muted-foreground bg-surface-deep border border-edge p-3 rounded-sm">
                        Your address: <span className="text-foreground break-all">{address}</span>
                      </div>
                    )}
                  </>
                )}

                {/* Step 2 — Duration */}
                {step === 2 && (
                  <>
                    <Label>Lock duration</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {DURATION_PRESETS.map((d) => (
                        <button key={d.days} type="button"
                          onClick={() => { setDurationDays(d.days); setCustomDuration(""); }}
                          className={cn("p-4 border rounded-sm flex flex-col items-center transition-colors",
                            durationDays === d.days && customDuration === "" ? "border-amber-core bg-amber-core/5" : "border-edge bg-surface-deep hover:border-edge-strong")}>
                          <div className="font-mono text-xl text-foreground tabular">{d.label}</div>
                        </button>
                      ))}
                    </div>
                    <div>
                      <Label small>Custom (days)</Label>
                      <input type="number" min={1} value={customDuration}
                        onChange={(e) => { setCustomDuration(e.target.value); const n = Number(e.target.value); if (n > 0) setDurationDays(n); }}
                        placeholder="e.g. 45"
                        className="mt-2 w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors" />
                    </div>
                    <div>
                      <Label small>Funding deadline — how long members have to deposit</Label>
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {[24, 48, 72, 168, 336].map((h) => (
                          <button key={h} type="button" onClick={() => setFundingHours(h)}
                            className={cn("px-3 py-2 font-mono text-xs border rounded-sm transition-colors",
                              fundingHours === h ? "border-amber-core text-amber-core bg-amber-core/10" : "border-edge text-muted-foreground hover:text-foreground")}>
                            {h < 48 ? `${h}h` : h < 168 ? `${h/24}d` : `${h/24}d`}
                          </button>
                        ))}
                      </div>
                      <div className="font-mono text-[10px] text-muted-foreground mt-2">
                        ⚠ If not all members deposit before this deadline, the vault is cancelled and funds are refunded.
                      </div>
                    </div>
                    <div className="font-mono text-[10px] text-muted-foreground space-y-1">
                      <div>Funding deadline: <span className="text-foreground">{deadlineDate.toLocaleString()}</span></div>
                      <div>Unlocks: <span className="text-foreground">{unlockDate.toLocaleString()}</span></div>
                    </div>
                  </>
                )}

                {/* Step 3 — Lock Type */}
                {step === 3 && (
                  <>
                    <Label>Lock rule for early exit</Label>
                    <div className="flex flex-col gap-3">
                      {[
                        { type: "strict" as const, icon: "🔒", title: "Strict Lock", desc: "No early exit. Members must wait until maturity." },
                        { type: "penalty" as const, icon: "⚠️", title: "Penalty Lock", desc: "Early exit allowed — member forfeits a penalty to the community pool." },
                      ].map((opt) => (
                        <button key={opt.type} type="button" onClick={() => setLockType(opt.type)}
                          className={cn("text-left p-5 border rounded-sm flex gap-4 transition-colors",
                            lockType === opt.type ? "border-amber-core bg-amber-core/5" : "border-edge bg-surface-deep hover:border-edge-strong")}>
                          <div className="text-2xl">{opt.icon}</div>
                          <div>
                            <div className="font-medium text-foreground">{opt.title}</div>
                            <div className="text-xs text-muted-foreground mt-1">{opt.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {/* Step 4 — Penalty */}
                {step === 4 && (
                  <>
                    <Label>{lockType === "strict" ? "No penalty — strict lock" : "Set the early exit penalty"}</Label>
                    {lockType === "strict" ? (
                      <div className="bg-surface-deep border border-edge p-6 text-sm text-muted-foreground rounded-sm">
                        Strict vaults have no penalty. Continue to confirm.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between flex-wrap gap-2">
                          <span className="font-mono text-5xl text-amber-core tabular">{penaltyPercent}%</span>
                          <span className="font-mono text-sm text-muted-foreground">forfeited on early exit</span>
                        </div>
                        <input type="range" min={5} max={50} step={1} value={penaltyPercent}
                          onChange={(e) => setPenaltyPercent(Number(e.target.value))}
                          className="w-full accent-amber-core" />
                        <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          <span>5% Mild</span><span>25% Painful</span><span>50% Brutal</span>
                        </div>
                        <div className="bg-destructive/5 border border-destructive/30 p-4 text-sm text-destructive font-mono rounded-sm">
                          ⚠ Early exit → {penaltyPercent}% penalty goes to community pool
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Step 5 — Confirm */}
                {step === 5 && (
                  <>
                    <Label>Name &amp; confirm</Label>
                    <input value={vaultName} onChange={(e) => setVaultName(e.target.value)} maxLength={60}
                      placeholder="Group vault name (optional)"
                      className="w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors" />
                    <div className="bg-surface-deep border border-edge p-6 rounded-sm space-y-4">
                      <Row label="Asset" value={`${ASSETS[asset].glyph} ${asset}`} />
                      <Row label="Members" value={`${validMembers.length}`} />
                      <Row label="Total size" value={`${formatAsset(totalSize, asset)} ${asset}`} highlight />
                      <Row label="Duration" value={`${durationDays} days`} />
                      <Row label="Funding deadline" value={`${fundingHours}h`} />
                      <Row label="Lock type" value={lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"} />
                      {lockType === "penalty" && <Row label="Penalty" value={`${penaltyPercent}%`} danger />}
                    </div>
                    <div className="bg-amber-core/5 border border-amber-core/30 p-4 text-sm text-amber-core font-mono rounded-sm">
                      ⚠ All members must deposit before the funding deadline or the vault is cancelled.
                    </div>
                  </>
                )}

                {error && <div className="text-destructive font-mono text-xs uppercase tracking-[0.15em]">{error}</div>}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="border-t border-edge bg-surface-sunken px-6 md:px-10 py-5 flex items-center justify-between">
            <button onClick={back} disabled={step === 0 || signing}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button onClick={next}
                className="bg-surface-raised border border-edge hover:border-amber-core text-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-3 transition-all rounded-sm flex items-center gap-3">
                Continue <span className="text-amber-core">→</span>
              </button>
            ) : (
              <button onClick={submit} disabled={signing}
                className="bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-3 rounded-sm hover:shadow-amber-glow transition-shadow flex items-center gap-3 disabled:opacity-60">
                {signing ? <span className="animate-pulse">Awaiting signature…</span> : <>Sign &amp; Create 🔒</>}
              </button>
            )}
          </div>
        </MachinedCard>
      </div>
    </AppShell>
  );
}

function Label({ children, small = false }: { children: React.ReactNode; small?: boolean }) {
  return (
    <div className={cn("font-mono uppercase tracking-[0.2em] text-muted-foreground", small ? "text-[10px]" : "text-[11px]")}>
      {children}
    </div>
  );
}

function Row({ label, value, highlight, danger }: { label: string; value: string; highlight?: boolean; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular text-sm text-right", highlight && "text-foreground text-base", danger && "text-destructive", !highlight && !danger && "text-foreground")}>
        {value}
      </span>
    </div>
  );
}
