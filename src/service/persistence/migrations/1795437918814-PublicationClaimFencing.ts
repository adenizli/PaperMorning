import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Review fixes for the PublicationModule:
 * - `claim_token` fencing tokens on publication_run / article_variant (stale workers cannot
 *   overwrite a newer owner's checkpoint, status or article);
 * - `issue.render_token` / `render_lease_expires_at`: one PDF renderer per FROZEN issue;
 * - `outlook_generation`: minimal technical claim + cache row per Ufuk Raporu fingerprint. It is
 *   needed because no existing table is keyed by the shared outlook fingerprint: without it two
 *   readers could pay for the same report concurrently, and a finished report would only be
 *   persisted inside an issue snapshot (lost if that publication failed before freezing).
 *   The report itself remains nested issue content; this is not a separate domain model.
 */
export class PublicationClaimFencing1795437918814 implements MigrationInterface {
  name = 'PublicationClaimFencing1795437918814';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "outlook_generation" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "fingerprint" character(64) NOT NULL, "status" character varying(16) NOT NULL, "report" jsonb, "model" character varying(100) NOT NULL, "prompt_version" character varying(32) NOT NULL, "attempt_count" integer NOT NULL DEFAULT '0', "retryable" boolean NOT NULL DEFAULT true, "lease_expires_at" TIMESTAMP WITH TIME ZONE, "claim_token" uuid, "error_kind" character varying(48), "error_message" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_898c32e5348d3af383c2b643daf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_outlook_generation_fingerprint" ON "outlook_generation" ("fingerprint") `,
    );
    await queryRunner.query(`ALTER TABLE "publication_run" ADD "claim_token" uuid`);
    await queryRunner.query(`ALTER TABLE "issue" ADD "render_token" uuid`);
    await queryRunner.query(
      `ALTER TABLE "issue" ADD "render_lease_expires_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "article_variant" ADD "claim_token" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "article_variant" DROP COLUMN "claim_token"`);
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "render_lease_expires_at"`);
    await queryRunner.query(`ALTER TABLE "issue" DROP COLUMN "render_token"`);
    await queryRunner.query(`ALTER TABLE "publication_run" DROP COLUMN "claim_token"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_outlook_generation_fingerprint"`);
    await queryRunner.query(`DROP TABLE "outlook_generation"`);
  }
}
