import { UserStatus } from '@generated/prisma/enums';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcrypt';
import { Response } from 'express';
import { UsersService } from '../users/users.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/access-token.strategy';
import { JwtService } from '@nestjs/jwt';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import { RegisterDto } from './dto/register.dto';
import { MailService } from '../mail/mail.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  private async generateTokens(userId: string, email: string) {
    const payload: JwtPayload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_EXPIRES_IN'),
      }),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, refreshToken: string) {
    const ttlSeconds = 7 * 24 * 60 * 60;
    await this.redis.set(`refresh:${userId}`, refreshToken, 'EX', ttlSeconds);
  }

  async register(dto: RegisterDto) {
    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email has been taken!');
    }

    const SALT_ROUND = 10;
    const hashedPassword = await bcrypt.hash(dto.password, SALT_ROUND);

    const user = await this.userService.create({
      email: dto.email,
      password: hashedPassword,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });

    const otp = this.generateOtp();

    const otpTtl = parseInt(this.config.get('OTP_EXPIRES_IN') ?? '300', 10);
    await this.redis.set(`otp:${dto.email}`, otp, 'EX', otpTtl);

    await this.mailService.sendOtpEmail(dto.email, otp);
    return {
      message: 'Register successfully! Please check your email!',
      email: user.email,
    };
  }

  async login(dto: LoginDto, res: Response) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Email or password is not exact');
    }
    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Email or password is not exact');
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new ForbiddenException('Please verify your email before log in');
    }
    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Your account was locked!');
    }

    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      user.email,
    );
    await this.saveRefreshToken(user.id, refreshToken);

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { accessToken };
  }
}
