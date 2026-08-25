# BuilderHelm Symbol Asset Pack

Production exports of the approved symbol-only BuilderHelm logo.

## Masters

- `source/builderhelm-selected-original.png` — untouched selected source.
- `master/builderhelm-master-dark.png` — cleaned production source with the corner sparkle removed.
- `master/builderhelm-master-dark-4096.png` — high-resolution dark-background master.
- `master/builderhelm-master-transparent-4096.png` — full-colour transparent master.
- `master/builderhelm-master-light-4096.png` — light-background master.
- `monochrome/` — solid light and dark transparent variants.

## Platform folders

- `favicon/` — 16, 32, and 48 px PNGs plus `favicon.ico`.
- `web/` — Apple touch icon, Microsoft tile, transparent, light, and monochrome PNGs.
- `pwa/` — 192, 512, and maskable 512 px icons plus a web manifest.
- `app/macos/` — complete iconset and compiled ICNS.
- `app/windows/` — Windows PNG sizes and ICO.
- `app/linux/` — freedesktop hicolor hierarchy.
- `app/ios/` — common iPhone, iPad, and App Store sizes with opaque backgrounds.
- `app/android/` — launcher densities, adaptive foreground/background, and Play Store icon.
- `social/` — profile, Open Graph, and X/Twitter card canvases without text.
- `previews/` — QA previews only.

## Website example

```html
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon-180.png" />
<link rel="manifest" href="/site.webmanifest" />
<meta name="theme-color" content="#0c1218" />
```

## Usage rules

- Do not stretch, rotate, crop, outline, or rearrange the symbol.
- Do not add gradients, shadows, glow, text, or new decorative elements.
- Use the dark master on dark surfaces, the light master on light surfaces, and monochrome files where colour is unavailable.
- Keep the existing clear space inside the square canvas.
- Prefer the 4096 px masters for future exports; do not upscale small derivatives.

## Regeneration

Run the included generator using the bundled workspace Node runtime with `sharp` available through `NODE_PATH`. The generator only performs deterministic extraction, compositing, and resizing from the cleaned master.
