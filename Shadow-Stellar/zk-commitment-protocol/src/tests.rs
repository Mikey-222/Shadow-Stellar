//! Unit tests for the ZK Commitment Protocol.
//!
//! Tests cover:
//!   - Initialization guard
//!   - Successful ZK deposit and withdrawal round-trip
//!   - Replay protection (nullifier reuse rejected)
//!   - Invalid proof rejection (bad commitment, bad range, bad nullifier)
//!   - Unsupported token rejection
//!   - Amount mismatch rejection on withdrawal
//!   - Double-withdrawal prevention
//!   - Standalone range proof verification
//!   - Depositor index completeness
//!   - UltraHONK deposit/withdraw with mock verifier
//!   - UltraHONK verifier-not-set error

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Bytes, BytesN, Env,
};
use crate::{
    ZkContract, ZkContractClient, ZkError,
    ZkDepositProof, ZkWithdrawProof, ZkRangeProof,
    UltraHonkDepositProof, UltraHonkWithdrawProof,
    zk_crypto::{
        commit, range_tag, h2,
        to_bytes32, from_bytes32, DOMAIN_NULLIFIER,
    },
};

// ── Mock verifier contracts ────────────────────────────────────────────────────
// Each mock is in its own module to avoid #[contract] + #[contractimpl] type
// conflicts in Soroban SDK 22.

mod mock_verifier_mod {
    use soroban_sdk::{contract, contractimpl, Env, Bytes};

    #[contract]
    pub struct MockVerifier;

    #[contractimpl]
    impl MockVerifier {
        pub fn __constructor() {}
        pub fn verify(_env: Env, _proof_bytes: Bytes, _public_inputs: Bytes) -> bool {
            true
        }
        pub fn vk_bytes(_env: Env) -> Bytes {
            Bytes::new(&Env::default())
        }
    }
}

use mock_verifier_mod::MockVerifier;

// ── Test helpers ──────────────────────────────────────────────────────────────

/// Deploy the ZK contract and return (env, client, token_address, token_admin_client).
fn setup() -> (Env, ZkContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 26,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 10_000_000,
    });

    let contract_id = env.register(ZkContract, ());
    let client = ZkContractClient::new(&env, &contract_id);

    // Create a mock XLM SAC token
    let token_admin = Address::generate(&env);
    let xlm_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let usdc_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let eurc_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    let owner = Address::generate(&env);
    client.initialize(&owner, &xlm_id, &usdc_id, &eurc_id, &None);

    (env, client, xlm_id, token_admin)
}

/// Deploy with a mock UltraHONK verifier.
fn setup_with_verifier() -> (Env, ZkContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 26,
        sequence_number: 100,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 1,
        min_persistent_entry_ttl: 1,
        max_entry_ttl: 10_000_000,
    });

    let verifier_id = env.register(MockVerifier, ());

    let contract_id = env.register(ZkContract, ());
    let client = ZkContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let xlm_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let usdc_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();
    let eurc_id = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    let owner = Address::generate(&env);
    client.initialize(&owner, &xlm_id, &usdc_id, &eurc_id, &Some(verifier_id));

    (env, client, xlm_id, token_admin)
}

/// Make an UltraHonkDepositProof with a fixed commitment (mock proof bytes).
fn make_ultrahonk_deposit_proof(env: &Env, amount: i128, commitment: BytesN<32>) -> UltraHonkDepositProof {
    UltraHonkDepositProof {
        commitment,
        proof_bytes: Bytes::from_array(env, &[0xabu8; 128]),
        public_inputs: Bytes::from_array(env, &[0xbbu8; 32]),
        amount,
    }
}

/// Make an UltraHonkWithdrawProof.
fn make_ultrahonk_withdraw_proof(env: &Env, amount: i128) -> UltraHonkWithdrawProof {
    UltraHonkWithdrawProof {
        proof_bytes: Bytes::from_array(env, &[0xabu8; 128]),
        public_inputs: Bytes::from_array(env, &[0xbbu8; 32]),
        amount,
        nullifier: BytesN::from_array(env, &[0u8; 32]),
    }
}

