/**
 * PNG Service - Embed and extract JSON character data in PNG images.
 *
 * SillyTavern standard: Character card data is stored in PNG tEXt chunks
 * with keyword "chara" and the value being base64-encoded JSON.
 *
 * PNG tEXt chunk structure:
 *   - 4 bytes: data length (big-endian)
 *   - 4 bytes: chunk type ("tEXt")
 *   - N bytes: keyword + null byte + text
 *   - 4 bytes: CRC32 (over type + data, big-endian)
 */

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const length = data.length;

  const chunk = new Uint8Array(4 + 4 + length + 4);
  const view = new DataView(chunk.buffer);

  view.setUint32(0, length);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);

  const crcInput = new Uint8Array(4 + length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + length, crc32(crcInput));

  return chunk;
}

function findIendOffset(bytes: Uint8Array): number {
  const IEND = [73, 69, 78, 68];
  for (let i = bytes.length - 12; i >= 0; i--) {
    if (bytes[i + 4] === IEND[0] && bytes[i + 5] === IEND[1] &&
        bytes[i + 6] === IEND[2] && bytes[i + 7] === IEND[3]) {
      const length = new DataView(bytes.buffer, i, 4).getUint32(0);
      if (length === 0) {
        return i;
      }
    }
  }
  return bytes.length;
}

/** UTF-8 string → base64 (replaces deprecated btoa(unescape(encodeURIComponent(...)))) */
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** base64 → UTF-8 string (replaces deprecated decodeURIComponent(escape(atob(...)))) */
function base64ToUtf8(base64: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

export function embedJsonInPng(
  pngBuffer: ArrayBufferLike | null,
  cardJson: Record<string, unknown>,
): Uint8Array {
  const jsonString = JSON.stringify(cardJson);
  const base64 = utf8ToBase64(jsonString);

  // SillyTavern writes both 'chara' (V2) and 'ccv3' (V3) tEXt chunks.
  // V3 takes precedence during reading; V2 is for older software compatibility.
  const charaChunk = makeChunk('tEXt', new TextEncoder().encode('chara\0' + base64));
  const ccv3Chunk = makeChunk('tEXt', new TextEncoder().encode('ccv3\0' + base64));

  if (!pngBuffer) {
    return createMinimalPngWithText(ccv3Chunk, charaChunk);
  }

  const srcBytes = new Uint8Array(pngBuffer);
  const view = new DataView(pngBuffer);

  for (let i = 0; i < 8; i++) {
    if (srcBytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('不是有效的 PNG 文件');
    }
  }

  const parts: Uint8Array[] = [srcBytes.subarray(0, 8)];
  let offset = 8;
  let inserted = false;

  while (offset + 12 <= srcBytes.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(srcBytes.subarray(offset + 4, offset + 8));
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > srcBytes.length) break;

    const chunkData = srcBytes.subarray(offset + 8, offset + 8 + length);
    const decoded = new TextDecoder().decode(chunkData);
    const isOldCharaText = type === 'tEXt' && (decoded.startsWith('chara\0') || decoded.startsWith('ccv3\0'));

    if (type === 'IEND') {
      // Insert ccv3 (V3) first, then chara (V2), before IEND
      parts.push(ccv3Chunk);
      parts.push(charaChunk);
      inserted = true;
      parts.push(srcBytes.subarray(offset, chunkEnd));
      break;
    }

    if (!isOldCharaText) {
      parts.push(srcBytes.subarray(offset, chunkEnd));
    }

    offset = chunkEnd;
  }

  if (!inserted) {
    const iendOffset = findIendOffset(srcBytes);
    const before = srcBytes.subarray(0, iendOffset);
    const iend = srcBytes.subarray(iendOffset);
    const totalLength = before.length + ccv3Chunk.length + charaChunk.length + iend.length;
    const output = new Uint8Array(totalLength);
    output.set(before, 0);
    output.set(ccv3Chunk, before.length);
    output.set(charaChunk, before.length + ccv3Chunk.length);
    output.set(iend, before.length + ccv3Chunk.length + charaChunk.length);
    return output;
  }

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(totalLength);
  let pos = 0;
  for (const part of parts) {
    output.set(part, pos);
    pos += part.length;
  }

  return output;
}

