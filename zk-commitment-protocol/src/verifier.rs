use soroban_sdk::{vec, Address, Bytes, Env, Symbol, Vec, Val};
use ultrahonk_soroban_verifier::UltraHonkVerifier;
use crate::zk_crypto::{from_bytes32, verify_commit, verify_range_tag, h2, ct_eq, DOMAIN_NULLIFIER};
use crate::zk_types::{ZkDepositProof, ZkRangeProof, ZkWithdrawProof, ZkError};

/// Verify a ZkDepositProof.
///
/// The blinding factor r is NOT verified here — it's kept secret for
/// deposit-time privacy. Only the range tag and nullifier are checked.
pub fn verify_deposit(
    env: &Env,
    proof: &ZkDepositProof,
    vault_id: u64,
    max_amount: i128,
) -> bool {
    let c = from_bytes32(&proof.commitment);
    let n = from_bytes32(&proof.nullifier);
    let rt = from_bytes32(&proof.range_tag);

    // 1. Range check via range_tag: proves commitment was made for amount ∈ [1, max_amount]
    //    without revealing the blinding factor
    if !verify_range_tag(env, &c, proof.amount, 1, max_amount, &rt) {
        return false;
    }

    // 2. Nullifier derivation check
    //    nullifier = SHA-256(DOMAIN_NULLIFIER || vault_id || commitment)
    //    This binds the nullifier to the deposit without needing blinding_r
    let vault_bytes = vault_id.to_le_bytes();
    let expected_nullifier = h2(env, DOMAIN_NULLIFIER, &vault_bytes, &c);
    if !ct_eq(&expected_nullifier, &n) {
        return false;
    }

    true
}

/// Verify a ZkWithdrawProof.
///
/// The caller proves ownership by revealing the blinding factor r and
/// showing it opens the stored commitment to the correct amount.
pub fn verify_withdraw(
    env: &Env,
    proof: &ZkWithdrawProof,
    stored_commitment: &[u8; 32],
    stored_nullifier: &[u8; 32],
) -> bool {
    let r = from_bytes32(&proof.blinding_r);
    let supplied_nullifier = from_bytes32(&proof.nullifier);
    if !verify_commit(env, stored_commitment, proof.amount, &r) {
        return false;
    }
    if !ct_eq(&supplied_nullifier, stored_nullifier) {
        return false;
    }
    true
}

/// Verify a ZkRangeProof.
pub fn verify_range(env: &Env, proof: &ZkRangeProof) -> bool {
    let c = from_bytes32(&proof.commitment);
    let r = from_bytes32(&proof.blinding_r);
    let rt = from_bytes32(&proof.range_tag);
    if !verify_commit(env, &c, proof.value, &r) {
        return false;
    }
    if !verify_range_tag(env, &c, proof.value, proof.min_value, proof.max_value, &rt) {
        return false;
    }
    true
}

/// Verify an UltraHonk zk-SNARK proof.
///
/// Uses the embedded UltraHonk verifier library directly. If no verification
/// key is stored, falls back to cross-contract invocation (legacy / mock tests).
pub fn verify_ultrahonk(
    env: &Env,
    verifier: &Address,
    proof_bytes: &Bytes,
    public_inputs: &Bytes,
) -> Result<bool, ZkError> {
    if let Some(vk) = crate::storage::get_verification_key(env) {
        return Ok(
            match UltraHonkVerifier::new(env, &vk) {
                Ok(v) => v.verify(env, proof_bytes, public_inputs).is_ok(),
                Err(_) => false,
            }
        );
    }
    // Fallback: cross-contract verifier (tests / legacy)
    let args: Vec<Val> = vec![
        &env,
        proof_bytes.clone().to_val(),
        public_inputs.clone().to_val(),
    ];
    let result = env.invoke_contract::<bool>(
        &verifier,
        &Symbol::new(env, "verify"),
        args,
    );
    Ok(result)
}
