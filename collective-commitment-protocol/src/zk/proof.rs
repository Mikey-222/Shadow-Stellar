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
/// 1. `range_tag` is a valid range witness for `amount ∈ [1, obligation]`
///    using the slot's declared obligation (the amount is COMMITTED, not revealed)
/// 2. `nullifier` is freshly derived and not yet used
///
/// The blinding factor `r` is NOT submitted at deposit time — it is kept secret
/// and revealed only during withdrawal to prove ownership (see ZkWithdrawProof).
/// This gives deposit-time hiding of the commitment preimage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkDepositProof {
    /// Pedersen commitment to the deposit amount: C = H(amount || r)
    pub commitment: BytesN<32>,

    /// Range tag proving amount ∈ [1, obligation]: H(RANGE || commitment || amount || max)
    /// The verifier re-derives this using the slot's obligation as both amount and max.
    pub range_tag: BytesN<32>,

    /// Nullifier: H(NULLIFIER || vault_id || r) — prevents replay
    pub nullifier: BytesN<32>,
}

/// A zero-knowledge withdrawal proof.
///
/// Proves ownership of a deposit by revealing the blinding factor `r`.
/// The contract re-derives the commitment and checks it matches the stored value.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkWithdrawProof {
    /// The blinding factor used at deposit time — reveals ownership
    pub blinding_r: BytesN<32>,
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
}
