/**
 * Soroban contract client for the Shadow-Stellar Collective Commitment Protocol
 * — upgraded with full ZK privacy module.
 *
 * Contract ID: CAL3RFT65X7GPLVTWSHYL3ODN6VPLE3M4BDZ5R7LABENLIGHSZQTYFIJ  (CCP + ZK)
 * Network:     Stellar Testnet
 */

export const CCP_CONTRACT_ID =
  "CAL3RFT65X7GPLVTWSHYL3ODN6VPLE3M4BDZ5R7LABENLIGHSZQTYFIJ";

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const RPC_URL = "https://soroban-testnet.stellar.org";

export const XLM_TOKEN  = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
export const USDC_TOKEN = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
export const EURC_TOKEN = "CCUUDM434BMZMYWYDITHFXHDMIVTGGD6T2I5UKNX5BSLXLW7HVR4MCGZ";

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
  if (sendResult.status === "ERROR") {
    const errResult = (sendResult as any).errorResult;
    let detail = String(errResult);
    try { detail = JSON.stringify(errResult); } catch (_) {}
    if (errResult?.result?.switch) detail = `code=${errResult.result.switch}`;
    throw new Error(`Submit failed: ${detail}`);
  }
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

// ═══════════════════════════════════════════════════════════════════════════════
// ─── ZK Privacy Module — Types & Client Functions ─────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Domain tags (must match Rust constants) ──────────────────────────────────

const ZK_DOMAIN_COMMIT    = new TextEncoder().encode("shadow-stellar:v1:commit");
const ZK_DOMAIN_NULLIFIER = new TextEncoder().encode("shadow-stellar:v1:nullifier");
const ZK_DOMAIN_RANGE     = new TextEncoder().encode("shadow-stellar:v1:range");

// ─── Hex / SHA-256 helpers ────────────────────────────────────────────────────

function zkHexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

function zkBytesToHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

function i128ToLeBytes(n: bigint): Uint8Array {
  const buf = new Uint8Array(16);
  let v = n < 0n ? n + (1n << 128n) : n;
  for (let i = 0; i < 16; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

function u64ToLeBytes(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { buf.set(p, offset); offset += p.length; }
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf));
}

// ─── Off-chain prover helpers ─────────────────────────────────────────────────

/** Derive a deterministic member secret from a Stellar wallet address. */
export async function deriveSecretFromAddress(address: string): Promise<string> {
  const data = new TextEncoder().encode(address.toLowerCase());
  return zkBytesToHex(await sha256(data));
}

/** Generate a random 32-byte member secret hex string (still used for blinding factors). */
export function generateMemberSecret(): string {
  const r = new Uint8Array(32);
  crypto.getRandomValues(r);
  return zkBytesToHex(r);
}

/**
 * Compute a member identity commitment:
 *   member_commitment = SHA-256(DOMAIN_COMMIT || member_secret)
 */
export async function computeMemberCommitment(memberSecretHex: string): Promise<string> {
  const secret = zkHexToBytes(memberSecretHex);
  return zkBytesToHex(await sha256(ZK_DOMAIN_COMMIT, secret));
}

/**
 * Compute a deposit commitment:
 *   commitment = SHA-256(DOMAIN_COMMIT || amount_le_16 || blinding_r_32)
 */
export async function computeZkDepositCommitment(amountStroops: bigint, blindingHex: string): Promise<string> {
  const a = i128ToLeBytes(amountStroops);
  const r = zkHexToBytes(blindingHex);
  return zkBytesToHex(await sha256(ZK_DOMAIN_COMMIT, a, r));
}

/**
 * Compute a deposit range tag:
 *   range_tag = SHA-256(DOMAIN_RANGE || commitment || amount || max)
 */
export async function computeZkRangeTag(commitmentHex: string, amountStroops: bigint, maxStroops: bigint): Promise<string> {
  const c = zkHexToBytes(commitmentHex);
  const a = i128ToLeBytes(amountStroops);
  const mx = i128ToLeBytes(maxStroops);
  const data = new Uint8Array(48); // amount(16) + max(16) + commitment[0..16]
  data.set(a, 0); data.set(mx, 16); data.set(c.slice(0, 16), 32);
  return zkBytesToHex(await sha256(ZK_DOMAIN_RANGE, c, data));
}

