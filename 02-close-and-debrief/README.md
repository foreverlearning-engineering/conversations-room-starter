# Step 2: Close and debrief

Step 1's practice room, plus a **Finish** button that closes the practice and a debrief tied to the moments that mattered. Each debrief line links back to the turn it came from.

## You need

- A developer workspace with the Conversations API added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key and assignment id in .env
npm start
```

Open http://localhost:3000. Answer the character two or three times, then press **Finish**.

## What you should see

- The closeout: the character's closing line and the Coach's closing note, with the safety status and the receipt (`1 text turn · $0.03 · settled`).
- **Your debrief**: what happened and what it means, the key moments, how the character responded, and your next practice. Each line links to the turn it came from: follow a link and the page scrolls to that turn.
- If the practice was too short for a debrief, a plain sentence that says so.
- A line in `receipts.jsonl` for each confirmed turn, the opening and the closeout included.

## How it works

| File | What it does |
| --- | --- |
| `server.ts` | Step 1's server, plus `/api/finish`: it closes the session once (`POST /v1/sessions/{id}/end`, with an operation id kept with the session, so a retried Finish is the same closeout), keeps its receipt, then reads the debrief (free) and puts it in plain words. |
| `conversations.ts` | Step 1's client, plus `closeSession` (it accepts the closeout only with `session_ended` and the final `done`) and `debrief`. |
| `public/` | The page. Every turn has an id (`turn-<ordinal>`), so the debrief's lines can link to the turns they came from. |

The closeout is a billable text turn, at 3¢ per text turn, charged when it is saved. Reading the debrief is free. Feedback comes at three levels: the Coach in the moment, the debrief after, and Insights across practices (a later step).

How the characters responded is how they were written to respond in this practice, never a reading of the person practising.

The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/

## Next

Step 3, **Pick the room and the cast**, starts from this folder.
