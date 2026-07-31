import { regionFromLocale } from './units';

/**
 * A first guess at which climate zone an account drives in.
 *
 * The zones themselves, and everything the forecast does with them, live in
 * backend/climate.py — this only picks which one to preselect so the question arrives
 * already answered plausibly rather than blank.
 *
 * Country is a coarse instrument and deliberately so. It is wrong for large countries
 * with several climates (the US most of all, where the region maps to the zone the
 * largest share of the population lives in), and the settings page exists to fix that.
 * What it does reliably get right is the thing that matters most and that a default
 * cannot afford to get wrong: which hemisphere the seasons run in.
 */
const REGION_ZONE = {
  // Temperate continental — cold winters, warm summers.
  HU: 'temperate_continental', AT: 'temperate_continental', CZ: 'temperate_continental',
  SK: 'temperate_continental', PL: 'temperate_continental', RO: 'temperate_continental',
  RS: 'temperate_continental', HR: 'temperate_continental', SI: 'temperate_continental',
  BG: 'temperate_continental', UA: 'temperate_continental', DE: 'temperate_continental',
  CH: 'temperate_continental', BA: 'temperate_continental', MD: 'temperate_continental',

  // Temperate maritime — mild and even.
  GB: 'temperate_maritime', IE: 'temperate_maritime', NL: 'temperate_maritime',
  BE: 'temperate_maritime', FR: 'temperate_maritime', DK: 'temperate_maritime',
  LU: 'temperate_maritime',

  // Nordic and Baltic.
  SE: 'nordic', NO: 'nordic', FI: 'nordic', EE: 'nordic', LV: 'nordic', LT: 'nordic',
  IS: 'nordic',

  // Severe continental.
  RU: 'subarctic', CA: 'subarctic', KZ: 'subarctic', MN: 'subarctic',

  // Mediterranean.
  ES: 'mediterranean', PT: 'mediterranean', IT: 'mediterranean', GR: 'mediterranean',
  TR: 'mediterranean', CY: 'mediterranean', MT: 'mediterranean', IL: 'mediterranean',
  MA: 'mediterranean', TN: 'mediterranean', DZ: 'mediterranean',

  // Humid subtropical. The US is a genuine compromise — a Minneapolis account will
  // want to change it, and the settings card is written to invite exactly that.
  US: 'subtropical', CN: 'subtropical', JP: 'subtropical', KR: 'subtropical',
  MX: 'subtropical', AR: 'oceanic_south', UY: 'oceanic_south',

  // Hot desert.
  AE: 'desert_hot', SA: 'desert_hot', QA: 'desert_hot', KW: 'desert_hot',
  OM: 'desert_hot', BH: 'desert_hot', EG: 'desert_hot', IQ: 'desert_hot',

  // Tropical.
  SG: 'tropical', MY: 'tropical', ID: 'tropical', PH: 'tropical', TH: 'tropical',
  VN: 'tropical', IN: 'tropical', BR: 'tropical', NG: 'tropical', KE: 'tropical',
  CO: 'tropical', PA: 'tropical',

  // Southern temperate — seasons inverted, which is the case a wrong default hurts most.
  AU: 'oceanic_south', NZ: 'oceanic_south', CL: 'oceanic_south', ZA: 'oceanic_south',
};

export function guessClimateZone(locale) {
  return REGION_ZONE[regionFromLocale(locale)] || 'temperate_continental';
}
