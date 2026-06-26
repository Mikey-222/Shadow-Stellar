use soroban_sdk::{contracttype, Address};

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum LockType {
    Strict,
    Penalty,
}

#[contracttype]
#[derive(Clone, PartialEq, Debug)]
pub enum VaultState {
    Active,
    Withdrawn,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Vault {
    pub owner: Address,
    pub token: Address,
    pub amount: i128,
    pub start_time: u64,
    pub unlock_time: u64,
    pub lock_type: LockType,
    pub penalty_rate: u32,
    pub state: VaultState,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct VaultCreatedEvent {
    pub vault_id: u64,
    pub owner: Address,
    pub token: Address,
    pub amount: i128,
    pub unlock_time: u64,
    pub lock_type: LockType,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct WithdrawnEvent {
    pub vault_id: u64,
    pub owner: Address,
    pub token: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct EarlyWithdrawnEvent {
    pub vault_id: u64,
    pub owner: Address,
    pub token: Address,
    pub amount: i128,
    pub penalty: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct TreasuryWithdrawnEvent {
    pub token: Address,
    pub amount: i128,
}
