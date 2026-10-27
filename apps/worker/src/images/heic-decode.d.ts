// Deklarasi minimal untuk `heic-decode` (libheif lewat WASM; paket tanpa tipe bawaan).
declare module 'heic-decode' {
  interface DecodedImage {
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }
  interface HeicImage {
    width: number;
    height: number;
    decode(): Promise<DecodedImage>;
  }
  function decode(input: { buffer: Uint8Array }): Promise<DecodedImage>;
  namespace decode {
    function all(input: { buffer: Uint8Array }): Promise<HeicImage[] & { dispose(): void }>;
  }
  export default decode;
}
