/**
 * Join class names while ignoring falsy values.
 * Keeps components readable without adding a runtime dependency.
 */
export function cn(...inputs) {
  return inputs.flat(Infinity).filter(Boolean).join(' ');
}
