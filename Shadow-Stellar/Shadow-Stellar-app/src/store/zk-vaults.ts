/**
 * ZK Vault Store — Shadow-Stellar
 *
 * Manages entries in the ZK Commitment Protocol contract.
 * Each entry is a private vault backed by a Pedersen commitment.
 *
 * The blinding factor (secret) is stored in localStorage so users
 * can withdraw from the same browser. In production this should be
 * backed up by the user or derived from a deterministic secret.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssetCode } from "@/lib/assets";
import { useWalletStore } from "@/store/wallet";
import {
  buildDepositProof, buildWithdrawProof,
  buildZkDeposit, buildZkWithdraw,
  getZkEntry, getZkEntriesByDepositor, getNextEntryId,
  submitZkTx, fromStroops, toStroops, TOKEN_ADDRESS, toHex,
  type ZkEntryOnChain,
} from "@/lib/zk-contract";

// ─── Frontend types ───────────────────────────────────────────────────────────

export interface ZkVault {
  /** On-chain entry_id */
  id: string;
  /** Asset used */
  token: AssetCode;
  /** Committed amount (revealed by the user's blinding factor) */
  amount: number;
  /** The blinding factor hex — needed for withdrawal */
  blinding: string;
  /** The nullifier hex — proof of ownership */
  nullifier: string;
  /** The commitment hash stored on-chain */
  commitment: string;
  /** Whether the entry has been withdrawn on-chain */
  withdrawn: boolean;
  /** User-defined label */
  name?: string;
  /** ISO timestamp of deposit */
  depositedAt: string;
}

interface ZkVaultState {
  vaults: ZkVault[];
  loading: boolean;
  error: string | null;

  /** Fetch all ZK entries for the connected wallet */
  fetchVaults: () => Promise<void>;

  /** Create a ZK deposit — builds proof off-chain, submits on-chain */
  createZkVault: (input: {
    token: AssetCode;
    amount: number;
    name?: string;
  }) => Promise<ZkVault>;

  /** Withdraw a ZK vault entry using stored blinding factor */
  withdrawZkVault: (entryId: string) => Promise<void>;

  reset: () => void;
}

// ─── Token address → AssetCode ────────────────────────────────────────────────

const TOKEN_TO_ASSET: Record<string, AssetCode> = Object.fromEntries(
  Object.entries(TOKEN_ADDRESS).map(([code, addr]) => [addr, code as AssetCode]),
);
function tokenToAsset(addr: string): AssetCode { return TOKEN_TO_ASSET[addr] ?? "XLM"; }

// ─── Store ────────────────────────────────────────────────────────────────────

export const useZkVaultStore = create<ZkVaultState>()(
  persist(
    (set, get) => ({
      vaults: [],
      loading: false,
      error: null,

      fetchVaults: async () => {
        const address = useWalletStore.getState().address;
        if (!address) return;
        set({ loading: true, error: null });
        try {
          const ids = await getZkEntriesByDepositor(address);
          const existing = get().vaults;
          const updated: ZkVault[] = [];

          for (const id of ids) {
            const onChain = await getZkEntry(id);
            if (!onChain) continue;
            const idStr = String(id);
            const local = existing.find(v => v.id === idStr);
            updated.push({
              id: idStr,
              token: local?.token ?? "XLM",
              amount: fromStroops(onChain.amount),
              blinding:    local?.blinding    ?? "",
              nullifier:   local?.nullifier   ?? toHex(onChain.nullifier instanceof Uint8Array ? onChain.nullifier : new Uint8Array(Object.values(onChain.nullifier as any))),
              commitment:  toHex(onChain.commitment instanceof Uint8Array ? onChain.commitment : new Uint8Array(Object.values(onChain.commitment as any))),
              withdrawn:   onChain.withdrawn,
              name:        local?.name,
              depositedAt: local?.depositedAt ?? new Date().toISOString(),
            });
          }

          // Preserve local entries not returned by chain (edge case)
          const merged = [...updated];
          for (const v of existing) {
            if (!merged.find(m => m.id === v.id)) merged.push(v);
          }

          set({ vaults: merged, loading: false });
        } catch (e) {
          set({ loading: false, error: String(e) });
        }
      },

      createZkVault: async ({ token, amount, name }) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        // 1. Get the next entry_id for correct nullifier domain
        const entryId = await getNextEntryId();

        // 2. Build the ZK proof off-chain using Web Crypto
        const amountStroops = toStroops(amount);
        const { proof, blinding } = await buildDepositProof(amountStroops, entryId);

        // 3. Build the transaction
        const txXdr = await buildZkDeposit(address, token, proof);

        // 4. Sign via wallet
        const signedXdr = await walletStore.signTransaction(txXdr);

        // 5. Submit and wait for confirmation
        const result = await submitZkTx(signedXdr);

        // 6. Extract assigned entry_id from return value
        let assignedId = String(entryId);
        if (result.status === "SUCCESS" && result.returnValue) {
          const mod = await import("@stellar/stellar-sdk");
          const s: any = (mod as any).default ?? mod;
          assignedId = String(s.scValToNative(result.returnValue) as bigint);
        }

        const vault: ZkVault = {
          id:         assignedId,
          token,
          amount,
          blinding,
          nullifier:  proof.nullifier,
          commitment: proof.commitment,
          withdrawn:  false,
          name,
          depositedAt: new Date().toISOString(),
        };

        // Optimistically debit balance
        walletStore.adjustBalance(token, -amount);
        set({ vaults: [vault, ...get().vaults] });

        // Refresh from chain after a short delay
        setTimeout(() => get().fetchVaults(), 4000);

        return vault;
      },

      withdrawZkVault: async (entryId) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        const vault = get().vaults.find(v => v.id === entryId);
        if (!vault) throw new Error("ZK vault entry not found");
        if (vault.withdrawn) throw new Error("Already withdrawn");
        if (!vault.blinding) throw new Error("Blinding factor not found — cannot withdraw");

        const amountStroops = toStroops(vault.amount);
        const proof = buildWithdrawProof(amountStroops, vault.nullifier, vault.blinding);

        const txXdr = await buildZkWithdraw(
          address,
          BigInt(entryId),
          vault.token,
          proof,
        );

        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitZkTx(signedXdr);

        // Optimistically credit balance
        walletStore.adjustBalance(vault.token, vault.amount);

        set({
          vaults: get().vaults.map(v =>
            v.id === entryId ? { ...v, withdrawn: true } : v,
          ),
        });

        setTimeout(() => get().fetchVaults(), 3000);
      },

      reset: () => set({ vaults: [], loading: false, error: null }),
    }),
    { name: "zk-vault-store-v1" },
  ),
);
