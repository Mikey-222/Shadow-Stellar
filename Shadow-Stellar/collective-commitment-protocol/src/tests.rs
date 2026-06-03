#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Events, Ledger, LedgerInfo},
    token::{StellarAssetClient, TokenClient},
    Address, Env, TryIntoVal, Vec,
};

use crate::{
    CcpContract, CcpContractClient, CcpError, GroupVaultCreatedEvent, LockType, MemberDepositedEvent,
    MemberEarlyExitEvent, MemberState, MemberWithdrawnEvent, PoolClaimedEvent, VaultActivatedEvent,
    VaultCancelledEvent, VaultResolvedEvent, VaultState,
};

// ─── helpers ─────────────────────────────────────────────────────────────────

struct TestSetup {
    env: Env,
    client: CcpContractClient<'static>,
    xlm: Address,
    usdc: Address,
    eurc: Address,
    members: soroban_sdk::Vec<Address>,
}

fn ledger_info(timestamp: u64, seq: u32) -> LedgerInfo {
    LedgerInfo {
        timestamp,
        protocol_version: 22,
        sequence_number: seq,
        network_id: Default::default(),
        base_reserve: 10,
        min_temp_entry_ttl: 6_312_000,
        min_persistent_entry_ttl: 6_312_000,
        max_entry_ttl: 6_312_000,
    }
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set(ledger_info(1_000_000, 1));

    let contract_id = env.register(CcpContract, ());

    let xlm_admin = Address::generate(&env);
    let usdc_admin = Address::generate(&env);
    let eurc_admin = Address::generate(&env);

    let xlm = env.register_stellar_asset_contract_v2(xlm_admin).address();
    let usdc = env.register_stellar_asset_contract_v2(usdc_admin).address();
    let eurc = env.register_stellar_asset_contract_v2(eurc_admin).address();

    let client = CcpContractClient::new(&env, &contract_id);
    client.initialize(&xlm, &usdc, &eurc);

    let mut members = Vec::new(&env);
    for _ in 0..5 {
        let m = Address::generate(&env);
        StellarAssetClient::new(&env, &xlm).mint(&m, &1_000_000);
        members.push_back(m);
    }

    let env: Env = unsafe { core::mem::transmute(env) };
    let client: CcpContractClient<'static> = unsafe { core::mem::transmute(client) };

    TestSetup { env, client, xlm, usdc, eurc, members }
}

fn advance_time(env: &Env, delta: u64) {
    let ts = env.ledger().timestamp();
    let seq = env.ledger().sequence();
    env.ledger().set(ledger_info(ts + delta, seq + 1));
}

/// Build a Vec<i128> of `n` equal amounts.
fn equal_amounts(env: &Env, n: u32, amount: i128) -> soroban_sdk::Vec<i128> {
    let mut v = soroban_sdk::Vec::new(env);
    for _ in 0..n { v.push_back(amount); }
    v
}

// ─── create_group_vault tests ─────────────────────────────────────────────────

#[test]
fn test_create_vault_success() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    let vault_id = t.client.create_group_vault(
        &t.members.get(0).unwrap(),
        &t.xlm,
        &t.members,
        &amounts,
        &(now + 7200),
        &(now + 3600),
        &LockType::Strict,
        &0,
    );
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::FundingOpen);
    assert_eq!(vault.total_size, 5000);
    assert_eq!(vault.deposited_count, 0);
    for i in 0..5 {
        let rec = t.client.get_member_state(&vault_id, &t.members.get(i).unwrap());
        assert_eq!(rec.state, MemberState::Committed);
        assert_eq!(rec.amount, 1000);
    }
}

#[test]
fn test_create_vault_penalty_success() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 2000);
    let vault_id = t.client.create_group_vault(
        &t.members.get(0).unwrap(),
        &t.xlm,
        &t.members,
        &amounts,
        &(now + 7200),
        &(now + 3600),
        &LockType::Penalty,
        &500,
    );
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.lock_type, LockType::Penalty);
    assert_eq!(vault.penalty_rate, 500);
}

