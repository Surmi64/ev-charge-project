export const ELECTRIC_FUEL_TYPES = ['electric'];
export const HYBRID_FUEL_TYPES = ['hybrid'];
export const COMBUSTION_FUEL_TYPES = ['petrol', 'diesel'];
export const HYDROGEN_FUEL_TYPES = ['hydrogen'];

export function isElectricVehicle(fuelType) {
  return ELECTRIC_FUEL_TYPES.includes(fuelType);
}

export function isHybridVehicle(fuelType) {
  return HYBRID_FUEL_TYPES.includes(fuelType);
}

export function isCombustionVehicle(fuelType) {
  return COMBUSTION_FUEL_TYPES.includes(fuelType);
}

export function supportsCharging(fuelType) {
  return isElectricVehicle(fuelType) || isHybridVehicle(fuelType);
}

export function isHydrogenVehicle(fuelType) {
  return HYDROGEN_FUEL_TYPES.includes(fuelType);
}

export function supportsFueling(fuelType) {
  return isCombustionVehicle(fuelType) || isHybridVehicle(fuelType) || isHydrogenVehicle(fuelType);
}

export function getAllowedSessionTypes(fuelType) {
  const allowed = [];

  if (supportsCharging(fuelType)) allowed.push('charging');
  if (supportsFueling(fuelType)) allowed.push('fueling');

  return allowed;
}

export function getDefaultSessionType(fuelType) {
  const allowed = getAllowedSessionTypes(fuelType);
  return allowed[0] || 'charging';
}

export function requiresBatteryCapacity(fuelType) {
  return supportsCharging(fuelType);
}