/**
 * Compute a vault-scoped deposit nullifier:
 *   nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id_le_8 || blinding_r_32)
 */
export async function computeZkNullifier(vaultId: bigint, blindingHex: string): Promise<string> {
  const id = u64ToLeBytes(vaultId);
  const r = zkHexToBytes(blindingHex);
  return zkBytesToHex(await sha256(ZK_DOMAIN_NULLIFIER, id, r));
}

/**
 * Build a ZkDepositProof for deposit_zk.
 * The obligation_commitment is the member's identity commitment.
 * The obligation_blinding_r is the member_secret (used to open the identity commitment).
 */
export async function buildZkDepositProof(
  amountStroops: bigint,
  vaultId: bigint,
  obligationCommitmentHex: string,
  memberSecretHex: string,
  blindingHex?: string,
): Promise<{
  commitment: string;
  range_tag: string;
  nullifier: string;
  obligation_commitment: string;
  amount_opening: string;
  blinding_r: string;
  obligation_blinding_r: string;
}> {
  const r = blindingHex ?? zkBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const commitment = await computeZkDepositCommitment(amountStroops, r);
  const rangeTag = await computeZkRangeTag(commitment, amountStroops, amountStroops);
  const nullifier = await computeZkNullifier(vaultId, r);
  return {
    commitment,
    range_tag: rangeTag,
    nullifier,
    obligation_commitment: obligationCommitmentHex,
    amount_opening: amountStroops.toString(),
    blinding_r: r,
    obligation_blinding_r: memberSecretHex,
  };
}

// ─── On-chain ZK types ────────────────────────────────────────────────────────

export interface ZkGroupVaultOnChain {
  vault_id: bigint;
  creator: string;
  token: string;
  member_count: number;
  total_size: bigint;
  slot_obligations: Record<number, bigint>;
  unlock_time: bigint;
  funding_deadline: bigint;
  lock_type: CcpLockType;
  penalty_rate: number;
  state: CcpVaultState;
  deposited_count: number;
  claimed_count: number;
  eligible_claimers: number;
  original_pool: bigint;
  commission_rate: number;
}

export interface ZkMemberRecordOnChain {
  member_commitment: string;
  amount_commitment: string;
  nullifier: string;
  state: CcpMemberState;
  amount: bigint;
}

// ─── ZK ScVal builders ────────────────────────────────────────────────────────

const bytes32Arg = (hex: string) => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvBytes(zkHexToBytes(hex));
};

const bytes32VecArg = (hexes: string[]) => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvVec(hexes.map(h => xdr.ScVal.scvBytes(zkHexToBytes(h))));
};

/** Build a ZkProof ScVal for deposit_zk */
const zkProofArg = (proof: {
  commitment: string;
  range_tag: string;
  nullifier: string;
  obligation_commitment: string;
  amount_opening: string;
  blinding_r: string;
  obligation_blinding_r: string;
}) => async () => {
  const { xdr, nativeToScVal } = await loadSdk();
  const b32 = (hex: string) => xdr.ScVal.scvBytes(zkHexToBytes(hex));
  const zero32 = new Uint8Array(32);
  const depositProof = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_opening"), val: nativeToScVal(BigInt(proof.amount_opening), { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("blinding_r"), val: b32(proof.blinding_r) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("commitment"), val: b32(proof.commitment) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("nullifier"), val: b32(proof.nullifier) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("obligation_blinding_r"), val: b32(proof.obligation_blinding_r) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("obligation_commitment"), val: b32(proof.obligation_commitment) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("range_tag"), val: b32(proof.range_tag) }),
  ]);
  const schnorrProof = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("commitment_r"), val: xdr.ScVal.scvBytes(zero32) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("public_key"), val: xdr.ScVal.scvBytes(zero32) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("response_s"), val: xdr.ScVal.scvBytes(zero32) }),
  ]);
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("deposit_proof"), val: depositProof }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("schnorr_proof"), val: schnorrProof }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("use_schnorr"), val: xdr.ScVal.scvBool(false) }),
  ]);
};

