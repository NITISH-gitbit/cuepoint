# CuePoint brand identity

## Name and icon

- **App name:** CuePoint
- **Firefox Add-ons (AMO) listing title:** CuePoint — YouTube Timestamp Bookmarks
- **Version at time of documentation:** 1.1.3. See the [extension manifest](manifest.json) for the current version.
- **Icon:** [Playback Bookmark](icons/cuepoint.svg). A play triangle sits inside a coral bookmark whose tip marks the exact boundary between the played and unplayed portions of the track. Use the SVG for the Firefox toolbar, extension icon, and in-app branding.

## Typography

- **Interface text:** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
- **Timecodes, counts, and URLs:** `ui-monospace, "SF Mono", Menlo, Consolas, monospace`

The Moments page includes `"Cascadia Code"` and `"Cascadia Mono"` before Menlo in its monospace stack. The injected YouTube controls use Roboto and Arial for interface text to fit the host page.

## Dark palette

| Token or role | Value | Use |
| --- | --- | --- |
| `--accent` | `#ff4e45` | Primary buttons, focus rings, and the YouTube Save moment play icon |
| `--accent-text` | `#ff7b74` | Timecodes, counts, and link hover text on dark surfaces |
| `--accent-soft` | `rgba(255, 78, 69, 0.14)` | Timestamp pills, active badges, and copied states |
| `--on-accent` | `#18181d` | High-contrast text on solid accent buttons and active switches |
| `--bg` | `#0f0f12` | Main canvas and input backgrounds |
| `--panel` | `#18181d` | Video cards and secondary surfaces |
| `--panel-hover` | `#212128` | Video card hover state |
| Elevated popover surface | `#202027` | Timestamp note popover, Cloud Sync popover, and mobile overflow menu |
| `--line` | `#282830` | Hairline dividers |
| `--line-strong` | `#383844` | Interactive borders |
| `--text` | `#f1f4f4` | Primary text in the brand specification |
| `--muted` | `#a1a1aa` | Secondary text |
| `--faint` | `#71717a` | De-emphasized metadata |
| `--success` | `#4ade80` | Live sync and success states |
| `--info` | `#5b9dff` | Share and copy actions |
| `--danger` | `#ff6b6b` | Delete and error states |

## Implementation reference

- [Moments stylesheet](src/moments/moments.css#L5) defines the dark palette and font tokens. It currently sets `--text` to `#f1f1f4`, which differs from the brand specification above. The popover surface is an inline CSS value, not a named token.
- [YouTube content stylesheet](src/content/content.css) styles the injected button and note popover. The play icon uses the primary accent in the [content script](src/content/content.js#L18).
