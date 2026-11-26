import { Module } from '@nestjs/common';
import { DisabledMailTransport, MAIL_TRANSPORT } from './mail-transport';

@Module({
  providers: [{ provide: MAIL_TRANSPORT, useClass: DisabledMailTransport }],
  exports: [MAIL_TRANSPORT],
})
export class MailModule {}
