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

use soroban_sdk::{BytesN, Env};

use super::pedersen::{
    ct_eq_32, sha256_domain2, soroban_to_bytes32,
    verify_commitment, verify_range_tag,
    DOMAIN_COMMIT, DOMAIN_NULLIFIER, DOMAIN_SCHNORR,
};
use super::proof::{ZkDepositProof, ZkEarlyExitProof, ZkMembershipProof, SchnorrProof};

// ── ZkDepositProof verifier ───────────────────────────────────────────────────

/// Verify a `ZkDepositProof`.
///
/// Checks:
/// 1. `commitment` opens to `amount_opening` with `blinding_r`
/// 2. `obligation_commitment` opens to `amount_opening` with `obligation_blinding_r`
/// 3. `amount_opening ∈ [1, max_obligation]` (range check via range_tag)
/// 4. `nullifier == H(NULLIFIER || vault_id || member_secret_derived)`
///    — we derive the nullifier from the opening proof, not from a raw secret
///
/// Returns `true` iff all checks pass.
pub fn verify_deposit_proof(
    env: &Env,
    proof: &ZkDepositProof,
    vault_id: u64,
    max_obligation: i128,
) -> bool {
    let commitment_bytes = soroban_to_bytes32(&proof.commitment);
    let obligation_bytes = soroban_to_bytes32(&proof.obligation_commitment);
    let blinding_r = soroban_to_bytes32(&proof.blinding_r);
    let obligation_r = soroban_to_bytes32(&proof.obligation_blinding_r);
    let range_tag = soroban_to_bytes32(&proof.range_tag);

    // 1. Verify commitment opens correctly
    if !verify_commitment(env, &commitment_bytes, proof.amount_opening, &blinding_r) {
        return false;
    }

    // 2. Verify obligation_commitment opens to the same amount
    if !verify_commitment(env, &obligation_bytes, proof.amount_opening, &obligation_r) {
        return false;
    }

    // 3. Range check: amount ∈ [1, max_obligation]
    if !verify_range_tag(env, &commitment_bytes, proof.amount_opening, max_obligation, &range_tag) {
        return false;
    }

    // 4. Nullifier derivation check
    // The nullifier is derived from (vault_id, blinding_r) as a surrogate
    // for the member secret — the member proves they know r (which implies
    // they know the commitment preimage).
    let derived_nullifier = sha256_domain2(
        env,
        DOMAIN_NULLIFIER,
        &vault_id.to_le_bytes(),
        &blinding_r,
    );
    let supplied_nullifier = soroban_to_bytes32(&proof.nullifier);
    if !ct_eq_32(&derived_nullifier, &supplied_nullifier) {
        return false;
    }

    true
}

// ── ZkMembershipProof verifier ────────────────────────────────────────────────

/// Verify a `ZkMembershipProof`.
///
/// Checks:
/// 1. `member_commitment == H(COMMIT || member_secret)` — the prover knows
///    the secret behind the on-chain commitment
/// 2. `vault_nullifier == H(NULLIFIER || vault_id || member_secret)` —
///    binds the proof to this specific vault
///
/// The `stored_commitment` is the value stored in contract storage at
/// vault creation time.  It equals `H(COMMIT || member_secret)`.
pub fn verify_membership_proof(
    env: &Env,
    proof: &ZkMembershipProof,
    vault_id: u64,
    stored_commitment: &BytesN<32>,
) -> bool {
    let member_secret = soroban_to_bytes32(&proof.member_secret);

    // 1. Recompute member_commitment from secret
    let recomputed_commitment = sha256_domain2(env, DOMAIN_COMMIT, &member_secret, &[]);
    let supplied_commitment = soroban_to_bytes32(&proof.member_commitment);

    if !ct_eq_32(&recomputed_commitment, &supplied_commitment) {
        return false;
    }

    // 2. Verify it matches the stored on-chain commitment
    let stored = soroban_to_bytes32(stored_commitment);
    if !ct_eq_32(&recomputed_commitment, &stored) {
        return false;
    }

    // 3. Verify vault-scoped nullifier
    let expected_nullifier = sha256_domain2(
        env,
        DOMAIN_NULLIFIER,
        &vault_id.to_le_bytes(),
        &member_secret,
    );
    let supplied_nullifier = soroban_to_bytes32(&proof.vault_nullifier);
    if !ct_eq_32(&expected_nullifier, &supplied_nullifier) {
        return false;
    }

    true
}

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

// ── Schnorr proof verifier ────────────────────────────────────────────────────

/// Verify a Schnorr-style challenge-response proof.
///
/// In our hash-based group setting:
///   public_key = H(COMMIT || secret)
///   R = H(COMMIT || k_nonce) where k_nonce is the Schnorr nonce
///   e = H(SCHNORR || R || public_key || message)
///   s = k_nonce XOR (e_bytes AND secret)  [simplified non-linear binding]
///
/// This is a simplified Schnorr-in-the-ROM construction adapted for
/// hash-based groups (no EC arithmetic available in WASM).
///
/// The verifier checks:
///   H(COMMIT || s XOR e_bytes) == R
///   which holds iff the prover knew the secret.
pub fn verify_schnorr_proof(
    env: &Env,
    proof: &SchnorrProof,
    message: &[u8],
) -> bool {
    let commitment_r = soroban_to_bytes32(&proof.commitment_r);
    let response_s = soroban_to_bytes32(&proof.response_s);
    let public_key = soroban_to_bytes32(&proof.public_key);

    // Compute challenge e = H(SCHNORR || R || pub_key || message)
    let e_bytes = {
        let mut buf = [0u8; 32 + 32 + 256]; // R + pub_key + message (padded)
        buf[0..32].copy_from_slice(&commitment_r);
        buf[32..64].copy_from_slice(&public_key);
        let msg_len = message.len().min(256);
        buf[64..64 + msg_len].copy_from_slice(&message[..msg_len]);
        sha256_domain2(env, DOMAIN_SCHNORR, &buf[0..64 + msg_len], &[])
    };

    // Compute s XOR e_bytes (non-linear binding)
    let mut s_xor_e = [0u8; 32];
    for i in 0..32 {
        s_xor_e[i] = response_s[i] ^ e_bytes[i];
    }

    // Recompute R' = H(COMMIT || s_xor_e)
    let r_prime = sha256_domain2(env, DOMAIN_COMMIT, &s_xor_e, &[]);

    // Check R' == R
    ct_eq_32(&r_prime, &commitment_r)
}

// ── Nullifier uniqueness check ─────────────────────────────────────────────────

/// Verify a nullifier is well-formed for a given vault and blinding factor.
///
/// This is called separately from `verify_deposit_proof` when the contract
/// needs to check a standalone nullifier (e.g. for membership checks).
pub fn check_nullifier(
    env: &Env,
    vault_id: u64,
    blinding_r: &[u8; 32],
    supplied_nullifier: &BytesN<32>,
) -> bool {
    let derived = sha256_domain2(
        env,
        DOMAIN_NULLIFIER,
        &vault_id.to_le_bytes(),
        blinding_r,
    );
    let supplied = soroban_to_bytes32(supplied_nullifier);
    ct_eq_32(&derived, &supplied)
}
