import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MaxLength(160)
  @MinLength(1)
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
