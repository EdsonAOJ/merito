import { IsNotEmpty, IsString } from 'class-validator';

export class GetBalanceQueryDto {
  @IsString()
  @IsNotEmpty()
  account_id: string;

  @IsString()
  @IsNotEmpty()
  resource_key: string;
}
