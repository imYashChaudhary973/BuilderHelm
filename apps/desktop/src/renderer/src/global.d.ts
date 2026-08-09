import type { ZeroDesktopApi } from '@zero/protocol';

declare global {
  interface Window {
    zero: ZeroDesktopApi;
  }
}

export {};
