/**
 * Soroban contract client for the Shadow-Stellar Collective Commitment Protocol
 * — upgraded with full ZK privacy module.
 *
 * Contract ID: CAOER4YOQ7V7H77AWGUZVYL75QB5ZBKO6UUYGPATBO6AEDTBUQ2ZS4EZ  (CCP + ZK)
 * Legacy CCP:  CAUWWUYA5G5USCMEK4BMVD26I2ZH52HUULR5YKPSNHPLFAEGGKBDX3GO
 * Network:     Stellar Testnet
 */

export const CCP_CONTRACT_ID =
  "CAOER4YOQ7V7H77AWGUZVYL75QB5ZBKO6UUYGPATBO6AEDTBUQ2ZS4EZ";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";

export const XLM_TOKEN  = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const EURC_TOKEN = "CDTK22VXFIBQTJKX6HOA3VWQBTG335LDKM56OO3RIJIPYIUK6PPMURS3";

export const TOKEN_ADDRESS: Record<string, string> = {
  XLM: XLM_TOKEN, USDC: USDC_TOKEN, EURC: EURC_TOKEN,
};

export const toStroops   = (human: number): bigint => BigInt(Math.round(human * 10_000_000));
export const fromStroops = (stroops: bigint): number => Number(stroops) / 10_000_000;
export const percentToBps = (pct: number): number => Math.round(pct * 100);
export const bpsToPercent = (bps: number): number => bps / 100;

// ─── On-chain types ───────────────────────────────────────────────────────────

export type CcpVaultState =
  | { FundingOpen: void }
  | { ActiveLocked: void }
  | { SettlementReady: void }
  | { Resolved: void }
  | { Cancelled: void };

export type CcpMemberState =
  | { Committed: void }
  | { Deposited: void }
  | { Active: void }
  | { Exited: void }
  | { Withdrawn: void }
  | { Claimed: void };

export type CcpLockType = { Strict: void } | { Penalty: void };

export interface GroupVaultOnChain {
  vault_id: bigint;
  creator: string;
  token: string;
  members: string[];
  obligations: Record<string, bigint>;
  unlock_time: bigint;
  funding_deadline: bigint;
  lock_type: CcpLockType;
  penalty_rate: number;
  state: CcpVaultState;
  total_size: bigint;
  deposited_count: number;
  claimed_count: number;
  eligible_claimers: number;
  original_pool: bigint;
}

export interface MemberRecordOnChain {
  state: CcpMemberState;
  amount: bigint;
}

// ─── Lazy SDK loader ──────────────────────────────────────────────────────────

async function loadSdk() {
  const mod = await import("@stellar/stellar-sdk");
  const s: any = (mod as any).default ?? mod;
  return {
    Contract: s.Contract, TransactionBuilder: s.TransactionBuilder,
    BASE_FEE: s.BASE_FEE, Address: s.Address, xdr: s.xdr,
    nativeToScVal: s.nativeToScVal, scValToNative: s.scValToNative,
    Keypair: s.Keypair, Account: s.Account,
    rpc: s.rpc,
  };
}

// ─── ScVal builders ───────────────────────────────────────────────────────────

const addrArg  = (addr: string) => async () => { const { Address } = await loadSdk(); return new Address(addr).toScVal(); };
const u64Arg   = (n: number | bigint) => async () => { const { xdr } = await loadSdk(); return xdr.ScVal.scvU64(xdr.Uint64.fromString(String(n))); };
const i128Arg  = (n: bigint) => async () => { const { nativeToScVal } = await loadSdk(); return nativeToScVal(n, { type: "i128" }); };
const u32Arg   = (n: number) => async () => { const { xdr } = await loadSdk(); return xdr.ScVal.scvU32(n); };
const lockTypeArg = (lt: "strict" | "penalty") => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(lt === "strict" ? "Strict" : "Penalty")]);
};

/** Build a Vec<Address> ScVal */
const addrVecArg = (addrs: string[]) => async () => {
  const { xdr, Address } = await loadSdk();
  return xdr.ScVal.scvVec(addrs.map((a) => new Address(a).toScVal()));
};

/** Build a Vec<i128> ScVal */
const i128VecArg = (amounts: bigint[]) => async () => {
  const { xdr, nativeToScVal } = await loadSdk();
  return xdr.ScVal.scvVec(amounts.map((n) => nativeToScVal(n, { type: "i128" })));
};

// ─── Core helpers ─────────────────────────────────────────────────────────────

