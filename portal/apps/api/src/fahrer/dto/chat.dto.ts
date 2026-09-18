import { IsOptional, IsString, MinLength } from 'class-validator';

export class SendChatDto {
  @IsString()
  @MinLength(1)
  text!: string;

  @IsOptional()
  @IsString()
  tourNumber?: string;
}
