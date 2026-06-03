#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, TryIntoVal,
};

use crate::{
    EarlyWithdrawnEvent, LockType, TreasuryWithdrawnEvent, VaultContract, VaultContractClient,
    VaultCreatedEvent, VaultError, VaultState, WithdrawnEvent,
};

// ─── helpers ────────────────────────────────────────────────────────────────

struct TestSetup {
    env: Env,
    client: VaultContractClient<'static>,
    xlm: Address,
    protocol_owner: Address,
    user1: Address,
    user2: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,
        protocol_version: 22,
        sequence_number: 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 6_312_000,
        min_persistent_entry_ttl: 6_312_000,
        max_entry_ttl: 6_312_000,
    });

    let contract_id = env.register(VaultContract, ());

    let xlm_admin = Address::generate(&env);
    let usdc_admin = Address::generate(&env);
    let eurc_admin = Address::generate(&env);

    let xlm = env.register_stellar_asset_contract_v2(xlm_admin.clone()).address();
    let usdc = env.register_stellar_asset_contract_v2(usdc_admin.clone()).address();
    let eurc = env.register_stellar_asset_contract_v2(eurc_admin.clone()).address();

    let protocol_owner = Address::generate(&env);
    let user1 = Address::generate(&env);
    let user2 = Address::generate(&env);

    let client = VaultContractClient::new(&env, &contract_id);
    client.initialize(&protocol_owner, &xlm, &usdc, &eurc);

    StellarAssetClient::new(&env, &xlm).mint(&user1, &1_000_000);
    StellarAssetClient::new(&env, &xlm).mint(&user2, &1_000_000);

    // SAFETY: standard Soroban test pattern — env outlives the test function
    let env: Env = unsafe { core::mem::transmute(env) };
    let client: VaultContractClient<'static> = unsafe { core::mem::transmute(client) };

    TestSetup { env, client, xlm, protocol_owner, user1, user2 }
}

fn advance_time(env: &Env, delta: u64) {
    let current = env.ledger().timestamp();
    env.ledger().set(LedgerInfo {
        timestamp: current + delta,
        protocol_version: 22,
        sequence_number: env.ledger().sequence() + 1,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 6_312_000,
        min_persistent_entry_ttl: 6_312_000,
        max_entry_ttl: 6_312_000,
    });
}

// ─── create_vault tests ─────────────────────────────────────────────────────

#[test]
fn test_create_vault_strict_success() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    let vault = t.client.get_vault(&vault_id);
    assert_eq!(vault.owner, t.user1);
    assert_eq!(vault.token, t.xlm);
    assert_eq!(vault.amount, 1000);
    assert_eq!(vault.unlock_time, unlock);
    assert_eq!(vault.lock_type, LockType::Strict);
    assert_eq!(vault.penalty_rate, 0);
    assert_eq!(vault.state, VaultState::Active);

    let ids = t.client.get_vaults_by_owner(&t.user1);
    assert!(ids.contains(&vault_id));
}

#[test]
fn test_create_vault_penalty_success() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &2000, &unlock, &LockType::Penalty, &500);

    let vault = t.client.get_vault(&vault_id);
    assert_eq!(vault.lock_type, LockType::Penalty);
    assert_eq!(vault.penalty_rate, 500);
    assert_eq!(vault.state, VaultState::Active);
}

#[test]
fn test_create_vault_invalid_amount() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let err = t
        .client
        .try_create_vault(&t.user1, &t.xlm, &0, &unlock, &LockType::Strict, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::InvalidAmount);
}

#[test]
fn test_create_vault_negative_amount() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let err = t
        .client
        .try_create_vault(&t.user1, &t.xlm, &-1, &unlock, &LockType::Strict, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::InvalidAmount);
}

#[test]
fn test_create_vault_past_unlock_time() {
    let t = setup();
    let now = t.env.ledger().timestamp();

    let err = t
        .client
        .try_create_vault(&t.user1, &t.xlm, &1000, &now, &LockType::Strict, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::InvalidUnlockTime);
}

#[test]
fn test_create_vault_unsupported_token() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;
    let random_token = Address::generate(&t.env);

    let err = t
        .client
        .try_create_vault(&t.user1, &random_token, &1000, &unlock, &LockType::Strict, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::UnsupportedToken);
}

