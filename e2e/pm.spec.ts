import { test, expect } from "@playwright/test";

const baseURL = process.env.FRIDAY_E2E_BASE_URL || "http://127.0.0.1:3334";
const cookieName = process.env.FRIDAY_E2E_COOKIE_NAME || "friday_session";
const cookieValue = process.env.FRIDAY_E2E_COOKIE_VALUE || "";
const bypassToken = process.env.FRIDAY_E2E_BYPASS_TOKEN || "";

test.describe("pm ui", () => {
  test.skip(!cookieValue && !bypassToken, "Set FRIDAY_E2E_COOKIE_VALUE or FRIDAY_E2E_BYPASS_TOKEN.");

  async function authedPage(page: any) {
    const url = new URL(baseURL);
    if (cookieValue) {
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
      return;
    }
    if (bypassToken) {
      await page.setExtraHTTPHeaders({ "x-friday-test-bypass": bypassToken });
    }
  }

  test("new PM does not throw console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));
    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(msg.text());
    });

    await authedPage(page);
    await page.goto(baseURL);

    await page.locator(".topbarRight").getByRole("button", { name: "PM" }).click();
    await expect(page.getByText("PM Chats")).toBeVisible();

    await page.getByRole("button", { name: "New PM" }).click();
    const header = page.locator(".pmHeader");
    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(header.locator(".pmHeaderActions").getByRole("button", { name: "Assign Trello" })).toBeVisible();

    expect(errors.join("\n")).not.toMatch(/error/i);
  });

  test("pm layout stacks full width panels", async ({ page }) => {
    await authedPage(page);
    await page.goto(baseURL);

    await page.locator(".topbarRight").getByRole("button", { name: "PM" }).click();
    await expect(page.getByText("PM Chats")).toBeVisible();

    await page.getByRole("button", { name: "New PM" }).click();

    const pmMain = page.locator(".pmMain");
    const header = page.locator(".pmHeader");
    const messages = page.locator(".pmMessages");
    const composer = page.locator(".pmMain .composer");

    await expect(header).toBeVisible({ timeout: 10_000 });
    await expect(messages).toBeVisible();
    await expect(composer).toBeVisible();

    const [mainBox, headerBox, messagesBox, composerBox] = await Promise.all([
      pmMain.boundingBox(),
      header.boundingBox(),
      messages.boundingBox(),
      composer.boundingBox(),
    ]);

    expect(mainBox).toBeTruthy();
    expect(headerBox).toBeTruthy();
    expect(messagesBox).toBeTruthy();
    expect(composerBox).toBeTruthy();

    if (!mainBox || !headerBox || !messagesBox || !composerBox) return;

    const tol = 3;
    const expectClose = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);

    expectClose(headerBox.x, messagesBox.x);
    expectClose(headerBox.x, composerBox.x);
    expectClose(headerBox.width, mainBox.width);
    expectClose(messagesBox.width, mainBox.width);
    expectClose(composerBox.width, mainBox.width);

    expect(headerBox.y).toBeLessThan(messagesBox.y);
    expect(messagesBox.y).toBeLessThan(composerBox.y);
  });

  test("pm project resolve by title", async ({ page }) => {
    await authedPage(page);
    await page.goto(baseURL);

    await page.locator(".topbarRight").getByRole("button", { name: "PM" }).click();
    await expect(page.getByText("PM Chats")).toBeVisible();

    await page.getByRole("button", { name: "New PM" }).click();
    const header = page.locator(".pmHeader");
    await expect(header).toBeVisible({ timeout: 10_000 });

    const projectTitle = await header.locator(".pmHeaderTitle").innerText();
    const headers = bypassToken ? { "x-friday-test-bypass": bypassToken } : undefined;
    const res = await page.request.get(`${baseURL}/api/pm/projects/resolve?title=${encodeURIComponent(projectTitle)}`, { headers });
    expect(res.ok()).toBeTruthy();
    const json = await res.json();
    expect(json.ok).toBeTruthy();
    expect(Array.isArray(json.candidates)).toBeTruthy();
    if (json.project) {
      expect(json.project.title).toBe(projectTitle);
    } else {
      const titles = (json.candidates || []).map((c: any) => c.title);
      expect(titles).toContain(projectTitle);
    }
  });

});
