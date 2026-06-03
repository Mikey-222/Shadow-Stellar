#[cfg(test)]
pub mod helpers {
    use soroban_sdk::{
        testutils::{Address as _, Ledger, LedgerInfo},
        token::StellarAssetClient,
        token::TokenClient,
        Address, Env, Vec,
    };
    use crate::{CcpContract, CcpContractClient};

    pub struct TestSetup {
        pub env: Env,
        pub client: CcpContractClient<'static>,
        pub xlm: Address,
        pub usdc: Address,
        pub eurc: Address,
    }

    impl TestSetup {
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

            let contract_id = env.register(CcpContract, ());
            let xlm = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
            let usdc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
            let eurc = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();

            let client = CcpContractClient::new(&env, &contract_id);
            client.initialize(&xlm, &usdc, &eurc);

            let env: Env = unsafe { core::mem::transmute(env) };
            let client: CcpContractClient<'static> = unsafe { core::mem::transmute(client) };

            TestSetup { env, client, xlm, usdc, eurc }
        }

        pub fn make_members(&self, n: u32, amount: i128) -> Vec<Address> {
            let mut members = Vec::new(&self.env);
            for _ in 0..n {
                let m = Address::generate(&self.env);
                StellarAssetClient::new(&self.env, &self.xlm).mint(&m, &amount);
                members.push_back(m);
            }
            members
        }

        pub fn advance_time(&self, delta: u64) {
            let ts = self.env.ledger().timestamp();
            let seq = self.env.ledger().sequence();
            self.env.ledger().set(LedgerInfo {
                timestamp: ts + delta,
                protocol_version: 22,
                sequence_number: seq + 1,
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
