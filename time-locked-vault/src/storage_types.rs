use soroban_sdk::{contracttype, contracterror, Address};

#[contracttype]
pub enum DataKey {
    ProtocolOwner,
    VaultCounter,
    SupportedTokens,
    Vault(u64),
    OwnerVaults(Address),
    Treasury(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq)]
pub enum VaultError {
    // Initialisation
    AlreadyInitialized = 1,
    NotInitialized     = 2,

    // Input validation
    InvalidAmount      = 10,
    InvalidUnlockTime  = 11,
    UnsupportedToken   = 12,
    InvalidPenaltyRate = 13,

    // Vault lifecycle
    VaultNotFound      = 20,
    AlreadyWithdrawn   = 21,
    EarlyExitNotAllowed = 22,

    // Access control
    Unauthorized       = 30,

    // Treasury
    TreasuryEmpty      = 40,

    // Token transfer
    TransferFailed     = 50,
}
