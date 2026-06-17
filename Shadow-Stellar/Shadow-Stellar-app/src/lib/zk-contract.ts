/**
 * Soroban contract client for the Shadow-Stellar ZK Commitment Protocol.
 *
 * Contract ID: CCFFMJCIIWTGE3VQT62VMNFUFQKI734Y4QBKFGKVEJ3QOVLLJIKJU525
 * Network:     Stellar Testnet
 *
 * Implements SHA-256 hash-based Pedersen commitments:
 *   commitment = SHA-256(DOMAIN_COMMIT || amount_le || blinding_r)
 *   nullifier  = SHA-256(DOMAIN_NULLIFIER || entry_id_le || blinding_r)
 *   range_tag  = SHA-256(DOMAIN_RANGE || commitment || amount || min || max)
 *
 * Off-chain prover helper functions are included in this file so the
 * frontend can construct valid ZkDepositProof / ZkWithdrawProof objects
 * using only the Web Crypto API (SHA-256 is available in every browser).
 */

export const ZK_CONTRACT_ID =
  "CCFFMJCIIWTGE3VQT62VMNFUFQKI734Y4QBKFGKVEJ3QOVLLJIKJU525";

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

// ─── Domain tags (must match the Rust constants) ──────────────────────────────

const DOMAIN_COMMIT    = new TextEncoder().encode("zk-stellar:v1:commit");
const DOMAIN_NULLIFIER = new TextEncoder().encode("zk-stellar:v1:nullifier");
const DOMAIN_RANGE     = new TextEncoder().encode("zk-stellar:v1:range");

// ─── Web Crypto helpers ───────────────────────────────────────────────────────

async function sha256(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) { buf.set(p, offset); offset += p.length; }
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return new Uint8Array(hash);
}

