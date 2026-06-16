import { PartialType } from '@nestjs/mapped-types';
import { CreateLeagueSeasonDto } from './create-league-season.dto';

export class UpdateLeagueSeasonDto extends PartialType(CreateLeagueSeasonDto) {}
