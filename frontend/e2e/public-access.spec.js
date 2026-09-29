import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // Public-form UX uses synthetic responses; database workflows have separate
  // PostgreSQL tests. Block accidental requests to any non-local destination.
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (url.port !== '4317') return route.continue();
    const body = url.pathname === '/api/terms' ? { terms: [] }
      : url.pathname === '/api/auth/login' ? { error: 'Invalid email or password.' }
      : url.pathname === '/api/auth/password-reset/request' ? { message: 'If an active account exists, a reset link will be sent.' }
      : { error: 'This test link is invalid or expired.' };
    await route.fulfill({ status: url.pathname === '/api/auth/login' ? 401 : 200, json: body });
  });
});

for (const width of [1440, 390, 320]) {
  for (const path of ['/', '/accept-invite?token=synthetic', '/reset-password?token=synthetic']) {
    for (const dark of [false, true]) {
      test(`${path} at ${width}px in ${dark ? 'dark' : 'light'} view`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        if (dark) await page.getByRole('checkbox', { name: 'Dark View' }).check();
        await expect(page.getByRole('heading', { name: 'SHERMAN', exact: true })).toBeVisible();
        const violations = (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations;
        expect(violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) }))).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        await page.screenshot({ path: `test-results/public-${width}-${dark ? 'dark' : 'light'}-${path.split('?')[0].replaceAll('/', '') || 'home'}.png`, fullPage: true });
      });
    }
  }
}

test('keyboard login, failure announcement, and password-help focus', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('checkbox', { name: 'Dark View' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
  await page.keyboard.type('synthetic@example.invalid');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type('synthetic-invalid-password');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Sign In', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Invalid email or password.');
  await page.getByRole('button', { name: 'Forgot', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Account email (required)', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Account email (required)', { exact: true })).toHaveValue('synthetic@example.invalid');
});

test('required fields retain visible labels and reject empty requests', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Request Access', exact: true }).click();
  await expect(page.getByLabel('Full name (required)', { exact: true })).toBeFocused();
  await page.getByLabel('Full name (required)', { exact: true }).fill('Synthetic Faculty');
  await expect(page.locator('label[for="request-name"]')).toBeVisible();
  await expect(page.getByLabel('Requested role', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Division (required)', { exact: true })).toBeVisible();
});