#[test]
fn test_create_vault_too_few_members() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let mut members = Vec::new(&t.env);
    for _ in 0..4 { members.push_back(Address::generate(&t.env)); }
    let amounts = equal_amounts(&t.env, 4, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidMemberCount);
}

#[test]
fn test_create_vault_too_many_members() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let mut members = Vec::new(&t.env);
    for _ in 0..101 { members.push_back(Address::generate(&t.env)); }
    let amounts = equal_amounts(&t.env, 101, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidMemberCount);
}

#[test]
fn test_create_vault_amount_mismatch() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 4, 1000); // 5 members, 4 amounts
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::MemberAmountMismatch);
}

#[test]
fn test_create_vault_zero_amount() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let mut amounts = equal_amounts(&t.env, 5, 1000);
    amounts.set(2, 0);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidObligationAmount);
}

#[test]
fn test_create_vault_unsupported_token() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let bad_token = Address::generate(&t.env);
    let amounts = equal_amounts(&t.env, 5, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &bad_token, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::UnsupportedToken);
}

#[test]
fn test_create_vault_past_unlock_time() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &now, &(now-1), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidUnlockTime);
}

#[test]
fn test_create_vault_bad_deadline() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    // deadline >= unlock_time
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &(now+3600), &(now+3600), &LockType::Strict, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidFundingDeadline);
}

#[test]
fn test_create_vault_penalty_rate_zero() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Penalty, &0)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidPenaltyRate);
}

#[test]
fn test_create_vault_penalty_rate_too_high() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    let err = t.client
        .try_create_group_vault(&t.members.get(0).unwrap(), &t.xlm, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Penalty, &10001)
        .unwrap_err().unwrap();
    assert_eq!(err, CcpError::InvalidPenaltyRate);
}

#[test]
fn test_creator_and_member_index() {
    let t = setup();
    let now = t.env.ledger().timestamp();
    let creator = Address::generate(&t.env);
    let amounts = equal_amounts(&t.env, 5, 1000);
    let vault_id = t.client.create_group_vault(
        &creator, &t.xlm, &t.members, &amounts, &(now+7200), &(now+3600), &LockType::Strict, &0,
    );
    assert!(t.client.get_vaults_by_creator(&creator).contains(&vault_id));
    for i in 0..5 {
        assert!(t.client.get_vaults_by_member(&t.members.get(i).unwrap()).contains(&vault_id));
    }
}

// ─── deposit tests ────────────────────────────────────────────────────────────

fn create_test_vault(t: &TestSetup, lock_type: LockType, penalty_rate: u32) -> u64 {
    let now = t.env.ledger().timestamp();
    let amounts = equal_amounts(&t.env, 5, 1000);
    // Use a separate creator (not in members list) to properly test commission
    let creator = Address::generate(&t.env);
    t.client.create_group_vault(
        &creator,
        &t.xlm,
        &t.members,
        &amounts,
        &(now + 7200),
        &(now + 3600),
        &lock_type,
        &penalty_rate,
    )
}
#[test]
fn test_deposit_all_members_activates_vault() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 {
        t.client.deposit(&t.members.get(i).unwrap(), &vault_id);
    }
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::ActiveLocked);
    for i in 0..5 {
        let rec = t.client.get_member_state(&vault_id, &t.members.get(i).unwrap());
        assert_eq!(rec.state, MemberState::Active);
    }
}

#[test]
fn test_deposit_partial_stays_funding_open() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..3 {
        t.client.deposit(&t.members.get(i).unwrap(), &vault_id);
    }
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::FundingOpen);
}

#[test]
fn test_deposit_non_member() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    let stranger = Address::generate(&t.env);
    let err = t.client.try_deposit(&stranger, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::NotMember);
}

#[test]
fn test_deposit_double() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    let m = t.members.get(0).unwrap();
    t.client.deposit(&m, &vault_id);
    let err = t.client.try_deposit(&m, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongMemberState);
}

