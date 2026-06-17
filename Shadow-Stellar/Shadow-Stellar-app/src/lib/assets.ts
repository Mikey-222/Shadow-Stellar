// Crypto asset registry — Stellar testnet.
// Internally we store human-readable decimal amounts (e.g. 100.5 USDC).
// The contract layer converts to/from stroops (7 decimal places).

export type AssetCode = "XLM" | "USDC" | "EURC";

export interface AssetMeta {
  code: AssetCode;
  name: string;
  // SAC contract address on testnet.
  issuer?: string;
  displayDecimals: number;
  accent: string;
  ring: string;
  glyph: string;
}

export const ASSETS: Record<AssetCode, AssetMeta> = {
  XLM: {
    code: "XLM",
    name: "Stellar Lumens",
    // Native XLM SAC on testnet
    issuer: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    displayDecimals: 4,
    accent: "text-amber-core",
    ring: "border-amber-core/40 bg-amber-core/8",
    glyph: "✦",
  },
  USDC: {
    code: "USDC",
    name: "USD Coin",
    // Testnet USDC SAC
    issuer: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    displayDecimals: 2,
    accent: "text-[oklch(0.72_0.14_240)]",
    ring: "border-[oklch(0.55_0.14_240/0.4)] bg-[oklch(0.55_0.14_240/0.08)]",
    glyph: "$",
  },
  EURC: {
    code: "EURC",
    name: "Euro Coin",
    // Testnet EURC SAC — issuer: GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO
    issuer: "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ",
    displayDecimals: 2,
    accent: "text-[oklch(0.78_0.16_155)]",
    ring: "border-[oklch(0.6_0.16_155/0.4)] bg-[oklch(0.6_0.16_155/0.08)]",
    glyph: "€",
  },
};

export const ASSET_CODES: AssetCode[] = ["XLM", "USDC", "EURC"];

export function formatAsset(amount: number, code: AssetCode): string {
  const meta = ASSETS[code];
  const fixed = amount.toFixed(meta.displayDecimals);
  const min = code === "XLM" ? 2 : meta.displayDecimals;
  const [whole, frac = ""] = fixed.split(".");
  const trimmed = frac.replace(/0+$/, "").padEnd(min, "0");
  const wholeFmt = new Intl.NumberFormat("en-US").format(Number(whole));
  return trimmed ? `${wholeFmt}.${trimmed}` : wholeFmt;
}

export function shortAddr(addr: string, head = 4, tail = 4): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}
