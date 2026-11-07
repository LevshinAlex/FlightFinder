import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../common/config';

export interface EmailMessage { to: string; subject: string; html: string; text: string }

@Injectable()
export class EmailChannel {
  private readonly log = new Logger(EmailChannel.name);

  /** Returns provider message id. Transport "console" just logs (development). */
  async send(m: EmailMessage): Promise<string> {
    if (config.email.transport === 'resend') {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.email.resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: config.email.from, to: [m.to], subject: m.subject, html: m.html, text: m.text }),
      });
      const json: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
      return json.id;
    }
    this.log.log(`\n===== EMAIL to ${m.to} =====\nSubject: ${m.subject}\n\n${m.text}\n===========================`);
    return `console-${Date.now()}`;
  }
}
