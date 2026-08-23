import { useState } from 'react';

export function EditorSidebar(): React.JSX.Element {
  const [file, setFile] = useState<{ path: string; name: string; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(): Promise<void> {
    setError(null);
    try {
      const next = await window.zero.editor.pick();
      if (next !== null) setFile(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Open failed');
    }
  }

  return (
    <aside className="editorSide" aria-label="Editor">
      <div className="editorBar">
        <span>{file?.name ?? 'No file'}</span>
        <button type="button" onClick={() => void open()}>
          Open
        </button>
      </div>
      {error !== null && (
        <p className="browserError" role="alert">
          {error}
        </p>
      )}
      {file === null ? (
        <p className="editorBody">Open a file to read it.</p>
      ) : (
        <textarea className="editorBody" readOnly value={file.text} spellCheck={false} />
      )}
    </aside>
  );
}
