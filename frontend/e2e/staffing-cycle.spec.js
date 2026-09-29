import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.skip(!process.env.TEST_DATABASE_URL, 'Requires disposable local PostgreSQL; enabled in CI');

async function login(page, actor) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(`${actor}@example.invalid`);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-pilot-only-2099!');
  const pending = page.waitForResponse(r => r.url().endsWith('/auth/login') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Sign Out', exact: true })).toBeVisible();
  return (await response.json()).session.token;
}

async function keyboardAction(page, button, path) {
  await expect(button).toBeEnabled();
  const pending = page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST');
  await button.focus();
  await page.keyboard.press('Enter');
  const response = await pending;
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

for (const division of ['Science', 'Arts']) {
  test(`${division} browser ranking, chair confirmation, and dean approval`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    const scope = division.toLowerCase();
    await page.setViewportSize({ width: 390, height: 900 });
    await login(page, `faculty-${scope}`);
    const add = page.getByRole('button', { name: 'Add to Preferences', exact: true });
    await expect(add).toHaveCount(2);
    await add.first().focus();
    await page.keyboard.press('Enter');
    await add.first().focus();
    await page.keyboard.press('Enter');
    const move = page.getByRole('button', { name: 'Move Up', exact: true }).nth(1);
    await move.focus();
    await page.keyboard.press('Enter');
    const course = division === 'Science' ? 'MATH' : 'ART';
    await expect(page.getByText(`#1 ${course} 102 - ${division === 'Science' ? '90002' : '91002'}`, { exact: true })).toBeVisible();
    const draft = await keyboardAction(page, page.getByRole('button', { name: 'Save Draft', exact: true }), '/preferences');
    expect(draft.status).toBe('draft');
    const submitted = await keyboardAction(page, page.getByRole('button', { name: 'Submit Preferences', exact: true }), '/preferences');
    expect(submitted.status).toBe('submitted');
    const resubmitted = await keyboardAction(page, page.getByRole('button', { name: 'Submit Preferences', exact: true }), '/preferences');
    expect(resubmitted.versionNumber).toBeGreaterThan(submitted.versionNumber);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => v.id)).toEqual([]);
    await page.screenshot({ path: `test-results/${scope}-ranked-preferences.png`, fullPage: true });

    const chairToken = await login(page, `chair-${scope}`);
    // Freeze has no dedicated browser control; exercise the real authenticated
    // endpoint, then return to the browser review queue.
    const frozen = await page.request.post('http://127.0.0.1:4317/api/windows/freeze', {
      headers: { authorization: `Bearer ${chairToken}` }, data: { termCode: '2099FA', division, auditReason: 'Synthetic pilot deadline' },
    });
    expect(frozen.ok()).toBe(true);
    await page.getByRole('button', { name: 'Refresh Workflow', exact: true }).click();
    await page.getByLabel('Faculty preference review', { exact: true }).selectOption(`faculty-${scope}`);
    const assign = page.getByRole('button', { name: 'Assign', exact: true }).first();
    await expect(assign).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await keyboardAction(page, assign, '/chair-decisions');
    const submit = page.getByRole('button', { name: /^Submit to Dean/ });
    await expect(submit).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    await keyboardAction(page, submit, '/assignments/submit');

    await login(page, `dean-${scope}`);
    const returned = page.getByRole('button', { name: 'Return for Revision', exact: true });
    await expect(returned).toBeEnabled();
    const prompt = new Promise(resolve => page.once('dialog', async dialog => { expect(dialog.type()).toBe('prompt'); await dialog.dismiss(); resolve(); }));
    await returned.focus();
    await page.keyboard.press('Enter');
    await prompt;
    const approve = page.getByRole('button', { name: /^Approve Submitted/ });
    await expect(approve).toBeEnabled();
    page.once('dialog', dialog => dialog.accept());
    const approved = await keyboardAction(page, approve, '/assignments/approve');
    expect(approved.approvedCount).toBe(1);
    await page.screenshot({ path: `test-results/${scope}-dean-approved.png`, fullPage: true });
  });
}
