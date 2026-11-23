import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Review fixes for the ResearchModule:
 * - `claim_token` fencing tokens on research_run / paper_analysis, so a worker whose lease was
 *   taken over can no longer checkpoint, complete or fail the record;
 * - `llm_usage.reserved_usd` / `settled_at`: worst-case budget reservations made before every
 *   Claude request and settled to the reported usage afterwards.
 */
export class ResearchClaimFencing1795437301783 implements MigrationInterface {
  name = 'ResearchClaimFencing1795437301783';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "research_run" ADD "claim_token" uuid`);
    await queryRunner.query(`ALTER TABLE "paper_analysis" ADD "claim_token" uuid`);
    await queryRunner.query(
      `ALTER TABLE "llm_usage" ADD "reserved_usd" numeric(12,6) NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(`ALTER TABLE "llm_usage" ADD "settled_at" TIMESTAMP WITH TIME ZONE`);
    // Rows written before reservations existed were recorded after their call: already settled.
    await queryRunner.query(`UPDATE "llm_usage" SET "settled_at" = "created_at"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "settled_at"`);
    await queryRunner.query(`ALTER TABLE "llm_usage" DROP COLUMN "reserved_usd"`);
    await queryRunner.query(`ALTER TABLE "paper_analysis" DROP COLUMN "claim_token"`);
    await queryRunner.query(`ALTER TABLE "research_run" DROP COLUMN "claim_token"`);
  }
}
