/**
 * Which blocks the analytics PDF can be asked to leave out.
 *
 * Lives beside the component rather than inside it because both the dialog offering
 * the choice and the report acting on it need the same ids, and a list that existed
 * in only one of them would drift the moment a section was added.
 *
 * The order is the order the sections appear in the report's JSX — not the order the
 * packer ends up printing them in, which depends on what fits where.
 *
 * `needs` names what a section requires from the data. A section whose data is not
 * there is offered disabled rather than hidden, so the list does not change shape
 * between two exports of the same account. The header and the footer are not on the
 * list at all: a report with no title and no provenance line is not a report.
 */
export const EXPORT_SECTIONS = [
  { id: 'summary', label: 'Summary', hint: 'Headline totals for the range.' },
  { id: 'trendChart', label: 'Cost over time — chart', hint: 'Spend per period, with the efficiency line.' },
  { id: 'trendTable', label: 'Cost over time — table', hint: 'Every period written out.' },
  { id: 'split', label: 'Where the money goes', hint: 'Driving spend against everything else.' },
  { id: 'categories', label: 'Cost categories', hint: 'Insurance, tax, maintenance…', needs: 'categories' },
  { id: 'providerStops', label: 'Providers — stops', hint: 'How often you stop where.', needs: 'providers' },
  { id: 'providerEnergy', label: 'Providers — energy', hint: 'And how much energy you take there.', needs: 'providers' },
  { id: 'vehicleTable', label: 'All figures', hint: 'One row per vehicle.' },
  { id: 'drilldown', label: 'Single vehicle', hint: 'The vehicle selected on the page.', needs: 'drilldown' },
];

export const DEFAULT_EXPORT_SECTIONS = EXPORT_SECTIONS.map((section) => section.id);
