/**
 * Background Image Service - manages custom background images.
 * Stores images in localStorage as base64 data URLs.
 * Provides functions to set, get, and clear the background.
 */
import { getThemeSettings } from './theme-service';

const STORAGE_KEY = 'tavern-bg-image';
const DEFAULT_BG = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=anime%20girl%20with%20white%20cat%20sitting%20on%20green%20grassland%20hill%20sunset%20studio%20ghibli%20style%20beautiful%20peaceful&image_size=landscape_16_9';

/**
 * Apply a background image to the document body.
 * Uses the current theme's overlay opacity.
 */
export function applyBackground(imageUrl: string | null) {
  const bgImage = imageUrl || DEFAULT_BG;
  const theme = getThemeSettings();
  const overlayOpacity = theme.bgOverlayOpacity / 100;
  
  document.body.style.backgroundImage = `
    linear-gradient(rgba(15, 23, 42, ${overlayOpacity}), rgba(15, 23, 42, ${overlayOpacity + 0.05})),
    url('${bgImage}')
  `;
  document.body.style.backgroundSize = 'cover';
  document.body.style.backgroundPosition = 'center';
  document.body.style.backgroundAttachment = 'fixed';
}

/**
 * Get the currently stored background image URL.
 */
export function getStoredBackground(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

/**
 * Store a new background image and apply it.
 */
export function setBackground(imageDataUrl: string): void {
  localStorage.setItem(STORAGE_KEY, imageDataUrl);
  applyBackground(imageDataUrl);
}

/**
 * Clear the custom background and revert to default.
 */
export function clearBackground(): void {
  localStorage.removeItem(STORAGE_KEY);
  applyBackground(null);
}

/**
 * Initialize the background on app load.
 * Should be called once when the app starts.
 */
export function initBackground(): void {
  const stored = getStoredBackground();
  applyBackground(stored)
}
