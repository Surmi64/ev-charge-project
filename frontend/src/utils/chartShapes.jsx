import { Rectangle } from 'recharts';

/**
 * A stacked bar segment that rounds its top corners only when it is the top.
 *
 * Recharts takes `radius` per series, not per bar, so rounding the topmost series
 * leaves a square top on every column where that series happens to be zero — a month
 * with charging but no insurance came out flat while its neighbours were rounded. The
 * cap has to follow the data, so it is decided per rectangle instead.
 *
 * `above` lists the keys stacked over this one, outermost last; the segment rounds when
 * all of them are absent for this row.
 */
export const StackTopBar = (props) => {
  const { above = [], cornerRadius = 8, payload, ...rest } = props;
  const covered = above.some((key) => Number(payload?.[key] || 0) > 0);
  return <Rectangle {...rest} radius={covered ? 0 : [cornerRadius, cornerRadius, 0, 0]} />;
};

export default StackTopBar;
