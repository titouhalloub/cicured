/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Tailwind CSS v4 is configured CSS-first (app/globals.css); no JS config file.
    "@tailwindcss/postcss": {},
  },
};

export default config;
