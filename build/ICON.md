# Serphia / Unfold

The symbol represents potential becoming action: two broad folded surfaces open
around a generous rising path of negative space. It can evoke an opening seed or
wing without requiring a literal reading. Its identity comes from the asymmetric
silhouette, not from an initial or a letterform.

The concept was explored using the built-in image generation tool, then redrawn
as two editable Bézier paths for predictable desktop rendering. The symbol works
as one flat color without textures, shading, or a wordmark. The charcoal desktop
tile (`#242824`) carries a warm ivory symbol (`#F4F1E8`).

Edit **`build/mark.svg`**, then run **`npm run build:icons`**. This regenerates the
app tile and all platform assets. Do not edit generated `build/icon.svg` directly.
The rasterizer is a development dependency, not an application dependency.

- `mark.svg`: standalone monochrome vector master.
- `icon.svg`: generated tile, with a 64 px transparent inset on a 1024 px canvas.
- `icon.png`: 1024 × 1024 RGBA master, also used by the README and Dock.
- `icon.ico`: 16, 20, 24, 32, 40, 48, 64, 128, and 256 px Windows frames.
- `icon.icns`: macOS standard and Retina representations up to 1024 px.
- `icons/`: PNG exports from 16 to 1024 px, also used by Linux packaging.
- `trayTemplate.png` and `trayTemplate@2x.png`: 18/36 px monochrome menu-bar mark.

The full-color icon is for application launchers, desktop shortcuts, and Windows
or Linux trays. The transparent monochrome template is for the macOS menu bar,
where the operating system adapts its color to the current appearance.

## Image generation brief

Original abstract symbol for a premium AI desktop workspace: “Unfold / potential
becoming action.” Two broad softly folded surfaces open around one generous
negative-space aperture. Evoke an unfolding seed or opening wing without literal
illustration. Memorable asymmetric silhouette, optical balance, at most two or
three broad shapes, recognisable at 16–32 px. Monochrome, vector-friendly, flat
near-black on warm off-white. No letters, initials, S, typography, infinity,
six-loop knot, apple, stock AI sparkle, brain, circuit, or decorative dots. Seek
the restraint and finish of established product identities without imitating
their symbols. One centered finished logo, no app tile, frame, gradient, shadow,
bevel, or mockup. Generated using the built-in image tool, not the CLI fallback.
