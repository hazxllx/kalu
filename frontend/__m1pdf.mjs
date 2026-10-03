import { chromium } from "playwright";
import fs from "node:fs";

const url = "file:///" + process.argv[2].replace(/\\/g, "/");
const pdfOut = process.argv[3];
const pngOut = process.argv[4];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1123, height: 794 } });
await page.emulateMedia({ media: "print" });
await page.goto(url, { waitUntil: "load" });

await page.pdf({ path: pdfOut, format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true });

const info = await page.evaluate(() => {
  const bodyW = document.body.getBoundingClientRect().width;
  const tables = [...document.querySelectorAll(".m1-block, .m1-split, .m1-info")];
  const overflow = tables.some((t) => t.getBoundingClientRect().right > bodyW + 1);
  const splits = document.querySelectorAll(".m1-split").length;
  const blocks = document.querySelectorAll(".m1-block").length;
  const ageHeads = document.querySelectorAll(".m1-band th").length;
  const sexHeads = [...document.querySelectorAll(".m1-band th")].filter((t) => t.textContent.trim() === "Sex").length;
  const sections = document.querySelectorAll(".m1-section-head").length;
  const rows = document.querySelectorAll(".m1-row").length;
  return { bodyW, overflow, splits, blocks, ageBanHeads: ageHeads, sexBanHeads: sexHeads, sections, rows };
});

const height = await page.evaluate(() => document.documentElement.scrollHeight);
await page.screenshot({ path: pngOut, fullPage: true });
await browser.close();

const pages = (fs.readFileSync(pdfOut).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
console.log(JSON.stringify({ ...info, contentHeightPx: height, landscapePagePx: "1123x794", pdfPages: pages }, null, 2));
console.log("CHECK", info.overflow === false && info.sections === 8 && info.rows > 150 && info.splits >= 1 ? "PASS" : "FAIL");
