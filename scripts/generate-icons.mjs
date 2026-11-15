#!/usr/bin/env node
// Regenerate committed desktop assets from build/mark.svg: npm run build:icons.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.join(root, "build");
const mark = readFileSync(path.join(build, "mark.svg"), "utf8")
  .replace(/<svg\b[^>]*>/, "")
  .replace("</svg>", "")
  .trim();
const svg = (body, viewBox = "0 0 1024 1024") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="${viewBox}">\n${body}\n</svg>\n`;
const source = svg(
  `<rect x="64" y="64" width="896" height="896" rx="208" fill="#242824"/>\n<g fill="#F4F1E8">${mark}</g>`,
);
writeFileSync(path.join(build, "icon.svg"), source);
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024];
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
const pngs = new Map(sizes.map((size) => [size, render(source, size)]));
mkdirSync(path.join(build, "icons"), { recursive: true });
for (const [size, png] of pngs) writeFileSync(path.join(build, "icons", `${size}x${size}.png`), png);
writeFileSync(path.join(build, "icon.png"), pngs.get(1024));

// ICO directory entries point to lossless PNG frames, supported by modern Windows.
const windowsSizes = sizes.filter((size) => size <= 256);
const icoHeader = Buffer.alloc(6 + windowsSizes.length * 16);
icoHeader.writeUInt16LE(1, 2);
icoHeader.writeUInt16LE(windowsSizes.length, 4);
let offset = icoHeader.length;
windowsSizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  icoHeader[entry] = size === 256 ? 0 : size;
  icoHeader[entry + 1] = size === 256 ? 0 : size;
  icoHeader.writeUInt16LE(1, entry + 4);
  icoHeader.writeUInt16LE(32, entry + 6);
  icoHeader.writeUInt32LE(pngs.get(size).length, entry + 8);
  icoHeader.writeUInt32LE(offset, entry + 12);
  offset += pngs.get(size).length;
});
writeFileSync(path.join(build, "icon.ico"), Buffer.concat([icoHeader, ...windowsSizes.map((size) => pngs.get(size))]));

// ICNS includes both standard and Retina representations.
const macFrames = {
  icp4: 16,
  icp5: 32,
  icp6: 64,
  ic07: 128,
  ic08: 256,
  ic09: 512,
  ic10: 1024,
  ic11: 32,
  ic12: 64,
  ic13: 256,
  ic14: 512,
};
const chunks = Object.entries(macFrames).map(([type, size]) => {
  const png = pngs.get(size);
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, "ascii");
  header.writeUInt32BE(png.length + 8, 4);
  return Buffer.concat([header, png]);
});
const icnsHeader = Buffer.alloc(8);
icnsHeader.write("icns");
icnsHeader.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
writeFileSync(path.join(build, "icon.icns"), Buffer.concat([icnsHeader, ...chunks]));

// macOS templates contain only the silhouette; the OS supplies the menu-bar color.
const template = svg(`<g fill="#000000">${mark}</g>`, "160 160 704 704");
writeFileSync(path.join(build, "trayTemplate.png"), render(template, 18));
writeFileSync(path.join(build, "trayTemplate@2x.png"), render(template, 36));
console.log(`Generated desktop icons (${sizes.join(", ")} px), ICO, ICNS, and macOS tray templates.`);
