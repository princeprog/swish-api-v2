import { Injectable } from '@nestjs/common';
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';

@Injectable()
export class LeagueSeasonService {
  create(createLeagueSeasonDto: CreateLeagueSeasonDto) {
    return 'This action adds a new leagueSeason';
  }

  findAll() {
    return `This action returns all leagueSeason`;
  }

  findOne(id: number) {
    return `This action returns a #${id} leagueSeason`;
  }

  update(id: number, updateLeagueSeasonDto: UpdateLeagueSeasonDto) {
    return `This action updates a #${id} leagueSeason`;
  }

  remove(id: number) {
    return `This action removes a #${id} leagueSeason`;
  }
}
