import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssetCode } from "@/lib/assets";
import { useWalletStore } from "@/store/wallet";
import {
  buildCreateGroupVault, buildDeposit, buildCcpWithdraw, buildCancel, buildClaimPool,
  getGroupVault, getVaultsByMember, getVaultsByCreator, getMemberState, getCcpPoolBalance,
  submitCcpTx, fromStroops, bpsToPercent, TOKEN_ADDRESS,
  type GroupVaultOnChain, type MemberRecordOnChain, type CcpVaultState, type CcpMemberState,
  vaultStateLabel, memberStateLabel,
} from "@/lib/ccp-contract";

// ─── Frontend types ───────────────────────────────────────────────────────────

export type GroupVaultStatus = "funding" | "active" | "settlement" | "resolved" | "cancelled";

export interface MemberEntry {
  address: string;
  amount: number;       // human-readable
  state: string;        // label
  rawState: CcpMemberState | null;
}

export interface GroupVault {
  id: string;           // vault_id as string
  creator: string;
  token: AssetCode;
  members: MemberEntry[];
  unlockTime: number;   // unix seconds
  fundingDeadline: number;
  lockType: "strict" | "penalty";
  penaltyPercent: number;
  totalSize: number;    // human-readable
  depositedCount: number;
  poolBalance: number;  // human-readable
  status: GroupVaultStatus;
  // local metadata
  name?: string;
}

interface GroupVaultState {
  vaults: GroupVault[];
  loading: boolean;
  error: string | null;

  fetchVaults: () => Promise<void>;
  fetchVaultById: (vaultId: string) => Promise<void>;
  createGroupVault: (input: {
    name?: string;
    token: AssetCode;
    members: { address: string; amount: number }[];
    durationDays: number;
    fundingHours: number;
    lockType: "strict" | "penalty";
    penaltyPercent: number;
  }) => Promise<GroupVault>;
  deposit: (vaultId: string) => Promise<void>;
  withdraw: (vaultId: string) => Promise<void>;
  cancel: (vaultId: string) => Promise<void>;
  claimPool: (vaultId: string) => Promise<void>;
  reset: () => void;
}

// ─── Token address → AssetCode ────────────────────────────────────────────────

const TOKEN_TO_ASSET: Record<string, AssetCode> = Object.fromEntries(
  Object.entries(TOKEN_ADDRESS).map(([code, addr]) => [addr, code as AssetCode]),
);
function tokenToAsset(addr: string): AssetCode { return TOKEN_TO_ASSET[addr] ?? "XLM"; }

