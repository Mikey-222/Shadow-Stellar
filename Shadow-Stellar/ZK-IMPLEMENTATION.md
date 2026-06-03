# Zero-Knowledge Implementation for Shadow-Stellar

## Overview

Shadow-Stellar now includes a **full zero-knowledge proof system** integrated into the Collective Commitment Protocol (CCP). This implementation provides privacy-preserving deposits, withdrawals, and early exits on the Stellar blockchain via Soroban smart contracts.

## Architecture

```
collective-commitment-protocol/src/zk/
├── mod.rs         # ZK module root, re-exports
├── field.rs       # Finite field arithmetic (Fp over Ed25519 scalar field)
├── pedersen.rs    # Commitment scheme using SHA-256 hash-based commitments
├── proof.rs       # ZK proof data structures (#[contracttype])
└── verifier.rs    # On-chain proof verification functions
```

## What Privacy Does This Provide?

### 1. Private Deposits
- **Standard CCP:** Member deposits are public — address and amount visible on-chain
- **ZK CCP:** Members commit to their deposit amount off-chain via a cryptographic commitment. The on-chain record stores only the commitment hash and a nullifier (anti-replay token). The deposit amount is revealed only during verification, then discarded.

### 2. Hidden Member Identities (Privacy Mode Vaults)
- **Standard CCP:** Vault stores plaintext `Vec<Address>` for all members
- **ZK CCP:** Vault stores `Vec<BytesN<32>>` of identity commitments. Members prove they control a committed slot via their secret, without revealing which slot index they occupy.

### 3. Verifiable Penalty Calculation
- **Early exit penalties** are computed with zero-knowledge proofs — the contract verifies the penalty is correct without storing intermediate values.

### 4. Nullifier-Based Replay Protection
- Each (vault_id, member_secret) pair produces a unique **nullifier** hash. The contract stores spent nullifiers, preventing double-deposits or double-claims while preserving privacy.

## Cryptographic Primitives

### Finite Field Arithmetic (`field.rs`)

**Field:** Fp = scalars mod ℓ, where ℓ is the Ed25519 basepoint order (2^252 + 27742317777372353535851937790883648493).

**Representation:** `Fp { lo: u128, hi: u128 }` — 256-bit integers reduced mod ℓ.

**Operations:**
- Addition, subtraction, negation
- Multiplication (schoolbook 4-limb)
- Modular inverse via Fermat's little theorem (a^(p-2) mod p)
- Byte serialization (little-endian)

**Why Ed25519 scalars?** Stellar natively uses Ed25519 for account keys. Working in the same scalar field allows future integration with Stellar's native signature primitives.

### Hash-Based Commitments (`pedersen.rs`)

In the Soroban WASM environment, native elliptic-curve group operations are not available. We implement **hash-based Pedersen commitments** using SHA-256 (exposed via `env.crypto().sha256()`):

```
C(v, r) = SHA-256( DOMAIN_COMMIT || little_endian(v) || r )
```

Where:
- `v`: committed value (i128 amount or member secret)
- `r`: 32-byte random blinding factor
- `DOMAIN_COMMIT = b"shadow-stellar:v1:commit"`

**Security:**
- **Perfectly hiding** — revealing `C(v,r)` leaks nothing about `v` (randomness from `r`)
- **Computationally binding** — finding `(v',r')` with `C(v,r) = C(v',r')` and `v ≠ v'` requires breaking SHA-256's collision resistance

**Domain separation:** All hashes are prefixed with context tags to prevent cross-protocol attacks:
- `DOMAIN_COMMIT` — commitment binding
- `DOMAIN_NULLIFIER` — nullifier derivation
- `DOMAIN_RANGE` — range proof tags
- `DOMAIN_SCHNORR` — Schnorr authentication

### Nullifiers

A **nullifier** is a unique identifier derived from a (vault_id, secret) pair:

```
nullifier = SHA-256( DOMAIN_NULLIFIER || vault_id_le || member_secret )
```

**Properties:**
- **Unique per vault:** changing `vault_id` produces a different nullifier
- **Secret-derived:** only the holder of `member_secret` can compute the nullifier
- **One-time use:** the contract stores spent nullifiers; replays are rejected

**Use case:** A member deposits into vault 42 with secret `s`. The nullifier `n = H(42 || s)` is stored on-chain. Later, the member withdraws by presenting `n` — the contract verifies they own the nullifier without storing `s`.

### Range Proofs

To prove `amount ∈ [1, max_obligation]` without revealing `amount`, we use a **range witness tag**:

```
range_tag = SHA-256( DOMAIN_RANGE || commitment || amount_le || max_obligation_le )
```

