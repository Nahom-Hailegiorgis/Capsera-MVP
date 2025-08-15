/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#7776BC",
        secondary: "#CDC7E5",
        accent1: "#FFFBDB",
        accent2: "#FFEC51",
        accent3: "#FF674D",
      },
    },
  },
  plugins: [],
};
