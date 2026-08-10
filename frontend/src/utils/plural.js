/**
 * "1 vehicle", "2 vehicles" — the count and its noun, agreeing.
 *
 * Only the regular -s case, which is every noun this app counts. A word needing
 * anything else (an irregular plural, a different stem) takes the explicit form
 * rather than growing rules here for a case that has not come up.
 */
export function pluralize(count, singular, plural = `${singular}s`) {
  const n = Number(count) || 0;
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

export default pluralize;
