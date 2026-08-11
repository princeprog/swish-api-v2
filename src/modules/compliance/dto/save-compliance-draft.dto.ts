import { IsDefined } from 'class-validator';

export class SaveComplianceDraftDto {
  @IsDefined()
  response!: unknown;
}
