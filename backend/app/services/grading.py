import math
import unicodedata


def normalize(text: str, case_sensitive: bool = False) -> str:
    # Apostrophe glyph variants are equivalent; diacritics and Uzbek letters are retained.
    text = unicodedata.normalize('NFC', text)
    for glyph in ('‘', '’', 'ʻ', 'ʼ', '`'):
        text = text.replace(glyph, "'")
    text = ' '.join(text.split())
    return text if case_sensitive else text.casefold()


def grade_answer(answer: str | None, accepted: list[str], weight: float = 1, case_sensitive=False, manual_review=False):
    if not answer or not answer.strip():
        return 0.0, 'unanswered'
    if any(normalize(answer, case_sensitive) == normalize(key, case_sensitive) for key in accepted):
        return float(weight), 'correct'
    if manual_review:
        return None, 'pending'
    return 0.0, 'incorrect'


def validate_lookup(table: dict):
    expected = {f'{x / 2:.1f}' for x in range(49)}
    if set(table) != expected:
        raise ValueError('Table must contain exactly 49 keys: 0.0 through 24.0 in 0.5 steps')
    values = [float(table[f'{x / 2:.1f}']) for x in range(49)]
    if any(not math.isfinite(v) or not 0 <= v <= 75 for v in values):
        raise ValueError('Converted scores must be finite and within 0–75')
    if values != sorted(values):
        raise ValueError('Conversion must be monotonic')
    return {key: float(value) for key, value in table.items()}


def convert_essay(score: float, table: dict) -> float:
    if not math.isfinite(score) or not 0 <= score <= 24 or score * 2 != int(score * 2):
        raise ValueError('Essay score must be 0–24 in half-point steps')
    key = f'{score:.1f}'
    if key not in table:
        raise ValueError('Verified official conversion table is unavailable')
    return float(table[key])


def certificate_grade(t: float, thresholds: dict | None = None):
    if not math.isfinite(t):
        raise ValueError('Invalid score')
    thresholds = thresholds or {'A+':70,'A':65,'B+':60,'B':55,'C+':50,'C':46}
    for grade, cutoff in sorted(thresholds.items(), key=lambda item: item[1], reverse=True):
        if t >= cutoff:
            return grade
    return 'C dan past'


def standardize(theta: float, mean: float, sd: float):
    if not all(math.isfinite(v) for v in (theta, mean, sd)) or sd <= 0:
        raise ValueError('Reference SD must be positive and all values finite')
    z = (theta - mean) / sd
    return z, 50 + 10 * z
