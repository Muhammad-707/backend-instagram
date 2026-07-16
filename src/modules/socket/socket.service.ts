import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';

/** Тикет живёт 30 секунд: его хватает на один io(), но не на переиспользование. */
const TICKET_TTL_SEC = 30;

const ticketKey = (ticket: string): string => `socket:ticket:${ticket}`;

/**
 * Одноразовые тикеты для авторизации сокета.
 *
 * Зачем не токен. Access-токен у фронта лежит в httpOnly-cookie: из JS его не
 * достать (это и есть защита от XSS), а сокет идёт cross-origin, куда куку
 * браузер не пошлёт. Значит, `io(url, { auth: { token } })` фронту физически
 * нечем заполнить.
 *
 * Как работает. POST /socket/ticket — обычный HTTP-запрос, кука там есть, JWT
 * проверяется штатным guard'ом. В ответ — короткоживущий тикет, который не
 * жалко положить в JS: он одноразовый, живёт 30 секунд и не даёт доступа к API.
 *
 * Хранится в Redis, а не в памяти процесса: инстансов может быть несколько, и
 * тикет, выданный одним, должен приниматься любым.
 */
@Injectable()
export class SocketService {
  constructor(private readonly redis: RedisService) {}

  async issue(userId: string): Promise<{ ticket: string; expiresInSec: number }> {
    const ticket = randomUUID();
    await this.redis.raw.set(ticketKey(ticket), userId, 'EX', TICKET_TTL_SEC);
    return { ticket, expiresInSec: TICKET_TTL_SEC };
  }

  /**
   * Проверяет и СЖИГАЕТ тикет за одну атомарную операцию.
   *
   * Именно GETDEL, а не GET + DEL: между двумя командами два параллельных
   * подключения успели бы прочитать один тикет и оба получили бы доступ.
   * Повторный или просроченный тикет → null → gateway рвёт соединение.
   */
  async burn(ticket: string): Promise<string | null> {
    if (!ticket) return null;
    return this.redis.raw.getdel(ticketKey(ticket));
  }
}
