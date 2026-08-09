import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { NotificationListQueryDto } from './dto/notification-list-query.dto';
import { NotificationReadAllDto } from './dto/notification-read-all.dto';
import { NotificationReadDto } from './dto/notification-read.dto';
import { NotificationService } from './notification.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: NotificationListQueryDto,
  ) {
    return this.notificationService.list(user.id, user.email, query);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notificationService
      .unreadCount(user.id, user.email)
      .then((count) => ({ count }));
  }

  @Patch(':notificationId')
  setRead(
    @CurrentUser() user: AuthUser,
    @Param('notificationId') notificationId: string,
    @Body() body: NotificationReadDto,
  ) {
    return this.notificationService.setRead(
      user.id,
      user.email,
      notificationId,
      body.read,
    );
  }

  @Post('read-all')
  markAllRead(
    @CurrentUser() user: AuthUser,
    @Body() body: NotificationReadAllDto,
  ) {
    return this.notificationService.markAllRead(
      user.id,
      user.email,
      body.organizationId,
    );
  }
}
