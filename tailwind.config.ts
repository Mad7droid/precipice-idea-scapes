import type { Config } from "tailwindcss";

/**
 * Every value here points at a semantic CSS variable from src/design/tokens.css.
 * No hex, no px, no ms in this file. If you need a value that isn't here,
 * you need a token — talk to the integrator, don't inline it.
 */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: "var(--bg-canvas)",
        base: "var(--bg-base)",
        surface: "var(--bg-surface)",
        raised: "var(--bg-raised)",
        inset: "var(--bg-inset)",
        hover: "var(--bg-hover)",
        active: "var(--bg-active)",
        selected: "var(--bg-selected)",

        fg: {
          DEFAULT: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          inverse: "var(--text-inverse)",
          accent: "var(--text-accent)",
          "on-accent": "var(--text-on-accent)",
        },

        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          active: "var(--accent-active)",
          subtle: "var(--accent-subtle)",
        },

        success: "var(--success)",
        danger: "var(--danger)",
        info: "var(--info)",
        warning: "var(--warning)",

        obj: {
          note: "var(--obj-note)",
          journey: "var(--obj-journey)",
          wireframe: "var(--obj-wireframe)",
          persona: "var(--obj-persona)",
          metric: "var(--obj-metric)",
          risk: "var(--obj-risk)",
        },
      },

      borderColor: {
        DEFAULT: "var(--border-default)",
        subtle: "var(--border-subtle)",
        strong: "var(--border-strong)",
        focus: "var(--border-focus)",
      },

      fontFamily: {
        sans: "var(--font-ui)",
        mono: "var(--font-mono)",
      },

      fontSize: {
        "2xs":  ["var(--text-2xs)",  { lineHeight: "var(--leading-2xs)",  letterSpacing: "var(--tracking-2xs)" }],
        xs:     ["var(--text-xs)",   { lineHeight: "var(--leading-xs)" }],
        sm:     ["var(--text-sm)",   { lineHeight: "var(--leading-sm)" }],
        base:   ["var(--text-base)", { lineHeight: "var(--leading-base)" }],
        lg:     ["var(--text-lg)",   { lineHeight: "var(--leading-lg)",   letterSpacing: "var(--tracking-lg)" }],
        xl:     ["var(--text-xl)",   { lineHeight: "var(--leading-xl)",   letterSpacing: "var(--tracking-xl)" }],
        "2xl":  ["var(--text-2xl)",  { lineHeight: "var(--leading-2xl)",  letterSpacing: "var(--tracking-2xl)" }],
        "3xl":  ["var(--text-3xl)",  { lineHeight: "var(--leading-3xl)",  letterSpacing: "var(--tracking-3xl)" }],
      },

      borderRadius: {
        xs: "var(--r-xs)",
        sm: "var(--r-sm)",
        md: "var(--r-md)",
        lg: "var(--r-lg)",
        xl: "var(--r-xl)",
        "2xl": "var(--r-2xl)",
        full: "var(--r-full)",
      },

      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },

      transitionDuration: {
        instant: "var(--dur-instant)",
        fast: "var(--dur-fast)",
        base: "var(--dur-base)",
        slow: "var(--dur-slow)",
        canvas: "var(--dur-canvas)",
      },

      transitionTimingFunction: {
        out: "var(--ease-out)",
        standard: "var(--ease-standard)",
        "in-out": "var(--ease-in-out)",
        node: "var(--spring-node)",
      },

      zIndex: {
        canvas: "0",
        panel: "10",
        composer: "20",
        popover: "30",
        toast: "40",
        modal: "50",
      },

      keyframes: {
        "node-enter": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "ribbon-line": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "dot-wave": {
          "0%, 70%, 100%": { opacity: "0.18", transform: "scale(0.8)" },
          "35%": { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        "node-enter": "node-enter var(--dur-base) var(--spring-node) both",
        "ribbon-line": "ribbon-line var(--dur-fast) var(--ease-out) both",
        "dot-wave": "dot-wave 1400ms var(--ease-in-out) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
