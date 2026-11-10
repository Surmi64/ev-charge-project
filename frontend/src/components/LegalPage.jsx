import React from 'react';
import { Alert, Box, Link, Paper, Stack, Typography } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

/**
 * Terms, privacy notice and imprint — public pages, reachable signed in or not.
 *
 * DRAFTS. They describe what the code actually does with data (checked against the
 * schema and the workers), but they have not been reviewed by a lawyer, and the
 * bracketed placeholders — operator, address, processors — have to be filled before
 * the service is offered to the public. Bump TERMS_VERSION in
 * backend/account_lifecycle.py whenever the terms text changes.
 */

const TODO = ({ children }) => (
  <Box component="span" sx={{ bgcolor: 'warning.main', color: 'warning.contrastText', px: 0.5, borderRadius: 0.5, fontWeight: 600 }}>
    [{children}]
  </Box>
);

const Section = ({ title, children }) => (
  <Box component="section" sx={{ mt: 3 }}>
    <Typography variant="h6" component="h2" fontWeight={700} gutterBottom>{title}</Typography>
    <Stack spacing={1.25} sx={{ '& p': { m: 0 }, '& ul': { m: 0, pl: 3 } }}>{children}</Stack>
  </Box>
);

const TERMS = {
  title: 'Terms of service',
  body: (
    <>
      <Section title="1. The service">
        <p>
          Mileage is an online tool for recording and analysing what vehicles cost to run:
          charging, fuel, insurance, tax, maintenance and other costs. It is operated
          by <TODO>operator name, registered address, company / tax number</TODO> (&quot;we&quot;).
        </p>
      </Section>
      <Section title="2. Your account">
        <p>
          You need an account to use Mileage. Keep your password to yourself; you are
          responsible for what happens under your account. You must be at least 16 years old.
        </p>
      </Section>
      <Section title="3. Trial, plans and payment">
        <p>
          New accounts get a free trial (currently 30 days). After it, recording new
          entries needs a paid plan: EUR 5 a month or EUR 50 a year, including VAT where
          applicable. Plans renew until cancelled; a cancelled plan stays active to the
          end of the period already paid.
        </p>
        <p>
          When a trial or plan ends, your records stay readable and exportable. Nothing
          is deleted because a plan lapsed.
        </p>
        <p>
          As a consumer in the EU you may withdraw from a paid plan within 14 days of
          buying it, for a refund. <TODO>payment provider and how refunds are requested</TODO>
        </p>
      </Section>
      <Section title="4. Your data">
        <p>
          What you record stays yours. We use it only to run the service for you, as the
          privacy notice describes. You can export all of it at any time from your account
          page, and delete your account there too.
        </p>
      </Section>
      <Section title="5. Acceptable use">
        <p>
          Do not use Mileage to break the law, to attack or overload the service, to
          access other people&apos;s accounts, or to send notification emails to people who
          did not agree to receive them.
        </p>
      </Section>
      <Section title="6. Availability and figures">
        <p>
          We work to keep Mileage available and correct, but cannot promise it will never
          be interrupted. Forecasts, comparisons and averages are estimates from the data
          you entered; they are not financial advice.
        </p>
        <p>
          Our liability is limited to the fees you paid in the 12 months before the claim,
          except where the law does not allow such a limit.
        </p>
      </Section>
      <Section title="7. Ending the contract">
        <p>
          You can delete your account at any time. Deletion takes effect 30 days after you
          request it, so a mistake can be undone by signing in. We may close an account
          that seriously breaches these terms, after notice where possible.
        </p>
      </Section>
      <Section title="8. Complaints">
        <p>
          Send complaints through Feedback in the app (choose &quot;Complaint&quot;). We answer in
          writing within 30 days. If we cannot resolve it, you may turn to the conciliation
          body competent for your place of residence <TODO>competent conciliation body</TODO> or
          the EU online dispute resolution platform.
        </p>
      </Section>
      <Section title="9. Changes and law">
        <p>
          We will tell you by email at least 30 days before material changes to these
          terms. Hungarian law applies, without taking away the protection the law of your
          own country gives you as a consumer.
        </p>
      </Section>
    </>
  ),
};

