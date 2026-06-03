//! ZK proof structs and enums — all are #[contracttype] for on-chain use.

use soroban_sdk::{contracttype, contracterror, BytesN};

/// Pedersen-style commitment: SHA-256(DOMAIN || amount_le || blinding_r)
pub type Commitment = BytesN<32>;

/// 32-byte blinding factor / member secret.
pub type Blinding = BytesN<32>;

// ── Commitment scheme state ───────────────────────────────────────────────────

/// A single committed vault entry.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ZkVaultEntry {
    /// On-chain commitment to the locked amount.
    pub commitment: Commitment,
    /// Amount revealed during proof verification and stored for withdrawal.
    pub amount: i128,
    /// Vault-scoped nullifier — prevents replay.
    pub nullifier: BytesN<32>,
    /// Whether this entry has been withdrawn.
    pub withdrawn: bool,
}

/// A zero-knowledge deposit proof.
///
/// Proves:
///   1. `commitment = H(DOMAIN_COMMIT || amount || blinding_r)`  (opening)
///   2. `range_tag  = H(DOMAIN_RANGE  || commitment || amount || max)` (range)
///   3. `nullifier  = H(DOMAIN_NULL   || vault_id   || blinding_r)`  (anti-replay)
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkDepositProof {
    /// Commitment to the deposit amount.
    pub commitment: Commitment,
    /// Range witness: amount ∈ [1, max_amount].
    pub range_tag: BytesN<32>,
    /// Vault-scoped nullifier.
    pub nullifier: BytesN<32>,
    /// Plaintext amount (verified on-chain then only the commitment is stored).
    pub amount: i128,
    /// Blinding factor used to create `commitment`.
    pub blinding_r: Blinding,
}

/// A zero-knowledge withdrawal proof.
///
/// Proves knowledge of the blinding factor used to create the stored commitment.
/// The verifier re-derives the commitment and matches it to the stored one.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkWithdrawProof {
    /// The nullifier that was stored at deposit time.
    pub nullifier: BytesN<32>,
    /// Blinding factor — proves knowledge of the commitment preimage.
    pub blinding_r: Blinding,
    /// The amount to withdraw (must match stored amount under commitment).
    pub amount: i128,
}

/// A zero-knowledge range proof for private obligations.
///
/// Proves amount ∈ [min, max] without revealing the exact amount,
/// using a hash-based range witness.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkRangeProof {
    /// Commitment to the value.
    pub commitment: Commitment,
    /// Range witness tag.
    pub range_tag: BytesN<32>,
    /// Plaintext value (revealed for on-chain arithmetic).
    pub value: i128,
    /// Minimum bound.
    pub min_value: i128,
    /// Maximum bound.
    pub max_value: i128,
    /// Blinding factor.
    pub blinding_r: Blinding,
}

/// Error codes specific to the ZK contract.
#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum ZkError {
    /// Contract already initialized.
    AlreadyInitialized   = 1,
    /// Contract not yet initialized.
    NotInitialized       = 2,
    /// Token is not in the supported list.
    UnsupportedToken     = 3,
    /// Vault entry not found.
    EntryNotFound        = 4,
    /// Vault entry already withdrawn.
    AlreadyWithdrawn     = 5,
    /// The ZK deposit proof is invalid.
    InvalidDepositProof  = 10,
    /// The ZK withdrawal proof is invalid.
    InvalidWithdrawProof = 11,
    /// The ZK range proof is invalid.
    InvalidRangeProof    = 12,
    /// Nullifier already used (replay attack).
    NullifierSpent       = 13,
    /// Amount in proof does not match stored entry.
    AmountMismatch       = 14,
    /// Amount must be > 0.
    InvalidAmount        = 15,
}
