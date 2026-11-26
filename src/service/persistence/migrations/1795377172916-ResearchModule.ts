import { MigrationInterface, QueryRunner } from 'typeorm';

export class ResearchModule1795377172916 implements MigrationInterface {
  name = 'ResearchModule1795377172916';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "llm_usage" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "task" character varying(32) NOT NULL, "model" character varying(100) NOT NULL, "status" character varying(16) NOT NULL, "error_kind" character varying(32), "input_tokens" integer NOT NULL DEFAULT '0', "output_tokens" integer NOT NULL DEFAULT '0', "cost_usd" numeric(12,6) NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_896db5280e4018d7bc7acd24294" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_cec59fc8a5a0a9655cbf43c446" ON "llm_usage" ("created_at") `,
    );
    await queryRunner.query(
      `CREATE TABLE "research_run" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "run_key" character varying(128) NOT NULL, "trigger" character varying(16) NOT NULL, "topic_key" character varying(64) NOT NULL, "window_from" date NOT NULL, "window_until" date NOT NULL, "status" character varying(16) NOT NULL, "stage" character varying(16) NOT NULL, "counts" jsonb NOT NULL, "discovered_version_ids" jsonb NOT NULL DEFAULT '[]', "candidate_version_ids" jsonb NOT NULL DEFAULT '[]', "errors" jsonb NOT NULL DEFAULT '[]', "attempt_count" integer NOT NULL DEFAULT '0', "lease_expires_at" TIMESTAMP WITH TIME ZONE, "started_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_956d00c5b1f836885bbe3f10b21" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_research_run_key" ON "research_run" ("run_key") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paper" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "title" text NOT NULL, "authors" jsonb NOT NULL DEFAULT '[]', "doi" character varying(255), "arxiv_id" character varying(64), "open_alex_id" character varying(32), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_ca8320a8e49e70e3de2d843a80a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_openalex_id" ON "paper" ("open_alex_id") WHERE "open_alex_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_arxiv_id" ON "paper" ("arxiv_id") WHERE "arxiv_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_doi" ON "paper" ("doi") WHERE "doi" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE TABLE "paper_version" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "paper_id" uuid NOT NULL, "source" character varying(16) NOT NULL, "source_record_id" character varying(64) NOT NULL, "version_label" character varying(32), "publication_status" character varying(16) NOT NULL, "published_at" date NOT NULL, "source_updated_at" TIMESTAMP WITH TIME ZONE, "title" text NOT NULL, "abstract" text, "content_coverage" character varying(16) NOT NULL, "venue" text, "landing_url" text NOT NULL, "pdf_url" text, "categories" jsonb NOT NULL DEFAULT '[]', "content_fingerprint" character(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_569e18b6e8f090b822dc60af335" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_50cf8bfbed0484e9054fcfb8f9" ON "paper_version" ("published_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_92316b7271205014c6c21546a7" ON "paper_version" ("source", "source_record_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_version_content" ON "paper_version" ("paper_id", "publication_status", "content_fingerprint") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paper_screening" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "paper_version_id" uuid NOT NULL, "topic_key" character varying(64) NOT NULL, "criteria_version" character varying(128) NOT NULL, "decision" character varying(16) NOT NULL, "method" character varying(16) NOT NULL, "relevance_score" numeric(4,3), "reason" text NOT NULL, "model" character varying(100), "prompt_version" character varying(32), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_03965b49380cd266aca82c31c69" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1ee292643ba670963c6e7fc180" ON "paper_screening" ("topic_key", "decision") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_screening_criteria" ON "paper_screening" ("paper_version_id", "topic_key", "criteria_version") `,
    );
    await queryRunner.query(
      `CREATE TABLE "paper_analysis" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "paper_version_id" uuid NOT NULL, "fingerprint" character(64) NOT NULL, "status" character varying(16) NOT NULL, "coverage" character varying(16) NOT NULL, "content" jsonb, "source_references" jsonb NOT NULL DEFAULT '[]', "model" character varying(100) NOT NULL, "prompt_version" character varying(32) NOT NULL, "schema_version" integer NOT NULL, "attempt_count" integer NOT NULL DEFAULT '0', "retryable" boolean NOT NULL DEFAULT true, "lease_expires_at" TIMESTAMP WITH TIME ZONE, "error_kind" character varying(32), "error_message" text, "input_tokens" integer NOT NULL DEFAULT '0', "output_tokens" integer NOT NULL DEFAULT '0', "cost_usd" numeric(12,6) NOT NULL DEFAULT '0', "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_a54463d3a277670fcb2c116e239" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27868431878ed67880e68386d4" ON "paper_analysis" ("paper_version_id", "status") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_paper_analysis_fingerprint" ON "paper_analysis" ("fingerprint") `,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_version" ADD CONSTRAINT "FK_7f4ca4664bf466e4e86d025e094" FOREIGN KEY ("paper_id") REFERENCES "paper"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_screening" ADD CONSTRAINT "FK_f5347a28c860bb1f89df26a4b5d" FOREIGN KEY ("paper_version_id") REFERENCES "paper_version"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_analysis" ADD CONSTRAINT "FK_2881cf3923af82e2dd37e70f2b2" FOREIGN KEY ("paper_version_id") REFERENCES "paper_version"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "paper_analysis" DROP CONSTRAINT "FK_2881cf3923af82e2dd37e70f2b2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_screening" DROP CONSTRAINT "FK_f5347a28c860bb1f89df26a4b5d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "paper_version" DROP CONSTRAINT "FK_7f4ca4664bf466e4e86d025e094"`,
    );
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_analysis_fingerprint"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_27868431878ed67880e68386d4"`);
    await queryRunner.query(`DROP TABLE "paper_analysis"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_screening_criteria"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_1ee292643ba670963c6e7fc180"`);
    await queryRunner.query(`DROP TABLE "paper_screening"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_version_content"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_92316b7271205014c6c21546a7"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_50cf8bfbed0484e9054fcfb8f9"`);
    await queryRunner.query(`DROP TABLE "paper_version"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_doi"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_arxiv_id"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_paper_openalex_id"`);
    await queryRunner.query(`DROP TABLE "paper"`);
    await queryRunner.query(`DROP INDEX "public"."UQ_research_run_key"`);
    await queryRunner.query(`DROP TABLE "research_run"`);
    await queryRunner.query(`DROP INDEX "public"."IDX_cec59fc8a5a0a9655cbf43c446"`);
    await queryRunner.query(`DROP TABLE "llm_usage"`);
  }
}