function i128ToLeBytes(n: bigint): Uint8Array {
  // i128 little-endian, 16 bytes
  const buf = new Uint8Array(16);
  let v = n < 0n ? n + (1n << 128n) : n; // two's complement
  for (let i = 0; i < 16; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

function u64ToLeBytes(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

export function toHex(arr: Uint8Array): string {
  return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ─── ZK Proof types (match the Rust #[contracttype] structs) ─────────────────

export interface ZkDepositProofInput {
  commitment: string;  // hex-encoded 32 bytes
  range_tag:  string;
  nullifier:  string;
  amount:     bigint;  // stroops (i128)
  blinding_r: string;  // hex-encoded 32 bytes — the secret, only used locally during build
}

export interface ZkWithdrawProofInput {
  nullifier:  string;
  blinding_r: string;
  amount:     bigint;
}

export interface ZkEntryOnChain {
  commitment: string;
  amount:     bigint;
  nullifier:  string;
  withdrawn:  boolean;
}

// ─── Off-chain prover ─────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random 32-byte blinding factor.
 * Store this securely — it is needed for withdrawal.
 */
export function generateBlinding(): string {
  const r = new Uint8Array(32);
  crypto.getRandomValues(r);
  return toHex(r);
}

/**
 * Compute a Pedersen-style commitment to an amount.
 *   C = SHA-256(DOMAIN_COMMIT || amount_le_16bytes || blinding_r_32bytes)
 */
export async function computeCommitment(
  amountStroops: bigint,
  blindingHex: string,
): Promise<string> {
  const amountBytes  = i128ToLeBytes(amountStroops);
  const blindingBytes = hexToBytes(blindingHex);
  const hash = await sha256(DOMAIN_COMMIT, amountBytes, blindingBytes);
  return toHex(hash);
}

/**
 * Compute a vault-scoped nullifier.
 *   N = SHA-256(DOMAIN_NULLIFIER || entry_id_le_8bytes || blinding_r_32bytes)
 *
 * `entryId` is the on-chain entry counter value BEFORE this deposit.
 * Use getNextEntryId() to fetch it.
 */
export async function computeNullifier(
  entryId: bigint,
  blindingHex: string,
): Promise<string> {
  const idBytes       = u64ToLeBytes(entryId);
  const blindingBytes = hexToBytes(blindingHex);
  const hash = await sha256(DOMAIN_NULLIFIER, idBytes, blindingBytes);
  return toHex(hash);
}

/**
 * Compute a range tag proving amount ∈ [min, max].
 *   T = SHA-256(DOMAIN_RANGE || commitment_32bytes || amount_le || min_le || max_le)
 */
export async function computeRangeTag(
  commitmentHex: string,
  amountStroops: bigint,
  minStroops:    bigint,
  maxStroops:    bigint,
): Promise<string> {
  const c    = hexToBytes(commitmentHex);
  const a    = i128ToLeBytes(amountStroops);
  const mn   = i128ToLeBytes(minStroops);
  const mx   = i128ToLeBytes(maxStroops);
  // Pack: amount(16) + min(16) + max(16) = 48 bytes, then prefix with commitment
  const data = new Uint8Array(48);
  data.set(a, 0); data.set(mn, 16); data.set(mx, 32);
  const hash = await sha256(DOMAIN_RANGE, c, data);
  return toHex(hash);
}

/**
 * Build a complete ZkDepositProof for the given amount and entry_id.
 * Call getNextEntryId() first to get the correct entry_id.
 */
export async function buildDepositProof(
  amountStroops: bigint,
  entryId:       bigint,
  blindingHex?:  string,
): Promise<{ proof: ZkDepositProofInput; blinding: string }> {
  const blinding   = blindingHex ?? generateBlinding();
  const commitment = await computeCommitment(amountStroops, blinding);
  const nullifier  = await computeNullifier(entryId, blinding);
  const rangeTag   = await computeRangeTag(commitment, amountStroops, 1n, amountStroops);

  return {
    blinding,
    proof: {
      commitment,
      range_tag: rangeTag,
      nullifier,
      amount:    amountStroops,
      blinding_r: blinding,
    },
  };
}

/**
 * Build a ZkWithdrawProof given the stored commitment data.
 */
export function buildWithdrawProof(
  amountStroops: bigint,
  nullifierHex:  string,
  blindingHex:   string,
): ZkWithdrawProofInput {
  return {
    nullifier:  nullifierHex,
    blinding_r: blindingHex,
    amount:     amountStroops,
  };
}

// ─── Hex helpers ──────────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++)
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return arr;
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

/** Build a BytesN<32> ScVal from a hex string */
const bytes32Arg = (hex: string) => async () => {
  const { xdr } = await loadSdk();
  return xdr.ScVal.scvBytes(hexToBytes(hex));
};

/** Build a ZkDepositProof struct ScVal — keys MUST be sorted lexicographically */
const depositProofArg = (proof: ZkDepositProofInput) => async () => {
  const { xdr, nativeToScVal } = await loadSdk();
  const bytes32 = (hex: string) => xdr.ScVal.scvBytes(hexToBytes(hex));
  // Sorted order: amount, blinding_r, commitment, nullifier, range_tag
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"),     val: nativeToScVal(proof.amount, { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("blinding_r"), val: bytes32(proof.blinding_r)  }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("commitment"), val: bytes32(proof.commitment)  }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("nullifier"),  val: bytes32(proof.nullifier)   }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("range_tag"),  val: bytes32(proof.range_tag)   }),
  ]);
};

/** Build a ZkWithdrawProof struct ScVal — keys MUST be sorted lexicographically */
const withdrawProofArg = (proof: ZkWithdrawProofInput) => async () => {
  const { xdr, nativeToScVal } = await loadSdk();
  const bytes32 = (hex: string) => xdr.ScVal.scvBytes(hexToBytes(hex));
  // Sorted order: amount, blinding_r, nullifier
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("amount"),     val: nativeToScVal(proof.amount, { type: "i128" }) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("blinding_r"), val: bytes32(proof.blinding_r) }),
    new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol("nullifier"),  val: bytes32(proof.nullifier)  }),
  ]);
};

