import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { AssetChip } from "@/components/AssetChip";
import { StatusPill } from "@/components/StatusPill";
import { useZkVaultStore } from "@/store/zk-vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSET_CODES, ASSETS, formatAsset, type AssetCode } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/zk/")({
  head: () => ({
    meta: [
      { title: "ZK Vaults — Shadow-Stellar" },
      { name: "description", content: "Zero-knowledge private vaults. Commit amounts privately via SHA-256 Pedersen commitments on Stellar." },
    ],
  }),
  component: ZkVaults,
});

function ZkVaults() {
  const vaults  = useZkVaultStore(s => s.vaults);
  const loading = useZkVaultStore(s => s.loading);
  const fetch   = useZkVaultStore(s => s.fetchVaults);
  const address = useWalletStore(s => s.address);

  useEffect(() => { fetch(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const active   = vaults.filter(v => !v.withdrawn);
  const closed   = vaults.filter(v => v.withdrawn);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        {/* Header */}
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-medium tracking-tight">
              ZK Vaults
            </h1>
            <p className="text-muted-foreground mt-2 text-sm">
              Private commitments. Your amount is hidden behind a SHA-256 Pedersen commitment — only you can prove ownership.
            </p>
          </div>
          <Link
            to="/zk/create"
            className="bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-5 py-3 rounded-sm hover:shadow-amber-glow transition-shadow flex items-center gap-2"
          >
            🔏 New ZK Vault
          </Link>
        </div>

        {/* How It Works */}
        <MachinedCard>
          <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { icon: "🔏", title: "Commit Off-Chain", body: "Your blinding factor is generated in-browser. Only the commitment hash is stored on-chain — not your amount." },
              { icon: "⛓", title: "Lock On-Chain", body: "Tokens are transferred to the ZK contract. The entry is linked to your commitment and a one-time nullifier." },
              { icon: "🔑", title: "Prove to Withdraw", body: "Present your blinding factor as a ZK proof. The contract verifies it matches the stored commitment, then releases funds." },
            ].map(({ icon, title, body }) => (
              <div key={title} className="flex flex-col gap-2">
                <div className="text-2xl">{icon}</div>
                <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-foreground">{title}</div>
                <div className="text-sm text-muted-foreground leading-relaxed">{body}</div>
              </div>
            ))}
          </div>
        </MachinedCard>

        {/* Contract info */}
        <div className="bg-surface-deep border border-amber-core/20 rounded-sm p-4 font-mono text-[10px] text-muted-foreground flex flex-col gap-1">
          <span className="text-amber-core uppercase tracking-[0.15em]">ZK Contract (Testnet)</span>
          <span className="text-foreground break-all">CBIJMJ6SDKD2CPTFBKE4APC7ATFNGOX7XMOFCI47YFSRQNDFLBBDPLLI</span>
          <a
            href="https://stellar.expert/explorer/testnet/contract/CBIJMJ6SDKD2CPTFBKE4APC7ATFNGOX7XMOFCI47YFSRQNDFLBBDPLLI"
            target="_blank" rel="noopener noreferrer"
            className="text-amber-core hover:underline mt-1"
          >
            View on Stellar Expert →
          </a>
        </div>

        {loading && (
          <div className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground animate-pulse">
            Loading ZK entries from chain…
          </div>
        )}

        {!loading && vaults.length === 0 && (
          <MachinedCard className="p-12 text-center">
            <div className="font-mono text-sm text-muted-foreground">
              No ZK vaults yet. Create your first private commitment vault.
            </div>
          </MachinedCard>
        )}

        {active.length > 0 && (
          <section className="flex flex-col gap-4">
            <div className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Active <span className="text-foreground">/ {active.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {active.map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <MachinedCard className="hover:border-amber-core/40 transition-colors">
                    <Link to="/zk/$entryId" params={{ entryId: v.id }} className="block p-6 flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <AssetChip asset={v.token} />
                            <StatusPill tone="amber">ZK Active</StatusPill>
                          </div>
                          <h3 className="text-lg font-medium truncate">
                            {v.name || `ZK Entry #${v.id}`}
                          </h3>
                          <div className="font-mono text-[10px] text-muted-foreground mt-1 break-all">
                            Commitment: {v.commitment.slice(0, 16)}…
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-mono text-lg tabular">{formatAsset(v.amount, v.token)}</div>
                          <div className={cn("font-mono text-[10px] uppercase tracking-[0.15em] mt-1", ASSETS[v.token].accent)}>
                            {v.token}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        <span>Nullifier: {v.nullifier.slice(0, 12)}…</span>
                        <span className="text-foreground hover:text-amber-core transition-colors">View →</span>
                      </div>
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
              Withdrawn <span className="text-foreground">/ {closed.length}</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {closed.map((v, i) => (
                <motion.div key={v.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
                  <MachinedCard className="opacity-60 hover:opacity-90 transition-opacity">
                    <Link to="/zk/$entryId" params={{ entryId: v.id }} className="block p-6 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <AssetChip asset={v.token} />
                          <StatusPill tone="muted">Withdrawn</StatusPill>
                        </div>
                        <h3 className="text-base font-medium truncate">{v.name || `ZK Entry #${v.id}`}</h3>
                      </div>
                      <div className="font-mono text-sm tabular text-muted-foreground shrink-0">
                        {formatAsset(v.amount, v.token)} {v.token}
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
