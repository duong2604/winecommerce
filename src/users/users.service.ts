import { Prisma, User, UserStatus } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  //Find user by email
  async findByEmail(email: string): Promise<User | null> {
    return await this.prisma.user.findUnique({
      where: {
        email,
      },
    });
  }

  //Find user by id
  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    });
  }

  async create(dto: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: dto.email,
        password: dto.password,
        firstName: dto.firstName,
        lastName: dto.lastName,
      },
    });
  }

  async update(id: string, status: UserStatus): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data: { status },
    });
  }
}