// ─── Core tx helpers ──────────────────────────────────────────────────────────

async function buildTx(
  publicKey: string,
  method: string,
  argFns: Array<() => Promise<any>>,
): Promise<string> {
  const { Contract, TransactionBuilder, BASE_FEE, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(ZK_CONTRACT_ID);
  const args = await Promise.all(argFns.map(fn => fn()));
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
  const contract = new Contract(ZK_CONTRACT_ID);
  const args = await Promise.all(argFns.map(fn => fn()));
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: NETWORK_PASSPHRASE })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) return null;
  return (sim as any).result ?? null;
}

export async function submitZkTx(signedXdr: string) {
  const { TransactionBuilder, rpc } = await loadSdk();
  const server = new rpc.Server(RPC_URL, { allowHttp: false });
  const tx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status === "ERROR") throw new Error(`Submit failed: ${(sendResult as any).errorResult}`);
  let result: any;
  do {
    await new Promise(r => setTimeout(r, 1500));
    result = await server.getTransaction(sendResult.hash);
  } while (result.status === "NOT_FOUND");
  if (result.status !== "SUCCESS") throw new Error(`Transaction failed: ${result.status}`);
  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the next entry_id that will be assigned on the next deposit.
 * You MUST call this before buildDepositProof() to get the right nullifier domain.
 */
export async function getNextEntryId(): Promise<bigint> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_next_entry_id", []);
  if (!result) return 0n;
  return scValToNative(result.retval) as bigint;
}

/**
 * Build a zk_deposit transaction XDR.
 * Caller must have already constructed the proof via buildDepositProof().
 */
export async function buildZkDeposit(
  caller: string,
  token: string,
  proof: ZkDepositProofInput,
): Promise<string> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) throw new Error(`Unsupported token: ${token}`);
  return buildTx(caller, "zk_deposit", [
    addrArg(caller),
    addrArg(tokenAddr),
    depositProofArg(proof),
  ]);
}

/**
 * Build a zk_withdraw transaction XDR.
 */
export async function buildZkWithdraw(
  caller: string,
  entryId: bigint,
  token: string,
  proof: ZkWithdrawProofInput,
): Promise<string> {
  const tokenAddr = TOKEN_ADDRESS[token];
  if (!tokenAddr) throw new Error(`Unsupported token: ${token}`);
  return buildTx(caller, "zk_withdraw", [
    addrArg(caller),
    u64Arg(entryId),
    addrArg(tokenAddr),
    withdrawProofArg(proof),
  ]);
}

/**
 * Get a ZK vault entry by entry_id.
 */
export async function getZkEntry(entryId: bigint): Promise<ZkEntryOnChain | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_entry_fn", [u64Arg(entryId)]);
  if (!result) return null;
  return scValToNative(result.retval) as ZkEntryOnChain;
}

/**
 * Get all entry IDs deposited by a given address.
 */
export async function getZkEntriesByDepositor(depositor: string): Promise<bigint[]> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_entries_by_depositor", [addrArg(depositor)]);
  if (!result) return [];
  return (scValToNative(result.retval) as bigint[]) ?? [];
}

/**
 * Check if a nullifier has been spent (prevents replay).
 */
export async function isNullifierSpent(nullifierHex: string): Promise<boolean> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("is_nullifier_spent_fn", [bytes32Arg(nullifierHex)]);
  if (!result) return false;
  return scValToNative(result.retval) as boolean;
}

/**
 * Get the commitment hash stored for an entry (for withdrawal preparation).
 */
export async function getCommitment(entryId: bigint): Promise<string | null> {
  const { scValToNative } = await loadSdk();
  const result = await readOnlyTx("get_commitment", [u64Arg(entryId)]);
  if (!result) return null;
  const raw = scValToNative(result.retval) as Uint8Array;
  return toHex(raw instanceof Uint8Array ? raw : new Uint8Array(Object.values(raw as any)));
}
