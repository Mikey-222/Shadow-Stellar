#[cfg(test)]
pub mod helpers {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token::StellarAssetClient,
        token::TokenClient,
        Address, Env,
    };

    use crate::{VaultContract, VaultContractClient};

    pub struct TestEnv {
        pub env: Env,
        pub client: VaultContractClient<'static>,
        pub xlm: Address,
        pub usdc: Address,
        pub eurc: Address,
        pub protocol_owner: Address,
    }

    impl TestEnv {
        pub fn new() -> Self {
            let env = Env::default();
            env.mock_all_auths();

            env.ledger().set(LedgerInfo {
                timestamp: 1_000_000,
                protocol_version: 22,
                sequence_number: 1,
                network_id: Default::default(),
                base_reserve: 10,
                min_temp_entry_ttl: 6_312_000,
                min_persistent_entry_ttl: 6_312_000,
                max_entry_ttl: 6_312_000,
            });

            let contract_id = env.register(VaultContract, ());

            let xlm_admin = Address::generate(&env);
            let usdc_admin = Address::generate(&env);
            let eurc_admin = Address::generate(&env);

            let xlm = env.register_stellar_asset_contract_v2(xlm_admin).address();
            let usdc = env.register_stellar_asset_contract_v2(usdc_admin).address();
            let eurc = env.register_stellar_asset_contract_v2(eurc_admin).address();

            let protocol_owner = Address::generate(&env);

            let client = VaultContractClient::new(&env, &contract_id);
            client.initialize(&protocol_owner, &xlm, &usdc, &eurc);

            // SAFETY: standard Soroban test pattern — env outlives the test function
            let env: Env = unsafe { core::mem::transmute(env) };
            let client: VaultContractClient<'static> = unsafe { core::mem::transmute(client) };

            TestEnv { env, client, xlm, usdc, eurc, protocol_owner }
        }

        pub fn create_funded_user(&self, amount: i128) -> Address {
            let user = Address::generate(&self.env);
            StellarAssetClient::new(&self.env, &self.xlm).mint(&user, &amount);
            user
        }

        pub fn mint_token(&self, token: &Address, to: &Address, amount: i128) {
            StellarAssetClient::new(&self.env, token).mint(to, &amount);
        }

        pub fn advance_time(&self, delta: u64) {
            let current = self.env.ledger().timestamp();
            self.env.ledger().set(LedgerInfo {
                timestamp: current + delta,
                protocol_version: 22,
                sequence_number: self.env.ledger().sequence() + 1,
                network_id: Default::default(),
                base_reserve: 10,
                min_temp_entry_ttl: 6_312_000,
                min_persistent_entry_ttl: 6_312_000,
                max_entry_ttl: 6_312_000,
            });
        }

        pub fn token_balance(&self, token: &Address, addr: &Address) -> i128 {
            TokenClient::new(&self.env, token).balance(addr)
        }
    }
}
