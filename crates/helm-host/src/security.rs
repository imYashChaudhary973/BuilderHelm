pub struct SecureWebPreferences {
    pub sandbox: bool,
    pub context_isolation: bool,
    pub node_integration: bool,
    pub node_integration_in_worker: bool,
    pub web_security: bool,
    pub allow_running_insecure_content: bool,
    pub webview_tag: bool,
}

pub fn secure_web_preferences() -> SecureWebPreferences {
    SecureWebPreferences {
        sandbox: true,
        context_isolation: true,
        node_integration: false,
        node_integration_in_worker: false,
        web_security: true,
        allow_running_insecure_content: false,
        webview_tag: false,
    }
}

pub fn build_content_security_policy(dev: bool) -> String {
    [
        "default-src 'none'",
        "script-src 'self'",
        if dev {
            "style-src 'self' 'unsafe-inline'"
        } else {
            "style-src 'self'"
        },
        "img-src 'self' data:",
        "font-src 'self'",
        if dev {
            "connect-src 'self' ws: http://localhost:* ws://localhost:*"
        } else {
            "connect-src 'self'"
        },
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
    ]
    .join("; ")
}

#[cfg(test)]
mod tests {
    use super::{build_content_security_policy, secure_web_preferences};

    #[test]
    fn keeps_the_renderer_sandboxed_and_unprivileged() {
        let prefs = secure_web_preferences();
        assert!(prefs.sandbox);
        assert!(prefs.context_isolation);
        assert!(!prefs.node_integration);
        assert!(!prefs.node_integration_in_worker);
        assert!(prefs.web_security);
        assert!(!prefs.allow_running_insecure_content);
        assert!(!prefs.webview_tag);
    }

    #[test]
    fn denies_scripts_frames_objects_and_forms_by_default() {
        let policy = build_content_security_policy(false);
        assert!(policy.contains("default-src 'none'"));
        assert!(policy.contains("object-src 'none'"));
        assert!(policy.contains("frame-ancestors 'none'"));
        assert!(policy.contains("form-action 'none'"));
        assert!(!policy.contains("'unsafe-eval'"));
        assert!(!policy.contains("'unsafe-inline'"));
    }

    #[test]
    fn allows_dev_styles_without_script_eval() {
        let policy = build_content_security_policy(true);
        assert!(policy.contains("style-src 'self' 'unsafe-inline'"));
        assert!(!policy.contains("'unsafe-eval'"));
        assert!(policy.contains("object-src 'none'"));
        assert!(policy.contains("frame-ancestors 'none'"));
    }
}
