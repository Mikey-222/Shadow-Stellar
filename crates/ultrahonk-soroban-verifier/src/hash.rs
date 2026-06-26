use soroban_sdk::{Bytes, BytesN};

#[inline(always)]
pub fn hash32(data: &Bytes) -> BytesN<32> {
    data.env().crypto().keccak256(data).to_bytes()
}
