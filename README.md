# conversations-room-starter

The sample repository for **Build with Conversations**: one folder per step and per recipe. Each folder is complete and runnable, with a README and an `.env.example` (never a real key), so you can start at any step.

| Folder | Step or recipe |
| --- | --- |
| `01-first-room` | Step 1: Your first practice room |
| `02-close-and-debrief` | Step 2: Close and debrief |
| `03-room-and-cast` | Step 3: Pick the room and the cast |
| `embed` | Recipe: Embed a practice room in your app (`embed/start` is the app before the practice room) |
| `interview` | Recipe: Interview practice |

More steps and recipes arrive as each one is verified against the release.

**Your own faces.** Each character's face is drawn in code, in each folder's `public/faces.js`. To use your own artwork, put the images in `public/faces/` and write their addresses in the block marked **YOUR OWN ARTWORK GOES HERE**: one per mood, and if you like per expression or per character. Any mood you leave empty keeps the drawn face. The faces are the characters' simulated responses, never a reading of the person practicing.

You need Node 24 or later, a developer workspace with the Conversations API added, a server key and its assignment id. The integration guide: https://developers.foreverlearning.ai/docs/conversation-practice/

Every opening, turn and closeout is a billable text turn, at 3¢ per text turn. Preparing a room and reading saved practice add no charge.

License: MIT (see LICENSE)

**Session closeout.** Ending is optional: opening the learner's next session closes the open one with one billable closeout (3 cents), the same as calling end yourself. Call end when you want the debrief right away. Do not call end just to start another practice.
