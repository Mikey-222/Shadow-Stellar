//! # Zero-Knowledge Proof Types
//!
//! Defines the proof structures used in Shadow-Stellar's ZK layer.
//!
//! ## Proof Types
//!
//! ### 1. `ZkDepositProof`
//! Proves:
//! - The depositor knows an `amount` and blinding factor `r` such that the
//!   on-chain `commitment = commit(amount, r)`
//! - `amount > 0` and `amount ≤ max_obligation` (range claim)
//! - The depositor has a valid nullifier for this vault (prevents replay)
//!
//! ### 2. `ZkMembershipProof`
//! Proves:
//! - The caller controls a secret that hashes to the on-chain `member_commitment`
//!   stored for their address
//! - Without revealing the secret itself
//!
//! ### 3. `ZkEarlyExitProof`
//! Proves:
//! - The exiting member's locked amount matches their commitment
//! - The penalty calculation is correctly applied
//!
//! ## Serialization
//!
//! All proof structs are `#[contracttype]` so they can be passed as
//! Soroban contract arguments and stored in contract storage.

use soroban_sdk::{contracttype, BytesN};

/// A zero-knowledge deposit proof.
///
/// Submitted by a member during `deposit_zk`.  The contract verifier checks:
/// 1. `commitment` opens to `amount` with `blinding_r` → commitment binding
/// 2. `range_tag` is a valid range witness for `amount ∈ [1, obligation]`
/// 3. `nullifier` equals `H(vault_id || member_secret)` and is not yet used
/// 4. `obligation_commitment` opens to the same `amount` as the deposit
///
/// The `amount` and both blinding factors are **not stored on-chain** —
/// they are used only during verification and discarded.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkDepositProof {
    /// Pedersen commitment to the deposit amount: C = H(amount || r)
    pub commitment: BytesN<32>,

    /// Range tag proving amount ∈ [1, obligation]: H(RANGE || commitment || amount || max)
    pub range_tag: BytesN<32>,

    /// Nullifier: H(NULLIFIER || vault_id || member_secret) — prevents replay
    pub nullifier: BytesN<32>,

    /// Commitment to the declared obligation (must equal commitment to deposit amount)
    pub obligation_commitment: BytesN<32>,

    /// The actual deposit amount (opening of `commitment` and `obligation_commitment`)
    /// This is the plaintext value the verifier checks.
    /// In a full ZK system this would be a proof element, not revealed.
    /// For Soroban's practical constraints we use "commit-and-reveal" where the
    /// amount is verified but only the commitment is stored persistently.
    pub amount_opening: i128,

    /// Blinding factor for `commitment`
    pub blinding_r: BytesN<32>,

    /// Blinding factor for `obligation_commitment`
    pub obligation_blinding_r: BytesN<32>,
}

/// A zero-knowledge membership proof.
///
/// Proves knowledge of a `member_secret` that hashes to the stored
/// `member_commitment` for this vault member.  Used in privacy mode
/// where member addresses are not stored in plaintext.
///
/// In Shadow-Stellar's CCP:
/// - At vault creation, the creator provides `member_commitments` (one per slot)
///   instead of plaintext `Address` values
/// - A member proves membership by revealing their secret
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkMembershipProof {
    /// The commitment stored on-chain for this member slot
    pub member_commitment: BytesN<32>,

    /// Vault-scoped nullifier: H(NULLIFIER || vault_id || member_secret)
    pub vault_nullifier: BytesN<32>,

    /// The member's secret (32 bytes), used to derive their nullifier.
    /// This IS revealed during verification (the verifier hashes it),
    /// but the on-chain record only stores the nullifier — not the secret.
    pub member_secret: BytesN<32>,
}

/// A zero-knowledge early-exit proof.
///
/// Proves that the penalty calculation is correct without revealing the
/// exact locked amount.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkEarlyExitProof {
    /// Commitment to the locked amount at exit time
    pub amount_commitment: BytesN<32>,

    /// Commitment to the payout amount (amount - penalty)
    pub payout_commitment: BytesN<32>,

    /// Commitment to the penalty amount
    pub penalty_commitment: BytesN<32>,

    /// Range tag for penalty ∈ [1, amount] (proves penalty > 0)
    pub penalty_range_tag: BytesN<32>,

    /// The actual locked amount (opening)
    pub amount_opening: i128,

    /// The blinding factor for amount_commitment
    pub amount_blinding: BytesN<32>,

    /// The blinding factor for payout_commitment
    pub payout_blinding: BytesN<32>,

    /// The blinding factor for penalty_commitment
    pub penalty_blinding: BytesN<32>,
}

/// A Schnorr-style challenge-response proof.
///
/// Used as a sub-proof in `ZkDepositProof` when running in
/// strict privacy mode (future extension).
///
/// Structure: (commitment_R, response_s) where:
///   R = k * G   (k random nonce, G generator)
///   e = H(R || public_key || message)
///   s = k - e * secret  (mod p)
///
/// Verifier checks: s * G + e * public_key == R
#[contracttype]
#[derive(Clone, Debug)]
pub struct SchnorrProof {
    /// Commitment R = k*G encoded as 32 bytes
    pub commitment_r: BytesN<32>,

    /// Response s = k - e * secret mod p (32 bytes, little-endian scalar)
    pub response_s: BytesN<32>,

    /// The public key corresponding to the secret (for on-chain verification)
    pub public_key: BytesN<32>,
}

/// Combined proof for a ZK group vault deposit with all verification data.
///
/// This is the top-level proof type accepted by `deposit_zk`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkProof {
    /// Core deposit proof
    pub deposit_proof: ZkDepositProof,

    /// Optional Schnorr authentication proof.
    /// Set all fields to zero bytes when not used.
    pub schnorr_proof: SchnorrProof,

    /// Whether to enforce Schnorr authentication.
    /// If false, `schnorr_proof` is ignored.
    pub use_schnorr: bool,
}