function createMinimalPngWithText(...textChunks: Uint8Array[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  chunks.push(PNG_SIGNATURE);

  const ihdrData = new Uint8Array(13);
  const ihdrView = new DataView(ihdrData.buffer);
  ihdrView.setUint32(0, 1);
  ihdrView.setUint32(4, 1);
  ihdrData[8] = 8;
  ihdrData[9] = 6;
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  chunks.push(makeChunk('IHDR', ihdrData));

  const idatData = zlibDeflate(new Uint8Array([0, 255, 255, 255, 255]));
  chunks.push(makeChunk('IDAT', idatData));

  for (const tc of textChunks) {
    chunks.push(tc);
  }

  chunks.push(makeChunk('IEND', new Uint8Array(0)));

  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function zlibDeflate(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  const maxBlockSize = 65535;
  let offset = 0;

  while (offset < data.length) {
    const remaining = data.length - offset;
    const blockSize = Math.min(remaining, maxBlockSize);
    const isLast = offset + blockSize >= data.length;

    const header = new Uint8Array(5);
    header[0] = (isLast ? 1 : 0);
    header[1] = blockSize & 0xff;
    header[2] = (blockSize >> 8) & 0xff;
    header[3] = (~blockSize) & 0xff;
    header[4] = ((~blockSize) >> 8) & 0xff;

    const block = new Uint8Array(5 + blockSize);
    block.set(header, 0);
    block.set(data.subarray(offset, offset + blockSize), 5);
    blocks.push(block);
    offset += blockSize;
  }

  const cmf = 0x78;
  const flg = 0x01;

  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;

  let deflateLen = 0;
  for (const block of blocks) deflateLen += block.length;

  const result = new Uint8Array(2 + deflateLen + 4);
  result[0] = cmf;
  result[1] = flg;
  let pos = 2;
  for (const block of blocks) {
    result.set(block, pos);
    pos += block.length;
  }
  result[pos] = (adler >> 24) & 0xff;
  result[pos + 1] = (adler >> 16) & 0xff;
  result[pos + 2] = (adler >> 8) & 0xff;
  result[pos + 3] = adler & 0xff;

  return result;
}

interface PngChunk {
  type: string;
  data: Uint8Array;
}

function readPngChunks(buffer: ArrayBufferLike): PngChunk[] {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      throw new Error('不是有效的 PNG 文件');
    }
  }

  const chunks: PngChunk[] = [];
  let offset = 8;

  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = new TextDecoder().decode(typeBytes);

    if (offset + 8 + length > bytes.length) break;

    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data: new Uint8Array(data) });

    offset += 12 + length;

    if (type === 'IEND') break;
  }

  return chunks;
}

export function extractJsonFromPng(
  pngBuffer: ArrayBufferLike,
): Record<string, unknown> | null {
  const chunks = readPngChunks(pngBuffer);

  // V3 (ccv3) takes precedence over V2 (chara) per SillyTavern spec.
  // First pass: look for ccv3, second pass: fall back to chara.
  for (const keyword of ['ccv3', 'chara']) {
    for (const chunk of chunks) {
      if (chunk.type === 'tEXt') {
        const text = new TextDecoder().decode(chunk.data);
        const nullIndex = text.indexOf('\0');
        if (nullIndex === -1) continue;

        const kw = text.substring(0, nullIndex);
        const value = text.substring(nullIndex + 1);

        if (kw === keyword) {
          try {
            const jsonString = base64ToUtf8(value);
            return JSON.parse(jsonString);
          } catch {
            throw new Error(`PNG 中的 ${keyword} 数据解析失败（base64/JSON 格式无效）`);
          }
        }
      }
    }
  }

  return null;
}

export function downloadPng(pngData: Uint8Array, filename: string) {
  const blob = new Blob([pngData as BlobPart], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.click();
  URL.revokeObjectURL(url);
}
