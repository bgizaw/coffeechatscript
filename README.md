# AutoCoffeeChat

Enter the role you applied for and the company. The app searches the web for the 2 best people to contact (the likely hiring manager, a recruiter, or someone already in the role), using public LinkedIn profiles and similar pages. To get their email addresses, it looks for real employee addresses posted publicly online (for example, PDFs found by searching `"@company.com" -site:company.com filetype:pdf`). From those it learns the company's format, such as `first.last` or `flast`, and uses it to predict each contact's address. The formats it learns are saved and listed on the site under **Email patterns**. AI then drafts an email for each one, loosely based on your template and personalized to that person. You review and edit each draft, press Send, and the email goes out from your Gmail. Every send is logged to a Google Sheet.

## Setup

1. **Environment variables** (Netlify → Project configuration → Environment variables):
   - `APP_PASSWORD`: the password that unlocks the app. This stops strangers from sending email as you.
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from a Google Cloud OAuth client (type "Web application").
2. **Google Cloud Console**:
   - Enable the **Gmail API** and the **Google Sheets API**.
   - On the OAuth consent screen, add yourself as a test user. While the app is in "Testing" mode, Google expires refresh tokens after 7 days, so you'll need to reconnect weekly unless you publish the app.
   - Add this authorized redirect URI: `https://<your-site>.netlify.app/api/auth/google/callback`
3. Open the site, unlock it, then go to **Settings**: connect Google and fill in your name, background, and email template.

Web search and AI run through Netlify AI Gateway, so no extra API keys are needed. A search takes 1–3 minutes. It runs in a background function while the page shows progress. Once a company's email format has been learned, it is reused for 90 days. If no public examples were found, the app tries again after 7 days. Until then it falls back to `first.last` and labels the address as an unverified guess. Predicted addresses can be edited before sending.
