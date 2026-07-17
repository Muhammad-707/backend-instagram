import * as Joi from 'joi';

/**
 * Валидатсияи env ҳангоми старт (fail-fast).
 *
 * Сабаб: то ин ҷо ҳар сервис дефолти хомӯши `localhost` дошт
 * (`config.get('REDIS_URL', 'redis://localhost:6379')` ва ғ.). Дар прод ин
 * маънои онро дошт, ки env-и гумшуда хатогӣ намедод — барнома бо `localhost`
 * бармехест ва ба контейнери худаш мезад. Ҳар се сервис (БД, Redis, MinIO)
 * якбора «down» мешуданд ва сабаб дида намешуд.
 *
 * Акнун дар `NODE_ENV=production` набудани ҳар яке аз инҳо стартро мешиканад
 * бо рӯйхати аниқи он чи намерасад.
 */

/**
 * Схема аз рӯи NODE_ENV сохта мешавад — ва ин NODE_ENV аз ҳамон объекти
 * тафтишшаванда гирифта мешавад, на аз `process.env` ҳангоми import.
 * Фарқаш муҳим: ConfigModule метавонад NODE_ENV-ро аз `.env` дарояд, ки
 * ҳангоми import-и ин файл ҳанӯз дар `process.env` нест. Агар `isProd`-ро дар
 * сатҳи модул ҳисоб кунем, валидатор дар прод хомӯшона ба режими dev меафтад
 * — яъне ҳамон баге, ки ин файл бояд онро пешгирӣ кунад.
 */