// ── Hash-based ZK proof helpers ────────────────────────────────────────────────

/// Make a ZkDepositProof: generates blinding factor, computes commitment,
/// nullifier (from commitment, not r), and range tag.
fn make_deposit_proof(env: &Env, amount: i128, entry_id: u64) -> (ZkDepositProof, [u8; 32]) {
    let r = [entry_id as u8 + 0x42; 32];
    let c = commit(env, amount, &r);
    // nullifier = SHA-256(DOMAIN_NULLIFIER || entry_id || commitment)
    let id_bytes = entry_id.to_le_bytes();
    let n = h2(env, DOMAIN_NULLIFIER, &id_bytes, &c);
    let rt = range_tag(env, &c, amount, 1, amount);
    let proof = ZkDepositProof {
        commitment: to_bytes32(env, &c),
        range_tag:  to_bytes32(env, &rt),
        nullifier:  to_bytes32(env, &n),
        amount,
    };
    (proof, r)
}

/// Make a ZkWithdrawProof from the stored blinding factor.
fn make_withdraw_proof(env: &Env, amount: i128, r: &[u8; 32], nullifier: &[u8; 32]) -> ZkWithdrawProof {
    ZkWithdrawProof {
        nullifier:  to_bytes32(env, nullifier),
        blinding_r: to_bytes32(env, r),
        amount,
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_once() {
    let (env, client, xlm, usdc) = setup();
    let eurc = Address::generate(&env);
    let owner = Address::generate(&env);
    // Second call must fail
    let result = client.try_initialize(&owner, &xlm, &usdc, &eurc, &None);
    assert_eq!(result, Err(Ok(ZkError::AlreadyInitialized)));
}

#[test]
fn test_deposit_and_withdraw_roundtrip() {
    let (env, client, token, token_admin) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000; // 1 XLM (7 decimals)

    // Fund user
    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));
    let user_before = TokenClient::new(&env, &token).balance(&user);
    assert_eq!(user_before, amount * 2);

    // Get next entry id
    let entry_id = client.get_next_entry_id();
    let (proof, r) = make_deposit_proof(&env, amount, entry_id);
    let nullifier_bytes = from_bytes32(&proof.nullifier);

    // Deposit
    let eid = client.zk_deposit(&user, &token, &proof);
    assert_eq!(eid, entry_id);

    // Commitment stored, amount locked
    let entry = client.get_entry_fn(&eid);
    assert!(!entry.withdrawn);
    assert_eq!(entry.amount, amount);

    let balance_after_deposit = TokenClient::new(&env, &token).balance(&user);
    assert_eq!(balance_after_deposit, amount); // 1 XLM spent

    // Withdraw
    let wd_proof = make_withdraw_proof(&env, amount, &r, &nullifier_bytes);
    client.zk_withdraw(&user, &eid, &token, &wd_proof);

    let balance_after_withdraw = TokenClient::new(&env, &token).balance(&user);
    assert_eq!(balance_after_withdraw, amount * 2); // fully recovered

    let entry = client.get_entry_fn(&eid);
    assert!(entry.withdrawn);
}

#[test]
fn test_nullifier_replay_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 500_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 5));

    let entry_id = client.get_next_entry_id();
    let (proof, _r) = make_deposit_proof(&env, amount, entry_id);

    // First deposit succeeds
    client.zk_deposit(&user, &token, &proof);

    // Second deposit with same nullifier must fail
    let r2 = [0xabu8; 32];
    let c2 = commit(&env, amount, &r2);
    let rt2 = range_tag(&env, &c2, amount, 1, amount);
    let replay = ZkDepositProof {
        commitment: to_bytes32(&env, &c2),
        range_tag:  to_bytes32(&env, &rt2),
        nullifier:  proof.nullifier.clone(),
        amount,
    };
    let result = client.try_zk_deposit(&user, &token, &replay);
    assert_eq!(result, Err(Ok(ZkError::NullifierSpent)));
}

