use soroban_sdk::Env;

pub struct Hex<'a>(pub &'a [u8]);

impl<'a> core::fmt::LowerHex for Hex<'a> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        for &byte in self.0 {
            write!(f, "{:02x}", byte)?;
        }
        Ok(())
    }
}

#[cfg(test)]
pub(crate) fn hex_to_bytes(hex_str: &str) -> [u8; 32] {
    let mut bytes = [0u8; 32];
    for (i, chunk) in hex_str.as_bytes().chunks(2).enumerate() {
        let byte_str = core::str::from_utf8(chunk).unwrap();
        bytes[i] = u8::from_str_radix(byte_str, 16).unwrap();
    }
    bytes
}

pub fn fr_to_hex(_env: &Env, _val: &[u8; 32]) -> alloc::string::String {
    #[cfg(feature = "std")]
    {
        hex::encode(val)
    }
    #[cfg(not(feature = "std"))]
    {
        alloc::string::String::new()
    }
}
