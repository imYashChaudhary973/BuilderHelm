use std::collections::HashMap;
use std::sync::Mutex;

use helm_shared::{ZeroError, ZeroErrorCode};

use crate::error_convert::failed;

pub const ZERO_KEYCHAIN_SERVICE: &str = "app.zero-os.credentials";

pub trait SecretStore {
    fn set(&self, r#ref: &str, secret: &str) -> Result<(), ZeroError>;
    fn get(&self, r#ref: &str) -> Result<Option<String>, ZeroError>;
    fn delete(&self, r#ref: &str) -> Result<(), ZeroError>;
}

pub struct MemorySecretStore {
    values: Mutex<HashMap<String, String>>,
}

impl MemorySecretStore {
    pub fn new() -> Self {
        Self {
            values: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for MemorySecretStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SecretStore for MemorySecretStore {
    fn set(&self, r#ref: &str, secret: &str) -> Result<(), ZeroError> {
        self.values
            .lock()
            .expect("secret store")
            .insert(r#ref.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, r#ref: &str) -> Result<Option<String>, ZeroError> {
        Ok(self
            .values
            .lock()
            .expect("secret store")
            .get(r#ref)
            .cloned())
    }

    fn delete(&self, r#ref: &str) -> Result<(), ZeroError> {
        self.values.lock().expect("secret store").remove(r#ref);
        Ok(())
    }
}

fn keyring_failed(_err: keyring::Error) -> ZeroError {
    failed(
        ZeroErrorCode::IntegrationOffline,
        "Secure credential store is unavailable",
    )
}

pub struct KeychainSecretStore;

impl SecretStore for KeychainSecretStore {
    fn set(&self, r#ref: &str, secret: &str) -> Result<(), ZeroError> {
        let entry = keyring::Entry::new(ZERO_KEYCHAIN_SERVICE, r#ref).map_err(keyring_failed)?;
        entry.set_password(secret).map_err(keyring_failed)
    }

    fn get(&self, r#ref: &str) -> Result<Option<String>, ZeroError> {
        let entry = keyring::Entry::new(ZERO_KEYCHAIN_SERVICE, r#ref).map_err(keyring_failed)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(err) => Err(keyring_failed(err)),
        }
    }

    fn delete(&self, r#ref: &str) -> Result<(), ZeroError> {
        let entry = keyring::Entry::new(ZERO_KEYCHAIN_SERVICE, r#ref).map_err(keyring_failed)?;
        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(keyring_failed(err)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::keyring_failed;
    use helm_shared::ZeroErrorCode;

    const SENTINEL: &str = "phase-one-secret-sentinel";

    #[test]
    fn keyring_errors_do_not_include_secret_bytes() {
        let err = keyring_failed(keyring::Error::BadEncoding(SENTINEL.as_bytes().to_vec()));
        assert_eq!(err.code, ZeroErrorCode::IntegrationOffline);
        assert_eq!(err.message(), "Secure credential store is unavailable");
        assert!(!err.message().contains(SENTINEL));
        assert!(!format!("{err:?}").contains(SENTINEL));
    }
}
