/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./frontend/index.html",
    "./frontend/privacy.html",
    "./frontend/app.js",
    "./frontend/ads.js",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        "bg-base": "#0b0d12",
        "surface": "#11141c",
        "surface-elevated": "#171b26",
        "surface-hover": "#1e2330",
        "accent": "#6366f1",
        "accent-hover": "#4f46e5",
        "accent-light": "#818cf8",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["Plus Jakarta Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};
