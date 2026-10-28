// SMS providers. Add a new provider by implementing `send(to, body)`.

function consoleProvider() {
  return {
    name: 'console',
    async send(to, body) {
      console.log(`\n[SMS → ${to}]\n${body}\n`);
    },
  };
}

function twilioProvider({ accountSid, authToken, from, messagingServiceSid }) {
  if (!accountSid || !authToken || (!from && !messagingServiceSid)) {
    throw new Error('Twilio SMS requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM (or TWILIO_MESSAGING_SERVICE_SID).');
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  return {
    name: 'twilio',
    async send(to, body) {
      const form = new URLSearchParams({ To: to, Body: body });
      if (messagingServiceSid) form.set('MessagingServiceSid', messagingServiceSid);
      else form.set('From', from);
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Twilio ${res.status}: ${text.slice(0, 300)}`);
      }
    },
  };
}

export function createSms(config, db) {
  const provider =
    config.sms.provider === 'twilio' ? twilioProvider(config.sms.twilio) : consoleProvider();

  // Verification codes are only kept readable in the local console mode (handy for development);
  // with a real provider they are masked so the log never holds a usable code.
  const logged = (body, kind) =>
    kind === 'otp' && provider.name !== 'console' ? body.replace(/\d{4,}/g, '••••••') : body;

  const log = db.prepare(
    'INSERT INTO sms_log (phone, kind, body, provider, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  return {
    provider: provider.name,
    /** Sends an SMS; never throws. Returns true on success. */
    async send(to, body, kind = 'info') {
      try {
        await provider.send(to, body);
        log.run(to, kind, logged(body, kind), provider.name, 'sent', null, Date.now());
        return true;
      } catch (err) {
        console.error('[sms] failed:', err.message);
        log.run(to, kind, logged(body, kind), provider.name, 'failed', err.message, Date.now());
        return false;
      }
    },
  };
}
