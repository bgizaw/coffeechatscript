# AutoCoffeeChat

Enter the role you applied for and the company. The app searches the web for the 2 best people to contact (the likely hiring manager, a recruiter, or someone already in the role), using public LinkedIn profiles and similar pages. To get their email addresses, it looks for real employee addresses posted publicly online (for example, PDFs found by searching `"@company.com" -site:company.com filetype:pdf`). From those it learns the company's format, such as `first.last` or `flast`, and uses it to predict each contact's address. The formats it learns are saved and listed on the site under **Email patterns**. AI then drafts an email for each one, loosely based on your template and personalized to that person. You review and edit each draft, choose which of your uploaded resumes to attach (or none), press Send, and the email goes out from your Gmail. Every send is logged to a Google Sheet.

## Accounts

Anyone signs in with their Google account. That one sign-in also grants permission to send from their Gmail and to log sends to a Google Sheet, so each person sends from their own address. Each account's profile, background, email template, resumes, drafts, history, and log sheet are saved to that account. Learned company email patterns are shared across accounts. Accounts can be deleted from Settings, which removes all of their data and revokes Google access.

## Contact priorities

The 2 contacts are chosen using a tiered priority list under **Settings → Who to contact first**. Tier 1 is shared affiliation (Pomona and the Claremont Colleges, MLT, Thrive Scholars, OBSA and other affinity networks). Tier 2 is a similar path (same major, recent grads, CS↔fashion moves, Houston/Texas roots). Tier 3 is role relevance (hiring manager, peers, recruiters, new hires, active posters). Tier 4 is signals that someone will reply (mentoring, talks, small teams, shared interests). There is also a list of people to penalize or skip, such as VPs and above at large companies, empty profiles, and company-wide aliases. Web searches look for people matching the Tier 1 and Tier 2 markers at the company, and candidates are ranked by the highest tier they match. At most one of the two picks is the hiring manager. Each draft shows the tier and markers that got the person picked. Edit the list to fit your own background, or clear it to restore the default.

## Resumes

Upload resumes (PDF, DOC, or DOCX, up to 4 MB each, 10 per account) under **Settings → Resumes**. Star one to pre-select it on new drafts. On each draft, the **Attach** menu picks which resume to send, or none. The file is attached to the Gmail message, and the outreach log and Google Sheet record which one was sent.

## Setup

1. **Environment variables** (Netlify → Project configuration → Environment variables):
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from a Google Cloud OAuth client (type "Web application").
   - `ALLOWED_EMAILS` (optional): comma-separated emails or `@domain.com` entries allowed to sign in. Leave unset to let any Google account sign in.
   - `APP_PASSWORD` is no longer used.
2. **Google Cloud Console**:
   - Enable the **Gmail API** and the **Google Sheets API**.
   - Add this authorized redirect URI: `https://<your-site>.netlify.app/api/auth/google/callback` (for this site, `https://autocoffeechat.netlify.app/api/auth/google/callback`). Every deploy, including deploy previews, signs in through this one callback, so you don't need to register preview URLs. To use a custom domain, register its callback instead and set `GOOGLE_REDIRECT_ORIGIN` to that domain (e.g. `https://coffeechat.example.com`).
   - OAuth consent screen: while the app is in "Testing" mode only listed test users can sign in, and Google expires their refresh tokens after 7 days. To let anyone sign in, publish the app. `gmail.send` and `spreadsheets` are sensitive scopes, so Google requires app verification (a privacy policy, homepage, and a short review) before unverified-app warnings go away.
3. Open the site, sign in with Google, then fill in your name, background, email template, and resumes in **Settings**.

If you used the app before Google sign-in, your existing profile, template, and history are moved to the first account that signs in with the Gmail address that was connected before.

Web search and AI run through Netlify AI Gateway, so no extra API keys are needed. A search takes 1–3 minutes. It runs in a background function while the page shows progress. Once a company's email format has been learned, it is reused for 90 days. If no public examples were found, the app tries again after 7 days. Until then it falls back to `first.last` and labels the address as an unverified guess. Predicted addresses can be edited before sending.
