# Interview practice

A recipe for career and job-search apps: the user practises a job interview in the ready-made room "Interview Practice", gets a debrief tied to their own answers, then practises again, the same or harder. The second debrief compares with the first. Built on steps 1 and 2 of the ladder.

## You need

- A developer workspace with the Conversations API added, and a server key from **My APIs**.
- Node 24 or later. No packages to install.

## Run it

```sh
cp .env.example .env        # then put your key and assignment id in .env
npm start
```

Open http://localhost:3000. The interviewer opens. Answer two or three questions, press **Finish**, read your debrief, then press **Practice again** or **Practice again, harder**.

## What you should see

- The interviewer's lines under their name, and the Coach's note in its own panel, with the safety status and the receipt.
- After **Finish**: the closing turn, then your debrief, each line linked to the answer it came from, and your next practice.
- After **Practice again**: a new interview (round 2). Harder sets the challenge to resistant: the interviewer holds their position and makes you earn any movement.
- In the second debrief, once there is an earlier practice to compare with: what was new this time.

## How it works

| File | What it does |
| --- | --- |
| `server.ts` | Step 2's server with the room "Interview Practice", the challenge set when each practice is prepared, and `/api/again`, which prepares a new session (no charge) and its opening. |
| `conversations.ts` | The same client as step 2. |
| `public/` | The interview page, the debrief, and the two Practice again buttons. |

Each interview costs its opening, each answer and its closeout, at 3¢ per text turn: three answers make five billable text turns, 15¢. Preparing a session and reading the debrief add no charge.

How the interviewer responded is how they were written to respond in this practice, never a reading of the person practising.

**Your own faces.** Each character's face is drawn in code, in `public/faces.js`. To use your own artwork, put the images in `public/faces/` and write their addresses in the block marked **YOUR OWN ARTWORK GOES HERE**: one per mood, and if you like per expression or per character. Any mood you leave empty keeps the drawn face. The faces are the characters' simulated responses, never a reading of the person practising.

The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/
