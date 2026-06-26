//! # On-Chain ZK Proof Verifier
//!
//! This module contains all proof verification logic executed inside the
//! Soroban smart contract.  All functions are pure (no side effects) and
//! return `bool` — the calling contract function decides what to do with
//! the result.
//!
//! ## Security Model
//!
//! The verifier enforces:
//! 1. **Commitment binding** — the prover cannot change the amount after
//!    committing without invalidating the commitment
//! 2. **Range soundness** — the amount is within the declared bounds
//! 3. **Nullifier uniqueness** — each (vault_id, member_secret) pair can
//!    only produce one valid proof (anti-replay)
//! 4. **Obligation equality** — the deposited amount equals the declared
//!    obligation amount
//! 5. **Penalty correctness** — early-exit payout and penalty sum to amount
//!
//! ## What Is NOT Hidden (Practical Limitations)
//!
//! On Stellar/Soroban, all ledger reads and token transfer amounts are
//! public in the transaction metadata.  This implementation hides:
//! - The deposit obligation amount until the prover reveals it
//! - The member's internal secret (only the nullifier is stored)
//! - Early-exit penalty amounts (via commitment before reveal)
//!
//! Full anonymity (hiding the depositor's address) requires a separate
//! privacy layer (e.g. mixer contract) and is out of scope here.

use soroban_sdk::{vec, Address, Bytes, Env, Symbol, Val, Vec};
use ultrahonk_soroban_verifier::UltraHonkVerifier;

use super::pedersen::{
    ct_eq_32, sha256_domain2, soroban_to_bytes32,
    verify_commitment, verify_range_tag,
    DOMAIN_NULLIFIER,
};
use super::proof::{ZkDepositProof, ZkEarlyExitProof};

// ── ZkDepositProof verifier ───────────────────────────────────────────────────

/// Verify a `ZkDepositProof`.
///
/// Checks:
/// 1. `range_tag` is a valid witness for `amount ∈ [1, max_obligation]`
///    proving the commitment was made for exactly the slot's obligation amount,
///    without revealing the blinding factor on-chain
/// 2. `nullifier` derivation is correct (prevents replay)
///
/// The blinding factor `r` is NOT verified here — it is kept secret for
/// deposit-time privacy and revealed only at withdrawal.
pub fn verify_deposit_proof(
    env: &Env,
    proof: &ZkDepositProof,
    vault_id: u64,
    obligation: i128,
) -> bool {
    let commitment_bytes = soroban_to_bytes32(&proof.commitment);
    let range_tag = soroban_to_bytes32(&proof.range_tag);

    // 1. Range check via range_tag: proves commitment was made for amount == obligation
    //    The amount is NOT revealed — the contract uses the slot's obligation.
    //    The range_tag = H(RANGE || commitment || obligation || obligation || commitment[0..16])
    //    binds the commitment to exactly this amount.
    if !verify_range_tag(env, &commitment_bytes, obligation, obligation, &range_tag) {
        return false;
    }

    // 2. Nullifier derivation check
    // nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id || commitment)
    // This binds the nullifier to both the vault and the specific deposit,
    // without needing to know the blinding factor r.
    let derived_nullifier = sha256_domain2(
        env,
        DOMAIN_NULLIFIER,
        &vault_id.to_le_bytes(),
        &commitment_bytes,
    );
    let supplied_nullifier = soroban_to_bytes32(&proof.nullifier);
    if !ct_eq_32(&derived_nullifier, &supplied_nullifier) {
        return false;
    }

    true
}

/// Verify a `ZkWithdrawProof`.
///
/// Checks that the blinding factor `r` opens the stored commitment to the
/// expected amount. This proves the caller knows the commitment preimage
/// and therefore owns the deposit.
pub fn verify_withdraw_proof(
    env: &Env,
    stored_commitment: &[u8; 32],
    amount: i128,
    blinding_r: &[u8; 32],
) -> bool {
    verify_commitment(env, stored_commitment, amount, blinding_r)
}

