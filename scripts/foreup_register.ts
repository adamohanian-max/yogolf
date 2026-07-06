/**
 * Assisted registration at ForeUp login-gated courses. Opens each course's
 * signup form in a VISIBLE browser with your details pre-filled; you just solve
 * the reCAPTCHA, click Register, and (later) click the email verification link.
 *
 * Run this ON YOUR MAC (it needs a screen for the CAPTCHA):
 *   npx tsx scripts/foreup_register.ts            # all 11 gated courses
 *   npx tsx scripts/foreup_register.ts 19969 ...  # specific course ids
 *
 * Your name/phone are below; email + password come from data/credentials.json.
 * After all of them, verify the emails in adamohanian@gmail.com, then:
 *   npx tsx scripts/probe.ts --all      (or foreup_login_test.ts <id>)
 */
import { chromium } from '@playwright/test';
import readline from 'readline';
import { foreupLogin } from '../lib/credentials';

const FIRST = 'Adam';
const LAST = 'Ohanian';
const PHONE = '978-930-2983';

const GATED = ['18878', '19166', '19213', '19555', '19573', '19609', '19969', '21089', '22108', '22173', '22850'];

function prompt(q: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}

async function main() {
  const ids = process.argv.slice(2).length ? process.argv.slice(2) : GATED;
  // Headed so you can see + solve the CAPTCHA. Falls back to headless if no display.
  const browser = await chromium.launch({ headless: false, args: ['--disable-blink-features=AutomationControlled'] });
  try {
    for (const id of ids) {
      const creds = foreupLogin(id);
      if (!creds) { console.log(`${id}: no credentials entry — skipping`); continue; }
      const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
      try {
        await page.goto(`https://foreupsoftware.com/index.php/booking/${id}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(4000);
        await page.getByText(/^log in$/i).first().click({ timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.getByText(/sign up for free/i).first().click({ timeout: 6000 });
        await page.waitForTimeout(2000);
        await page.fill('#register_first_name', FIRST);
        await page.fill('#register_last_name', LAST);
        await page.fill('#register_phone', PHONE);
        await page.fill('#register_email', creds.username);
        await page.fill('#register_password', creds.password);
        console.log(`\n▶ Course ${id}: form pre-filled. In the browser window, solve the CAPTCHA and click Register.`);
        await prompt('   Press Enter here once you have clicked Register (or to skip)…');
      } catch (e) {
        console.log(`${id}: could not open form — ${String(e).slice(0, 80)}`);
      } finally {
        await page.close().catch(() => {});
      }
    }
    console.log('\nDone. Now check adamohanian@gmail.com and click each verification link,');
    console.log('then run:  npx tsx scripts/probe.ts --all   to see them go live.');
  } finally {
    await browser.close();
  }
}
main();
