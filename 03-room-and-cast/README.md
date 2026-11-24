# Step 3: Pick the room and the cast

Step 1's practice room, plus a picker. The user chooses a ready-made room and the people in it, or practises on their own topic, then practises as in step 1, with every character's line under that character's own name and face. Your server keeps the key; the page talks only to your server.

## You need

- A developer workspace with the Conversations API added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key and assignment id in .env
npm start
```

Open http://localhost:3000. The picker opens on **A ready-made room**, with "Direct Feedback To A Report" and its recommended people ticked. Press **Start practice**, then answer, for example "I wanted to talk about the last two reports. They came in after the deadline, and I'd like to understand what's getting in the way."

Then press **New practice**, pick a room, tick your own people, and answer again. Or choose **Open practice**, give a topic if you like, choose **One-on-one** (one person) or **A room** (two to five people), and tick the people.

## What you should see

- The picker: **Room** lists every room by its title, grouped under its category. The room's description, its **Mode** (guided first), and a checkbox for every person, by name and role. Choosing a room ticks its recommended people; anyone may join any room, within its seats. The picker says the limit in words, for example "This room seats 1 to 2 people."
- A start refused, in plain words, when the people ticked are outside the limit. If the Conversations API refuses a setup, a short message, and the picker stays as it was.
- The practice: the room's title (or "Open practice" and the topic), the names of the people in it, and the opening.
- Each speaker's line under their own name, with their face beside it. With several people in the room, more than one may answer in a turn.
- With each reply, the Coach's note in its own panel, the safety status and the receipt: `1 text turn · $0.03 · settled` and the request id.
- A new line in `receipts.jsonl` for each confirmed turn, each opening included.

## How it works

| File | What it does |
| --- | --- |
| `server.ts` | Serves the page and gives each new browser a pseudonymous user id in a cookie. `/api/state` reads the catalog (no charge) and sends the picker: rooms that need no topic consent, by title and category, the people, the modes by label. `/api/start` checks the choice against the same limits, prepares one session (no charge) and requests its opening, once. `/api/turn` relays each message as a turn. `/api/new` goes back to the picker; the earlier session stays as it was. |
| `conversations.ts` | Step 1's client, plus the catalog's categories and modes, and `prepareOpen` for open practice next to `prepareRoom`. An error that the API itself reports (an error status, or an error event before `done`) is marked as not committed. |
| `public/` | The picker and the practice page. Each reply shows every character's line under their name, with the face that matches the line's speaker, the Coach in its own panel, and the safety status and receipt apart from the conversation. |

**The limits.** A ready-made room seats from its `min_participants` to its `max_participants`. Open practice seats exactly one person for one-on-one, and two to five for a room; the topic is optional, up to 240 characters. The page and the server check the same limits, and no one is in a practice twice.

**Charges.** Preparing a practice adds no charge, and neither does a setup the API refuses. The opening and each message are billable text turns, at 3¢ per text turn, however many people are in the room.

**When a message doesn't go through.** If the Conversations API answers with an error status instead of an event stream, or an error event arrives before `done`, nothing was committed or charged: the page says so in a short sentence and puts your words back in the box, and sending it again is a new request with a new Idempotency-Key. If a turn's outcome is uncertain (the connection ends before `done`), the server looks it up with `GET /v1/requests/{id}` and reads the saved turn, instead of sending it again under a new key.

This step keeps sessions in memory: if the server restarts, a returning browser sees the picker again. It never ends a session.

**Your own faces.** Each character's face is drawn in code, in `public/faces.js`. To use your own artwork, put the images in `public/faces/` and write their addresses in the block marked **YOUR OWN ARTWORK GOES HERE**: one per mood, and if you like per expression or per character. Any mood you leave empty keeps the drawn face. The faces are the characters' simulated responses in this practice, never a reading of you.

The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/
