import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** No verification state by design: there is no email verification in this product. */
@Entity('users')
@Index('UQ_users_username', ['username'], { unique: true })
@Index('UQ_users_email', ['email'], { unique: true })
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** Stored normalized (trimmed, lower-case). */
  @Column({ type: 'varchar', length: 32 })
  username!: string;

  /** Stored normalized (trimmed, lower-case). */
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
