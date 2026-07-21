// Kept out of the components so fast refresh keeps working: a module that exports
// both a component and a constant loses its refresh boundary.
export const EXPENSE_CATEGORIES = [
  'maintenance', 'insurance', 'parking', 'toll', 'tax', 'inspection', 'cleaning', 'other',
];

export const formatCategoryLabel = (value = '') =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
