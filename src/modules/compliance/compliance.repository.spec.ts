import { incrementClearanceProjectionVersion } from './compliance.repository';

describe('ComplianceRepository', () => {
  it('qualifies the projection version when incrementing an existing row', () => {
    const expression = incrementClearanceProjectionVersion().toOperationNode() as {
      parameters: Array<{
        table: {
          table: {
            schema: { name: string };
            identifier: { name: string };
          };
        };
        column: { column: { name: string } };
      }>;
    };

    expect(expression.parameters[0]).toMatchObject({
      table: {
        table: {
          schema: { name: 'compliance' },
          identifier: { name: 'team_clearance_projections' },
        },
      },
      column: { column: { name: 'version' } },
    });
  });
});
