# Voice

Status: working on macOS. Dictation captures the chosen microphone, transcribes
locally or in the cloud, and inserts the text into the focused field or terminal
pane.

## Decision

Speech-to-text is an in-app dictation feature, not a separate product. Local
models run in Electron main through sherpa-onnx and never leave the device.
Cloud models (GPT-4o Transcribe / Mini) upload audio to OpenAI only after the
user stores an API key and gives first-run consent.

```text
mic (renderer) -> 16 kHz mono PCM -> IPC wav bytes
  local: sherpa-onnx in main
  cloud: OpenAI audio/transcriptions, after key + consent
-> insert into focused field or board.write PTY
```

## V1 scope

- Toggle (`globalShortcut`) and hold (focused-window key events).
- Level meter, silence guard, cancel, listen timeout.
- HUD with `aria-live` state and reduced-motion.
- Permission-denied copy that names System Settings.
- Local models never send audio off-device.
- Cloud upload blocked until the user agrees.

## Privacy

- Microphone permission is requested only to capture or to list devices.
- Local engines (Parakeet, Zipformer, Whisper Tiny) stay on-device. Audio is
  not written to a durable cache and is not uploaded.
- Cloud engines send the clip to OpenAI. First-run consent is stored in
  `voice_settings.cloud_consent` and enforced in `VoiceService.transcribe`
  before any network call.
- The OpenAI key lives in the OS keychain, never in logs.

## Performance (measured 2026-08-30, Apple M5)

| Signal             | Whisper Tiny fixture (`0.wav`)                    |
| ------------------ | ------------------------------------------------- |
| Transcribe latency | ~440 ms cold-ish process (vitest `voice-runtime`) |
| Catalog download   | ~75 MB                                            |
| Sample rate        | 16 kHz mono PCM                                   |

Larger local models (Parakeet ~1.2 GB / 700 MB, Zipformer ~350 MB) trade disk
and RAM for quality. Cloud models use no local model disk.

## Licences

Runtime: `sherpa-onnx-node` (Apache-2.0), attributed in `THIRD_PARTY_NOTICES.txt`.

Optional on-device weights, downloaded by the user:

- Whisper Tiny — OpenAI Whisper, MIT
- Zipformer bilingual — k2-fsa / icefall, Apache-2.0
- Parakeet TDT — NVIDIA Open Model License

Cloud transcription uses the OpenAI API under the user's own key and terms.

## Acceptance

- Declining the microphone shows Settings copy and a HUD error; dictation does
  not start.
- A cloud model cannot upload until consent is recorded; a test asserts no
  request is made.
- Local models never call the gateway.
- Toggle and hold both insert into a field and a terminal pane.
- Packaged macOS app declares `NSMicrophoneUsageDescription`.