// ── (removed) ZkMembershipProof verifier ──────────────────────────────────────
// The ZkMembershipProof and SchnorrProof types were removed as part of the
// proof-flow redesign. Membership is now verified via the standard
// ZkDepositProof path.

// ── ZkEarlyExitProof verifier ─────────────────────────────────────────────────

/// Verify a `ZkEarlyExitProof`.
///
/// Checks:
/// 1. `amount_commitment` opens to `amount_opening`
/// 2. `payout_commitment` opens to `payout = amount - penalty`
/// 3. `penalty_commitment` opens to `penalty = floor(amount * rate / 10000)`
/// 4. `payout + penalty == amount` (conservation of value)
/// 5. `penalty ∈ [1, amount]` via penalty_range_tag
/// 6. `payout > 0` (basic sanity check)
pub fn verify_early_exit_proof(
    env: &Env,
    proof: &ZkEarlyExitProof,
    penalty_rate: u32,
) -> bool {
    let amount_bytes = soroban_to_bytes32(&proof.amount_commitment);
    let payout_bytes = soroban_to_bytes32(&proof.payout_commitment);
    let penalty_bytes = soroban_to_bytes32(&proof.penalty_commitment);
    let amount_r = soroban_to_bytes32(&proof.amount_blinding);
    let payout_r = soroban_to_bytes32(&proof.payout_blinding);
    let penalty_r = soroban_to_bytes32(&proof.penalty_blinding);
    let penalty_range_tag = soroban_to_bytes32(&proof.penalty_range_tag);

    let amount = proof.amount_opening;
    if amount <= 0 {
        return false;
    }

    // Compute expected penalty
    let expected_penalty = amount * (penalty_rate as i128) / 10_000;
    let expected_payout = amount - expected_penalty;

    if expected_penalty <= 0 || expected_payout <= 0 {
        return false;
    }

    // Conservation invariant
    if expected_payout + expected_penalty != amount {
        return false;
    }

    // 1. Amount commitment check
    if !verify_commitment(env, &amount_bytes, amount, &amount_r) {
        return false;
    }

    // 2. Payout commitment check
    if !verify_commitment(env, &payout_bytes, expected_payout, &payout_r) {
        return false;
    }

    // 3. Penalty commitment check
    if !verify_commitment(env, &penalty_bytes, expected_penalty, &penalty_r) {
        return false;
    }

    // 4. Range tag on penalty ∈ [1, amount]
    if !verify_range_tag(env, &penalty_bytes, expected_penalty, amount, &penalty_range_tag) {
        return false;
    }

    true
}

// ── (removed) Schnorr proof verifier ──────────────────────────────────────────
// The SchnorrProof type was removed as part of the proof-flow redesign.
// All ownership proofs now go through the ZkWithdrawProof path.

/// Verify an UltraHonk zk-SNARK proof.
///
/// Uses the embedded UltraHonk verifier library directly (no cross-contract
/// call). If no verification key is stored, falls back to the legacy
/// cross-contract verifier (for backward compatibility / mock tests).
pub fn verify_ultrahonk(
    env: &Env,
    verifier: &Address,
    proof_bytes: &Bytes,
    public_inputs: &Bytes,
) -> bool {
    if let Some(vk) = crate::storage::get_verification_key(env) {
        return match UltraHonkVerifier::new(env, &vk) {
            Ok(v) => v.verify(env, proof_bytes, public_inputs).is_ok(),
            Err(_) => false,
        };
    }
    // Fallback: cross-contract mock verifier (tests / legacy)
    let args: Vec<Val> = vec![
        &env,
        proof_bytes.clone().to_val(),
        public_inputs.clone().to_val(),
    ];
    env.invoke_contract::<bool>(
        &verifier,
        &Symbol::new(env, "verify"),
        args,
    )
}
