//! # ZK Cryptographic Primitives (BN254)
//!
//! Pedersen commitment scheme over the BN254 elliptic curve (alt_bn128) using
//! Soroban's native BN254 host functions (Protocol 25+/26+).
//!
//! ## Commitment Scheme
//!
//!   C(v, r) = v * G + r * H
//!
//! where G, H are independent BN254 G1 generators with unknown discrete-log
//! relationship. The commitment is compressed to 32 bytes (the x-coordinate
//! of the resulting G1 point).
//!
//! Range tags and nullifiers still use SHA-256 (unchanged).

use soroban_sdk::{
    crypto::bn254::{Bn254Fr, Bn254G1Affine},
    vec, Bytes, BytesN, Env, Vec,
};

// ── Domain separation tags (for hash-based primitives) ────────────────────────

pub const DOMAIN_NULLIFIER: &[u8] = b"zk-stellar:v1:nullifier";
pub const DOMAIN_RANGE:     &[u8] = b"zk-stellar:v1:range";
pub const DOMAIN_VERIFY:    &[u8] = b"zk-stellar:v1:verify";

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

// ── SHA-256 helpers (for range tags and nullifiers) ───────────────────────────

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

// ── Commitment (BN254 Pedersen) ──────────────────────────────────────────────

/// Create a BN254 Pedersen commitment to `amount` with blinding factor `r`.
///
/// C = amount * G + r * H   (compressed to 32-byte x-coordinate)
///
/// Uses `env.crypto().bn254().g1_msm()` for the multi-scalar multiplication.
pub fn commit(env: &Env, amount: i128, r: &[u8; 32]) -> [u8; 32] {
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

/// Verify a commitment opens correctly.
pub fn verify_commit(env: &Env, commitment: &[u8; 32], amount: i128, r: &[u8; 32]) -> bool {
    let expected = commit(env, amount, r);
    ct_eq(&expected, commitment)
}

/// Convert an i128 to Bn254Fr (big-endian 32-byte scalar).
fn i128_to_bn254_fr(env: &Env, value: i128) -> Bn254Fr {
    let le = value.to_le_bytes();
    let mut be32 = [0u8; 32];
    for i in 0..16 {
        be32[31 - i] = le[i];
    }
    let bytesn = BytesN::<32>::from_array(env, &be32);
    Bn254Fr::from_bytes(bytesn)
}

// ── Nullifier ─────────────────────────────────────────────────────────────────
//
// Nullifiers are computed off-chain as:
//   nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id_le || commitment)
//
// The blinding factor r is NOT needed for nullifier derivation — the
// commitment already binds r. This keeps r secret at deposit time.

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