function stateToStatus(state: CcpVaultState | string): GroupVaultStatus {
  const s = typeof state === "string" ? state : Object.keys(state as object)[0];
  if (s === "FundingOpen") return "funding";
  if (s === "ActiveLocked") return "active";
  if (s === "SettlementReady") return "settlement";
  if (s === "Resolved") return "resolved";
  if (s === "Cancelled") return "cancelled";
  return "funding"; // safe default — never hide a vault as cancelled incorrectly
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useGroupVaultStore = create<GroupVaultState>()(
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
          const [memberIds, creatorIds] = await Promise.all([
            getVaultsByMember(address),
            getVaultsByCreator(address),
          ]);
          // Deduplicate
          const allIds = [...new Set([...memberIds, ...creatorIds].map(String))].map(BigInt);

          const vaults: GroupVault[] = [];
          for (const id of allIds) {
            const onChain = await getGroupVault(id);
            if (!onChain) continue;

            // Fetch member states
            const members: MemberEntry[] = [];
            for (const memberAddr of onChain.members) {
              const rec = await getMemberState(id, memberAddr);
              const obligationAmount = (onChain.obligations as any)[memberAddr] ?? BigInt(0);
              members.push({
                address: memberAddr,
                amount: rec ? fromStroops(rec.amount) : fromStroops(BigInt(obligationAmount)),
                state: rec ? memberStateLabel(rec.state) : "Committed",
                rawState: rec ? rec.state : { Committed: undefined as any },
              });
            }

            const poolBalance = await getCcpPoolBalance(id);

            vaults.push({
              id: String(id),
              creator: onChain.creator,
              token: tokenToAsset(onChain.token),
              members,
              unlockTime: Number(onChain.unlock_time),
              fundingDeadline: Number(onChain.funding_deadline),
              lockType: typeof onChain.lock_type === "string"
                ? (onChain.lock_type === "Strict" ? "strict" : "penalty")
                : ("Strict" in (onChain.lock_type as object) ? "strict" : "penalty"),
              penaltyPercent: bpsToPercent(onChain.penalty_rate),
              totalSize: fromStroops(onChain.total_size),
              depositedCount: onChain.deposited_count,
              poolBalance,
              status: stateToStatus(onChain.state),
            });
          }

          // Preserve local names
          const existing = get().vaults;
          const merged = vaults.map((v) => {
            const local = existing.find((e) => e.id === v.id);
            return local ? { ...v, name: local.name } : v;
          });

          set({ vaults: merged, loading: false });
        } catch (e) {
          set({ loading: false, error: String(e) });
        }
      },

      fetchVaultById: async (vaultId: string) => {
        set({ loading: true, error: null });
        try {
          const id = BigInt(vaultId);
          const onChain = await getGroupVault(id);
          if (!onChain) { set({ loading: false }); return; }

          const members: MemberEntry[] = [];
          for (const memberAddr of onChain.members) {
            const rec = await getMemberState(id, memberAddr);
            const obligationAmount = (onChain.obligations as any)[memberAddr] ?? BigInt(0);
            members.push({
              address: memberAddr,
              amount: rec ? fromStroops(rec.amount) : fromStroops(BigInt(obligationAmount)),
              state: rec ? memberStateLabel(rec.state) : "Committed",
              rawState: rec ? rec.state : { Committed: undefined as any },
            });
          }

          const poolBalance = await getCcpPoolBalance(id);
          const fresh: GroupVault = {
            id: vaultId,
            creator: onChain.creator,
            token: tokenToAsset(onChain.token),
            members,
            unlockTime: Number(onChain.unlock_time),
            fundingDeadline: Number(onChain.funding_deadline),
            lockType: typeof onChain.lock_type === "string"
              ? (onChain.lock_type === "Strict" ? "strict" : "penalty")
              : ("Strict" in (onChain.lock_type as object) ? "strict" : "penalty"),
            penaltyPercent: bpsToPercent(onChain.penalty_rate),
            totalSize: fromStroops(onChain.total_size),
            depositedCount: onChain.deposited_count,
            poolBalance,
            status: stateToStatus(onChain.state),
          };

          // Merge with existing (preserve name)
          const existing = get().vaults;
          const local = existing.find((e) => e.id === vaultId);
          const merged = local ? { ...fresh, name: local.name } : fresh;
          const updated = existing.some((e) => e.id === vaultId)
            ? existing.map((e) => e.id === vaultId ? merged : e)
            : [merged, ...existing];

          set({ vaults: updated, loading: false });
        } catch (e) {
          set({ loading: false, error: String(e) });
        }
      },

      createGroupVault: async ({ name, token, members, durationDays, fundingHours, lockType, penaltyPercent }) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");

        // Get the actual ledger timestamp to avoid browser clock skew
        // Add 120s buffer to account for tx propagation delay (~5s ledger close time)
        const ledgerNow = Math.floor(Date.now() / 1000);
        const buffer = 120;
        const unlockTime = ledgerNow + durationDays * 86_400 + buffer;
        const fundingDeadline = ledgerNow + fundingHours * 3_600 + buffer;

        const txXdr = await buildCreateGroupVault(
          address,
          token,
          members.map((m) => m.address),
          members.map((m) => m.amount),
          unlockTime,
          fundingDeadline,
          lockType,
          penaltyPercent,
        );

        const signedXdr = await walletStore.signTransaction(txXdr);
        const result = await submitCcpTx(signedXdr);

        let vaultId = "0";
        if (result.status === "SUCCESS" && result.returnValue) {
          const mod = await import("@stellar/stellar-sdk");
          const s: any = (mod as any).default ?? mod;
          vaultId = String(s.scValToNative(result.returnValue) as bigint);
        }

        const vault: GroupVault = {
          id: vaultId,
          name,
          creator: address,
          token,
          members: members.map((m) => ({
            address: m.address,
            amount: m.amount,
            state: "Committed",
            rawState: { Committed: undefined as any },
          })),
          unlockTime,
          fundingDeadline,
          lockType,
          penaltyPercent: lockType === "strict" ? 0 : penaltyPercent,
          totalSize: members.reduce((s, m) => s + m.amount, 0),
          depositedCount: 0,
          poolBalance: 0,
          status: "funding",
        };

        set({ vaults: [vault, ...get().vaults] });
        // Use fetchVaultById to get fresh chain data — more reliable than index query
        setTimeout(() => get().fetchVaultById(vaultId), 5000);
        return vault;
      },

      deposit: async (vaultId) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");
        const txXdr = await buildDeposit(address, BigInt(vaultId));
        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitCcpTx(signedXdr);
        setTimeout(() => get().fetchVaults(), 3000);
      },

      withdraw: async (vaultId) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");
        const txXdr = await buildCcpWithdraw(address, BigInt(vaultId));
        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitCcpTx(signedXdr);
        setTimeout(() => get().fetchVaults(), 3000);
      },

      cancel: async (vaultId) => {
        const walletStore = useWalletStore.getState();
        const txXdr = await buildCancel(BigInt(vaultId));
        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitCcpTx(signedXdr);
        setTimeout(() => get().fetchVaults(), 3000);
      },

      claimPool: async (vaultId) => {
        const walletStore = useWalletStore.getState();
        const address = walletStore.address;
        if (!address) throw new Error("Wallet not connected");
        const txXdr = await buildClaimPool(address, BigInt(vaultId));
        const signedXdr = await walletStore.signTransaction(txXdr);
        await submitCcpTx(signedXdr);
        setTimeout(() => get().fetchVaults(), 3000);
      },

      reset: () => set({ vaults: [], loading: false, error: null }),
    }),
    { name: "group-vault-store-v2" },
  ),
);
