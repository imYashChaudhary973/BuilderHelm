import type { ZeroDesktopApi } from '@zero/protocol';

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    zero: ZeroDesktopApi;
  }

  /** Branch and short SHA injected by electron-vite at build time. */
  const __BUILD_STAMP__: string;
}

export {};