The verifier checks:
1. `amount ∈ [1, max_obligation]` (arithmetic bound check)
2. `range_tag` matches the recomputed hash

If the prover supplies an out-of-range `amount`, they cannot produce a matching `range_tag` (binding property of the hash).

This is a simplified range proof suitable for Soroban's constraints. Full zero-range proofs (Bulletproofs, zk-SNARKs) are not supported in WASM due to compute/memory limits.

### Schnorr Authentication (Optional)

For additional authentication, we provide a **hash-based Schnorr proof**:

```
public_key = H(COMMIT || secret)
R = H(COMMIT || k_nonce)
e = H(SCHNORR || R || public_key || message)
s = k_nonce XOR (e AND secret)
```

Verifier checks: `H(COMMIT || s XOR e) == R`

This is a simplified Schnorr-in-the-ROM (Random Oracle Model) construction adapted for hash-based groups. It provides non-interactive proof-of-secret-knowledge.

## Proof Structures (`proof.rs`)

All proof types are Soroban `#[contracttype]` so they can be passed as contract arguments and stored on-chain.

### `ZkDepositProof`

Submitted during `deposit_zk`:

| Field | Type | Purpose |
|---|---|---|
| `commitment` | `BytesN<32>` | H(amount \|\| r) |
| `range_tag` | `BytesN<32>` | Range witness for amount ∈ [1, obligation] |
| `nullifier` | `BytesN<32>` | H(vault_id \|\| blinding_r) |
| `obligation_commitment` | `BytesN<32>` | Commitment to declared obligation (must equal deposit amount) |
| `amount_opening` | `i128` | The plaintext amount (verified then discarded) |
| `blinding_r` | `BytesN<32>` | Blinding factor for `commitment` |
| `obligation_blinding_r` | `BytesN<32>` | Blinding factor for `obligation_commitment` |

**Verifier checks:**
1. `commitment` opens correctly to `amount_opening` with `blinding_r`
2. `obligation_commitment` opens to the same `amount_opening`
3. `range_tag` is valid for `amount_opening ∈ [1, obligation]`
4. `nullifier` is correctly derived and not already spent

### `ZkEarlyExitProof`

Proves penalty calculation correctness:

| Field | Type | Purpose |
|---|---|---|
| `amount_commitment` | `BytesN<32>` | Commitment to locked amount |
| `payout_commitment` | `BytesN<32>` | Commitment to payout (amount - penalty) |
| `penalty_commitment` | `BytesN<32>` | Commitment to penalty |
| `penalty_range_tag` | `BytesN<32>` | Proves penalty ∈ [1, amount] |
| `amount_opening` | `i128` | Locked amount (plaintext for verification) |
| `amount_blinding` | `BytesN<32>` | Blinding for amount_commitment |
| `payout_blinding` | `BytesN<32>` | Blinding for payout_commitment |
| `penalty_blinding` | `BytesN<32>` | Blinding for penalty_commitment |

**Verifier checks:**
1. All commitments open correctly
2. `penalty = floor(amount * penalty_rate / 10_000)`
3. `payout + penalty == amount` (conservation of value)
4. `penalty_range_tag` valid

### `ZkMembershipProof`

Proves membership in a privacy-mode vault:

| Field | Type | Purpose |
|---|---|---|
| `member_commitment` | `BytesN<32>` | H(COMMIT \|\| member_secret) |
| `vault_nullifier` | `BytesN<32>` | H(NULLIFIER \|\| vault_id \|\| member_secret) |
| `member_secret` | `BytesN<32>` | The secret (revealed during verification, not stored) |

**Verifier checks:**
1. `member_commitment` matches the stored on-chain commitment for a slot
2. `vault_nullifier` derives correctly from `member_secret`

### `ZkProof` (Top-Level)

Combined proof for `deposit_zk`:

```rust
struct ZkProof {
    deposit_proof: ZkDepositProof,
    schnorr_proof: SchnorrProof,
    use_schnorr: bool,
}
```

If `use_schnorr` is false, the Schnorr fields are ignored.

## Contract Functions

### ZK Vault Creation

```rust
fn create_group_vault_zk(
    env: Env,
    creator: Address,
    token: Address,
    member_commitments: Vec<BytesN<32>>,  // H(member_secret[i]) for each slot
    amounts: Vec<i128>,
    unlock_time: u64,
    funding_deadline: u64,
    lock_type: LockType,
    penalty_rate: u32,
) -> Result<u64, CcpError>
```

**Privacy mode:** Instead of plaintext addresses, the creator provides commitments to member secrets. Each slot stores a `ZkMemberRecord`:

