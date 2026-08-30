import { PartialType } from '@nestjs/mapped-types';
import { LeagueSeasonCompetitionDefaultsDto } from '../../league-season/dto/league-season-competition-defaults.dto';

export class UpdateCompetitionFormatDto extends PartialType(
  LeagueSeasonCompetitionDefaultsDto,
) {}
