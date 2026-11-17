import { createContext, useContext } from 'react';

export const StorefrontContext = createContext(null);

export function useStorefront() {
  const context = useContext(StorefrontContext);
  if (!context) {
    throw new Error('useStorefront must be used inside a storefront route.');
  }
  return context;
}
