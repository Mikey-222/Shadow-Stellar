import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssetCode } from "@/lib/assets";
import { useWalletStore } from "@/store/wallet";
import {
  buildCreateVault,
  buildWithdraw,
  getVault,
  getVaultsByOwner,
  fromStroops,
  bpsToPercent,
  submitTx,
  TOKEN_ADDRESS,
} from "@/lib/contract";

// ─── Frontend types ───────────────────────────────────────────────────────────

export type LockType = "strict" | "penalty";
export type VaultStatus = "active" | "withdrawn" | "matured";

export interface Vault {
  /** On-chain vault_id (u64 stored as string to avoid BigInt serialisation issues) */
  id: string;
  name: string;
  goal?: string;
  asset: AssetCode;
  /** Human-readable amount */
  amount: number;
  lockType: LockType;
  /** 0-100 percent (converted from on-chain basis points) */
  penaltyPercent: number;
  createdAt: string;   // ISO string derived from on-chain start_time
  unlocksAt: string;   // ISO string derived from on-chain unlock_time
  status: VaultStatus;
  withdrawnAt?: string;
  penaltyPaid?: number;
}

export type TxnType = "create" | "withdraw" | "early-withdraw" | "mature";

export interface Transaction {
  id: string;
  vaultId: string;
  vaultName: string;
  asset: AssetCode;
  type: TxnType;
  amount: number;
  penalty?: number;
  at: string;
}

interface VaultState {
  vaults: Vault[];
  transactions: Transaction[];
  loading: boolean;
  error: string | null;

  /** Fetch all vaults for the connected wallet from the contract */
  fetchVaults: () => Promise<void>;

  /** Build, sign, and submit a create_vault transaction */
  createVault: (input: {
    name: string;
    goal?: string;
    asset: AssetCode;
    amount: number;
    durationDays: number;
    lockType: LockType;
    penaltyPercent: number;
  }) => Promise<Vault>;

  /** Build, sign, and submit a withdraw transaction */
  withdraw: (vaultId: string, opts: { early: boolean }) => Promise<void>;

  reset: () => void;
}

// ─── Token address → AssetCode reverse map ───────────────────────────────────

const TOKEN_TO_ASSET: Record<string, AssetCode> = Object.fromEntries(
  Object.entries(TOKEN_ADDRESS).map(([code, addr]) => [addr, code as AssetCode]),
);

