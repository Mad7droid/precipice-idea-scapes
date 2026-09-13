/**
 * The app's one button.
 *
 * Before this existed every action wrote its own class string, and the accent orange drifted
 * with them: filled actions appeared at three radii, two durations, two font weights, and with
 * or without a disabled state, while a danger pill borrowed `text-fg-on-accent` and rendered
 * near-black text on crimson in dark mode. Colour hierarchy is a system property — it only
 * holds if there is exactly one place that decides it.
 *
 * The rules this encodes:
 *
 * 1. `--action-primary` — the deep rust fill — is reachable only through `variant="primary"`,
 *    and a surface gets at most one. It is the loudest thing on screen by construction.
 * 2. `--accent` — the bright signal orange — never fills a button. It belongs to focus rings,
 *    selection, canvas connectors and small indicators, where a saturated hue reads as state
 *    rather than as an invitation to click.
 * 3. A selected or pressed toggle is `bg-selected`, not an accent fill. Toggles outnumber
 *    actions, so filling them turns the accent into wallpaper and the real action disappears.
 * 4. Text on a fill comes from that fill's own token — `--text-on-action-primary` for the
 *    action, `--text-inverse` for danger — never from `--text-on-accent`, which is tuned for
 *    the bright accent alone and flips to near-black in dark mode.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "neutral" | "secondary" | "ghost" | "destructive";
export type ButtonSize = "sm" | "md";
/** `icon` is a square of the size's height — for a control whose label is a glyph. */
export type ButtonShape = "rounded" | "pill" | "icon";

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 text-left " +
  "transition-colors duration-instant ease-out disabled:cursor-default";

const VARIANTS: Record<ButtonVariant, string> = {
  // The one filled accent. Weight is part of the variant: a primary reads as a block of
  // colour, and 400 text inside it looks like a mistake next to the 500 it sits beside.
  primary:
    "font-medium bg-action-primary text-fg-on-action-primary hover:bg-action-primary-hover " +
    "active:bg-action-primary-active disabled:bg-inset disabled:text-fg-tertiary",
  // A filled control that is deliberately *not* the primary — Stop, which undoes the
  // primary rather than performing it. Filled so it holds the same footprint as the Send it
  // replaces, neutral so the corner never has two loud controls in it.
  neutral: "bg-surface text-fg hover:bg-raised disabled:opacity-50",
  secondary:
    "border border-default text-fg-secondary hover:bg-hover hover:text-fg " +
    "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-secondary",
  ghost:
    "text-fg-secondary hover:bg-hover hover:text-fg " +
    "disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-fg-secondary",
  // Crimson is far enough from the accent to be unambiguous at this size; `--text-inverse`
  // is the one label colour that clears both the light and the dark danger fill.
  destructive: "font-medium bg-danger text-fg-inverse hover:opacity-90 disabled:opacity-50",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "h-7 w-7 p-0",
  md: "h-8 w-8 p-0",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  shape = "rounded",
  className = "",
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  className?: string;
} = {}) {
  const geometry =
    shape === "icon" ? `rounded-full ${ICON_SIZES[size]}` : `${radius(shape)} ${SIZES[size]}`;
  return `${BASE} ${VARIANTS[variant]} ${geometry}${className ? ` ${className}` : ""}`;
}

/** Radius 8 is the button radius in the design language; `pill` is for chrome and toolbars. */
function radius(shape: Exclude<ButtonShape, "icon">) {
  return shape === "pill" ? "rounded-full" : "rounded-md";
}

export function Button({
  variant,
  size,
  shape,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  shape?: ButtonShape;
  children?: ReactNode;
}) {
  return (
    <button
      // A button inside a form defaults to submit, which has silently sent forms that only
      // meant to close a dialog. Callers that want submit ask for it.
      type="button"
      {...props}
      className={buttonClass({ variant, size, shape, className })}
    >
      {children}
    </button>
  );
}
