import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerificationStatusDto } from './dto/verification.dto';
import { VerificationService } from './verification.service';

@ApiBearerAuth()
@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get('status')
  @ApiOperation({ summary: 'Статус верификации (TRIAL/ACTIVE/EXPIRED/CANCELED + дней осталось)' })
  @ApiOkResponse({ type: VerificationStatusDto })
  async status(@CurrentUser('id') userId: string): Promise<VerificationStatusDto> {
    return this.verification.status(userId);
  }

  @Post('start-trial')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Начать бесплатный триал (7 дней, 1 раз на аккаунт)' })
  @ApiOkResponse({ type: VerificationStatusDto })
  async startTrial(@CurrentUser('id') userId: string): Promise<VerificationStatusDto> {
    return this.verification.startTrial(userId);
  }

  @Post('subscribe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Оформить подписку ($1000/мес, mock-платёж MOCK/PAID)' })
  @ApiOkResponse({ type: VerificationStatusDto })
  async subscribe(@CurrentUser('id') userId: string): Promise<VerificationStatusDto> {
    return this.verification.subscribe(userId);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Отменить (галочка держится до конца оплаченного периода)' })
  @ApiOkResponse({ type: VerificationStatusDto })
  async cancel(@CurrentUser('id') userId: string): Promise<VerificationStatusDto> {
    return this.verification.cancel(userId);
  }
}
