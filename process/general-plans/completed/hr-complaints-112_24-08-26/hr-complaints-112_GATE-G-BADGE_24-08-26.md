---
name: manual-test:hr-complaints-112-badge
description: "Gate G — live verification of the Inquiries sidebar count badge (Section G), the one part of #112 that shipped after Gate E passed and has no rendering test"
date: 24-08-26
feature: hr-complaints-112
branch: feat/hr-complaints-112
---

# Gate G — Inquiries badge, live verification (#112 Section G)

**Why this exists.** The badge landed in `0cc3842`, *after* Gate E passed. `countWaitingInquiries`
has five unit tests and 6/6 mutations RED, so the **number** is proven. The **rendering** is not:
there is no component harness for `+layout.svelte`, so nothing anywhere asserts that the pill draws,
that it draws on the right nav item, or that it disappears at zero. This script is the only proof of
that, and it is the last open item on #112.

**What the badge is supposed to say.** `countWaitingInquiries`
(`src/lib/server/services/complaints/index.ts`) sums two arms that cannot overlap, because a thread
holds exactly one status:

- **`MANAGE_HR` arm** — threads at **RESPONDED** among the actor's visible employees. The employee
  has replied; it is HR's turn.
- **subject arm** — threads at **OPEN** where the actor *is* the subject. HR asked; it is your turn.

So an inquiry is counted by exactly one side at a time, and it **switches sides** when the status
flips. That switch is what this script drives.

**Zero renders nothing.** The markup is `{#if item.badge}` (`+layout.svelte:599`), so a count of 0
draws no pill at all — correct, not a bug. Every step below that checks for an absent pill therefore
**also** asserts the `Inquiries` label is on screen, so a broken sidebar cannot pass as a zero.

---

## Preconditions

| # | Command | Expected |
|---|---|---|
| P1 | `git switch feat/hr-complaints-112` | already there; tree clean at `29bae6c` |
| P2 | `./start.sh` | `veent-db-5434 Up` |
| P3 | `pnpm db:push` | schema applied — **this machine has never had the complaints tables** |
| P4 | `docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c "\dt hr_complaint*"` | `hr_complaints` and `hr_complaint_messages` both listed |
| P5 | `docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris -c "select email from users where email in ('admin@veent.ph','employee@veent.ph');"` | both rows present. If either is missing run `pnpm db:seed:e2e` — **never** `pnpm db:seed`, which runs `seedProd` only and creates neither |
| P6 | `pnpm dev` | http://localhost:5173 responds |

Cast (unchanged from Gate E):

```
EMP-001  System Admin      admin@veent.ph      SUPER_ADMIN      <- holds MANAGE_HR, org-wide
EMP-004  Elena Employee    employee@veent.ph   PAYROLL_OFFICER  <- no MANAGE_HR; subject arm only
```

---

## Baseline

**1.** Sign in as **System Admin** (`admin@veent.ph`) through the dev login switcher.

> **Assert** the sidebar shows a link labelled exactly **Inquiries**, and that it carries **no**
> pill beside the label.
>
> The label is the positive control. Without it, "no pill" only means the sidebar failed to draw.

**2.** Confirm the baseline is a real zero, not a stale page:

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris \
  -c "select status, count(*) from hr_complaints group by status;"
```

> **Assert** no `RESPONDED` row exists. If one does, the later counts shift by that amount — note
> the number and add it to every expected count below.

---

## The badge appears for the subject

**3.** Still as Admin: click **Inquiries**, open the new-inquiry form, select **Elena Employee**,
subject `BADGE-PROBE-112`, category **Other**, message `badge probe`. Submit.

> **Assert** the flash reads **Inquiry opened.** and the row appears at status **Open**.

**4.** Reload any app page, still as Admin.

> **Assert** the **Inquiries** label is present and still carries **no pill**.
>
> This is the sharp negative. The thread exists and Admin opened it, but it is at `OPEN` and Admin
> is not the subject, so neither arm counts it. A badge here would mean the arms are matching on
> the wrong status — the exact way a naive "count my threads" implementation fails.

**5.** Switch to **Elena** (`employee@veent.ph`).

> **Assert** the **Inquiries** link now carries a pill reading exactly **1**.
>
> Inspect it: the element's `aria-label` must read **`1 waiting on you`**. That attribute is what a
> screen-reader user gets, and nothing automated checks it.

---

## The badge changes sides

**6.** As Elena, open the `BADGE-PROBE-112` thread and post a reply `elena reply`.

> **Assert** the reply appears in the thread **and** the status now reads **Responded**.

**7.** Navigate to any other page (or reload) so the layout load re-runs.

> **Assert** the **Inquiries** label is present and the pill is **gone**.
>
> The thread did not disappear — it moved to HR's side. Elena's arm counts `OPEN` only.

**8.** Switch back to **System Admin**.

> **Assert** the **Inquiries** link carries a pill reading exactly **1**, `aria-label`
> **`1 waiting on you`**.
>
> Steps 5, 7 and 8 together are the whole point: the same single thread was counted by Elena, then
> by nobody, then by Admin, purely from its status. One arm firing for both sides, or both arms
> firing at once, would show `1 / 1 / 1` or `1 / 0 / 2` instead.

---

## The badge clears

**9.** As Admin, open the thread and click **Resolve**. Reload.

> **Assert** the thread reads **Resolved**, the **Inquiries** label is present, and the pill is
> **gone**. `RESOLVED` is owed by nobody.

---

## Cleanup

**10.**

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris \
  -c "delete from hr_complaints where subject = 'BADGE-PROBE-112';"
```

> **Assert `DELETE 1`.** The message rows go with it by cascade. Confirm:

```bash
docker exec veent-db-5434 psql -p 5434 -U veent -d veent_hris \
  -c "select count(*) as remaining from hr_complaint_messages;"
```

---

## Result log

*(to be filled in on the run — record the pill text seen at steps 1, 4, 5, 7, 8 and 9, and the
`DELETE` output at step 10)*

| Step | What it proves | Result | Evidence |
|---|---|---|---|
| 1 | Inquiries tab renders; zero draws no pill | | |
| 4 | An `OPEN` thread is not counted by its opener | | |
| 5 | Subject arm counts `OPEN`; pill and `aria-label` render | | |
| 7 | Subject arm stops counting at `RESPONDED` | | |
| 8 | `MANAGE_HR` arm counts `RESPONDED` | | |
| 9 | `RESOLVED` is counted by nobody | | |
| 10 | Cleanup, cascade took the messages | | |
