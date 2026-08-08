"""Naming who supplied the energy on a charging or fueling record.

Nothing in the schema holds the provider, and nothing asks the user for it — the
question "how often do I charge at TEA" is answered from what the record already
carries. Three fields can name it, in descending order of how much they can be
trusted:

1. `place_name`, written by the location field: the coordinate matched a place the
   account already uses. Nobody typed it, and renaming the place fixes every record
   filed there at once.
2. `source`, when it is not a provenance marker. It is a free-text field the user may
   have filled in, but the same column also carries 'manual' and the importer's tag.
3. `notes`, but only when the note is shaped like a charger site — see SITE_SHAPE.
   The records imported from the old frontend put the whole site in there
   ("TEA Abony DC 130 kW"), and a note that names its charging power is describing a
   charger, not the weather.

A record none of those name is left unnamed rather than guessed at. Grouping the
history under a wrong operator is worse than admitting the history predates the field.

The operator is not read off the front of the string, because the two ways of naming a
site disagree about word order: the imported notes lead with the operator ("Tesla
Debrecen Auchan DC 150"), while a place named through the location field tends to lead
with the town ("Debrecen Tesla Auchan"). Taking the first word would file those as two
providers and make the location field the worse way to record a stop, which is exactly
backwards -- it is the only one nobody has to type.

So the vocabulary comes first: every site-shaped string in the account's own history
contributes its operator, and that vocabulary is then matched anywhere inside a name.
Nothing is invented, and an account that never used the old app simply groups by the
place names it chose.
"""

import re
from collections import Counter

# `source` doubles as a provenance marker. These values say where a row came from,
# not where the energy did, so they never name a provider.
PROVENANCE_SOURCES = frozenset({'manual', 'import', 'dev_seed', 'seed', 'api'})
PROVENANCE_PREFIXES = ('legacy',)

# "AC 22", "DC 150 kW" — a charging power, which only a charger description carries.
# Deliberately requires the digits: a bare "AC" could be anything.
SITE_SHAPE = re.compile(r'\b(?:AC|DC)\s*\d', re.IGNORECASE)

# Operators whose name runs past the first word. Without this list "EON Drive
# Sárospatak" would file under "EON" and "MOL Plugee Polgár" under "MOL", which is
# also the fuel brand — two different businesses collapsed into one row.
MULTI_WORD_OPERATORS = ('EON Drive', 'MOL Plugee', 'Ep Charger')


def _is_provenance(value: str) -> bool:
    lowered = value.lower()
    return lowered in PROVENANCE_SOURCES or lowered.startswith(PROVENANCE_PREFIXES)


def _words(text: str) -> list[str]:
    """Lowercased word tokens. Accents survive: \\w is unicode-aware here."""
    return [word for word in re.split(r'\W+', (text or '').lower(), flags=re.UNICODE) if word]


def collect_operators(rows) -> list[str]:
    """The account's own operator vocabulary, learned from its site-shaped strings.

    Only site-shaped text teaches: "TEA Abony DC 130 kW" is unambiguously a charger
    description, so its first word is unambiguously an operator. A place called "Home"
    teaches nothing and must not become a name to match other places against.

    Ordered longest first, so "MOL Plugee" is tried before "MOL" and wins the match --
    they are different businesses and the fuel brand must not swallow the charger one.
    """
    counts: Counter = Counter()
    for row in rows:
        for text in (row.get('place_name'), row.get('source'), row.get('notes')):
            value = (text or '').strip()
            if not value or _is_provenance(value) or not SITE_SHAPE.search(value):
                continue
            label = provider_label(value)
            if label:
                counts[label] += 1

    # One entry per operator, spelled the way it appears most often — "Evse" and "EVSE"
    # are the same company and must not be two rows.
    canonical: dict[str, Counter] = {}
    for label, count in counts.items():
        canonical.setdefault(label.lower(), Counter())[label] += count
    for name in MULTI_WORD_OPERATORS:
        canonical.setdefault(name.lower(), Counter())[name] += 0

    names = [
        min(spellings, key=lambda spelling: (-spellings[spelling], len(spelling)))
        for spellings in canonical.values()
    ]
    return sorted(names, key=lambda name: (-len(_words(name)), -len(name), name.lower()))


def match_operator(text: str, operators) -> str:
    """The first known operator appearing anywhere in `text`, as a whole word run.

    Word runs rather than substrings: "Teatro" is not TEA, and "Homer" is not Home.
    """
    words = _words(text)
    if not words:
        return ''
    for name in operators:
        target = _words(name)
        if not target:
            continue
        for start in range(len(words) - len(target) + 1):
            if words[start:start + len(target)] == target:
                return name
    return ''


