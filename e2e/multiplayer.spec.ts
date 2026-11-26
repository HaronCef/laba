import { expect, test, type Browser, type Page } from '@playwright/test';

// Два окремі контексти браузера = два різні гравці (свої cookie, свій WebSocket).
async function joinAs(browser: Browser, name: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  await page.locator('#room-list li', { hasText: 'Пояс' }).click();
  await page.fill('#pilot-name', name);
  await page.click('#join-btn');
  await expect(page.locator('#chat-status')).toContainText('онлайн', { timeout: 10_000 });
  return page;
}

// позиція корабля з netId = shipId в останньому знімку, який бачить ця сторінка
function shipX(page: Page, shipId: number): Promise<number | null> {
  return page.evaluate((id) => {
    const e = window.spaceDuel?.net.latest?.entities.get(id);
    return e ? e.x : null;
  }, shipId);
}

test.describe('дві вкладки в одній кімнаті', () => {
  test('roster однаковий, рух видно за 500 мс, чат доходить', async ({ browser }) => {
    const alice = await joinAs(browser, 'Alice');
    const bob = await joinAs(browser, 'Bob');

    // 1. roster: обидва бачать обох
    for (const page of [alice, bob]) {
      await expect(page.locator('#chat-roster')).toContainText('Alice');
      await expect(page.locator('#chat-roster')).toContainText('Bob');
    }

    // 2. Alice газує - Bob бачить, що її корабель зрушив, не пізніше ніж за 500 мс
    const aliceShip = await alice.evaluate(() => window.spaceDuel?.net.shipId ?? null);
    expect(aliceShip).not.toBeNull();
    await expect.poll(() => shipX(bob, aliceShip ?? 0)).not.toBeNull();
    const x0 = (await shipX(bob, aliceShip ?? 0)) ?? 0;

    await alice.bringToFront();
    const started = Date.now();
    await alice.keyboard.down('KeyD'); // поворот + газ
    await alice.keyboard.down('KeyW');
    await expect
      .poll(async () => Math.abs(((await shipX(bob, aliceShip ?? 0)) ?? x0) - x0), { timeout: 500, intervals: [20] })
      .toBeGreaterThan(1);
    const seenAfter = Date.now() - started;
    await alice.keyboard.up('KeyW');
    await alice.keyboard.up('KeyD');
    console.log(`Bob побачив рух Alice через ${seenAfter} мс`);
    expect(seenAfter).toBeLessThan(500);

    // 3. чат: повідомлення Bob приходить до Alice
    await bob.fill('#chat-input', 'привіт від Bob');
    await bob.press('#chat-input', 'Enter');
    await expect(alice.locator('#chat-log')).toContainText('привіт від Bob');
  });
});
