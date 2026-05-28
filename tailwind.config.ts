import type { Config } from "tailwindcss";
import typography from "@tailwindcss/typography";

export default {
  content: ["./src/**/*.{html,js,svelte,ts}", "!./src/paraglide/messages/**"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
        },
        /* MiWarp custom semantic colors */
        "miwarp-bg": {
          deepest: "hsl(var(--miwarp-bg-deepest))",
          deep: "hsl(var(--miwarp-bg-deep))",
          base: "hsl(var(--miwarp-bg-base))",
          elevated: "hsl(var(--miwarp-bg-elevated))",
          surface: "hsl(var(--miwarp-bg-surface))",
          hover: "hsl(var(--miwarp-bg-hover))",
        },
        "miwarp-text": {
          primary: "hsl(var(--miwarp-text-primary))",
          secondary: "hsl(var(--miwarp-text-secondary))",
          tertiary: "hsl(var(--miwarp-text-tertiary))",
        },
        "miwarp-accent": {
          primary: "hsl(var(--miwarp-accent-primary))",
          violet: "hsl(var(--miwarp-accent-violet))",
          blue: "hsl(var(--miwarp-accent-blue))",
          yellow: "hsl(var(--miwarp-accent-yellow))",
          pink: "hsl(var(--miwarp-accent-pink))",
          teal: "hsl(var(--miwarp-accent-teal))",
          "on-accent": "hsl(var(--miwarp-accent-on-accent))",
        },
        "miwarp-status": {
          success: "hsl(var(--miwarp-status-success))",
          warning: "hsl(var(--miwarp-status-warning))",
          error: "hsl(var(--miwarp-status-error))",
          info: "hsl(var(--miwarp-status-info))",
          running: "hsl(var(--miwarp-status-running))",
          done: "hsl(var(--miwarp-status-done))",
          failed: "hsl(var(--miwarp-status-failed))",
          pending: "hsl(var(--miwarp-status-pending))",
          paused: "hsl(var(--miwarp-status-paused))",
          blocked: "hsl(var(--miwarp-status-blocked))",
          idle: "hsl(var(--miwarp-status-idle))",
        },
        "miwarp-text-status": {
          success: "hsl(var(--miwarp-status-success))",
          warning: "hsl(var(--miwarp-status-warning))",
          error: "hsl(var(--miwarp-status-error))",
          info: "hsl(var(--miwarp-status-info))",
          running: "hsl(var(--miwarp-status-running))",
          done: "hsl(var(--miwarp-status-done))",
          failed: "hsl(var(--miwarp-status-failed))",
          pending: "hsl(var(--miwarp-status-pending))",
          paused: "hsl(var(--miwarp-status-paused))",
          blocked: "hsl(var(--miwarp-status-blocked))",
          idle: "hsl(var(--miwarp-status-idle))",
        },
        "miwarp-overlay": "hsl(var(--miwarp-overlay))",
      },
      borderRadius: {
        sm: "calc(var(--radius) - 4px)",
        md: "calc(var(--radius) - 2px)",
        lg: "var(--radius)",
        xl: "calc(var(--radius) + 4px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "PingFang SC",
          "Microsoft YaHei",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "SF Mono",
          "Fira Code",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      backdropBlur: {
        glass: "16px",
        "glass-heavy": "24px",
      },
      boxShadow: {
        "warp-1":
          "0 1px 3px hsla(0,0%,0%,0.3), 0 1px 2px hsla(0,0%,0%,0.2)",
        "warp-2":
          "0 4px 12px hsla(0,0%,0%,0.35), 0 2px 4px hsla(0,0%,0%,0.2)",
        "warp-3":
          "0 8px 24px hsla(0,0%,0%,0.4), 0 4px 8px hsla(0,0%,0%,0.25)",
        "warp-glow":
          "0 0 16px hsla(239, 84%, 67%, 0.2)",
        "warp-glow-strong":
          "0 0 24px hsla(239, 84%, 67%, 0.35), 0 0 48px hsla(258, 90%, 66%, 0.15)",
        "warp-inset":
          "inset 0 1px 2px hsla(0,0%,0%,0.2)",
      },
      animation: {
        "fade-in": "fadeIn 200ms ease-out both",
        "slide-in": "slideIn 200ms ease-out both",
        "slide-up": "slideUp 300ms ease-out both",
        "scale-in": "scaleIn 200ms ease-out both",
        "pulse-glow": "pulseGlow 2s ease-in-out infinite",
        shimmer: "shimmer 2s ease-in-out infinite",
        "toast-in": "toastIn 300ms ease-out both",
        "toast-out": "toastOut 250ms ease-in both",
        spin: "spin 1s linear infinite",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          from: { opacity: "0", transform: "translateX(-12px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        slideUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        pulseGlow: {
          "0%, 100%": { opacity: "0.4" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "100% 0" },
          "100%": { backgroundPosition: "-100% 0" },
        },
        toastIn: {
          from: { opacity: "0", transform: "translateY(-100%)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        toastOut: {
          from: { opacity: "1", transform: "translateY(0)" },
          to: { opacity: "0", transform: "translateY(-100%)" },
        },
      },
      transitionDuration: {
        fast: "150ms",
        normal: "200ms",
        slow: "300ms",
      },
    },
  },
  plugins: [typography],
} satisfies Config;
