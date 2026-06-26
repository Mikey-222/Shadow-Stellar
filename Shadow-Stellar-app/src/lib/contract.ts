/**
 * Soroban contract client for the Shadow-Stellar Time-Locked Vault.
 *
 * Contract ID: CABGIDBEGTWZQLGVSZRLGR44PN3Q32QKV5PVD6BZLH4KGBLJDL7ZEZ3H
 * Network:     Stellar Testnet
 */

export const CONTRACT_ID =
  "CABGIDBEGTWZQLGVSZRLGR44PN3Q32QKV5PVD6BZLH4KGBLJDL7ZEZ3H";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";

export const XLM_TOKEN  = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const EURC_TOKEN = "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ";

export const TOKEN_ADDRESS: Record<string, string> = {
  XLM:  XLM_TOKEN,
  USDC: USDC_TOKEN,
  EURC: EURC_TOKEN,
};

// ─── Amount / rate helpers (pure) ────────────────────────────────────────────

export const toStroops   = (human: number): bigint => BigInt(Math.round(human * 10_000_000));
export const fromStroops = (stroops: bigint): number => Number(stroops) / 10_000_000;
export const percentToBps = (pct: number): number => Math.round(pct * 100);
export const bpsToPercent = (bps: number): number => bps / 100;

// ─── On-chain types ───────────────────────────────────────────────────────────

export type LockTypeOnChain   = { Strict: void } | { Penalty: void };
export type VaultStateOnChain = { Active: void } | { Withdrawn: void };

export interface VaultOnChain {
  owner: string; token: string; amount: bigint;
  start_time: bigint; unlock_time: bigint;
  lock_type: LockTypeOnChain; penalty_rate: number; state: VaultStateOnChain;
}

// ─── Lazy SDK loader ──────────────────────────────────────────────────────────

async function loadSdk() {
  const mod = await import("@stellar/stellar-sdk");
  // CJS interop: named exports live on mod.default in the browser bundle
  const s: any = (mod as any).default ?? mod;
  return {
    Contract:           s.Contract,
    TransactionBuilder: s.TransactionBuilder,
    BASE_FEE:           s.BASE_FEE,
    Address:            s.Address,
    xdr:                s.xdr,
    nativeToScVal:      s.nativeToScVal,
    scValToNative:      s.scValToNative,
    Keypair:            s.Keypair,
    Account:            s.Account,
    // SorobanRpc is exported as `rpc` in this version of the SDK
    rpc: s.rpc,
  };
}

// ─── ScVal arg builders ───────────────────────────────────────────────────────

const addrArg = (addr: string) => async () => {
  const { Address } = await loadSdk();
  return new Address(addr).toScVal();
};
const u64Arg = (n: number | bigint) => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n)));
};
const i128Arg = (n: bigint) => async () => {
  const { nativeToScVal } = await loadSdk();
  return nativeToScVal(n, { type: "i128" });
};
const u32Arg = (n: number) => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvU32(n);
};
const lockTypeArg = (lockType: "strict" | "penalty") => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(lockType === "strict" ? "Strict" : "Penalty")]);
};

// ─── Core tx builder ─────────────────────────────────────────────────────────

async function buildTx(
  publicKey: string,
  method: string,
  argFns: Array<() => Promise<any>>,
): Promise<string> {
  const { Contract, TransactionBuilder, BASE_FEE, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(CONTRACT_ID);
  const args = await Promise.all(argFns.map((fn) => fn()));

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const simResult = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${(simResult as any).error}`);
  }

  return rpc.assembleTransaction(tx, simResult as any).build().toXDR();
}

async function readOnlyTx(method: string, argFns: Array<() => Promise<any>>) {
  const { Contract, TransactionBuilder, BASE_FEE, Keypair, Account, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), "0");
  const contract = new Contract(CONTRACT_ID);
  const args = await Promise.all(argFns.map((fn) => fn()));

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  return (sim as any).result ?? null;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function submitTx(signedXdr: string) {
  const { TransactionBuilder, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(tx);

  if (sendResult.status === "ERROR") {
    throw new Error(`Submit failed: ${(sendResult as any).errorResult}`);
  }

  let result: any;
  do {
    await new Promise((r) => setTimeout(r, 1500));
    result = await server.getTransaction(sendResult.hash);
  } while (result.status === "NOT_FOUND");

  if (result.status !== "SUCCESS") {
    throw new Error(`Transaction failed: ${result.status}`);
  }
  return result;
}

export async function buildCreateVault(
  caller: string, token: string, amount: number,
  unlockTime: number, lockType: "strict" | "penalty", penaltyPct: number,
): Promise<string> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) throw new Error(`Unsupported token: ${token}`);
  const penaltyRate = lockType === "penalty" ? percentToBps(penaltyPct) : 0;
  return buildTx(caller, "create_vault", [
    addrArg(caller), addrArg(tokenAddr), i128Arg(toStroops(amount)),
    u64Arg(unlockTime), lockTypeArg(lockType), u32Arg(penaltyRate),
  ]);
}

export async function buildWithdraw(caller: string, vaultId: bigint): Promise<string> {
  return buildTx(caller, "withdraw", [addrArg(caller), u64Arg(vaultId)]);
}

export async function getVault(vaultId: bigint): Promise<VaultOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_vault", [u64Arg(vaultId)]);
  if (!result) return null;
  return scValToNative(result.retval) as VaultOnChain;
}

export async function getVaultsByOwner(owner: string): Promise<bigint[]> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_vaults_by_owner", [addrArg(owner)]);
  if (!result) return [];
  return (scValToNative(result.retval) as bigint[]) ?? [];
}

export async function getTreasuryBalance(token: string): Promise<number> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) return 0;
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_treasury_balance", [addrArg(tokenAddr)]);
  if (!result) return 0;
  return fromStroops(scValToNative(result.retval) as bigint);
}
