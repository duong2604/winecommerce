import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis => {
        return new Redis({
          host: config.get('REDIS_HOST'),
          port: config.get('REDIS_PORT'),
          password: config.get('REDIS_PASSWORD'),
        });
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
