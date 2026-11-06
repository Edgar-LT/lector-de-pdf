/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./frontend/index.html",
    "./frontend/privacy.html",
    "./frontend/app.js",
    "./frontend/storage.js",
    "./frontend/pdf-client-parser.js",
    "./frontend/ads.js",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "bg-base": "#0a0a0c",
        "surface": "#141417",
        "surface-elevated": "#1d1d1f",
        "surface-hover": "#262629",
        "accent": "#2997ff",
        "accent-hover": "#147ce5",
        "accent-light": "#64b5ff",
        "champagne": "#c5a059",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};
