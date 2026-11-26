import { Transform } from 'class-transformer';
import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * The registration form has exactly three user-entered fields. Any extra property is rejected
 * by the global whitelist validation (forbidNonWhitelisted).
 */
export type RegisterUserInput = {
  username: string;
  email: string;
  password: string;
};

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterUserDto implements RegisterUserInput {
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[A-Za-z0-9_.-]+$/, { message: 'username may contain letters, digits, _ . - only' })
  username!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(254)
  @IsEmail({}, { message: 'email must be a valid email address' })
  email!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}
