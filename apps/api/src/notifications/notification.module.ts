import { Module } from '@nestjs/common';
import { SearchModule } from '../search/search.module';
import { EmailChannel } from './channels/email.channel';
import { WhatsAppChannel } from './channels/whatsapp.channel';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';

@Module({
  imports: [SearchModule],
  controllers: [NotificationController],
  providers: [NotificationService, EmailChannel, WhatsAppChannel],
  exports: [NotificationService],
})
export class NotificationModule {}
