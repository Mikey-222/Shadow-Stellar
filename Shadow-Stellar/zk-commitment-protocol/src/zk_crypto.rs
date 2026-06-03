//! # ZK Cryptographic Primitives
//!
//! Hash-based commitment scheme using Soroban's SHA-256 primitive.
//! All functions are pure (no side effects) and run inside `#![no_std]`.
//!
//! ## Commitment Scheme
//!
//!   C(v, r) = SHA-256(DOMAIN_COMMIT || little_endian_16(v) || r)
//!
//! - **Hiding:**  perfect — C leaks nothing about v for random r
//! - **Binding:** computational — SHA-256 collision resistance
//!
//! ## Domain tags
//!
//! Every hash is prefixed with a context string to prevent cross-protocol
//! attacks and cross-domain commitment reuse.

use soroban_sdk::{Bytes, BytesN, Env};

// ── Domain separation tags ────────────────────────────────────────────────────

pub const DOMAIN_COMMIT:    &[u8] = b"zk-stellar:v1:commit";
pub const DOMAIN_NULLIFIER: &[u8] = b"zk-stellar:v1:nullifier";
pub const DOMAIN_RANGE:     &[u8] = b"zk-stellar:v1:range";
pub const DOMAIN_VERIFY:    &[u8] = b"zk-stellar:v1:verify";

// ── SHA-256 helpers ───────────────────────────────────────────────────────────

/// SHA-256(domain || data)
pub fn h1(env: &Env, domain: &[u8], data: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in data   { buf.push_back(*b); }
    env.crypto().sha256(&buf).to_array()
}

/// SHA-256(domain || d1 || d2)
pub fn h2(env: &Env, domain: &[u8], d1: &[u8], d2: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in d1     { buf.push_back(*b); }
    for b in d2     { buf.push_back(*b); }
    env.crypto().sha256(&buf).to_array()
}

/// SHA-256(domain || d1 || d2 || d3)
pub fn h3(env: &Env, domain: &[u8], d1: &[u8], d2: &[u8], d3: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in d1     { buf.push_back(*b); }
    for b in d2     { buf.push_back(*b); }
    for b in d3     { buf.push_back(*b); }
    env.crypto().sha256(&buf).to_array()
}

// ── Constant-time compare ─────────────────────────────────────────────────────

/// Constant-time equality for 32-byte arrays.
#[inline]
pub fn ct_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut acc: u8 = 0;
    for i in 0..32 { acc |= a[i] ^ b[i]; }
    acc == 0
}

// ── Commitment ────────────────────────────────────────────────────────────────

/// Create a commitment: C = SHA-256(DOMAIN_COMMIT || amount_le || r)
pub fn commit(env: &Env, amount: i128, r: &[u8; 32]) -> [u8; 32] {
    let amount_bytes = amount.to_le_bytes();
    h2(env, DOMAIN_COMMIT, &amount_bytes, r)
}

/// Verify a commitment opens correctly.
pub fn verify_commit(env: &Env, commitment: &[u8; 32], amount: i128, r: &[u8; 32]) -> bool {
    let expected = commit(env, amount, r);
    ct_eq(&expected, commitment)
}

// ── Nullifier ─────────────────────────────────────────────────────────────────

/// Compute a vault-scoped nullifier: H(DOMAIN_NULLIFIER || vault_id_le || r)
pub fn nullifier(env: &Env, vault_id: u64, r: &[u8; 32]) -> [u8; 32] {
    let vault_bytes = vault_id.to_le_bytes();
    h2(env, DOMAIN_NULLIFIER, &vault_bytes, r)
}

/// Verify a nullifier matches the expected derivation.
pub fn verify_nullifier(
    env: &Env,
    vault_id: u64,
    r: &[u8; 32],
    supplied: &[u8; 32],
) -> bool {
    let expected = nullifier(env, vault_id, r);
    ct_eq(&expected, supplied)
}

// ── Range tag ─────────────────────────────────────────────────────────────────

/// Compute a range tag proving value ∈ [min, max]:
///   range_tag = SHA-256(DOMAIN_RANGE || commitment || value_le || min_le || max_le)
pub fn range_tag(env: &Env, commitment: &[u8; 32], value: i128, min: i128, max: i128) -> [u8; 32] {
    let vb = value.to_le_bytes();
    let mnb = min.to_le_bytes();
    let mxb = max.to_le_bytes();
    // Pack value, min, max into 48 bytes
    let mut data = [0u8; 48];
    data[0..16].copy_from_slice(&vb);
    data[16..32].copy_from_slice(&mnb);
    data[32..48].copy_from_slice(&mxb);
    h2(env, DOMAIN_RANGE, commitment, &data)
}

/// Verify a range tag for value ∈ [min, max].
pub fn verify_range_tag(
    env: &Env,
    commitment: &[u8; 32],
    value: i128,
    min: i128,
    max: i128,
    tag: &[u8; 32],
) -> bool {
    if value < min || value > max {
        return false;
    }
    let expected = range_tag(env, commitment, value, min, max);
    ct_eq(&expected, tag)
}

// ── BytesN conversion helpers ─────────────────────────────────────────────────

/// Convert raw [u8;32] to Soroban BytesN<32>.
pub fn to_bytes32(env: &Env, arr: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, arr)
}

/// Convert Soroban BytesN<32> to raw [u8;32].
pub fn from_bytes32(b: &BytesN<32>) -> [u8; 32] {
    b.to_array()
}
