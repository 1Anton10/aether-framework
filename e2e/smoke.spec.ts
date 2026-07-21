import { test, expect } from "@playwright/test";

test.describe("Aether framework site", () => {
  test("home shows compare bench", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Aether");
    await expect(page.locator("#compare")).toBeVisible();
    await page.click("#bench-run");
    await expect(page.locator("#bench-verdict")).not.toHaveText(
      "Нажмите «Измерить» — цифры с вашего CPU/браузера.",
      { timeout: 30_000 }
    );
    await expect(page.locator("#bench-verdict")).toContainText("Реально");
  });

  test("demo SSR + cart patch", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
    await expect(page.locator("#root")).toHaveAttribute("data-aether-ssr", "1");
    const cart = page.locator("#viz-cart-n");
    await expect(cart).toBeVisible({ timeout: 15_000 });
    const before = await cart.textContent();
    await page.getByRole("button", { name: "+" }).first().click();
    await expect(cart).not.toHaveText(before || "", { timeout: 10_000 });
  });

  test("demo sync hits /api/delta", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#btn-sync")).toBeVisible({ timeout: 15_000 });
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/delta") && r.request().method() === "POST"),
      page.locator("#btn-sync").click(),
    ]);
    expect(res.ok()).toBeTruthy();
    const buf = await res.body();
    expect(buf.byteLength).toBeGreaterThan(0);
    await expect(page.locator("#viz-dsm-log")).toContainText("/api/delta", {
      timeout: 10_000,
    });
  });

  test("demo ping writes RTT", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#btn-ping")).toBeVisible({ timeout: 15_000 });
    await page.locator("#btn-ping").click();
    await expect(page.locator("#viz-ping-n")).not.toHaveText("0", { timeout: 15_000 });
  });

  test("demo list Loop sync after SSR hydrate", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#viz-list")).toBeVisible({ timeout: 15_000 });
    const list = page.locator("#viz-list");
    const before = await list.locator(".viz-list-item").count();
    expect(before).toBeGreaterThan(0);
    await expect(list.locator(".viz-list-item").first()).toContainText("1");
    await page.getByRole("button", { name: "+ row" }).click();
    await expect.poll(async () => list.locator(".viz-list-item").count()).toBe(before + 1);
    await page.getByRole("button", { name: "− row" }).click();
    await expect.poll(async () => list.locator(".viz-list-item").count()).toBe(before);
  });

  test("demo condition toggle", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#btn-toggle-panel")).toBeVisible({ timeout: 15_000 });
    const panel = page.locator("#viz-cond-panel");
    await expect(panel).toBeVisible();
    await page.locator("#btn-toggle-panel").click();
    await expect(panel).toHaveCount(0, { timeout: 10_000 });
    await page.locator("#btn-toggle-panel").click();
    await expect(page.locator("#viz-cond-panel")).toBeVisible({ timeout: 10_000 });
  });
});
