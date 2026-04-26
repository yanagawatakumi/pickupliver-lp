const { test } = require('playwright/test');

test('talent card in-class and screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://127.0.0.1:4174', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  await page.mouse.wheel(0, 1800);
  await page.waitForTimeout(250);
  await page.screenshot({ path: '/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/docs/_checks/talent-shine-step1.png' });

  await page.waitForTimeout(220);
  await page.screenshot({ path: '/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/docs/_checks/talent-shine-step2.png' });

  await page.waitForTimeout(220);
  await page.screenshot({ path: '/Users/yana/Downloads/VoiceTree/HP作成/260221_PICKUPLIVER/docs/_checks/talent-shine-step3.png' });

  const cardState = await page.$$eval('.talent-card', (cards) =>
    cards.map((c) => ({
      name: c.querySelector('.talent-name')?.textContent?.trim() || '',
      inClass: c.classList.contains('in')
    }))
  );

  console.log('CARD_STATE=' + JSON.stringify(cardState));
});
