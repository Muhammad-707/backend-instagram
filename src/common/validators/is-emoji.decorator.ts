import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * Разрешаем ЛЮБОЙ существующий эмодзи как реакцию — ровно как в настоящем Instagram,
 * а не жёсткий набор из одного-двух смайликов.
 *
 * Покрывает и составные последовательности:
 *  - ZWJ (семьи 👨‍👩‍👧‍👦, пары 🧑🏻‍❤️‍🧑🏿, профессии 👩🏽‍🚀),
 *  - модификаторы тона кожи, variation selector (❤️),
 *  - флаги стран 🇹🇯, keycap 5️⃣.
 *
 * Раньше стоял `@MaxLength(8)`, и любой эмодзи длиннее 8 UTF-16 единиц (то есть почти
 * все составные) отвергался с 400 — отсюда «работали только один-два смайлика».
 */

// Только эмодзи-кодпоинты: пиктограммы + компоненты + ZWJ + VS16 + keycap + региональные индикаторы.
const EMOJI_CHARSET =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|⃣|[\u{1F1E6}-\u{1F1FF}])+$/u;

// Должен содержать хотя бы один «настоящий» эмодзи (не только цифру-компонент).
const HAS_REAL_EMOJI = /\p{Extended_Pictographic}|⃣|[\u{1F1E6}-\u{1F1FF}]/u;

// Хватает даже самым длинным ZWJ-последовательностям; отсекает «абзац текста вместо реакции».
const MAX_UNITS = 80;

export function isEmoji(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_UNITS &&
    EMOJI_CHARSET.test(value) &&
    HAS_REAL_EMOJI.test(value)
  );
}

export function IsEmoji(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'isEmoji',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown): boolean {
          return isEmoji(value);
        },
        defaultMessage(args: ValidationArguments): string {
          return `${args.property}: должен быть эмодзи (любой, включая составные — семьи, флаги, тон кожи)`;
        },
      },
    });
  };
}
