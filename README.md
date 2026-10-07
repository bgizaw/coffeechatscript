# AutoCoffeeChat

Enter the role you applied for and the company. The app finds the 2 best people to contact (the likely hiring manager, a recruiter, or someone already in the role) through Apollo.io. AI then drafts an email for each one, loosely based on your template and personalized to that person. You review and edit each draft, press Send, and the email goes out from your Gmail. Every send is logged to a Google Sheet.

## Setup

1. **Environment variables** (Netlify → Project configuration → Environment variables):
   - `APP_PASSWORD`: the password that unlocks the app. This stops strangers from sending email as you.
   - `APOLLO_API_KEY`: an Apollo API key (a master key, or one with access to `mixed_people/api_search`, `people/match`, and `mixed_companies/search`).
   - `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: from a Google Cloud OAuth client (type "Web application").
2. **Google Cloud Console**:
   - Enable the **Gmail API** and the **Google Sheets API**.
   - On the OAuth consent screen, add yourself as a test user. While the app is in "Testing" mode, Google expires refresh tokens after 7 days, so you'll need to reconnect weekly unless you publish the app.
   - Add this authorized redirect URI: `https://<your-site>.netlify.app/api/auth/google/callback`
3. Open the site, unlock it, then go to **Settings**: connect Google and fill in your name, background, and email template.

Apollo usage: people search is free. Revealing each email costs about 1 credit. Looking up a company by name costs 1 credit, which you can skip by entering the company's website.
