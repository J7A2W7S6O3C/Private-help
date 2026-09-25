# Anchor

A small offline planner for iPhone. It shows **one thing at a time**, gives you a pause button for impulses, and keeps money, uni deadlines and promises where you can see them.

- **Now**: the one task to do right now, its smallest first step, and a 10-minute "just start" timer. There's an "I'm about to…" button for urges (ordering food, scrolling, gaming, staying up), a brain-dump box, and alerts for close deadlines, bills and promises. Near bedtime a wind-down checklist appears.
- **Plan**: sort the inbox into Today (3 things max) or Later. Tasks you've been putting off for 3+ days get flagged, with a prompt to make the step smaller.
- **Money**: your weekly budget, how much you can spend per day, food delivery spending, one-tap spend logging, and monthly bills with "paid" checkboxes.
- **Uni**: deadline countdowns with progress and a "next step", plus a list of *things I told someone I'd do*. If you'll be late on one, there's a draft for an honest message.
- **Me**: daily basics (food, movement, water, phone away — add your own) with a 7-day history, weekly stats, settings and backup.

## Privacy

- The app starts completely empty. The code contains no personal data.
- Everything you type is stored only in the browser storage on your own device (localStorage). The app has no server, account, analytics or tracking.
- The page makes no network requests except to load its own files. A Content-Security-Policy in `index.html` blocks any connection to other sites.
- Someone else visiting the same URL gets their own empty copy. They can't see your data.
- Export a backup from **Me** now and then. Keep backup files out of this repo (`.gitignore` already ignores `anchor-backup-*.json`).

## Put it on your iPhone

To install it, the app has to be served over HTTPS once. After that it works offline.

**Option A: GitHub Pages (free)**
1. Repo **Settings → Pages → Source: Deploy from a branch**, then pick this branch and `/ (root)`.
   (On a free GitHub plan, Pages needs the repo to be public. The code has no personal data in it, because your data only lives on your phone.)
2. Open the Pages URL in **Safari** on the iPhone.
3. Tap **Share → Add to Home Screen**. Always open it from that icon: home-screen apps keep their storage, but Safari tabs can have data cleared.

**Option B: Netlify Drop**: drag this folder onto https://app.netlify.com/drop and open the URL it gives you in Safari. Then do step 3 above.

## Things the app can't do (use iOS for these)

A web app can't send you reminders at set times on its own. Pair it with:
- **Screen Time → Downtime** set to your bedtime, and **App Limits** on games, social apps and delivery apps.
- A daily **Alarm/Reminder** at, for example, 9am ("Open Anchor, pick today's 3") and 30 min before bed ("Anchor shutdown").
- **Focus mode** during study blocks.

## Updating

When you change the app files, bump `VERSION` in `sw.js` so phones pick up the new version.
