//! # ZK Commitment Protocol — Shadow-Stellar
//!
//! A standalone Soroban smart contract on Stellar that implements
//! **zero-knowledge commitments** for private asset vaults.
//!
//! ## What This Contract Does
//!
//! Users can lock XLM, USDC, or EURC with a **cryptographic commitment**
//! instead of storing the plaintext amount on-chain. The commitment scheme
//! is based on SHA-256 hash-based Pedersen commitments:
//!
//!   C(v, r) = SHA-256(DOMAIN_COMMIT || v_le || r)
//!
//! This means:
//!   - **Before withdrawal:** only the commitment hash is stored, not the amount
//!   - **At withdrawal:** the user proves they know the preimage (v, r)
//!   - **Replay protection:** each deposit produces a unique nullifier that
//!     is permanently marked as spent
//!
//! ## Functions
//!
//! | Function | Description |
//! |---|---|
//! | `initialize(owner, xlm, usdc, eurc)` | One-time setup |
//! | `zk_deposit(caller, token, proof)` | Deposit with ZK commitment |
//! | `zk_withdraw(caller, entry_id, proof)` | Withdraw using ZK proof |
//! | `verify_range_proof(proof)` | Verify a standalone range proof |
//! | `is_nullifier_spent(nullifier)` | Check if nullifier is used |
//! | `get_entry(entry_id)` | Read a vault entry |
//! | `get_entries_by_depositor(depositor)` | List all entry IDs for a depositor |
//! | `get_commitment(entry_id)` | Read stored commitment hash |
//!
//! ## ZK Events
//!
//! | Event topic | Data |
//! |---|---|
//! | `zk_dep` | ZkDepositedEvent |
//! | `zk_wdr` | ZkWithdrawnEvent |

#![no_std]

mod zk_types;
pub use zk_types::*;

mod zk_crypto;
pub use zk_crypto::*;

mod storage;
pub use storage::*;

mod verifier;
pub use verifier::*;

#[cfg(test)]
mod tests;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, BytesN, Env, Vec,
};
use soroban_sdk::token;

