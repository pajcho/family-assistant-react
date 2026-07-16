/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

// Vite `?url` import of the zxing-wasm binary (resolves to a hashed asset URL).
declare module "zxing-wasm/reader/zxing_reader.wasm?url" {
  const src: string;
  export default src;
}
