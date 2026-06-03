//! # On-Chain ZK Proof Verifier
//!
//! All verification is pure (no storage writes). The calling contract
//! function decides what to do with the bool result.

use soroban_sdk::Env;
use crate::zk_crypto::{
    from_bytes32, verify_commit, verify_nullifier, verify_range_tag,
};
use crate::zk_types::{ZkDepositProof, ZkRangeProof, ZkWithdrawProof};

/// Verify a ZkDepositProof.
///
/// Checks:
///   1. commitment opens to `amount` with `blinding_r`
///   2. `amount ∈ [1, max_amount]` with matching range_tag
///   3. nullifier derives from (entry_id_hint=0 uses vault_id) × blinding_r
///      — here we use vault_id as the domain binder
pub fn verify_deposit(
    env: &Env,
    proof: &ZkDepositProof,
    vault_id: u64,
    max_amount: i128,
) -> bool {
    let c = from_bytes32(&proof.commitment);
    let r = from_bytes32(&proof.blinding_r);
    let n = from_bytes32(&proof.nullifier);
    let rt = from_bytes32(&proof.range_tag);

    // 1. Commitment binding
    if !verify_commit(env, &c, proof.amount, &r) {
        return false;
    }

    // 2. Range: amount ∈ [1, max_amount]
    if !verify_range_tag(env, &c, proof.amount, 1, max_amount, &rt) {
        return false;
    }

    // 3. Nullifier correctness
    if !verify_nullifier(env, vault_id, &r, &n) {
        return false;
    }

    true
}

/// Verify a ZkWithdrawProof.
///
/// Proves the caller knows the blinding_r that produced the stored commitment.
/// We re-derive the commitment from (stored_amount, blinding_r) and check it
/// matches the stored commitment.
pub fn verify_withdraw(
    env: &Env,
    proof: &ZkWithdrawProof,
    stored_commitment: &[u8; 32],
    stored_nullifier: &[u8; 32],
) -> bool {
    let r = from_bytes32(&proof.blinding_r);
    let supplied_nullifier = from_bytes32(&proof.nullifier);

    // 1. Commitment opening: H(amount || r) == stored_commitment
    if !verify_commit(env, stored_commitment, proof.amount, &r) {
        return false;
    }

    // 2. Nullifier matches stored nullifier
    use crate::zk_crypto::ct_eq;
    if !ct_eq(&supplied_nullifier, stored_nullifier) {
        return false;
    }

    true
}

/// Verify a ZkRangeProof.
///
/// Proves value ∈ [min_value, max_value] via a hash-based range tag.
pub fn verify_range(env: &Env, proof: &ZkRangeProof) -> bool {
    let c = from_bytes32(&proof.commitment);
    let r = from_bytes32(&proof.blinding_r);
    let rt = from_bytes32(&proof.range_tag);

    // 1. Commitment opens to value
    if !verify_commit(env, &c, proof.value, &r) {
        return false;
    }

    // 2. Range tag is valid
    if !verify_range_tag(env, &c, proof.value, proof.min_value, proof.max_value, &rt) {
        return false;
    }

    true
}
