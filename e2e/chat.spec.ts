import { test, expect } from "@playwright/test";

const baseURL = process.env.FRIDAY_E2E_BASE_URL || "http://127.0.0.1:3334";
const cookieName = process.env.FRIDAY_E2E_COOKIE_NAME || "friday_session";
const cookieValue = process.env.FRIDAY_E2E_COOKIE_VALUE || "";
test.describe("chat ui", () => {
  test.skip(!cookieValue, "Set FRIDAY_E2E_COOKIE_VALUE to a valid session cookie.");

  function authHeaders() {
    return { Cookie: `${cookieName}=${cookieValue}` };
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
    const title = `e2e chat ${Date.now()}`;
    const chatRes = await request.post("/api/chats", { data: { title }, headers: authHeaders() });
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
    const title = `e2e scroll ${Date.now()}`;
    const chatRes = await request.post("/api/chats", { data: { title }, headers: authHeaders() });
    const chatJson = await chatRes.json();
    const chatId = chatJson?.chat?.id as string;
    expect(chatId).toBeTruthy();

    await authedPage(page);
    await page.goto(baseURL);
    await page.getByText(title, { exact: true }).first().click();

    const messages = page.locator("section.messages");
    await expect(messages).toBeVisible();
    await page.waitForTimeout(300);

    const distance = await page.evaluate(() => {
      const el = document.querySelector("section.messages") as HTMLElement | null;
      if (!el) return null;
      for (let i = 0; i < 12; i += 1) {
        const bubble = document.createElement("div");
        bubble.className = `msg ${i % 2 === 0 ? "assistant" : "user"}`;
        bubble.innerHTML = `<div class=\"msgRoleRow\"><div class=\"msgRole\">${i % 2 === 0 ? "assistant" : "user"}</div></div><div class=\"msgContent\"><div class=\"md\">Seed message ${i + 1}</div></div>`;
        el.appendChild(bubble);
      }
      return el.scrollHeight - el.scrollTop - el.clientHeight;
    });

    expect(distance).not.toBeNull();
    if (typeof distance === "number") {
      expect(distance).toBeLessThanOrEqual(4);
    }

    const overlap = await page.evaluate(() => {
      const messages = document.querySelector("section.messages") as HTMLElement | null;
      const lastMsg = document.querySelector("section.messages .msg:last-child") as HTMLElement | null;
      const composer = document.querySelector("form.composer") as HTMLElement | null;
      if (!messages || !lastMsg || !composer) return null;
      messages.scrollTop = messages.scrollHeight;
      const msgBox = lastMsg.getBoundingClientRect();
      const composerBox = composer.getBoundingClientRect();
      return {
        overlap: msgBox.bottom - composerBox.top,
        messagesBottom: messages.getBoundingClientRect().bottom,
        composerTop: composerBox.top,
      };
    });

    expect(overlap).not.toBeNull();
    if (overlap && typeof overlap === "object") {
      expect(overlap.overlap).toBeLessThanOrEqual(1);
      expect(overlap.messagesBottom).toBeLessThanOrEqual(overlap.composerTop + 1);
    }
  });
});
