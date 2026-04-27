# SMS setup — fastest path to a working number (April 2026)

## Recommendation: Twilio Toll-Free

**Why this and not something else:**

| Option | Approval time | Cost | Throughput | API quality |
|---|---|---|---|---|
| **Twilio Toll-Free** ✅ | **1–3 days, can SEND immediately** | $2/mo + $0.0079/msg | 3 msg/sec | Excellent (REST + Node SDK) |
| Twilio A2P 10DLC | 10–15 days (you keep failing) | $4 brand + $10/mo campaign | 1 msg/sec | Same |
| Telnyx 10DLC | 7–10 days | Similar to Twilio | Same | Decent |
| Plivo 10DLC | 7–14 days | Similar | Same | Decent |
| Sakari / SMSmobileAPI shared pool | Instant | Pay-per-msg | Lower | OK |
| OpenPhone (Quo) | Instant for in-app, days for API | $19/mo + msg costs | OK | Limited API |

You already have a Twilio account, account-level credentials, and integrations wired (SalesRabbit, the Lindy specialized agents). **Toll-Free Verification is a much shorter form than A2P 10DLC** (≈10 questions vs ≈30+) and it's the path with the least friction since you're already on the platform.

**The critical thing**: Toll-free numbers can SEND messages the moment you buy them. Verification just improves deliverability with T-Mobile/Sprint over time. Your warm leads (form opt-in) on AT&T and Verizon will receive messages from day one.

## Step-by-step

### 1. Buy the number (5 min)

1. Log into [console.twilio.com](https://console.twilio.com)
2. Phone Numbers → Manage → **Buy a number**
3. **Filter**: Country = US, **Type = Toll-Free**, Capabilities = ✓ SMS, ✓ Voice (optional)
4. Pick any 833 / 844 / 855 / 866 / 877 / 888 number you like
5. Click **Buy** ($2/month)
6. Copy the new number — paste into `.env.hailey.template` as `TWILIO_TF_PHONE_NUMBER`

### 2. Grab Account SID + Auth Token (1 min)

1. Console home page → copy **Account SID** (starts with `AC...`)
2. Click "Show" on **Auth Token** → copy
3. Paste into `.env.hailey.template` as `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`

### 3. Submit Toll-Free Verification (10 min)

This is the form Twilio uses to vouch for you with the carriers. Much shorter than A2P.

1. Console → Messaging → Compliance → **Toll-Free Verification** → **Create new**
2. Pick the toll-free number you just bought
3. Fill in the form — here are the answers for **Just Hail**:

   | Field | Answer |
   |---|---|
   | Business name | Just Hail |
   | Business website | https://justhail.net |
   | Business address | 308 Hazelwood St Ste 1, Leander, TX 78641 |
   | Business contact email | info.justhail@gmail.com |
   | Business contact phone | (512) 221-3013 |
   | Use case category | **Customer Care** (or "Mixed" if available) |
   | Use case summary | Sending appointment confirmations, hail-damage inspection scheduling, and follow-up communications to customers who submit our online estimate request form at justhail.net. |
   | Production message volume | Estimate based on your real plan — pick the smallest tier you're confident covers it |
   | Opt-in flow type | **Web form** |
   | Opt-in details | Customers submit a contact form at justhail.net/#estimate. Form includes phone field and consent checkbox: "I agree to receive SMS updates about my hail damage inspection." Their phone number is added to our CRM and they may receive SMS from (737) 221-XXXX. |
   | Opt-in screenshot | Take a screenshot of justhail.net showing the contact form and consent text |
   | Production sample messages | Provide 2-3 examples like:<br>1. "Hi {first_name}, this is Charlie at Just Hail. Got your inspection request — I can swing by Tuesday at 2pm or Wednesday morning. Which works? Reply STOP to unsubscribe."<br>2. "Heads up — your free hail inspection is tomorrow at 10am. I'll be in a black F-250. — Charlie, Just Hail"<br>3. "Following up on the estimate I sent — any questions? Most folks pay $0 out of pocket after deductible waivers. Reply STOP to unsubscribe." |
   | Will you send marketing? | **No** (you said you only text after form submission — that's transactional/care, not marketing) |

4. **Submit**. Status goes to "Pending Review."
5. Approval typically lands in **1–3 business days**. You'll get an email.

### 4. Update your form's consent text (5 min, important)

For Toll-Free Verification to approve cleanly, your form needs an explicit SMS consent checkbox. I'll wire this — currently `form.jsx` doesn't have one. Add to my todo list and remind me when we get to Phase 2.

### 5. While verification is pending — you can already send

Once you have `TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_TF_PHONE_NUMBER` in env:

```bash
curl -X POST https://api.twilio.com/2010-04-01/Accounts/$TWILIO_ACCOUNT_SID/Messages.json \
  --data-urlencode "From=+18336420123" \
  --data-urlencode "To=+15122213013" \
  --data-urlencode "Body=Test from Hailey." \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN"
```

That should return a JSON message SID and your phone should ping within seconds.

## What about pre-approved shared-pool services?

Services like **Sakari**, **SMSmobileAPI**, **MessageCentral VerifyNow** offer "instant" SMS via shared sender pools that are already verified. Avoid for Just Hail because:

1. **Shared-pool reputation is fragile** — if another customer in your pool spams, you all get filtered
2. **You don't own the sending number** — you can't put it on business cards / receipts
3. **Two-way replies are messy** — replies route through their interface, not a number you own
4. **Volume caps** are tight — fine for OTPs, bad for outreach campaigns
5. **Migration cost later** — you'd switch to Twilio anyway once you scale; might as well start there

The toll-free path costs you 1–3 days for verification (during which you can still send) for a permanent owned-number solution.

## After approval

- Toll-free SMS deliverability goes from "good" to "excellent" across all carriers
- Throughput stays at 3 msg/sec (sufficient for ~10,000 messages/hour if needed)
- No re-verification needed unless you change use case dramatically

## What this means for our build

Hailey gets a `send_sms` tool that:
- Pulls `TWILIO_TF_PHONE_NUMBER` as the From
- Hits Twilio's REST API with creds from env
- Records every send in `sms_messages` table with status, MessageSID, deliverability tracking
- Auto-handles opt-out (STOP / UNSUB / CANCEL) and writes to `leads.opted_out`
- Respects TCPA quiet hours (defers to next allowed window if outside 8am-9pm recipient-local)
- Rate-limits to 3 msg/sec per Twilio's toll-free cap

The existing `lib/lindy.js` `callLead()` and friends keep using the original 10DLC voice number for calls (voice still works on 10DLC even without A2P). SMS shifts to the new toll-free.
