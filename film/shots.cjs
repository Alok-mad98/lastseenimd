// Screenshots of the live LastSeenIMD app for the README, taken with the headless Chrome HyperFrames installed.
const puppeteer = require("puppeteer-core");
const os = require("os"), path = require("path");
const OUT = path.join(__dirname, "..", "..", "shots");
const CHROME = path.join(os.homedir(), ".cache/puppeteer/chrome-headless-shell/win64-148.0.7778.97/chrome-headless-shell-win64/chrome-headless-shell.exe");
const WALLET = "0xc6525dbbc9ac18fbf9ec93c219670b0dbb6cf2d3";
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  require("fs").mkdirSync(OUT, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const shot = async name => { await page.screenshot({ path: path.join(OUT, name + ".png") }); console.log("saved", name); };
  await page.goto("https://lastseen-4pu.pages.dev/?figure", { waitUntil: "networkidle2", timeout: 60000 });
  await wait(5000); await shot("title");
  await page.goto("https://lastseen-4pu.pages.dev/?a=" + WALLET, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#case:not([hidden])", { timeout: 120000 });
  await wait(15000); await shot("case");
  for (const [t, ms] of [["incident", 3000], ["money", 4000], ["habits", 3000], ["trail", 15000]]) {
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click(`#tabs button[data-t=${t}]`);
      await wait(ms); await shot(t);
      if (t === "trail") { await page.evaluate(() => window.scrollTo(0, 650)); await wait(2500); await shot("trail-graph"); }
    } catch (e) { console.log("failed", t, e.message); }
  }
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector("#tabs button[data-t=overview]").click(); });
  await wait(2000); await page.evaluate(() => window.scrollTo(0, 560)); await wait(2500); await shot("overview-charts");
  await page.goto("https://lastseen-4pu.pages.dev/?a=0xd8da6bf26964af9d7eed9e03e53415d37aa96045", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("#case:not([hidden])", { timeout: 120000 });
  await wait(8000);
  await page.click("#tabs button[data-t=online]"); await wait(15000); await shot("online");
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