function tokenToAsset(tokenAddr: string): AssetCode {
  return TOKEN_TO_ASSET[tokenAddr] ?? "XLM";
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useVaultStore = create<VaultState>()(
  persist(
    (set, get) => ({
      vaults: [],
      transactions: [],
      loading: false,
      error: null,

      fetchVaults: async () => {
        const address = useWalletStore.getState().address;
        if (!address) return;

        set({ loading: true, error: null });
        try {
          const ids = await getVaultsByOwner(address);
          const vaults: Vault[] = [];

          for (const id of ids) {
            const onChain = await getVault(id);
            if (!onChain) continue;

            const asset = tokenToAsset(onChain.token);
            const amount = fromStroops(onChain.amount);
            const lockType: LockType =
              "Strict" in onChain.lock_type ? "strict" : "penalty";
            const penaltyPercent = bpsToPercent(onChain.penalty_rate);
            const isWithdrawn = "Withdrawn" in onChain.state;
            const startMs = Number(onChain.start_time) * 1000;
            const unlockMs = Number(onChain.unlock_time) * 1000;
            const now = Date.now();
            const status: VaultStatus = isWithdrawn
              ? "withdrawn"
              : now >= unlockMs
                ? "matured"
                : "active";

            vaults.push({
              id: String(id),
              name: `Vault #${id}`,
              asset,
              amount,
              lockType,
              penaltyPercent,
              createdAt: new Date(startMs).toISOString(),
              unlocksAt: new Date(unlockMs).toISOString(),
              status,
            });
          }

          // Preserve user-set names/goals from local state
          const existing = get().vaults;
          const merged = vaults.map((v) => {
            const local = existing.find((e) => e.id === v.id);
            return local
              ? { ...v, name: local.name, goal: local.goal, withdrawnAt: local.withdrawnAt, penaltyPaid: local.penaltyPaid }
              : v;
          });

          set({ vaults: merged, loading: false });
        } catch (e) {
          set({ loading: false, error: String(e) });
        }
      },

      createVault: async ({ name, goal, asset, amount, durationDays, lockType, penaltyPercent }) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        const unlockTime = Math.floor(Date.now() / 1000) + durationDays * 86_400;

        // Build the transaction
        const txXdr = await buildCreateVault(
          address,
          asset,
          amount,
          unlockTime,
          lockType,
          penaltyPercent,
        );

        // Sign via wallet
        const signedXdr = await walletStore.signTransaction(txXdr);

        // Submit and wait for confirmation
        const result = await submitTx(signedXdr);

        // Extract vault_id from the return value
        let vaultId = "0";
        if (result.status === "SUCCESS" && result.returnValue) {
          const mod = await import("@stellar/stellar-sdk");
          const s: any = (mod as any).default ?? mod;
          vaultId = String(s.scValToNative(result.returnValue) as bigint);
        }

        const now = new Date();
        const unlocksAt = new Date(unlockTime * 1000);

        const vault: Vault = {
          id: vaultId,
          name: name || goal || `${asset} Vault`,
          goal,
          asset,
          amount,
          lockType,
          penaltyPercent: lockType === "strict" ? 0 : penaltyPercent,
          createdAt: now.toISOString(),
          unlocksAt: unlocksAt.toISOString(),
          status: "active",
        };

        const txn: Transaction = {
          id: `t_${crypto.randomUUID()}`,
          vaultId,
          vaultName: vault.name,
          asset,
          type: "create",
          amount: -amount,
          at: now.toISOString(),
        };

        // Optimistically debit wallet balance
        walletStore.adjustBalance(asset, -amount);

        set({
          vaults: [vault, ...get().vaults],
          transactions: [txn, ...get().transactions],
        });

        // Refresh from chain to get accurate state
        setTimeout(() => get().fetchVaults(), 3000);

        return vault;
      },

      withdraw: async (vaultId, { early }) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        const vault = get().vaults.find((v) => v.id === vaultId);
        if (!vault || vault.status === "withdrawn") return;

        // Build the transaction
        const txXdr = await buildWithdraw(address, BigInt(vaultId));

        // Sign via wallet
        const signedXdr = await walletStore.signTransaction(txXdr);

        // Submit
        await submitTx(signedXdr);

        const now = new Date();
        const penalty = early
          ? Number(((vault.amount * vault.penaltyPercent) / 100).toFixed(7))
          : 0;
        const received = Number((vault.amount - penalty).toFixed(7));

        const txn: Transaction = {
          id: `t_${crypto.randomUUID()}`,
          vaultId,
          vaultName: vault.name,
          asset: vault.asset,
          type: early ? "early-withdraw" : "withdraw",
          amount: received,
          penalty: penalty || undefined,
          at: now.toISOString(),
        };

        // Optimistically credit wallet
        walletStore.adjustBalance(vault.asset, received);

        set({
          vaults: get().vaults.map((v) =>
            v.id === vaultId
              ? { ...v, status: "withdrawn", withdrawnAt: now.toISOString(), penaltyPaid: penalty }
              : v,
          ),
          transactions: [txn, ...get().transactions],
        });

        // Refresh from chain
        setTimeout(() => get().fetchVaults(), 3000);
      },

      reset: () => set({ vaults: [], transactions: [], loading: false, error: null }),
    }),
    { name: "vault-store-v3" },
  ),
);

// ─── Aggregate locked totals per asset across active vaults ──────────────────

export function useLockedByAsset() {
  const vaults = useVaultStore((s) => s.vaults);
  const active = vaults.filter((v) => v.status === "active" || v.status === "matured");
  const locked: Record<AssetCode, number> = { XLM: 0, USDC: 0, EURC: 0 };
  for (const v of active) locked[v.asset] = (locked[v.asset] ?? 0) + v.amount;
  const nextUnlock = active
    .filter((v) => v.status === "active")
    .map((v) => new Date(v.unlocksAt))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  return { active, locked, nextUnlock };
}
