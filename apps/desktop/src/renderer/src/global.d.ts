import type { ZeroDesktopApi } from '@zero/protocol';

declare module '*.png' {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    zero: ZeroDesktopApi;
  }
}

export {};
