import { IMAGE_TYPES } from '../../shared/image-types';

// The API's per-image cap, measured on the base64 text it receives.
export const MAX_IMAGE_BASE64 = 5 * 1024 * 1024;

// Why an image of `type` whose base64 text is `base64Length` long cannot be
// attached; null when it can.
export function refusalOf(type: string, base64Length: number): string | null {
  if (!IMAGE_TYPES.includes(type)) {
    return 'Only PNG, JPEG, GIF and WebP images can be attached';
  }
  if (base64Length > MAX_IMAGE_BASE64) {
    return 'Images over 5 MB cannot be attached';
  }
  return null;
}
