import 'reflect-metadata';
import {
  ORGANIZATION_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { PlayerController } from './player.controller';

function getRequiredPermissions(handlerName: keyof PlayerController) {
  return Reflect.getMetadata(
    ORGANIZATION_PERMISSION_METADATA_KEY,
    PlayerController.prototype[handlerName],
  );
}

describe('PlayerController permissions', () => {
  it('keeps the destructive compatibility route restricted to player managers', () => {
    expect(getRequiredPermissions('remove')).toEqual([
      ORGANIZATION_PERMISSIONS.PLAYERS_MANAGE,
    ]);
  });
});
