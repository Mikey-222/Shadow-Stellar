import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { z } from "zod";
import { AppShell } from "@/components/AppShell";
import { MachinedCard } from "@/components/MachinedCard";
import { useVaultStore } from "@/store/vaults";
import { useWalletStore } from "@/store/wallet";
import { ASSET_CODES, ASSETS, formatAsset, type AssetCode } from "@/lib/assets";
import { formatUnlockDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create Solo Vault — Shadow-Stellar" },
      {
        name: "description",
        content: "Create a time-locked solo vault on Shadow-Stellar.",
      },
      { property: "og:title", content: "Create Solo Vault — Shadow-Stellar" },
    ],
  }),
  component: CreateVault,
});

const DURATIONS = [
  { days: 7, label: "7 Days" },
  { days: 30, label: "30 Days" },
  { days: 90, label: "90 Days" },
] as const;

const STEPS = ["Asset", "Amount", "Duration", "Lock Type", "Penalty", "Confirm"] as const;

const vaultSchema = z.object({
  asset: z.enum(["XLM", "USDC", "EURC"]),
  amount: z.number().positive("Amount must be greater than zero").max(1_000_000_000),
  durationDays: z.number().int().min(1, "Min 1 day").max(3650, "Max 10 years"),
  lockType: z.enum(["strict", "penalty"]),
  penaltyPercent: z.number().min(0).max(50),
  name: z.string().trim().min(1, "Name your vault").max(60),
  goal: z.string().trim().max(60).optional(),
});

