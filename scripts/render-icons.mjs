// Renders the app icon (Lore LLM Brand · 1c "Dark tile, gradient caret") from
// the design's own CSS with headless Chrome, so it matches the mock exactly.
//   node scripts/render-icons.mjs
// Outputs:
//   build/icon-mac.png     1024, macOS grid: 824 tile centered, with shadow (electron-builder → .icns)
//   build/icon.png         1024, full-bleed rounded tile (Windows .ico / Linux)
//   electron/icon.png      512, window/dock icon at runtime
//   src/assets/lore-icon.png  256, brand mark in the UI
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The 1c tile on its 200px design grid (Lore LLM Brand.dc.html, #1c).
const TILE = `
<div class="tile">
  <div style="left:44px;top:62px;width:58px;height:12px;border-radius:6px;background:rgba(250,249,245,.9)"></div>
  <div style="left:44px;top:94px;width:84px;height:12px;border-radius:6px;background:rgba(250,249,245,.45)"></div>
  <div style="left:44px;top:126px;width:40px;height:12px;border-radius:6px;background:rgba(250,249,245,.45)"></div>
  <div style="left:96px;top:118px;width:14px;height:40px;border-radius:7px;background:linear-gradient(180deg,#8f5cff,#3a86ff)"></div>
</div>`;

const css = (shadow) => `
  html,body{margin:0;background:transparent}
  .stage{display:flex;align-items:center;justify-content:center}
  .tile{width:200px;height:200px;border-radius:45px;position:relative;overflow:hidden;
    background:radial-gradient(90% 90% at 85% 10%,rgba(143,92,255,.35),transparent 60%),#1a1920;
    box-shadow:inset 0 0 0 1.5px rgba(250,249,245,.1)${shadow ? ',' + shadow : ''}}
  .tile>div{position:absolute}`;

const OUT = [
  // macOS: Apple's 1024 grid puts an 824 body in the middle, lit from above with a soft drop shadow.
  { file: 'build/icon-mac.png', size: 1024, body: 824, shadow: '0 2px 2.5px rgba(0,0,0,.3)' },
  { file: 'build/icon.png', size: 1024, body: 1024 },
  { file: 'electron/icon.png', size: 512, body: 512 },
  { file: 'src/assets/lore-icon.png', size: 256, body: 256 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const o of OUT) {
    // Lay out the 200px design grid zoomed to the target size: vectors stay crisp.
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    await page.setContent(
      `<style>${css(o.shadow)} .stage{width:${o.size}px;height:${o.size}px} .tile{zoom:${o.body / 200}}</style><div class="stage">${TILE}</div>`,
    );
    mkdirSync(path.dirname(path.join(root, o.file)), { recursive: true });
    await page.screenshot({ path: path.join(root, o.file), omitBackground: true });
    await page.close();
    console.log(`${o.file}  ${o.size}×${o.size}`);
  }
} finally {
  await browser.close();
}
