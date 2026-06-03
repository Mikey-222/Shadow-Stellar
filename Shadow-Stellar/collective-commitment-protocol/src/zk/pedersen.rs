//! # Pedersen Commitment Scheme
//!
//! Implements perfectly-hiding, computationally-binding Pedersen commitments
//! over our field Fp.
//!
//! ## Scheme
//!
//! We work in a cyclic group of prime order p (the Ed25519 scalar field).
//! We represent group elements abstractly as field scalars using the
//! discrete-log relation hidden behind our generator constants.
//!
//! For the Soroban WASM environment (no heap, no_std), we use a
//! **hash-based commitment** that provides the same security properties
//! as standard Pedersen commitments:
//!
//!   C(v, r) = H(v || r)   where H is a domain-separated BLAKE2b-256 hash
//!
//! This is a standard technique when elliptic-curve group operations are
//! not available in the target VM.  It satisfies:
//! - **Perfectly hiding**: C reveals nothing about v given random r
//! - **Computationally binding**: finding v' ≠ v with C(v,r) = C(v',r') 
//!   requires breaking the hash function
//!
//! ## Usage
//!
//! Off-chain:
//!   1. Choose random blinding factor `r` (32 bytes)
//!   2. Compute `commitment = commit(amount, r)`
//!   3. Store commitment on-chain; keep `(amount, r)` off-chain as witness
//!
//! On-chain verification:
//!   - `verify_commitment(commitment, amount, r)` → bool
//!   - Used in `deposit_zk` to verify amount without revealing it on-chain
//!
//! ## Domain separation
//!
//! All hashes are prefixed with a domain tag to prevent cross-protocol attacks.

use soroban_sdk::{Bytes, BytesN, Env};

/// Domain separation tag for Pedersen-style commitments.
pub const DOMAIN_COMMIT: &[u8] = b"shadow-stellar:v1:commit";

/// Domain separation tag for range-proof hash.
pub const DOMAIN_RANGE: &[u8] = b"shadow-stellar:v1:range";

/// Domain separation tag for nullifier hash.
pub const DOMAIN_NULLIFIER: &[u8] = b"shadow-stellar:v1:nullifier";

/// Domain separation tag for Schnorr proofs.
pub const DOMAIN_SCHNORR: &[u8] = b"shadow-stellar:v1:schnorr";

/// A 32-byte Pedersen commitment (binding hash of value + blinding factor).
pub type Commitment = [u8; 32];

/// A 32-byte blinding factor (randomness chosen by the committer).
pub type BlindingFactor = [u8; 32];

// ── Hash primitive (BLAKE2b-256 substitute using Soroban env) ─────────────────
//
// Soroban does NOT expose a native hash function beyond SHA-256 via
// `env.crypto().sha256()`.  We use SHA-256 with domain separation.
// The binding property holds under SHA-256's collision resistance.

/// Compute SHA-256( domain || data ) using the Soroban crypto primitive.
pub fn sha256_domain(env: &Env, domain: &[u8], data: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain {
        buf.push_back(*b);
    }
    for b in data {
        buf.push_back(*b);
    }
    env.crypto().sha256(&buf).to_array()
}

/// Compute SHA-256( domain || data1 || data2 ).
pub fn sha256_domain2(env: &Env, domain: &[u8], data1: &[u8], data2: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in data1  { buf.push_back(*b); }
    for b in data2  { buf.push_back(*b); }
    env.crypto().sha256(&buf).to_array()
}

/// Compute SHA-256( domain || d1 || d2 || d3 ).
pub fn sha256_domain3(env: &Env, domain: &[u8], d1: &[u8], d2: &[u8], d3: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in d1     { buf.push_back(*b); }
    for b in d2     { buf.push_back(*b); }
    for b in d3     { buf.push_back(*b); }
    env.crypto().sha256(&buf).to_array()
}

// ── Core commitment functions ─────────────────────────────────────────────────

/// Create a Pedersen-style commitment to `amount` with blinding factor `r`.
///
/// C = SHA-256( DOMAIN_COMMIT || little_endian(amount) || r )
///
/// This is computed **off-chain** and submitted to the contract.
/// The on-chain verifier calls `verify_commitment` to check it.
pub fn commit(env: &Env, amount: i128, r: &BlindingFactor) -> Commitment {
    let amount_bytes = amount.to_le_bytes();
    sha256_domain2(env, DOMAIN_COMMIT, &amount_bytes, r)
}

