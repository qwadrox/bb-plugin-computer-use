/**
 * Shared hover-motion heuristic for primitives, so the whole UI speaks one
 * timing language instead of ad-hoc per-component transitions:
 *
 * - CONTROL_HOVER_TRANSITION — interactive controls (buttons, icon buttons):
 *   the hover/active fill snaps IN instantly (0ms) and eases OUT lazily (150ms).
 *   Immediate feedback on the way in, never twitchy on the way out. The trick:
 *   CSS applies the *end state's* transition-duration for each direction, so a
 *   base `duration-150` governs hover-out while `hover:duration-0` makes
 *   hover-in instant.
 *
 * Reach for it rather than a bare `transition-colors` on anything with a
 * hover/active state.
 */
export const CONTROL_HOVER_TRANSITION =
  "transition-colors duration-150 hover:duration-0";

/**
 * Easing curves, ported from beUI's `lib/ease.ts`. Deliberately strong custom
 * curves: the stock CSS timing functions read as weak and generic next to them.
 *
 * (Naming a stock utility inside this file would be enough to make Tailwind
 * emit it — the scanner reads comments too — so the ones these replace are
 * described rather than spelled out.)
 *
 * Only the Tailwind arbitrary-value form is exported. The class strings have to
 * be literals: Tailwind scans source text for class candidates, so an
 * interpolated `ease-[cubic-bezier(${…})]` would never be emitted. Because this
 * file is inside Tailwind's `@source` roots, the `EASE_*_CLASS` constants are
 * scannable here and callers can interpolate them into their own class strings.
 */

/** Expo-flavored ease-out: fast initial move, long gentle settle. BB's default
 * curve for expand/collapse, opacity and transform transitions. */
export const EASE_OUT_CLASS = "ease-[cubic-bezier(0.16,1,0.3,1)]";

/** Back-out with a single small overshoot — the CSS stand-in for the bouncy
 * spring in beUI's bouncy accordion. Use it on transform/translate settles of
 * revealed content while the container's height keeps the plain expand curve:
 * `fr`-based grid rows cannot visually overshoot, so the bounce has to live on
 * the content, never the layout. */
export const EASE_BOUNCE_CLASS = "ease-[cubic-bezier(0.34,1.56,0.64,1)]";

/**
 * Overlay motion — the enter/exit treatment shared by the desktop overlay
 * surfaces (dialog and tooltip). CSS only: the surfaces ride tw-animate-css's
 * enter and exit keyframes.
 *
 * (Those two utilities are named in prose rather than spelled out. This file is
 * a Tailwind source root and the scanner reads comments as readily as code, so
 * writing the bare exit utility here would emit a real, unused rule — the
 * variant-prefixed forms below are the only ones anything actually renders.)
 *
 * Two rules shape the numbers. **Exit is faster than enter** — a surface being
 * dismissed is already out of the user's attention, so lingering reads as lag,
 * while an arriving surface needs the extra frames to be legible. And **the
 * closer a surface sits to its trigger, the shorter it runs** — a popover
 * anchored under the pointer is a small local change (140ms), while the
 * center-unfold dialog gets 300ms to make its spatial origin legible.
 */

/**
 * Tailwind class bundles for the desktop overlay surfaces.
 *
 * Same literal-text constraint as `EASE_*_CLASS` above, and one step stricter:
 * the durations are baked into arbitrary values here (for example 300ms)
 * rather than interpolated from shared constants, because Tailwind would never
 * emit an interpolated utility.
 *
 * `duration-*` and `ease-*` reach the keyframes through tw-animate-css's
 * `--tw-duration`/`--tw-ease` indirection, which is why they are scoped per
 * `data-state` — that is what makes exit and enter run at different speeds off
 * a single class list.
 *
 * The reduced-motion kill switch is what makes these surfaces appear and
 * disappear instantly: with no animation to wait on, Radix's presence check
 * unmounts on the same tick. It has to be spelled `motion-reduce:data-[state=…]`
 * rather than a plain `motion-reduce:animate-none`, and that is a cascade
 * requirement, not a style preference. `animate-in` is applied through a
 * `data-state` variant, so it compiles to a class *and* an attribute selector —
 * specificity (0,2,0). A bare `motion-reduce:animate-none` is only (0,1,0), and
 * a media query contributes nothing, so it would lose and the overlay would keep
 * animating for anyone who asked it not to. Restating the `data-state` variant
 * ties the specificity, and the reduced-motion rule sorts later, so it wins.
 */

/** Scrim behind a dialog. Fades on the dialog's own timings so the two read as
 * one surface arriving rather than a backdrop chasing a panel. */
export const OVERLAY_BACKDROP_MOTION_CLASS = [
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
  "data-[state=open]:duration-[300ms] data-[state=closed]:duration-[180ms]",
  "data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]",
  "data-[state=closed]:ease-[cubic-bezier(0.16,1,0.3,1)]",
  "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
].join(" ");

/**
 * Desktop modal surface adapted from beUI's center-morph modal. BB keeps
 * Radix as the focus, dismissal, portal, and controlled-state authority; this
 * shared class only supplies a theme-aware 30px-equivalent shell.
 *
 * With BB's default 8px control radius, `var(--radius) + 22px` resolves to the
 * reference's 30px. Custom palettes can still re-anchor the base radius.
 */
export const OVERLAY_DIALOG_SURFACE_CLASS =
  "isolate rounded-[calc(var(--radius)+1.375rem)] border border-border bg-surface-raised-solid shadow-2xl";

/** Semantic frosted scrim shared by desktop modal primitives. */
export const OVERLAY_BACKDROP_SURFACE_CLASS =
  "bg-surface-scrim backdrop-blur-sm";

/**
 * Centered dialog panel: unfold from the exact center, then fold back toward
 * it. The source component clips a full-size panel; BB expresses the same
 * spatial metaphor through tw-animate's existing center-origin scale so Radix
 * can continue owning mount and exit presence without a second controller.
 */
export const OVERLAY_DIALOG_MOTION_CLASS = [
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "origin-center data-[state=open]:zoom-in-4 data-[state=closed]:zoom-out-4",
  "data-[state=open]:duration-[300ms] data-[state=closed]:duration-[180ms]",
  "data-[state=open]:ease-[cubic-bezier(0.2,0,0.2,1)]",
  "data-[state=closed]:ease-[cubic-bezier(0.2,0,0.2,1)]",
  "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
].join(" ");

/** Anchored popover/menu panel: a fade plus a 4px travel *out of* the anchor on
 * enter and back into it on exit, so the surface reads as belonging to the
 * control that opened it. No scale — at this size and duration a zoom only
 * blurs the text mid-flight. */
export const OVERLAY_POPOVER_MOTION_CLASS = [
  "data-[state=open]:animate-in data-[state=closed]:animate-out",
  "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
  "data-[side=bottom]:slide-in-from-top-1 data-[side=bottom]:slide-out-to-top-1",
  "data-[side=top]:slide-in-from-bottom-1 data-[side=top]:slide-out-to-bottom-1",
  "data-[side=left]:slide-in-from-right-1 data-[side=left]:slide-out-to-right-1",
  "data-[side=right]:slide-in-from-left-1 data-[side=right]:slide-out-to-left-1",
  "data-[state=open]:duration-[140ms] data-[state=closed]:duration-[100ms]",
  "data-[state=open]:ease-[cubic-bezier(0.16,1,0.3,1)]",
  "data-[state=closed]:ease-[cubic-bezier(0.16,1,0.3,1)]",
  "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
].join(" ");
