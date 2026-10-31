---
name: Kinetic Precision
colors:
  surface: '#0f131c'
  surface-dim: '#0f131c'
  surface-bright: '#353942'
  surface-container-lowest: '#0a0e16'
  surface-container-low: '#181c24'
  surface-container: '#1c2028'
  surface-container-high: '#262a33'
  surface-container-highest: '#31353e'
  on-surface: '#dfe2ee'
  on-surface-variant: '#b9cacb'
  inverse-surface: '#dfe2ee'
  inverse-on-surface: '#2c3039'
  outline: '#849495'
  outline-variant: '#3b494b'
  surface-tint: '#00dbe9'
  primary: '#dbfcff'
  on-primary: '#00363a'
  primary-container: '#00f0ff'
  on-primary-container: '#006970'
  inverse-primary: '#006970'
  secondary: '#c0c1ff'
  on-secondary: '#1000a9'
  secondary-container: '#3131c0'
  on-secondary-container: '#b0b2ff'
  tertiary: '#fff5de'
  on-tertiary: '#3b2f00'
  tertiary-container: '#fed639'
  on-tertiary-container: '#715d00'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#7df4ff'
  primary-fixed-dim: '#00dbe9'
  on-primary-fixed: '#002022'
  on-primary-fixed-variant: '#004f54'
  secondary-fixed: '#e1e0ff'
  secondary-fixed-dim: '#c0c1ff'
  on-secondary-fixed: '#07006c'
  on-secondary-fixed-variant: '#2f2ebe'
  tertiary-fixed: '#ffe179'
  tertiary-fixed-dim: '#eac324'
  on-tertiary-fixed: '#231b00'
  on-tertiary-fixed-variant: '#554500'
  background: '#0f131c'
  on-background: '#dfe2ee'
  surface-variant: '#31353e'
typography:
  display:
    fontFamily: Space Grotesk
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.03em
  display-mobile:
    fontFamily: Space Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 26px
    fontWeight: '600'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 20px
    fontWeight: '500'
    lineHeight: 28px
    letterSpacing: 0em
  title:
    fontFamily: Space Grotesk
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: 0em
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: 0em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0.01em
  label-lg:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.02em
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.04em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.06em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1rem
  gutter-lg: 1.5rem
  margin: 1.5rem
  margin-sm: 1rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2rem
  space-2xl: 3rem
---

## Brand & Style

This design system targets voice actors, audio engineers, researchers, and power listeners who transform dense textual documents into studio-grade spoken audiobooks. The product aesthetic balances high-precision digital audio workstation (DAW) utility with the sleek elegance of modern developer tooling.

The interface evokes focus, speed, and acoustic mastery. Drawing from a fusion of **Dark Studio Glassmorphism** and **Technical High-Contrast Precision**, the UI establishes depth through semi-translucent slate tiers, luminescent accent signals, and 1px crisp structural bounds. Interactive surfaces feel alive, utilizing controlled cyan electromagnetic glows and indigo resonance to deliver immediate tactile feedback for high-density document parsing, timeline synthesis, and audio mastering workflows.

## Colors

The palette is engineered for prolonged sessions in low-light editing environments, providing deep optical comfort without sacrificing contrast.

- **Background Canvas (`#0B0F17`):** Deep slate ground that anchors the entire workspace.
- **Surface Elevation (`#111827`):** Frosted mid-ground cards with 70–85% alpha overlays for audio panes and document visualizers.
- **Structural Bounds (`#1F2937`):** Hairline borders framing structural panes and interactive tracks.
- **Primary Accent (`#00F0FF`):** Electric Cyan indicates active playheads, live synthesizers, selection ranges, and real-time audio waveforms.
- **Secondary Accent (`#6366F1`):** Vibrant Indigo directs document structure nodes, chapter breaks, and AI voice model selections.
- **Status & Feedback:**
  - Success/Synthesized: `#10B981` (Emerald)
  - Warning/Buffer Lag: `#F59E0B` (Amber)
  - Error/Clip Distortion: `#EF4444` (Crimson)
  - Text Primary: `#F9FAFB`
  - Text Muted: `#9CA3AF`
  - Text Ghost: `#4B5563`

## Typography

The typographic hierarchy separates structural narrative, prose legibility, and telemetry readouts.

- **Headings (Space Grotesk):** Provides a geometric, forward-leaning studio identity. Used for viewports, chapter markers, and module headers. Tight tracking enhances density.
- **Body & Prose (Inter):** Highly legible across dense PDF extractions, script sidebars, and transcription reviews.
- **Metrics, Data & Timecodes (JetBrains Mono):** Reserved for bitrates, sample rates (48kHz/24-bit), timecodes (`00:42:19.450`), voice parameters, and hotkey tooltips. Tabular figures prevent layout shifts during playback rendering.

## Layout & Spacing

This design system uses a strict **12-column fluid grid** for workstation screens and master canvas panels, collapsing to 6 columns on tablet and 4 columns on mobile. 