#[test]
fn test_invalid_commitment_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 100_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (mut proof, _r) = make_deposit_proof(&env, amount, entry_id);

    let mut bad_c = from_bytes32(&proof.commitment);
    bad_c[0] ^= 0xFF;
    proof.commitment = to_bytes32(&env, &bad_c);

    let result = client.try_zk_deposit(&user, &token, &proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidDepositProof)));
}

#[test]
fn test_invalid_range_tag_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 100_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (mut proof, _r) = make_deposit_proof(&env, amount, entry_id);

    let mut bad_rt = from_bytes32(&proof.range_tag);
    bad_rt[15] ^= 0xAB;
    proof.range_tag = to_bytes32(&env, &bad_rt);

    let result = client.try_zk_deposit(&user, &token, &proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidDepositProof)));
}

#[test]
fn test_unsupported_token_rejected() {
    let (env, client, _token, _) = setup();
    let user = Address::generate(&env);
    let bad_token = Address::generate(&env);
    let amount: i128 = 100_000_000;

    let entry_id = client.get_next_entry_id();
    let (proof, _r) = make_deposit_proof(&env, amount, entry_id);

    let result = client.try_zk_deposit(&user, &bad_token, &proof);
    assert_eq!(result, Err(Ok(ZkError::UnsupportedToken)));
}

#[test]
fn test_zero_amount_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);

    let entry_id = client.get_next_entry_id();
    let r = [0x11u8; 32];
    let c = commit(&env, 0, &r);
    let rt = range_tag(&env, &c, 0, 1, 0);
    let id_bytes = entry_id.to_le_bytes();
    let n = h2(&env, DOMAIN_NULLIFIER, &id_bytes, &c);

    let proof = ZkDepositProof {
        commitment: to_bytes32(&env, &c),
        range_tag:  to_bytes32(&env, &rt),
        nullifier:  to_bytes32(&env, &n),
        amount: 0,
    };

    let result = client.try_zk_deposit(&user, &token, &proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidAmount)));
}

#[test]
fn test_double_withdrawal_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 200_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (proof, r) = make_deposit_proof(&env, amount, entry_id);
    let nullifier_bytes = from_bytes32(&proof.nullifier);
    client.zk_deposit(&user, &token, &proof);

    let wd_proof = make_withdraw_proof(&env, amount, &r, &nullifier_bytes);
    client.zk_withdraw(&user, &entry_id, &token, &wd_proof);

    let wd_proof2 = make_withdraw_proof(&env, amount, &r, &nullifier_bytes);
    let result = client.try_zk_withdraw(&user, &entry_id, &token, &wd_proof2);
    assert_eq!(result, Err(Ok(ZkError::AlreadyWithdrawn)));
}

#[test]
fn test_wrong_blinding_withdrawal_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 300_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (proof, _r) = make_deposit_proof(&env, amount, entry_id);
    let nullifier_bytes = from_bytes32(&proof.nullifier);
    client.zk_deposit(&user, &token, &proof);

    let wrong_r = [0xDDu8; 32];
    let wd_proof = make_withdraw_proof(&env, amount, &wrong_r, &nullifier_bytes);
    let result = client.try_zk_withdraw(&user, &entry_id, &token, &wd_proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidWithdrawProof)));
}

#[test]
fn test_amount_mismatch_withdrawal_rejected() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 400_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (proof, r) = make_deposit_proof(&env, amount, entry_id);
    let nullifier_bytes = from_bytes32(&proof.nullifier);
    client.zk_deposit(&user, &token, &proof);

    let wd_proof = make_withdraw_proof(&env, amount + 1, &r, &nullifier_bytes);
    let result = client.try_zk_withdraw(&user, &entry_id, &token, &wd_proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidWithdrawProof)));
}

