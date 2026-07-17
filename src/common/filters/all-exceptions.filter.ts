import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

interface ErrorBody {
  data: null;
  errors: string[];
  statusCode: number;
  code: string;
  path: string;
  timestamp: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let errors: string[] = ['Internal server error'];
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      errors = this.extractMessages(payload);
      code = this.extractCode(payload, status);
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = this.mapPrismaError(exception);
      status = mapped.status;
      errors = mapped.errors;
      code = mapped.code;
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${status}: ${errors.join('; ')}`);
    }

    const body: ErrorBody = {
      data: null,
      errors,
      statusCode: status,
      code,
      path: req.url,
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }

  private extractMessages(payload: string | object): string[] {
    if (typeof payload === 'string') return [payload];
    const obj = payload as { message?: string | string[]; error?: string };
    if (Array.isArray(obj.message)) return obj.message;
    if (typeof obj.message === 'string') return [obj.message];
    if (typeof obj.error === 'string') return [obj.error];
    return ['Unexpected error'];
  }

  private extractCode(payload: string | object, status: number): string {
    if (typeof payload === 'object' && payload !== null) {
      const obj = payload as { code?: string };
      if (typeof obj.code === 'string') return obj.code;
    }
    return HttpStatus[status] ?? 'ERROR';
  }

  private mapPrismaError(e: Prisma.PrismaClientKnownRequestError): {
    status: number;
    errors: string[];
    code: string;
  } {
    switch (e.code) {
      case 'P2002': {
        const target = (e.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
        return {
          status: HttpStatus.CONFLICT,
          errors: [`Already exists: ${target}`],
          code: 'ALREADY_EXISTS',
        };
      }
      case 'P2025':
        return { status: HttpStatus.NOT_FOUND, errors: ['Not found'], code: 'NOT_FOUND' };
      case 'P2003':
        return {
          status: HttpStatus.BAD_REQUEST,
          errors: ['Related record not found'],
          code: 'FOREIGN_KEY_VIOLATION',
        };
      // P2021 — ҷадвал нест, P2022 — сутун нест. Ҳарду як маъно доранд:
      // схема ба БД насупоридааст (`prisma migrate deploy` нагузаштааст).
      // Пештар инҳо ба `default` меафтоданд ва «Database error»-и норавшан
      // медоданд, дар ҳоле ки `/api/health` мегуфт database: up — чунки
      // `SELECT 1` ҷадвал талаб намекунад. Соатҳо барои ҳамин сарф шуданд.
      case 'P2021':
      case 'P2022':
        this.logger.error(`Prisma ${e.code}: ${e.message} — схема муҳоҷират нашудааст?`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          errors: ['Схемаи БД муҳоҷират нашудааст (prisma migrate deploy)'],
          code: 'SCHEMA_NOT_MIGRATED',
        };
      default:
        this.logger.error(`Prisma ${e.code}: ${e.message}`);
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          errors: ['Database error'],
          code: 'DATABASE_ERROR',
        };
    }
  }
}
