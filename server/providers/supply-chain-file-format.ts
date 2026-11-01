// eslint-disable-next-line @typescript-eslint/triple-slash-reference -- Ambient declarations must also follow this module into the separate test TypeScript project.
/// <reference path="./yauzl.d.ts" />
import { fromBufferPromise } from 'yauzl';
import { fileError } from './supply-chain-file-service.js';
const office = {
  docx: {
    path: 'word/document.xml',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    content:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  },
  xlsx: {
    path: 'xl/workbook.xml',
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    content:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  },
  pptx: {
    path: 'ppt/presentation.xml',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    content:
      'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  },
} as const;
export async function validateDemandFile(file: File) {
  if (file.size < 1 || file.size > 5 * 1024 * 1024)
    return fileError('SUPPLY_FILE_SIZE', 'INVALID_ARGUMENT');
  const ext = file.name.split('.').at(-1)?.toLowerCase(),
    bytes = Buffer.from(await file.arrayBuffer());
  const header = bytes.subarray(0, 16);
  const raster =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : null;
  if (raster) {
    const valid =
      raster === 'image/jpeg'
        ? header[0] === 255 && header[1] === 216 && header[2] === 255
        : raster === 'image/png'
          ? header
              .subarray(0, 8)
              .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : header.subarray(0, 4).toString() === 'RIFF' &&
            header.subarray(8, 12).toString() === 'WEBP';
    if (!valid || file.type !== raster)
      return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
    return;
  }
  if (ext === 'pdf') {
    if (
      file.type !== 'application/pdf' ||
      header.subarray(0, 5).toString() !== '%PDF-' ||
      !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))
    )
      return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
    return;
  }
  const spec = office[ext as keyof typeof office];
  if (!spec || file.type !== spec.mime)
    return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
  // Reuse a central-directory ZIP reader. Never extract paths to disk, expand
  // the entire archive, or accept a word/xl/ppt directory as format evidence.
  try {
    const zip = await fromBufferPromise(bytes, {
      validateEntrySizes: true,
      strictFileNames: true,
    });
    try {
      let entries = 0,
        total = 0,
        content = '',
        main = false;
      const names = new Set<string>();
      for await (const entry of zip.eachEntry()) {
        if (
          ++entries > 2000 ||
          names.has(entry.fileName) ||
          (entry.generalPurposeBitFlag & 1) !== 0 ||
          ![0, 8].includes(entry.compressionMethod)
        )
          throw new Error('Invalid OOXML entry');
        names.add(entry.fileName);
        total += entry.uncompressedSize;
        if (
          total > 50 * 1024 * 1024 ||
          entry.uncompressedSize > 20 * 1024 * 1024
        )
          throw new Error('OOXML expansion limit');
        if (
          entry.fileName === '[Content_Types].xml' ||
          entry.fileName === spec.path
        ) {
          const maximum =
            entry.fileName === '[Content_Types].xml'
              ? 256 * 1024
              : 20 * 1024 * 1024;
          if (entry.uncompressedSize > maximum)
            throw new Error('OOXML part limit');
          const stream = await zip.openReadStreamPromise(entry),
            chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of stream) {
            const part = Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk as Uint8Array);
            size += part.length;
            if (size > maximum) {
              stream.destroy();
              throw new Error('OOXML part limit');
            }
            chunks.push(part);
          }
          const xml = Buffer.concat(chunks).toString('utf8');
          if (/<!DOCTYPE|<!ENTITY/i.test(xml))
            throw new Error('Invalid OOXML XML');
          if (entry.fileName === '[Content_Types].xml') content = xml;
          else
            main =
              xml.includes('http://schemas.openxmlformats.org/') ||
              xml.includes('http://purl.oclc.org/ooxml/');
        }
      }
      const escapedPath = spec.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        escapedType = spec.content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const override = new RegExp(
        `<Override\\b(?=[^>]*\\bPartName=["']/${escapedPath}["'])(?=[^>]*\\bContentType=["']${escapedType}["'])[^>]*>`,
        'i',
      );
      if (
        !main ||
        !override.test(content) ||
        /macroEnabled|vbaProject/i.test(content) ||
        names.has('word/vbaProject.bin') ||
        names.has('xl/vbaProject.bin') ||
        names.has('ppt/vbaProject.bin')
      )
        throw new Error('Invalid OOXML document type');
    } finally {
      zip.close();
    }
  } catch {
    return fileError('SUPPLY_FILE_FORMAT', 'INVALID_ARGUMENT');
  }
}
