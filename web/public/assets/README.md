# Brand assets — verbatim delivery

Every file in this directory is served byte-for-byte by the sovereign host
(`/assets/<name>`). Nothing is cropped, filtered or restyled by the UI.

## Active assets

| File | Used for |
|---|---|
| `dashboard-matrix.jpg` | Full Gemini dashboard infographic — live HUD panels overlay on top |
| `dashboard-matrix.png` | Same (PNG variant) |
| `IMG_2764.JPEG` / `stage.jpg` | Subtle crimson stage underlay when matrix is active |

## Drop-in

Export your Gemini dashboard mockup and save it here as:

`web/public/assets/dashboard-matrix.jpg`

The UI probes `dashboard-matrix.jpg`, then `.png`, then legacy names automatically.