def provider_label(text: str) -> str:
    """The operator behind a site description, or the text itself if it is not one.

    "TEA Abony DC 130 kW" is a site: its first word is the operator and the rest is
    which one. A plain "Home" or "Ionity" is already the answer and is left alone —
    taking the first word unconditionally would turn "H2 station" into "H2".
    """
    value = (text or '').strip()
    if not value:
        return ''
    lowered = value.lower()
    for name in MULTI_WORD_OPERATORS:
        if lowered.startswith(name.lower()):
            return name
    if SITE_SHAPE.search(value):
        return value.split()[0]
    return value


def derive_provider(place_name=None, source=None, notes=None, operators=()) -> str:
    """The provider for one record, or '' when nothing names it.

    A known operator found anywhere beats the field order: a place called "Debrecen
    Tesla Auchan" is a Tesla stop however it is written. Only when the vocabulary has
    nothing to say does the most trusted field get read on its own terms.
    """
    candidates = []
    place = (place_name or '').strip()
    if place:
        candidates.append(place)
    cleaned_source = (source or '').strip()
    if cleaned_source and not _is_provenance(cleaned_source):
        candidates.append(cleaned_source)
    note = (notes or '').strip()
    if note and SITE_SHAPE.search(note):
        candidates.append(note)

    for text in candidates:
        matched = match_operator(text, operators)
        if matched:
            return matched

    return provider_label(candidates[0]) if candidates else ''


def aggregate_providers(rows, operators=None) -> list[dict]:
    """Roll charging and fueling events up per provider.

    The vocabulary has to be known before any row can be labelled, which is the reason
    this is not SQL. Pass `operators` built from the account's whole history: derived
    from the visible rows instead, a place would change which provider it belongs to
    when the range narrowed past the records that taught the name.
    """
    rows = list(rows)
    if operators is None:
        operators = collect_operators(rows)
    buckets: dict[str, dict] = {}

    for row in rows:
        label = derive_provider(row.get('place_name'), row.get('source'), row.get('notes'), operators)
        bucket = buckets.setdefault(label.lower(), {
            'spellings': Counter(),
            'record_count': 0,
            'located_count': 0,
            'charging_count': 0,
            'fueling_count': 0,
            'energy_kwh': 0.0,
            'fuel_liters': 0.0,
            'total_cost': 0.0,
            'priced_energy': 0.0,
            'priced_cost': 0.0,
        })

        energy = float(row.get('energy_kwh') or 0)
        cost = float(row.get('total_cost') or 0)
        is_charging = row.get('event_type') == 'charging'

        if label:
            bucket['spellings'][label] += 1
        bucket['record_count'] += 1
        if (row.get('place_name') or '').strip():
            bucket['located_count'] += 1
        bucket['charging_count'] += 1 if is_charging else 0
        bucket['fueling_count'] += 0 if is_charging else 1
        bucket['energy_kwh'] += energy
        bucket['fuel_liters'] += float(row.get('fuel_liters') or 0)
        bucket['total_cost'] += cost
        # Only priced charging counts towards the rate, so a free session — or a fuel
        # stop at the same brand — cannot drag it down.
        if is_charging and energy > 0:
            bucket['priced_energy'] += energy
            bucket['priced_cost'] += cost

    providers = []
    for bucket in buckets.values():
        spellings = bucket['spellings']
        # The commonest spelling wins, shortest breaking the tie. "Evse HK AC 22 kW"
        # and "Evse Gyál AC 22" both reduce to "Evse" anyway; this matters where the
        # user typed the same provider two ways.
        label = min(spellings, key=lambda name: (-spellings[name], len(name))) if spellings else ''
        providers.append({
            'provider': label,
            'record_count': bucket['record_count'],
            # How many the location named, so the UI can say why a row is unnamed
            # instead of leaving it as a blank the user cannot act on.
            'located_count': bucket['located_count'],
            'charging_count': bucket['charging_count'],
            'fueling_count': bucket['fueling_count'],
            'energy_kwh': round(bucket['energy_kwh'], 2),
            'fuel_liters': round(bucket['fuel_liters'], 2),
            'total_cost': round(bucket['total_cost'], 2),
            'avg_cost_per_kwh': (bucket['priced_cost'] / bucket['priced_energy']) if bucket['priced_energy'] > 0 else None,
        })

    # The unnamed bucket is the one row the user cannot act on, and on an imported
    # history it can be the biggest — so it sorts last regardless of size.
    providers.sort(key=lambda row: (row['provider'] == '', -row['record_count'], -row['total_cost']))
    return providers
