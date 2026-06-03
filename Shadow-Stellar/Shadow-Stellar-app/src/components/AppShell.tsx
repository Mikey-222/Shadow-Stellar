import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useWalletStore } from "@/store/wallet";
import { useLockedByAsset, useVaultStore } from "@/store/vaults";
import { useGroupVaultStore } from "@/store/group-vaults";
import { ASSET_CODES, ASSETS, formatAsset, shortAddr } from "@/lib/assets";
import { MachinedCard } from "@/components/MachinedCard";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/vaults", label: "Solo Vaults" },
  { to: "/group", label: "Group Vaults" },
  { to: "/zk", label: "ZK Vaults" },
  { to: "/create", label: "Create" },
  { to: "/history", label: "History" },
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const connected = useWalletStore((s) => s.connected);

  if (!connected) {
    return <ConnectGate />;
  }
  return <ConnectedShell>{children}</ConnectedShell>;
}

function ConnectedShell({ children }: { children: React.ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const address = useWalletStore((s) => s.address);
  const balances = useWalletStore((s) => s.balances);
  const disconnect = useWalletStore((s) => s.disconnect);
  const fetchVaults = useVaultStore((s) => s.fetchVaults);
  const fetchGroupVaults = useGroupVaultStore((s) => s.fetchVaults);
  const { locked } = useLockedByAsset();
  const [menu, setMenu] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch on-chain vaults whenever the connected address changes
  useEffect(() => {
    if (address) {
      fetchVaults();
      fetchGroupVaults();
    }
  }, [address]);

  const copyAddress = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-dvh flex flex-col text-foreground">
      <header className="border-b border-edge bg-surface-base/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="size-4 bg-foreground rounded-sm shadow-amber-glow group-hover:bg-amber-core transition-colors" />
            <span className="font-mono text-sm tracking-[0.2em] uppercase font-medium">
              Shadow<span className="text-amber-core">-</span>Stellar <span className="text-muted-foreground">// ZK</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-7 font-mono text-[11px] uppercase tracking-[0.18em]">
            {NAV.map((n) => {
              const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
              return (
                <Link
                  key={n.to}
                  to={n.to}
                  className={
                    active
                      ? "text-foreground border-b border-amber-core pb-1"
                      : "text-muted-foreground hover:text-foreground transition-colors pb-1"
                  }
                >
                  {n.label}
                </Link>
              );
            })}
          </nav>

          <div className="relative">
            <button
              onClick={() => setMenu((m) => !m)}
              className="flex items-center gap-3 border border-edge bg-surface-deep hover:border-amber-core px-3 py-2 rounded-sm transition-colors"
            >
              <span className="size-1.5 rounded-full bg-success shadow-amber-glow animate-pulse-slow" />
              <span className="font-mono text-[11px] tracking-[0.15em] text-foreground tabular">
                {shortAddr(address ?? "")}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground">▾</span>
            </button>

            <AnimatePresence>
              {menu && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute right-0 mt-2 w-72 bg-surface-base border border-edge rounded-sm shadow-vault z-40 overflow-hidden"
                  >
                    <div className="p-4 border-b border-edge">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1">
                        Wallet
                      </div>
                      <div className="flex items-start justify-between gap-2 mt-1">
                        <div className="font-mono text-xs text-foreground break-all leading-relaxed">
                          {address}
                        </div>
                        <button
                          onClick={copyAddress}
                          title={copied ? "Copied!" : "Copy address"}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
                        >
                          {copied ? (
                            <span className="text-success text-xs">✓</span>
                          ) : (
                            <span className="text-xs">⎘</span>
                          )}
                        </button>
                      </div>
                      <a
                        href={`https://stellar.expert/explorer/testnet/account/${address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-mono text-[10px] uppercase tracking-[0.15em] text-amber-core hover:underline mt-2 inline-block"
                      >
                        View on Stellar Expert →
                      </a>
                    </div>
                    <div className="p-4 border-b border-edge space-y-2">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        Balances
                      </div>
                      {ASSET_CODES.map((code) => (
                        <div key={code} className="flex justify-between font-mono text-xs">
                          <span className={ASSETS[code].accent}>
                            {ASSETS[code].glyph} {code}
                          </span>
                          <span className="text-foreground tabular">
                            {formatAsset(balances[code] ?? 0, code)}
                          </span>
                        </div>
                      ))}
                    </div>
                    {Object.values(locked).some((v) => v > 0) && (
                      <div className="p-4 border-b border-edge space-y-2">
                        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Locked
                        </div>
                        {ASSET_CODES.filter((c) => (locked[c] ?? 0) > 0).map((code) => (
                          <div key={code} className="flex justify-between font-mono text-xs">
                            <span className={ASSETS[code].accent}>
                              {ASSETS[code].glyph} {code}
                            </span>
                            <span className="text-amber-core tabular">
                              {formatAsset(locked[code], code)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      onClick={() => {
                        disconnect();
                        setMenu(false);
                      }}
                      className="w-full text-left p-4 font-mono text-[11px] uppercase tracking-[0.18em] text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      Disconnect Wallet
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Mobile nav */}
        <nav className="md:hidden border-t border-edge px-6 py-3 flex items-center gap-5 font-mono text-[10px] uppercase tracking-[0.18em] overflow-x-auto">
          {NAV.map((n) => {
            const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
            return (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "shrink-0",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-6 py-10">{children}</main>

      <footer className="border-t border-edge bg-surface-base/40">
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          <span>Shadow-Stellar · Soroban · ZK</span>
          <span className="flex items-center gap-2">
            <span className="size-1.5 rounded-full bg-amber-core shadow-amber-glow animate-pulse-slow" />
            ZK Protocol Active
          </span>
        </div>
      </footer>
    </div>
  );
}

function ConnectGate() {
  const connect = useWalletStore((s) => s.connect);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handle = async () => {
    setPending(true);
    setError(null);
    try {
      await connect();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col text-foreground">
      <header className="border-b border-edge bg-surface-base/80 backdrop-blur-xl">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="size-4 bg-foreground rounded-sm shadow-amber-glow" />
            <span className="font-mono text-sm tracking-[0.2em] uppercase font-medium">
              Shadow<span className="text-amber-core">-</span>Stellar <span className="text-muted-foreground">// ZK</span>
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Wallet Required
          </span>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <MachinedCard>
            <div className="p-8 md:p-10 flex flex-col gap-8">
              {/* Header */}
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="size-16 border border-edge bg-surface-deep rounded-sm flex items-center justify-center text-3xl shadow-amber-glow">
                  🔐
                </div>
                <h1 className="text-2xl font-medium tracking-tight mt-2">
                  Connect your wallet
                </h1>
                <p className="text-sm text-muted-foreground leading-relaxed max-w-xs">
                  Shadow-Stellar: private vaults on Stellar. Lock solo, commit as a group, or deposit with zero-knowledge proofs.
                </p>
              </div>

              {/* Single connect button — opens Stellar Wallets Kit modal */}
              <button
                onClick={handle}
                disabled={pending}
                className={cn(
                  "w-full flex items-center justify-center gap-3 p-4 border rounded-sm font-mono text-sm uppercase tracking-[0.18em] transition-all",
                  "bg-amber-core text-primary-foreground hover:shadow-amber-glow",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
              >
                {pending ? (
                  <>
                    <span className="size-4 rounded-full border-2 border-primary-foreground border-r-transparent animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    🔐 Connect Wallet
                  </>
                )}
              </button>

              {/* Error */}
              {error && (
                <div className="bg-destructive/5 border border-destructive/30 p-3 rounded-sm font-mono text-xs text-destructive">
                  {error}
                </div>
              )}

              {/* Supported wallets grid */}
              <div className="bg-surface-deep border border-edge p-4 rounded-sm">
                <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-3">
                  Supported wallets
                </div>
                <div className="grid grid-cols-3 gap-y-2 gap-x-4 font-mono text-[11px] text-muted-foreground">
                  {["Freighter", "xBull", "Albedo", "Rabet", "Lobstr", "Hana"].map((w) => (
                    <span key={w} className="flex items-center gap-1">
                      <span className="text-amber-core">✓</span> {w}
                    </span>
                  ))}
                </div>
                <p className="font-mono text-[10px] text-muted-foreground mt-3">
                  Click "Connect Wallet" to choose your preferred wallet.
                </p>
              </div>

              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground text-center pt-2 border-t border-edge">
                Testnet · XLM · USDC · EURC · ZK
              </div>
            </div>
          </MachinedCard>
        </motion.div>
      </main>

      <footer className="border-t border-edge bg-surface-base/40">
        <div className="max-w-6xl mx-auto px-6 py-5 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
          Shadow-Stellar · Soroban · ZK
        </div>
      </footer>
    </div>
  );
}
