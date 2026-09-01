# Seebugbus brand assets

Everything a site needs: favicons, app icons, social cards, logo lockups, source SVGs,
and design tokens.

## Palette

| Token | Hex | Use |
| --- | --- | --- |
| `--sbb-ink` | `#2B2118` | Text, outlines, road |
| `--sbb-sand` | `#F2E3C6` | Page background, badge fill |
| `--sbb-cream` | `#F8F1E0` | Bus upper panel, windows, surfaces |
| `--sbb-orange` | `#E0703F` | Primary accent, bus body |
| `--sbb-teal` | `#3E7F91` | Secondary accent |
| `--sbb-dome` | `#2F6475` | The jukebox dome only |

## Typefaces

Outfit — Bold (700) for the wordmark and headings, SemiBold (600) for small labels.
Playfair Display Black (900) — the tagline only.

Both are Open Font License: `npm i @fontsource/outfit @fontsource/playfair-display`.

The wordmark stacks as two lines, `seebug` over `bus`, left aligned, tight negative
tracking, leading a little under the cap height. Never set it on one line — the stack
is the identity.

The tagline mixes both faces: CHOOSE YOUR OWN and ADVENTURE in Playfair Black caps, and
`music` in lowercase Outfit Bold in `--sbb-orange`, sized about 18% larger so its
x-height optically matches the surrounding caps. The lowercase break is the point — the
brand voice interrupting the poster voice. Don't flatten it to one case, one face, or
one colour. This is the only place caps appear in the identity.

## The jukebox dome

The teal dome is the jukebox and it's the dominant element. It springs from a 200-unit
radius at the vertical midpoint and runs flush to the bottom of the badge, clipped to the
badge's own corner radius so its base follows the rounded corners rather than cutting
across them. Don't stop it short — a square-cornered dome inside a rounded badge leaves
slivers of sand that read as a mistake.

It's a solid fill rather than an outline because thin strokes disappear below about 48px.
The filled shape survives down to 16px.

The bus and road sit at roughly 88% of their original weight so the dome reads first.
Both carry a sand-coloured casing that separates them from the teal; without it they
merge into the dome and the mark goes muddy. Bus windows are cream rather than teal for
the same reason.

Three mark tiers exist because detail turns to mush at small sizes:

- `logo-mark` — 96px and up. Roof rack, wheel hubs, full road.
- `logo-mark-sm` — 32 to 64px. Drops the rack and hubs.
- `logo-mark-xs` — 16 to 24px. Drops windows and road too.

Wire each favicon size to its matching tier rather than downscaling one source.

## Files

```
svg/          Source vectors — scale these, don't scale the PNGs
  logo-primary.svg        Mark + stacked wordmark, horizontal. Site header.
  logo-stacked.svg        Mark above centred wordmark. Splash, footer.
  logo-wordmark.svg       Type only, stacked.
  *-reversed.svg          Same three with the wordmark in sand. Use on dark UI.
  logo-mark.svg           Full-detail badge, 96px+.
  logo-mark-sm.svg        Reduced, 32-64px.
  logo-mark-xs.svg        Heavily reduced, 16-24px.
  logo-mark-transparent.svg  No badge fill.
  logo-mono.svg           Single-ink. Stamps, print, watermarks.
  icon-maskable.svg       13% safe padding for Android adaptive icons.
  tagline.svg             Mixed-face tagline lockup.

favicon/      favicon.ico (16/32/48 bundled) + individual PNGs
icons/        apple-touch-icon.png, icon-192, icon-512, icon-maskable-512
social/       og-image.png (1200x630), twitter-card.png (1200x600)
logo/         Raster exports, 1x and 2x, including tagline and reversed
brand-tokens.css   CSS custom properties, includes a dark-mode block
site.webmanifest   PWA manifest
```

The badge stays sand in both light and dark contexts — it needs the light ground to hold
the dome. Only the wordmark flips, which is what the reversed variants are for.

The apple-touch-icon is square on purpose. iOS applies its own corner mask, so a
pre-rounded source gets double-rounded on the home screen.

## HTML

```html
<link rel="icon" href="/favicon/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon/favicon-32x32.png">
<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<meta name="theme-color" content="#2B2118">

<meta property="og:image" content="https://YOURDOMAIN/social/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://YOURDOMAIN/social/twitter-card.png">
```

## Clear space and minimum sizes

Keep clear space around the lockup equal to the height of the `b` in `bus`.
Minimum widths: horizontal lockup 180px, stacked lockup 120px, mark 16px.

Don't recolour the mark, stretch it, or add effects.

## Note on the illustration

The van is drawn as a generic retro shape rather than a Volkswagen. VW protects the
Beetle and Microbus silhouettes as trade dress, so keep any future variants
non-specific too.
