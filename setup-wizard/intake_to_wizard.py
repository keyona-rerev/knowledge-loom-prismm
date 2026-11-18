#!/usr/bin/env python3
"""Convert a filled Business Onboarding Intake into the wizard import block.

Usage: python3 intake_to_wizard.py intake_filled.txt
Prints key=value lines for the setup wizard's "Import values" box.
Exits non-zero and prints every problem found if the intake is not usable.
"""
import re, sys

WIZARD_KEYS = [
    "business_name",
    "logo_url",
    "color_background", "color_accent", "color_highlight", "color_sparing_accent",
    "font_names",
    "display_font", "body_font",
    "posting_timezone", "posting_time", "posting_cadence",
]
STRATEGY_FIELDS = ["description", "audience", "tone", "words_to_avoid"]
REQUIRED = ["business_name", "logo_url", "display_font", "body_font"]

HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
FONT = re.compile(r"^[A-Za-z][A-Za-z0-9 ]*:[0-9,]+$")
SECRET = re.compile(r"^(sk-|sk_|pk_live|sk_live|eyJ|ghp_|gho_|github_pat_|xox[abp]-|AKIA|AIza|SG\.|re_)", re.I)

def load(path):
    vals = {}
    for n, line in enumerate(open(path, encoding="utf-8"), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"^([a-zA-Z0-9_]+)\s*[=:]\s*(.*)$", line)
        if not m:
            print(f"warning: line {n} ignored (not key=value): {line[:60]}", file=sys.stderr)
            continue
        vals[m.group(1)] = m.group(2).strip().strip("\"'")
    return vals

def main(path):
    vals = load(path)
    problems = []
    for k in REQUIRED:
        if not vals.get(k):
            problems.append(f"missing required answer: {k}")
    for k, v in vals.items():
        if SECRET.match(v):
            problems.append(f"{k}: looks like a secret/token - the intake must never carry one")
    for k in ("color_background", "color_accent", "color_highlight", "color_sparing_accent"):
        v = vals.get(k)
        if v and not HEX.match(v):
            problems.append(f"{k}: expected #RRGGBB, got {v!r}")
    u = vals.get("logo_url", "")
    if u and not (u.startswith("https://") and re.search(r"\.(png|jpe?g|webp|gif)(\?|#|$)", u, re.I)):
        problems.append("logo_url: must be a public https:// link to a PNG, JPEG, WebP or GIF")
    for k in ("display_font", "body_font"):
        v = vals.get(k)
        if v and not FONT.match(v):
            problems.append(f"{k}: expected Google Fonts 'Name:weights', e.g. 'Fraunces:600' or 'Inter:400,700', got {v!r}")
    tz = vals.get("posting_timezone", "")
    if tz and "/" not in tz:
        problems.append(f"posting_timezone: expected an IANA zone like America/Chicago, got {tz!r}")
    tm = vals.get("posting_time", "")
    if tm and not re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", tm):
        problems.append(f"posting_time: expected 24-hour HH:MM, got {tm!r}")
    unknown = [k for k in vals if k not in WIZARD_KEYS and k not in STRATEGY_FIELDS]
    for k in unknown:
        print(f"warning: unknown answer {k!r} ignored", file=sys.stderr)
    if problems:
        print("INTAKE NOT USABLE:", file=sys.stderr)
        for p in problems:
            print(" - " + p, file=sys.stderr)
        return 1
    print("# Paste everything below into the wizard's Import values box.")
    for k in WIZARD_KEYS:
        if vals.get(k):
            print(f"{k}={vals[k]}")
    print("# Long Strategy fields - enter these in the app by hand (Settings > Strategy):")
    for k in STRATEGY_FIELDS:
        if vals.get(k):
            print(f"# {k}={vals[k]}")
    return 0

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(main(sys.argv[1]))
