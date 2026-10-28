# Flare

Mobile-first chat rooms in the browser. Node + WebSockets on the server, Vite + React + Tailwind on the client, styled with Brackman's `theme.css` (primary switched from red to orange).

## Run it

Requires Node 22.13 or newer.

```bash
npm install
npm run dev          # server on :3001, Vite on :5173 (open http://localhost:5173/any-room)
```

Production:

```bash
npm run build        # client → dist/
GIPHY_API_KEY=... npm start   # serves dist/ and the WebSocket on PORT (default 3001)
npm test             # server tests over real WebSockets
```

To try it on your phone during development, open `http://<your-computer's-LAN-IP>:5173/room` (Vite listens on your network). Notifications won't work over a plain `http://` LAN address — see below.

### Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3001` | Port for the server (and the Vite dev proxy target). |
| `GIPHY_API_KEY` | — | Turns on GIF search. Get a free key at developers.giphy.com. Without it, pasted GIF links still work. |
| `GIPHY_RATING` | `pg-13` | GIPHY content rating filter (`g`, `pg`, `pg-13`, `r`). |
| `DATA_DIR` | `./data` | Folder for the database file (`flare.db`). On Railway this is the mounted volume, `/data`. |
| `ROOM_TTL_DAYS` | `0` (never) | If set, rooms with no activity for this many days are deleted. |

## How each requirement is met

- **`/room_name` creates or joins.** Visiting a path asks the server whether the room exists. New room → you pick a name and an optional password, and you become its owner. Existing open room → straight in (or a name prompt the first time). Existing password room → a password prompt; the server checks it with scrypt, and 5 wrong tries from one IP lock that room for a minute. Room names are letters, numbers, `-` and `_`, up to 40 characters, lower-cased.
- **Pasted text and images.** Paste an image anywhere (or attach / drag-drop one). Photos are resized to 1600px and re-encoded as WebP/JPEG in the browser before sending; GIFs are sent untouched (max about 2.5 MB).
- **GIFs.** The GIF button searches GIPHY through the server, so your API key never reaches browsers. Pasting a GIF link from GIPHY (including normal `giphy.com/gifs/...` page links), Tenor, Imgur or KLIPY sends it as a GIF. Tenor isn't offered as a search source because Google shut down the Tenor API in 2026.
- **Notifications.** The bell turns on system notifications for new messages and for people leaving, shown while the tab is in the background. "X left the room" also appears as an in-app notice, and the tab title shows an unread count.
- **Order.** The server stamps every message with an increasing sequence number and everyone sorts by it, so all screens show the same order. Messages you send while offline are queued and sent in order on reconnect, without duplicates.
- **`Name:` in a rainbow color.** Each person gets one of red, orange, yellow, green, blue, indigo, violet — the least-used one in the room — and keeps it if they rejoin.
- **Emoji.** Insert emoji in the message box, and react to any message (yours or others') by tapping it. Tap a reaction to add or remove yours.
- **Edit / delete.** Tap your own message → Edit or Delete. On a keyboard, ↑ in an empty box edits your last message.
- **Backgrounds.** Every room starts with an animated deep-space scene drawn like a sci-fi comic panel: an inked, posterized nebula with halftone edges and "Kirby crackle", a starburst sun, a cel-shaded ringed gas giant, and a von Neumann-style probe with its drone escort and sensor pings — inspired by the Bobiverse books, all artwork original and generated in code. It runs at up to 30 fps, pauses in background tabs, and holds still for people who prefer reduced motion. The room's creator can upload a custom background image from the ⋮ menu; everyone sees it, and it's saved with the room.
- **Delete room.** Only the browser that created the room sees "Delete room…" in the ⋮ menu. Everyone in the room is told and sent out.

## Things to know

- **Rooms persist.** Rooms, messages, edits, reactions, passwords, owners and colors are saved to a SQLite database (Node's built-in `node:sqlite`, so nothing extra to install) and survive restarts and deploys. Rooms in use are kept in memory; others load from disk when someone visits. Each room keeps its latest 500 messages (and at most ~60 MB of images). Because the database is one file on one disk, run a single server instance.
- **Identity is per browser, not per account.** A random secret ID in `localStorage` decides which messages are yours and who owns a room. Clearing site data or switching browsers means you can't edit old messages or delete a room you created.
- **Notifications need HTTPS** (or `localhost`). On iPhone, Safari only allows them after "Add to Home Screen" (iOS 16.4+); the app includes a manifest so that works. Android Chrome uses the included service worker (`public/sw.js`).
- **Deploying behind a proxy:** make sure it forwards WebSocket upgrades on `/ws` (nginx needs `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

## Layout

```
server/index.js     HTTP (room lookup, GIF search, static files) + WebSocket handling, rate limits
server/rooms.js     Room rules: create/join, passwords, ordering, edit, delete, reactions
server/db.js        Saving rooms and messages to SQLite
src/components/SpaceBackground.tsx  The animated space scene (canvas)
src/lib/useChat.ts  WebSocket connection, reconnecting, message order, unsent-message queue
src/components/     ChatScreen, MessageItem, Composer, EmojiPicker, GifPicker, Sheet
src/theme.css       Brackman theme with orange primary
test/               Server tests, including a restart test that checks rooms come back
```
