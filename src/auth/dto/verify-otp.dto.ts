import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyOtpDto {
  @IsEmail({}, { message: 'Invalid email' })
  email: string;

  @IsString()
  @Length(6, 6, { message: 'Otp must be 6 characters' })
  otp: string;
}