#[test]
fn test_depositor_index_tracks_entries() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 100_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 10));

    for i in 0..3u64 {
        let entry_id = client.get_next_entry_id();
        assert_eq!(entry_id, i);
        let r = [i as u8 + 1; 32];
        let c = commit(&env, amount, &r);
        let rt = range_tag(&env, &c, amount, 1, amount);
        let id_bytes = entry_id.to_le_bytes();
        let n = h2(&env, DOMAIN_NULLIFIER, &id_bytes, &c);
        let proof = ZkDepositProof {
            commitment: to_bytes32(&env, &c),
            range_tag:  to_bytes32(&env, &rt),
            nullifier:  to_bytes32(&env, &n),
            amount,
        };
        client.zk_deposit(&user, &token, &proof);
    }

    let ids = client.get_entries_by_depositor(&user);
    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0), Some(0));
    assert_eq!(ids.get(1), Some(1));
    assert_eq!(ids.get(2), Some(2));
}

#[test]
fn test_nullifier_spent_query() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 100_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id = client.get_next_entry_id();
    let (proof, _r) = make_deposit_proof(&env, amount, entry_id);
    let nullifier = proof.nullifier.clone();

    assert!(!client.is_nullifier_spent_fn(&nullifier));
    client.zk_deposit(&user, &token, &proof);
    assert!(client.is_nullifier_spent_fn(&nullifier));
}

#[test]
fn test_standalone_range_proof_valid() {
    let (env, client, _token, _) = setup();
    let amount: i128 = 500_000_000;
    let r = [0x77u8; 32];
    let c = commit(&env, amount, &r);
    let rt = range_tag(&env, &c, amount, 1, 1_000_000_000);

    let proof = ZkRangeProof {
        commitment: to_bytes32(&env, &c),
        range_tag:  to_bytes32(&env, &rt),
        value: amount,
        min_value: 1,
        max_value: 1_000_000_000,
        blinding_r: to_bytes32(&env, &r),
    };
    assert!(client.verify_range_proof(&proof));
}

#[test]
fn test_standalone_range_proof_out_of_range_fails() {
    let (env, client, _token, _) = setup();
    let amount: i128 = 500_000_000;
    let r = [0x77u8; 32];
    let c = commit(&env, amount, &r);
    let rt = range_tag(&env, &c, amount, 1, 100_000_000);

    let proof = ZkRangeProof {
        commitment: to_bytes32(&env, &c),
        range_tag:  to_bytes32(&env, &rt),
        value: amount,
        min_value: 1,
        max_value: 100_000_000,
        blinding_r: to_bytes32(&env, &r),
    };
    assert!(!client.verify_range_proof(&proof));
}

