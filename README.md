# Tezkor Xizmat Telegram bot

The bot provides the public service-discovery flow from the website: categories,
search, top-rated and nearby services, business details, phone numbers, maps, and
public reviews. It calls the existing backend API, so listings and categories
come from the same Neon-backed data as the website.
Service cards and details show the backend's business photos, with a gallery
when multiple images are available. The welcome banner defaults to
`<WEB_APP_URL>/website.png`; set `WELCOME_IMAGE_URL` to use another image.
Photos are downloaded by the bot and uploaded to Telegram, rather than relying
on Telegram to fetch the image URL.

## Run locally

Requirements: Node.js 18.18 or newer.

```sh
npm install
cp .env.example .env
```

Set `TELEGRAM_BOT_TOKEN` in `.env` using the token from BotFather, then run:

```sh
npm start
```

`API_BASE_URL` defaults to the deployed backend and `WEB_APP_URL` to the live
website. Set either in `.env` to use another deployment. Never commit `.env`.

## Deploy

Run this as a persistent Node.js worker (for example, a Render Background
Worker), set the start command to `npm start`, and configure
`TELEGRAM_BOT_TOKEN`, `API_BASE_URL`, and `WEB_APP_URL` in the host's environment.
`WELCOME_IMAGE_URL` is optional.
Do not run two polling instances with the same bot token.

The bot currently uses Telegram's polling mode and in-memory conversational
state; it does not create a second database. Reviews can be read in Telegram.
Creating reviews or managing an account still opens the website because the
backend currently requires account authentication and does not expose Telegram
authentication. The bot opens the website as a Telegram Mini App from its
keyboard and chat menu. The frontend calls `ready()` and `expand()` and uses
Telegram's native back button, while existing website routes remain available.
Telegram user data is not treated as authenticated identity.
