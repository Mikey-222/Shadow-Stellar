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
  buildZkDepositUltraHonk, buildZkWithdrawUltraHonk,
  getZkEntry, getZkEntriesByDepositor, getNextEntryId,
  submitZkTx, fromStroops, toStroops, TOKEN_ADDRESS, toHex,
  deriveBlindingFactor,
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
  /** Proof system: "sha256" (Pedersen hash) or "ultrahonk" (zk-SNARK) */
  proofType: "sha256" | "ultrahonk";
}

export type ZkTxnType = "zk-deposit" | "zk-withdraw";

export interface ZkTransaction {
  id: string;
  entryId: string;
  token: AssetCode;
  type: ZkTxnType;
  amount: number;
  at: string;
}

interface ZkVaultState {
  vaults: ZkVault[];
  transactions: ZkTransaction[];
  loading: boolean;
  error: string | null;

  /** Fetch all ZK entries for the connected wallet */
  fetchVaults: () => Promise<void>;

  /** Create a ZK deposit — builds SHA-256 proof off-chain, submits on-chain */
  createZkVault: (input: {
    token: AssetCode;
    amount: number;
    name?: string;
  }) => Promise<ZkVault>;

  /** Create a ZK deposit using an UltraHonk zk-SNARK proof */
  createZkVaultUltraHonk: (input: {
    token: AssetCode;
    amount: number;
    commitment: string;
    proofBytes: string;
    publicInputs: string;
    name?: string;
  }) => Promise<ZkVault>;

  /** Withdraw a ZK vault entry using stored blinding factor */
  withdrawZkVault: (entryId: string) => Promise<void>;

  /** Withdraw a ZK vault entry using an UltraHonk proof */
  withdrawZkVaultUltraHonk: (entryId: string, proofBytes: string, publicInputs: string) => Promise<void>;

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
      transactions: [],
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
              proofType:   local?.proofType ?? "sha256",
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

        // 2. Derive blinding factor deterministically from wallet + entry_id.
        //    This prevents permanent fund loss on localStorage clear.
        const amountStroops = toStroops(amount);
        const blinding = await deriveBlindingFactor(address, entryId);
        const { proof } = await buildDepositProof(amountStroops, entryId, blinding);

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

        const now = new Date().toISOString();
        const vault: ZkVault = {
          id:         assignedId,
          token,
          amount,
          blinding,
          nullifier:  proof.nullifier,
          commitment: proof.commitment,
          withdrawn:  false,
          name,
          depositedAt: now,
          proofType: "sha256",
        };

        const txn: ZkTransaction = {
          id: `zkt_${crypto.randomUUID()}`,
          entryId: assignedId,
          token,
          type: "zk-deposit",
          amount: -amount,
          at: now,
        };

        // Optimistically debit balance
        walletStore.adjustBalance(token, -amount);
        set({ vaults: [vault, ...get().vaults], transactions: [txn, ...get().transactions] });

        // Refresh from chain after a short delay
        setTimeout(() => get().fetchVaults(), 4000);

        return vault;
      },

      createZkVaultUltraHonk: async ({ token, amount, commitment, proofBytes, publicInputs, name }) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        const amountStroops = toStroops(amount);
        const txXdr = await buildZkDepositUltraHonk(address, token, {
          commitment,
          proof_bytes: proofBytes,
          public_inputs: publicInputs,
          amount: amountStroops,
        });

        const signedXdr = await walletStore.signTransaction(txXdr);
        const result = await submitZkTx(signedXdr);

        let assignedId = "0";
        if (result.status === "SUCCESS" && result.returnValue) {
          const mod = await import("@stellar/stellar-sdk");
          const s: any = (mod as any).default ?? mod;
          assignedId = String(s.scValToNative(result.returnValue) as bigint);
        }

        const now = new Date().toISOString();
        const vault: ZkVault = {
          id: assignedId,
          token,
          amount,
          blinding: "",
          nullifier: "",
          commitment,
          withdrawn: false,
          name,
          depositedAt: now,
          proofType: "ultrahonk",
        };

        const txn: ZkTransaction = {
          id: `zkt_${crypto.randomUUID()}`,
          entryId: assignedId,
          token,
          type: "zk-deposit",
          amount: -amount,
          at: now,
        };

        walletStore.adjustBalance(token, -amount);
        set({ vaults: [vault, ...get().vaults], transactions: [txn, ...get().transactions] });
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

        const now = new Date().toISOString();

        const txn: ZkTransaction = {
          id: `zkt_${crypto.randomUUID()}`,
          entryId,
          token: vault.token,
          type: "zk-withdraw",
          amount: vault.amount,
          at: now,
        };

        walletStore.adjustBalance(vault.token, vault.amount);

        set({
          vaults: get().vaults.map(v =>
            v.id === entryId ? { ...v, withdrawn: true } : v,
          ),
          transactions: [txn, ...get().transactions],
        });

        setTimeout(() => get().fetchVaults(), 3000);
      },

      withdrawZkVaultUltraHonk: async (entryId, proofBytes, publicInputs) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        const vault = get().vaults.find(v => v.id === entryId);
        if (!vault) throw new Error("ZK vault entry not found");
        if (vault.withdrawn) throw new Error("Already withdrawn");

        const amountStroops = toStroops(vault.amount);
        const txXdr = await buildZkWithdrawUltraHonk(
          address,
          BigInt(entryId),
          vault.token,
          {
            proof_bytes: proofBytes,
            public_inputs: publicInputs,
            amount: amountStroops,
            nullifier: vault.nullifier || "00".repeat(32),
          },
        );

        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitZkTx(signedXdr);

        const now = new Date().toISOString();
        const txn: ZkTransaction = {
          id: `zkt_${crypto.randomUUID()}`,
          entryId,
          token: vault.token,
          type: "zk-withdraw",
          amount: vault.amount,
          at: now,
        };

        walletStore.adjustBalance(vault.token, vault.amount);
        set({
          vaults: get().vaults.map(v =>
            v.id === entryId ? { ...v, withdrawn: true } : v,
          ),
          transactions: [txn, ...get().transactions],
        });
        setTimeout(() => get().fetchVaults(), 3000);
      },

      reset: () => set({ vaults: [], transactions: [], loading: false, error: null }),
    }),
    {
      name: "zk-vault-store-v1",
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        const { vaults, transactions } = state;
        // Migration: generate transactions for vaults that don't have them
        if (vaults.length > 0 && (!transactions || transactions.length === 0)) {
          const generated: ZkTransaction[] = vaults.flatMap((v) => {
            const deposit: ZkTransaction = {
              id: `zkt_${crypto.randomUUID()}`,
              entryId: v.id,
              token: v.token,
              type: "zk-deposit",
              amount: -v.amount,
              at: v.depositedAt,
            };
            const withdraw: ZkTransaction | null = v.withdrawn
              ? {
                  id: `zkt_${crypto.randomUUID()}`,
                  entryId: v.id,
                  token: v.token,
                  type: "zk-withdraw",
                  amount: v.amount,
                  at: new Date().toISOString(),
                }
              : null;
            return withdraw ? [deposit, withdraw] : [deposit];
          });
          useZkVaultStore.setState({ transactions: generated });
        }
      },
    },
  ),
);
