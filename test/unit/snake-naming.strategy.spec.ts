import { SnakeNamingStrategy } from '../../src/service/persistence/snake-naming.strategy';

describe('SnakeNamingStrategy', () => {
  const strategy = new SnakeNamingStrategy();

  it('derives snake_case table names from entity class names', () => {
    expect(strategy.tableName('PaperVersionEntity', undefined)).toBe('paper_version');
    expect(strategy.tableName('PaperEntity', 'custom_name')).toBe('custom_name');
  });

  it('derives snake_case column names', () => {
    expect(strategy.columnName('passwordHash', undefined, [])).toBe('password_hash');
    expect(strategy.columnName('pdfSha256', undefined, [])).toBe('pdf_sha256');
    expect(strategy.columnName('createdAt', 'created_at', [])).toBe('created_at');
  });
});
