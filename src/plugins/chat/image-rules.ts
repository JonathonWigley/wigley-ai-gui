import { IMAGE_TYPES, MAX_IMAGE_BASE64 } from '../../shared/image-types';

export { MAX_IMAGE_BASE64 } from '../../shared/image-types';

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
