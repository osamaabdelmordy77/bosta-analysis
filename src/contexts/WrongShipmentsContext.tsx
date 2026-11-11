import React, { createContext, useContext } from 'react';

export type WrongShipmentsDirection = 'to-alex' | 'from-alex';

export interface WrongShipmentsConfig {
  organizationSlug: string;
  direction: WrongShipmentsDirection;
}

const WrongShipmentsContext = createContext<WrongShipmentsConfig | null>(null);

export function WrongShipmentsProvider({
  organizationSlug,
  direction,
  children,
}: React.PropsWithChildren<WrongShipmentsConfig>) {
  return <WrongShipmentsContext.Provider value={{ organizationSlug, direction }}>{children}</WrongShipmentsContext.Provider>;
}

export function useWrongShipmentsConfig(): WrongShipmentsConfig {
  const config = useContext(WrongShipmentsContext);
  if (!config) throw new Error('Wrong Shipments must be rendered inside WrongShipmentsProvider.');
  return config;
}
