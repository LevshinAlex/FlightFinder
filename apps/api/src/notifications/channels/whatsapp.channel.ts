import { Injectable, Logger } from '@nestjs/common';
import { config } from '../../common/config';

/**
 * WhatsApp Business Platform (Cloud API). Version 1.1 module.
 * Regular outbound messages outside the 24h window MUST use a Meta-approved template.
 * The template is expected to have one body variable {{1}} = summary text.
 */
@Injectable()
export class WhatsAppChannel {
  private readonly log = new Logger(WhatsAppChannel.name);

  get enabled() {
    return config.whatsapp.enabled && !!config.whatsapp.accessToken && !!config.whatsapp.phoneNumberId;
  }

  async sendSummary(phoneE164: string, summary: string): Promise<string> {
    if (!this.enabled) throw new Error('WhatsApp channel is not configured');
    const to = phoneE164.replace(/[^\d]/g, '');
    const res = await fetch(`https://graph.facebook.com/v21.0/${config.whatsapp.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.whatsapp.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to, type: 'template',
        template: {
          name: config.whatsapp.templateName,
          language: { code: config.whatsapp.templateLang },
          // WhatsApp template params cannot contain newlines / >4 consecutive spaces
          components: [{ type: 'body', parameters: [{ type: 'text', text: summary.replace(/\n+/g, ' | ').slice(0, 1000) }] }],
        },
      }),
    });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`WhatsApp HTTP ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
    this.log.log(`WhatsApp sent to ***${to.slice(-4)}`);
    return json.messages?.[0]?.id;
  }
}