// ── Events ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkDepositedEvent {
    pub entry_id: u64,
    pub depositor: Address,
    pub token: Address,
    /// The commitment hash stored on-chain (NOT the amount).
    pub commitment: BytesN<32>,
    /// The nullifier consumed by this deposit.
    pub nullifier: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct ZkWithdrawnEvent {
    pub entry_id: u64,
    pub withdrawer: Address,
    pub token: Address,
    pub amount: i128,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct ZkContract;

#[contractimpl]
impl ZkContract {

    // ─── initialize ──────────────────────────────────────────────────────────

    /// One-time setup. Sets supported tokens and protocol owner.
    ///
    /// Arguments:
    ///   - `owner`      : protocol owner address (can add tokens in future)
    ///   - `xlm_token`  : XLM SAC address
    ///   - `usdc_token` : USDC SAC address
    ///   - `eurc_token` : EURC SAC address
    pub fn initialize(
        env: Env,
        owner: Address,
        xlm_token: Address,
        usdc_token: Address,
        eurc_token: Address,
    ) -> Result<(), ZkError> {
        if is_initialized(&env) {
            return Err(ZkError::AlreadyInitialized);
        }

        let mut tokens: Vec<Address> = Vec::new(&env);
        tokens.push_back(xlm_token);
        tokens.push_back(usdc_token);
        tokens.push_back(eurc_token);

        set_supported_tokens(&env, &tokens);
        set_protocol_owner(&env, &owner);
        env.storage().instance().set(&StoreKey::EntryCounter, &0u64);

        Ok(())
    }

    // ─── zk_deposit ──────────────────────────────────────────────────────────

    /// Deposit tokens with a zero-knowledge commitment.
    ///
    /// The caller:
    ///   1. Chooses a random blinding factor `r` off-chain
    ///   2. Computes commitment = SHA-256(DOMAIN_COMMIT || amount_le || r)
    ///   3. Computes range_tag  = SHA-256(DOMAIN_RANGE  || commitment || amount || 1 || max)
    ///   4. Computes nullifier  = SHA-256(DOMAIN_NULL   || entry_id_hint_0 || r)
    ///      — entry_id_hint is the NEXT entry id, obtainable via get_next_entry_id()
    ///   5. Packs into ZkDepositProof and calls this function
    ///
    /// On-chain:
    ///   - Verifies the proof (commitment, range, nullifier)
    ///   - Marks the nullifier as spent
    ///   - Transfers tokens from caller to contract
    ///   - Stores ZkVaultEntry { commitment, amount, nullifier }
    ///   - Emits zk_dep event
    ///
    /// The `amount` is stored for withdrawal but the **commitment** is the
    /// authoritative record. The nullifier prevents replay.
    pub fn zk_deposit(
        env: Env,
        caller: Address,
        token: Address,
        proof: ZkDepositProof,
    ) -> Result<u64, ZkError> {
        caller.require_auth();

        // Token must be supported
        if !is_supported(&env, &token) {
            return Err(ZkError::UnsupportedToken);
        }
        // Basic sanity on amount
        if proof.amount <= 0 {
            return Err(ZkError::InvalidAmount);
        }

        // Nullifier must be fresh
        if is_nullifier_spent(&env, &proof.nullifier) {
            return Err(ZkError::NullifierSpent);
        }

        // Determine this entry's ID (used as vault_id in nullifier domain)
        let entry_id = next_entry_id(&env);

        // Verify the ZK deposit proof
        // max_amount = proof.amount (prover sets their own upper bound — the
        // range proof ensures they committed to exactly this amount, ∈ [1, amount])
        if !verify_deposit(&env, &proof, entry_id, proof.amount) {
            return Err(ZkError::InvalidDepositProof);
        }

        // Transfer tokens: caller → contract
        token::Client::new(&env, &token).transfer(
            &caller,
            &env.current_contract_address(),
            &proof.amount,
        );

        // Mark nullifier as spent
        spend_nullifier(&env, &proof.nullifier, entry_id);

        // Store the commitment entry
        let entry = ZkVaultEntry {
            commitment: proof.commitment.clone(),
            amount: proof.amount,
            nullifier: proof.nullifier.clone(),
            withdrawn: false,
        };
        save_entry(&env, entry_id, &entry);

        // Index by depositor
        push_depositor_entry(&env, &caller, entry_id);

        // Emit event — commitment is public, amount is NOT in the event
        env.events().publish(
            (symbol_short!("zk_dep"), entry_id),
            ZkDepositedEvent {
                entry_id,
                depositor: caller,
                token,
                commitment: proof.commitment,
                nullifier: proof.nullifier,
            },
        );

        Ok(entry_id)
    }

    // ─── zk_withdraw ─────────────────────────────────────────────────────────

    /// Withdraw tokens by proving knowledge of the deposit's blinding factor.
    ///
    /// The caller:
    ///   1. Retrieves their stored commitment from `get_commitment(entry_id)`
    ///   2. Provides `ZkWithdrawProof { nullifier, blinding_r, amount }`
    ///      where `blinding_r` is the same one used at deposit time
    ///   3. The on-chain verifier checks:
    ///      - H(amount || blinding_r) == stored commitment
    ///      - supplied nullifier == stored nullifier
    ///
    /// On success: tokens are transferred to the caller and the entry is
    /// marked withdrawn.
    pub fn zk_withdraw(
        env: Env,
        caller: Address,
        entry_id: u64,
        token: Address,
        proof: ZkWithdrawProof,
    ) -> Result<(), ZkError> {
        caller.require_auth();

        let mut entry = require_entry(&env, entry_id)?;

        if entry.withdrawn {
            return Err(ZkError::AlreadyWithdrawn);
        }

        // Get stored bytes
        let stored_commitment = from_bytes32(&entry.commitment);
        let stored_nullifier  = from_bytes32(&entry.nullifier);

        // Verify the ZK withdrawal proof
        if !verify_withdraw(&env, &proof, &stored_commitment, &stored_nullifier) {
            return Err(ZkError::InvalidWithdrawProof);
        }

        // Amount must match stored value
        if proof.amount != entry.amount {
            return Err(ZkError::AmountMismatch);
        }

        // Execute withdrawal
        token::Client::new(&env, &token).transfer(
            &env.current_contract_address(),
            &caller,
            &entry.amount,
        );

        // Mark entry withdrawn
        entry.withdrawn = true;
        save_entry(&env, entry_id, &entry);

        env.events().publish(
            (symbol_short!("zk_wdr"), entry_id),
            ZkWithdrawnEvent {
                entry_id,
                withdrawer: caller,
                token,
                amount: entry.amount,
            },
        );

        Ok(())
    }

    // ─── verify_range_proof ──────────────────────────────────────────────────

    /// Standalone range proof verification.
    ///
    /// Returns `true` if `proof.value ∈ [proof.min_value, proof.max_value]`
    /// and the commitment + range_tag are consistent.
    ///
    /// This is a public utility — callers can verify any ZkRangeProof
    /// without submitting a deposit. Useful for frontend pre-validation.
    pub fn verify_range_proof(env: Env, proof: ZkRangeProof) -> bool {
        verify_range(&env, &proof)
    }

    // ─── Read-only queries ────────────────────────────────────────────────────

    /// Check whether a nullifier has been spent.
    pub fn is_nullifier_spent_fn(env: Env, nullifier: BytesN<32>) -> bool {
        is_nullifier_spent(&env, &nullifier)
    }

    /// Get the full ZkVaultEntry for an entry_id.
    pub fn get_entry_fn(env: Env, entry_id: u64) -> Result<ZkVaultEntry, ZkError> {
        require_entry(&env, entry_id)
    }

    /// Get the commitment hash for an entry (useful for withdrawal preparation).
    pub fn get_commitment(env: Env, entry_id: u64) -> Result<BytesN<32>, ZkError> {
        let entry = require_entry(&env, entry_id)?;
        Ok(entry.commitment)
    }

    /// List all entry IDs deposited by a given address.
    pub fn get_entries_by_depositor(env: Env, depositor: Address) -> Vec<u64> {
        get_depositor_entries(&env, &depositor)
    }

    /// Get the next entry ID that will be assigned on the next deposit.
    /// This allows off-chain provers to compute the correct nullifier before calling zk_deposit.
    pub fn get_next_entry_id(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&StoreKey::EntryCounter)
            .unwrap_or(0u64)
    }
}