- **Layout Structure:** Built around a multi-pane studio layout: a persistent left rail (document index/chapter hierarchy), a wide central audio-text canvas (PDF view and synced speech track), and a collapsible right inspector (voice tuning, synthesis engines, export parameters).
- **Rhythm & Alignments:** Consistent 8pt baseline scale. Gaps between audio segments, waveforms, and processing chips default to `space-sm` (8px) and `space-md` (16px) to maintain workstation density without visual crowding.
- **Breakpoints:**
  - `Desktop (>= 1280px)`: Three-column persistent layout; fixed sidebar inspectors, fluid central timeline.
  - `Tablet (768px - 1279px)`: Two-column layout; inspector collapses into an overlay drawer.
  - `Mobile (< 768px)`: Single-column stack; bottom-sheet audio transport and segmented chapter selector.

## Elevation & Depth

Visual hierarchy uses **Glassmorphic Tonal Stratification** paired with hairline boundaries, avoiding heavy drop shadows in favor of ambient luminescence:

- **Level 0 (Canvas Base):** Solid `#0B0F17`. Deepest background plane for the overall shell.
- **Level 1 (Docked Containers & Sidebars):** `#111827` at 80% opacity with `backdrop-filter: blur(16px)` and a continuous `1px solid #1F2937` edge border.
- **Level 2 (Floating Cards, Modules, Popovers):** `#1E293B` at 60% opacity with `backdrop-filter: blur(24px)`, a `1px solid rgba(255, 255, 255, 0.08)` stroke, and an ambient tinted drop shadow: `0 8px 32px -4px rgba(0, 0, 0, 0.6)`.
- **Level 3 (Active Focus & Glow States):** Interactive elements (selected audio nodes, playheads, active voice chips) emanate an electromagnetic glow:
  - Primary Cyan: `box-shadow: 0 0 20px -2px rgba(0, 240, 255, 0.35), inset 0 0 12px rgba(0, 240, 255, 0.1)`.
  - Secondary Indigo: `box-shadow: 0 0 20px -2px rgba(99, 102, 241, 0.4)`.

## Shapes

The interface embraces a **Soft/Industrial Precision** geometry (`roundedness: 1`). 

- Standard inputs, transport buttons, chips, and data cards utilize `0.25rem` (4px) corner rounding to maintain instrument-panel discipline.
- Flyout dialogs, audio scrubber modules, and modal sheets scale to `0.5rem` (8px).
- Audio level sliders and scrubber tracks utilize `0.125rem` (2px) or sharp bounds, evoking calibrated pro-audio hardware rather than playful consumer software.

## Components

### Buttons
- **Primary (Synthesis / Export):** Solid `#00F0FF` background, `#0B0F17` bold typography (`JetBrains Mono`), `4px` radius. Hover triggers an outer cyan laser glow (`0 0 16px rgba(0, 240, 255, 0.45)`) and slight brightness elevation.
- **Secondary (Playback / Edit):** `#111827` surface with `1px solid #1F2937`, text in `#F9FAFB`. Hover brings a `1px solid #6366F1` transition with faint indigo backlight.
- **Ghost / Tool Action:** Transparent background, muted text (`#9CA3AF`), hover switches to `#1F2937` with `#00F0FF` text.

### Chips & Parameter Tags
- Constructed with `label-md` (`JetBrains Mono`). Translucent background `rgba(31, 41, 55, 0.6)` bound by `1px solid #1F2937`.
- When selected (e.g., active voice profile "Neural Neural-8"), background shifts to `rgba(99, 102, 241, 0.15)` with a `#6366F1` stroke and text glowing `#FFFFFF`.

### Inputs & Scrubbers
- **Text & Prompt Fields:** Flat `#0B0F17` filled interior, `1px solid #1F2937`, inset focus indicator glowing `#00F0FF` with `0 0 0 1px #00F0FF`.
- **Numeric Voice Steppers (Pitch, Speed, Pauses):** JetBrains Mono centered values flanked by low-profile `+`/`-` buttons with tactile active depression (`transform: scale(0.97)`).

### Selection Controls (Checkboxes & Radios)
- Crisp square/circular modules with `1px solid #374151`. Active state features a solid `#00F0FF` fill and a contrasting `#0B0F17` centered check/dot.

### Cards & Waveform Containers
- Backed by `#111827` at 85% opacity, `backdrop-filter: blur(12px)`, edged with `1px solid #1F2937`.
- Hovering over document nodes or chapter blocks transitions the border to `rgba(0, 240, 255, 0.4)` without altering layout geometry.

### Studio-Specific Components
- **Audio Scrubber / Timeline:** Background rail `#1F2937` (4px height). Progress track rendered in bright `#6366F1`. Playhead thumb is a diamond or micro-rect in `#00F0FF` with a continuous `0 0 10px #00F0FF` aura and real-time `JetBrains Mono` timecode tooltip.
- **VU Level Meter:** Vertical/horizontal strip of segmented rectangular LEDs transitioning from `#00F0FF` through `#6366F1` to `#EF4444` at peak headroom.