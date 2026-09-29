import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires disposable local PostgreSQL; enabled in CI');

for (const actor of ['admin', 'faculty-science', 'faculty-arts', 'chair-science', 'chair-arts', 'dean-science', 'dean-arts']) {
  test(`${actor} signs in by keyboard and clears the workspace on failed logout`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.setViewportSize({ width: actor === 'admin' ? 1440 : 390, height: 900 });
    await page.goto('/');
    await page.getByLabel('Email', { exact: true }).fill(`${actor}@example.invalid`);
    await page.keyboard.press('Tab');
    await page.keyboard.type('Synthetic-pilot-only-2099!');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
    await expect(page.getByText(`Pilot ${actor}`, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Request Account Access', exact: true })).toHaveCount(0);
    const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
    expect.soft(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${actor}.png`, fullPage: true });
    await page.route('**/api/auth/logout', route => route.abort());
    await page.getByRole('button', { name: 'Sign Out', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Request Account Access', exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toContainText('could not be revoked');
    await expect(page.getByText(`Pilot ${actor}`, { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
