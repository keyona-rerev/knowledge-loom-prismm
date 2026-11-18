# Business Onboarding Intake

Send the client the intake template (`intake_template.txt`). When their
answers come back, run the converter:

    python3 intake_to_wizard.py intake_filled.txt

It prints the import block. In the setup wizard, open **Your values** on the
"Load your intake answers" step, paste the block into **Import values**, and
press **Import**. The wizard fills those values into every later step.

## What the intake collects, and where each answer goes

| Intake answer | Wizard key | Used in |
| --- | --- | --- |
| Business name | `business_name` | Whole install (app, brand, emails) |
| Public logo link | `logo_url` | Brand step + Visual Studio |
| Brand colors (4) | `color_background`, `color_accent`, `color_highlight`, `color_sparing_accent` | Brand step |
| Font names | `font_names` | Brand step |
| Display font | `display_font` | Visual Studio (exact Google Fonts `Name:weight`) |
| Body font | `body_font` | Visual Studio (exact Google Fonts `Name:weights`) |
| Posting time zone | `posting_timezone` | Brand step |
| Posting time | `posting_time` | Brand step |
| Posting cadence | `posting_cadence` | Brand step |
| Business description | *(not a wizard key)* | App > Settings > Strategy, entered by hand |
| Audience | *(not a wizard key)* | App > Settings > Strategy, entered by hand |
| Tone | *(not a wizard key)* | App > Settings > Strategy, entered by hand |
| Words to avoid | *(not a wizard key)* | App > Settings > Strategy, entered by hand |

The converter passes through only wizard keys. The four long Strategy fields
are carried into the printed block as comments so they stay in one place; the
wizard ignores lines starting with `#`. Paste those four into the app by hand
during the brand step, exactly as that step says.

## Not intake

Account names, Supabase values, app URLs, email addresses and the worker repo
are made during installation, not collected from the client. The wizard asks
for them in their own steps. The intake never asks for passwords, keys or
tokens.
