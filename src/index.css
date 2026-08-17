@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Sora:wght@300;400;600;700&family=DM+Mono:wght@400;500&display=swap');
@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-id-dark: #44723E;
  --color-id-mid: #6B9A52;
  --color-id-light: #8FB352;
  --color-id-gray: #454F48;

  --font-sans: "DM Sans", system-ui, sans-serif;
  --font-display: "Sora", system-ui, sans-serif;
  --font-mono: "DM Mono", monospace;

  --shadow-card: 0 1px 4px rgba(0,0,0,.06), 0 4px 16px rgba(0,0,0,.04);
}

/* Tokens de tema — claro por padrão, escuro quando <html> tem a classe .dark */
:root {
  --bg: #f4f5f7;
  --sur: #ffffff;
  --sur2: #eef0f3;
  --bdr: #e2e5eb;
  --tx: #14171c;
  --tx2: #45505c;
  --tx3: #707a87;
  --tx4: #a3abb5;
}
.dark {
  --bg: #0f1115;
  --sur: #171a21;
  --sur2: #1e222b;
  --bdr: #2a2e38;
  --tx: #f1f5f9;
  --tx2: #cbd5e1;
  --tx3: #8b95a3;
  --tx4: #5b6472;
  --shadow-card: 0 1px 4px rgba(0,0,0,.25), 0 4px 16px rgba(0,0,0,.18);
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  background: var(--bg);
  color: var(--tx);
  font-family: var(--font-sans);
  font-size: 13px;
  transition: background-color .15s ease, color .15s ease;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bdr); border-radius: 8px; }
::-webkit-scrollbar-thumb:hover { background: var(--tx4); }

:focus-visible {
  outline: 2px solid #8FB352;
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.001ms !important;
    transition-duration: 0.001ms !important;
  }
}
