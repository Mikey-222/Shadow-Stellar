use soroban_sdk::{token, Address, Env};
use crate::{
    GroupVault, MemberState, VaultState, ZkGroupVault,
    storage::{
        get_member_record, get_pool, save_group_vault,
        save_zk_group_vault, count_zk_claimable_members,
    },
};

/// Returns (payout, penalty).
/// penalty = floor(amount * penalty_rate / 10_000)
/// payout  = amount - penalty
/// Invariant: payout + penalty == amount
pub fn calculate_penalty(amount: i128, penalty_rate: u32) -> (i128, i128) {
    let penalty = amount * (penalty_rate as i128) / 10_000;
    let payout = amount - penalty;
    (payout, penalty)
}

/// Returns a token::Client for the given token address.
pub fn token_client<'a>(env: &'a Env, token_addr: &Address) -> token::Client<'a> {
    token::Client::new(env, token_addr)
}

/// Count members with MemberState::Active for a given vault.
pub fn count_active_members(env: &Env, vault_id: u64, vault: &GroupVault) -> u32 {
    let mut count: u32 = 0;
    for member in vault.members.iter() {
        if let Some(record) = get_member_record(env, vault_id, &member) {
            if record.state == MemberState::Active {
                count += 1;
            }
        }
    }
    count
}

/// Count members eligible to claim pool (Active or Withdrawn state).
pub fn count_claimable_members(env: &Env, vault_id: u64, vault: &GroupVault) -> u32 {
    let mut count: u32 = 0;
    for member in vault.members.iter() {
        if let Some(record) = get_member_record(env, vault_id, &member) {
            if record.state == MemberState::Active || record.state == MemberState::Withdrawn {
                count += 1;
            }
        }
    }
    count
}

/// Lazily transition vault from ActiveLocked → SettlementReady if unlock_time has passed.
pub fn maybe_transition_to_settlement_ready(env: &Env, vault_id: u64, vault: &mut GroupVault) {
    if vault.state == VaultState::ActiveLocked
        && env.ledger().timestamp() >= vault.unlock_time
    {
        // Snapshot eligible claimers and pool balance at settlement time
        vault.eligible_claimers = count_claimable_members(env, vault_id, vault);
        vault.original_pool = get_pool(env, vault_id);
        vault.state = VaultState::SettlementReady;
        save_group_vault(env, vault_id, vault);
    }
}

/// Lazily transition a ZK vault from ActiveLocked → SettlementReady.
pub fn maybe_transition_zk(env: &Env, vault_id: u64, vault: &mut ZkGroupVault) {
    if vault.state == VaultState::ActiveLocked
        && env.ledger().timestamp() >= vault.unlock_time
    {
        // Count eligible claimers from ZK member records
        vault.eligible_claimers = count_zk_claimable_members(env, vault_id, vault.member_count);
        vault.original_pool = get_pool(env, vault_id);
        vault.state = VaultState::SettlementReady;
        save_zk_group_vault(env, vault_id, vault);
    }
}
