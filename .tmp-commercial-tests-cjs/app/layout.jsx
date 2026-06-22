"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metadata = void 0;
exports.default = RootLayout;
const google_1 = require("next/font/google");
require("./globals.css");
const hanken = (0, google_1.Hanken_Grotesk)({
    subsets: ["latin"],
    variable: "--font-hanken",
    display: "swap"
});
exports.metadata = {
    title: "PesasChile HUB",
    description: "AI Operations dashboard independiente para casos WhatsApp PesasChile"
};
function RootLayout({ children }) {
    return (<html lang="es" className={hanken.variable}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com"/>
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin=""/>
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
      </head>
      <body>{children}</body>
    </html>);
}
