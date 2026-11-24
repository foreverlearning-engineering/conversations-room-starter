// Team Desk: a small sample product, a manager's view of their one-to-ones. It is the starting
// point of the Embed recipe. Here, finished: its "Practice the conversation" panel holds a practice
// room from the Conversations API, served by one route file (practice-route.ts).
// Node 24+, no packages. Start it with: npm start
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { handlePractice } from './practice-route.ts';

const PORT = Number(process.env.PORT ?? 3000);
const PUBLIC = join(import.meta.dirname, 'public');
const FILES: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

// The product's own data. In a real product this comes from its database.
const ONE_TO_ONES = [
  { id: 'jon', name: 'Jon', when: 'Wednesday, 10:00', topic: 'Missed deadlines on the weekly report' },
  { id: 'maria', name: 'Maria', when: 'Thursday, 14:30', topic: 'Next quarter goals' },
  { id: 'kai', name: 'Kai', when: 'Friday, 09:00', topic: 'Onboarding check-in' },
];

const server = createServer(async (request, response) => {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  try {
    if (await handlePractice(request, response)) return;
    if (request.method === 'GET' && request.url === '/api/one-to-ones') {
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify(ONE_TO_ONES));
      return;
    }
    const file = request.method === 'GET' ? FILES[(request.url ?? '/').split('?')[0]] : undefined;
    if (!file) {
      response.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(join(PUBLIC, file));
    response.writeHead(200, { 'Content-Type': TYPES[file.split('.').pop()!], 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    if (!response.headersSent) response.writeHead(500).end('Server error');
    console.error(error);
  }
});

server.listen(PORT, '127.0.0.1', () => console.log('Team Desk is running at http://localhost:' + PORT));
