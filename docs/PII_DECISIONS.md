# PII decisions — runner data

Recorded decisions (not defaults) about runner personal data. Both were flagged during the
2026-07-22 vehicle-snapshot / profile-log review as choices that must be deliberate.

## 1. Runner phone exposure on the customer driver card

**Decision: EXPOSED — accepted for the current context.** When a runner claims a delivery, the
customer's tracking view shows a driver card with the runner's name and a **Call** button wired
to the runner's real contact number (`Runner.phone`).

- **Why it's acceptable now:** FairSynq runs small, single-fair events with a known, admin-approved
  runner roster. Direct contact is useful (customer + runner coordinating a handoff on the
  fairgrounds) and the trust context is high.
- **The risk being accepted:** the customer sees the runner's real number. Delivery platforms at
  scale mask this (relay/proxy numbers) because at scale runners are strangers to customers and
  number exposure enables harassment.
- **The trigger to revisit:** if the platform scales to at-scale or unknown runners, introduce a
  relay/proxy number (Twilio-style) so neither party sees the other's real number. Masking is the
  industry norm for a reason; we are choosing not to build it yet, not forgetting to.
- **Scope:** the number is shown only while a runner is actively assigned; the order route returns
  `Runner.phone` and nothing else identifying from the runner row.

## 2. Runner profile-change log retention

**Decision: 180 days after the runner's event ends, ENFORCED (not promised).**
`RunnerProfileChange` is an append-only audit of edits to a runner's phone + vehicle fields
(old → new). It is PII-bearing.

- **Enforcement:** reconciler **Pattern W** (`lib/runner-profile-log.ts →
  purgeExpiredProfileChanges`) deletes rows whose runner's event ended more than 180 days ago.
  The deleter ships with the schema comment, so the retention label has a reader — not a promise
  with nothing behind it.
- **Currently dormant:** no event has yet ended 180 days ago (oldest event ended 2026-06-07), so
  the sweep purges nothing today. It activates as data ages past the window.
- **Not covered here:** the per-order vehicle **snapshot** (`Order.runnerVehicle*`) is part of the
  order record (what car delivered which order) and persists with the order, not on this schedule.
  Runner **license documents** are versioned separately by the replace-upload flow.