/** Build a ZkEarlyExitProof ScVal for withdraw_zk */
const zkEarlyExitProofArg = (exitProof: {
  amount_commitment: string;
  payout_commitment: string;
  penalty_commitment: string;
  penalty_range_tag: string;
  amount_opening: string;
  amount_blinding: string;
  payout_blinding: string;
  penalty_blinding: string;
}) => async () => {
  const { xdr, nativeToScVal } = await loadSdk();
  const b32 = (hex: string) => xdr.ScVal.scvBytes(zkHexToBytes(hex));
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_blinding"), val: b32(exitProof.amount_blinding) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_commitment"), val: b32(exitProof.amount_commitment) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount_opening"), val: nativeToScVal(BigInt(exitProof.amount_opening), { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("payout_blinding"), val: b32(exitProof.payout_blinding) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("payout_commitment"), val: b32(exitProof.payout_commitment) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("penalty_blinding"), val: b32(exitProof.penalty_blinding) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("penalty_commitment"), val: b32(exitProof.penalty_commitment) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("penalty_range_tag"), val: b32(exitProof.penalty_range_tag) }),
  ]);
};

// ─── ZK Public API ─────────────────────────────────────────────────────────────

/** Create a ZK privacy-mode group vault. */
export async function buildCreateGroupVaultZk(
  creator: string,
  token: string,
  memberCommitments: string[],    // hex strings
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

  const commitVec = xdr.ScVal.scvVec(memberCommitments.map((h) => xdr.ScVal.scvBytes(zkHexToBytes(h))));
  const i128Vec = xdr.ScVal.scvVec(stroopAmounts.map((n) => nativeToScVal(n, { type: "i128" })));

  const args = [
    new Address(creator).toScVal(),
    new Address(tokenAddr).toScVal(),
    commitVec,
    i128Vec,
    xdr.ScVal.scvU64(xdr.Uint64.fromString(String(unlockTime))),
    xdr.ScVal.scvU64(xdr.Uint64.fromString(String(fundingDeadline))),
    xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(lockType === "strict" ? "Strict" : "Penalty")]),
    xdr.ScVal.scvU32(penaltyRate),
  ];

  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call("create_group_vault_zk", ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`Simulation failed: ${(sim as any).error}`);
  return rpc.assembleTransaction(tx, sim as any).build().toXDR();
}

/** Build a deposit_zk transaction XDR. */
export async function buildDepositZk(
  caller: string,
  vaultId: bigint,
  proof: {
    commitment: string;
    range_tag: string;
    nullifier: string;
    obligation_commitment: string;
    amount_opening: string;
    blinding_r: string;
    obligation_blinding_r: string;
  },
): Promise<string> {
  return buildTx(caller, "deposit_zk", [
    addrArg(caller),
    u64Arg(vaultId),
    zkProofArg(proof),
  ]);
}

