# Embed a practice room in your app

Team Desk, the sample product in `start/`, with a practice room from the Conversations API inside its **Practice the conversation** panel. The rest of the product is unchanged. Use it as a pattern for your own product.

## You need

- A developer workspace with the Conversations API added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key and assignment id in .env
npm start
```

Open http://localhost:3000 and press **Practice with Jon**. The room "Direct Feedback To A Report" opens in the panel; answer Jon.

## What you should see

- Jon's lines under his name, in Team Desk's own look, and the Coach's note in its own strip.
- With each reply, the safety status and the receipt (`1 text turn · $0.03 · settled` and the request id).
- The key only on your server, and one line in `receipts.jsonl` for each confirmed turn.

## What changed from `start/`

| File | Change |
| --- | --- |
| `practice-route.ts` | New. Two routes on your own server, `/api/practice/start` and `/api/practice/turn`: the only code that calls the Conversations API, and the only place the key is read. |
| `conversations.ts` | New. The same small client as step 1 of the ladder. |
| `server.ts` | One line: `if (await handlePractice(request, response)) return;` |
| `public/app.js`, `public/style.css` | The panel shows the room, in the product's colours and type. |
| `.env.example` | The key, the API host and the assignment id. |

The opening and each message are billable text turns, at 3¢ per text turn. In your own product, pass your own opaque user id instead of the sample's cookie, and never a name or an email.

**Your own faces.** Each character's face is drawn in code, in `public/faces.js`. To use your own artwork, put the images in `public/faces/` and write their addresses in the block marked **YOUR OWN ARTWORK GOES HERE**: one per mood, and if you like per expression or per character. Any mood you leave empty keeps the drawn face. The faces are the characters' simulated responses, never a reading of the person practising.

The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/
