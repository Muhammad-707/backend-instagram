import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Найти существующий диалог 1-на-1 двух пользователей или создать новый.
 * Вынесено в @Global-сервис, потому что этим пользуются posts (share), stories
 * (reaction/reply) и notes (reply) — три копии одной логики разошлись бы.
 */
@Injectable()
export class ChatUtilService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateDirectChat(a: string, b: string): Promise<{ id: number }> {
    const existing = await this.prisma.chat.findFirst({
      where: {
        isGroup: false,
        AND: [{ participants: { some: { userId: a } } }, { participants: { some: { userId: b } } }],
      },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.chat.create({
      data: { isGroup: false, participants: { create: [{ userId: a }, { userId: b }] } },
      select: { id: true },
    });
  }
}
