import type { BuilderHelmDesktopApi } from '@builderhelm/protocol';

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
    builderHelm: BuilderHelmDesktopApi;
  }

  /** Branch and short SHA injected by electron-vite at build time. */
  const __BUILD_STAMP__: string;
  /** Explicit opt-in, enabled only by the development server. */
  const __LOCAL_DEVELOPMENT__: boolean;
}

export {};
