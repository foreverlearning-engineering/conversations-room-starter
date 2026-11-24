# Step 1: Your first practice room

A page where a user rehearses a hard conversation with a character from the Conversations API, with the Coach's note beside the scene. Your server keeps the key; the page talks only to your server.

## You need

- A developer workspace with the Conversations API added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key and assignment id in .env
npm start
```

Open http://localhost:3000. The room "Direct Feedback To A Report" opens: the character speaks first. Answer them, for example "I wanted to talk about the last two reports. They came in after the deadline, and I'd like to understand what's getting in the way."

## What you should see

- The room's opening, under the character's name.
- After you answer, the character's reply under their name, and the Coach's note in its own panel.
- With each reply, the safety status (for example `Safety: clear · action: none`) and the receipt: `1 text turn · $0.03 · settled` and the request id.
- A new line in `receipts.jsonl` for each confirmed turn, the opening included.

## How it works

| File | What it does |
| --- | --- |
| `server.ts` | Serves the page and gives each new browser a pseudonymous user id in a cookie. For a new user it reads the catalog (free), prepares one session in the room (free) and requests its opening, once. Then it relays each message as a turn. |
| `conversations.ts` | Calls the Conversations API: `GET /v1/conversation/catalog`, `POST /v1/conversation/sessions`, `POST /v1/chat` for the opening and each turn, and the free reads `GET /v1/requests/{id}` and playback. It accepts a turn only when the final `done` event confirms it, with the same request and session as the first event. |
| `public/` | The page. Each reply shows every character's line under their name, the Coach in its own panel, and the safety status and receipt apart from the conversation. |

The opening and each message are billable text turns, at 3¢ per text turn. The complete reply comes back to your application, checked before anything is shown.

If a turn's outcome is uncertain (the connection ends before `done`), the server looks it up with `GET /v1/requests/{id}` and reads the saved turn, instead of sending it again under a new key.

This step keeps sessions in memory: if the server restarts, a returning browser gets a new session and a new opening. It never ends a session; step 2 does.

The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/

## Next

Step 2, **Close and debrief**, starts from this folder.
