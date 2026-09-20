import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1F2928",
        paper: "#F6F3EC",
        line: "#DDD7C9",
        accent: "#1F6F6B",
        tealDark: "#134E4A",
        gold: "#C89B3C",
        urgent: "#A83B32",
        warn: "#8A5A00",
        ok: "#31705C",
      },
      fontFamily: {
        sans: ["var(--font-ibm-plex-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-fraunces)", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 12px 32px rgba(31, 41, 40, 0.07)",
      },
    },
  },
  plugins: [],
};
export default config;
