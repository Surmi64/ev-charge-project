/**
 * Display formatting for money, distance and volume.
 *
 * Everything is stored canonically — kilometres, litres, and amounts in whatever
 * currency the user was recording in. Distance and volume are converted here for
 * display because those conversions are exact.
 *
 * Money is not converted. The currency preference is a label: switching from one to
 * another would need the exchange rate on each entry's original date, and picking a
 * rate would put numbers in someone's history that they never actually spent.
 */

export const DISTANCE_UNITS = {
  km: { short: 'km', perKm: 1 },
  mi: { short: 'mi', perKm: 0.621371 },
};

export const VOLUME_UNITS = {
  l: { short: 'L', perLitre: 1 },
  gal_us: { short: 'gal', perLitre: 0.264172 },
  gal_uk: { short: 'gal', perLitre: 0.219969 },
};

const DEFAULTS = { currency: 'EUR', distance_unit: 'km', volume_unit: 'l' };

/** Currencies whose smallest unit is the unit itself — showing decimals is noise. */
const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'KRW', 'CLP', 'ISK']);

export function getPreferences(user) {
  return {
    currency: user?.currency || DEFAULTS.currency,
    distanceUnit: DISTANCE_UNITS[user?.distance_unit] ? user.distance_unit : DEFAULTS.distance_unit,
    volumeUnit: VOLUME_UNITS[user?.volume_unit] ? user.volume_unit : DEFAULTS.volume_unit,
  };
}

/**
 * Build the formatters for a user once, rather than threading preferences through
 * every call site.
 */
export function createFormatters(user) {
  const { currency, distanceUnit, volumeUnit } = getPreferences(user);
  const distance = DISTANCE_UNITS[distanceUnit];
  const volume = VOLUME_UNITS[volumeUnit];
  const fractionDigits = ZERO_DECIMAL.has(currency) ? 0 : 2;

  const money = (value, { compact = false } = {}) =>
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: compact ? 0 : fractionDigits,
      maximumFractionDigits: compact ? 1 : fractionDigits,
      ...(compact ? { notation: 'compact' } : {}),
    }).format(Number(value || 0));

  const toDistance = (km) => Number(km || 0) * distance.perKm;
  const toVolume = (litres) => Number(litres || 0) * volume.perLitre;

  return {
    currency,
    distanceUnit,
    volumeUnit,
    distanceShort: distance.short,
    volumeShort: volume.short,

    money,
    /** Compact money for narrow labels: 1.2M rather than 1,234,567. */
    moneyCompact: (value) => money(value, { compact: true }),
    /**
     * Chart axes: compact and without the currency. Repeating "HUF" on every tick is
     * noise, and it does not fit — the axis clipped it to "JF 600K".
     */
    numberCompact: (value) =>
      new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })
        .format(Number(value || 0)),

    distance: (km) => `${Math.round(toDistance(km)).toLocaleString()} ${distance.short}`,
    volume: (litres) => `${toVolume(litres).toFixed(1)} ${volume.short}`,
    energy: (kwh) => `${Number(kwh || 0).toFixed(1)} kWh`,

    /** Cost per 100 km becomes cost per 100 mi when the user works in miles. */
    perDistanceLabel: `per 100 ${distance.short}`,
    /**
     * The stored figure is cost per 100 km, and 100 miles is the longer trip, so the
     * per-100 figure goes up: 1000/100km becomes 1609/100mi. Divide by the factor
     * rather than multiplying by it.
     */
    moneyPerHundred: (costPerHundredKm) =>
      money(Number(costPerHundredKm || 0) / distance.perKm),
    rawDistance: toDistance,
    rawVolume: toVolume,

    /**
     * Fuel price. Stored per litre; a gallon is the bigger container, so its price is
     * higher — divide by the factor rather than multiplying, the same inversion as
     * moneyPerHundred.
     */
    fuelPriceLabel: `per ${volume.short}`,
    fuelPrice: (perLitre) => money(Number(perLitre || 0) / volume.perLitre),
    toFuelPriceInput: (perLitre) =>
      (perLitre == null ? '' : String(Math.round((perLitre / volume.perLitre) * 100) / 100)),
    fromFuelPriceInput: (perDisplayVolume) => Number(perDisplayVolume || 0) * volume.perLitre,

    /**
     * Reference consumption, shown as volume per 100 distance rather than converted to
     * mpg. Both terms move: litres become gallons, and 100 miles is the longer trip.
     * Kept on the same "per 100" scale the rest of the app uses, so it stays comparable
     * with the cost-per-100 figures beside it instead of running the opposite way.
     */
    consumptionLabel: `${volume.short} / 100 ${distance.short}`,
    toConsumptionInput: (litresPer100Km) =>
      (litresPer100Km == null
        ? ''
        : String(Math.round((litresPer100Km * volume.perLitre / distance.perKm) * 10) / 10)),
    fromConsumptionInput: (displayValue) =>
      Number(displayValue || 0) * distance.perKm / volume.perLitre,
  };
}

/**
 * A first guess at sensible settings from the browser's locale.
 *
 * This matters most for people who skip onboarding: the defaults they never chose
 * should still be roughly right, rather than everyone starting in euros and
 * kilometres. It is only a guess and the settings page always wins.
 *
 * Note the UK: distances are in miles but fuel is sold in litres, so it does not
 * simply follow the US.
 */
const REGION_CURRENCY = {
  HU: 'HUF', PL: 'PLN', CZ: 'CZK', RO: 'RON', SE: 'SEK', NO: 'NOK', DK: 'DKK',
  CH: 'CHF', TR: 'TRY', GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD',
  JP: 'JPY', CN: 'CNY', IN: 'INR', BR: 'BRL', ZA: 'ZAR',
};

// Miles for distance; only the US also uses gallons for fuel.
const MILE_REGIONS = new Set(['US', 'GB']);
const GALLON_REGIONS = new Set(['US']);

/**
 * The ISO region behind a locale tag, e.g. 'HU' for 'hu' or 'hu-HU'.
 *
 * Exported because the climate-zone guess needs the same answer, and deriving it twice
 * would mean two subtly different fallbacks the first time `Intl.Locale` is missing.
 */
export function regionFromLocale(locale) {
  const tag = locale || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-US';
  try {
    return new Intl.Locale(tag).maximize().region || '';
  } catch {
    return (tag.split('-')[1] || '').toUpperCase();
  }
}

export function guessPreferencesFromLocale(locale) {
  const region = regionFromLocale(locale);

  return {
    currency: REGION_CURRENCY[region] || 'EUR',
    distance_unit: MILE_REGIONS.has(region) ? 'mi' : 'km',
    volume_unit: GALLON_REGIONS.has(region) ? 'gal_us' : 'l',
  };
}
