//! # Shadow-Stellar ZK Module
//!
//! Zero-knowledge proof primitives for the Collective Commitment Protocol.
//!
//! ## Architecture
//!
//! ```text
//!  ┌─────────────────────────────────────────────────────────────────┐
//!  │                    Shadow-Stellar ZK Layer                      │
//!  │                                                                 │
//!  │  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌───────────┐  │
//!  │  │ field.rs │  │ pedersen.rs  │  │ proof.rs │  │verifier.rs│  │
//!  │  │          │  │              │  │          │  │           │  │
//!  │  │ Fp arith │  │ Commitments  │  │ Proof    │  │ On-chain  │  │
//!  │  │ over Ed  │  │ Nullifiers   │  │ structs  │  │ verify    │  │
//!  │  │ 25519 ℓ  │  │ Range tags   │  │ (#[ct])  │  │ functions │  │
//!  │  └──────────┘  └──────────────┘  └──────────┘  └───────────┘  │
//!  └─────────────────────────────────────────────────────────────────┘
//! ```
//!
//! ## How ZK Integrates With CCP
//!
//! ### Standard Deposit (existing flow — unchanged)
//! ```text
//! member calls deposit(caller, vault_id)
//!   → contract checks MemberState::Committed
//!   → transfers obligation amount on-chain (public)
//!   → stores MemberRecord with plaintext amount
//! ```
//!
//! ### ZK Deposit (new flow)
//! ```text
//! member calls deposit_zk(caller, vault_id, proof: ZkProof)
//!   → verifier checks proof.deposit_proof (commitment, range, nullifier)
//!   → contract checks nullifier not already used
//!   → stores ZkMemberRecord { commitment, nullifier } (no plaintext amount)
//!   → transfers obligation amount (still on-chain, but the amount was
//!     privately committed before the call)
//! ```
//!
//! ### ZK Group Vault (privacy mode)
//! ```text
//! creator calls create_group_vault_zk(... member_commitments: Vec<BytesN<32>>)
//!   → stores commitments instead of plaintext addresses
//!   → members prove membership via ZkMembershipProof
//! ```
//!
//! ## Off-Chain Prover Workflow
//!
//! 1. Pick random `r ∈ [0, 2^256)` (blinding factor)
//! 2. Compute `commitment = amount * G + r * H`  (BN254 Pedersen, compress x)
//! 3. Compute `range_tag = SHA-256(DOMAIN_RANGE || commitment || amount || max)`
//! 4. Compute `nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id_le || r)`
//! 5. Pack into `ZkDepositProof` and submit to `deposit_zk`
//!
//! ## Nullifier Storage
//!
//! Used nullifiers are stored in contract persistent storage under
//! `DataKey::ZkNullifier(nullifier_bytes)`.  The verifier checks this
//! before accepting any proof.

pub mod field;
pub mod pedersen;
pub mod proof;
pub mod verifier;

// Re-export most-used types for ergonomic use in lib.rs
pub use pedersen::{
    commit, verify_commitment, verify_range_tag,
    compute_range_tag, sha256_domain2, sha256_domain,
    bytes32_to_soroban, soroban_to_bytes32,
    DOMAIN_NULLIFIER, DOMAIN_RANGE,
};
pub use proof::{ZkDepositProof, ZkEarlyExitProof, ZkProof, ZkWithdrawProof};
pub use verifier::{
    verify_deposit_proof, verify_early_exit_proof,
    verify_withdraw_proof, verify_ultrahonk,
};