function CreateVault() {
  const navigate = useNavigate();
  const createVault = useVaultStore((s) => s.createVault);
  const balances = useWalletStore((s) => s.balances);
  const trustlines = useWalletStore((s) => s.trustlines);
  const addTrustline = useWalletStore((s) => s.addTrustline);

  const [step, setStep] = useState(0);
  const [asset, setAsset] = useState<AssetCode>("USDC");
  const [amount, setAmount] = useState<number>(50);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [customDuration, setCustomDuration] = useState<string>("");
  const [lockType, setLockType] = useState<"strict" | "penalty">("penalty");
  const [penaltyPercent, setPenaltyPercent] = useState<number>(10);
  const [name, setName] = useState<string>("");
  const [goal, setGoal] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);

  const unlocksAt = useMemo(
    () => new Date(Date.now() + durationDays * 86_400_000),
    [durationDays],
  );

  const penaltyAmount =
    lockType === "penalty"
      ? Number(((amount * penaltyPercent) / 100).toFixed(ASSETS[asset].displayDecimals))
      : 0;

  const hasTrustline = trustlines[asset];
  const balance = balances[asset] ?? 0;

  const next = () => {
    setError(null);
    if (step === 0 && !hasTrustline) {
      return setError(`You need a ${asset} trustline before continuing`);
    }
    if (step === 1) {
      if (!Number.isFinite(amount) || amount <= 0) return setError("Enter an amount");
      if (amount > balance)
        return setError(
          `Not enough ${asset}. Wallet: ${formatAsset(balance, asset)} ${asset}`,
        );
    }
    if (step === 2 && (!Number.isFinite(durationDays) || durationDays < 1)) {
      return setError("Pick a valid duration");
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  const back = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };

  const submit = async () => {
    setError(null);
    const finalName = name.trim() || goal.trim() || `${asset} Vault`;
    const parsed = vaultSchema.safeParse({
      asset,
      amount,
      durationDays,
      lockType,
      penaltyPercent,
      name: finalName,
      goal: goal.trim() || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    if (amount > balance) {
      setError(`Not enough ${asset} in wallet`);
      return;
    }
    setSigning(true);
    try {
      const v = await createVault(parsed.data);
      navigate({ to: "/vaults/$vaultId", params: { vaultId: v.id } });
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
          <Link
            to="/"
            className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to dashboard
          </Link>
          <h1 className="mt-3 text-3xl md:text-4xl font-medium tracking-tight">
            Forge a Solo Vault
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Six steps. After confirmation, your wallet signs the lock.
          </p>
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex-1 flex items-center gap-2">
              <div
                className={cn(
                  "h-1 flex-1 rounded-none transition-colors",
                  i <= step ? "bg-amber-core" : "bg-edge",
                )}
              />
            </div>
          ))}
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground -mt-4">
          Step {step + 1} / {STEPS.length} · {STEPS[step]}
        </div>

        <MachinedCard>
          <div className="p-8 md:p-10 min-h-[340px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col gap-6"
              >
                {step === 0 && (
                  <>
                    <Label>Select asset to lock</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {ASSET_CODES.map((code) => (
                        <AssetTile
                          key={code}
                          code={code}
                          balance={balances[code] ?? 0}
                          active={asset === code}
                          onClick={() => setAsset(code)}
                        />
                      ))}
                    </div>
                    {!hasTrustline ? (
                      <div className="bg-warning/5 border border-warning/30 p-4 rounded-sm flex items-start gap-3">
                        <span className="text-warning text-lg shrink-0">⚠</span>
                        <div className="flex-1">
                          <div className="font-mono text-xs text-warning uppercase tracking-[0.15em]">
                            Trustline required
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            You need a trustline for {asset} before you can lock it.
                          </div>
                          <button
                            onClick={() => addTrustline(asset)}
                            className="mt-3 bg-warning/10 border border-warning/40 text-warning font-mono text-[11px] uppercase tracking-[0.18em] px-4 py-2 rounded-sm hover:bg-warning/20 transition-colors"
                          >
                            + Add {asset} trustline
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Wallet:{" "}
                        <span className="text-foreground">
                          {formatAsset(balance, asset)} {asset}
                        </span>
                      </div>
                    )}
                  </>
                )}

                {step === 1 && (
                  <>
                    <Label>How much {asset} do you want to lock?</Label>
                    <div className="flex items-baseline gap-3 border-b border-edge pb-3">
                      <span className={cn("text-3xl font-mono", ASSETS[asset].accent)}>
                        {ASSETS[asset].glyph}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        value={Number.isFinite(amount) ? amount : ""}
                        onChange={(e) => setAmount(Number(e.target.value) || 0)}
                        className="flex-1 bg-transparent outline-none font-mono text-4xl md:text-5xl text-foreground tabular tracking-tighter min-w-0"
                        placeholder="0"
                      />
                      <span className="font-mono text-sm text-muted-foreground uppercase tracking-[0.18em]">
                        {asset}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {(asset === "XLM" ? [10, 50, 100, 500] : [10, 50, 100, 500]).map(
                        (v) => (
                          <Chip key={v} active={amount === v} onClick={() => setAmount(v)}>
                            {v} {asset}
                          </Chip>
                        ),
                      )}
                      {balance > 0 && (
                        <Chip
                          active={amount === balance}
                          onClick={() => setAmount(balance)}
                        >
                          Max
                        </Chip>
                      )}
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Wallet:{" "}
                      <span className={amount > balance ? "text-destructive" : "text-foreground"}>
                        {formatAsset(balance, asset)} {asset}
                      </span>
                    </div>
                  </>
                )}

                {step === 2 && (
                  <>
                    <Label>For how long?</Label>
                    <div className="grid grid-cols-3 gap-3">
                      {DURATIONS.map((d) => (
                        <Tile
                          key={d.days}
                          active={durationDays === d.days && customDuration === ""}
                          onClick={() => {
                            setDurationDays(d.days);
                            setCustomDuration("");
                          }}
                        >
                          <div className="font-mono text-2xl text-foreground tabular">
                            {d.days}
                          </div>
                          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mt-1">
                            Days
                          </div>
                        </Tile>
                      ))}
                    </div>
                    <div>
                      <Label small>Or custom (days)</Label>
                      <input
                        type="number"
                        min={1}
                        value={customDuration}
                        onChange={(e) => {
                          setCustomDuration(e.target.value);
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0) setDurationDays(n);
                        }}
                        placeholder="e.g. 45"
                        className="mt-2 w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors"
                      />
                    </div>
                    <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      Unlocks on:{" "}
                      <span className="text-foreground">{formatUnlockDate(unlocksAt)}</span>
                    </div>
                  </>
                )}

                {step === 3 && (
                  <>
                    <Label>Choose your lock rule</Label>
                    <div className="grid grid-cols-1 gap-3">
                      <LockOption
                        active={lockType === "strict"}
                        onClick={() => setLockType("strict")}
                        icon="🔒"
                        title="Strict Lock"
                        description="No early withdrawal. Period. Funds are inaccessible until maturity."
                      />
                      <LockOption
                        active={lockType === "penalty"}
                        onClick={() => setLockType("penalty")}
                        icon="⚠️"
                        title="Penalty Lock"
                        description="Early withdrawal allowed, but you forfeit a percentage. Loss aversion keeps you honest."
                      />
                    </div>
                  </>
                )}

                {step === 4 && (
                  <>
                    <Label>
                      {lockType === "strict"
                        ? "No penalty needed"
                        : "How painful should breaking be?"}
                    </Label>
                    {lockType === "strict" ? (
                      <div className="bg-surface-deep border border-edge p-6 text-sm text-muted-foreground rounded-sm">
                        Strict locks have no penalty because withdrawal isn't possible.
                        Continue to confirm.
                      </div>
                    ) : (
                      <>
                        <div className="flex items-baseline justify-between flex-wrap gap-2">
                          <span className="font-mono text-5xl text-amber-core tabular">
                            {penaltyPercent}%
                          </span>
                          <span className="font-mono text-sm text-muted-foreground tabular">
                            = {formatAsset(penaltyAmount, asset)} {asset} forfeited
                          </span>
                        </div>
                        <input
                          type="range"
                          min={5}
                          max={50}
                          step={1}
                          value={penaltyPercent}
                          onChange={(e) => setPenaltyPercent(Number(e.target.value))}
                          className="w-full accent-amber-core"
                        />
                        <div className="flex justify-between font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          <span>5% (Mild)</span>
                          <span>25% (Painful)</span>
                          <span>50% (Brutal)</span>
                        </div>
                        <div className="bg-destructive/5 border border-destructive/30 p-4 text-sm text-destructive font-mono rounded-sm">
                          ⚠ Withdraw early → lose {formatAsset(penaltyAmount, asset)} {asset}
                        </div>
                      </>
                    )}
                  </>
                )}

                {step === 5 && (
                  <>
                    <Label>Name &amp; confirm</Label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={60}
                      placeholder="Vault name (e.g. Discipline Lock)"
                      className="w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors"
                    />
                    <input
                      value={goal}
                      onChange={(e) => setGoal(e.target.value)}
                      maxLength={60}
                      placeholder="Goal (optional)"
                      className="w-full bg-surface-deep border border-edge px-4 py-3 font-mono text-foreground rounded-sm outline-none focus:border-amber-core transition-colors"
                    />

                    <div className="bg-surface-deep border border-edge p-6 rounded-sm space-y-4 mt-2">
                      <Row
                        label="Asset"
                        value={`${ASSETS[asset].glyph} ${asset}`}
                      />
                      <Row
                        label="Amount"
                        value={`${formatAsset(amount, asset)} ${asset}`}
                        highlight
                      />
                      <Row label="Duration" value={`${durationDays} days`} />
                      <Row label="Unlocks" value={formatUnlockDate(unlocksAt)} />
                      <Row
                        label="Lock type"
                        value={lockType === "strict" ? "🔒 Strict" : "⚠️ Penalty"}
                      />
                      {lockType === "penalty" && (
                        <Row
                          label="Early exit cost"
                          value={`${formatAsset(penaltyAmount, asset)} ${asset} (${penaltyPercent}%)`}
                          danger
                        />
                      )}
                      {goal && <Row label="Goal" value={`🎯 ${goal}`} />}
                    </div>
                    <div className="bg-amber-core/5 border border-amber-core/30 p-4 text-sm text-amber-core font-mono rounded-sm">
                      ⚠ You won't access this {asset} until maturity
                      {lockType === "penalty" && " without paying the penalty"}.
                    </div>
                  </>
                )}

                {error && (
                  <div className="text-destructive font-mono text-xs uppercase tracking-[0.15em]">
                    {error}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="border-t border-edge bg-surface-sunken px-6 md:px-10 py-5 flex items-center justify-between">
            <button
              onClick={back}
              disabled={step === 0 || signing}
              className="font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                className="bg-surface-raised border border-edge hover:border-amber-core text-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-3 transition-all rounded-sm flex items-center gap-3"
              >
                Continue
                <span className="text-amber-core">→</span>
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={signing}
                className="bg-amber-core text-primary-foreground font-mono text-xs uppercase tracking-[0.18em] px-6 py-3 rounded-sm hover:shadow-amber-glow transition-shadow flex items-center gap-3 disabled:opacity-60"
              >
                {signing ? (
                  <>
                    <span className="animate-pulse">Awaiting signature…</span>
                  </>
                ) : (
                  <>
                    Sign &amp; Lock
                    <span>🔒</span>
                  </>
                )}
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
    <div
      className={cn(
        "font-mono uppercase tracking-[0.2em] text-muted-foreground",
        small ? "text-[10px]" : "text-[11px]",
      )}
    >
      {children}
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-3 py-2 font-mono text-xs uppercase tracking-[0.15em] border rounded-sm transition-colors",
        active
          ? "border-amber-core text-amber-core bg-amber-core/10"
          : "border-edge text-muted-foreground hover:text-foreground hover:border-edge-strong",
      )}
    >
      {children}
    </button>
  );
}

