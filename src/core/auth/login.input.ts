import { IsString, MaxLength, MinLength } from 'class-validator';

export class LoginInput {
  /** Username or email. */
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  identifier!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}
