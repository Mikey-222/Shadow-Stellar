import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AssetCode } from "@/lib/assets";
import { stellar } from "@/lib/stellar-helper";
import { NETWORK_PASSPHRASE } from "@/lib/contract";

export type WalletKind = "kit";

interface WalletState {
  connected: boolean;
  address: string | null;
  kind: WalletKind | null;
  balances: Record<AssetCode, number>;
  trustlines: Record<AssetCode, boolean>;

  connect: () => Promise<void>;
  disconnect: () => void;
  addTrustline: (asset: AssetCode) => void;
  refreshBalances: () => Promise<void>;
  adjustBalance: (asset: AssetCode, delta: number) => void;
  signTransaction: (xdr: string) => Promise<string>;
}

async function fetchBalances(address: string): Promise<{
  balances: Record<AssetCode, number>;
  trustlines: Record<AssetCode, boolean>;
}> {
  try {
    const { xlm, assets } = await stellar.getBalance(address);
    const balances: Record<AssetCode, number> = {
      XLM: parseFloat(xlm),
      USDC: 0,
      EURC: 0,
    };
    const trustlines: Record<AssetCode, boolean> = {
      XLM: true,
      USDC: false,
      EURC: false,
    };

    for (const a of assets) {
      const code = a.code as AssetCode;
      if (code === "USDC" || code === "EURC") {
        balances[code] = parseFloat(a.balance);
        trustlines[code] = true;
      }
    }

    return { balances, trustlines };
  } catch {
    return {
      balances: { XLM: 0, USDC: 0, EURC: 0 },
      trustlines: { XLM: true, USDC: false, EURC: false },
    };
  }
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      connected: false,
      address: null,
      kind: null,
      balances: { XLM: 0, USDC: 0, EURC: 0 },
      trustlines: { XLM: true, USDC: false, EURC: false },

      connect: async () => {
        const address = await stellar.connectWallet();
        const { balances, trustlines } = await fetchBalances(address);
        set({ connected: true, kind: "kit", address, balances, trustlines });
      },

      disconnect: () => {
        stellar.disconnect();
        set({
          connected: false,
          address: null,
          kind: null,
          balances: { XLM: 0, USDC: 0, EURC: 0 },
          trustlines: { XLM: true, USDC: false, EURC: false },
        });
      },

      addTrustline: (asset) => {
        set({ trustlines: { ...get().trustlines, [asset]: true } });
      },

      refreshBalances: async () => {
        const { address } = get();
        if (!address) return;
        const { balances, trustlines } = await fetchBalances(address);
        set({ balances, trustlines });
      },

      adjustBalance: (asset, delta) => {
        const current = get().balances[asset] ?? 0;
        set({ balances: { ...get().balances, [asset]: Math.max(0, current + delta) } });
      },

      signTransaction: async (txXdr: string): Promise<string> => {
        return stellar.signTransaction(txXdr);
      },
    }),
    { name: "wallet-store-v1" },
  ),
);
