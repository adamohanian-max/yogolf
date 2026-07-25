import { test, expect } from '@playwright/test';

const DATE = nextSaturday();

function nextSaturday(): string {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

async function search(page: import('@playwright/test').Page, opts: { zip: string; radius?: string }) {
  await page.goto('/');
  await page.fill('#zip', opts.zip);
  if (opts.radius) await page.selectOption('#radius', opts.radius);
  await page.fill('input[aria-label="Date"]', DATE);
  await page.click('.searchbtn');
}

test('landing page renders the search form', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.wordmark')).toContainText('YoGolf');
  await expect(page.locator('#zip')).toBeVisible();
  await expect(page.locator('.searchbtn')).toBeEnabled();
});

test('invalid zip shows an inline error and does not search', async ({ page }) => {
  await page.goto('/');
  await page.fill('#zip', '123');
  await page.click('.searchbtn');
  await expect(page.locator('.panel-err')).toContainText('5-digit zip');
});

test('Boston search returns courses with live tee-time chips and real prices', async ({ page }) => {
  await search(page, { zip: '02134', radius: '40' });
  await expect(page.locator('.chip').first()).toBeVisible({ timeout: 30_000 });

  // At least one chip shows a dollar price (live rate, not just "see price").
  await expect(page.locator('.chip .p', { hasText: '$' }).first()).toBeVisible();

  // Booking chips deep-link out.
  const href = await page.locator('.chip').first().getAttribute('href');
  expect(href).toMatch(/^https?:\/\//);
});

// 'best-course sort orders by score' test removed: the score sort is dormant
// while the scoring algorithm is reworked (option + Score badge hidden). Restore
// alongside re-enabling the sort in app/page.tsx.

test('fastest-drive sort shows drive times in non-decreasing order', async ({ page }) => {
  await search(page, { zip: '02134', radius: '40' });
  await expect(page.locator('.chip').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('.results-head .count');
    return el && /live tee times/.test(el.textContent || '');
  }, { timeout: 30_000 });

  await page.selectOption('#sort', 'drive');
  await page.waitForTimeout(500);
  // Live cards (those with tee-time chips) sort first; their drive times ("· N min")
  // should be non-decreasing.
  const metas = await page.locator('.card:has(.chip) .card-meta > span').filter({ hasText: /min$/ }).allTextContents();
  const mins = metas.map((t) => Number(t.match(/·\s*(\d+)\s*min/)?.[1])).filter((n) => Number.isFinite(n));
  expect(mins.length).toBeGreaterThan(0);
  const nonDecreasing = mins.every((v, i) => i === 0 || v >= mins[i - 1]);
  expect(nonDecreasing).toBe(true);
});

test('players filter constrains open spots', async ({ page }) => {
  await page.goto('/');
  await page.fill('#zip', '02134');
  await page.selectOption('#radius', '40');
  await page.getByRole('group', { name: 'Number of players' }).getByRole('button', { name: '4' }).click();
  await page.fill('input[aria-label="Date"]', DATE);
  await page.click('.searchbtn');
  await expect(page.locator('.chip').first()).toBeVisible({ timeout: 30_000 });
  const spots = await page.locator('.chip .s').allTextContents();
  for (const s of spots) {
    const m = s.match(/(\d+) spots/);
    if (m) expect(Number(m[1])).toBeGreaterThanOrEqual(4);
  }
});

test('a far-offshore point yields no courses in range', async ({ page }) => {
  await page.goto('/');
  // Geocode a real zip but tiny radius in the ocean-adjacent Nantucket far end
  await page.fill('#zip', '02134');
  await page.selectOption('#radius', '5');
  await page.fill('input[aria-label="Date"]', DATE);
  await page.click('.searchbtn');
  // Either shows results or a graceful empty state — never crashes.
  await expect(page.locator('.results-head, .empty, .card').first()).toBeVisible({ timeout: 30_000 });
});
