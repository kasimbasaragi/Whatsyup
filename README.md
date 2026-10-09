# Whatsyup

A WhatsApp-style text messaging web app. Sign up with email + mobile number, find friends by their mobile number, and chat one-to-one. Installable on a phone as a PWA.

Hosting: GitHub Pages (free) for the website, Firebase free plan (Spark) for accounts and messages.

See the step-by-step hosting guide in the chat, or follow the short version below.

1. Create a Firebase project; enable Email/Password sign-in; create a Firestore database; paste `firestore.rules` into its Rules tab and Publish.
2. Copy your web app config into `firebase-config.js`.
3. Upload all files to a public GitHub repo; Settings > Pages > Deploy from branch `main` / root.
4. In Firebase > Authentication > Settings > Authorized domains, add `YOUR-USERNAME.github.io`.

## Limits
- Mobile numbers are not verified by SMS (that needs Firebase's paid plan).
- Messages are not end-to-end encrypted.
- No push notifications; messages appear live while the app is open.
- Text only: no images, groups or read receipts.
