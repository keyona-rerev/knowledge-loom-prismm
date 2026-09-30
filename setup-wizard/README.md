# Insight Forge setup wizard

Live wizard: https://insight-forge-setup-wizard.netlify.app

- `steps.json` holds every step, variable and copy block. Edit this file to change the wizard.
- The page code (`index.html`) comes from the shared setup wizard template. It reads `steps.json`.
- Clients enter each value once. The wizard fills it into later steps.
- The wizard never asks for passwords, keys or tokens.

Do not copy this folder to a client repo. The wizard tells clients to delete it.
