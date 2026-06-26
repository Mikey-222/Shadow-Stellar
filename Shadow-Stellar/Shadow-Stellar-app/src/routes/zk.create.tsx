import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { HexFileUpload } from "@/components/HexFileUpload";
import { useZkVaultStore } from "@/store/zk-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSET_CODES, ASSETS, formatAsset, type AssetCode } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/zk/create")({
  head: () => ({ meta: [{ title: "Create ZK Vault — Shadow-Stellar" }] }),
  component: CreateZkVault,
});

const STEPS = ["Asset", "Amount", "Confirm"] as const;

type ProofMode = "sha256" | "ultrahonk";

function CreateZkVault() {
  const navigate = useNavigate();
  const createZkVault = useZkVaultStore(s => s.createZkVault);
  const createZkVaultUltraHonk = useZkVaultStore(s => s.createZkVaultUltraHonk);
  const balances = useWalletStore(s => s.balances);

  const [step, setStep] = useState(0);
  const [asset, setAsset] = useState<AssetCode>("XLM");
  const [amount, setAmount] = useState<number>(0);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const [proofMode, setProofMode] = useState<ProofMode>("sha256");
  const [ultraHonkCommitment, setUltraHonkCommitment] = useState("");
  const [ultraHonkProof, setUltraHonkProof] = useState("");
  const [ultraHonkPublicInputs, setUltraHonkPublicInputs] = useState("");

  const balance = balances[asset] ?? 0;

  const next = () => {
    setError(null);
    if (step === 1) {
      if (!amount || amount <= 0) return setError("Enter an amount greater than zero");
      if (amount > balance) return setError(`Insufficient ${asset} balance`);
      if (proofMode === "ultrahonk") {
        if (!ultraHonkCommitment) return setError("Enter commitment hex");
        if (!ultraHonkProof) return setError("Enter proof bytes hex");
        if (!ultraHonkPublicInputs) return setError("Enter public inputs hex");
      }
    }
    setStep(s => Math.min(STEPS.length - 1, s + 1));
  };
  const back = () => { setError(null); setStep(s => Math.max(0, s - 1)); };

  const submit = async () => {
    setError(null);
    if (!amount || amount <= 0) return setError("Invalid amount");
    if (amount > balance) return setError(`Insufficient ${asset} balance`);
    setSigning(true);
    try {
      if (proofMode === "ultrahonk") {
        const vault = await createZkVaultUltraHonk({
          token: asset, amount, name: name.trim() || undefined,
          commitment: ultraHonkCommitment,
          proofBytes: ultraHonkProof,
          publicInputs: ultraHonkPublicInputs,
        });
        navigate({ to: "/zk/$entryId", params: { entryId: vault.id } });
      } else {
        const vault = await createZkVault({ token: asset, amount, name: name.trim() || undefined });
        navigate({ to: "/zk/$entryId", params: { entryId: vault.id } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setSigning(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-2xl mx-auto flex flex-col gap-8">
        <div>
          <Link to="/zk" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
            ← ZK Vaults
          </Link>
          <h1 className="mt-3 text-3xl md:text-4xl font-medium tracking-tight">
            Create ZK Vault
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Your deposit amount is hidden behind a Pedersen commitment. Only you can prove ownership.
          </p>
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
          <div className="p-8 md:p-10 min-h-[320px]">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className="flex flex-col gap-6">

                {/* Step 0 — Asset */}
                {step === 0 && (
                  <>
                    <Label>Select asset to commit privately</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_CODES.map(code => (
                        <button key={code} type="button" onClick={() => setAsset(code)}
                          className={cn("p-4 border rounded-sm flex flex-col items-center gap-1 transition-colors",
                            asset === code ? "border-amber-core bg-amber-core/5" : "border-edge bg-surface-deep hover:border-edge-strong")}>
                          <div className={cn("text-2xl font-mono", ASSETS[code].accent)}>{ASSETS[code].glyph}</div>
                          <div className="font-mono text-sm text-foreground tracking-[0.15em] uppercase">{code}</div>
                          <div className="font-mono text-[10px] text-muted-foreground tabular">{formatAsset(balances[code] ?? 0, code)}</div>
                        </button>
                      ))}
                    </div>
                    {/* ZK explanation */}
                    <div className="bg-surface-deep border border-edge rounded-sm p-4 flex flex-col gap-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">🔏 ZK Privacy Mode</div>
                      <div className="text-sm text-muted-foreground leading-relaxed">
                        A random <span className="text-foreground font-mono">blinding factor</span> is generated in your browser.
                        The on-chain record stores only <span className="text-foreground font-mono">SHA-256(amount || blinding)</span> —
                        never your plaintext amount. Withdrawal requires proving knowledge of the blinding factor.
                      </div>
                    </div>
                    {/* Proof type toggle */}
                    <div className="bg-surface-deep border border-edge rounded-sm p-4 flex flex-col gap-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Proof System</div>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setProofMode("sha256")}
                          className={cn("flex-1 p-3 border rounded-sm font-mono text-xs uppercase tracking-[0.15em] transition-colors",
                            proofMode === "sha256" ? "border-amber-core bg-amber-core/5 text-foreground" : "border-edge text-muted-foreground hover:text-foreground")}>
                          SHA-256 Hash
                        </button>
                        <button type="button" onClick={() => setProofMode("ultrahonk")}
                          className={cn("flex-1 p-3 border rounded-sm font-mono text-xs uppercase tracking-[0.15em] transition-colors",
                            proofMode === "ultrahonk" ? "border-amber-core bg-amber-core/5 text-foreground" : "border-edge text-muted-foreground hover:text-foreground")}>
                          UltraHONK SNARK
                        </button>
                      </div>
                    </div>
                  </>
                )}

                {/* Step 1 — Amount */}
                {step === 1 && (
                  <>
                    <Label>How much {asset} to commit?</Label>
                    <div className="flex items-baseline gap-3 border-b border-edge pb-3">
                      <span className={cn("text-3xl font-mono", ASSETS[asset].accent)}>{ASSETS[asset].glyph}</span>
                      <input
                        type="number" inputMode="decimal" step="any"
                        value={amount || ""}
                        onChange={e => setAmount(Number(e.target.value) || 0)}
                        className="flex-1 bg-transparent outline-none font-mono text-4xl md:text-5xl text-foreground tabular tracking-tighter min-w-0"
                        placeholder="0"
                      />
                      <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">{asset}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {[10, 50, 100, 500].map(v => (
                        <button key={v} type="button" onClick={() => setAmount(v)}
                          className={cn("px-3 py-2 font-mono text-xs uppercase tracking-[0.15em] border rounded-sm transition-colors",
                            amount === v ? "border-amber-core text-amber-core bg-amber-core/10" : "border-edge text-muted-foreground hover:text-foreground")}>
                          {v} {asset}
                        </button>
                      ))}
                      {balance > 0 && (
                        <button type="button" onClick={() => setAmount(balance)}
                          className={cn("px-3 py-2 font-mono text-xs uppercase tracking-[0.15em] border rounded-sm transition-colors",
                            amount === balance ? "border-amber-core text-amber-core bg-amber-core/10" : "border-edge text-muted-foreground hover:text-foreground")}>
                          Max
                        </button>
                      )}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Balance: <span className={amount > balance ? "text-destructive" : "text-foreground"}>
                        {formatAsset(balance, asset)} {asset}
                      </span>
                    </div>
                    {proofMode === "ultrahonk" && (
                      <div className="flex flex-col gap-3 pt-2 border-t border-edge">
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">UltraHonk Proof Data</div>
                        <HexFileUpload label="Commitment" value={ultraHonkCommitment} onChange={setUltraHonkCommitment}
                          placeholder="Commitment hex (64 chars)" accept=".hex,.txt,.commitment" />
                        <HexFileUpload label="Proof bytes" value={ultraHonkProof} onChange={setUltraHonkProof}
                          placeholder="Proof bytes hex" accept=".hex,.proof,.txt" />
                        <HexFileUpload label="Public inputs" value={ultraHonkPublicInputs} onChange={setUltraHonkPublicInputs}
                          placeholder="Public inputs hex" accept=".hex,.pub,.txt" />
                      </div>
                    )}
                  </>
                )}

                {/* Step 2 — Confirm */}
                {step === 2 && (
                  <>
                    <Label>Name &amp; confirm</Label>
                    <input value={name} onChange={e => setName(e.target.value)} maxLength={60}
                      placeholder="ZK vault label (optional)"
                      className="w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors" />

                    <div className="bg-surface-deep border border-edge p-6 rounded-sm space-y-4">
                      <Row label="Asset"       value={`${ASSETS[asset].glyph} ${asset}`} />
                      <Row label="Amount"      value={`${formatAsset(amount, asset)} ${asset}`} highlight />
                      <Row label="Proof type"  value={proofMode === "ultrahonk" ? "UltraHONK zk-SNARK" : "SHA-256 Pedersen Commitment"} />
                      <Row label="Privacy"     value="Amount hidden on-chain ✓" />
                      <Row label="Withdrawal"  value={proofMode === "ultrahonk" ? "Requires UltraHONK proof" : "Requires blinding factor proof"} />
                    </div>

                    {proofMode === "sha256" && (
                      <div className="bg-amber-core/5 border border-amber-core/30 p-4 rounded-sm flex flex-col gap-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">⚠ Save your blinding factor</div>
                        <div className="text-sm text-muted-foreground leading-relaxed">
                          After deposit, your blinding factor is stored in this browser's localStorage.
                          If you clear site data, you <span className="text-destructive font-mono">cannot withdraw</span>.
                          Export it from the vault detail page after creation.
                        </div>
                      </div>
                    )}
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
                {signing ? <span className="animate-pulse">Generating proof & signing…</span> : <>🔏 Commit &amp; Lock</>}
              </button>
            )}
          </div>
        </MachinedCard>
      </div>
    </AppShell>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">{children}</div>;
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</span>
      <span className={cn("font-mono tabular text-sm text-right", highlight ? "text-foreground text-base" : "text-foreground")}>{value}</span>
    </div>
  );
}