#[test]
fn test_deposit_after_deadline() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    advance_time(&t.env, 3601); // past funding_deadline
    let err = t.client.try_deposit(&t.members.get(0).unwrap(), &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::FundingDeadlinePassed);
}

// ─── cancel tests ─────────────────────────────────────────────────────────────

#[test]
fn test_cancel_after_deadline() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    // deposit only 2 members
    t.client.deposit(&t.members.get(0).unwrap(), &vault_id);
    t.client.deposit(&t.members.get(1).unwrap(), &vault_id);
    advance_time(&t.env, 3601);
    t.client.cancel(&vault_id);
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Cancelled);
}

#[test]
fn test_cancel_before_deadline() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    let err = t.client.try_cancel(&vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::FundingDeadlineNotPassed);
}

#[test]
fn test_cancel_active_vault() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 3601);
    let err = t.client.try_cancel(&vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongVaultState);
}

// ─── withdraw tests ───────────────────────────────────────────────────────────

#[test]
fn test_withdraw_refund_after_cancel() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    let m = t.members.get(0).unwrap();
    let bal_before = TokenClient::new(&t.env, &t.xlm).balance(&m);
    t.client.deposit(&m, &vault_id);
    advance_time(&t.env, 3601);
    t.client.cancel(&vault_id);
    t.client.withdraw(&m, &vault_id);
    let bal_after = TokenClient::new(&t.env, &t.xlm).balance(&m);
    // Refund is the locked amount (950 after 5% commission)
    assert_eq!(bal_before - bal_after, 50); // net cost = commission only
    let rec = t.client.get_member_state(&vault_id, &m);
    assert_eq!(rec.state, MemberState::Withdrawn);
}

#[test]
fn test_withdraw_mature() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201); // past unlock_time
    let m = t.members.get(0).unwrap();
    // Mature withdrawal: locked amount = 950 (after 5% commission)
    let bal_before = TokenClient::new(&t.env, &t.xlm).balance(&m);
    t.client.withdraw(&m, &vault_id);
    let bal_after = TokenClient::new(&t.env, &t.xlm).balance(&m);
    assert_eq!(bal_after - bal_before, 950);
    let rec = t.client.get_member_state(&vault_id, &m);
    assert_eq!(rec.state, MemberState::Withdrawn);
}

#[test]
fn test_withdraw_early_penalty() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Penalty, 500);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    // early exit — locked=950 (after 5% commission), rate=500 → penalty=floor(950*500/10000)=47, payout=903
    let m = t.members.get(0).unwrap();
    let bal_before = TokenClient::new(&t.env, &t.xlm).balance(&m);
    t.client.withdraw(&m, &vault_id);
    let bal_after = TokenClient::new(&t.env, &t.xlm).balance(&m);
    assert_eq!(bal_after - bal_before, 903);
    assert_eq!(t.client.get_pool_balance(&vault_id), 47);
    let rec = t.client.get_member_state(&vault_id, &m);
    assert_eq!(rec.state, MemberState::Exited);
}

#[test]
fn test_withdraw_early_strict() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    let err = t.client.try_withdraw(&t.members.get(0).unwrap(), &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::EarlyExitNotAllowed);
}

#[test]
fn test_withdraw_double() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201);
    let m = t.members.get(0).unwrap();
    t.client.withdraw(&m, &vault_id);
    let err = t.client.try_withdraw(&m, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongMemberState);
}

#[test]
fn test_withdraw_non_member() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201);
    let stranger = Address::generate(&t.env);
    let err = t.client.try_withdraw(&stranger, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::NotMember);
}

// ─── claim_pool tests ─────────────────────────────────────────────────────────

