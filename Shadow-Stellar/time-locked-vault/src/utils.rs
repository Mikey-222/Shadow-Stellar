use soroban_sdk::{token, Address, Env};

/// Returns (payout, penalty) where:
///   penalty = floor(amount * penalty_rate / 10_000)
///   payout  = amount - penalty
/// Invariant: payout + penalty == amount (no value lost)
pub fn calculate_penalty(amount: i128, penalty_rate: u32) -> (i128, i128) {
    let penalty = amount * (penalty_rate as i128) / 10_000;
    let payout = amount - penalty;
    (payout, penalty)
}

/// Returns a token::Client for the given token address.
pub fn token_client<'a>(env: &'a Env, token_addr: &Address) -> token::Client<'a> {
    token::Client::new(env, token_addr)
}
