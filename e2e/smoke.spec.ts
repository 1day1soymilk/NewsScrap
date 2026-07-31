import { expect, test } from '@playwright/test'

test('renders the app shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '오늘의 주요 뉴스 스크랩' })).toBeVisible()
})
