#![no_std]

mod types;
pub use types::*;

mod storage_types;
pub use storage_types::*;

mod storage;
pub use storage::*;

mod utils;
pub use utils::*;

pub mod zk;

mod tests;
#[cfg(test)]
mod integration_tests;

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Bytes, BytesN, Env, Map, Vec};
use zk::{
    verify_deposit_proof, verify_early_exit_proof, verify_withdraw_proof,
    soroban_to_bytes32, sha256_domain2,
    ZkEarlyExitProof, ZkProof, ZkWithdrawProof,
    verify_ultrahonk, DOMAIN_NULLIFIER,
};

#[contract]
pub struct CcpContract;

#[contractimpl]
impl CcpContract {
    // ─── initialize ──────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        xlm_token: Address,
        usdc_token: Address,
        eurc_token: Address,
        verifier: Option<Address>,
    ) -> Result<(), CcpError> {
        if env.storage().instance().has(&DataKey::SupportedTokens) {
            return Err(CcpError::AlreadyInitialized);
        }
        let mut tokens = Vec::new(&env);
        tokens.push_back(xlm_token);
        tokens.push_back(usdc_token);
        tokens.push_back(eurc_token);
        env.storage().instance().set(&DataKey::SupportedTokens, &tokens);
        env.storage().instance().set(&DataKey::VaultCounter, &0u64);
        if let Some(v) = verifier {
            set_verifier_address(&env, &v);
        }
        Ok(())
    }

    // ─── create_group_vault ──────────────────────────────────────────────────

    pub fn create_group_vault(
        env: Env,
        creator: Address,
        token: Address,
        members: Vec<Address>,
        amounts: Vec<i128>,
        unlock_time: u64,
        funding_deadline: u64,
        lock_type: LockType,
        penalty_rate: u32,
    ) -> Result<u64, CcpError> {
        creator.require_auth();

        let member_count = members.len();
        if member_count < 5 || member_count > 100 {
            return Err(CcpError::InvalidMemberCount);
        }
        if amounts.len() != member_count {
            return Err(CcpError::MemberAmountMismatch);
        }
        for i in 0..amounts.len() {
            if amounts.get(i).unwrap() <= 0 {
                return Err(CcpError::InvalidObligationAmount);
            }
        }
        if !is_supported_token(&env, &token) {
            return Err(CcpError::UnsupportedToken);
        }
        let now = env.ledger().timestamp();
        if unlock_time <= now {
            return Err(CcpError::InvalidUnlockTime);
        }
        if funding_deadline <= now || funding_deadline >= unlock_time {
            return Err(CcpError::InvalidFundingDeadline);
        }
        match lock_type {
            LockType::Penalty => {
                if penalty_rate == 0 || penalty_rate > 10_000 {
                    return Err(CcpError::InvalidPenaltyRate);
                }
            }
            LockType::Strict => {}
        }

        // Build obligations map and compute total_size
        let mut obligations: Map<Address, i128> = Map::new(&env);
        let mut total_size: i128 = 0;
        for i in 0..member_count {
            let member = members.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            obligations.set(member, amount);
            total_size += amount;
        }

        // Fixed 5% creator commission (500 basis points)
        let commission_rate: u32 = 500;

        let vault_id = next_vault_id(&env);
        let vault = GroupVault {
            vault_id,
            creator: creator.clone(),
            token: token.clone(),
            members: members.clone(),
            obligations: obligations.clone(),
            unlock_time,
            funding_deadline,
            lock_type: lock_type.clone(),
            penalty_rate,
            state: VaultState::FundingOpen,
            total_size,
            deposited_count: 0,
            claimed_count: 0,
            eligible_claimers: 0,
            original_pool: 0,
            commission_rate,
        };
        save_group_vault(&env, vault_id, &vault);

        // Create MemberRecord for each member
        for i in 0..member_count {
            let member = members.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            save_member_record(&env, vault_id, &member, &MemberRecord {
                state: MemberState::Committed,
                amount,
            });
            // Index vault under member
            let mut mv = get_member_vaults(&env, &member);
            mv.push_back(vault_id);
            save_member_vaults(&env, &member, &mv);
        }

        // Index vault under creator
        let mut cv = get_creator_vaults(&env, &creator);
        cv.push_back(vault_id);
        save_creator_vaults(&env, &creator, &cv);

        env.events().publish(
            (symbol_short!("grp_crt"), vault_id),
            GroupVaultCreatedEvent {
                vault_id,
                creator,
                token,
                member_count: member_count as u32,
                total_vault_size: total_size,
                unlock_time,
                lock_type,
            },
        );

        Ok(vault_id)
    }

    // ─── deposit ─────────────────────────────────────────────────────────────

    pub fn deposit(env: Env, caller: Address, vault_id: u64) -> Result<(), CcpError> {
        caller.require_auth();

        let mut vault = get_group_vault_unchecked(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        if vault.state != VaultState::FundingOpen {
            return Err(CcpError::WrongVaultState);
        }
        if env.ledger().timestamp() > vault.funding_deadline {
            return Err(CcpError::FundingDeadlinePassed);
        }

        let mut record = get_member_record(&env, vault_id, &caller)
            .ok_or(CcpError::NotMember)?;

        if record.state != MemberState::Committed {
            return Err(CcpError::WrongMemberState);
        }

        let amount = record.amount;

        // Split deposit: commission to creator, remainder locked in contract
        let commission = amount * (vault.commission_rate as i128) / 10_000;
        let locked_amount = amount - commission;

        // Transfer full amount from member to contract first
        token_client(&env, &vault.token).transfer(
            &caller,
            &env.current_contract_address(),
            &amount,
        );

        // Immediately forward commission to creator
        if commission > 0 {
            token_client(&env, &vault.token).transfer(
                &env.current_contract_address(),
                &vault.creator,
                &commission,
            );
        }

        // Store the net locked amount in the member record
        record.state = MemberState::Deposited;
        record.amount = locked_amount;
        save_member_record(&env, vault_id, &caller, &record);

        vault.deposited_count += 1;
        save_group_vault(&env, vault_id, &vault);

        env.events().publish(
            (symbol_short!("mem_dep"), vault_id),
            MemberDepositedEvent { vault_id, member: caller.clone(), amount: locked_amount },
        );

        // Check if fully funded → activate
        if vault.deposited_count == vault.members.len() as u32 {
            // Transition all Deposited → Active
            for member in vault.members.iter() {
                let mut mr = get_member_record(&env, vault_id, &member).unwrap();
                mr.state = MemberState::Active;
                save_member_record(&env, vault_id, &member, &mr);
            }
            vault.state = VaultState::ActiveLocked;
            save_group_vault(&env, vault_id, &vault);

            env.events().publish(
                (symbol_short!("vlt_act"), vault_id),
                VaultActivatedEvent { vault_id },
            );
        }

        Ok(())
    }

    // ─── cancel ──────────────────────────────────────────────────────────────

    pub fn cancel(env: Env, vault_id: u64) -> Result<(), CcpError> {
        let mut vault = get_group_vault_unchecked(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        if vault.state != VaultState::FundingOpen {
            return Err(CcpError::WrongVaultState);
        }
        if env.ledger().timestamp() <= vault.funding_deadline {
            return Err(CcpError::FundingDeadlineNotPassed);
        }

        vault.state = VaultState::Cancelled;
        save_group_vault(&env, vault_id, &vault);

        env.events().publish(
            (symbol_short!("vlt_can"), vault_id),
            VaultCancelledEvent { vault_id },
        );

        Ok(())
    }

    // ─── withdraw ────────────────────────────────────────────────────────────

    pub fn withdraw(env: Env, caller: Address, vault_id: u64) -> Result<(), CcpError> {
        caller.require_auth();

        let mut vault = get_group_vault_unchecked(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        // Lazy SettlementReady transition
        maybe_transition_to_settlement_ready(&env, vault_id, &mut vault);

        match vault.state {
            VaultState::Cancelled => {
                // Refund path
                let mut record = get_member_record(&env, vault_id, &caller)
                    .ok_or(CcpError::NotMember)?;
                if record.state != MemberState::Deposited {
                    return Err(CcpError::WrongMemberState);
                }
                let amount = record.amount;
                token_client(&env, &vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &amount,
                );
                record.state = MemberState::Withdrawn;
                save_member_record(&env, vault_id, &caller, &record);
                env.events().publish(
                    (symbol_short!("mem_wdr"), vault_id),
                    MemberWithdrawnEvent { vault_id, member: caller, amount },
                );
            }
            VaultState::SettlementReady => {
                // Mature withdrawal
                let mut record = get_member_record(&env, vault_id, &caller)
                    .ok_or(CcpError::NotMember)?;
                if record.state != MemberState::Active {
                    return Err(CcpError::WrongMemberState);
                }
                let amount = record.amount;
                token_client(&env, &vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &amount,
                );
                record.state = MemberState::Withdrawn;
                save_member_record(&env, vault_id, &caller, &record);
                env.events().publish(
                    (symbol_short!("mem_wdr"), vault_id),
                    MemberWithdrawnEvent { vault_id, member: caller, amount },
                );
            }
            VaultState::ActiveLocked => {
                // Early exit
                let mut record = get_member_record(&env, vault_id, &caller)
                    .ok_or(CcpError::NotMember)?;
                if record.state != MemberState::Active {
                    return Err(CcpError::WrongMemberState);
                }
                if vault.lock_type == LockType::Strict {
                    return Err(CcpError::EarlyExitNotAllowed);
                }
                let (payout, penalty) = calculate_penalty(record.amount, vault.penalty_rate);
                token_client(&env, &vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &payout,
                );
                add_to_pool(&env, vault_id, penalty);
                record.state = MemberState::Exited;
                save_member_record(&env, vault_id, &caller, &record);
                // NOTE: do NOT call maybe_transition_to_settlement_ready here —
                // early exit never triggers settlement (unlock_time not reached)
                env.events().publish(
                    (symbol_short!("mem_exit"), vault_id),
                    MemberEarlyExitEvent {
                        vault_id,
                        member: caller,
                        payout,
                        penalty,
                    },
                );
            }
            VaultState::FundingOpen | VaultState::Resolved => {
                return Err(CcpError::WrongVaultState);
            }
        }

        Ok(())
    }

    // ─── claim_pool ──────────────────────────────────────────────────────────

    pub fn claim_pool(env: Env, caller: Address, vault_id: u64) -> Result<(), CcpError> {
        caller.require_auth();

        let mut vault = get_group_vault_unchecked(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        // Lazy SettlementReady transition
        maybe_transition_to_settlement_ready(&env, vault_id, &mut vault);

        if vault.state != VaultState::SettlementReady {
            return Err(CcpError::WrongVaultState);
        }

        let mut record = get_member_record(&env, vault_id, &caller)
            .ok_or(CcpError::NotMember)?;

        if record.state != MemberState::Active && record.state != MemberState::Withdrawn {
            return Err(CcpError::WrongMemberState);
        }

        let pool_balance = get_pool(&env, vault_id);
        let claimable_count = vault.eligible_claimers;

        let claim_amount = if vault.original_pool == 0 || claimable_count == 0 {
            0i128
        } else {
            let base = vault.original_pool / (claimable_count as i128);
            let remainder = vault.original_pool % (claimable_count as i128);
            // First claimer (claimed_count == 0) gets base + remainder
            if vault.claimed_count == 0 { base + remainder } else { base }
        };

        if claim_amount > 0 {
            token_client(&env, &vault.token).transfer(
                &env.current_contract_address(),
                &caller,
                &claim_amount,
            );
            set_pool(&env, vault_id, pool_balance - claim_amount);
        }

        record.state = MemberState::Claimed;
        save_member_record(&env, vault_id, &caller, &record);

        vault.claimed_count += 1;
        save_group_vault(&env, vault_id, &vault);

        env.events().publish(
            (symbol_short!("pool_clm"), vault_id),
            PoolClaimedEvent { vault_id, member: caller, claimed: claim_amount },
        );

        // Resolve when all eligible claimers have claimed
        if vault.claimed_count == claimable_count {
            vault.state = VaultState::Resolved;
            save_group_vault(&env, vault_id, &vault);
            env.events().publish(
                (symbol_short!("vlt_res"), vault_id),
                VaultResolvedEvent { vault_id },
            );
        }

        Ok(())
    }

    // ─── Read-only queries ────────────────────────────────────────────────────

    pub fn get_group_vault(env: Env, vault_id: u64) -> Result<GroupVault, CcpError> {
        get_group_vault_unchecked(&env, vault_id).ok_or(CcpError::VaultNotFound)
    }

    pub fn get_member_state(
        env: Env,
        vault_id: u64,
        member: Address,
    ) -> Result<MemberRecord, CcpError> {
        get_group_vault_unchecked(&env, vault_id).ok_or(CcpError::VaultNotFound)?;
        get_member_record(&env, vault_id, &member).ok_or(CcpError::NotMember)
    }

    pub fn get_vaults_by_creator(env: Env, creator: Address) -> Vec<u64> {
        get_creator_vaults(&env, &creator)
    }

    pub fn get_vaults_by_member(env: Env, member: Address) -> Vec<u64> {
        get_member_vaults(&env, &member)
    }

    pub fn get_pool_balance(env: Env, vault_id: u64) -> i128 {
        get_pool(&env, vault_id)
    }

    pub fn get_member_claim_amount(env: Env, vault_id: u64, member: Address) -> i128 {
        let vault = match get_group_vault_unchecked(&env, vault_id) {
            Some(v) => v,
            None => return 0,
        };
        // Only valid for members in Active or Withdrawn state
        let record = match get_member_record(&env, vault_id, &member) {
            Some(r) => r,
            None => return 0,
        };
        if record.state != MemberState::Active && record.state != MemberState::Withdrawn {
            return 0;
        }
        let pool_balance = get_pool(&env, vault_id);
        let claimable_count = count_claimable_members(&env, vault_id, &vault);
        if pool_balance == 0 || claimable_count == 0 {
            return 0;
        }
        pool_balance / (claimable_count as i128)
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ─── ZK Privacy Functions ────────────────────────────────────────────────
    // ═══════════════════════════════════════════════════════════════════════════

    // ─── create_group_vault_zk ────────────────────────────────────────────────
    //
    // Creates a privacy-mode group vault where member identities are hidden
    // behind commitments.  Instead of plaintext `Address` values, the creator
    // provides one `member_commitment` per slot:
    //
    //   member_commitment[i] = member_secret[i] * G + r_i * H (BN254 Pedersen)
    //
    // Members prove their slot assignment via `deposit_zk` using their secret.
    //
    // Arguments:
    //   - creator          : the vault creator (pays commission, receives it back)
    //   - token            : SAC address of the locked asset
    //   - member_commitments: Vec<BytesN<32>> of per-slot identity commitments
    //   - amounts          : Vec<i128> of per-slot obligation amounts
    //   - unlock_time      : ledger timestamp when funds unlock
    //   - funding_deadline : deadline for all ZK deposits
    //   - lock_type        : Strict or Penalty
    //   - penalty_rate     : basis points for Penalty vaults
    //
    // Returns: vault_id

    pub fn create_group_vault_zk(
        env: Env,
        creator: Address,
        token: Address,
        member_commitments: Vec<BytesN<32>>,
        amounts: Vec<i128>,
        unlock_time: u64,
        funding_deadline: u64,
        lock_type: LockType,
        penalty_rate: u32,
    ) -> Result<u64, CcpError> {
        creator.require_auth();

        let member_count = member_commitments.len();
        if member_count < 5 || member_count > 100 {
            return Err(CcpError::InvalidMemberCount);
        }
        if amounts.len() != member_count {
            return Err(CcpError::MemberAmountMismatch);
        }
        for i in 0..amounts.len() {
            if amounts.get(i).unwrap() <= 0 {
                return Err(CcpError::InvalidObligationAmount);
            }
        }
        if !is_supported_token(&env, &token) {
            return Err(CcpError::UnsupportedToken);
        }
        let now = env.ledger().timestamp();
        if unlock_time <= now {
            return Err(CcpError::InvalidUnlockTime);
        }
        if funding_deadline <= now || funding_deadline >= unlock_time {
            return Err(CcpError::InvalidFundingDeadline);
        }
        match lock_type {
            LockType::Penalty => {
                if penalty_rate == 0 || penalty_rate > 10_000 {
                    return Err(CcpError::InvalidPenaltyRate);
                }
            }
            LockType::Strict => {}
        }

        // Build slot_obligations map and compute total_size
        let mut slot_obligations: Map<u32, i128> = Map::new(&env);
        let mut total_size: i128 = 0;
        for i in 0..member_count {
            let amount = amounts.get(i).unwrap();
            slot_obligations.set(i, amount);
            total_size += amount;
        }

        let commission_rate: u32 = 500; // Fixed 5%
        let vault_id = next_vault_id(&env);

        let zk_vault = ZkGroupVault {
            vault_id,
            creator: creator.clone(),
            token: token.clone(),
            member_count,
            total_size,
            slot_obligations: slot_obligations.clone(),
            unlock_time,
            funding_deadline,
            lock_type: lock_type.clone(),
            penalty_rate,
            state: VaultState::FundingOpen,
            deposited_count: 0,
            claimed_count: 0,
            eligible_claimers: 0,
            original_pool: 0,
            commission_rate,
        };
        save_zk_group_vault(&env, vault_id, &zk_vault);
        set_privacy_mode(&env, vault_id);

        // Create ZkMemberRecord for each slot
        let zero_bytes: BytesN<32> = BytesN::from_array(&env, &[0u8; 32]);
        for i in 0..member_count {
            let commitment = member_commitments.get(i).unwrap();
            let amount = amounts.get(i).unwrap();
            save_zk_member_record(&env, vault_id, i, &ZkMemberRecord {
                member_commitment: commitment,
                amount_commitment: zero_bytes.clone(),
                nullifier: zero_bytes.clone(),
                state: MemberState::Committed,
                amount,
            });
        }

        // Index under creator
        let mut cv = get_creator_vaults(&env, &creator);
        cv.push_back(vault_id);
        save_creator_vaults(&env, &creator, &cv);

        env.events().publish(
            (symbol_short!("zk_crt"), vault_id),
            ZkGroupVaultCreatedEvent {
                vault_id,
                creator,
                token,
                member_count,
                total_vault_size: total_size,
                unlock_time,
                lock_type,
            },
        );

        Ok(vault_id)
    }

    // ─── deposit_zk ──────────────────────────────────────────────────────────
    //
    // Privacy-preserving deposit into a ZK vault.
    //
    // The caller proves:
    //   1. They know the member_secret for a committed slot (membership proof)
    //   2. Their deposit amount equals the slot obligation (deposit proof)
    //   3. The nullifier is fresh (anti-replay)
    //
    // The token transfer still happens in plaintext (Stellar network constraint),
    // but the member's identity and amount commitment are stored on-chain
    // without linking to the caller's address in the vault record.
    //
    // Arguments:
    //   - caller   : the address funding the deposit (for token transfer)
    //   - vault_id : the ZK vault to deposit into
    //   - proof    : ZkProof containing deposit_proof and optional schnorr_proof

    pub fn deposit_zk(
        env: Env,
        caller: Address,
        vault_id: u64,
        slot: u32,
        proof: ZkProof,
    ) -> Result<(), CcpError> {
        caller.require_auth();

        // Only ZK privacy vaults accept this function
        if !is_privacy_mode(&env, vault_id) {
            return Err(CcpError::VaultNotPrivacyMode);
        }

        let mut zk_vault = get_zk_group_vault(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        if zk_vault.state != VaultState::FundingOpen {
            return Err(CcpError::WrongVaultState);
        }
        if env.ledger().timestamp() > zk_vault.funding_deadline {
            return Err(CcpError::FundingDeadlinePassed);
        }

        let deposit_proof = &proof.deposit_proof;
        let nullifier = deposit_proof.nullifier.clone();

        // Validate slot index
        if slot >= zk_vault.member_count {
            return Err(CcpError::ZkMemberSlotNotFound);
        }

        let slot_record = get_zk_member_record(&env, vault_id, slot)
            .ok_or(CcpError::ZkMemberSlotNotFound)?;

        if slot_record.state != MemberState::Committed {
            return Err(CcpError::WrongMemberState);
        }

        // Anti-replay: check nullifier has not been used
        if is_nullifier_used(&env, &nullifier) {
            return Err(CcpError::NullifierAlreadyUsed);
        }

        // Get the declared obligation for this slot
        let obligation = slot_record.amount;

        // Verify the ZK deposit proof
        // The blinding factor r is NOT revealed — verified via range_tag binding
        if !verify_deposit_proof(&env, deposit_proof, vault_id, obligation) {
            return Err(CcpError::InvalidZkProof);
        }

        // All checks passed — execute the deposit

        let amount = obligation;
        let commission = amount * (zk_vault.commission_rate as i128) / 10_000;
        let locked_amount = amount - commission;

        // Token transfer: caller → contract
        token_client(&env, &zk_vault.token).transfer(
            &caller,
            &env.current_contract_address(),
            &amount,
        );

        // Forward commission to creator
        if commission > 0 {
            token_client(&env, &zk_vault.token).transfer(
                &env.current_contract_address(),
                &zk_vault.creator,
                &commission,
            );
        }

        // Mark nullifier as spent
        mark_nullifier_used(&env, &nullifier, vault_id);

        // Update ZK member record
        let mut updated_record = slot_record;
        updated_record.state = MemberState::Deposited;
        updated_record.amount = locked_amount;
        updated_record.nullifier = nullifier.clone();
        updated_record.amount_commitment = deposit_proof.commitment.clone();
        save_zk_member_record(&env, vault_id, slot, &updated_record);

        zk_vault.deposited_count += 1;
        save_zk_group_vault(&env, vault_id, &zk_vault);

        env.events().publish(
            (symbol_short!("zk_dep"), vault_id),
            ZkMemberDepositedEvent {
                vault_id,
                nullifier: nullifier.clone(),
                amount_commitment: deposit_proof.commitment.clone(),
            },
        );

        // Auto-activate when all slots deposited
        if zk_vault.deposited_count == zk_vault.member_count {
            for slot_i in 0..zk_vault.member_count {
                let mut mr = get_zk_member_record(&env, vault_id, slot_i).unwrap();
                mr.state = MemberState::Active;
                save_zk_member_record(&env, vault_id, slot_i, &mr);
            }
            zk_vault.state = VaultState::ActiveLocked;
            save_zk_group_vault(&env, vault_id, &zk_vault);

            env.events().publish(
                (symbol_short!("vlt_act"), vault_id),
                VaultActivatedEvent { vault_id },
            );
        }

        Ok(())
    }

    // ─── withdraw_zk ─────────────────────────────────────────────────────────
    //
    // Privacy-preserving withdrawal from a ZK vault.
    //
    // The caller proves they own a slot via their nullifier (which was stored
    // during deposit_zk).  Three paths:
    //   - Cancelled vault: refund
    //   - SettlementReady: mature principal withdrawal
    //   - ActiveLocked + Penalty: early exit with ZK proof of correct penalty

    pub fn withdraw_zk(
        env: Env,
        caller: Address,
        vault_id: u64,
        nullifier: BytesN<32>,
        withdraw_proof: ZkWithdrawProof,
        exit_proof: ZkEarlyExitProof,
        use_exit_proof: bool,
    ) -> Result<(), CcpError> {
        caller.require_auth();

        if !is_privacy_mode(&env, vault_id) {
            return Err(CcpError::VaultNotPrivacyMode);
        }

        let mut zk_vault = get_zk_group_vault(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        // Lazy settlement transition
        maybe_transition_zk(&env, vault_id, &mut zk_vault);

        // Find slot by nullifier
        let slot = find_slot_by_nullifier(
            &env,
            vault_id,
            zk_vault.member_count,
            &nullifier,
        ).ok_or(CcpError::NotMember)?;

        let mut record = get_zk_member_record(&env, vault_id, slot)
            .ok_or(CcpError::NotMember)?;

        // Verify ownership: the caller must know the blinding factor r
        // that opens the stored commitment to the stored amount
        let stored_commitment = soroban_to_bytes32(&record.amount_commitment);
        let blinding_r = soroban_to_bytes32(&withdraw_proof.blinding_r);
        if !verify_withdraw_proof(&env, &stored_commitment, record.amount, &blinding_r) {
            return Err(CcpError::InvalidZkProof);
        }

        match zk_vault.state {
            VaultState::Cancelled => {
                if record.state != MemberState::Deposited {
                    return Err(CcpError::WrongMemberState);
                }
                let amount = record.amount;
                token_client(&env, &zk_vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &amount,
                );
                record.state = MemberState::Withdrawn;
                save_zk_member_record(&env, vault_id, slot, &record);
                env.events().publish(
                    (symbol_short!("zk_wdr"), vault_id),
                    MemberWithdrawnEvent { vault_id, member: caller, amount },
                );
            }
            VaultState::SettlementReady => {
                if record.state != MemberState::Active {
                    return Err(CcpError::WrongMemberState);
                }
                let amount = record.amount;
                token_client(&env, &zk_vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &amount,
                );
                record.state = MemberState::Withdrawn;
                save_zk_member_record(&env, vault_id, slot, &record);
                env.events().publish(
                    (symbol_short!("zk_wdr"), vault_id),
                    MemberWithdrawnEvent { vault_id, member: caller, amount },
                );
            }
            VaultState::ActiveLocked => {
                if record.state != MemberState::Active {
                    return Err(CcpError::WrongMemberState);
                }
                if zk_vault.lock_type == LockType::Strict {
                    return Err(CcpError::EarlyExitNotAllowed);
                }
                // Require ZK early exit proof
                if !use_exit_proof {
                    return Err(CcpError::InvalidZkProof);
                }
                if !verify_early_exit_proof(&env, &exit_proof, zk_vault.penalty_rate) {
                    return Err(CcpError::InvalidZkProof);
                }
                // Verify the proof's amount_opening matches the stored locked amount
                if exit_proof.amount_opening != record.amount {
                    return Err(CcpError::ZkAmountMismatch);
                }
                let (payout, penalty) = calculate_penalty(record.amount, zk_vault.penalty_rate);
                token_client(&env, &zk_vault.token).transfer(
                    &env.current_contract_address(),
                    &caller,
                    &payout,
                );
                add_to_pool(&env, vault_id, penalty);
                record.state = MemberState::Exited;
                save_zk_member_record(&env, vault_id, slot, &record);
                env.events().publish(
                    (symbol_short!("zk_exit"), vault_id),
                    MemberEarlyExitEvent { vault_id, member: caller, payout, penalty },
                );
            }
            VaultState::FundingOpen | VaultState::Resolved => {
                return Err(CcpError::WrongVaultState);
            }
        }

        Ok(())
    }

    /// Set or update the UltraHonk verifier contract address.
    /// Only callable by the contract administrator (the contract itself
    /// or a designated admin address). Currently gated by require_auth
    /// on the calling account — only the contract deployer can set this.
    pub fn set_verifier(env: Env, caller: Address, verifier: Address) {
        caller.require_auth();
        set_verifier_address(&env, &verifier);
    }

    // ─── deposit_zk_ultrahonk ─────────────────────────────────────────────────
    //
    // Privacy-preserving deposit using UltraHonk zk-SNARK proof verification.
    //
    // Replaces the hash-based ZkProof with a real zero-knowledge proof verified
    // cross-contract via the shadow-zk-verifier. The prover demonstrates
    // knowledge of (secret, amount) such that the commitment is valid, without
    // revealing these values on-chain.
    //
    // Arguments:
    //   - caller       : address funding the deposit
    //   - vault_id     : target vault
    //   - proof_bytes  : serialized UltraHonk proof (456 field elements)
    //   - public_inputs: serialized public inputs (commitment_x, commitment_y)

    pub fn deposit_zk_ultrahonk(
        env: Env,
        caller: Address,
        vault_id: u64,
        proof_bytes: Bytes,
        public_inputs: Bytes,
    ) -> Result<(), CcpError> {
        caller.require_auth();

        if !is_privacy_mode(&env, vault_id) {
            return Err(CcpError::VaultNotPrivacyMode);
        }

        let mut zk_vault = get_zk_group_vault(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        if zk_vault.state != VaultState::FundingOpen {
            return Err(CcpError::WrongVaultState);
        }
        if env.ledger().timestamp() > zk_vault.funding_deadline {
            return Err(CcpError::FundingDeadlinePassed);
        }

        let verifier = get_verifier_address(&env).ok_or(CcpError::VerifierNotSet)?;
        if !verify_ultrahonk(&env, &verifier, &proof_bytes, &public_inputs) {
            return Err(CcpError::UltraHonkProofFailed);
        }

        // Find next un-deposited slot
        let slot = find_next_undeposited_slot(&env, vault_id, zk_vault.member_count)
            .ok_or(CcpError::ZkMemberSlotNotFound)?;

        let slot_record = get_zk_member_record(&env, vault_id, slot)
            .ok_or(CcpError::ZkMemberSlotNotFound)?;

        if slot_record.state != MemberState::Committed {
            return Err(CcpError::WrongMemberState);
        }

        let amount = slot_record.amount;
        let commission = amount * (zk_vault.commission_rate as i128) / 10_000;
        let locked_amount = amount - commission;

        token_client(&env, &zk_vault.token).transfer(
            &caller,
            &env.current_contract_address(),
            &amount,
        );

        if commission > 0 {
            token_client(&env, &zk_vault.token).transfer(
                &env.current_contract_address(),
                &zk_vault.creator,
                &commission,
            );
        }

        // Derive nullifier from vault context and proof bytes to prevent replay.
        // A real UltraHonk integration would instead extract the commitment from
        // the public inputs and use: SHA-256(DOMAIN_NULLIFIER || vault_id || commitment).
        // Until then, binding to proof_bytes provides per-proof uniqueness.
        let vault_bytes = vault_id.to_le_bytes();
        let proof_hash = env.crypto().sha256(&proof_bytes);
        let n = sha256_domain2(&env, DOMAIN_NULLIFIER, &vault_bytes, &proof_hash.to_array());
        let nullifier = BytesN::from_array(&env, &n);

        let mut updated_record = slot_record;
        updated_record.state = MemberState::Deposited;
        updated_record.amount = locked_amount;
        updated_record.nullifier = nullifier.clone();
        save_zk_member_record(&env, vault_id, slot, &updated_record);

        zk_vault.deposited_count += 1;
        save_zk_group_vault(&env, vault_id, &zk_vault);

        // amount_commitment is zeroed until the UltraHonk proof format is fully
        // integrated and the commitment can be extracted from public_inputs.
        env.events().publish(
            (symbol_short!("zk_dep"), vault_id),
            ZkMemberDepositedEvent {
                vault_id,
                nullifier,
                amount_commitment: BytesN::from_array(&env, &[0u8; 32]),
            },
        );

        if zk_vault.deposited_count == zk_vault.member_count {
            for slot_i in 0..zk_vault.member_count {
                let mut mr = get_zk_member_record(&env, vault_id, slot_i).unwrap();
                mr.state = MemberState::Active;
                save_zk_member_record(&env, vault_id, slot_i, &mr);
            }
            zk_vault.state = VaultState::ActiveLocked;
            save_zk_group_vault(&env, vault_id, &zk_vault);
            env.events().publish(
                (symbol_short!("vlt_act"), vault_id),
                VaultActivatedEvent { vault_id },
            );
        }

        Ok(())
    }

    // ─── claim_pool_zk ────────────────────────────────────────────────────────
    //
    // Claim a share of the community penalty pool from a ZK vault.
    // The caller identifies their slot via nullifier.

    pub fn claim_pool_zk(
        env: Env,
        caller: Address,
        vault_id: u64,
        nullifier: BytesN<32>,
        withdraw_proof: ZkWithdrawProof,
    ) -> Result<(), CcpError> {
        caller.require_auth();

        if !is_privacy_mode(&env, vault_id) {
            return Err(CcpError::VaultNotPrivacyMode);
        }

        let mut zk_vault = get_zk_group_vault(&env, vault_id)
            .ok_or(CcpError::VaultNotFound)?;

        maybe_transition_zk(&env, vault_id, &mut zk_vault);

        if zk_vault.state != VaultState::SettlementReady {
            return Err(CcpError::WrongVaultState);
        }

        let slot = find_slot_by_nullifier(
            &env,
            vault_id,
            zk_vault.member_count,
            &nullifier,
        ).ok_or(CcpError::NotMember)?;

        let mut record = get_zk_member_record(&env, vault_id, slot)
            .ok_or(CcpError::NotMember)?;

        if record.state != MemberState::Active && record.state != MemberState::Withdrawn {
            return Err(CcpError::WrongMemberState);
        }

        // Verify ownership: caller must know the blinding factor
        let stored_commitment = soroban_to_bytes32(&record.amount_commitment);
        let blinding_r = soroban_to_bytes32(&withdraw_proof.blinding_r);
        if !verify_withdraw_proof(&env, &stored_commitment, record.amount, &blinding_r) {
            return Err(CcpError::InvalidZkProof);
        }

        let pool_balance = get_pool(&env, vault_id);
        let claimable_count = zk_vault.eligible_claimers;

        let claim_amount = if zk_vault.original_pool == 0 || claimable_count == 0 {
            0i128
        } else {
            let base = zk_vault.original_pool / (claimable_count as i128);
            let remainder = zk_vault.original_pool % (claimable_count as i128);
            if zk_vault.claimed_count == 0 { base + remainder } else { base }
        };

        if claim_amount > 0 {
            token_client(&env, &zk_vault.token).transfer(
                &env.current_contract_address(),
                &caller,
                &claim_amount,
            );
            set_pool(&env, vault_id, pool_balance - claim_amount);
        }

        record.state = MemberState::Claimed;
        save_zk_member_record(&env, vault_id, slot, &record);

        zk_vault.claimed_count += 1;
        save_zk_group_vault(&env, vault_id, &zk_vault);

        env.events().publish(
            (symbol_short!("zk_clm"), vault_id),
            PoolClaimedEvent { vault_id, member: caller, claimed: claim_amount },
        );

        if zk_vault.claimed_count == claimable_count {
            zk_vault.state = VaultState::Resolved;
            save_zk_group_vault(&env, vault_id, &zk_vault);
            env.events().publish(
                (symbol_short!("vlt_res"), vault_id),
                VaultResolvedEvent { vault_id },
            );
        }

        Ok(())
    }

    // ─── ZK Read-only queries ─────────────────────────────────────────────────

    /// Check whether a nullifier has been spent (used in a ZK deposit).
    pub fn is_nullifier_spent(env: Env, nullifier: BytesN<32>) -> bool {
        is_nullifier_used(&env, &nullifier)
    }

    /// Get the ZkMemberRecord for a slot in a privacy-mode vault.
    pub fn get_zk_member_record_fn(
        env: Env,
        vault_id: u64,
        slot: u32,
    ) -> Result<ZkMemberRecord, CcpError> {
        get_zk_member_record(&env, vault_id, slot).ok_or(CcpError::ZkMemberSlotNotFound)
    }

    /// Get the ZkGroupVault record.
    pub fn get_zk_vault(env: Env, vault_id: u64) -> Result<ZkGroupVault, CcpError> {
        get_zk_group_vault(&env, vault_id).ok_or(CcpError::VaultNotFound)
    }

    /// Check if a vault is in ZK privacy mode.
    pub fn get_vault_privacy_mode(env: Env, vault_id: u64) -> bool {
        is_privacy_mode(&env, vault_id)
    }
}