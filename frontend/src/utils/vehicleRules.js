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
/**
 * Only battery cars are asked about a heat pump.
 *
 * A combustion engine heats the cabin with waste heat it makes anyway, so the question
 * is meaningless for it. Hybrids are excluded too: the app does not distinguish a
 * plug-in from a full hybrid, and for both the engine's waste heat dominates the
 * winter penalty, so an answer would not move their forecast. Mirrors
 * backend/vehicle_rules.py:supports_heat_pump.
 */
export function supportsHeatPump(fuelType) {
  return isElectricVehicle(fuelType);
}

/**
 * How far past the highest reading on file an odometer entry may go before the form
 * questions it, in kilometres.
 *
 * A single mistyped reading is unusually expensive here: distance is derived from the
 * gaps between readings, so one extra digit inflates the fleet distance, flattens cost
 * per 100 km, and — because the petrol-comparison line is drawn on the same axis as the
 * spend bars — rescales the Analytics chart until the bars are sub-pixel.
 *
 * A battery car gets the tighter limit because its range makes a longer gap between two
 * charges implausible; anything with a tank can cross a country between fills. Both are
 * deliberately well above a normal week, since this only ever warns and a driver who
 * really did that trip must be able to file it.
 */
export const ELECTRIC_ODOMETER_JUMP_KM = 700;
export const DEFAULT_ODOMETER_JUMP_KM = 1200;

export function getOdometerJumpLimitKm(fuelType) {
  return isElectricVehicle(fuelType) ? ELECTRIC_ODOMETER_JUMP_KM : DEFAULT_ODOMETER_JUMP_KM;
}
