import 'reflect-metadata';
import {
  ORGANIZATION_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { LeagueSeasonController } from './league-season.controller';

function getRequiredPermissions(handlerName: keyof LeagueSeasonController) {
  return Reflect.getMetadata(
    ORGANIZATION_PERMISSION_METADATA_KEY,
    LeagueSeasonController.prototype[handlerName],
  );
}

describe('LeagueSeasonController permissions', () => {
  it('allows read-only season endpoints with organization read access', () => {
    expect(getRequiredPermissions('findAll')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
    expect(getRequiredPermissions('findOne')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
  });

  it('keeps season mutations restricted to schedule managers', () => {
    expect(getRequiredPermissions('create')).toEqual([
      ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
    ]);
    expect(getRequiredPermissions('update')).toEqual([
      ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
    ]);
    expect(getRequiredPermissions('remove')).toEqual([
      ORGANIZATION_PERMISSIONS.SCHEDULE_MANAGE,
    ]);
  });
});
