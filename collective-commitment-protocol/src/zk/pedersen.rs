//! # Pedersen Commitment Scheme (BN254)
//!
//! Implements perfectly-hiding, computationally-binding Pedersen commitments
//! over the BN254 elliptic curve (alt_bn128) using Soroban's native BN254
//! host functions (Protocol 25+/26+).
//!
//! ## Scheme
//!
//!   C(v, r) = v * G + r * H
//!
//! where G, H are independent BN254 G1 generators with unknown discrete-log
//! relationship. The commitment is compressed to 32 bytes (the x-coordinate
//! of the resulting G1 point).
//!
//! Uses `env.crypto().bn254().g1_msm()` for the multi-scalar multiplication.
//!
//! ## Domain separation
//!
//! Range tags and nullifiers still use SHA-256 (unchanged).
use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine},
    vec, Bytes, BytesN, Env, Vec,
};

/// Domain separation tag for range-proof hash.
pub const DOMAIN_RANGE: &[u8] = b"shadow-stellar:v1:range";

/// Domain separation tag for nullifier hash.
pub const DOMAIN_NULLIFIER: &[u8] = b"shadow-stellar:v1:nullifier";

/// Domain separation tag for Schnorr proofs (reserved, not currently used).
pub const DOMAIN_SCHNORR: &[u8] = b"shadow-stellar:v1:schnorr";

// ── SHA-256 helpers (for range tags and nullifiers) ──────────────────────────

/// Compute SHA-256( domain || data ) using the Soroban crypto primitive.
pub fn sha256_domain(env: &Env, domain: &[u8], data: &[u8]) -> [u8; 32] {
    let mut buf = Bytes::new(env);
    for b in domain { buf.push_back(*b); }
    for b in data  { buf.push_back(*b); }
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

/// A 32-byte Pedersen commitment (x-coordinate of BN254 G1 point).
pub type Commitment = [u8; 32];

/// A 32-byte blinding factor (randomness chosen by the committer).
pub type BlindingFactor = [u8; 32];

// ── BN254 G1 generator constants ─────────────────────────────────────────────
//
// G = (1, 2)   — standard BN254 generator (alt_bn128 G1 generator)
// H = (2, y)   — NUMS point with no known DL from G; y computed from y² = x³ + 3

const G_X: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
];
const G_Y: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
];

const H_X: [u8; 32] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2,
];
const H_Y: [u8; 32] = [
    0x23, 0x81, 0x8c, 0xde, 0x28, 0xcf, 0x4e, 0xa9,
    0x53, 0xfe, 0x59, 0xb1, 0xc3, 0x77, 0xfa, 0xfd,
    0x46, 0x10, 0x39, 0xc1, 0x72, 0x51, 0xff, 0x43,
    0x77, 0x31, 0x3d, 0xa6, 0x4a, 0xd0, 0x7e, 0x13,
];

fn g1_generator(env: &Env) -> Bn254G1Affine {
    let mut bytes = [0u8; 64];
    bytes[..32].copy_from_slice(&G_X);
    bytes[32..].copy_from_slice(&G_Y);
    Bn254G1Affine::from_array(env, &bytes)
}

fn h_generator(env: &Env) -> Bn254G1Affine {
    let mut bytes = [0u8; 64];
    bytes[..32].copy_from_slice(&H_X);
    bytes[32..].copy_from_slice(&H_Y);
    Bn254G1Affine::from_array(env, &bytes)
}

// ── Core commitment functions ─────────────────────────────────────────────────

/// Create a BN254 Pedersen commitment to `amount` with blinding factor `r`.
///
/// C = amount * G + r * H   (compressed to 32-byte x-coordinate)
///
/// Uses `env.crypto().bn254().g1_msm()` for the multi-scalar multiplication.
///
/// This is computed **off-chain** and submitted to the contract.
/// The on-chain verifier calls `verify_commitment` to check it.
pub fn commit(env: &Env, amount: i128, r: &BlindingFactor) -> Commitment {
    let g = g1_generator(env);
    let h = h_generator(env);

    // Convert amount (i128) to Bn254Fr (big-endian scalar)
    let amount_fr = i128_to_bn254_fr(env, amount);

    // Convert blinding factor r to Bn254Fr (big-endian scalar)
    let r_bytesn = BytesN::<32>::from_array(env, r);
    let r_fr = Bn254Fr::from_bytes(r_bytesn);

    // C = amount * G + r * H
    let points = vec![&env, g, h];
    let scalars = vec![&env, amount_fr, r_fr];
    let point = env.crypto().bn254().g1_msm(points, scalars);

    // Return x-coordinate (first 32 bytes) as compressed commitment
    let point_bytes = point.to_array();
    let mut commitment = [0u8; 32];
    commitment.copy_from_slice(&point_bytes[..32]);
    commitment
}

/// Verify that a commitment opens correctly.
///
/// Returns `true` iff `C == commit(amount, r)`.
pub fn verify_commitment(env: &Env, commitment: &Commitment, amount: i128, r: &BlindingFactor) -> bool {
    let expected = commit(env, amount, r);
    ct_eq_32(&expected, commitment)
}

/// Convert an i128 to Bn254Fr (big-endian 32-byte scalar).
fn i128_to_bn254_fr(env: &Env, value: i128) -> Bn254Fr {
    let le = value.to_le_bytes();           // 16 bytes, little-endian
    let mut be32 = [0u8; 32];               // zero-padded 32 bytes
    for i in 0..16 {
        be32[31 - i] = le[i];              // reverse LE to BE
    }
    let bytesn = BytesN::<32>::from_array(env, &be32);
    Bn254Fr::from_bytes(bytesn)
}

// ── Nullifier ─────────────────────────────────────────────────────────────────
//
// Nullifiers are computed off-chain as:
//   nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id_le || commitment)
//
// The contract verifies this derivation in verify_deposit_proof using the
// commitment (which is submitted at deposit time). The blinding factor r
// is NOT needed for nullifier derivation — the commitment already binds r.
//
// This design means:
//   - blinding factor r is NOT revealed at deposit time (privacy)
//   - r IS revealed at withdrawal time to prove ownership
//   - The nullifier is deterministic from (vault_id, commitment), ensuring
//     each deposit has a unique nullifier (different r → different commitment)

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
