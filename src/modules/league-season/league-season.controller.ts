import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { LeagueSeasonService } from './league-season.service';
import { CreateLeagueSeasonDto } from './dto/create-league-season.dto';
import { UpdateLeagueSeasonDto } from './dto/update-league-season.dto';

@Controller('league-season')
export class LeagueSeasonController {
  constructor(private readonly leagueSeasonService: LeagueSeasonService) {}

  @Post()
  create(@Body() createLeagueSeasonDto: CreateLeagueSeasonDto) {
    return this.leagueSeasonService.create(createLeagueSeasonDto);
  }

  @Get()
  findAll() {
    return this.leagueSeasonService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.leagueSeasonService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateLeagueSeasonDto: UpdateLeagueSeasonDto) {
    return this.leagueSeasonService.update(+id, updateLeagueSeasonDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.leagueSeasonService.remove(+id);
  }
}
