# GHL Workflow Setup — "Just Hail Storm Cadence"

**Read this after clicking "Push to GHL" from admin the first time.** We push leads with tags; your workflows in GHL listen for those tags and fire cadences. You build this ONCE in the GHL UI — from then on every storm is a one-click push.

## Prerequisites

- GHL Private Integration Token set in Vercel env as `GHL_PRIVATE_TOKEN` ✓ (already done)
- Location ID set as `GHL_LOCATION_ID` ✓ (already done)
- Your Just Hail sub-account accessible at https://app.gohighlevel.com

## Tags our admin pushes

Every contact we push gets these tags automatically:

- `just-hail` — everything we send
- `campaign-{id}` — the specific Just Hail campaign (e.g. `campaign-7`)
- `src-ihm_territory` — came from an IHM polygon pull
- `jh-new-lead` — **the trigger tag for your workflow**

## Pipeline: "Hail Restoration"

**In GHL:** `Pipelines → + Add Pipeline`. Name it `Hail Restoration`. Stages (in order):

1. `New Lead` — just pushed from admin
2. `Contacted` — email/RVM/SMS has fired
3. `Engaged` — reply received, opened multiple emails, or picked up RVM callback
4. `Booked` — estimate appointment scheduled
5. `Estimated` — we've been on-site
6. `Claim Pending` — insurance filed
7. `In Shop` — repair in progress
8. `Won` — paid, closed
9. `Lost` — no sale

## Workflow: "Storm Cadence v1"

**In GHL:** `Automation → Workflows → + Create Workflow → Blank`. Name it `Storm Cadence v1`.

### Trigger
- **Contact Tag Added**
- Tag equals: `jh-new-lead`

### Actions (in sequence — drag-drop in order)

#### 1. Move contact to pipeline stage
- Action: `Update Opportunity` (if not in pipeline, create one)
- Pipeline: `Hail Restoration`
- Stage: `New Lead`

#### 2. Wait 30 minutes
Batch pushes should finish within 30 min; gives you time to click "Send email" on approved drafts.

#### 3. Wait until `9:00 AM local time`
- Use: `Wait Until Event > Specific Time`
- If adding after 9 AM, fires next morning. Prevents 3 AM emails to homeowners.

#### 4. Internal notification to you
- Action: `Send Internal Notification`
- To: you
- Subject: `NEW BATCH — {{contact.last_name}} et al from {{contact.tags}}`
- Body: `Check Just Hail admin to review + send email drafts for this batch.`

#### 5. Wait 2 days

#### 6. **If no reply** — RVM drop (Day 2)
- Condition branch: `If/Else → Contact has NOT replied to any email/SMS in last 30 days`
- On YES branch:
  - Action: `Send Voicemail` (via LeadConnector RVM)
  - Audio file: pre-recorded 30-sec Charlie voicemail (record this in GHL's voice studio)
- On NO branch: exit workflow — they already engaged.

#### 7. Wait 3 days

#### 8. **If still no engagement** — follow-up email (Day 5)
- Condition: no opportunity stage advance
- Action: `Send Email`
- Subject: `Still around?`
- Body: short, 2 lines, checking in

#### 9. Wait 7 days

#### 10. **Exit** — tag as `cold-no-response`, remove from active workflow

### For contacts who DO reply at any stage

Create a **separate** workflow: `Storm Cadence — Engagement`

**Trigger:** Email Reply Received OR SMS Reply Received
**Actions:**
- Move opportunity to stage: `Engaged`
- Remove tag: `jh-new-lead` (so they drop out of the cold sequence)
- Add tag: `jh-replied`
- Internal notification to you: `Hot reply from {{contact.name}} — respond within the hour!`

## SMS — use SlyText (not GHL's built-in)

Keep SMS out of this GHL workflow. Send SMS via SlyText only AFTER a lead is tagged `jh-replied` (implied consent = TCPA-safe). We'll wire this up in a later session once 10DLC is approved.

## Testing your workflow

1. From Just Hail admin, push a test campaign with 1–2 leads to GHL
2. In GHL: `Contacts` → find them → confirm tag `jh-new-lead` is applied
3. In GHL: `Automation → Workflows → Storm Cadence v1 → Enrolled contacts` — you should see them enrolling
4. Fast-forward through the wait steps in GHL's test mode to see each action fire without waiting real days

## When it's working

Every storm:
1. Open Just Hail admin
2. Paste IHM territory URL + note
3. Review + approve email drafts
4. Click "Push to GHL" on the campaign
5. Go to sleep

GHL does the rest on the timing you configured. You only step in when someone replies (alerted via notification), at which point it's a booking conversation, not cold outreach.
