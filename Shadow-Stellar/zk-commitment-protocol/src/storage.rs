//! Storage helpers for the ZK Commitment Protocol.

use soroban_sdk::{Address, Bytes, BytesN, Env, Vec};
use crate::zk_types::{ZkError, ZkVaultEntry};

pub const LEDGER_BUMP: u32 = 535_000;

// ── Storage key enum (inlined as separate functions for simplicity) ────────────
// We use Soroban's generic storage directly with typed keys.

use soroban_sdk::contracttype;

#[contracttype]
pub enum StoreKey {
    /// One-time init flag + supported tokens.
    SupportedTokens,
    /// Monotonic entry counter.
    EntryCounter,
    /// ZkVaultEntry by entry_id.
    VaultEntry(u64),
    /// Entries by depositor.
    DepositorEntries(Address),
    /// Spent nullifier registry: nullifier -> entry_id.
    Nullifier(BytesN<32>),
    /// Protocol owner (for admin ops).
    ProtocolOwner,
    /// UltraHonk verifier contract address.
    VerifierAddress,
    /// Embedded UltraHonk verification key bytes.
    VerificationKey,
}

// ── Initialization ────────────────────────────────────────────────────────────

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&StoreKey::SupportedTokens)
}

pub fn get_supported_tokens(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&StoreKey::SupportedTokens)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_supported_tokens(env: &Env, tokens: &Vec<Address>) {
    env.storage().instance().set(&StoreKey::SupportedTokens, tokens);
}

pub fn is_supported(env: &Env, token: &Address) -> bool {
    get_supported_tokens(env).contains(token)
}

// ── Entry counter ─────────────────────────────────────────────────────────────

pub fn next_entry_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance()
        .get(&StoreKey::EntryCounter)
        .unwrap_or(0u64);
    env.storage().instance().set(&StoreKey::EntryCounter, &(id + 1));
    id
}

// ── Vault entries ─────────────────────────────────────────────────────────────

pub fn get_entry(env: &Env, entry_id: u64) -> Option<ZkVaultEntry> {
    env.storage().persistent().get(&StoreKey::VaultEntry(entry_id))
}

pub fn save_entry(env: &Env, entry_id: u64, entry: &ZkVaultEntry) {
    let key = StoreKey::VaultEntry(entry_id);
    env.storage().persistent().set(&key, entry);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP, LEDGER_BUMP);
}

pub fn require_entry(env: &Env, entry_id: u64) -> Result<ZkVaultEntry, ZkError> {
    get_entry(env, entry_id).ok_or(ZkError::EntryNotFound)
}

// ── Depositor index ───────────────────────────────────────────────────────────

pub fn get_depositor_entries(env: &Env, depositor: &Address) -> Vec<u64> {
    let key = StoreKey::DepositorEntries(depositor.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn push_depositor_entry(env: &Env, depositor: &Address, entry_id: u64) {
    let key = StoreKey::DepositorEntries(depositor.clone());
    let mut ids = get_depositor_entries(env, depositor);
    ids.push_back(entry_id);
    env.storage().persistent().set(&key, &ids);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP, LEDGER_BUMP);
}

// ── Nullifier registry ────────────────────────────────────────────────────────

pub fn is_nullifier_spent(env: &Env, n: &BytesN<32>) -> bool {
    env.storage().persistent().has(&StoreKey::Nullifier(n.clone()))
}

pub fn spend_nullifier(env: &Env, n: &BytesN<32>, entry_id: u64) {
    let key = StoreKey::Nullifier(n.clone());
    env.storage().persistent().set(&key, &entry_id);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP, LEDGER_BUMP);
}

// ── Protocol owner ────────────────────────────────────────────────────────────

pub fn get_protocol_owner(env: &Env) -> Address {
    env.storage().instance()
        .get(&StoreKey::ProtocolOwner)
        .unwrap()
}

pub fn set_protocol_owner(env: &Env, owner: &Address) {
    env.storage().instance().set(&StoreKey::ProtocolOwner, owner);
}

pub fn set_verifier_address(env: &Env, addr: &Address) {
    env.storage().instance().set(&StoreKey::VerifierAddress, addr);
}

pub fn get_verifier_address(env: &Env) -> Option<Address> {
    env.storage().instance().get(&StoreKey::VerifierAddress)
}

pub fn get_verification_key(env: &Env) -> Option<Bytes> {
    env.storage().instance().get(&StoreKey::VerificationKey)
}

pub fn set_verification_key(env: &Env, vk_bytes: &Bytes) {
    env.storage().instance().set(&StoreKey::VerificationKey, vk_bytes);
}
