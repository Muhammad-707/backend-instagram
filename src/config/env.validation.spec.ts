import { validateEnv } from './env.validation';

/** Конфиги пурраи дурусти прод — нуқтаи оғоз, ки тестҳо аз он каҷ мекунанд. */
const validProd = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://u:p@db.internal.example.com:5432/ig',
  REDIS_URL: 'rediss://cache.example.com:6379',
  APP_URL: 'https://api.example.com',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  S3_ENDPOINT: 's3.example.com',
  S3_USE_SSL: 'true',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
  S3_PUBLIC_URL: 'https://cdn.example.com/instagram',
  SMTP_HOST: 'smtp.gmail.com',
  LIVEKIT_URL: 'wss://x.livekit.cloud',
  LIVEKIT_API_KEY: 'key',
  LIVEKIT_API_SECRET: 'secret',
};

describe('validateEnv', () => {
  describe('production', () => {
    it('конфиги дурусти прод мегузарад', () => {
      expect(() => validateEnv(validProd)).not.toThrow();
    });

    // Маҳз ҳамин ҳолат прод-ро шикаста буд: env-и гумшуда → дефолти хомӯши
    // localhost → ҳар се сервис «down» бе ҳеҷ сабаб.
    it.each(['DATABASE_URL', 'REDIS_URL', 'S3_PUBLIC_URL', 'LIVEKIT_URL', 'APP_URL'])(
      '%s бо localhost дар прод стартро мешиканад',
      (key) => {
        const localhostValue: Record<string, string> = {
          DATABASE_URL: 'postgresql://u:p@localhost:5433/ig',
          REDIS_URL: 'redis://localhost:6379',
          S3_PUBLIC_URL: 'http://localhost:9000/instagram',
          LIVEKIT_URL: 'ws://localhost:7880',
          APP_URL: 'http://localhost:3000',
        };
        expect(() => validateEnv({ ...validProd, [key]: localhostValue[key] })).toThrow(/localhost/);
      },
    );

    it.each(['DATABASE_URL', 'JWT_SECRET', 'S3_ACCESS_KEY', 'LIVEKIT_API_KEY'])(
      'набудани %s дар прод стартро мешиканад',
      (key) => {
        const { [key]: _omitted, ...withoutKey } = validProd as Record<string, string>;
        expect(() => validateEnv(withoutKey)).toThrow(new RegExp(key));
      },
    );

    it('хатогӣ ҳамаи env-и гумшударо якбора рӯйхат мекунад, на танҳо якумашро', () => {
      expect(() => validateEnv({ NODE_ENV: 'production', DATABASE_URL: validProd.DATABASE_URL }))
        .toThrow(/JWT_SECRET[\s\S]*LIVEKIT_API_SECRET/);
    });

    it('ws:// дар прод рад мешавад — браузер аз https онро блок мекунад', () => {
      expect(() => validateEnv({ ...validProd, LIVEKIT_URL: 'ws://x.livekit.cloud' })).toThrow(
        /LIVEKIT_URL/,
      );
    });

    // Регресс: isProd дар сатҳи модул ҳисоб мешуд, аз process.env ҳангоми import.
    // NODE_ENV аз .env меомад ва ҳанӯз дар process.env набуд → валидатор дар прод
    // хомӯшона ба режими dev меафтод, яъне маҳз ҳамон баге, ки бояд пешгирӣ шавад.
    it('режимро аз объекти тафтишшаванда мегирад, на аз process.env', () => {
      const saved = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      try {
        expect(() =>
          validateEnv({ ...validProd, REDIS_URL: 'redis://localhost:6379' }),
        ).toThrow(/localhost/);
      } finally {
        process.env.NODE_ENV = saved;
      }
    });
  });

  describe('development', () => {
    it('localhost иҷозат аст ва дефолтҳо пур мешаванд', () => {
      const value = validateEnv({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://ig:pw@localhost:5433/instagram',
      });
      expect(value.REDIS_URL).toBe('redis://localhost:6379');
      expect(value.S3_PUBLIC_URL).toBe('http://localhost:9000/instagram');
      expect(value.PORT).toBe(3000);
    });

    // DATABASE_URL дефолт надорад: бе он Prisma ҳар ҳол намеафтад, вале
    // хатогиаш дар қаъри query аён мешавад, на ҳангоми старт.
    it('бе DATABASE_URL ҳатто дар dev намегузарад', () => {
      expect(() => validateEnv({ NODE_ENV: 'development' })).toThrow(/DATABASE_URL/);
    });
  });
});
