import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Снимает глобальный JwtAuthGuard с роута.
 * По умолчанию ЗАКРЫТО всё — открываем точечно (login, register, health, docs).
 * Так новый endpoint нельзя случайно забыть защитить.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);
