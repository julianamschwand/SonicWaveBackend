import puppeteer from "puppeteer"

export default async function refreshNewgrounds() {
  try {
    const browser = await puppeteer.launch({ headless: true })
    const page = await browser.newPage()
    await page.goto("https://www.newgrounds.com", { waitUntil: "networkidle2" })
    setTimeout(() => browser.close(), 2000)
    console.log("Successfully refreshed newgrounds")
  } catch (error) {
    console.error("Error while refreshing newgrounds", error)
  }
}