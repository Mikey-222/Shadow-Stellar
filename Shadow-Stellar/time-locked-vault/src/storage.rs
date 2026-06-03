use soroban_sdk::{Address, Env, Vec};
use crate::{DataKey, Vault};

pub const LEDGER_BUMP_AMOUNT: u32 = 535_000;

/// Returns the vault record for vault_id, or None if not found.
pub fn get_vault_unchecked(env: &Env, vault_id: u64) -> Option<Vault> {
    let key = DataKey::Vault(vault_id);
    env.storage().persistent().get(&key)
}

/// Saves a vault record and extends its persistent TTL.
pub fn save_vault(env: &Env, vault_id: u64, vault: &Vault) {
    let key = DataKey::Vault(vault_id);
    env.storage().persistent().set(&key, vault);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}

/// Reads the current counter, increments it, stores it, and returns the old value as the new vault_id.
pub fn next_vault_id(env: &Env) -> u64 {
    let counter: u64 = env.storage().instance().get(&DataKey::VaultCounter).unwrap_or(0);
    env.storage().instance().set(&DataKey::VaultCounter, &(counter + 1));
    counter
}

/// Returns true if the token address is in the SupportedTokens list.
pub fn is_supported_token(env: &Env, token: &Address) -> bool {
    let tokens: Vec<Address> = match env.storage().instance().get(&DataKey::SupportedTokens) {
        Some(t) => t,
        None => return false,
    };
    tokens.contains(token)
}

/// Returns the stored protocol_owner address. Panics if not initialized.
pub fn get_protocol_owner(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::ProtocolOwner).unwrap()
}

/// Adds `amount` to the treasury balance for `token`.
pub fn add_to_treasury(env: &Env, token: &Address, amount: i128) {
    let current = get_treasury(env, token);
    env.storage().instance().set(&DataKey::Treasury(token.clone()), &(current + amount));
}

/// Returns the current treasury balance for `token` (0 if not set).
pub fn get_treasury(env: &Env, token: &Address) -> i128 {
    env.storage().instance().get(&DataKey::Treasury(token.clone())).unwrap_or(0)
}

/// Sets the treasury balance for `token` to `amount`.
pub fn set_treasury(env: &Env, token: &Address, amount: i128) {
    env.storage().instance().set(&DataKey::Treasury(token.clone()), &amount);
}

/// Returns the owner's vault id list (empty Vec if not set).
pub fn get_owner_vaults(env: &Env, owner: &Address) -> Vec<u64> {
    let key = DataKey::OwnerVaults(owner.clone());
    env.storage().persistent().get(&key).unwrap_or_else(|| Vec::new(env))
}

/// Saves the owner's vault id list and extends its persistent TTL.
pub fn save_owner_vaults(env: &Env, owner: &Address, vault_ids: &Vec<u64>) {
    let key = DataKey::OwnerVaults(owner.clone());
    env.storage().persistent().set(&key, vault_ids);
    env.storage().persistent().extend_ttl(&key, LEDGER_BUMP_AMOUNT, LEDGER_BUMP_AMOUNT);
}
