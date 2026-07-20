/**
 * Cross-browser text file decoding with legacy Chinese encoding fallback.
 *
 * `File.text()` / `readAsText(file, 'utf-8')` force UTF-8 decoding and silently
 * turn GBK/GB2312/Big5 bytes into U+FFFD mojibake. Many user-provided novels are
 * saved in GBK, so we auto-detect and re-decode when UTF-8 looks lossy.
 *
 * Uses FileReader (broadly supported, including older Safari) instead of
 * `file.arrayBuffer()` for maximum compatibility, and wraps every legacy
 * TextDecoder label in try/catch so browsers lacking a given codec fall back
 * gracefully instead of throwing.
 */

export interface FileDecodeResult {
  text: string;
  /** The encoding that produced the final text. */
  encoding: string;
  /** True when we switched away from UTF-8 because UTF-8 looked lossy. */
  wasReencoded: boolean;
}

/** Reject files larger than this to avoid OOM when decoding huge novels. */
export const MAX_NOVEL_FILE_BYTES = 50 * 1024 * 1024; // 50MB

const LOSSY_RATIO_THRESHOLD = 0.02;

function countReplacementChars(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 0xfffd) count++;
  }
  return count;
}

function decodeBuffer(buffer: ArrayBuffer, encoding: string): string | null {
  try {
    return new TextDecoder(encoding, { fatal: false }).decode(buffer);
  } catch {
    // Encoding label unsupported in this browser (e.g. older Safari) → skip.
    return null;
  }
}

function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (result instanceof ArrayBuffer) resolve(result);
      else reject(new Error('文件读取失败：无法获取二进制内容'));
    };
    reader.onerror = () => reject(reader.error || new Error('文件读取失败'));
    reader.readAsArrayBuffer(file);
  });
}

export async function readFileText(file: File): Promise<FileDecodeResult> {
  const buffer = await readArrayBuffer(file);

  const utf8Raw = decodeBuffer(buffer, 'utf-8');
  const utf8 = utf8Raw ?? '';
  const utf8Lossy = countReplacementChars(utf8);
  const ratio = utf8.length ? utf8Lossy / utf8.length : 0;

  if (utf8Raw !== null && (utf8Lossy === 0 || ratio < LOSSY_RATIO_THRESHOLD)) {
    return { text: utf8, encoding: 'utf-8', wasReencoded: false };
  }

  // UTF-8 looks lossy → try legacy Chinese encodings and keep the best one.
  const candidates = ['gb18030', 'gbk', 'big5'];
  let best: { text: string; encoding: string; lossy: number } | null = null;
  for (const enc of candidates) {
    const decoded = decodeBuffer(buffer, enc);
    if (decoded == null) continue;
    const lossy = countReplacementChars(decoded);
    if (!best || lossy < best.lossy) best = { text: decoded, encoding: enc, lossy };
  }

  if (best && best.lossy < utf8Lossy) {
    return { text: best.text, encoding: best.encoding, wasReencoded: true };
  }

  // Could not improve; return the UTF-8 text (may contain some mojibake).
  return { text: utf8, encoding: 'utf-8', wasReencoded: false };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
