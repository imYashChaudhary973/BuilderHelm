use helm_core::{SecretStore, ZERO_KEYCHAIN_SERVICE};
use helm_shared::{ZeroError, ZeroErrorCode, ZeroErrorOptions};

pub struct KeyringSecretStore;

impl KeyringSecretStore {
    fn entry(r#ref: &str) -> Result<keyring::Entry, ZeroError> {
        if !valid_secret_ref(r#ref) {
            return Err(ZeroError::new(
                ZeroErrorCode::ValidationFailed,
                "Invalid secure credential reference",
                ZeroErrorOptions::default(),
            ));
        }
        keyring::Entry::new(ZERO_KEYCHAIN_SERVICE, r#ref).map_err(keyring_failed)
    }
}

impl SecretStore for KeyringSecretStore {
    fn set(&self, r#ref: &str, secret: &str) -> Result<(), ZeroError> {
        Self::entry(r#ref)?
            .set_password(secret)
            .map_err(keyring_failed)
    }

    fn get(&self, r#ref: &str) -> Result<Option<String>, ZeroError> {
        map_get(Self::entry(r#ref)?.get_password())
    }

    fn delete(&self, r#ref: &str) -> Result<(), ZeroError> {
        map_delete(Self::entry(r#ref)?.delete_credential())
    }
}

fn valid_secret_ref(r#ref: &str) -> bool {
    let Some(rest) = r#ref.strip_prefix("zero.provider.") else {
        return false;
    };
    let Some(id) = rest.strip_suffix(".api-key") else {
        return false;
    };
    id.len() == 36
        && id
            .bytes()
            .all(|c| matches!(c, b'0'..=b'9' | b'a'..=b'f' | b'-'))
}

fn keyring_failed(_err: keyring::Error) -> ZeroError {
    ZeroError::new(
        ZeroErrorCode::IntegrationOffline,
        "Secure credential store is unavailable",
        ZeroErrorOptions::default(),
    )
}

fn map_get(result: Result<String, keyring::Error>) -> Result<Option<String>, ZeroError> {
    match result {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(keyring_failed(err)),
    }
}

fn map_delete(result: Result<(), keyring::Error>) -> Result<(), ZeroError> {
    match result {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(keyring_failed(err)),
    }
}

#[cfg(test)]
mod tests {
    use super::{keyring_failed, map_delete, map_get, valid_secret_ref, KeyringSecretStore};
    use helm_core::SecretStore;
    use helm_shared::ZeroErrorCode;

    const VALID: &str = "zero.provider.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.api-key";
    const SENTINEL: &str = "phase-one-secret-sentinel";

    #[test]
    fn rejects_invalid_refs_before_touching_the_store() {
        let store = KeyringSecretStore;
        for bad in [
            "",
            "plugin:github",
            SENTINEL,
            "zero.provider.not-a-uuid.api-key",
            "zero.provider.AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE.api-key",
            "zero.provider.aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.api-key.extra",
        ] {
            let err = store.set(bad, SENTINEL).expect_err(bad);
            assert_eq!(err.code, ZeroErrorCode::ValidationFailed);
            assert_eq!(err.message(), "Invalid secure credential reference");
            assert!(!err.message().contains(SENTINEL));
            assert!(!format!("{err:?}").contains(SENTINEL));
        }
        assert!(valid_secret_ref(VALID));
    }

    #[test]
    fn missing_entry_is_none_not_a_fallback() {
        assert_eq!(map_get(Err(keyring::Error::NoEntry)).unwrap(), None);
        assert_eq!(
            map_get(Ok("present".into())).unwrap().as_deref(),
            Some("present")
        );
        map_delete(Err(keyring::Error::NoEntry)).unwrap();
    }

    #[test]
    fn unavailable_store_fails_closed_without_secret_material() {
        let leaked = keyring::Error::BadEncoding(SENTINEL.as_bytes().to_vec());
        let err = map_get(Err(leaked)).expect_err("store down");
        assert_eq!(err.code, ZeroErrorCode::IntegrationOffline);
        assert_eq!(err.message(), "Secure credential store is unavailable");
        assert!(!err.message().contains(SENTINEL));
        assert!(!format!("{err:?}").contains(SENTINEL));
        let offline = keyring_failed(keyring::Error::NoDefaultStore);
        assert_eq!(offline.code, ZeroErrorCode::IntegrationOffline);
        assert!(!offline.message().contains(SENTINEL));
    }
}
