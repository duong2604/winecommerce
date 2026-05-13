import { UserStatus } from '@generated/prisma/enums';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import type { Response } from 'express';
import Redis from 'ioredis';
import { MailService } from '../mail/mail.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { UsersService } from '../users/users.service';
import { AccessRequest, RefreshRequest } from './auth.controller';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtPayload } from './strategies/access-token.strategy';

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

  async verifyOtp(dto: VerifyOtpDto) {
    const storedOtp = await this.redis.get(`otp:${dto.email}`);

    if (!storedOtp) {
      throw new BadRequestException('Your Otp expired or not existed!');
    }

    if (dto.otp !== storedOtp) {
      throw new BadRequestException('Your otp is not matched!');
    }

    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('User does not exist!');
    }

    await this.userService.update(user.id, UserStatus.ACTIVE);
    await this.redis.del(`otp:${dto.email}`);
    return {
      message: 'Verified successfully!',
    };
  }

  async login(dto: LoginDto, res: Response) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Your email or password is not exact!');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Your email or password is not exact!');
    }

    if (user.status === UserStatus.UNVERIFIED) {
      throw new ForbiddenException('Please verify  your account');
    }

    if (user.status === UserStatus.BANNED) {
      throw new ForbiddenException('Your account  was banned!');
    }

    const { accessToken, refreshToken } = await this.generateTokens(
      user.id,
      dto.email,
    );

    // Set refresh token to redis
    await this.saveRefreshToken(user.id, refreshToken);

    // Set cookies
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    };
  }

  async refreshTokens(req: RefreshRequest) {
    const userFromReq = req.user;
    if (!userFromReq) {
      throw new UnauthorizedException(
        'Your session expired, please login again!',
      );
    }

    const { sub: userId, refreshToken } = userFromReq;

    const storedToken = await this.redis.get(`refresh:${userId}`);
    if (!storedToken) {
      throw new UnauthorizedException(
        'Your session expired, please login again!',
      );
    }

    if (storedToken !== refreshToken) {
      throw new UnauthorizedException('Refresh token is invalid!');
    }

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User does not exist!');
    }

    const tokens = await this.generateTokens(userId, user.email);

    return { accessToken: tokens.accessToken };
  }

  async logout(req: AccessRequest, res: Response) {
    const userFromReq = req.user;
    if (!userFromReq) {
      throw new UnauthorizedException(
        'Your session expired, please login again!',
      );
    }
    await this.redis.del(`refresh:${userFromReq.id}`);

    res.clearCookie('refresh_token', {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 0,
    });
    return { message: 'You logged out!' };
  }
}
