# Producer Player App Icon Direction

## Current selected icon

**Queue Halo** is now the shipped Producer Player app icon.

Ethan selected it from the round-2 ordering-focused icon refinements on **Tue 2026-03-10**.

## Why Queue Halo won

- It communicates **track ordering** clearly with the numbered queue rows.
- It still reads as **playback / listening** because of the glowing play core.
- It feels a bit more premium and distinctive in the Dock than the older stacked-bars concept.
- It stays on-brand with the app’s dark desktop UI and blue accent palette.

## Source + generated assets

- Shipped source SVG: `assets/icon/source/producer-player-icon.svg`
- Exported PNGs: `assets/icon/png/icon-{16,32,64,128,256,512,1024}.png`
- macOS iconset: `assets/icon/ProducerPlayer.iconset/*`
- macOS app icon (`.icns`): `assets/icon/ProducerPlayer.icns`
- Preview image: `docs/assets/icon/producer-player-icon-preview.png`

## Origin / design history

The selected icon came from:

- `docs/assets/icon/ordering-refinement-round2-2026-03-10/02-queue-halo.svg`
- `docs/assets/icon/ordering-refinement-round2-2026-03-10/02-queue-halo.png`

Other round-2 explorations remain in that same folder for reference.

## Regeneration

```bash
npm run icon:build
```

This rebuilds the PNG exports, iconset, `.icns`, and preview image from `assets/icon/source/producer-player-icon.svg` using `scripts/generate-app-icon.sh`.
