use std::path::PathBuf;

use rfd::{FileDialog, MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};

pub fn pick_directory(title: &str) -> Option<PathBuf> {
    FileDialog::new().set_title(title).pick_folder()
}

pub fn pick_file(title: &str) -> Option<PathBuf> {
    FileDialog::new().set_title(title).pick_file()
}

pub fn confirm_warning(title: &str, message: &str, detail: &str, confirm_label: &str) -> bool {
    let description = format!("{message}\n\n{detail}");
    is_approved(
        MessageDialog::new()
            .set_level(MessageLevel::Warning)
            .set_title(title)
            .set_description(&description)
            .set_buttons(MessageButtons::OkCancelCustom(
                confirm_label.to_string(),
                "Cancel".to_string(),
            ))
            .show(),
        confirm_label,
    )
}

fn is_approved(result: MessageDialogResult, confirm_label: &str) -> bool {
    match result {
        MessageDialogResult::Ok | MessageDialogResult::Yes => true,
        MessageDialogResult::Custom(label) => label == confirm_label,
        MessageDialogResult::No | MessageDialogResult::Cancel => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_approved;
    use rfd::MessageDialogResult;

    #[test]
    fn cancel_is_not_approval() {
        assert!(!is_approved(MessageDialogResult::Cancel, "Approve"));
        assert!(!is_approved(MessageDialogResult::No, "Approve"));
        assert!(is_approved(MessageDialogResult::Ok, "Approve"));
        assert!(is_approved(
            MessageDialogResult::Custom("Approve".into()),
            "Approve"
        ));
        assert!(!is_approved(
            MessageDialogResult::Custom("Cancel".into()),
            "Approve"
        ));
    }
}
