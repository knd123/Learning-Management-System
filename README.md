# Abugida Education — Learning Management System

A web app for Abugida Education's students (grades 3–12), mentors and team.

Everyone signs in on the same page and first picks **Student**, **Parent** or **Mentor** (the Abugida team uses the small "Abugida team? Sign in here" link). Signing in with the wrong role shows a clear message.

Every class is **1-on-1**: one mentor, one student.

| Who | What they can do |
| --- | --- |
| **Students** | **Create their own account** with an intake form (see below), then sign in with a **username**. See all their classes, the weekly schedule and each class link, and join with one tap (attendance is logged). After each class, a pop-up asks them to **rate the class** (1–5 stars) and say **what can be better for next class**. Hand in homework (text, photos, files, links) and see grades and feedback. Rewatch class recordings for **7 days** after each class. Take the **monthly quiz** under exam conditions (timed, webcam on) and follow their progress by skill. Update their subjects, availability and details under **My profile**. |
| **Parents** | **Sign up** with their child's full name exactly as on the student's profile. They can also ask to sign up siblings for **8% off per sibling**. Once the team approves, they get a read-only view of each child's schedule, attendance, homework, quiz results, progress charts and monthly reports. Class links and webcam photos are never shown to parents. |
| **Mentors** | **Apply online** (full name, academic level, subjects, weekly availability for each day, hours per week of bandwidth). They can be paired only after the team approves them. The dashboard shows **their students' profiles** (school, city, subjects, notes from the family) and **submitted homework**. They keep their subjects, grade range, weekly availability and weekly capacity up to date. They assign the class link and homework (optionally drafted by AI from the curriculum), submit the **post-class report** (date, duration, PowerPoint, homework, topics, attendance) and add the recording link after uploading to the student's Google Drive folder. **Email reminders 12h and 24h after class** keep coming until the recording is added. They see each student's **class ratings**, review homework, check monthly quizzes and their **proctoring record**, and upload or update each class's **curriculum once per quarter**. |
| **Abugida team (admins)** | **Approvals:** mentor applications, parent access requests (with the sibling-discount request) and **Starbucks gift cards**. Approve the **mentor pairings** suggested by the platform. See every mentor's subjects, grades, availability, remaining capacity and **average class rating**. Create logins and classes with weekly schedules. Read every curriculum (curricula are never shown to students). Review the **AI-written monthly parent reports** and the email log, and change settings. |

### Sign-up and mentor pairing

1. **A student signs up** at `/signup` (linked from the sign-in page). The 3-step form asks for:
   - **About the student:** full name, email, school name, city & state, grade.
   - **Tutoring needs:** subjects, hours of tutoring per week, availability for each day of the week, and additional notes (special needs).
   - **Parent and login:** the parent's phone and email, then a username and password.

   The student lands on their dashboard right away, with no mentor yet. The Abugida email, `info@abugidaeducation.com`, gets an email with all the details.
2. **The platform suggests mentors** for each subject under **Admin → Match requests**. Mentors are ranked by:
   - whether they teach the subject and the student's grade;
   - how much free time both share each week, after their existing classes, across timezones;
   - how much weekly capacity the mentor has left.

   A mentor who covers several of the requested subjects scores higher. The scarcest subject is planned first so suggested class times never collide. Proposed weekly class times are filled in for you.
3. **Nothing is final until an admin approves.** Approving creates the 1-on-1 class (it appears on both schedules), sends an in-app notification to the student and the mentor, and emails the student, the mentor and the parent.
4. **Students can change their subjects later** from **My profile**. `info@abugidaeducation.com` gets an email with the student's name and what they want to add or drop. New subjects go back into the pairing queue.

**Admin → Mentors** lists every mentor with their subjects, grade range, weekly availability and capacity (used / total hours), with filters by subject, grade and free capacity.

### Class ratings

After each class ends, the student sees a pop-up with two questions:

1. **How was your class?** — 1 to 5 stars.
2. **What can be better for next class?**

"Later" hides the pop-up until the next visit, and it never appears during a quiz. On submit, an email goes to the **mentor** and to **info@abugidaeducation.com**. Mentors see the rating on the class page, and admins see each mentor's average under **Admin → Mentors**.