#[test]
fn test_entry_not_found() {
    let (env, client, _, _) = setup();
    let result = client.try_get_entry_fn(&999u64);
    assert!(result.is_err());
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── UltraHONK Tests ───────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_ultrahonk_verifier_not_set() {
    let (env, client, token, _) = setup();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000;
    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let proof = make_ultrahonk_deposit_proof(&env, amount, BytesN::from_array(&env, &[0u8; 32]));
    let result = client.try_zk_deposit_ultrahonk(&user, &token, &proof);
    assert_eq!(result, Err(Ok(ZkError::VerifierNotSet)));
}

#[test]
fn test_ultrahonk_deposit_with_mock_verifier() {
    let (env, client, token, _) = setup_with_verifier();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let entry_id_before = client.get_next_entry_id();
    let commitment = to_bytes32(&env, &commit(&env, amount, &[0x42u8; 32]));
    let proof = make_ultrahonk_deposit_proof(&env, amount, commitment);

    let eid = client.zk_deposit_ultrahonk(&user, &token, &proof);
    assert_eq!(eid, entry_id_before);

    let entry = client.get_entry_fn(&eid);
    assert!(!entry.withdrawn);
    assert_eq!(entry.amount, amount);

    let balance = TokenClient::new(&env, &token).balance(&user);
    assert_eq!(balance, amount);
}

#[test]
fn test_ultrahonk_deposit_zero_amount_rejected() {
    let (env, client, token, _) = setup_with_verifier();
    let user = Address::generate(&env);

    let proof = make_ultrahonk_deposit_proof(&env, 0, BytesN::from_array(&env, &[0u8; 32]));
    let result = client.try_zk_deposit_ultrahonk(&user, &token, &proof);
    assert_eq!(result, Err(Ok(ZkError::InvalidAmount)));
}

#[test]
fn test_ultrahonk_deposit_unsupported_token_rejected() {
    let (env, client, _token, _) = setup_with_verifier();
    let user = Address::generate(&env);
    let bad_token = Address::generate(&env);

    let proof = make_ultrahonk_deposit_proof(&env, 100_000_000, BytesN::from_array(&env, &[0u8; 32]));
    let result = client.try_zk_deposit_ultrahonk(&user, &bad_token, &proof);
    assert_eq!(result, Err(Ok(ZkError::UnsupportedToken)));
}

#[test]
fn test_ultrahonk_withdraw_roundtrip() {
    let (env, client, token, _) = setup_with_verifier();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let commitment = to_bytes32(&env, &commit(&env, amount, &[0x42u8; 32]));
    let dep_proof = make_ultrahonk_deposit_proof(&env, amount, commitment);
    let eid = client.zk_deposit_ultrahonk(&user, &token, &dep_proof);

    let wd_proof = make_ultrahonk_withdraw_proof(&env, amount);
    client.zk_withdraw_ultrahonk(&user, &eid, &token, &wd_proof);

    let entry = client.get_entry_fn(&eid);
    assert!(entry.withdrawn);

    let balance = TokenClient::new(&env, &token).balance(&user);
    assert_eq!(balance, amount * 2);
}

#[test]
fn test_ultrahonk_withdraw_already_withdrawn_rejected() {
    let (env, client, token, _) = setup_with_verifier();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let commitment = to_bytes32(&env, &commit(&env, amount, &[0x42u8; 32]));
    let dep_proof = make_ultrahonk_deposit_proof(&env, amount, commitment);
    let eid = client.zk_deposit_ultrahonk(&user, &token, &dep_proof);

    let wd_proof = make_ultrahonk_withdraw_proof(&env, amount);
    client.zk_withdraw_ultrahonk(&user, &eid, &token, &wd_proof);

    let result = client.try_zk_withdraw_ultrahonk(&user, &eid, &token, &wd_proof);
    assert_eq!(result, Err(Ok(ZkError::AlreadyWithdrawn)));
}

#[test]
fn test_ultrahonk_withdraw_wrong_amount_rejected() {
    let (env, client, token, _) = setup_with_verifier();
    let user = Address::generate(&env);
    let amount: i128 = 1_000_000_000;

    StellarAssetClient::new(&env, &token).mint(&user, &(amount * 2));

    let commitment = to_bytes32(&env, &commit(&env, amount, &[0x42u8; 32]));
    let dep_proof = make_ultrahonk_deposit_proof(&env, amount, commitment);
    let eid = client.zk_deposit_ultrahonk(&user, &token, &dep_proof);

    let wd_proof = make_ultrahonk_withdraw_proof(&env, amount + 1);
    let result = client.try_zk_withdraw_ultrahonk(&user, &eid, &token, &wd_proof);
    assert_eq!(result, Err(Ok(ZkError::AmountMismatch)));
}

#[test]
fn test_ultrahonk_entry_not_found() {
    let (env, client, _, _) = setup_with_verifier();
    let user = Address::generate(&env);

    let wd_proof = make_ultrahonk_withdraw_proof(&env, 100_000_000);
    let result = client.try_zk_withdraw_ultrahonk(&user, &999u64, &Address::generate(&env), &wd_proof);
    assert_eq!(result, Err(Ok(ZkError::EntryNotFound)));
}
