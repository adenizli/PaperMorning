import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountModule1795416882433 implements MigrationInterface {
  name = 'AccountModule1795416882433';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "users" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "username" character varying(32) NOT NULL, "email" character varying(254) NOT NULL, "password_hash" character varying(255) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_email" ON "users" ("email") `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_users_username" ON "users" ("username") `);
    await queryRunner.query(
      `CREATE TABLE "topic_preference" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "topic_key" character varying(64) NOT NULL, "priority" character varying(16) NOT NULL, "knowledge_level" character varying(16) NOT NULL, CONSTRAINT "PK_97a51d31cd707026af18dd5ecd6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_topic_preference_user_topic" ON "topic_preference" ("user_id", "topic_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "reader_preference" ("user_id" uuid NOT NULL, "language" character varying(8) NOT NULL, "timezone" character varying(64) NOT NULL, "daily_email_enabled" boolean NOT NULL DEFAULT false, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ee8c0c97f0bc5048e6bc8420065" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "topic_preference" ADD CONSTRAINT "FK_1a4880293fac517a48eca1af84a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "reader_preference" ADD CONSTRAINT "FK_ee8c0c97f0bc5048e6bc8420065" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "reader_preference" DROP CONSTRAINT "FK_ee8c0c97f0bc5048e6bc8420065"`,
    );
    await queryRunner.query(
      `ALTER TABLE "topic_preference" DROP CONSTRAINT "FK_1a4880293fac517a48eca1af84a"`,
    );
    await queryRunner.query(`DROP TABLE "reader_preference"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_topic_preference_user_topic"`);
    await queryRunner.query(`DROP TABLE "topic_preference"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_username"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_users_email"`);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
