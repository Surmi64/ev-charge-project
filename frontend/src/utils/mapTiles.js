// OpenStreetMap's own tiles, with the attribution their policy requires. Fine for an
// account's own map at this traffic; a public launch needs a tile provider with an
// agreement (MapTiler, Stadia) — swap the URL and attribution here.
export const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
export const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// OpenStreetMap only draws light tiles; inverted, they sit in a dark page instead of
// glaring out of it.
export const DARK_TILE_FILTER = 'invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9)';
