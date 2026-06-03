use soroban_sdk::{Address, BytesN, Env, Vec};
use crate::{DataKey, GroupVault, MemberRecord, MemberState, ZkMemberRecord, ZkGroupVault};

pub const LEDGER_BUMP_AMOUNT: u32 = 535_000;

pub fn next_vault_id(env: &Env) -> u64 {
    let counter: u64 = env.storage().instance().get(&DataKey::VaultCounter).unwrap_or(0);
    env.storage().instance().set(&DataKey::VaultCounter, &(counter + 1));
    counter
}

pub fn is_supported_token(env: &Env, token: &Address) -> bool {
    let tokens: Vec<Address> = match env.storage().instance().get(&DataKey::SupportedTokens) {
        Some(t) => t,
        None => return false,
    };
    tokens.contains(token)
}

pub fn get_group_vault_unchecked(env: &Env, vault_id: u64) -> Option<GroupVault> {
    env.storage().persistent().get(&DataKey::GroupVault(vault_id))
}

pub fn save_group_vault(env: &Env, vault_id: u64, vault: &GroupVault) {
    let key = DataKey::GroupVault(vault_id);
    env.storage().persistent().set(&key, vault);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

pub fn get_member_record(env: &Env, vault_id: u64, member: &Address) -> Option<MemberRecord> {
    env.storage().persistent().get(&DataKey::MemberRecord(vault_id, member.clone()))
}

pub fn save_member_record(env: &Env, vault_id: u64, member: &Address, record: &MemberRecord) {
    let key = DataKey::MemberRecord(vault_id, member.clone());
    env.storage().persistent().set(&key, record);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

pub fn get_pool(env: &Env, vault_id: u64) -> i128 {
    env.storage().instance().get(&DataKey::CommunityPool(vault_id)).unwrap_or(0)
}

pub fn add_to_pool(env: &Env, vault_id: u64, amount: i128) {
    let current = get_pool(env, vault_id);
    env.storage().instance().set(&DataKey::CommunityPool(vault_id), &(current + amount));
}

pub fn set_pool(env: &Env, vault_id: u64, amount: i128) {
    env.storage().instance().set(&DataKey::CommunityPool(vault_id), &amount);
}

pub fn get_creator_vaults(env: &Env, creator: &Address) -> Vec<u64> {
    let key = DataKey::CreatorVaults(creator.clone());
    env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
}

pub fn save_creator_vaults(env: &Env, creator: &Address, ids: &Vec<u64>) {
    let key = DataKey::CreatorVaults(creator.clone());
    env.storage().persistent().set(&key, ids);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

pub fn get_member_vaults(env: &Env, member: &Address) -> Vec<u64> {
    let key = DataKey::MemberVaults(member.clone());
    env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
}

pub fn save_member_vaults(env: &Env, member: &Address, ids: &Vec<u64>) {
    let key = DataKey::MemberVaults(member.clone());
    env.storage().persistent().set(&key, ids);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

// ── ZK storage helpers ────────────────────────────────────────────────────────

/// Check whether a nullifier has been used.
/// Returns `true` if the nullifier is already in the spent set.
pub fn is_nullifier_used(env: &Env, nullifier: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::ZkNullifier(nullifier.clone()))
}

/// Mark a nullifier as spent (consumed by vault_id).
pub fn mark_nullifier_used(env: &Env, nullifier: &BytesN<32>, vault_id: u64) {
    let key = DataKey::ZkNullifier(nullifier.clone());
    env.storage().persistent().set(&key, &vault_id);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

/// Get a ZK member record for a slot in a privacy-mode vault.
pub fn get_zk_member_record(env: &Env, vault_id: u64, slot: u32) -> Option<ZkMemberRecord> {
    env.storage().persistent().get(&DataKey::ZkMemberRecord(vault_id, slot))
}

/// Save a ZK member record.
pub fn save_zk_member_record(env: &Env, vault_id: u64, slot: u32, record: &ZkMemberRecord) {
    let key = DataKey::ZkMemberRecord(vault_id, slot);
    env.storage().persistent().set(&key, record);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

/// Check if a vault is in ZK privacy mode.
pub fn is_privacy_mode(env: &Env, vault_id: u64) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::ZkVaultPrivacyMode(vault_id))
        .unwrap_or(false)
}

/// Mark a vault as ZK privacy mode.
pub fn set_privacy_mode(env: &Env, vault_id: u64) {
    let key = DataKey::ZkVaultPrivacyMode(vault_id);
    env.storage().persistent().set(&key, &true);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

/// Get a ZK group vault (privacy mode).
pub fn get_zk_group_vault(env: &Env, vault_id: u64) -> Option<ZkGroupVault> {
    // ZK vaults are stored under the same GroupVault key but as ZkGroupVault
    // We use a separate key space by prefixing slot with u32::MAX as sentinel.
    env.storage().persistent().get(&DataKey::ZkMemberRecord(vault_id, u32::MAX))
}

/// Save a ZK group vault.
pub fn save_zk_group_vault(env: &Env, vault_id: u64, vault: &ZkGroupVault) {
    let key = DataKey::ZkMemberRecord(vault_id, u32::MAX);
    env.storage().persistent().set(&key, vault);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

/// Find which slot index holds a given nullifier (for claim/withdraw lookups).
/// Returns Some(slot_index) or None if not found.
pub fn find_slot_by_nullifier(
    env: &Env,
    vault_id: u64,
    member_count: u32,
    nullifier: &BytesN<32>,
) -> Option<u32> {
    for slot in 0..member_count {
        if let Some(record) = get_zk_member_record(env, vault_id, slot) {
            if record.nullifier == *nullifier {
                return Some(slot);
            }
        }
    }
    None
}

/// Find which slot index holds a given member_commitment (for pre-deposit lookup).
/// Returns Some(slot_index) or None.
pub fn find_slot_by_commitment(
    env: &Env,
    vault_id: u64,
    member_count: u32,
    member_commitment: &BytesN<32>,
) -> Option<u32> {
    for slot in 0..member_count {
        if let Some(record) = get_zk_member_record(env, vault_id, slot) {
            if record.member_commitment == *member_commitment {
                return Some(slot);
            }
        }
    }
    None
}

/// Count ZK member slots eligible to claim pool (Active or Withdrawn).
pub fn count_zk_claimable_members(env: &Env, vault_id: u64, member_count: u32) -> u32 {
    let mut count: u32 = 0;
    for slot in 0..member_count {
        if let Some(record) = get_zk_member_record(env, vault_id, slot) {
            if record.state == MemberState::Active || record.state == MemberState::Withdrawn {
                count += 1;
            }
        }
    }
    count
}
