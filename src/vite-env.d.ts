/// <reference types="vite/client" />

declare module '@jsquash/avif/encode' {
  const encode: (data: ImageData, options?: unknown) => Promise<ArrayBuffer>;
  export default encode;
}
