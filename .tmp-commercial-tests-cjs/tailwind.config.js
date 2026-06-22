"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config = {
    content: [
        "./app/**/*.{ts,tsx}",
        "./components/**/*.{ts,tsx}",
        "./lib/**/*.{ts,tsx}"
    ],
    theme: {
        extend: {
            colors: {
                background: "#f9f9ff",
                "hub-canvas": "#f3f4f6",
                "surface": "#f9f9ff",
                "surface-container-lowest": "#ffffff",
                "surface-container-low": "#f0f3ff",
                "surface-container": "#e7eefe",
                "surface-container-high": "#e2e8f8",
                "surface-container-highest": "#dce2f3",
                "on-surface": "#151c27",
                "on-surface-variant": "#5c3f41",
                "inverse-surface": "#2a313d",
                "inverse-on-surface": "#ebf1ff",
                "outline": "#906f70",
                "outline-variant": "#e5bdbe",
                "surface-tint": "#be003a",
                "primary": "#bd0039",
                "primary-container": "#e61e4d",
                "on-primary": "#ffffff",
                "primary-fixed": "#ffdadb",
                "primary-fixed-dim": "#ffb2b7",
                "secondary": "#555f6f",
                "secondary-container": "#d6e0f3",
                "tertiary": "#5c5e60",
                "tertiary-container": "#757779",
                "error": "#ba1a1a",
                "error-container": "#ffdad6",
                "sidebar": "#1f2937",
                "sidebar-soft": "#2a313d"
            },
            fontFamily: {
                sans: ["var(--font-hanken)", "Hanken Grotesk", "system-ui", "sans-serif"]
            },
            fontSize: {
                "headline-xl": ["30px", { lineHeight: "36px", fontWeight: "700", letterSpacing: "0" }],
                "headline-lg": ["24px", { lineHeight: "32px", fontWeight: "700", letterSpacing: "0" }],
                "headline-md": ["18px", { lineHeight: "24px", fontWeight: "600", letterSpacing: "0" }],
                "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400", letterSpacing: "0" }],
                "body-md": ["14px", { lineHeight: "20px", fontWeight: "400", letterSpacing: "0" }],
                "label-bold": ["12px", { lineHeight: "16px", fontWeight: "700", letterSpacing: "0.05em" }],
                "label-sm": ["12px", { lineHeight: "16px", fontWeight: "500", letterSpacing: "0" }],
                "stats-lg": ["36px", { lineHeight: "40px", fontWeight: "800", letterSpacing: "0" }]
            },
            borderRadius: {
                sm: "0.25rem",
                DEFAULT: "0.5rem",
                md: "0.75rem",
                lg: "1rem",
                xl: "1.5rem"
            },
            spacing: {
                "sidebar-width": "260px",
                "container-padding": "2rem",
                "gutter-md": "1.5rem",
                "card-gap": "1rem",
                "stack-sm": "0.5rem",
                "stack-md": "1rem"
            },
            boxShadow: {
                card: "0 2px 4px rgba(0, 0, 0, 0.05)",
                float: "0 10px 15px rgba(0, 0, 0, 0.10)"
            }
        }
    },
    plugins: []
};
exports.default = config;
