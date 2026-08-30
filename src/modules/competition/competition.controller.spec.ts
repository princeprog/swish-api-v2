import 'reflect-metadata';
import {
  ORGANIZATION_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { CompetitionController } from './competition.controller';

function permissions(handler: keyof CompetitionController) {
  return Reflect.getMetadata(
    ORGANIZATION_PERMISSION_METADATA_KEY,
    CompetitionController.prototype[handler],
  );
}

describe('CompetitionController permissions', () => {
  it('allows organization members to read the competition workspace', () => {
    expect(permissions('getWorkspace')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
    expect(permissions('getBracket')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
  });

  it('restricts format, pool, generation, and reset actions to schedulers', () => {
    for (const handler of [
      'updateFormat',
      'setPoolAssignments',
      'generate',
      'scheduleMatchup',
      'reset',
    ] as const) {
      expect(permissions(handler)).toEqual([
        ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
      ]);
    }
  });
});
