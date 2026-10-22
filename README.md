# Moth Watch

A public moth-sighting leaderboard for Clifton and Gilpin residents. It has no build step: a static `index.html` and Vercel Functions in `api/`, which store data in Upstash Redis (free through the Vercel Marketplace).

## Test it locally first

You need Node.js 18 or newer (check with `node -v`; get it from nodejs.org if missing). No `npm install` is needed for local testing.

```
cd moth-watch
npm run dev
```

Then open http://localhost:3000. Everything works as it will on Vercel (moving in, logging moths, undo, rankings, the admin page) but data is saved to `.local-data/db.json` in the project instead of the cloud database.

- **Test several residents:** use "Switch resident" to move in as someone else, or open the site in a private window or second browser.
- **Test from your phone:** on the same Wi-Fi, open `http://<your computer's IP>:3000`.
- **Admin page:** http://localhost:3000/admin with PIN `1234`. Use your own with `ADMIN_PIN="your passphrase" npm run dev`. If you lock yourself out locally, restart the server to clear it.
- **Start fresh:** stop the server and delete the `.local-data` folder, or use the admin page.
- **Preview the sky at another time of day:** add `?hour=` to the address, for example `http://localhost:3000/?hour=14` (afternoon) or `?hour=19` (sunset). This only works on your own computer.
- **Different port:** `PORT=4000 npm run dev`.
- **Shorter wait between logs** (handy for testing the pop-ups): `COOLDOWN_SECONDS=2 npm run dev`. The live site uses 5 seconds.

`.local-data` and `dev-server.js` are excluded from Vercel deploys.

## Deploy

1. Create a Vercel project from this folder (`vercel deploy --prod`, or import a Git repo containing it). Framework preset: **Other**.
2. In the project, go to **Storage → Create Database → Upstash for Redis** (free plan) and connect it to the project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` settings automatically.
3. Redeploy so the functions pick up those settings.
4. Optional: add an `UNDO_SECRET` env var (any random string) to sign undo tokens. Without it, the database token is used.
5. Make sure **Deployment Protection** is off for production, so neighbours can open the link without a Vercel login.

## How it works

- **Residents**: anyone can pick a username (2–20 characters, at least one letter, no offensive words) plus their tower and level (Ground, then Levels 1 to 9). If the name is taken, they see "That name is taken" and can either pick another or choose "That's me" to sign in on a new device. There are no passwords, so this prevents accidents rather than impersonation.
- **Sightings**: each log records 1–20 moths, either *inside* (in your apartment) or *outside* (around the towers). Inside moths count toward the resident, their level and their tower. Outside moths count toward the resident only, not their level or tower.
- **Changing home**: a resident opens **Settings** (top bar) to change their tower and level. Their past moths move with them: the old level and tower lose those moths and the new ones gain them.
- **Logging**: tap **+1 Inside** or **+1 Outside** to log one moth. "Log several at once" opens a counter (2 to 20). On phones this box is pinned to the bottom of the screen.
- **Tower lights**: each resident switches on one window on their level, until the level is full. The colour shows how many residents live there: dim for 1 to 5, brighter for 6 to 10, brightest for 11 or more, off for none. (Moth counts show in the "Moth count by level" table and as the moths flying around the towers.)
- **Soundtrack**: put your mp3 at `audio/soundtrack.mp3`. It loops, starting on a visitor's first tap (browsers don't allow sound before that), and the speaker button in the top bar mutes it; the choice is remembered on that phone. If the file isn't there, the button stays hidden.
- **Day and night**: the city view follows each visitor's local time (sunrise, daytime, sunset, then a night sky with a moon and stars). **Settings** also has a Day / Night switch for the colours of the app itself; it follows the phone's setting until the person changes it.
- **Time periods**: the **Today / This week / All time** tabs change the whole board (this week runs Monday to Sunday, using the viewer's own clock).
- **Resident rankings**: always show each resident's moths for **Today** and **Total** (inside and outside, ignoring the period tabs). Click a heading to choose which column the list is sorted by (always highest first). The default is Total. The # column follows the sort.
- **Your standing**: signed-in residents see their rank and their level's rank for the chosen period.
- **About**: the first button in the top bar. It shows the version and publish date, says the app was made with AI, and carries the copyright line. To change them, edit `APP_VERSION`, `APP_PUBLISHED` and `OWNER` near the top of the About code in `index.html`.
- **Bug reports**: **Report a bug** in About opens a form (150 characters max, **Submit**). Each report stores the text, the time, the username if signed in, and the device type. One report per device every 30 seconds. Reports are kept in a separate `bugs` hash (newest 500), so resetting the counts never deletes them. View and delete them on the admin page under **Bug reports**.
- **Moths by time of day**: about half as many at dawn, none from 10 am to 2 pm, one or two from 2 pm, about six in late afternoon, building into the evening, slightly fewer at sunset. Set in `mothAllow()` in `index.html`.
- **My window light**: a signed-in resident can switch their own light off or on from the main panel. It's saved on their resident record, so it's the same on every device and everyone sees the level's lights change. The resident still counts everywhere else (level residents, rankings).
- **Late-night lights**: from 9 pm the lit windows thin out and dim for each visitor, down to about a quarter around 2:30 to 3:30 am, back to full by 5 am (`lateNight()` in `index.html`). It follows each visitor's own clock and is never saved.
- **Night moths**: each lit window draws a moth (up to 60), and the streetlights draw 1 to 10 moths each depending on how many lights are on. These are visual only and never change the tallies. Per-level moths in the city follow the logged count: up to 6 per level, from the square root of that level's moths (inside moths only).
- **Welcome screen**: on a visitor's first visit the Moth Inspector asks them to name one of the two nearby parks (Gilpin or Clifton; "Clifton Park" and small typos are accepted). A hint appears after two wrong tries. It's a friendly door, not security. Skipped on later visits (saved on that device). Add `?welcome=1` to the address to see it again.
- **Phone menu**: on phones (440 px wide or less) the top-bar buttons become a pixel hamburger button at the top right that opens a list: About, Help, Settings, Info and Music.
- **Dev mode**: on the admin page, **Dev mode** turns the CITY PREVIEW panel on for that browser only. Neighbours never see it.
- **Removing a resident**: the admin page lists every resident with a **Remove** button (press twice). It also deletes all of that resident's moth logs.
- **Soundtrack**: `audio/soundtrack.mp3` is 128 kbps (3.8 MB). If it fails to load, the page retries, then tries Moth Watch's own address, so a slow connection or the `/moth-watch` rewrite can't leave it silent.
- **Help**: the **Help** button in the top bar explains the rules to new residents.
- **Home screen**: `manifest.webmanifest` and `icons/` let neighbours add Moth Watch to their phone's home screen (iPhone: Share, then Add to Home Screen; Android: browser menu, then Install app). It needs the live site, and it doesn't work offline.
- **Wait between logs**: a resident can log once every 5 seconds. The server enforces this, so it can't be bypassed by refreshing or scripting.
- **"Are you sure?" pop-ups**: each time a resident's moths for the day pass another 10 (10, 20, 30, 40) a pop-up questions their counting, getting more suspicious each time. From 50 a day, every log shows "Woah, slow down there. Are you sure you've seen this many moths?" The pop-up offers to undo the log. These are warnings only; nothing is blocked.
- **Undo**: the browser that logged a sighting gets a signed token and can remove it for 5 seconds after logging.
- **Storage**: three Redis hashes, `users`, `sightings` and `bugs`. Reading the board is two commands. Usernames are claimed atomically, so two people can't take the same name at once.
- **Demo**: open `http://localhost:3000/?demo` (or `index.html` straight from disk) to see the page with example data that is never saved. `?demo` is ignored on the live site, so nobody can show a fake leaderboard there.

