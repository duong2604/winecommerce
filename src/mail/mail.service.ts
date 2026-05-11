import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
@Injectable()
export class MailService {
  constructor(private readonly mailerService: MailerService) {}

  async sendOtpEmail(email: string, otp: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'WineCommerce - OTP Code',
      template: './otp', // src/mail/templates/otp.hbs
      context: {
        otp,
        expiresIn: '5 minutes',
      },
    });
  }
}
