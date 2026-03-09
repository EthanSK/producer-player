# Producer Player App Icon Direction

## Product + UI cues considered

- **Purpose:** quickly compare exported track versions and stay in creative flow.
- **UI style:** dark, desktop-first, high-contrast panels with blue accent (`--accent: #5ca7ff`).
- **Brand tone:** practical and technical, not playful; should feel native on macOS.

## Concept directions explored

1. **Stacked Takes (chosen)**
   - Three layered rounded bars represent version history / stacked exports.
   - A strong play triangle on the front layer reinforces playback.
   - Dark-to-blue gradient aligns with the app shell and marketing palette.

2. **Folder + Play**
   - A folder silhouette with embedded play symbol.
   - Communicates watch-folder workflow clearly.
   - Felt too file-manager-like and less premium at small sizes.

3. **Timeline Dial**
   - Circular progress/timeline mark with a play notch.
   - Good for “iterate and compare” metaphor.
   - Less distinctive in Dock context vs other media apps.

## Why we shipped “Stacked Takes”

It best combines the core Producer Player behaviors (version stacks + playback) while staying simple enough to remain readable from 16px menu/icon contexts to 1024px marketing use.

## Asset locations

- Source vector: `assets/icon/source/producer-player-icon.svg`
- Exported PNGs: `assets/icon/png/icon-{16,32,64,128,256,512,1024}.png`
- macOS iconset: `assets/icon/ProducerPlayer.iconset/*`
- macOS app icon (`.icns`): `assets/icon/ProducerPlayer.icns`
- README preview image: `docs/assets/icon/producer-player-icon-preview.png`

## Regeneration

```bash
npm run icon:build
```

This uses `scripts/generate-app-icon.sh` (`sips` + `iconutil`) to rebuild PNG and ICNS outputs from the SVG source.
