# Verify cairn-garden

Cairn - a quiet minute (ambient audio experience, vendored physics).

## Launch
Serve the repo root over plain HTTP and load it in a real browser; everything is static.

```bash
python3 -m http.server 8144 --bind 127.0.0.1
```

## Doctor
`python3 .cursor/skills/verify-cairn-garden/verify.py` - exits non-zero and lists failures when anything regresses.

## Drive
The runner serves the app, renders it in headless Chromium, and asserts the boot markers plus zero JS console errors. External-network content is neutralized via host-resolver rules.

## Evidence
Latest run is written to `.cursor/skills/verify-cairn-garden/evidence.json`.

## Cleanup
The runner leaves no daemons or state.

## Known boundaries
Proves local boot and console cleanliness, not audio output or third-party services.
