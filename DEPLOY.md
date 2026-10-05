# Deploying the SBC Prayer Console to Cloudflare (free tier)

Everything below runs from this folder (`sbc-prayer-worker/`). **Requirements:** Node.js **22 or newer** (current Wrangler 4 refuses to run on Node 20) and a free Cloudflare account. No credit card is needed for the Workers Free plan.

## 1. Create a free Cloudflare account
1. Go to <https://dash.cloudflare.com/sign-up>, sign up with your email, and verify the email address.
2. You do not need to add a domain or a payment method. Workers Free gives you 100,000 Worker requests/day, free unlimited static-asset requests, and Workers KV (100k reads / 1k writes per day).
3. The first time you deploy, Cloudflare gives your account a `<account-subdomain>.workers.dev` address; your site will live at `https://sbc-prayer-console.<account-subdomain>.workers.dev`.

## 2. Install and log in
```bash
cd sbc-prayer-worker
npm install                 # installs wrangler + fast-xml-parser
npx wrangler login          # opens a browser window; click "Allow"
npx wrangler whoami         # optional: confirm you are logged in
```

## 3. Create the KV namespace and paste its id
```bash
npx wrangler kv namespace create CACHE
```
Wrangler prints something like:
```
[[kv_namespaces]]
binding = "CACHE"
id = "0123456789abcdef0123456789abcdef"
```
(If it asks "Would you like Wrangler to add it to your config?", answer **no** and do the manual edit below, or answer yes and skip the edit.)

Open `wrangler.toml` and replace the placeholder:
```toml
[[kv_namespaces]]
binding = "CACHE"
id = "REPLACE_WITH_KV_NAMESPACE_ID"     # <-- paste the id Wrangler printed here
```
Keep `binding = "CACHE"` exactly; the code uses `env.CACHE`.

## 4. (Optional) Set contact URL / timezone / Joshua Project key
* In `wrangler.toml` under `[vars]`: set `CONTACT_URL = "https://your-church.example"` (or an email). It is appended to the User-Agent so publishers can contact you (recommended - it is what the sources' terms ask for). `TZ` sets the default "today" for `/api/today` (browsers send their own date anyway).
* Optional free Joshua Project API key (adds "suggested prayer" text): `npx wrangler secret put JP_API_KEY` and paste the key.

## 5. Deploy
```bash
npx wrangler deploy
```
Wrangler uploads `public/` as static assets, publishes the Worker, creates the Cron Trigger (every 5 minutes) and prints the URL, e.g. `https://sbc-prayer-console.<account-subdomain>.workers.dev`.

## 6. Warm the cache and check it
The first cron runs within 5 minutes and then fetches one source per run. To fill the cache immediately:
```bash
URL=https://sbc-prayer-console.<account-subdomain>.workers.dev
curl $URL/api/health
curl -X POST $URL/api/refresh        # refreshes the 2 most-overdue sources; repeat once a minute until /api/sources shows all "ok"/"empty"
curl $URL/api/sources
```
(Simply opening the site also starts a background fetch for any source that has never been fetched.) Watch logs with `npx wrangler tail`.

## 7. (Optional) Custom domain
Requires a domain whose DNS is on Cloudflare (add the site in the dashboard first - the free plan is fine - and switch the registrar's nameservers to the two Cloudflare ones).

*Dashboard way:* **Workers & Pages → sbc-prayer-console → Settings → Domains & Routes → Add → Custom domain**, enter e.g. `prayer.yourchurch.org`.

*Config way:* add to `wrangler.toml` and redeploy:
```toml
routes = [ { pattern = "prayer.yourchurch.org", custom_domain = true } ]
```
```bash
npx wrangler deploy
```
To turn off the `*.workers.dev` address afterwards add `workers_dev = false`.

## Updating later
Edit files, then `npx wrangler deploy` again. Local test: `npx wrangler dev` (http://localhost:8787; uses a local simulated KV, no login needed) and, in another terminal, trigger the cron with `curl 'http://localhost:8787/__scheduled?cron=*/5+*+*+*+*'` (needs `npx wrangler dev --test-scheduled`).

## Free-plan limits this project is designed around
| Limit (Workers Free) | How it is respected |
|---|---|
| 10 ms CPU per invocation | Page views only read KV (no parsing). Each cron run refreshes **one** source (`CRON_MAX_SOURCES`, default 1); `POST /api/refresh` refreshes up to 2 (`REFRESH_MAX_SOURCES`). A lean regex RSS extractor is used instead of building a full XML tree. |
| 50 subrequests per invocation | A request touches at most ~10 KV reads + a few fetches. |
| KV 1,000 writes/day | About 250-350 writes/day (one per source refresh, plus a throttle record for the Crawl-delay hosts). |
| KV 100,000 reads/day | 30-second per-isolate read cache; ~35 reads per full page load -> ~2,500+ page loads/day. |
| 5 Cron Triggers | Uses 1. |

If you ever see `Error 1102 / exceeded CPU time limit` in `wrangler tail`, lower `CRON_MAX_SOURCES`/`REFRESH_MAX_SOURCES` to `1` (or move to the $5/month Workers Paid plan, where you can use `crons = ["*/30 * * * *"]` and `CRON_MAX_SOURCES = "8"`).
