import { Module } from '@nestjs/common';
import { MAIL_TRANSPORT } from './mail-transport';
import { MailService } from './mail.service';

@Module({
  providers: [MailService, { provide: MAIL_TRANSPORT, useExisting: MailService }],
  exports: [MAIL_TRANSPORT],
})
export class MailModule {}
