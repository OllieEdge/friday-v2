import { test, expect } from "@playwright/test";

const baseURL = process.env.FRIDAY_E2E_BASE_URL || "http://127.0.0.1:3334";
const cookieName = process.env.FRIDAY_E2E_COOKIE_NAME || "friday_session";
const cookieValue = process.env.FRIDAY_E2E_COOKIE_VALUE || "";
const seedMessages = process.env.FRIDAY_E2E_SEED_MESSAGES === "1";

test.describe("chat ui", () => {
  test.skip(!cookieValue, "Set FRIDAY_E2E_COOKIE_VALUE to a valid session cookie.");

  async function authedApi(request: any) {
    return request.newContext({
      baseURL,
      extraHTTPHeaders: { Cookie: `${cookieName}=${cookieValue}` },
    });
  }

  async function authedPage(page: any) {
    const url = new URL(baseURL);
    await page.context().addCookies([
      {
        name: cookieName,
        value: cookieValue,
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
      },
    ]);
  }

  test("composer stays visible on desktop", async ({ page, request }) => {
    const api = await authedApi(request);
    const title = `e2e chat ${Date.now()}`;
    const chatRes = await api.post("/api/chats", { data: { title } });
    const chatJson = await chatRes.json();
    const chatId = chatJson?.chat?.id as string;
    expect(chatId).toBeTruthy();

    await authedPage(page);
    await page.goto(baseURL);
    await page.getByText(title, { exact: true }).first().click();

    const composer = page.locator("form.composer");
    await expect(composer).toBeVisible();

    const box = await composer.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
    }
  });

  test("chat loads scrolled to bottom", async ({ page, request }) => {
    test.skip(!seedMessages, "Set FRIDAY_E2E_SEED_MESSAGES=1 to seed messages for scroll test.");

    const api = await authedApi(request);
    const title = `e2e scroll ${Date.now()}`;
    const chatRes = await api.post("/api/chats", { data: { title } });
    const chatJson = await chatRes.json();
    const chatId = chatJson?.chat?.id as string;
    expect(chatId).toBeTruthy();

    for (let i = 0; i < 8; i += 1) {
      await api.post(`/api/chats/${chatId}/messages`, { data: { content: `Seed message ${i + 1}` } });
    }

    await authedPage(page);
    await page.goto(baseURL);
    await page.getByText(title, { exact: true }).first().click();

    const messages = page.locator("section.messages");
    await expect(messages).toBeVisible();
    await page.waitForTimeout(300);

    const distance = await page.evaluate(() => {
      const el = document.querySelector("section.messages") as HTMLElement | null;
      if (!el) return null;
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });

    expect(distance).not.toBeNull();
    if (typeof distance === "number") {
      expect(distance).toBeLessThanOrEqual(4);
    }
  });
});