function buildSchema(isProd: boolean): Joi.ObjectSchema<Record<string, unknown>> {
  /** Дар прод `localhost`/`127.0.0.1` ҳамеша хатост — ин конфиги dev аст. */
  const noLocalhost = (label: string) =>
    Joi.string()
      .custom((value: string, helpers) => {
        if (isProd && /(?:localhost|127\.0\.0\.1)/i.test(value)) {
          return helpers.error('env.localhost');
        }
        return value;
      }, 'no-localhost-in-production')
      .messages({
        'env.localhost':
          `"${label}" ба localhost ишора мекунад, вале NODE_ENV=production. ` +
          'Дар дохили контейнер localhost = худи ҳамон контейнер, на сервиси воқеӣ. ' +
          'Суроғаи публикии сервисро нависед.',
      });

  /**
   * Қиматҳои қолабӣ («ҷойнишин») дар прод хатоанд.
   *
   * Сабаб аз таҷрибаи воқеӣ: дар прод `LIVEKIT_URL=wss://your-livekit-url.com`
   * истода буд. Он аз ҳар ду тафтиши мавҷуда мегузашт — ҳам `wss`, ҳам
   * `localhost` нест — вале чунин домен вуҷуд надорад. Барнома бехато
   * бармехост, эфир «сар мешуд» ва токен медод, аммо браузер ба LiveKit
   * пайваст шуда наметавонист: камера ва садо кор намекарданд, бе ягон хато.
   *
   * `devkey`/`devsecret` дефолтҳои dev-анд: дар прод бо онҳо ҳар кас метавонад
   * токени эфир ҷаъл кунад.
   */
  const PLACEHOLDERS = [
    /your[-_]/i,
    /^dev[-_]?key/i,
    /^dev[-_]?secret/i,
    /change[-_]?me/i,
    /^<.*>$/,
  ];
  const noPlaceholder = (label: string) =>
    Joi.string()
      .custom((value: string, helpers) => {
        if (isProd && PLACEHOLDERS.some((re) => re.test(value))) {
          return helpers.error('env.placeholder');
        }
        return value;
      }, 'no-placeholder-in-production')
      .messages({
        'env.placeholder':
          `"${label}" қимати қолабӣ дорад, вале NODE_ENV=production. ` +
          'Қимати воқеиро нависед — вагарна барнома бехато бармехезад, аммо кор намекунад.',
      });

  /** Дар прод ҳатмӣ, дар dev — дефолти маҳаллӣ. */
  const requiredInProd = <T extends Joi.Schema>(schema: T, devDefault: string | number): T =>
    (isProd ? schema.required() : schema.default(devDefault)) as T;

  return Joi.object<Record<string, unknown>>({
    // ---- App ----
    NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
    PORT: Joi.number().port().default(3000),
    APP_URL: requiredInProd(noLocalhost('APP_URL').uri(), 'http://localhost:3000'),
    FRONTEND_URL: Joi.string().uri().default('http://localhost:3001'),

    // ---- PostgreSQL ----
    // Prisma худаш DATABASE_URL-ро аз env мехонад (prisma/schema.prisma → env("DATABASE_URL")).
    DATABASE_URL: noLocalhost('DATABASE_URL')
      .uri({ scheme: ['postgresql', 'postgres'] })
      .required(),

    // ---- Redis ----
    REDIS_URL: requiredInProd(
      noLocalhost('REDIS_URL').uri({ scheme: ['redis', 'rediss'] }),
      'redis://localhost:6379',
    ),

    // ---- JWT ----
    // Дефолтҳои «change_me_*» дар прод = осебпазирии амниятӣ: ҳар кас token ҷаъл карда метавонад.
    JWT_SECRET: requiredInProd(Joi.string().min(16), 'change_me_access_secret'),
    JWT_EXPIRES_IN: Joi.string().default('15m'),
    JWT_REFRESH_SECRET: requiredInProd(Joi.string().min(16), 'change_me_refresh_secret'),
    JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),

    // ---- S3 / MinIO ----
    S3_ENDPOINT: requiredInProd(noLocalhost('S3_ENDPOINT'), 'localhost'),
    S3_PORT: Joi.number().port().default(9000),
    S3_USE_SSL: requiredInProd(Joi.string().valid('true', 'false'), 'false'),
    S3_ACCESS_KEY: requiredInProd(Joi.string(), 'minioadmin'),
    S3_SECRET_KEY: requiredInProd(Joi.string(), 'minioadmin'),
    S3_BUCKET: Joi.string().default('instagram'),
    // Домени публикӣ, ки аз он медиа ба браузер меравад (avatarUrl, media[].url ва ғ.).
    S3_PUBLIC_URL: requiredInProd(
      noLocalhost('S3_PUBLIC_URL').uri(),
      'http://localhost:9000/instagram',
    ),

    // ---- SMTP ----
    SMTP_HOST: requiredInProd(Joi.string(), 'localhost'),
    SMTP_PORT: Joi.number().port().default(1025),
    SMTP_USER: Joi.string().allow('').default(''),
    SMTP_PASS: Joi.string().allow('').default(''),
    SMTP_FROM: Joi.string().default('Instagram <no-reply@instagram.local>'),

    // ---- LiveKit ----
    // Браузер аз https танҳо wss:// -ро иҷозат медиҳад — ws:// дар прод манъ.
    LIVEKIT_URL: requiredInProd(
      noLocalhost('LIVEKIT_URL')
        .concat(noPlaceholder('LIVEKIT_URL'))
        .uri({ scheme: isProd ? ['wss'] : ['ws', 'wss'] }),
      'ws://localhost:7880',
    ),
    LIVEKIT_API_KEY: requiredInProd(noPlaceholder('LIVEKIT_API_KEY'), 'devkey'),
    LIVEKIT_API_SECRET: requiredInProd(noPlaceholder('LIVEKIT_API_SECRET'), 'devsecret'),

    // ---- Spotify (ихтиёрӣ: набошад, модул хомӯш) ----
    SPOTIFY_CLIENT_ID: Joi.string().allow('').default(''),
    SPOTIFY_CLIENT_SECRET: Joi.string().allow('').default(''),

    // ---- Limits ----
    MAX_IMAGE_MB: Joi.number().default(10),
    MAX_VIDEO_MB: Joi.number().default(100),
    MAX_AUDIO_MB: Joi.number().default(20),
  }).unknown(true);
}

/** Хатогии хонданбоб бо рӯйхати аниқи он чи намерасад — на stack-и Joi. */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const rawNodeEnv = config.NODE_ENV ?? process.env.NODE_ENV;
  const nodeEnv = typeof rawNodeEnv === 'string' ? rawNodeEnv : 'development';

  // Натиҷаро пеш аз тафтиши `error` кушода намекунем: дар шохаи хатогии Joi
  // `value` типи `any` дорад, ва танҳо баъди narrowing аз рӯи `error` он
  // `Record<string, unknown>` мешавад.
  const result = buildSchema(nodeEnv === 'production').validate(config, {
    abortEarly: false,
    allowUnknown: true,
  });

  if (result.error) {
    const lines = result.error.details.map(
      (d) => `  · ${d.context?.label ?? d.path.join('.')}: ${d.message}`,
    );
    throw new Error(
      `\n\n╔══ Конфиги нодуруст (NODE_ENV=${nodeEnv}) ══\n` +
        `${lines.join('\n')}\n` +
        `╚══ Инҳоро дар env-и сервис (Render → Environment) илова/ислоҳ кунед.\n`,
    );
  }

  return result.value;
}