#[test]
fn test_create_vault_penalty_rate_zero() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let err = t
        .client
        .try_create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &0)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::InvalidPenaltyRate);
}

#[test]
fn test_create_vault_penalty_rate_too_high() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let err = t
        .client
        .try_create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &10001)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::InvalidPenaltyRate);
}

// ─── withdraw tests ──────────────────────────────────────────────────────────

#[test]
fn test_withdraw_strict_mature() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    let balance_before = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);

    advance_time(&t.env, 3601);

    t.client.withdraw(&t.user1, &vault_id);

    let balance_after = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);
    assert_eq!(balance_after - balance_before, 1000);

    let vault = t.client.get_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Withdrawn);
}

#[test]
fn test_withdraw_penalty_mature() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);

    let balance_before = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);

    advance_time(&t.env, 3601);

    t.client.withdraw(&t.user1, &vault_id);

    let balance_after = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);
    assert_eq!(balance_after - balance_before, 1000);
}

#[test]
fn test_withdraw_penalty_early() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    // amount=1000, rate=500 (5%) → penalty=50, payout=950
    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);

    let balance_before = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);

    t.client.withdraw(&t.user1, &vault_id);

    let balance_after = TokenClient::new(&t.env, &t.xlm).balance(&t.user1);
    assert_eq!(balance_after - balance_before, 950);
    assert_eq!(t.client.get_treasury_balance(&t.xlm), 50);

    let vault = t.client.get_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Withdrawn);
}

#[test]
fn test_withdraw_strict_early() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    let err = t.client.try_withdraw(&t.user1, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, VaultError::EarlyExitNotAllowed);

    let vault = t.client.get_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Active);
}

#[test]
fn test_withdraw_non_owner() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    let err = t.client.try_withdraw(&t.user2, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, VaultError::Unauthorized);
}

#[test]
fn test_withdraw_double() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);

    t.client.withdraw(&t.user1, &vault_id);

    let err = t.client.try_withdraw(&t.user1, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, VaultError::AlreadyWithdrawn);
}

// ─── treasury and query tests ────────────────────────────────────────────────

#[test]
fn test_withdraw_treasury_unauthorized() {
    let t = setup();

    let err = t
        .client
        .try_withdraw_treasury(&t.user1, &t.xlm)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::Unauthorized);
}

#[test]
fn test_withdraw_treasury_empty() {
    let t = setup();

    let err = t
        .client
        .try_withdraw_treasury(&t.protocol_owner, &t.xlm)
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VaultError::TreasuryEmpty);
}

#[test]
fn test_withdraw_treasury_success() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);
    t.client.withdraw(&t.user1, &vault_id);

    assert_eq!(t.client.get_treasury_balance(&t.xlm), 50);

    let owner_balance_before = TokenClient::new(&t.env, &t.xlm).balance(&t.protocol_owner);

    t.client.withdraw_treasury(&t.protocol_owner, &t.xlm);

    assert_eq!(t.client.get_treasury_balance(&t.xlm), 0);

    let owner_balance_after = TokenClient::new(&t.env, &t.xlm).balance(&t.protocol_owner);
    assert_eq!(owner_balance_after - owner_balance_before, 50);
}

#[test]
fn test_get_vault_not_found() {
    let t = setup();

    let err = t.client.try_get_vault(&9999).unwrap_err().unwrap();
    assert_eq!(err, VaultError::VaultNotFound);
}

#[test]
fn test_get_vaults_by_owner_empty() {
    let t = setup();
    let stranger = Address::generate(&t.env);

    let ids = t.client.get_vaults_by_owner(&stranger);
    assert_eq!(ids.len(), 0);
}

// ─── event tests (task 9.1) ──────────────────────────────────────────────────

/// Helper: decode a Val as T using TryIntoVal, returning a default on failure.
fn decode_val<T: soroban_sdk::TryFromVal<Env, soroban_sdk::Val>>(
    env: &Env,
    val: soroban_sdk::Val,
    default: T,
) -> T {
    T::try_from_val(env, &val).unwrap_or(default)
}

