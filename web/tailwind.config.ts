import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#18273D",
        paper: "#FFF8EB",
        paperDeep: "#EEE8F8",
        line: "#CFC8D5",
        accent: "#087F78",
        tealDark: "#123B55",
        violet: "#6758C9",
        violetPale: "#E9E5FB",
        coral: "#E96555",
        coralDeep: "#C84B40",
        coralPale: "#FDE0D8",
        sky: "#D9EEF2",
        gold: "#EDAE35",
        goldPale: "#FFEDB8",
        urgent: "#C84B40",
        warn: "#9A6808",
        ok: "#087F78",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Iowan Old Style", "Baskerville", "Georgia", "serif"],
      },
      boxShadow: {
        card: "0 22px 55px rgba(24, 39, 61, 0.13)",
      },
    },
  },
  plugins: [],
};
export default config;