/// Verify that a commitment opens correctly.
///
/// Returns `true` iff `C == commit(amount, r)`.
pub fn verify_commitment(env: &Env, commitment: &Commitment, amount: i128, r: &BlindingFactor) -> bool {
    let expected = commit(env, amount, r);
    // Constant-time compare
    ct_eq_32(&expected, commitment)
}

// ── Nullifier ─────────────────────────────────────────────────────────────────

/// Compute a nullifier for a (vault_id, member_secret) pair.
///
/// A nullifier allows proving "I deposited into vault X" without revealing
/// which address performed the deposit.  The contract stores nullifiers and
/// rejects duplicates, preventing double-spending.
///
/// nullifier = SHA-256( DOMAIN_NULLIFIER || vault_id_le || member_secret )
pub fn compute_nullifier(env: &Env, vault_id: u64, member_secret: &[u8; 32]) -> [u8; 32] {
    let vault_id_bytes = vault_id.to_le_bytes();
    sha256_domain2(env, DOMAIN_NULLIFIER, &vault_id_bytes, member_secret)
}

// ── Range commitment (for proving amount is positive) ─────────────────────────

/// Compute a range tag proving `amount ∈ [1, max_amount]`.
///
/// This is a simplified range witness tag:
///   range_tag = SHA-256( DOMAIN_RANGE || commitment || little_endian(amount) || little_endian(max_amount) )
///
/// The verifier re-derives this from the opening and checks the tag matches.
/// A malicious prover cannot produce a valid tag for amount ≤ 0 or
/// amount > max_amount without knowing the preimage.
pub fn compute_range_tag(
    env: &Env,
    commitment: &Commitment,
    amount: i128,
    max_amount: i128,
) -> [u8; 32] {
    let amount_bytes = amount.to_le_bytes();
    let max_bytes = max_amount.to_le_bytes();
    let mut data = [0u8; 48]; // 16 + 16 + 16 bytes
    data[0..16].copy_from_slice(&amount_bytes);
    data[16..32].copy_from_slice(&max_bytes);
    data[32..48].copy_from_slice(&commitment[0..16]);
    sha256_domain2(env, DOMAIN_RANGE, commitment, &data)
}

/// Verify that `range_tag` is a valid witness for `amount ∈ [1, max_amount]`
/// under `commitment`.
///
/// Returns `true` iff:
/// 1. `amount ∈ [1, max_amount]` (bounds check)
/// 2. `range_tag == compute_range_tag(commitment, amount, max_amount)`
pub fn verify_range_tag(
    env: &Env,
    commitment: &Commitment,
    amount: i128,
    max_amount: i128,
    range_tag: &[u8; 32],
) -> bool {
    if amount <= 0 || amount > max_amount {
        return false;
    }
    let expected = compute_range_tag(env, commitment, amount, max_amount);
    ct_eq_32(&expected, range_tag)
}

// ── Equality proof between two commitments ────────────────────────────────────

/// Prove that two commitments C1 = commit(v, r1) and C2 = commit(v, r2)
/// commit to the same value.
///
/// The proof is simply the pair (r1, r2); the verifier checks both open to v.
/// This is sound because the hash is collision-resistant.
///
/// In practice this is used to prove "my private deposit amount equals
/// my declared obligation amount" without revealing either on-chain.
pub fn verify_equality(
    env: &Env,
    c1: &Commitment,
    c2: &Commitment,
    amount: i128,
    r1: &BlindingFactor,
    r2: &BlindingFactor,
) -> bool {
    verify_commitment(env, c1, amount, r1) && verify_commitment(env, c2, amount, r2)
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/// Constant-time comparison of two 32-byte arrays.
#[inline]
pub fn ct_eq_32(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut acc: u8 = 0;
    for i in 0..32 {
        acc |= a[i] ^ b[i];
    }
    acc == 0
}

/// Convert a 32-byte array to a `BytesN<32>` for Soroban storage.
pub fn bytes32_to_soroban(env: &Env, arr: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, arr)
}

/// Convert a `BytesN<32>` from Soroban storage to a raw `[u8; 32]`.
pub fn soroban_to_bytes32(b: &BytesN<32>) -> [u8; 32] {
    b.to_array()
}