### Parents

1. A parent signs up at `/signup/parent` (or "Parent" on the sign-in page) and types the student's full name.
2. **Admin → Approvals → Parent requests** shows the request with the matching student profile pre-selected. Badges say whether the name matches exactly and whether the parent's email is already on the student's profile.
3. If the parent asked to sign up siblings, the request shows each sibling's name and grade with **"8% off per sibling"**. The team contacts the family to enrol them. The discount itself is applied in your billing, outside this app.
4. On approval, the parent can follow the child, their email is added to the monthly report recipients, and they get an in-app notification and an email.

### Monthly quizzes under exam conditions

- **At most 10 questions**, written by the AI to be a little harder than homework. They focus on applying skills to new situations and multi-step reasoning, not recall.
- **One 30-minute sitting.** Before starting, the student turns on the webcam and agrees to the rules: work alone, with no AI tools, websites, notes or help. The quiz opens in full screen. The timer is measured on the server, so refreshing the page or changing the device clock doesn't add time. Answers are saved as the student goes, and when time runs out the quiz is handed in automatically with the saved answers.
- **Webcam proctoring.** A webcam photo is taken about once a minute. The app records when the student switches tab or app, leaves full screen, tries to copy or paste, turns the camera off or reloads the page. Where the browser has built-in face detection (only some Chrome versions today), it also records when no face, or more than one face, is in view. Mentors and admins see a **Clean / N flags** badge per student, and can open the photos and a timeline. Photos are deleted after **30 days** (configurable).
- Browser proctoring is a strong deterrent and leaves a record, but it can't see a second device off camera or prove misconduct. Treat flags as a reason to look and to talk to the student.

### Starbucks gift cards

When a student scores **above 90%** on the monthly quiz **two months in a row in the same class**, the platform creates a gift card request. It appears under **Admin → Approvals → Gift cards** and in an email to `info@abugidaeducation.com`, together with any proctoring flags from those two quizzes. Approving it congratulates the student in the app and emails the student and parents, with an optional message such as how the card will be delivered. Buying and sending the card happens outside the app. The threshold is a setting.

Time-based work runs automatically:

- **Recording reminders.** Mentors get an email 12 and 24 hours after each class whose recording is missing. The email links to the student's Drive folder and to the page where they paste the link.
- **Recording access.** Students see each recording in the app only for the viewing window (7 days by default). With Google Drive integration on, their Drive access to the file also expires.
- **Monthly quizzes.** On the 20th of each month (configurable), the AI builds a quiz for each class (up to 10 questions) from that month's homework, the topics in the class reports, and the curriculum. Quizzes can publish automatically or wait for the mentor to review. Quiz sittings left open are graded once their time is up.
- **Webcam photo clean-up.** Proctoring photos older than the retention period (30 days by default) are deleted.
- **Parent reports.** On the 1st of each month, a report is prepared for every student from attendance, homework and quiz results (the AI writes the text from the actual numbers) and emailed to the parents. In "review" mode it waits for the team to send it.
- **Curriculum window.** At the start of each quarter, mentors get an email that the curriculum window is open (14 days by default; admins can extend it).

---

## Run it on your computer

Requires Node.js 22+.

```bash
npm install
cp .env.example .env          # optional for local use
npm run seed:demo             # demo classes, homework, quizzes and reports
npm run dev                   # http://localhost:3000
```

Demo logins (pick the matching role on the sign-in page):

- **Team:** `admin / admin1234`.
- **Mentors:** `sara.bekele / mentor1234`, `daniel.haile / mentor1234`, `hana.girma / mentor1234`. `mekdes.alemu / mentor1234` has applied and is waiting for approval.
- **Students:** `abeba / abeba123`, `yonas / yonas123`, `liya / liya1234`, `meron / meron123`. `kalkidan / kalkidan1` and `nahom / nahom123` have just signed up and are waiting for a mentor (see Admin → Match requests).
- **Parents:** `hanna / parent1234` follows Abeba. `girma / parent1234` is waiting for approval and asked to sign up a sibling.

Abeba has a gift card waiting under Admin → Approvals, and the rating pop-up shows for each student's latest class.

