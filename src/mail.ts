// The magic-link sender. Mailgun when a Mailgun domain and key are configured
// (what the ezacto instances themselves send through); otherwise Cloudflare
// Email Sending on the account's verified domain.

export interface MailEnv {
  MAIL_FROM_ADDRESS: string;
  MAIL_FROM_NAME?: string;
  MAILGUN_DOMAIN?: string;
  MAILGUN_REGION?: string;
  MAILGUN_API_KEY?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
}

export interface Mail {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail(env: MailEnv, fromName: string, mail: Mail): Promise<void> {
  const from = { address: env.MAIL_FROM_ADDRESS, name: env.MAIL_FROM_NAME || fromName };
  if (env.MAILGUN_DOMAIN && env.MAILGUN_API_KEY) {
    const host = env.MAILGUN_REGION?.toLowerCase() === "eu" ? "api.eu.mailgun.net" : "api.mailgun.net";
    const form = new FormData();
    form.set("from", `${from.name} <${from.address}>`);
    form.set("to", mail.to);
    form.set("subject", mail.subject);
    form.set("html", mail.html);
    const response = await fetch(`https://${host}/v3/${env.MAILGUN_DOMAIN}/messages`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`api:${env.MAILGUN_API_KEY}`)}` },
      body: form,
    });
    if (!response.ok) throw new Error(`mailgun send failed: ${response.status} ${await response.text()}`);
    return;
  }

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [mail.to], subject: mail.subject, html: mail.html }),
    }
  );
  const result = (await response.json()) as Record<string, unknown>;
  if (!response.ok || result["success"] === false) {
    throw new Error(`email send failed: status=${response.status} ${JSON.stringify(result)}`);
  }
}