const PRIVACY = {
  title: 'Privacy notice',
  body: (
    <>
      <Section title="Who is responsible">
        <p>
          The controller of your data is <TODO>operator name, address, contact email</TODO>.
        </p>
      </Section>
      <Section title="What we process, and why">
        <ul>
          <li><strong>Account</strong> — name, email address, password (stored only as a one-way hash), settings. To provide the service you signed up for (contract).</li>
          <li><strong>Your records</strong> — vehicles, charging and fuel records, costs, odometer readings, recurring costs. Contract.</li>
          <li><strong>Locations</strong> — only if you capture one when recording: the coordinates and the place names you choose. Contract; entirely optional.</li>
          <li><strong>Notification recipients</strong> — the addresses you ask us to email about new records. Each one confirms before receiving anything, and can unsubscribe from any message.</li>
          <li><strong>Feedback and complaints</strong> — what you send us and our answers.</li>
          <li><strong>Security data</strong> — sign-in history with IP addresses, the devices you are signed in on. Our legitimate interest in keeping accounts safe.</li>
        </ul>
        <p>We do not sell data, show ads, or use tracking or advertising cookies.</p>
      </Section>
      <Section title="Who else handles it">
        <ul>
          <li>Hosting: <TODO>hosting provider, country</TODO></li>
          <li>Email delivery: <TODO>email provider</TODO></li>
          <li>Payments: <TODO>payment provider</TODO> — card details go to them, never to us.</li>
          <li>Map: tiles are loaded from OpenStreetMap, which sees your IP address when you view a map. <TODO>tile provider if changed</TODO></li>
        </ul>
      </Section>
      <Section title="How long we keep it">
        <ul>
          <li>Account and records: until you delete the account, then 30 days.</li>
          <li>Complaints and our answers: kept after account deletion for <TODO>retention period required by law</TODO>.</li>
          <li>Sign-in history: 12 months. Sent-mail log: 90 days.</li>
          <li>Invoices: as long as accounting law requires.</li>
        </ul>
      </Section>
      <Section title="Your rights">
        <p>
          You can see, correct and export all your data, and delete your account, from the
          account page. You may also object to processing, ask us to restrict it, or ask
          questions through Feedback in the app.
        </p>
        <p>
          You may complain to the Hungarian data protection authority (NAIH, naih.hu) or the
          authority of your own country.
        </p>
      </Section>
      <Section title="Storage in your browser">
        <p>
          Mileage keeps your sign-in tokens and a few display preferences in your browser&apos;s
          local storage. They are needed for the service to work; there are no tracking
          cookies, so there is nothing to consent to.
        </p>
      </Section>
    </>
  ),
};

const IMPRINT = {
  title: 'Imprint',
  body: (
    <>
      <Section title="Operator">
        <p><TODO>name / company name</TODO></p>
        <p><TODO>registered address</TODO></p>
        <p><TODO>company registration number, tax number</TODO></p>
        <p>Contact: <TODO>email address</TODO>, or Feedback in the app.</p>
      </Section>
      <Section title="Hosting">
        <p><TODO>hosting provider name and address</TODO></p>
      </Section>
    </>
  ),
};

const DOCUMENTS = { terms: TERMS, privacy: PRIVACY, imprint: IMPRINT };

const LegalPage = ({ document }) => {
  const doc = DOCUMENTS[document];
  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', px: 2, py: { xs: 3, sm: 6 } }}>
      <Paper sx={{ maxWidth: 760, mx: 'auto', p: { xs: 2.5, sm: 4 }, borderRadius: 4 }}>
        <Link component={RouterLink} to="/" underline="hover" sx={{ fontWeight: 600, fontSize: '0.9rem' }}>
          ← Mileage
        </Link>
        <Typography variant="h4" component="h1" fontWeight={800} sx={{ mt: 2, mb: 1 }}>{doc.title}</Typography>
        <Alert severity="warning" sx={{ mb: 1 }}>
          Draft. This text has not been reviewed by a lawyer yet, and the highlighted parts
          still have to be filled in.
        </Alert>
        {doc.body}
        <Stack direction="row" spacing={2} sx={{ mt: 4, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          {Object.entries(DOCUMENTS).map(([key, item]) => (
            <Link key={key} component={RouterLink} to={`/${key}`} underline="hover" variant="body2">{item.title}</Link>
          ))}
        </Stack>
      </Paper>
    </Box>
  );
};

export default LegalPage;