function Tile({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-5 border rounded-sm flex flex-col items-center justify-center transition-colors",
        active
          ? "border-amber-core bg-amber-core/5"
          : "border-edge bg-surface-deep hover:border-edge-strong",
      )}
    >
      {children}
    </button>
  );
}

function AssetTile({
  code,
  balance,
  active,
  onClick,
}: {
  code: AssetCode;
  balance: number;
  active: boolean;
  onClick: () => void;
}) {
  const meta = ASSETS[code];
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-4 border rounded-sm flex flex-col items-center gap-1 transition-colors",
        active
          ? "border-amber-core bg-amber-core/5"
          : "border-edge bg-surface-deep hover:border-edge-strong",
      )}
    >
      <div className={cn("text-2xl font-mono", meta.accent)}>{meta.glyph}</div>
      <div className="font-mono text-sm text-foreground tracking-[0.15em] uppercase">
        {code}
      </div>
      <div className="font-mono text-[10px] text-muted-foreground tabular mt-1">
        {formatAsset(balance, code)}
      </div>
    </button>
  );
}

function LockOption({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: string;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "text-left p-5 border rounded-sm flex gap-4 transition-colors",
        active
          ? "border-amber-core bg-amber-core/5"
          : "border-edge bg-surface-deep hover:border-edge-strong",
      )}
    >
      <div className="text-2xl">{icon}</div>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-1 leading-relaxed">
          {description}
        </div>
      </div>
    </button>
  );
}

function Row({
  label,
  value,
  highlight,
  danger,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono tabular text-sm text-right",
          highlight && "text-foreground text-base",
          danger && "text-destructive",
          !highlight && !danger && "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}