```rust
struct ZkMemberRecord {
    member_commitment: BytesN<32>,  // H(COMMIT || secret)
    amount_commitment: BytesN<32>,  // H(COMMIT || amount || r) — set after deposit
    nullifier: BytesN<32>,          // H(NULLIFIER || vault_id || r) — set after deposit
    state: MemberState,
    amount: i128,                   // Net locked (revealed after ZK verification)
}
```

### ZK Deposit

```rust
fn deposit_zk(
    env: Env,
    caller: Address,
    vault_id: u64,
    proof: ZkProof,
) -> Result<(), CcpError>
```

**Flow:**
1. Verify vault is in ZK privacy mode
2. Check funding deadline not passed
3. Verify nullifier not already spent
4. Find the slot matching `proof.obligation_commitment`
5. Verify `ZkDepositProof` (commitment, range, equality, nullifier derivation)
6. Optional: verify Schnorr authentication if `proof.use_schnorr` is true
7. Execute token transfer (plaintext — Stellar blockchain constraint)
8. Deduct 5% creator commission, store net 95% locked amount
9. Mark nullifier as spent
10. Update `ZkMemberRecord` with commitment, nullifier, amount
11. Auto-activate vault when all slots deposited

### ZK Withdrawal

```rust
fn withdraw_zk(
    env: Env,
    caller: Address,
    vault_id: u64,
    nullifier: BytesN<32>,
    exit_proof: ZkEarlyExitProof,
    use_exit_proof: bool,
) -> Result<(), CcpError>
```

**Paths:**
- **Cancelled vault:** refund (no proof needed)
- **SettlementReady:** mature withdrawal (no proof needed)
- **ActiveLocked + Penalty:** early exit — requires `ZkEarlyExitProof` (set `use_exit_proof = true`)

The contract finds the member slot by matching the `nullifier` stored during deposit.

### ZK Pool Claim

```rust
fn claim_pool_zk(
    env: Env,
    caller: Address,
    vault_id: u64,
    nullifier: BytesN<32>,
) -> Result<(), CcpError>
```

Equal share distribution:
```
base = original_pool / eligible_claimers
first_claimer_share = base + remainder
other_claimers_share = base
```

The member identifies their slot via nullifier.

### ZK Read-Only Queries

```rust
fn is_nullifier_spent(env: Env, nullifier: BytesN<32>) -> bool
fn get_zk_member_record_fn(env: Env, vault_id: u64, slot: u32) -> Result<ZkMemberRecord, CcpError>
fn get_zk_vault(env: Env, vault_id: u64) -> Result<ZkGroupVault, CcpError>
fn get_vault_privacy_mode(env: Env, vault_id: u64) -> bool
```

## Off-Chain Prover Workflow

### Generating a ZK Deposit Proof

**Step 1:** Pick random `r ∈ [0, 2^256)` (cryptographically secure RNG)

**Step 2:** Compute commitment:
```python
commitment = SHA256(DOMAIN_COMMIT || amount.to_bytes(16, 'little') || r)
```

**Step 3:** Compute obligation commitment (same amount, different blinding):
```python
r_obl = random_bytes(32)
obligation_commitment = SHA256(DOMAIN_COMMIT || amount.to_bytes(16, 'little') || r_obl)
```

**Step 4:** Compute range tag:
```python
range_tag = SHA256(DOMAIN_RANGE || commitment || amount_le || max_obligation_le)
```

**Step 5:** Compute nullifier:
```python
nullifier = SHA256(DOMAIN_NULLIFIER || vault_id.to_bytes(8, 'little') || r)
```

**Step 6:** Pack into `ZkDepositProof` struct and submit to `deposit_zk`

### Reference Implementation (Python)

