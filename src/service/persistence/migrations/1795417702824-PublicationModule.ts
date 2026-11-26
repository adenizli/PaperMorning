import { MigrationInterface, QueryRunner } from 'typeorm';

export class PublicationModule1795417702824 implements MigrationInterface {
  name = 'PublicationModule1795417702824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "publication_run" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "issue_date" date NOT NULL, "status" character varying(16) NOT NULL, "stage" character varying(16) NOT NULL, "checkpoint" jsonb NOT NULL DEFAULT '{}', "attempt_count" integer NOT NULL DEFAULT '0', "retryable" boolean NOT NULL DEFAULT true, "lease_expires_at" TIMESTAMP WITH TIME ZONE, "error_kind" character varying(48), "error_message" text, "next_attempt_at" TIMESTAMP WITH TIME ZONE, "late_at" TIMESTAMP WITH TIME ZONE, "issue_id" uuid, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_6f0e9e806f59ee774b686992b85" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_publication_run_user_date" ON "publication_run" ("user_id", "issue_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "issue" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "issue_date" date NOT NULL, "timezone" character varying(64) NOT NULL, "language" character varying(8) NOT NULL, "status" character varying(16) NOT NULL, "content" jsonb NOT NULL, "content_hash" character(64) NOT NULL, "pdf_storage_key" character varying(255), "pdf_sha256" character(64), "pdf_size_bytes" integer, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_f80e086c249b9f3f3ff2fd321b7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_issue_user_date" ON "issue" ("user_id", "issue_date") `,
    );
    await queryRunner.query(
      `CREATE TABLE "email_delivery" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "issue_id" uuid NOT NULL, "user_id" uuid NOT NULL, "channel" character varying(16) NOT NULL, "status" character varying(16) NOT NULL, "recipient" character varying(254) NOT NULL, "attempt_count" integer NOT NULL DEFAULT '0', "retryable" boolean NOT NULL DEFAULT true, "lease_expires_at" TIMESTAMP WITH TIME ZONE, "provider_message_id" character varying(255), "error_code" character varying(48), "error_message" text, "next_attempt_at" TIMESTAMP WITH TIME ZONE, "last_attempt_at" TIMESTAMP WITH TIME ZONE, "sent_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a39c05a113fa6130d51558e809a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a03fb4543e65662fa26d1a613" ON "email_delivery" ("status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_email_delivery_issue_channel" ON "email_delivery" ("issue_id", "channel") `,
    );
    await queryRunner.query(
      `CREATE TABLE "article_variant" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "analysis_id" uuid NOT NULL, "analysis_fingerprint" character(64) NOT NULL, "language" character varying(8) NOT NULL, "knowledge_level" character varying(16) NOT NULL, "generation_fingerprint" character(64) NOT NULL, "status" character varying(16) NOT NULL, "content" jsonb, "source_references" jsonb NOT NULL DEFAULT '[]', "coverage" character varying(16) NOT NULL, "publication_status" character varying(16) NOT NULL, "model" character varying(100) NOT NULL, "prompt_version" character varying(32) NOT NULL, "schema_version" integer NOT NULL, "attempt_count" integer NOT NULL DEFAULT '0', "retryable" boolean NOT NULL DEFAULT true, "lease_expires_at" TIMESTAMP WITH TIME ZONE, "error_kind" character varying(32), "error_message" text, "input_tokens" integer NOT NULL DEFAULT '0', "output_tokens" integer NOT NULL DEFAULT '0', "cost_usd" numeric(12,6) NOT NULL DEFAULT '0', "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ec2df6de1ce9abfe303a2e3454c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_2c9cf3ea169646dda9da49cddf" ON "article_variant" ("analysis_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_article_variant_fingerprint" ON "article_variant" ("generation_fingerprint") `,
    );
    await queryRunner.query(
      `CREATE TABLE "feedback" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "user_id" uuid NOT NULL, "issue_id" uuid NOT NULL, "content_key" character varying(64) NOT NULL, "value" smallint NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8389f9e087a57689cd5be8b2b13" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_feedback_user_issue_content" ON "feedback" ("user_id", "issue_id", "content_key") `,
    );
    await queryRunner.query(
      `ALTER TABLE "email_delivery" ADD CONSTRAINT "FK_9225ba2a81aa12876817700c17f" FOREIGN KEY ("issue_id") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "feedback" ADD CONSTRAINT "FK_46925b46d9053c8be34ef21ce5e" FOREIGN KEY ("issue_id") REFERENCES "issue"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    // Immutability guard (not expressible in TypeORM metadata): a frozen snapshot never changes,
    // and once READY the PDF reference is fixed as well.
    await queryRunner.query(`
      CREATE FUNCTION issue_immutability_guard() RETURNS trigger AS $$
      BEGIN
        IF NEW.content IS DISTINCT FROM OLD.content
           OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
           OR NEW.user_id IS DISTINCT FROM OLD.user_id
           OR NEW.issue_date IS DISTINCT FROM OLD.issue_date THEN
          RAISE EXCEPTION 'issue % is immutable: snapshot, owner and date cannot change', OLD.id
            USING ERRCODE = 'check_violation';
        END IF;
        IF OLD.status = 'READY' AND (
             NEW.status IS DISTINCT FROM OLD.status
             OR NEW.pdf_storage_key IS DISTINCT FROM OLD.pdf_storage_key
             OR NEW.pdf_sha256 IS DISTINCT FROM OLD.pdf_sha256
             OR NEW.pdf_size_bytes IS DISTINCT FROM OLD.pdf_size_bytes) THEN
          RAISE EXCEPTION 'issue % is published: its PDF reference cannot change', OLD.id
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql`);
    await queryRunner.query(
      `CREATE TRIGGER issue_immutability BEFORE UPDATE ON "issue" FOR EACH ROW EXECUTE FUNCTION issue_immutability_guard()`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER IF EXISTS issue_immutability ON "issue"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS issue_immutability_guard()`);

    await queryRunner.query(
      `ALTER TABLE "feedback" DROP CONSTRAINT "FK_46925b46d9053c8be34ef21ce5e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "email_delivery" DROP CONSTRAINT "FK_9225ba2a81aa12876817700c17f"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_feedback_user_issue_content"`);
    await queryRunner.query(`DROP TABLE "feedback"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_article_variant_fingerprint"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_2c9cf3ea169646dda9da49cddf"`);
    await queryRunner.query(`DROP TABLE "article_variant"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_email_delivery_issue_channel"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_3a03fb4543e65662fa26d1a613"`);
    await queryRunner.query(`DROP TABLE "email_delivery"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_issue_user_date"`);
    await queryRunner.query(`DROP TABLE "issue"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_publication_run_user_date"`);
    await queryRunner.query(`DROP TABLE "publication_run"`);
  }
}
