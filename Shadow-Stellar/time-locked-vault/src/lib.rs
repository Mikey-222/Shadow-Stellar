#![no_std]

mod tests;
#[cfg(test)]
mod integration_tests;

mod types;
pub use types::*;

mod storage_types;
pub use storage_types::*;

mod storage;
pub use storage::*;

mod utils;
pub use utils::*;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env, Vec};

#[contract]
pub struct VaultContract;

#[contractimpl]
impl VaultContract {
    pub fn initialize(
        env: Env,
        protocol_owner: Address,
        xlm_token: Address,
        usdc_token: Address,
        eurc_token: Address,
    ) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::ProtocolOwner) {
            return Err(VaultError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::ProtocolOwner, &protocol_owner);

        let mut tokens = Vec::new(&env);
        tokens.push_back(xlm_token);
        tokens.push_back(usdc_token);
        tokens.push_back(eurc_token);
        env.storage().instance().set(&DataKey::SupportedTokens, &tokens);

        env.storage().instance().set(&DataKey::VaultCounter, &0u64);

        Ok(())
    }

    pub fn create_vault(
        env: Env,
        caller: Address,
        token: Address,
        amount: i128,
        unlock_time: u64,
        lock_type: LockType,
        penalty_rate: u32,
    ) -> Result<u64, VaultError> {
        caller.require_auth();

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        if unlock_time <= env.ledger().timestamp() {
            return Err(VaultError::InvalidUnlockTime);
        }

        if !is_supported_token(&env, &token) {
            return Err(VaultError::UnsupportedToken);
        }

        let penalty_rate = match lock_type {
            LockType::Penalty => {
                if penalty_rate == 0 || penalty_rate > 10_000 {
                    return Err(VaultError::InvalidPenaltyRate);
                }
                penalty_rate
            }
            LockType::Strict => 0,
        };

        token_client(&env, &token).transfer(&caller, &env.current_contract_address(), &amount);

        let vault_id = next_vault_id(&env);

        let vault = Vault {
            owner: caller.clone(),
            token: token.clone(),
            amount,
            start_time: env.ledger().timestamp(),
            unlock_time,
            lock_type: lock_type.clone(),
            penalty_rate,
            state: VaultState::Active,
        };

        save_vault(&env, vault_id, &vault);

        let mut ids = get_owner_vaults(&env, &caller);
        ids.push_back(vault_id);
        save_owner_vaults(&env, &caller, &ids);

        env.events().publish(
            (symbol_short!("vault_crt"), vault_id),
            VaultCreatedEvent { vault_id, owner: caller, token, amount, unlock_time, lock_type },
        );

        Ok(vault_id)
    }

    pub fn withdraw(
        env: Env,
        caller: Address,
        vault_id: u64,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        let mut vault = match get_vault_unchecked(&env, vault_id) {
            Some(v) => v,
            None => return Err(VaultError::VaultNotFound),
        };

        if caller != vault.owner {
            return Err(VaultError::Unauthorized);
        }

        if vault.state == VaultState::Withdrawn {
            return Err(VaultError::AlreadyWithdrawn);
        }

        let now = env.ledger().timestamp();

        if now >= vault.unlock_time {
            // Case A: mature withdrawal
            token_client(&env, &vault.token).transfer(
                &env.current_contract_address(),
                &vault.owner,
                &vault.amount,
            );
            vault.state = VaultState::Withdrawn;
            save_vault(&env, vault_id, &vault);
            env.events().publish(
                (symbol_short!("withdrawn"), vault_id),
                WithdrawnEvent {
                    vault_id,
                    owner: vault.owner.clone(),
                    token: vault.token.clone(),
                    amount: vault.amount,
                },
            );
        } else if vault.lock_type == LockType::Penalty {
            // Case B: early withdrawal with penalty
            let (payout, penalty) = calculate_penalty(vault.amount, vault.penalty_rate);
            token_client(&env, &vault.token).transfer(
                &env.current_contract_address(),
                &vault.owner,
                &payout,
            );
            add_to_treasury(&env, &vault.token, penalty);
            vault.state = VaultState::Withdrawn;
            save_vault(&env, vault_id, &vault);
            env.events().publish(
                (symbol_short!("early_wdr"), vault_id),
                EarlyWithdrawnEvent {
                    vault_id,
                    owner: vault.owner.clone(),
                    token: vault.token.clone(),
                    amount: vault.amount,
                    penalty,
                },
            );
        } else {
            // Case C: strict vault, early exit not allowed
            return Err(VaultError::EarlyExitNotAllowed);
        }

        Ok(())
    }

    pub fn withdraw_treasury(
        env: Env,
        caller: Address,
        token: Address,
    ) -> Result<(), VaultError> {
        caller.require_auth();

        if caller != get_protocol_owner(&env) {
            return Err(VaultError::Unauthorized);
        }

        let balance = get_treasury(&env, &token);

        if balance == 0 {
            return Err(VaultError::TreasuryEmpty);
        }

        token_client(&env, &token).transfer(&env.current_contract_address(), &caller, &balance);

        set_treasury(&env, &token, 0);

        env.events().publish(
            (symbol_short!("treas_wdr"), token.clone()),
            TreasuryWithdrawnEvent { token: token.clone(), amount: balance },
        );

        Ok(())
    }

    pub fn get_vault(env: Env, vault_id: u64) -> Result<Vault, VaultError> {
        get_vault_unchecked(&env, vault_id).ok_or(VaultError::VaultNotFound)
    }

    pub fn get_vaults_by_owner(env: Env, owner: Address) -> Vec<u64> {
        get_owner_vaults(&env, &owner)
    }

    pub fn get_treasury_balance(env: Env, token: Address) -> i128 {
        get_treasury(&env, &token)
    }
}
