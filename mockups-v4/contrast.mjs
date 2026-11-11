// Prints WCAG contrast for every ink in both themes, from the tokens in src/base.css.
// Usage: node contrast.mjs
const themes = {
  light: { bg: '#ffffff', hover: '#f2f5f9', panel: '#ffffff', ink: '#20242a', ink2: '#59616b' },
  dark: { bg: '#15181d', hover: '#1f242b', panel: '#1b1f25', ink: '#e6e9ee', ink2: '#a3abb6' },
};
const inks = {
  ai: { light: ['#245dcc', '#17489e'], dark: ['#8db1ff', '#b9cfff'] },
  sakura: { light: ['#b5306b', '#8e2252'], dark: ['#f391ba', '#f9c2d9'] },
  matcha: { light: ['#2f7a3b', '#225c2b'], dark: ['#86cc90', '#b5e3bb'] },
  fuji: { light: ['#6a4cc2', '#523799'], dark: ['#b8a5ff', '#d5cbff'] },
  sora: { light: ['#0c6c8a', '#08546b'], dark: ['#72c8e3', '#a8dff0'] },
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x + 0.05) / (y + 0.05)).toFixed(2);
};
console.log('| ink | theme | accent | accent/bg | accent/hover | accent/panel | focus/bg | focus/hover |');
console.log('|---|---|---|---|---|---|---|---|');
for (const [name, v] of Object.entries(inks)) {
  for (const t of ['light', 'dark']) {
    const [a, f] = v[t];
    const th = themes[t];
    console.log(`| ${name} | ${t} | ${a} | ${ratio(a, th.bg)} | ${ratio(a, th.hover)} | ${ratio(a, th.panel)} | ${ratio(f, th.bg)} | ${ratio(f, th.hover)} |`);
  }
}
for (const t of ['light', 'dark']) {
  const th = themes[t];
  console.log(`\n${t}: ink/bg ${ratio(th.ink, th.bg)}, ink-2/bg ${ratio(th.ink2, th.bg)}, ink-2/hover ${ratio(th.ink2, th.hover)}, ink/panel ${ratio(th.ink, th.panel)}, ink-2/panel ${ratio(th.ink2, th.panel)}`);
}
