import { IsBoolean } from 'class-validator';

export class NotificationReadDto {
  @IsBoolean()
  read!: boolean;
}