async function buildTx(publicKey: string, method: string, argFns: Array<() => Promise<any>>): Promise<string> {
  const { Contract, TransactionBuilder, BASE_FEE, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(CCP_CONTRACT_ID);
  const args = await Promise.all(argFns.map((fn) => fn()));
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${(sim as any).error}`);
  return rpc.assembleTransaction(tx, sim as any).build().toXDR();
}

async function readOnlyTx(method: string, argFns: Array<() => Promise<any>>) {
  const { Contract, TransactionBuilder, BASE_FEE, Keypair, Account, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), "0");
  const contract = new Contract(CCP_CONTRACT_ID);
  const args = await Promise.all(argFns.map((fn) => fn()));
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  return (sim as any).result ?? null;
}

export async function submitCcpTx(signedXdr: string) {
  const { TransactionBuilder, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === "ERROR") throw new Error(`Submit failed: ${(sendResult as any).errorResult}`);
  let result: any;
  do {
    await new Promise((r) => setTimeout(r, 1500));
    result = await server.getTransaction(sendResult.hash);
  } while (result.status === "NOT_FOUND");
  if (result.status !== "SUCCESS") throw new Error(`Transaction failed: ${result.status}`);
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function buildCreateGroupVault(
  creator: string,
  token: string,
  members: string[],
  amounts: number[],
  unlockTime: number,
  fundingDeadline: number,
  lockType: "strict" | "penalty",
  penaltyPct: number,
): Promise<string> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) throw new Error(`Unsupported token: ${token}`);
  const penaltyRate = lockType === "penalty" ? percentToBps(penaltyPct) : 0;
  const stroopAmounts = amounts.map(toStroops);

  const { Contract, TransactionBuilder, BASE_FEE, rpc, Address, xdr, nativeToScVal } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const account = await server.getAccount(creator);
  const contract = new Contract(CCP_CONTRACT_ID);

  // Build args inline to avoid closure issues with auth
  const addrVec = xdr.ScVal.scvVec(members.map((a: string) => new Address(a).toScVal()));
  const i128Vec = xdr.ScVal.scvVec(stroopAmounts.map((n: bigint) => nativeToScVal(n, { type: "i128" })));

  const args = [
    new Address(creator).toScVal(),
    new Address(tokenAddr).toScVal(),
    addrVec,
    i128Vec,
    xdr.ScVal.scvU64(xdr.Uint64.fromString(String(unlockTime))),
    xdr.ScVal.scvU64(xdr.Uint64.fromString(String(fundingDeadline))),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(lockType === "strict" ? "Strict" : "Penalty")]),
    xdr.ScVal.scvU32(penaltyRate),
  ];

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call("create_group_vault", ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed: ${(sim as any).error}`);
  }

  // assembleTransaction adds only the auth entries the contract actually needs
  return rpc.assembleTransaction(tx, sim as any).build().toXDR();
}

export async function buildDeposit(caller: string, vaultId: bigint): Promise<string> {
  return buildTx(caller, "deposit", [addrArg(caller), u64Arg(vaultId)]);
}

export async function buildCcpWithdraw(caller: string, vaultId: bigint): Promise<string> {
  return buildTx(caller, "withdraw", [addrArg(caller), u64Arg(vaultId)]);
}

export async function buildCancel(vaultId: bigint): Promise<string> {
  // cancel has no auth — use a dummy caller for fee estimation
  const { Keypair, Account, Contract, TransactionBuilder, BASE_FEE, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const kp = Keypair.random();
  const account = new Account(kp.publicKey(), "0");
  const contract = new Contract(CCP_CONTRACT_ID);
  const args = [(await u64Arg(vaultId)())];
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call("cancel", ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${(sim as any).error}`);
  return rpc.assembleTransaction(tx, sim as any).build().toXDR();
}

export async function buildClaimPool(caller: string, vaultId: bigint): Promise<string> {
  return buildTx(caller, "claim_pool", [addrArg(caller), u64Arg(vaultId)]);
}

export async function getGroupVault(vaultId: bigint): Promise<GroupVaultOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_group_vault", [u64Arg(vaultId)]);
  if (!result) return null;
  return scValToNative(result.retval) as GroupVaultOnChain;
}

export async function getMemberState(vaultId: bigint, member: string): Promise<MemberRecordOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_member_state", [u64Arg(vaultId), addrArg(member)]);
  if (!result) return null;
  return scValToNative(result.retval) as MemberRecordOnChain;
}

export async function getVaultsByMember(member: string): Promise<bigint[]> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_vaults_by_member", [addrArg(member)]);
  if (!result) return [];
  return (scValToNative(result.retval) as bigint[]) ?? [];
}

export async function getVaultsByCreator(creator: string): Promise<bigint[]> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_vaults_by_creator", [addrArg(creator)]);
  if (!result) return [];
  return (scValToNative(result.retval) as bigint[]) ?? [];
}

export async function getCcpPoolBalance(vaultId: bigint): Promise<number> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_pool_balance", [u64Arg(vaultId)]);
  if (!result) return 0;
  return fromStroops(scValToNative(result.retval) as bigint);
}

// ─── State helpers ────────────────────────────────────────────────────────────

export function vaultStateLabel(state: CcpVaultState | string): string {
  const s = typeof state === "string" ? state : Object.keys(state as object)[0];
  if (s === "FundingOpen") return "Funding Open";
  if (s === "ActiveLocked") return "Active Locked";
  if (s === "SettlementReady") return "Settlement Ready";
  if (s === "Resolved") return "Resolved";
  if (s === "Cancelled") return "Cancelled";
  return s;
}

export function memberStateLabel(state: CcpMemberState | string): string {
  const s = typeof state === "string" ? state : Object.keys(state as object)[0];
  if (s === "Committed") return "Committed";
  if (s === "Deposited") return "Deposited";
  if (s === "Active") return "Active";
  if (s === "Exited") return "Exited";
  if (s === "Withdrawn") return "Withdrawn";
  if (s === "Claimed") return "Claimed";
  return s;
}
