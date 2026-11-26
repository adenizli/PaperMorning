import { parseArgs } from '../../src/bootstrap/cli';

describe('CLI argument parsing', () => {
  it('parses a command with valued and boolean flags', () => {
    expect(parseArgs(['research:run', '--topics', 'a,b', '--dry-run', '--cap', '3'])).toEqual({
      command: 'research:run',
      args: { topics: 'a,b', 'dry-run': 'true', cap: '3' },
    });
  });
});
