# moveMe backend — stress tests

Two Artillery scenarios targeting the exact concurrency risks flagged earlier:
job double-booking, and lost wallet writes under simultaneous top-ups.

## Setup (once)

```bash
cd backend
npm install                 # installs artillery as a dev dependency
npx prisma migrate dev      # if you haven't already
npm run dev                 # start the backend in one terminal, leave it running
```

Make sure `.env` has a real `JWT_SECRET` (not the placeholder) — the setup
scripts sign tokens directly using that same secret, bypassing the OTP flow
entirely so you don't have to read 25+ verification codes out of the console
by hand.

**Run these against a local/dev/staging database only.** They create real
throwaway users and jobs. Never point `DATABASE_URL` at production while
running these.

## Scenario 1 — many drivers accepting the same job at once

This is the exact bug that got fixed a few turns back: two drivers tapping
Accept within milliseconds of each other could both succeed, with the second
silently overwriting the first. This test proves it can't happen anymore.

```bash
npm run loadtest:race:setup     # creates 25 driver accounts + 1 open job
npm run loadtest:race:run       # fires all 25 at /jobs/:id/accept at once
npm run loadtest:race:verify    # checks the DB: exactly one winner, or fail
```

Watch the Artillery output live — you'll see one `✅ ... WON the job` line
and a wall of `409` lines for everyone else. The verify script then checks
the database directly (the real source of truth) and prints a clear PASS/FAIL.

Want to push harder? `node loadtest/setup-race-condition-test.js 100` creates
100 competing drivers instead of 25 — just also bump `arrivalCount` in
`race-condition.yml` to match.

## Scenario 2 — wallet top-up burst

Fires a sustained burst of concurrent top-ups (~15/sec for 20 seconds) —
80% spread across a pool of different accounts (tests raw throughput), 20%
all hitting one single shared account (tests that concurrent writes to the
*same* balance never get lost).

```bash
npm run loadtest:wallet:setup    # creates 50 accounts + 1 "hammered" account
npm run loadtest:wallet:run      # fires the burst via /wallet/topup/dev-instant
npm run loadtest:wallet:verify   # sums the hammered account's transactions vs its balance
```

If the verify script says the balance doesn't match the sum of its own
transaction log, that means concurrent requests overwrote each other instead
of adding up — worth knowing before real money is involved. (It should pass:
the wallet update uses Prisma's atomic `increment`, not a
read-then-write-back pattern — but this test proves that holds under real
concurrency instead of just trusting the code.)

Note: this only exercises `/wallet/topup/dev-instant`, the local-testing
route — not the real Flutterwave webhook path, since that would mean firing
real webhook calls at a real payment provider. If you want to load-test the
webhook handler itself, do it by directly POSTing signed test payloads to
`/webhooks/flutterwave` instead — ask me and I can build that scenario too.

## Being honest about what Artillery does and doesn't prove

Artillery's `arrivalCount` phase spreads virtual users across the stated
duration (1 second, in the race-condition scenario) — it's very fast, but
it's not mathematically instantaneous the way a single `Promise.all()` of
raw `fetch()` calls from one Node script would be. In practice this is close
enough to catch the race condition class of bug (and did, when this backend
still had the bug). If you ever want the strictest possible simultaneity
test, say so and I'll write a small standalone Node script using
`Promise.all()` instead of Artillery for that one specific case — Artillery
is still the right tool for realistic sustained load (scenario 2, and any
future "500 people booking rides during Friday evening rush" style test).
