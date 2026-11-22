import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';

const toSnake = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();

/** Maps camelCase entity properties to snake_case PostgreSQL identifiers. */
export class SnakeNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  override tableName(className: string, customName?: string): string {
    return customName ?? toSnake(className.replace(/Entity$/, ''));
  }

  override columnName(propertyName: string, customName: string | undefined, prefixes: string[]) {
    return toSnake([...prefixes, customName ?? propertyName].join('_'));
  }

  override relationName(propertyName: string): string {
    return toSnake(propertyName);
  }

  override joinColumnName(relationName: string, referencedColumnName: string): string {
    return toSnake(`${relationName}_${referencedColumnName}`);
  }
}
