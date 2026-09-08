import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171F",
        paper: "#F7F6F3",
        line: "#E4E1D9",
        accent: "#8C1D40", // crimson-adjacent, swap per household/brand later
        urgent: "#B3261E",
        warn: "#8A5A00",
        ok: "#1E6B4E",
      },
    },
  },
  plugins: [],
};
export default config;