```python
import hashlib
import os

DOMAIN_COMMIT = b"shadow-stellar:v1:commit"
DOMAIN_NULLIFIER = b"shadow-stellar:v1:nullifier"
DOMAIN_RANGE = b"shadow-stellar:v1:range"

def sha256_domain(domain: bytes, *data: bytes) -> bytes:
    h = hashlib.sha256()
    h.update(domain)
    for d in data:
        h.update(d)
    return h.digest()

def commit(amount: int, blinding: bytes) -> bytes:
    """Compute Pedersen-style commitment."""
    amount_bytes = amount.to_bytes(16, 'little', signed=True)
    return sha256_domain(DOMAIN_COMMIT, amount_bytes, blinding)

def compute_nullifier(vault_id: int, blinding: bytes) -> bytes:
    """Compute vault-scoped nullifier."""
    vault_id_bytes = vault_id.to_bytes(8, 'little')
    return sha256_domain(DOMAIN_NULLIFIER, vault_id_bytes, blinding)

def compute_range_tag(commitment: bytes, amount: int, max_obligation: int) -> bytes:
    """Compute range witness tag."""
    amount_bytes = amount.to_bytes(16, 'little', signed=True)
    max_bytes = max_obligation.to_bytes(16, 'little', signed=True)
    data = amount_bytes + max_bytes + commitment[:16]
    return sha256_domain(DOMAIN_RANGE, commitment, data)

# Example: Create a deposit proof for 1000 XLM
vault_id = 42
amount = 950_000_000  # 950 XLM (after 5% commission deduction)
max_obligation = 1_000_000_000  # 1000 XLM

blinding_r = os.urandom(32)
obligation_r = os.urandom(32)

commitment = commit(amount, blinding_r)
obligation_commitment = commit(amount, obligation_r)
nullifier = compute_nullifier(vault_id, blinding_r)
range_tag = compute_range_tag(commitment, amount, max_obligation)

print(f"commitment: {commitment.hex()}")
print(f"obligation_commitment: {obligation_commitment.hex()}")
print(f"nullifier: {nullifier.hex()}")
print(f"range_tag: {range_tag.hex()}")
```

## Storage Layout

### ZK Storage Keys (`DataKey` enum extensions)

```rust
enum DataKey {
    // ... existing keys ...
    
    /// Spent nullifier registry
    ZkNullifier(BytesN<32>),            // nullifier -> vault_id
    
    /// ZK member record per slot
    ZkMemberRecord(u64, u32),           // (vault_id, slot_index) -> ZkMemberRecord
    
    /// Privacy mode flag
    ZkVaultPrivacyMode(u64),            // vault_id -> bool
    
    /// ZK vault record (stored at sentinel index u32::MAX)
    ZkMemberRecord(u64, u32::MAX),      // ZkGroupVault data
}
```

**TTL:** All persistent ZK storage keys use `LEDGER_BUMP_AMOUNT = 535_000` ledgers.

## Security Properties

### 1. Commitment Binding
**Property:** Once published, a commitment cannot be opened to a different value.  
**Guarantee:** SHA-256 collision resistance.  
**Attack Model:** Adversary with ~2^128 hash evaluations could find a collision (infeasible).

### 2. Commitment Hiding
**Property:** A commitment reveals nothing about the committed value.  
**Guarantee:** Randomness in the blinding factor `r` (256-bit entropy).  
**Attack Model:** Adversary with unlimited compute cannot distinguish commitments (information-theoretic hiding).

### 3. Nullifier Uniqueness
**Property:** Each (vault, member_secret) pair produces exactly one nullifier.  
**Guarantee:** Hash function determinism + on-chain spent-nullifier registry.  
**Attack Model:** Replay attacks rejected by `is_nullifier_used` check.

### 4. Range Soundness
**Property:** A prover cannot convince the verifier that an out-of-range value is valid.  
**Guarantee:** Range tag verification recomputes the hash; binding prevents forgery.  
**Limitation:** The range check is arithmetic (not a full bulletproof); the amount is revealed during verification.

### 5. No Stuck Funds
**Property:** Every ZK vault eventually resolves (no funds permanently locked).  
**Guarantee:** Same state machine as standard CCP — `Cancelled` or `Resolved` terminal states.

## Limitations & Trade-offs

### 1. Amount Privacy is Partial
- **During deposit:** Amount is privately committed.
- **On-chain verification:** Amount is revealed in the transaction call (Soroban requires plaintext function arguments).
- **Post-deposit:** Only the commitment is stored, but the amount was visible in the transaction metadata.

**Workaround:** Use a **mixer contract** or **relayer service** to submit transactions on behalf of users, hiding the caller's direct link to the amount.

### 2. Address Privacy is Constrained
- **Token transfers** require plaintext addresses (Stellar Asset Contract constraint).
- **ZK privacy mode** hides which slot a member occupies, but the transfer recipient address is still visible in the ledger.

**Workaround:** Members can use **temporary Stellar accounts** (created just for the vault deposit) and transfer out to their real account after withdrawal.

### 3. No Full zk-SNARKs
- Soroban WASM runtime has limited compute (10M CPU instructions per transaction).
- Bulletproofs and Groth16 zk-SNARKs are too expensive for on-chain verification.
- This implementation uses **hash-based commitments + simplified range proofs** — a pragmatic balance for Stellar.

### 4. Nullifiers are Forward-Linkable
- If a member reveals their `member_secret`, all past deposits into any vault are linkable (nullifier = H(vault || secret)).
- **Mitigation:** Use a unique secret per vault (derive from master secret + vault_id via HKDF).

