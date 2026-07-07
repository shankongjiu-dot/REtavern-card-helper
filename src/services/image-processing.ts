/**
 * Image processing utilities for the browser.
 */

export interface ResizeOptions {
  /** Maximum width or height in pixels. */
  maxDimension?: number;
  /** Hard limit on the source file size in bytes. */
  maxFileBytes?: number;
}

function arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

const DEFAULT_MAX_DIMENSION = 1536;
const DEFAULT_MAX_FILE_BYTES = 50 * 1024 * 1024;

/**
 * Resize an image file so that its largest side does not exceed maxDimension,
 * then encode it as a PNG ArrayBuffer.
 *
 * This keeps exported character card files reasonably small and prevents the
 * browser from choking on 4K/ultra-large source images.
 */
export async function resizeImageToPngBuffer(
  file: File,
  options: ResizeOptions = {},
): Promise<ArrayBuffer> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

  if (file.size > maxFileBytes) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(`图片太大（${mb} MB），请压缩后重试，最大支持 ${maxFileBytes / 1024 / 1024} MB。`);
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);

    let { width, height } = bitmap;
    const largest = Math.max(width, height);
    if (largest > maxDimension) {
      const scale = maxDimension / largest;
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('浏览器无法创建图片处理上下文');
    }

    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('图片导出失败'))),
        'image/png',
      );
    });

    return await blob.arrayBuffer();
  } finally {
    bitmap?.close();
  }
}

/**
 * Resize an image file and return it as a base64 data URL.
 *
 * Useful for features that store the image directly in the browser (e.g.
 * localStorage) where file size matters.
 */
export async function resizeImageFileToDataUrl(
  file: File,
  options: ResizeOptions = {},
): Promise<string> {
  const buffer = await resizeImageToPngBuffer(file, options);
  return arrayBufferToDataUrl(buffer, 'image/png');
}