## Resetting the counts (admin)

1. Set your admin PIN (see below). Until it's set on Vercel, the admin page is switched off.
2. Open `/admin` on the site. It isn't linked from the leaderboard and is marked noindex for search engines.
3. Enter the PIN, choose **Moth counts only** (keeps residents) or **Everything**, type `RESET`, and confirm.

**Lockout:** 3 wrong PINs within 10 minutes locks the admin page for 10 minutes, even for the right PIN. Every attempt is counted before it's checked, so firing many guesses at once doesn't help. A correct PIN clears the count.

### Setting or changing the admin PIN

Use a passphrase of 10+ characters (e.g. four random words); letters, numbers and spaces all work.

- **On Vercel:** Project → **Settings → Environment Variables**. Add (or edit) `ADMIN_PIN`, tick **Production**, mark it **Sensitive**, save, then **Redeploy** (Deployments → latest → ⋯ → Redeploy). The new PIN only works after the redeploy.
- **Locally:** `ADMIN_PIN="your passphrase here" npm run dev`. Without it, the local PIN is `1234`. Keep the quotes if it has spaces.

You can also delete the `sightings` or `users` keys from the Upstash data browser.

## Showing it at randomideaproject.com/moth-watch

**Two copies of the page:** `app.html` is an exact copy of `index.html`. Vercel wouldn't pass the page called "index" through the main site's rewrite (everything else worked), so the main site forwards `/moth-watch/` to `/app`. If you edit `index.html`, copy it over `app.html` too. Both files must always be identical.

Moth Watch uses only relative links, so it works at the top of its own address or inside a folder. To show it at `/moth-watch` on the main site (also a Vercel project), add this to the main site's `vercel.json` (replace the address with Moth Watch's own Vercel address, and keep Deployment Protection off on the Moth Watch project):

```json
{
  "redirects": [{ "source": "/moth-watch", "destination": "/moth-watch/", "permanent": true }],
  "rewrites": [
    { "source": "/moth-watch/", "destination": "https://YOUR-MOTH-WATCH-ADDRESS.vercel.app/app" },
    { "source": "/moth-watch/:path*", "destination": "https://YOUR-MOTH-WATCH-ADDRESS.vercel.app/:path*" }
  ]
}
```

The admin page is then at `/moth-watch/admin`.

## City view: crowd, Moth Inspector, music

- **Crowd size**: the number of people and dogs in the park follows the time of day (busy 7:30–9 am and 4:30–6:30 pm, quiet at midday and near 6:30 am / 7:30 pm) and the live weather (more when clear, fewer in rain, almost none in a storm). A person and their dog always appear together. Preview weather in CITY PREVIEW.
- **Moth Inspector**: a human inspector in a cap. He greets first-time visitors on the welcome screen (the park question) and warns about too many moths logged. He also strolls through the park, without a dog, at dawn (6:30–9:30 am) and in the evening (5:15–7:30 pm) when moths are most about and people are out, with an animated speech bubble. Click him for a moth fact in a pop-up. Facts live in `INSPECTOR_FACTS` in `index.html` (28 so far); they come in a shuffled order stored on the device, and every fact is used once before any repeats. CITY PREVIEW has a button to keep him out all day.
- **Music button** shows the real state. Browsers often block sound after a refresh until a tap, so it then says "tap to play" and one tap starts it.
