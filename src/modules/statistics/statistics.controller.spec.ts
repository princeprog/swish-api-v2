import 'reflect-metadata';
import {
  ORGANIZATION_ANY_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { StatisticsController } from './statistics.controller';

describe('StatisticsController permissions', () => {
  it('allows assigned statisticians and owner/admin overrides', () => {
    expect(
      Reflect.getMetadata(
        ORGANIZATION_ANY_PERMISSION_METADATA_KEY,
        StatisticsController,
      ),
    ).toEqual([
      ORGANIZATION_PERMISSIONS.GAME_STATS_ASSIGNED,
      ORGANIZATION_PERMISSIONS.GAME_STATS_OVERRIDE,
    ]);
  });
});