/** Build a withdraw_zk transaction XDR for mature withdrawal or cancelled refund. */
export async function buildWithdrawZk(
  caller: string,
  vaultId: bigint,
  nullifierHex: string,
  exitProof?: {
    amount_commitment: string;
    payout_commitment: string;
    penalty_commitment: string;
    penalty_range_tag: string;
    amount_opening: string;
    amount_blinding: string;
    payout_blinding: string;
    penalty_blinding: string;
  },
): Promise<string> {
  const { xdr } = await loadSdk();
  const nullifierBytes = zkHexToBytes(nullifierHex);
  return buildTx(caller, "withdraw_zk", [
    addrArg(caller),
    u64Arg(vaultId),
    () => xdr.ScVal.scvBytes(nullifierBytes),
    exitProof ? zkEarlyExitProofArg(exitProof) : (async () => {
      const { xdr: x } = await loadSdk();
      const zero = new Uint8Array(32);
      return x.ScVal.scvMap([
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("amount_blinding"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("amount_commitment"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("amount_opening"), val: x.ScVal.scvI128(new x.ScInt(0)) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("payout_blinding"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("payout_commitment"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("penalty_blinding"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("penalty_commitment"), val: x.ScVal.scvBytes(zero) }),
        new x.ScMapEntry({ key: x.ScVal.scvSymbol("penalty_range_tag"), val: x.ScVal.scvBytes(zero) }),
      ]);
    })(),
    async () => {
      const { xdr: x } = await loadSdk();
      return x.ScVal.scvBool(!!exitProof);
    },
  ]);
}

/** Build a claim_pool_zk transaction XDR. */
export async function buildClaimPoolZk(
  caller: string,
  vaultId: bigint,
  nullifierHex: string,
): Promise<string> {
  const { xdr } = await loadSdk();
  return buildTx(caller, "claim_pool_zk", [
    addrArg(caller),
    u64Arg(vaultId),
    () => xdr.ScVal.scvBytes(zkHexToBytes(nullifierHex)),
  ]);
}

// ─── ZK Read-only queries ─────────────────────────────────────────────────────

export async function getZkVault(vaultId: bigint): Promise<ZkGroupVaultOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_zk_vault", [u64Arg(vaultId)]);
  if (!result) return null;
  const raw = scValToNative(result.retval) as any;
  // Convert slot_obligations Map<number, bigint> if needed
  return raw as ZkGroupVaultOnChain;
}

export async function getZkMemberRecord(vaultId: bigint, slot: number): Promise<ZkMemberRecordOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_zk_member_record_fn", [u64Arg(vaultId), u32Arg(slot)]);
  if (!result) return null;
  const raw = scValToNative(result.retval) as any;
  return {
    member_commitment: raw.member_commitment instanceof Uint8Array ? zkBytesToHex(raw.member_commitment) : raw.member_commitment,
    amount_commitment: raw.amount_commitment instanceof Uint8Array ? zkBytesToHex(raw.amount_commitment) : raw.amount_commitment,
    nullifier: raw.nullifier instanceof Uint8Array ? zkBytesToHex(raw.nullifier) : raw.nullifier,
    state: raw.state,
    amount: raw.amount,
  };
}

export async function isNullifierSpent(nullifierHex: string): Promise<boolean> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("is_nullifier_spent", [bytes32Arg(nullifierHex)]);
  if (!result) return false;
  return scValToNative(result.retval) as boolean;
}

export async function getVaultPrivacyMode(vaultId: bigint): Promise<boolean> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_vault_privacy_mode", [u64Arg(vaultId)]);
  if (!result) return false;
  return scValToNative(result.retval) as boolean;
}

/** Build an early exit ZK proof for a penalty withdrawal. */
export async function buildZkEarlyExitProof(
  amountStroops: bigint,
  penaltyRate: number,
): Promise<{
  amount_commitment: string;
  payout_commitment: string;
  penalty_commitment: string;
  penalty_range_tag: string;
  amount_opening: string;
  amount_blinding: string;
  payout_blinding: string;
  penalty_blinding: string;
}> {
  const amountR = zkBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const payoutR = zkBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const penaltyR = zkBytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const penalty = amountStroops * BigInt(penaltyRate) / 10000n;
  const payout = amountStroops - penalty;

  const amountCommitment = await computeZkDepositCommitment(amountStroops, amountR);
  const payoutCommitment = await computeZkDepositCommitment(payout, payoutR);
  const penaltyCommitment = await computeZkDepositCommitment(penalty, penaltyR);
  const penaltyRangeTag = await computeZkRangeTag(penaltyCommitment, penalty, amountStroops);

  return {
    amount_commitment: amountCommitment,
    payout_commitment: payoutCommitment,
    penalty_commitment: penaltyCommitment,
    penalty_range_tag: penaltyRangeTag,
    amount_opening: amountStroops.toString(),
    amount_blinding: amountR,
    payout_blinding: payoutR,
    penalty_blinding: penaltyR,
  };
}
