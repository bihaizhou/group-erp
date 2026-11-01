// yauzl 3.4 ships a public Promise API without bundled TypeScript declarations.
// Describe only the public surface consumed by the bounded OOXML validator.
declare module 'yauzl' {
  import type { Readable } from 'node:stream';
  export interface Entry {
    fileName: string;
    uncompressedSize: number;
    generalPurposeBitFlag: number;
    compressionMethod: number;
  }
  export interface ZipFile {
    eachEntry(): AsyncIterable<Entry>;
    openReadStreamPromise(entry: Entry): Promise<Readable>;
    close(): void;
  }
  export function fromBufferPromise(
    buffer: Buffer,
    options?: { validateEntrySizes?: boolean; strictFileNames?: boolean },
  ): Promise<ZipFile>;
}
