// Fictional carriers shared by the seed and the eval fixtures. Never use real carrier names or branding.
export const CARRIERS = [
  'Halcyon Ridge Freight',
  'Copperline Haulage',
  'Bramblewood Express',
  'Tern & Tide Carriers',
  'Quarry Lane Transport',
  'Nimbus Road Lines',
] as const;

// Normalized charge codes and the wording carriers print for them.
export const CHARGE_CODES = {
  LINEHAUL: 'Linehaul',
  FUEL: 'Fuel surcharge',
  LIFTGATE: 'Liftgate service',
  RESIDENTIAL: 'Residential delivery',
  INSIDE_DELIVERY: 'Inside delivery',
  LIMITED_ACCESS: 'Limited access delivery',
  APPOINTMENT: 'Delivery appointment',
  DETENTION: 'Detention',
} as const;

export type ChargeCode = keyof typeof CHARGE_CODES;