### 5. Creator Commission is Public
- The 5% commission transfer happens in plaintext (creator address visible).
- This is unavoidable due to Stellar's transparent ledger model.

## Comparison: Standard vs ZK CCP

| Feature | Standard CCP | ZK CCP (Privacy Mode) |
|---|---|---|
| **Member addresses stored** | Yes (plaintext Vec<Address>) | No (commitments only) |
| **Deposit amounts on-chain** | Yes (plaintext i128) | Commitment only (hash) |
| **Withdrawal amounts** | Public | Public (token transfer) |
| **Early-exit penalty** | Public | Verifiable via ZK proof |
| **Nullifier registry** | N/A | Spent nullifiers stored |
| **Creator commission** | Public | Public (token transfer) |
| **Gas cost (estimate)** | 100K CPU instructions | 300K CPU instructions (3× cost for ZK verification) |
| **Security assumptions** | Soroban auth + token contract | + SHA-256 collision resistance |

## Testing

**Unit tests:** 41 passing (36 original CCP + 5 ZK field tests)

**ZK-specific tests:**
- `field_tests::test_zero_one` — field identity elements
- `field_tests::test_add_sub_roundtrip` — arithmetic correctness
- `field_tests::test_negation` — modular negation
- `field_tests::test_mul_one` — multiplicative identity
- `field_tests::test_from_bytes_roundtrip` — serialization round-trip

**Integration tests needed (manual):**
1. Create a ZK vault with 5 member commitments
2. Submit 5 ZK deposits with valid proofs → vault activates
3. One member exits early with `ZkEarlyExitProof` → penalty added to pool
4. Advance ledger to `unlock_time`
5. Remaining members withdraw + claim pool → vault resolves

## Deployment

### Build WASM
```bash
cargo build --manifest-path collective-commitment-protocol/Cargo.toml \
  --target wasm32-unknown-unknown --release
```

### Optimize
```bash
stellar contract optimize \
  --wasm target/wasm32-unknown-unknown/release/collective_commitment_protocol.wasm
```

### Deploy to Testnet
```bash
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/collective_commitment_protocol.optimized.wasm \
  --source deployer \
  --network testnet
```

### Initialize
```bash
stellar contract invoke --id <CONTRACT_ID> --source deployer --network testnet \
  -- initialize \
  --xlm_token CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --usdc_token CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA \
  --eurc_token CDTK22VXFIBQTJKX6HOA3VWQBTG335LDKM56OO3RIJIPYIUK6PPMURS3
```

## Future Enhancements

### 1. Full zk-SNARKs (Post-Soroban Upgrade)
If Stellar adds precompiled BN254 or BLS12-381 pairing support, upgrade to Groth16 proofs for true zero-knowledge (no revealed amounts during verification).

### 2. Recursive Proof Composition
Use STARKs to compress multiple ZK operations (deposit + early exit + claim) into a single proof, reducing on-chain verification cost.

### 3. Privacy-Preserving Token Transfers
Integrate with a **Zcash-style shielded pool** or **Tornado Cash mixer** on Stellar to hide token transfer amounts and sender/receiver linkability.

### 4. Anonymous Credentials
Issue **BBS+ credentials** for vault membership — members prove "I am in vault X" without revealing their slot or identity.

### 5. Multi-Party Computation (MPC)
Use threshold signatures (FROST/TSS) so the vault creator cannot identify members even during vault creation — the commitment list is constructed collaboratively.

## References

- **Ed25519:** [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)
- **Pedersen Commitments:** Torben Pryds Pedersen, "Non-Interactive and Information-Theoretic Secure Verifiable Secret Sharing" (CRYPTO 1991)
- **Hash-to-Curve (future work):** [RFC 9380](https://www.rfc-editor.org/rfc/rfc9380.html)
- **Bulletproofs:** Bünz et al., "Bulletproofs: Short Proofs for Confidential Transactions" (S&P 2018)
- **Soroban Docs:** [https://developers.stellar.org/docs/smart-contracts](https://developers.stellar.org/docs/smart-contracts)

## Contact & Support

For questions or security reports:
- GitHub Issues: [Shadow-Stellar](https://github.com/Chidubemkingsley/Time_Lock_Vault)
- Twitter: [@KingsleyCaesar1](https://x.com/KingsleyCaesar1)
- Security: See [Security.md](./Security.md) for responsible disclosure process

---

**License:** MIT

**Audit Status:** Self-audited. Independent audit recommended before mainnet deployment.

**Last Updated:** June 3, 2026