Without SMTP settings, emails are not sent. They appear under **Admin → Emails** instead. Without a `GEMINI_API_KEY`, parent reports use a standard template and AI quiz and homework generation is turned off.

## Go live on Google Cloud

`deploy/gcp/deploy.sh` sets everything up in one run and is safe to re-run for updates:

- **Cloud Run** runs the app. It is built from the Dockerfile and scales to zero when idle, with at most 3 instances.
- **Firestore** is the database, with point-in-time recovery and daily backups kept for 14 days.
- **Cloud Storage** keeps uploaded files, closed to the public.
- **Secret Manager** keeps the session, scheduled-job and admin secrets, plus the email and Gemini keys if you give them.
- **Cloud Scheduler** calls the app every 10 minutes for reminders, quizzes and reports.
- **Your domain** is connected to the app.

The app runs as its own service account that can reach only its database, bucket and secrets.

**Once, in the Google Cloud console:**

1. Create a project (for example `abugida-lms`) and link a billing account to it.
2. IAM & Admin → Service accounts → Create a service account named `deployer` with the **Owner** role. Then open it → Keys → Add key → JSON, and download the key file.
3. In [Google Search Console](https://search.google.com/search-console), verify `abugidaeducation.com` if it isn't verified yet. Then go to Settings → Users and permissions and add the deployer's email (`deployer@<project>.iam.gserviceaccount.com`) as **Owner**. This lets the script connect `learn.abugidaeducation.com`.

**Run the script** from the repository:

```bash
GOOGLE_SA_KEY="$(cat deployer-key.json)" \
SMTP_APP_PASSWORD="<app password for info@abugidaeducation.com>" \
GEMINI_API_KEY="<Gemini API key>" \
./deploy/gcp/deploy.sh
```

The defaults are region `us-east4` (Virginia), domain `learn.abugidaeducation.com` and timezone `America/New_York`. Override them with `REGION=…`, `DOMAIN=…` or `ORG_TIMEZONE=…`. `DRY_RUN=1` prints every command without running it. The email password and Gemini key are optional and can be added on a later run.

**At the end**, the script prints:

- the app's `…run.app` address, which works right away;
- the DNS records to add at your domain registrar (HTTPS on your domain starts working up to a day later);
- where to find the admin password: Secret Manager → `lms-admin-password`. Change it after your first sign-in.

To ship a new version, run the script again. Cloud Run keeps earlier versions, so you can roll back from the console (Revisions → Manage traffic).

The app talks to Firestore and Cloud Storage only through the server. If you ever add Firebase to the project, publish `firestore.rules` and `storage.rules` so no browser can reach the data directly.

### Simpler alternative: one server with a disk

On any VM, Render, Railway or Fly.io instance with a persistent disk:

```bash
npm ci && npm run build
NODE_ENV=production DATA_BACKEND=file DATA_DIR=/var/lib/abugida SESSION_SECRET=... ADMIN_USERNAME=admin ADMIN_PASSWORD=... npm start
```

The built-in scheduler handles reminders, quizzes and reports (`INTERNAL_SCHEDULER=true`). Back up `DATA_DIR` daily. Run only **one** instance with this setup.

## First-day checklist

1. **Settings.**
   - Set the organization timezone (it defines month and quarter boundaries).
   - Check the **Abugida email** (`info@abugidaeducation.com`) and the list of **subjects offered** on the sign-up form.
   - Choose whether students, parents and mentors may sign up themselves, and whether parent reports are sent automatically or after review.
   - Check the sibling discount (8%), the quiz time limit (30 minutes), the gift card threshold (above 90%) and how long webcam photos are kept (30 days).
2. **Mentors.** Share `APP_URL/signup/mentor` with new mentors and approve them under **Approvals**, or add each mentor yourself with their email (for reminders and pairing emails), subjects, grade range, **weekly availability** and **weekly capacity in hours**. Mentors can also keep these up to date themselves under "Availability & subjects".
3. **Students.**
   - Share the sign-up link (`APP_URL/signup`) with families. Each sign-up shows up under **Match requests**, where you approve a mentor.
   - Or add students yourself under People → Students; they join the pairing queue too.
   - Add each student's **Google Drive folder** link (People → Student) so mentors know where to upload recordings.
4. **Parents.** Share `APP_URL/signup/parent`. Approve each request under **Approvals → Parent requests**, or add parents yourself under People → Parents.
5. **Mentors** sign in, add the class link for each new class, and upload the curriculum for each class. The Q4 window is open now. You can extend it in Settings, and a class's first curriculum can be uploaded at any time.
6. Send a **test email** from Admin → Emails to confirm SMTP works.
7. Check **Approvals** daily. The Overview page shows a banner when anything is waiting.

## Email setup

Abugida Education has one email address, **info@abugidaeducation.com**, and the app uses only that one:

- Every email the app sends comes from it (`EMAIL_FROM`), and replies go back to it.
- Every message that tells students, parents or mentors how to reach the team (forgotten passwords, closed sign-ups, parent access, pairing and report emails) shows it.
- Team notifications go to it: new sign-ups, subject changes, mentor applications, parent requests, class ratings and gift cards.

The address is set under **Settings → Abugida email**, which is pre-filled with `info@abugidaeducation.com`.

Any SMTP service can send the email:

- **Google Workspace.** For `info@abugidaeducation.com`, turn on 2-step verification, create an app password, and use `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=info@abugidaeducation.com`, `SMTP_PASS=<app password>`. Gmail limits sending to about 2,000 messages a day, which is plenty here.
- **SendGrid, Mailgun, Amazon SES, Resend.** Use their SMTP credentials with `info@abugidaeducation.com` as a verified sender. These are better for deliverability at scale.

## Google Drive integration (optional)

By default, mentors upload the recording to the student's Drive folder and paste the link into the app. The app shows it to the student for 7 days and then hides it.

To also expire students' **Drive** access automatically:

1. Set `GOOGLE_DRIVE_ENABLED=true`.
2. Share each student's Drive folder as **Editor** with the app's service account, `lms-runtime@<project>.iam.gserviceaccount.com` (created by the deploy script).
3. Add each student's Google account under People → Student → "Student's Google account".

When a mentor saves a recording link, those students get view access that expires at the end of the viewing window. A background job also removes it as a safety net.

## AI features

These use Google Gemini (`GEMINI_API_KEY`, model `GEMINI_MODEL`, default `gemini-flash-latest`):

- **Monthly quizzes** come from the month's homework, the class report topics and the curriculum. They have at most 10 multiple-choice questions, are a step harder than homework (applying skills, multi-step reasoning) while staying grade-appropriate, and are tagged by skill so progress can be tracked per skill. Mentors can edit any question before or after publishing until a student has taken the quiz.
- **Homework drafts.** The "Draft with AI" button on the homework form uses the curriculum and recent topics.
- **Parent reports.** The AI writes the summary, strengths, focus areas and suggestions *only from the computed numbers*. If AI is off or fails, a clear template is used, so reports are never blocked.
- **Curriculum PDFs.** If a mentor uploads only a PDF, the AI extracts an outline so quizzes can use it.

## Development

```bash
npm run dev         # API + React with hot reload on :3000
npm test            # API and unit tests (in-memory database)
npm run typecheck
npm run build       # → dist/client (React) + dist/server (API)
```

Run the same tests against Firestore with the [Firestore emulator](https://firebase.google.com/docs/emulator-suite):
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 TEST_STORE=firestore npm test`

```
server/            Express API (TypeScript)
  routes/          auth, student, parent, mentor, admin endpoints
  services/        schedules, recordings & reminders, quizzes & proctoring, rewards, feedback,
                   accounts (applications, parent access), reports, curricula, AI, email, Drive, jobs
  db/              storage layer: Firestore (production) or JSON file (local)
shared/            types and timezone helpers used by server and client
src/               React app (Vite + Tailwind)
tests/             node:test suites
```

Security notes:

- Passwords are hashed with scrypt.
- Sessions are HTTP-only, SameSite cookies, and every write needs a same-origin header.
- Students can only reach their own classes. Curricula and other students' work are never served to them.
- Parents see only the children the team linked to them, read-only, without class links. Webcam photos are served only to the class's mentor and the team.
- Quiz questions are sent only once the timed sitting starts, and answers only after it is handed in.
- Uploaded files are streamed through the API with permission checks.
- Login attempts are rate-limited.
