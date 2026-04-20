# Google Sheets Integration — Setup Guide

Your form is wired to post every submission to a Google Sheet. Follow these steps **once** to connect it.

---

## Step 1 · Create the Sheet

1. Go to **[sheets.google.com](https://sheets.google.com)**
2. Click **Blank spreadsheet**
3. Rename it: **Online Web Form**

That's it — don't add column headers. The script does that automatically on the first submission.

---

## Step 2 · Add the Apps Script

1. In your sheet, click **Extensions → Apps Script**
2. Delete the placeholder `function myFunction() {}` in the editor
3. Copy the **entire contents of `apps-script.gs`** (in this project) and paste into the editor
4. Click the **💾 Save** icon (or `Ctrl/Cmd + S`) and name the project **Just Hail Form Handler**

---

## Step 3 · Deploy as a Web App

1. Click **Deploy → New deployment**
2. Click the ⚙️ gear icon next to "Select type" → choose **Web app**
3. Fill in:
   - **Description:** `Just Hail form handler v1`
   - **Execute as:** `Me (your@email.com)`
   - **Who has access:** `Anyone` ← required so the form can POST without auth
4. Click **Deploy**
5. Google will ask to **authorize** — approve the permissions (it only needs access to this one sheet)
6. **Copy the Web App URL** (looks like `https://script.google.com/macros/s/AKfycbxXXXXXX.../exec`)

---

## Step 4 · Paste the URL into the Form

Open `form.jsx` in this project. Near the top of `SmartForm`:

```jsx
const SHEET_ENDPOINT = '';
```

Paste your URL between the quotes:

```jsx
const SHEET_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxXXXXXX.../exec';
```

Save the file. Done.

---

## Step 5 · Test

1. Refresh the live site
2. Fill in the form with test data and submit
3. Open your Google Sheet — a new row should appear within ~2 seconds

**First submission:** the script creates the header row automatically.
**Every submission after:** a new row is appended.

---

## What each row contains

| Column | Source |
|---|---|
| Submitted At | Server timestamp |
| Reference # | `JH-XXXXXX` — also shown to customer |
| Name, Email, Phone, ZIP | Customer contact |
| Vehicle, Year | Vehicle info |
| Damage, Insurer | Claim details |
| Severity, Estimated Range | Slider value + auto-calculated price range |
| Timeline | asap / this-week / flexible |
| Notes | Free text |
| Source | Domain the form was submitted from |
| User Agent | Browser info (for spam filtering) |

---

## Troubleshooting

**Nothing appears in the sheet after submitting.**
- Check the browser console for errors (F12 → Console tab)
- Confirm the Web App URL ends in `/exec` (not `/dev`)
- Confirm **Who has access** is set to **Anyone**
- Re-deploy: sometimes permissions require a fresh deployment

**"Authorization required" error in Apps Script.**
- Open the script, click ▶️ Run, choose `doPost` — Google will prompt for permissions. Approve, then retry.

**I want email alerts on every submission.**
- Uncomment the `MailApp.sendEmail(...)` block inside `apps-script.gs` and fill in your address.

**I want Slack or SMS alerts.**
- After confirming the sheet works, tell me and I'll add a Zapier/webhook hook.
