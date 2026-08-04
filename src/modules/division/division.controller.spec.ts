import 'reflect-metadata';
import {
  ORGANIZATION_PERMISSION_METADATA_KEY,
  ORGANIZATION_PERMISSIONS,
} from '../../common/auth/roles';
import { DivisionController } from './division.controller';

function getRequiredPermissions(handlerName: keyof DivisionController) {
  return Reflect.getMetadata(
    ORGANIZATION_PERMISSION_METADATA_KEY,
    DivisionController.prototype[handlerName],
  );
}

describe('DivisionController permissions', () => {
  it('allows read-only division endpoints with organization read access', () => {
    expect(getRequiredPermissions('findAll')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
    expect(getRequiredPermissions('findOne')).toEqual([
      ORGANIZATION_PERMISSIONS.ORGANIZATION_READ,
    ]);
  });

  it('keeps division mutations restricted to division managers', () => {
    expect(getRequiredPermissions('create')).toEqual([
      ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE,
    ]);
    expect(getRequiredPermissions('update')).toEqual([
      ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE,
    ]);
    expect(getRequiredPermissions('remove')).toEqual([
      ORGANIZATION_PERMISSIONS.DIVISIONS_MANAGE,
    ]);
  });
});