#[test]
fn test_event_vault_created() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    let events = t.env.events().all();
    let found = events.iter().any(|(contract_id, topics, data)| {
        if contract_id != t.client.address {
            return false;
        }
        if topics.len() < 2 {
            return false;
        }
        let topic0 = decode_val::<soroban_sdk::Symbol>(
            &t.env,
            topics.get(0).unwrap(),
            soroban_sdk::Symbol::new(&t.env, ""),
        );
        if topic0 != symbol_short!("vault_crt") {
            return false;
        }
        let topic1 = decode_val::<u64>(&t.env, topics.get(1).unwrap(), u64::MAX);
        if topic1 != vault_id {
            return false;
        }
        let event: VaultCreatedEvent = data.try_into_val(&t.env).unwrap();
        event.vault_id == vault_id
            && event.owner == t.user1
            && event.token == t.xlm
            && event.amount == 1000
            && event.unlock_time == unlock
            && event.lock_type == LockType::Strict
    });
    assert!(found, "vault_crt event not found or fields incorrect");
}

#[test]
fn test_event_withdrawn() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Strict, &0);

    advance_time(&t.env, 3601);
    t.client.withdraw(&t.user1, &vault_id);

    let events = t.env.events().all();
    let found = events.iter().any(|(contract_id, topics, data)| {
        if contract_id != t.client.address {
            return false;
        }
        if topics.len() < 2 {
            return false;
        }
        let topic0 = decode_val::<soroban_sdk::Symbol>(
            &t.env,
            topics.get(0).unwrap(),
            soroban_sdk::Symbol::new(&t.env, ""),
        );
        if topic0 != symbol_short!("withdrawn") {
            return false;
        }
        let topic1 = decode_val::<u64>(&t.env, topics.get(1).unwrap(), u64::MAX);
        if topic1 != vault_id {
            return false;
        }
        let event: WithdrawnEvent = data.try_into_val(&t.env).unwrap();
        event.vault_id == vault_id
            && event.owner == t.user1
            && event.token == t.xlm
            && event.amount == 1000
    });
    assert!(found, "withdrawn event not found or fields incorrect");
}

#[test]
fn test_event_early_withdrawn() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    // amount=1000, rate=500 → penalty=50
    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);

    t.client.withdraw(&t.user1, &vault_id);

    let events = t.env.events().all();
    let found = events.iter().any(|(contract_id, topics, data)| {
        if contract_id != t.client.address {
            return false;
        }
        if topics.len() < 2 {
            return false;
        }
        let topic0 = decode_val::<soroban_sdk::Symbol>(
            &t.env,
            topics.get(0).unwrap(),
            soroban_sdk::Symbol::new(&t.env, ""),
        );
        if topic0 != symbol_short!("early_wdr") {
            return false;
        }
        let topic1 = decode_val::<u64>(&t.env, topics.get(1).unwrap(), u64::MAX);
        if topic1 != vault_id {
            return false;
        }
        let event: EarlyWithdrawnEvent = data.try_into_val(&t.env).unwrap();
        event.vault_id == vault_id
            && event.owner == t.user1
            && event.token == t.xlm
            && event.amount == 1000
            && event.penalty == 50
    });
    assert!(found, "early_wdr event not found or fields incorrect");
}

#[test]
fn test_event_treasury_withdrawn() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let unlock = now + 3600;

    let vault_id = t.client.create_vault(&t.user1, &t.xlm, &1000, &unlock, &LockType::Penalty, &500);
    t.client.withdraw(&t.user1, &vault_id);
    t.client.withdraw_treasury(&t.protocol_owner, &t.xlm);

    let events = t.env.events().all();
    let found = events.iter().any(|(contract_id, topics, data)| {
        if contract_id != t.client.address {
            return false;
        }
        if topics.len() < 2 {
            return false;
        }
        let topic0 = decode_val::<soroban_sdk::Symbol>(
            &t.env,
            topics.get(0).unwrap(),
            soroban_sdk::Symbol::new(&t.env, ""),
        );
        if topic0 != symbol_short!("treas_wdr") {
            return false;
        }
        let event: TreasuryWithdrawnEvent = data.try_into_val(&t.env).unwrap();
        event.token == t.xlm && event.amount == 50
    });
    assert!(found, "treas_wdr event not found or fields incorrect");
}
