/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                dark: {
                    900: '#0a0a0a',
                    800: '#1a1a1a',
                    700: '#2a2a2a',
                },
                jan: {
                    50: '#f2fcf5',
                    100: '#e1f8e8',
                    200: '#c3eed2',
                    300: '#94deaf',
                    400: '#5bc485',
                    500: '#288231', // Base provided by user
                    600: '#1e6826',
                    700: '#195221',
                    800: '#16421d',
                    900: '#12361a',
                    950: '#061d0b',
                }
            }
        },
    },
    plugins: [],
}