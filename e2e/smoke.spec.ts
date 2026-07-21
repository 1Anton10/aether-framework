import { test, expect } from "@playwright/test";

test.describe("Aether framework site", () => {
  test("home shows compare bench", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1")).toContainText("Aether");
    await expect(page.locator("#compare")).toBeVisible();
    await page.click("#bench-run");
    await expect(page.locator("#bench-verdict")).toContainText("кадрах");
  });

  test("demo app SSR + wasm", async ({ page }) => {
    await page.goto("/demo");
    await expect(page.locator("#root")).toBeVisible({ timeout: 15000 });
    // Either SSR markup or client mount
    await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15000 });
  });
});