#[test]
fn test_claim_pool_after_early_exit() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Penalty, 500);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    // member 0 exits early: locked=950, penalty=47, pool=47
    t.client.withdraw(&t.members.get(0).unwrap(), &vault_id);
    assert_eq!(t.client.get_pool_balance(&vault_id), 47);
    // advance past unlock_time
    advance_time(&t.env, 7201);
    // members 1-4 withdraw their principal
    for i in 1..5 { t.client.withdraw(&t.members.get(i).unwrap(), &vault_id); }
    // members 1-4 claim pool — verify total claimed == pool and pool drains to 0
    let mut total_claimed: i128 = 0;
    for i in 1..5 {
        let m = t.members.get(i).unwrap();
        let b = TokenClient::new(&t.env, &t.xlm).balance(&m);
        t.client.claim_pool(&m, &vault_id);
        let a = TokenClient::new(&t.env, &t.xlm).balance(&m);
        total_claimed += a - b;
    }
    // All 47 penalty tokens must be distributed
    assert_eq!(total_claimed, 47);
    assert_eq!(t.client.get_pool_balance(&vault_id), 0);
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Resolved);
}

#[test]
fn test_claim_pool_zero_pool() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201);
    for i in 0..5 { t.client.withdraw(&t.members.get(i).unwrap(), &vault_id); }
    // claim_pool with zero pool — should succeed with 0 transfer
    for i in 0..5 {
        t.client.claim_pool(&t.members.get(i).unwrap(), &vault_id);
    }
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Resolved);
}

#[test]
fn test_claim_pool_wrong_state() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    // vault is ActiveLocked, not SettlementReady
    let err = t.client.try_claim_pool(&t.members.get(0).unwrap(), &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongVaultState);
}

#[test]
fn test_claim_pool_exited_member() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Penalty, 500);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    t.client.withdraw(&t.members.get(0).unwrap(), &vault_id); // exits early
    advance_time(&t.env, 7201);
    let err = t.client.try_claim_pool(&t.members.get(0).unwrap(), &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongMemberState);
}

#[test]
fn test_claim_pool_double() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201);
    for i in 0..5 { t.client.withdraw(&t.members.get(i).unwrap(), &vault_id); }
    let m = t.members.get(0).unwrap();
    t.client.claim_pool(&m, &vault_id);
    let err = t.client.try_claim_pool(&m, &vault_id).unwrap_err().unwrap();
    assert_eq!(err, CcpError::WrongMemberState);
}

#[test]
fn test_vault_resolves_after_all_claims() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    advance_time(&t.env, 7201);
    for i in 0..5 { t.client.withdraw(&t.members.get(i).unwrap(), &vault_id); }
    for i in 0..5 { t.client.claim_pool(&t.members.get(i).unwrap(), &vault_id); }
    let vault = t.client.get_group_vault(&vault_id);
    assert_eq!(vault.state, VaultState::Resolved);
}

// ─── query tests ──────────────────────────────────────────────────────────────

#[test]
fn test_get_group_vault_not_found() {
    let t = setup();
    let err = t.client.try_get_group_vault(&9999).unwrap_err().unwrap();
    assert_eq!(err, CcpError::VaultNotFound);
}

#[test]
fn test_get_member_state_not_member() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Strict, 0);
    let stranger = Address::generate(&t.env);
    let err = t.client.try_get_member_state(&vault_id, &stranger).unwrap_err().unwrap();
    assert_eq!(err, CcpError::NotMember);
}

#[test]
fn test_get_vaults_by_creator_empty() {
    let t = setup();
    let stranger = Address::generate(&t.env);
    let ids = t.client.get_vaults_by_creator(&stranger);
    assert_eq!(ids.len(), 0);
}

#[test]
fn test_get_pool_balance() {
    let t = setup();
    let vault_id = create_test_vault(&t, LockType::Penalty, 500);
    for i in 0..5 { t.client.deposit(&t.members.get(i).unwrap(), &vault_id); }
    assert_eq!(t.client.get_pool_balance(&vault_id), 0);
    t.client.withdraw(&t.members.get(0).unwrap(), &vault_id);
    // locked=950, penalty_rate=500 → penalty=floor(950*500/10000)=47
    assert_eq!(t.client.get_pool_balance(&vault_id), 47);
}
