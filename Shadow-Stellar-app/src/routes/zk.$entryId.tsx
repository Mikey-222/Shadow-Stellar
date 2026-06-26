import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { AssetChip } from "@/components/AssetChip";
import { HexFileUpload } from "@/components/HexFileUpload";
import { StatusPill } from "@/components/StatusPill";
import { useZkVaultStore } from "@/store/zk-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSETS, formatAsset } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/zk/$entryId")({
  head: () => ({ meta: [{ title: "ZK Vault — Shadow-Stellar" }] }),
  component: ZkVaultDetail,
});

function ZkVaultDetail() {
  const { entryId } = Route.useParams();
  const navigate = useNavigate();

  const vault        = useZkVaultStore(s => s.vaults.find(v => v.id === entryId));
  const fetchVaults  = useZkVaultStore(s => s.fetchVaults);
  const withdrawFn   = useZkVaultStore(s => s.withdrawZkVault);
  const withdrawUltraHonkFn = useZkVaultStore(s => s.withdrawZkVaultUltraHonk);
  const address      = useWalletStore(s => s.address);

  const [signing, setSigning]         = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [confirm, setConfirm]         = useState(false);
  const [copied, setCopied]           = useState<"blinding" | "commitment" | "nullifier" | null>(null);
  const [loading, setLoading]         = useState(!vault);
  const [ultraHonkWithdrawProof, setUltraHonkWithdrawProof] = useState("");
  const [ultraHonkWithdrawPubInputs, setUltraHonkWithdrawPubInputs] = useState("");

  useEffect(() => {
    if (!vault) {
      fetchVaults().then(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, [entryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const copy = async (field: "blinding" | "commitment" | "nullifier", value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const doWithdraw = async () => {
    setSigning(true);
    setError(null);
    try {
      if (vault?.proofType === "ultrahonk") {
        if (!ultraHonkWithdrawProof || !ultraHonkWithdrawPubInputs) {
          throw new Error("Provide UltraHonk proof bytes and public inputs");
        }
        await withdrawUltraHonkFn(entryId, ultraHonkWithdrawProof, ultraHonkWithdrawPubInputs);
      } else {
        await withdrawFn(entryId);
      }
      setConfirm(false);
      navigate({ to: "/zk" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Withdrawal failed");
    } finally {
      setSigning(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-20 text-center font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse">
          Loading ZK entry from chain…
        </div>
      </AppShell>
    );
  }

  if (!vault) {
    return (
      <AppShell>
        <div className="max-w-2xl mx-auto py-20 text-center flex flex-col gap-6">
          <h1 className="text-2xl">ZK entry not found</h1>
          <Link to="/zk" className="font-mono text-xs text-amber-core">← ZK Vaults</Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto flex flex-col gap-8">
        <Link to="/zk" className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors">
          ← ZK Vaults
        </Link>

        <MachinedCard>
          <div className="p-8 md:p-10 flex flex-col gap-8">

            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <AssetChip asset={vault.token} size="md" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">🔏 ZK Vault</span>
                </div>
                <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
                  {vault.name || `ZK Entry #${vault.id}`}
                </h1>
                <div className="mt-4 flex items-baseline gap-3 flex-wrap">
                  <span className={cn("text-3xl font-mono", ASSETS[vault.token].accent)}>{ASSETS[vault.token].glyph}</span>
                  <span className="text-4xl md:text-5xl font-mono text-foreground tabular tracking-tighter">
                    {formatAsset(vault.amount, vault.token)}
                  </span>
                  <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">{vault.token}</span>
                </div>
              </div>
              <StatusPill tone={vault.withdrawn ? "muted" : "amber"}>
                {vault.withdrawn ? "Withdrawn" : "ZK Active"}
              </StatusPill>
            </div>

            {/* ZK Proof Data */}
            <div className="bg-surface-deep border border-edge rounded-sm p-5 flex flex-col gap-4"
              style={{ boxShadow: "inset 0 2px 10px oklch(0 0 0 / 0.6)" }}>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">ZK Proof Data</div>

              {[
                { label: "Commitment (on-chain)", field: "commitment" as const, value: vault.commitment, color: "text-foreground" },
                { label: "Nullifier (on-chain)",  field: "nullifier"  as const, value: vault.nullifier,  color: "text-foreground" },
                { label: "Blinding Factor (SECRET — keep safe)", field: "blinding" as const, value: vault.blinding, color: "text-amber-core" },
              ].map(({ label, field, value, color }) => (
                <div key={field} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</span>
                    <button
                      onClick={() => copy(field, value)}
                      className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core hover:underline shrink-0"
                    >
                      {copied === field ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                  <div className={cn("font-mono text-[10px] break-all bg-surface-sunken border border-edge p-2 rounded-sm", color)}>
                    {value || "—"}
                  </div>
                </div>
              ))}

              {!vault.blinding && (
                <div className="bg-destructive/5 border border-destructive/30 p-3 rounded-sm font-mono text-xs text-destructive">
                  ⚠ Blinding factor not found in this browser. Withdrawal is not possible from this device.
                </div>
              )}
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-6 border-t border-edge">
              <Stat label="Entry ID" value={`#${vault.id}`} />
              <Stat label="Deposited" value={vault.depositedAt ? new Date(vault.depositedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase() : "—"} />
              <Stat label="Privacy" value={vault.proofType === "ultrahonk" ? "UltraHONK zk-SNARK" : "SHA-256 Pedersen"} />
            </div>

            {vault.proofType === "sha256" && (
              <div className="bg-amber-core/5 border border-amber-core/30 p-4 rounded-sm flex flex-col gap-2">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">⚠ Back Up Your Blinding Factor</div>
                <div className="text-sm text-muted-foreground leading-relaxed">
                  The blinding factor above is your cryptographic proof of ownership. Copy it somewhere safe.
                  If this browser's localStorage is cleared, you <span className="text-destructive">cannot withdraw</span>.
                </div>
              </div>
            )} 

            {vault.proofType === "ultrahonk" && (
              <div className="bg-surface-deep border border-edge rounded-sm p-4 flex flex-col gap-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-amber-core">UltraHonk Withdrawal Proof</div>
                <HexFileUpload label="Proof bytes" value={ultraHonkWithdrawProof} onChange={setUltraHonkWithdrawProof}
                  placeholder="Proof bytes hex" accept=".hex,.proof,.txt" />
                <HexFileUpload label="Public inputs" value={ultraHonkWithdrawPubInputs} onChange={setUltraHonkWithdrawPubInputs}
                  placeholder="Public inputs hex" accept=".hex,.pub,.txt" />
              </div>
            )}

            {/* Actions */}
            {error && (
              <div className="bg-destructive/5 border border-destructive/30 p-3 rounded-sm font-mono text-xs text-destructive">{error}</div>
            )}

            {vault.proofType === "sha256" && !vault.withdrawn && !vault.blinding && (
              <div className="bg-destructive/5 border border-destructive/30 p-3 rounded-sm font-mono text-xs text-destructive">
                ⚠ Blinding factor not found in this browser. Withdrawal is not possible from this device.
              </div>
            )}

            {!vault.withdrawn && (
              <button
                onClick={() => setConfirm(true)}
                disabled={vault.proofType === "sha256" && !vault.blinding}
                className={cn(
                  "w-full font-mono text-xs uppercase tracking-[0.18em] px-6 py-4 rounded-sm flex items-center justify-center gap-3 transition-colors",
                  (vault.proofType === "ultrahonk" || vault.blinding)
                    ? "bg-success text-primary-foreground hover:shadow-amber-glow transition-shadow"
                    : "bg-surface-deep border border-edge text-muted-foreground cursor-not-allowed",
                )}
              >
                {vault.proofType === "ultrahonk"
                  ? `🔑 Withdraw ${formatAsset(vault.amount, vault.token)} ${vault.token} (UltraHONK)`
                  : vault.blinding
                    ? `🔑 Withdraw ${formatAsset(vault.amount, vault.token)} ${vault.token}`
                    : "⚠ Blinding factor missing — cannot withdraw"}
              </button>
            )}

            {vault.withdrawn && (
              <div className="bg-surface-deep border border-edge p-5 rounded-sm font-mono text-sm text-muted-foreground text-center">
                ✓ This entry has been fully withdrawn.
              </div>
            )}
          </div>
        </MachinedCard>

        {/* Contract link */}
        <div className="text-center font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <a
            href={`https://stellar.expert/explorer/testnet/contract/CBIJMJ6SDKD2CPTFBKE4APC7ATFNGOX7XMOFCI47YFSRQNDFLBBDPLLI`}
            target="_blank" rel="noopener noreferrer"
            className="hover:text-amber-core transition-colors"
          >
            View ZK contract on Stellar Expert →
          </a>
        </div>
      </div>

      {/* Confirm modal */}
      <AnimatePresence>
        {confirm && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-surface-deep/90 backdrop-blur-sm"
            onClick={() => !signing && setConfirm(false)}>
            <motion.div initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
              onClick={e => e.stopPropagation()}
              className="edge-highlight relative w-full max-w-md bg-surface-base border border-edge rounded-sm shadow-vault p-8 flex flex-col gap-6">
              <div className="text-4xl">🔑</div>
              <h2 className="text-2xl font-medium tracking-tight">Confirm ZK Withdrawal</h2>
              <p className="text-muted-foreground leading-relaxed">
                {vault.proofType === "ultrahonk" ? (
                  <>Your UltraHonk proof will be submitted to the verifier contract. On verification success,
                  <span className="text-foreground font-mono"> {formatAsset(vault.amount, vault.token)} {vault.token}</span> will be released.</>
                ) : (
                  <>Your blinding factor will be submitted as a proof. The contract will verify
                  <span className="text-foreground font-mono"> SHA-256(amount || r) == commitment</span> and
                  release <span className="text-foreground font-mono">{formatAsset(vault.amount, vault.token)} {vault.token}</span> to your wallet.</>
                )}
              </p>
              <div className="flex gap-3">
                <button onClick={() => !signing && setConfirm(false)} disabled={signing}
                  className="flex-1 bg-transparent border border-edge text-muted-foreground font-mono text-xs uppercase tracking-[0.18em] px-4 py-3 rounded-sm disabled:opacity-60">
                  Cancel
                </button>
                <button onClick={doWithdraw} disabled={signing}
                  className="flex-1 bg-success text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-4 py-3 rounded-sm hover:shadow-amber-glow transition-shadow disabled:opacity-60">
                  {signing ? "Verifying proof…" : "Confirm Withdrawal"}
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
