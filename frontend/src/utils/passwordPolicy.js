// Mirrors backend/auth_utils.py:validate_password_strength.
//
// The server stays the authority — this only saves a round trip and lets the field
// say which rule is still unmet while the user types, rather than rejecting the whole
// password after submit.
//
// Unicode property escapes rather than [A-Z]/[a-z]/[0-9], because the server uses
// Python's isupper/islower/isdigit, which are unicode-aware. An ASCII-only check here
// would reject a password like "Árvíztűrő1" that the server happily accepts.
export const PASSWORD_RULES = [
  { id: 'length', label: 'At least 8 characters', test: (value) => value.length >= 8 },
  { id: 'uppercase', label: 'An uppercase letter', test: (value) => /\p{Lu}/u.test(value) },
  { id: 'lowercase', label: 'A lowercase letter', test: (value) => /\p{Ll}/u.test(value) },
  { id: 'digit', label: 'A number', test: (value) => /\p{Nd}/u.test(value) },
];

export const passwordRuleState = (value = '') =>
  PASSWORD_RULES.map((rule) => ({ ...rule, met: rule.test(value) }));

export const isPasswordValid = (value = '') => PASSWORD_RULES.every((rule) => rule.test(value));

// How many of the four rules are satisfied. Deliberately not an entropy estimate: the
// bar exists to show progress towards the policy, and inventing a "strong" verdict the
// server does not share would be misleading.
export const passwordRulesMet = (value = '') => PASSWORD_RULES.filter((rule) => rule.test(value)).length;

export const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
