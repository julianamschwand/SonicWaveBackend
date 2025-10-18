import puppeteer from "puppeteer"

export default async function refreshNewgrounds() {
  try {
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto("https://www.newgrounds.com", { waitUntil: "networkidle2" })
    await page.waitForFunction(
      (keyword) => !document.documentElement.innerHTML.includes(keyword),
      { timeout: 120000 },
      "NG Guard"
    )
    
    console.log("Successfully refreshed newgrounds")
    await browser.close()
  } catch (error) {
    console.error("Error while refreshing newgrounds", error)
  }
}