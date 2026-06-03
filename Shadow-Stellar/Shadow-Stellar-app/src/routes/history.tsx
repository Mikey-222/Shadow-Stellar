import { createFileRoute, Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { AssetChip } from "@/components/AssetChip";
import { useVaultStore } from "@/store/vaults";
import { ASSET_CODES, ASSETS, formatAsset, type AssetCode } from "@/lib/assets";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/history")({
  head: () => ({
    meta: [
      { title: "History — Shadow-Stellar" },
      { name: "description", content: "Every vault, withdrawal, and ZK deposit on Shadow-Stellar." },
      { property: "og:title", content: "History — Shadow-Stellar" },
    ],
  }),
  component: History,
});

function History() {
  const transactions = useVaultStore((s) => s.transactions);
  const vaults = useVaultStore((s) => s.vaults);

  // Aggregate per asset
  const sumByAsset = (predicate: (t: (typeof transactions)[number]) => boolean) => {
    const out: Record<AssetCode, number> = { XLM: 0, USDC: 0, EURC: 0 };
    for (const t of transactions.filter(predicate)) {
      out[t.asset] = (out[t.asset] ?? 0) + Math.abs(t.amount);
    }
    return out;
  };
  const sumPenaltyByAsset = () => {
    const out: Record<AssetCode, number> = { XLM: 0, USDC: 0, EURC: 0 };
    for (const t of transactions) out[t.asset] = (out[t.asset] ?? 0) + (t.penalty ?? 0);
    return out;
  };

  const lockedTotals = sumByAsset((t) => t.type === "create");
  const withdrawnTotals = sumByAsset(
    (t) => t.type === "withdraw" || t.type === "early-withdraw",
  );
  const penaltyTotals = sumPenaltyByAsset();
  const completed = vaults.filter(
    (v) => v.status === "withdrawn" && !v.penaltyPaid,
  ).length;
  const totalPenalty = Object.values(penaltyTotals).reduce((s, v) => s + v, 0);

  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-medium tracking-tight">History</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Your full activity log. Every lock, every withdrawal, every penalty.
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <AssetSumCard label="Total Locked" totals={lockedTotals} />
          <AssetSumCard label="Total Withdrawn" totals={withdrawnTotals} />
          <AssetSumCard
            label="Penalties Paid"
            totals={penaltyTotals}
            tone={totalPenalty > 0 ? "danger" : undefined}
          />
          <SimpleStatCard label="Completed Streak" value={`${completed}`} tone="success" />
        </div>

        <MachinedCard>
          <div className="divide-y divide-edge">
            {transactions.length === 0 ? (
              <div className="p-12 text-center font-mono text-sm text-muted-foreground">
                No activity yet.
              </div>
            ) : (
              transactions.map((t, i) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.25, delay: Math.min(i * 0.02, 0.4) }}
                >
                  <Link
                    to="/vaults/$vaultId"
                    params={{ vaultId: t.vaultId }}
                    className="flex items-center justify-between gap-4 p-5 hover:bg-surface-raised/50 transition-colors"
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <TxnIcon type={t.type} />
                      <div className="min-w-0">
                        <div className="font-medium truncate flex items-center gap-2">
                          {t.vaultName}
                          <AssetChip asset={t.asset} />
                        </div>
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-0.5">
                          {labelFor(t.type)} ·{" "}
                          {new Date(t.at).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={cn(
                          "font-mono tabular text-base",
                          t.amount < 0 ? "text-amber-core" : "text-success",
                        )}
                      >
                        {t.amount < 0 ? "−" : "+"}
                        {formatAsset(Math.abs(t.amount), t.asset)} {t.asset}
                      </div>
                      {t.penalty && t.penalty > 0 && (
                        <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-destructive mt-0.5">
                          −{formatAsset(t.penalty, t.asset)} penalty
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              ))
            )}
          </div>
        </MachinedCard>
      </div>
    </AppShell>
  );
}

function labelFor(t: string) {
  switch (t) {
    case "create":
      return "Funds locked";
    case "withdraw":
      return "Matured withdrawal";
    case "early-withdraw":
      return "Early withdrawal";
    case "mature":
      return "Vault matured";
    default:
      return t;
  }
}

function TxnIcon({ type }: { type: string }) {
  const map: Record<string, { glyph: string; tone: string }> = {
    create: { glyph: "🔒", tone: "border-amber-core/30 bg-amber-core/10 text-amber-core" },
    withdraw: { glyph: "✓", tone: "border-success/30 bg-success/10 text-success" },
    "early-withdraw": {
      glyph: "✗",
      tone: "border-destructive/30 bg-destructive/10 text-destructive",
    },
    mature: { glyph: "★", tone: "border-success/30 bg-success/10 text-success" },
  };
  const { glyph, tone } = map[type] ?? map.create;
  return (
    <div
      className={cn(
        "size-10 shrink-0 border rounded-sm flex items-center justify-center font-mono text-sm",
        tone,
      )}
    >
      {glyph}
    </div>
  );
}

function AssetSumCard({
  label,
  totals,
  tone,
}: {
  label: string;
  totals: Record<AssetCode, number>;
  tone?: "danger";
}) {
  const nonZero = ASSET_CODES.filter((c) => totals[c] > 0);
  return (
    <MachinedCard>
      <div className="p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {label}
        </div>
        {nonZero.length === 0 ? (
          <div className="font-mono text-sm text-muted-foreground tabular">—</div>
        ) : (
          <div className="space-y-1">
            {nonZero.map((code) => (
              <div
                key={code}
                className={cn(
                  "font-mono text-sm tabular flex items-baseline gap-2",
                  tone === "danger" ? "text-destructive" : "text-foreground",
                )}
              >
                <span className={cn("text-xs", ASSETS[code].accent)}>
                  {ASSETS[code].glyph}
                </span>
                {formatAsset(totals[code], code)}
                <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  {code}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </MachinedCard>
  );
}

function SimpleStatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  return (
    <MachinedCard>
      <div className="p-5">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-2">
          {label}
        </div>
        <div
          className={cn(
            "font-mono text-xl tabular tracking-tight",
            tone === "danger" && "text-destructive",
            tone === "success" && "text-success",
            !tone && "text-foreground",
          )}
        >
          {value}
        </div>
      </div>
    </MachinedCard>
  );
}
